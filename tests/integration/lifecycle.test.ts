import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { clearAll } from '@/server/auth/rate-limit'
import { register } from '@/server/auth/service'
import { DEFAULT_PLANS } from '@/server/billing/plans'
import { getWallet } from '@/server/billing/credits'
import { heuristicBlueprint } from '@/server/projects/blueprints'
import {
  applyManualPatch,
  createProject,
  getProject,
  listVersions,
  publishProject,
  restoreVersion,
  runProjectChecks,
} from '@/server/projects/service'
import { getPublishedApp } from '@/server/runtime/published'
import { createRecord, listRecords, updateRecord } from '@/server/runtime/records'
import { withRuntimeScope } from '@/server/db/scope'
import { AppError } from '@/lib/errors'
import type { DataField } from '@/server/spec/schema'
import { ensureTestPlan, TEST_PLAN_CREDITS, testPlanId } from '../helpers/plan'

/** Parcours complet du MVP : créer, modifier, versionner, tester, publier, utiliser. */

/** Valeur valide pour chaque type de champ, quel que soit le modèle de données. */
function sampleInput(model: { fields: readonly DataField[] }): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const field of model.fields) {
    switch (field.type) {
      case 'number':
        input[field.id] = 3
        break
      case 'boolean':
        input[field.id] = true
        break
      case 'date':
        input[field.id] = '2026-03-03'
        break
      case 'select':
        input[field.id] = field.options?.[0]
        break
      case 'email':
        input[field.id] = 'client@exemple.test'
        break
      case 'url':
        input[field.id] = 'https://exemple.test'
        break
      case 'text':
      case 'longText':
        input[field.id] = 'Valeur de test'
        break
    }
  }
  return input
}

let userId: string
let projectId: string

/**
 * Abonne l'utilisateur à une offre qui autorise la construction.
 * L'offre de découverte s'arrête volontairement avant : sans cet abonnement, créer un
 * projet est refusé, ce qui est le comportement voulu du produit.
 */
async function subscribeToBuildPlan(userId: string, planId = testPlanId()): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, planId, status: 'ACTIVE' },
    update: { planId, status: 'ACTIVE' },
  })
}

beforeAll(async () => {
  for (const plan of DEFAULT_PLANS) {
    await prisma.plan.upsert({
      where: { id: plan.id },
      update: { maxProjects: plan.maxProjects, monthlyCredits: plan.monthlyCredits },
      create: { ...plan, features: [...plan.features], currency: 'EUR', interval: 'month' },
    })
  }
  // L'offre technique des tests : elle ouvre tout, et ne dépend d'aucune décision commerciale.
  await ensureTestPlan()
  clearAll()
  const account = await register(
    { email: `${randomUUID()}@exemple.test`, password: 'motdepasse-42', locale: 'fr' },
    { ip: randomUUID() },
  )
  userId = account.userId
  await subscribeToBuildPlan(userId)
  const idea = 'Une application de réservation de créneaux pour un salon de coiffure'
  const created = await createProject(userId, {
    idea,
    locale: 'fr',
    blueprint: heuristicBlueprint(idea),
  })
  projectId = created.projectId
}, 60_000)

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  await prisma.$disconnect()
})

describe('cycle de vie d’un projet', () => {
  it('crée une première version immuable', async () => {
    const versions = await listVersions(userId, projectId)
    expect(versions).toHaveLength(1)
    expect(versions[0]?.number).toBe(1)
    expect(versions[0]?.isCurrent).toBe(true)
  })

  it('applique une modification sans IA et crée une version', async () => {
    const before = await getProject(userId, projectId)
    const { spec, versionNumber } = await applyManualPatch(userId, projectId, {
      summary: 'Couleur principale en bleu',
      operations: [{ op: 'set', path: 'theme.colors.primary', value: '#1D4ED8' }],
    })
    expect(spec.theme.colors.primary).toBe('#1D4ED8')
    expect(versionNumber).toBe(2)
    expect(before.spec.theme.colors.primary).not.toBe('#1D4ED8')
  })

  it('restaure une version antérieure sans réécrire l’historique', async () => {
    const versions = await listVersions(userId, projectId)
    const first = versions.find((version) => version.number === 1)
    expect(first).toBeDefined()

    const restored = await restoreVersion(userId, projectId, first!.id)
    expect(restored.versionNumber).toBe(3)

    const after = await listVersions(userId, projectId)
    expect(after).toHaveLength(3)
    expect(after.find((version) => version.number === 2)).toBeDefined()
  })

  it('produit un rapport de test chiffré', async () => {
    const report = await runProjectChecks(userId, projectId)
    expect(report.score).toBeGreaterThan(0)
    expect(report.results.length).toBeGreaterThan(5)
    expect(report.counts.ok + report.counts.warn + report.counts.error).toBe(report.results.length)
  })

  it('publie et sert la version publiée', async () => {
    const published = await publishProject(userId, projectId)
    const { slug } = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { slug: true },
    })
    expect(published.url).toContain(slug)
    const app = await getPublishedApp(slug)
    expect(app.projectId).toBe(projectId)
    expect(app.spec.pages.length).toBeGreaterThan(0)
  })

  it('ne publie pas une application comportant une erreur bloquante', async () => {
    await applyManualPatch(userId, projectId, {
      summary: 'Contraste cassé',
      operations: [
        { op: 'set', path: 'theme.colors.text', value: '#FAFAFA' },
        { op: 'set', path: 'theme.colors.background', value: '#FFFFFF' },
      ],
    })
    await expect(publishProject(userId, projectId)).rejects.toThrow(AppError)

    // Réparation, puis la publication repasse.
    await applyManualPatch(userId, projectId, {
      summary: 'Contraste rétabli',
      operations: [{ op: 'set', path: 'theme.colors.text', value: '#0F172A' }],
    })
    await expect(publishProject(userId, projectId)).resolves.toBeTruthy()
  })
})

/** Un visiteur identifié de l'application de test. */
async function creerVisiteur() {
  return withRuntimeScope(projectId, (tx) =>
    tx.appEndUser.create({
      data: { projectId, email: `${randomUUID()}@exemple.test`, passwordHash: 'scrypt$x' },
    }),
  )
}

describe('données d’une application publiée', () => {
  it('valide les saisies contre le modèle déclaré', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels[0]!

    await expect(
      createRecord({
        projectId,
        spec: project.spec,
        modelId: model.id,
        endUserId: null,
        input: {},
      }),
    ).rejects.toThrow(AppError)
  })

  it('écarte les champs inconnus envoyés par le navigateur', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.scope === 'shared')
    if (model === undefined) return

    const input = { ...sampleInput(model), champInconnu: 'valeur pirate' }

    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
      input,
    })
    expect(Object.keys(record.data)).not.toContain('champInconnu')
  })

  it('cloisonne les données privées par utilisateur final', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.scope === 'user')
    if (model === undefined) return

    const endUser = await withRuntimeScope(projectId, (tx) =>
      tx.appEndUser.create({
        data: { projectId, email: `${randomUUID()}@exemple.test`, passwordHash: 'scrypt$x' },
      }),
    )

    const input = sampleInput(model)
    await createRecord({ projectId, spec: project.spec, modelId: model.id, endUserId: endUser.id, input })

    const mine = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: endUser.id,
    })
    expect(mine.items.length).toBe(1)

    // Un visiteur non connecté ne voit rien d'un modèle privé.
    const anonymous = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
    })
    expect(anonymous.items).toEqual([])
    expect(anonymous.total).toBe(0)
  })

  /*
   * Relier deux modèles, et totaliser.
   *
   * La spécification est construite ici plutôt que publiée : les fonctions de données la
   * reçoivent en argument, et c'est elle qui fait autorité sur la forme des données.
   */
  it('relie une fiche à une autre et refuse un renvoi qui pointe dans le vide', async () => {
    const project = await getProject(userId, projectId)
    const clients = {
      id: 'client',
      label: 'Client',
      labelPlural: 'Clients',
      scope: 'shared' as const,
      labelField: 'nom',
      fields: [
        { id: 'nom', label: 'Nom', type: 'text' as const, required: true },
        { id: 'ville', label: 'Ville', type: 'text' as const, required: false },
      ],
    }
    const devis = {
      id: 'devis',
      label: 'Devis',
      labelPlural: 'Devis',
      scope: 'shared' as const,
      fields: [
        { id: 'objet', label: 'Objet', type: 'text' as const, required: true },
        { id: 'montant', label: 'Montant', type: 'number' as const, required: true },
        {
          id: 'client',
          label: 'Client',
          type: 'reference' as const,
          required: true,
          referenceModelId: 'client',
        },
      ],
    }
    const spec = { ...project.spec, dataModels: [...project.spec.dataModels, clients, devis] }

    const client = await createRecord({
      projectId,
      spec,
      modelId: 'client',
      endUserId: null,
      input: { nom: 'Boulangerie Durand', ville: 'Fribourg' },
    })

    // Un renvoi qui ne désigne rien est refusé à l'écriture, pas découvert à la lecture.
    await expect(
      createRecord({
        projectId,
        spec,
        modelId: 'devis',
        endUserId: null,
        input: { objet: 'Fantôme', montant: 10, client: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    // Un renvoi vers une fiche du mauvais modèle est refusé de la même façon.
    const autre = project.spec.dataModels[0]
    if (autre !== undefined) {
      const ailleurs = await createRecord({
        projectId,
        spec,
        modelId: autre.id,
        endUserId: null,
        input: sampleInput(autre),
      }).catch(() => null)
      if (ailleurs !== null) {
        await expect(
          createRecord({
            projectId,
            spec,
            modelId: 'devis',
            endUserId: null,
            input: { objet: 'Mauvais modèle', montant: 10, client: ailleurs.id },
          }),
        ).rejects.toMatchObject({ code: 'VALIDATION' })
      }
    }

    for (const [objet, montant] of [
      ['Vitrine', 1200],
      ['Devanture', 800.5],
      ['Enseigne', 400],
    ] as const) {
      await createRecord({
        projectId,
        spec,
        modelId: 'devis',
        endUserId: null,
        input: { objet, montant, client: client.id },
      })
    }

    // La liste rend le nom de la fiche visée, jamais son identifiant.
    const page = await listRecords({ projectId, spec, modelId: 'devis', endUserId: null })
    expect(page.total).toBe(3)
    expect(page.references[client.id]).toBe('Boulangerie Durand')

    // Le total porte sur l'ensemble, et il suit le filtre plutôt que la page affichée.
    const somme = await listRecords({
      projectId,
      spec,
      modelId: 'devis',
      endUserId: null,
      query: { sumField: 'montant', limit: 1 },
    })
    expect(somme.items.length).toBe(1)
    expect(somme.aggregate).toMatchObject({ field: 'montant', kind: 'somme', value: 2400.5 })

    const moyenne = await listRecords({
      projectId,
      spec,
      modelId: 'devis',
      endUserId: null,
      query: { sumField: 'montant', sumKind: 'moyenne' },
    })
    expect(moyenne.aggregate?.value).toBe(800.17)

    const restreint = await listRecords({
      projectId,
      spec,
      modelId: 'devis',
      endUserId: null,
      query: { search: 'Enseigne', sumField: 'montant' },
    })
    expect(restreint.aggregate?.value).toBe(400)

    // On ne totalise pas ce qui n'est pas un nombre : le réglage est ignoré, sans erreur.
    const texte = await listRecords({
      projectId,
      spec,
      modelId: 'devis',
      endUserId: null,
      query: { sumField: 'objet' },
    })
    expect(texte.aggregate).toBeNull()
  })

  /*
   * Chercher, filtrer, trier, paginer. Tout se passe dans la base : une recherche qui ne
   * regarderait que la page déjà chargée donnerait l'illusion de chercher.
   */
  it('cherche, filtre, trie et pagine dans l’ensemble des fiches', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.scope === 'shared')
    if (model === undefined) return
    const champTexte = model.fields.find((field) => field.type === 'text')
    if (champTexte === undefined) return
    const champChoix = model.fields.find((field) => field.type === 'select')

    // On repart d'un modèle vide pour que les totaux soient ceux qu'on a écrits.
    await withRuntimeScope(projectId, (tx) =>
      tx.appRecord.deleteMany({ where: { projectId, modelId: model.id } }),
    )

    const noms = ['Alpha', 'Bravo', 'Charlie', 'delta', 'Écho', 'Remise 50% été']
    for (const nom of noms) {
      await createRecord({
        projectId,
        spec: project.spec,
        modelId: model.id,
        endUserId: null,
        input: { ...sampleInput(model), [champTexte.id]: nom },
      })
    }

    const tout = await listRecords({ projectId, spec: project.spec, modelId: model.id, endUserId: null })
    expect(tout.total).toBe(noms.length)

    // La recherche ignore la casse et les accents ne sont pas requis pour le reste du mot.
    const cherche = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
      query: { search: 'DELT' },
    })
    expect(cherche.total).toBe(1)
    expect(cherche.items[0]?.data[champTexte.id]).toBe('delta')

    // Un pour-cent est cherché comme un caractère, pas comme un joker : sans quoi cette
    // recherche ramènerait les six fiches.
    const joker = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
      query: { search: '%' },
    })
    expect(joker.total).toBe(1)

    // Ordre alphabétique, sur l'ensemble et non sur la page.
    const az = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
      query: { sort: 'az', limit: 3 },
    })
    expect(az.total).toBe(noms.length)
    expect(az.items.map((item) => item.data[champTexte.id])).toEqual(['Alpha', 'Bravo', 'Charlie'])

    // L'ordre porte sur le champ demandé, celui que la liste affiche en titre. Trier sur un
    // champ invisible donnerait un ordre que personne ne peut lire.
    if (champChoix !== undefined) {
      const parChoix = await listRecords({
        projectId,
        spec: project.spec,
        modelId: model.id,
        endUserId: null,
        query: { sort: 'az', sortField: champChoix.id },
      })
      const valeurs = parChoix.items.map((item) => String(item.data[champChoix.id] ?? ''))
      expect([...valeurs].sort()).toEqual(valeurs)
    }

    // La page suivante continue le même ordre.
    const suite = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
      query: { sort: 'az', limit: 3, offset: 3 },
    })
    expect(suite.items.length).toBe(3)
    expect(suite.items.map((item) => item.data[champTexte.id])).not.toContain('Alpha')

    // Un filtre ne s'applique que sur un champ à choix. Sur un champ texte, il est ignoré.
    const filtreTexte = await listRecords({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: null,
      query: { filterField: champTexte.id, filterValue: 'Alpha' },
    })
    expect(filtreTexte.total).toBe(noms.length)

    if (champChoix !== undefined) {
      const valeur = champChoix.options?.[0]
      const filtre = await listRecords({
        projectId,
        spec: project.spec,
        modelId: model.id,
        endUserId: null,
        query: { filterField: champChoix.id, filterValue: valeur },
      })
      // Toutes les fiches ont été créées avec la même valeur de choix.
      expect(filtre.total).toBe(noms.length)

      const absent = await listRecords({
        projectId,
        spec: project.spec,
        modelId: model.id,
        endUserId: null,
        query: { filterField: champChoix.id, filterValue: 'valeur-qui-n-existe-pas' },
      })
      expect(absent.total).toBe(0)
    }
  })

  /*
   * Corriger une fiche. La règle est la même que pour la supprimer : celui qui a saisi une
   * donnée en dispose, personne d'autre. Ce sont ces refus qu'on vérifie ici, plus que le
   * cas qui marche.
   */
  it('laisse corriger sa propre fiche, et revalide la saisie', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.scope === 'user')
    if (model === undefined) return
    const champTexte = model.fields.find((field) => field.type === 'text')
    if (champTexte === undefined) return

    const endUser = await creerVisiteur()
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      endUserId: endUser.id,
      input: sampleInput(model),
    })

    const corrige = await updateRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      recordId: record.id,
      endUserId: endUser.id,
      input: { ...sampleInput(model), [champTexte.id]: 'Valeur corrigée' },
    })
    expect(corrige.data[champTexte.id]).toBe('Valeur corrigée')

    // La correction repasse par la même validation que la création.
    await expect(
      updateRecord({
        projectId,
        spec: project.spec,
        modelId: model.id,
        recordId: record.id,
        endUserId: endUser.id,
        input: {},
      }),
    ).rejects.toThrow(AppError)

    // Et un champ inconnu glissé dans la requête n'atteint jamais la base.
    const propre = await updateRecord({
      projectId,
      spec: project.spec,
      modelId: model.id,
      recordId: record.id,
      endUserId: endUser.id,
      input: { ...sampleInput(model), champInconnu: 'valeur pirate' },
    })
    expect(Object.keys(propre.data)).not.toContain('champInconnu')
  })

  it('refuse de laisser corriger la fiche d’un autre visiteur', async () => {
    const project = await getProject(userId, projectId)
    const prive = project.spec.dataModels.find((candidate) => candidate.scope === 'user')
    const partage = project.spec.dataModels.find((candidate) => candidate.scope === 'shared')

    if (prive !== undefined) {
      const auteur = await creerVisiteur()
      const autre = await creerVisiteur()
      const record = await createRecord({
        projectId,
        spec: project.spec,
        modelId: prive.id,
        endUserId: auteur.id,
        input: sampleInput(prive),
      })
      // Sur un modèle privé, l'élément d'autrui est déclaré introuvable : répondre
      // « interdit » révélerait son existence.
      await expect(
        updateRecord({
          projectId,
          spec: project.spec,
          modelId: prive.id,
          recordId: record.id,
          endUserId: autre.id,
          input: sampleInput(prive),
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }

    if (partage !== undefined) {
      const auteur = await creerVisiteur()
      const autre = await creerVisiteur()
      const record = await createRecord({
        projectId,
        spec: project.spec,
        modelId: partage.id,
        endUserId: auteur.id,
        input: sampleInput(partage),
      })
      // Sur un modèle partagé, tout le monde voit déjà l'élément : on peut dire la raison.
      await expect(
        updateRecord({
          projectId,
          spec: project.spec,
          modelId: partage.id,
          recordId: record.id,
          endUserId: autre.id,
          input: sampleInput(partage),
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    }
  })
})

/**
 * Une liste de choix qui accepte l'imprévu.
 *
 * Le besoin vient du terrain : un annuaire d'artisans qui propose cinq métiers rencontrera
 * un carreleur. Ce qui se vérifie ici, c'est que la sortie de secours n'ouvre pas la porte
 * à n'importe quoi — elle reste fermée tant que le champ ne l'autorise pas — et qu'une
 * valeur saisie à la main reste retrouvable par le filtre.
 */
describe('valeur hors liste sur un champ à choix', () => {
  let modelId: string
  let champ: string

  beforeAll(async () => {
    const project = await getProject(userId, projectId)
    const modele = project.spec.dataModels[0]
    if (modele === undefined) throw new Error('aucun modèle de données dans le projet')
    modelId = modele.id
    const index = 0

    // On ajoute un champ à choix qui autorise l'imprévu, comme le ferait l'agent. Le
    // modèle est rendu partagé au passage : un annuaire se lit sans compte.
    champ = 'metier'
    await applyManualPatch(userId, projectId, {
      summary: 'Champ métier avec saisie libre',
      operations: [
        { op: 'set', path: `dataModels[${index}].scope`, value: 'shared' },
        {
          op: 'append',
          path: `dataModels[${index}].fields`,
          value: {
            id: champ,
            label: 'Métier',
            type: 'select',
            required: false,
            options: ['macon', 'electricien', 'plombier'],
            allowOther: true,
          },
        },
      ],
    })
  }, 30_000)

  it('accepte une valeur déclarée', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    const saisie = { ...sampleInput(model), [champ]: 'plombier' }
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      input: saisie,
    })
    expect((record.data as Record<string, unknown>)[champ]).toBe('plombier')
  })

  it('accepte une valeur hors liste, et la conserve telle quelle', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    const saisie = { ...sampleInput(model), [champ]: '  Carreleur  ' }
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      input: saisie,
    })
    // Les espaces de bord sont retirés, le reste est l'écriture du visiteur.
    expect((record.data as Record<string, unknown>)[champ]).toBe('Carreleur')
  })

  it('refuse une valeur vide ou démesurée, même quand la saisie libre est ouverte', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    for (const mauvaise of ['   ', 'x'.repeat(200)]) {
      const saisie = { ...sampleInput(model), [champ]: mauvaise }
      await expect(
        createRecord({ projectId, spec: project.spec, modelId, endUserId: null, input: saisie }),
      ).rejects.toMatchObject({ code: 'VALIDATION' })
    }
  })

  it('propose au filtre les valeurs saisies à la main', async () => {
    const project = await getProject(userId, projectId)
    const page = await listRecords({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      query: { filterField: champ },
    })
    expect(page.filterValues).toContain('Carreleur')
    // Les choix déclarés ne sont pas répétés : le navigateur les connaît déjà.
    expect(page.filterValues).not.toContain('plombier')
  })

  it('retrouve une fiche par sa valeur libre', async () => {
    const project = await getProject(userId, projectId)
    const page = await listRecords({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      query: { filterField: champ, filterValue: 'Carreleur' },
    })
    expect(page.total).toBeGreaterThan(0)
    for (const item of page.items) {
      expect((item.data as Record<string, unknown>)[champ]).toBe('Carreleur')
    }
  })

  it('reste fermée quand le champ ne l’autorise pas', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    const ferme = { ...model, fields: model.fields.map((f) => (f.id === champ ? { ...f, allowOther: false } : f)) }
    const spec = {
      ...project.spec,
      dataModels: project.spec.dataModels.map((m) => (m.id === modelId ? ferme : m)),
    }
    const saisie = { ...sampleInput(model), [champ]: 'Carreleur' }
    await expect(
      createRecord({ projectId, spec, modelId, endUserId: null, input: saisie }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('crédits', () => {
  it('n’est pas débité par les opérations sans IA', async () => {
    const wallet = await getWallet(userId)
    // Tout le parcours ci-dessus s'est fait sans appel au copilote : rien n'est débité.
    expect(wallet.balance).toBe(TEST_PLAN_CREDITS)
  })

  it('donne accès aux crédits de la nouvelle offre dès le changement', async () => {
    /*
     * Les montants sont lus dans le catalogue, jamais recopiés : ce qui est vérifié est que
     * le changement d'offre prend effet tout de suite, pas qu'une offre vaut tel chiffre —
     * lequel se décide au back-office et change sans prévenir.
     */
    const petite = DEFAULT_PLANS.find((candidate) => candidate.id === 'vis-starter')!
    const grande = DEFAULT_PLANS.find((candidate) => candidate.id === 'vis-business')!

    await subscribeToBuildPlan(userId, petite.id)
    const downgraded = await getWallet(userId)
    expect(downgraded.monthlyGrant).toBe(petite.monthlyCredits)

    await subscribeToBuildPlan(userId, grande.id)
    const upgraded = await getWallet(userId)
    expect(upgraded.monthlyGrant).toBe(grande.monthlyCredits)
    /*
     * Au moins, et non exactement : un solde plus élevé que la nouvelle réserve n'est pas
     * rogné. Ce qui est déjà acquis reste acquis, et c'est ce qu'attend quiconque change
     * d'offre en cours de mois.
     */
    expect(upgraded.balance).toBeGreaterThanOrEqual(grande.monthlyCredits)
  })
})

/**
 * Les champs calculés, sur une vraie base.
 *
 * Trois propriétés valent d'être vérifiées ici plutôt qu'en unité : la valeur n'est pas
 * enregistrée — corriger un prix corrige le total —, elle ne peut pas être imposée par le
 * navigateur, et la somme d'un champ calculé est bien faite par la base sur l'ensemble des
 * fiches, pas sur la page affichée.
 */
describe('champs calculés', () => {
  let modelId: string

  beforeAll(async () => {
    const project = await getProject(userId, projectId)
    const modele = project.spec.dataModels[0]!
    modelId = modele.id

    await applyManualPatch(userId, projectId, {
      summary: 'Total calculé',
      operations: [
        { op: 'set', path: 'dataModels[0].scope', value: 'shared' },
        {
          op: 'append',
          path: 'dataModels[0].fields',
          value: { id: 'prix', label: 'Prix', type: 'number', required: false },
        },
        {
          op: 'append',
          path: 'dataModels[0].fields',
          value: { id: 'quantite', label: 'Quantité', type: 'number', required: false },
        },
        {
          op: 'append',
          path: 'dataModels[0].fields',
          value: {
            id: 'total',
            label: 'Total',
            type: 'computed',
            required: false,
            formula: 'prix * quantite',
            unit: '€',
          },
        },
      ],
    })
  }, 30_000)

  it('calcule à la lecture, sans rien enregistrer', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      input: { ...sampleInput(model), prix: 12.5, quantite: 4 },
    })

    expect((record.data as Record<string, unknown>).total).toBe(50)
    // Rien n'est écrit en base : la colonne n'existe que le temps de la lecture.
    const brut = await withRuntimeScope(projectId, (tx) =>
      tx.appRecord.findUniqueOrThrow({ where: { id: record.id }, select: { data: true } }),
    )
    expect((brut.data as Record<string, unknown>).total).toBeNull()
  })

  it('suit la correction d’un prix, sans qu’on ait à recalculer', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    // Corriger demande d'être celui qui a saisi : la fiche est donc créée par un visiteur.
    const visiteur = await creerVisiteur()
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: visiteur.id,
      input: { ...sampleInput(model), prix: 10, quantite: 2 },
    })

    const corrige = await updateRecord({
      projectId,
      spec: project.spec,
      modelId,
      recordId: record.id,
      endUserId: visiteur.id,
      input: { ...sampleInput(model), prix: 30, quantite: 2 },
    })
    expect((corrige.data as Record<string, unknown>).total).toBe(60)
  })

  it('ignore un total imposé par le navigateur', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      input: { ...sampleInput(model), prix: 10, quantite: 3, total: 999_999 },
    })
    expect((record.data as Record<string, unknown>).total).toBe(30)
  })

  it('totalise un champ calculé sur l’ensemble des fiches, pas sur la page', async () => {
    const project = await getProject(userId, projectId)
    const page = await listRecords({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      query: { sumField: 'total', sumKind: 'somme', limit: 1 },
    })
    // Une seule fiche est rendue, mais le total porte sur toutes les fiches chiffrées.
    expect(page.items).toHaveLength(1)
    expect(page.aggregate?.value).toBe(140)
  })

  it('n’affiche rien plutôt que zéro quand une donnée manque', async () => {
    const project = await getProject(userId, projectId)
    const model = project.spec.dataModels.find((candidate) => candidate.id === modelId)!
    const record = await createRecord({
      projectId,
      spec: project.spec,
      modelId,
      endUserId: null,
      // La quantité manque : le total ne peut pas être connu.
      input: { ...sampleInput(model), prix: 10, quantite: null },
    })
    expect((record.data as Record<string, unknown>).total).toBeNull()
  })

  it('refuse à la publication une formule qui vise un champ inexistant', async () => {
    await expect(
      applyManualPatch(userId, projectId, {
        summary: 'Formule fausse',
        operations: [
          { op: 'set', path: 'dataModels[0].fields[-1]', value: null },
          {
            op: 'append',
            path: 'dataModels[0].fields',
            value: {
              id: 'faux',
              label: 'Faux',
              type: 'computed',
              required: false,
              formula: 'prix * inconnu',
            },
          },
        ],
      }),
    ).rejects.toThrow(AppError)
  })
})
