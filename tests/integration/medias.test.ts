import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEMO_APPS } from '@/server/demos/catalog'
import { FREE_PLAN_ID } from '@/server/billing/plans'
import {
  addMedia,
  addVisitorPhoto,
  listMedias,
  readMedia,
  removeMedia,
  resolveAttachments,
  MAX_ATTACHMENTS,
} from '@/server/media/service'

/**
 * Bibliothèque d'images, sur une vraie base.
 *
 * Deux choses sont vérifiées, et ce sont les deux qui coûtent cher quand elles manquent :
 * le quota, qui borne la seule dépense grandissant avec l'usage, et le cloisonnement, qui
 * empêche l'image d'un créateur d'être servie depuis l'application d'un autre.
 */

let userId: string
let email: string
let otherId: string
let otherEmail: string
let projectId: string
let otherProjectId: string

async function image(width = 600, height = 400): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}

async function makeProject(ownerId: string): Promise<string> {
  const project = await withUserScope(ownerId, (tx) =>
    tx.project.create({
      data: {
        ownerId,
        name: 'Projet de test',
        slug: `medias-${Math.random().toString(36).slice(2, 10)}`,
        idea: 'une idée',
        draftSpec: DEMO_APPS[0]!.spec as unknown as object,
      },
      select: { id: true },
    }),
  )
  return project.id
}

beforeAll(async () => {
  clearAll()
  email = `medias-${Date.now()}@exemple.test`
  otherEmail = `medias-autre-${Date.now()}@exemple.test`
  userId = (await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' })).userId
  otherId = (await register({ email: otherEmail, password: 'motdepasse-2026-solide', locale: 'fr' }))
    .userId
  projectId = await makeProject(userId)
  otherProjectId = await makeProject(otherId)
  // L'offre gratuite n'accorde aucun espace : on en donne pour la durée de la suite.
  await prisma.plan.update({ where: { id: FREE_PLAN_ID }, data: { storageBytes: 300 * 1024 } })
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: [email, otherEmail] } } })
  await prisma.plan.update({ where: { id: FREE_PLAN_ID }, data: { storageBytes: 0 } })
})

describe('ajout d’une image', () => {
  it('stocke une version retraitée, plus légère que l’originale', async () => {
    const original = await image(1600, 1000)
    const media = await addMedia(userId, projectId, { name: 'atelier.png', bytes: original })
    expect(media.bytes).toBeLessThan(original.length)
    expect(media.width).toBeLessThanOrEqual(1600)
  })

  it('refuse un fichier qui n’est pas une image', async () => {
    const fake = new TextEncoder().encode('#!/bin/sh\nrm -rf /')
    await expect(
      addMedia(userId, projectId, { name: 'photo.png', bytes: fake }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })

  it('refuse d’écrire dans le projet de quelqu’un d’autre', async () => {
    await expect(
      addMedia(userId, otherProjectId, { name: 'intrus.png', bytes: await image(100, 100) }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('quota', () => {
  it('accepte une seconde image sous le quota', async () => {
    const media = await addMedia(userId, projectId, {
      name: 'seconde.png',
      bytes: await image(1200, 800),
    })
    expect(media.id).toBeDefined()
  })

  it('arrête le créateur à sa limite au lieu de laisser filer', async () => {
    /*
     * Le quota est ramené juste au-dessus de ce qui est déjà stocké, plutôt que d'empiler
     * des images jusqu'à le heurter : une image de test se compresse trop bien pour que
     * la seconde méthode soit rapide, et surtout elle dépendrait du taux de compression.
     */
    const before = await listMedias(userId, projectId)
    await prisma.plan.update({
      where: { id: FREE_PLAN_ID },
      data: { storageBytes: before.usedBytes + 512 },
    })

    await expect(
      addMedia(userId, projectId, { name: 'de-trop.png', bytes: await image(1600, 1200) }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT' })

    // Rien n'a été écrit : un refus ne doit pas laisser de trace à moitié enregistrée.
    const after = await listMedias(userId, projectId)
    expect(after.items.length).toBe(before.items.length)
    expect(after.usedBytes).toBe(before.usedBytes)

    await prisma.plan.update({ where: { id: FREE_PLAN_ID }, data: { storageBytes: 300 * 1024 } })
  })

  it('refuse tout ajout quand l’offre n’accorde aucun espace', async () => {
    await prisma.plan.update({ where: { id: FREE_PLAN_ID }, data: { storageBytes: 0 } })
    await expect(
      addMedia(userId, projectId, { name: 'interdite.png', bytes: await image(100, 100) }),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT' })
    await prisma.plan.update({ where: { id: FREE_PLAN_ID }, data: { storageBytes: 300 * 1024 } })
  })

  it('rend de la place quand une image est supprimée', async () => {
    const before = await listMedias(userId, projectId)
    await removeMedia(userId, before.items[0]!.id)
    const after = await listMedias(userId, projectId)
    expect(after.usedBytes).toBeLessThan(before.usedBytes)
    expect(after.items.length).toBe(before.items.length - 1)
  })
})

describe('cloisonnement', () => {
  it('ne montre pas la bibliothèque d’un créateur à son voisin', async () => {
    const theirs = await listMedias(otherId, otherProjectId)
    expect(theirs.items).toEqual([])
  })

  it('refuse de supprimer l’image d’un autre', async () => {
    const mine = await listMedias(userId, projectId)
    await expect(removeMedia(otherId, mine.items[0]!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('ne sert pas une image depuis un projet auquel elle n’appartient pas', async () => {
    const mine = await listMedias(userId, projectId)
    const id = mine.items[0]!.id
    expect(await readMedia(projectId, id, 'full')).not.toBeNull()
    // Une spécification qui pointerait vers l'image d'un autre projet ne renvoie rien.
    expect(await readMedia(otherProjectId, id, 'full')).toBeNull()
  })

  it('sert la vignette et l’originale, la première étant plus légère', async () => {
    const mine = await listMedias(userId, projectId)
    const id = mine.items[0]!.id
    const full = await readMedia(projectId, id, 'full')
    const thumb = await readMedia(projectId, id, 'thumb')
    expect(full?.mime).toBe('image/webp')
    expect(thumb!.bytes.length).toBeLessThan(full!.bytes.length)
  })
})

/**
 * Les images jointes à une demande faite à l'assistant.
 *
 * Le navigateur annonce des identifiants ; il ne décide de rien. Sans la relecture faite
 * ici, joindre l'identifiant de l'image d'un autre projet — ou celle d'un autre créateur —
 * suffirait à la faire apparaître dans ses propres pages. C'est la seule chose que ce
 * mécanisme peut casser, et c'est donc la seule qu'on vérifie vraiment.
 */
describe('images jointes à une demande', () => {
  it('ne retient que les images de ce créateur et de ce projet', async () => {
    const mienne = await addMedia(userId, projectId, { name: 'atelier.png', bytes: await image() })
    const ailleurs = await addMedia(otherId, otherProjectId, {
      name: 'voisin.png',
      bytes: await image(),
    })

    const retenues = await resolveAttachments(userId, projectId, [mienne.id, ailleurs.id])
    expect(retenues.map((item) => item.id)).toEqual([mienne.id])

    // Et depuis le projet du voisin, la mienne ne remonte pas davantage.
    expect(await resolveAttachments(otherId, otherProjectId, [mienne.id])).toEqual([])
  })

  it('écarte les photos reçues des visiteurs', async () => {
    const photo = await addVisitorPhoto({
      ownerId: userId,
      projectId,
      name: 'client.png',
      bytes: await image(),
    })
    // Elles appartiennent à une fiche, pas à la décoration : les placer dans un bandeau
    // publierait la photo d'un client.
    expect(await resolveAttachments(userId, projectId, [photo.id])).toEqual([])
  })

  it('garde l’ordre du créateur, sans doublon ni débordement', async () => {
    const images = []
    for (let index = 0; index < MAX_ATTACHMENTS + 2; index += 1) {
      images.push(await addMedia(userId, projectId, { name: `p${index}.png`, bytes: await image() }))
    }
    const demandes = [...images.map((item) => item.id), images[0]!.id]
    const retenues = await resolveAttachments(userId, projectId, demandes)

    expect(retenues).toHaveLength(MAX_ATTACHMENTS)
    // L'ordre compte : c'est celui dans lequel il les a jointes, et il le dit dans sa
    // demande — « la première en haut, la seconde en bas ».
    expect(retenues.map((item) => item.id)).toEqual(
      images.slice(0, MAX_ATTACHMENTS).map((item) => item.id),
    )
  })
})
