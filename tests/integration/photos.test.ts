import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { prisma } from '@/server/db/client'
import { withRuntimeScope, withUserScope } from '@/server/db/scope'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { applyManualPatch, createProject, getProject } from '@/server/projects/service'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import { createRecord, deleteRecord, updateRecord } from '@/server/runtime/records'
import { addVisitorPhoto, listMedias, sweepOrphanPhotos } from '@/server/media/service'
import { parseAppSpec } from '@/server/spec/validate'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import type { AppSpec } from '@/server/spec/schema'

/**
 * Photos envoyées par les visiteurs.
 *
 * Quatre propriétés méritent une vraie base plutôt qu'un test unitaire, parce que chacune
 * est portée par la base et non par le code.
 *
 * **Une photo appartient à sa fiche**, et disparaît avec elle : c'est la clé étrangère qui
 * s'en charge, donc c'est la base qu'il faut interroger pour le savoir.
 *
 * **On ne prend pas la photo d'autrui.** Recopier l'identifiant de la photo d'une autre
 * fiche dans son propre formulaire ne doit rien donner — sans quoi il suffirait de
 * supprimer sa fiche pour effacer l'image de quelqu'un d'autre.
 *
 * **Ce qui n'est plus désigné est repris.** Un formulaire abandonné, une photo remplacée :
 * sans ce ménage, le quota du créateur se remplirait d'images que plus rien n'affiche.
 *
 * **La bibliothèque du créateur n'est pas une boîte de réception.** Les photos reçues
 * pèsent dans son quota, mais ne se mêlent pas à ses illustrations.
 */

let userId: string
let email: string
let projectId: string
let spec: AppSpec
let modelId: string

async function image(width = 400, height = 300): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 90 } },
  })
    .png()
    .toBuffer()
  return new Uint8Array(buffer)
}

/** Une photo envoyée, comme le ferait un visiteur : elle n'est encore rattachée à rien. */
async function envoyer(): Promise<string> {
  const photo = await addVisitorPhoto({
    ownerId: userId,
    projectId,
    name: 'chantier.png',
    bytes: await image(),
  })
  return photo.id
}

/** Un visiteur connecté : seul celui qui a saisi une fiche peut la corriger ou l'effacer. */
async function creerVisiteur(): Promise<string> {
  const visiteur = await withRuntimeScope(projectId, (tx) =>
    tx.appEndUser.create({
      data: { projectId, email: `${randomUUID()}@exemple.test`, passwordHash: 'scrypt$x' },
    }),
  )
  return visiteur.id
}

/** Une saisie complète du modèle, avec la photo donnée. */
function saisie(photoId: string | ''): Record<string, unknown> {
  const model = spec.dataModels.find((candidate) => candidate.id === modelId)!
  const input: Record<string, unknown> = {}
  for (const field of model.fields) {
    if (field.type === 'computed') continue
    input[field.id] =
      field.type === 'photo'
        ? photoId
        : field.type === 'number'
          ? 2
          : field.type === 'boolean'
            ? false
            : field.type === 'date'
              ? '2026-05-05'
              : field.type === 'select'
                ? field.options?.[0]
                : field.type === 'email'
                  ? 'client@exemple.test'
                  : field.type === 'url'
                    ? 'https://exemple.test'
                    : field.type === 'reference'
                      ? undefined
                      : 'Valeur'
  }
  return input
}

beforeAll(async () => {
  clearAll()
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: {},
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  email = `photos-${Date.now()}@exemple.test`
  userId = (
    await register({ email, password: 'motdepasse-2026-solide', locale: 'fr' }, { ip: randomUUID() })
  ).userId
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId: 'builder', status: 'ACTIVE' },
    update: { planId: 'builder', status: 'ACTIVE' },
  })

  const idea = 'Un annuaire d’artisans avec photos de chantier'
  const project = await createProject(userId, { idea, locale: 'fr', blueprint: heuristicBlueprint(idea) })
  projectId = project.projectId

  const courant = await getProject(userId, projectId)
  modelId = courant.spec.dataModels[0]!.id
  await applyManualPatch(userId, projectId, {
    summary: 'Photo de chantier',
    operations: [
      { op: 'set', path: 'dataModels[0].scope', value: 'shared' },
      {
        op: 'append',
        path: 'dataModels[0].fields',
        value: { id: 'photo', label: 'Photo du chantier', type: 'photo', required: false },
      },
    ],
  })
  spec = parseAppSpec((await getProject(userId, projectId)).spec)
}, 60_000)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email } })
})

describe('une photo attachée à sa fiche', () => {
  it('reste rattachée après enregistrement, et disparaît avec la fiche', async () => {
    const visiteur = await creerVisiteur()
    const photoId = await envoyer()
    const record = await createRecord({
      projectId,
      spec,
      modelId,
      endUserId: visiteur,
      input: saisie(photoId),
    })
    expect(record.data.photo).toBe(photoId)

    const attachee = await withUserScope(userId, (tx) =>
      tx.mediaAsset.findUnique({ where: { id: photoId }, select: { recordId: true, origin: true } }),
    )
    expect(attachee).toEqual({ recordId: record.id, origin: 'visitor' })

    await deleteRecord({ projectId, spec, modelId, recordId: record.id, endUserId: visiteur })

    // La suppression est portée par la base, pas par le code : c'est elle qu'on interroge.
    const restante = await withUserScope(userId, (tx) =>
      tx.mediaAsset.count({ where: { id: photoId } }),
    )
    expect(restante).toBe(0)
  })

  it('libère celle qu’une correction remplace', async () => {
    const visiteur = await creerVisiteur()
    const premiere = await envoyer()
    const record = await createRecord({
      projectId,
      spec,
      modelId,
      endUserId: visiteur,
      input: saisie(premiere),
    })

    const seconde = await envoyer()
    await updateRecord({
      projectId,
      spec,
      modelId,
      recordId: record.id,
      endUserId: visiteur,
      input: saisie(seconde),
    })

    const etats = await withUserScope(userId, (tx) =>
      tx.mediaAsset.findMany({
        where: { id: { in: [premiere, seconde] } },
        select: { id: true, recordId: true },
      }),
    )
    expect(etats.find((ligne) => ligne.id === premiere)?.recordId).toBeNull()
    expect(etats.find((ligne) => ligne.id === seconde)?.recordId).toBe(record.id)
  })
})

describe('ce qu’une fiche ne peut pas désigner', () => {
  it('refuse une photo qui n’existe pas', async () => {
    await expect(
      createRecord({
        projectId,
        spec,
        modelId,
        endUserId: null,
        input: saisie('11111111-2222-3333-4444-555555555555'),
      }),
    ).rejects.toThrow(/photo/i)
  })

  it('refuse la photo déjà attachée à une autre fiche', async () => {
    const photoId = await envoyer()
    const premiere = await createRecord({
      projectId,
      spec,
      modelId,
      endUserId: null,
      input: saisie(photoId),
    })

    await expect(
      createRecord({ projectId, spec, modelId, endUserId: null, input: saisie(photoId) }),
    ).rejects.toThrow(/photo/i)

    // Et la première fiche la garde : la tentative n'a rien déplacé.
    const attachee = await withUserScope(userId, (tx) =>
      tx.mediaAsset.findUnique({ where: { id: photoId }, select: { recordId: true } }),
    )
    expect(attachee?.recordId).toBe(premiere.id)
  })

  it('ne lit jamais la photo d’un autre projet depuis la portée de celui-ci', async () => {
    const photoId = await envoyer()
    const ailleurs = await withRuntimeScope(
      '00000000-0000-4000-8000-000000000000',
      (tx) => tx.mediaAsset.count({ where: { id: photoId } }),
    )
    expect(ailleurs).toBe(0)
  })
})

describe('le ménage des photos sans fiche', () => {
  it('reprend celle qu’aucune fiche ne réclame depuis plus d’une heure', async () => {
    const abandonnee = await envoyer()
    const recente = await envoyer()

    // On vieillit la première : on ne va pas attendre une heure pour le savoir.
    await withUserScope(userId, (tx) =>
      tx.mediaAsset.update({
        where: { id: abandonnee },
        data: { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      }),
    )

    const reprises = await sweepOrphanPhotos(userId, projectId)
    expect(reprises).toBeGreaterThanOrEqual(1)

    const restantes = await withUserScope(userId, (tx) =>
      tx.mediaAsset.findMany({
        where: { id: { in: [abandonnee, recente] } },
        select: { id: true },
      }),
    )
    expect(restantes.map((ligne) => ligne.id)).toEqual([recente])
  })
})

describe('la bibliothèque du créateur', () => {
  it('ne mêle pas les photos reçues à ses images, mais en annonce le poids', async () => {
    const photoId = await envoyer()
    await createRecord({ projectId, spec, modelId, endUserId: null, input: saisie(photoId) })

    const library = await listMedias(userId, projectId)
    expect(library.items.map((item) => item.id)).not.toContain(photoId)
    expect(library.visitorBytes).toBeGreaterThan(0)
    // Ce que le créateur voit dans sa grille ne suffit pas à expliquer son compteur : c'est
    // précisément ce que la ligne « dont … de photos » vient dire.
    expect(library.usedBytes).toBeGreaterThanOrEqual(library.visitorBytes)
  })
})
