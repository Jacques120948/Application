import type { Prisma } from '@prisma/client'
import { notFound, validation } from '@/lib/errors'
import { withOwnerRuntimeScope, withRuntimeScope } from '@/server/db/scope'
import type { AppSpec, DataField, DataModel } from '@/server/spec/schema'

/**
 * Données des applications générées.
 *
 * Le navigateur ne décide jamais de la forme des données. Le serveur relit le modèle
 * déclaré dans l'AppSpec **publiée** et rejette tout champ inconnu, tout type incorrect,
 * toute valeur hors bornes. C'est la seule source de vérité sur la validation.
 */

const MAX_TEXT = 200
const MAX_LONG_TEXT = 5_000
const MAX_RECORDS_PER_MODEL = 2_000

export type RecordValue = string | number | boolean | null
export type RecordData = Record<string, RecordValue>

function findModel(spec: AppSpec, modelId: string): DataModel {
  const model = spec.dataModels.find((candidate) => candidate.id === modelId)
  if (!model) throw notFound('Ces données n’existent pas dans cette application.')
  return model
}

function validateField(field: DataField, raw: unknown): RecordValue {
  const missing = raw === undefined || raw === null || raw === ''
  if (missing) {
    if (field.required) throw validation(`Le champ « ${field.label} » est obligatoire.`)
    return null
  }

  switch (field.type) {
    case 'text':
    case 'longText': {
      if (typeof raw !== 'string') throw validation(`Le champ « ${field.label} » doit être du texte.`)
      const limit = field.type === 'text' ? MAX_TEXT : MAX_LONG_TEXT
      if (raw.length > limit) throw validation(`Le champ « ${field.label} » est trop long.`)
      return raw
    }
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(value)) throw validation(`Le champ « ${field.label} » doit être un nombre.`)
      return value
    }
    case 'boolean':
      return raw === true || raw === 'true' || raw === 'on'
    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw validation(`Le champ « ${field.label} » doit être une date.`)
      }
      if (Number.isNaN(Date.parse(raw))) throw validation(`La date « ${field.label} » n'est pas valide.`)
      return raw
    }
    case 'email': {
      if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.length > MAX_TEXT) {
        throw validation(`Le champ « ${field.label} » doit être une adresse e-mail.`)
      }
      return raw.toLowerCase()
    }
    case 'url': {
      if (typeof raw !== 'string' || !/^https:\/\/\S+$/i.test(raw) || raw.length > 400) {
        throw validation(`Le champ « ${field.label} » doit être un lien commençant par https.`)
      }
      return raw
    }
    case 'select': {
      if (typeof raw !== 'string' || !(field.options ?? []).includes(raw)) {
        throw validation(`Le champ « ${field.label} » n'a pas une valeur attendue.`)
      }
      return raw
    }
  }
}

/** Valide une saisie complète contre un modèle. Les champs inconnus sont écartés. */
export function validateRecordData(model: DataModel, input: Record<string, unknown>): RecordData {
  const data: RecordData = {}
  for (const field of model.fields) {
    data[field.id] = validateField(field, input[field.id])
  }
  return data
}

export type StoredRecord = {
  id: string
  data: RecordData
  createdAt: Date
  isMine: boolean
}

export async function createRecord(params: {
  projectId: string
  spec: AppSpec
  modelId: string
  endUserId: string | null
  input: Record<string, unknown>
}): Promise<StoredRecord> {
  const model = findModel(params.spec, params.modelId)
  if (model.scope === 'user' && params.endUserId === null) {
    throw validation('Connectez-vous pour enregistrer vos données.')
  }
  const data = validateRecordData(model, params.input)

  return withRuntimeScope(params.projectId, async (tx) => {
    const count = await tx.appRecord.count({
      where: { projectId: params.projectId, modelId: params.modelId },
    })
    if (count >= MAX_RECORDS_PER_MODEL) {
      throw validation("Cette application a atteint sa limite d'enregistrements.")
    }
    const created = await tx.appRecord.create({
      data: {
        projectId: params.projectId,
        modelId: params.modelId,
        ownerEndUserId: params.endUserId,
        data: data as unknown as Prisma.InputJsonValue,
      },
    })
    return {
      id: created.id,
      data,
      createdAt: created.createdAt,
      isMine: params.endUserId !== null,
    }
  })
}

export async function listRecords(params: {
  projectId: string
  spec: AppSpec
  modelId: string
  endUserId: string | null
  limit?: number
}): Promise<StoredRecord[]> {
  const model = findModel(params.spec, params.modelId)
  const limit = Math.min(params.limit ?? 50, 100)

  if (model.scope === 'user' && params.endUserId === null) return []

  return withRuntimeScope(params.projectId, async (tx) => {
    const rows = await tx.appRecord.findMany({
      where: {
        projectId: params.projectId,
        modelId: params.modelId,
        ...(model.scope === 'user' ? { ownerEndUserId: params.endUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return rows.map((row) => ({
      id: row.id,
      data: row.data as RecordData,
      createdAt: row.createdAt,
      isMine: row.ownerEndUserId !== null && row.ownerEndUserId === params.endUserId,
    }))
  })
}

export async function deleteRecord(params: {
  projectId: string
  spec: AppSpec
  modelId: string
  recordId: string
  endUserId: string | null
}): Promise<void> {
  const model = findModel(params.spec, params.modelId)
  await withRuntimeScope(params.projectId, async (tx) => {
    const record = await tx.appRecord.findFirst({
      where: { id: params.recordId, projectId: params.projectId, modelId: params.modelId },
    })
    if (!record) throw notFound('Cet élément est introuvable.')
    // Une donnée partagée n'est supprimable que par celui qui l'a créée.
    const ownsIt = record.ownerEndUserId !== null && record.ownerEndUserId === params.endUserId
    if (model.scope === 'user' && !ownsIt) throw notFound('Cet élément est introuvable.')
    if (model.scope === 'shared' && !ownsIt) {
      throw validation('Seule la personne qui a créé cet élément peut le supprimer.')
    }
    await tx.appRecord.delete({ where: { id: record.id } })
  })
}

/** Vue du créateur sur les données de sa propre application (onglet Utilisateurs). */
export async function listRecordsForOwner(params: {
  userId: string
  projectId: string
  modelId: string
  limit?: number
}) {
  return withOwnerRuntimeScope(params.userId, params.projectId, (tx) =>
    tx.appRecord.findMany({
      where: { projectId: params.projectId, modelId: params.modelId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.limit ?? 50, 200),
    }),
  )
}
