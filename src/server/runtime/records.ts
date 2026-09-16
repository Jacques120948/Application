import { Prisma } from '@prisma/client'
import { notFound, validation } from '@/lib/errors'
import { recordLabel } from '@/lib/record-label'
import { csvRow } from '@/lib/csv'
import { requireOwnedProject, withOwnerRuntimeScope, withRuntimeScope } from '@/server/db/scope'
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
      if (typeof raw !== 'string') {
        throw validation(`Le champ « ${field.label} » n'a pas une valeur attendue.`)
      }
      if ((field.options ?? []).includes(raw)) return raw
      /*
       * Hors liste : accepté seulement si le champ l'autorise, et borné comme n'importe
       * quel texte court. Sans cette borne, « autoriser une valeur libre » deviendrait un
       * champ de texte illimité déguisé en liste de choix.
       */
      if (field.allowOther !== true || raw.trim() === '' || raw.length > 80) {
        throw validation(`Le champ « ${field.label} » n'a pas une valeur attendue.`)
      }
      return raw.trim()
    }
    case 'reference': {
      // Seule la forme est vérifiée ici : savoir si la fiche visée existe demande la base,
      // et cela se fait dans la même transaction que l'écriture.
      if (typeof raw !== 'string' || !UUID.test(raw)) {
        throw validation(`Le champ « ${field.label} » doit désigner un élément existant.`)
      }
      return raw
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Vérifie que chaque renvoi désigne une fiche qui existe, dans le modèle annoncé et dans le
 * même projet. Sans cette vérification, le navigateur pourrait désigner n'importe quoi, et
 * la liste afficherait un renvoi mort.
 */
async function assertReferences(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  projectId: string,
  model: DataModel,
  data: RecordData,
): Promise<void> {
  for (const field of model.fields) {
    if (field.type !== 'reference' || field.referenceModelId === undefined) continue
    const valeur = data[field.id]
    if (valeur === null || valeur === undefined) continue
    const existe = await tx.appRecord.count({
      where: { id: String(valeur), projectId, modelId: field.referenceModelId },
    })
    if (existe === 0) {
      throw validation(`Le champ « ${field.label} » désigne un élément qui n'existe pas.`)
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
    await assertReferences(tx, params.projectId, model, data)
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

/** Les ordres d'affichage proposés. Quatre suffisent, et chacun se dit en trois mots. */
export const RECORD_SORTS = ['recent', 'ancien', 'az', 'za'] as const
export type RecordSort = (typeof RECORD_SORTS)[number]

export type RecordQuery = {
  /** Texte cherché dans les champs lisibles du modèle. */
  search?: string
  /** Champ à choix sur lequel restreindre, et la valeur retenue. */
  filterField?: string
  filterValue?: string
  sort?: RecordSort
  /**
   * Champ sur lequel porte l'ordre alphabétique. C'est celui que la liste affiche en
   * titre : trier sur un champ invisible donnerait un ordre que personne ne peut lire.
   */
  sortField?: string
  /** Champ numérique dont on veut le total, et la façon de le calculer. */
  sumField?: string
  sumKind?: 'somme' | 'moyenne'
  limit?: number
  offset?: number
}

/** Un total calculé sur l'ensemble filtré, jamais sur la seule page affichée. */
export type RecordAggregate = { field: string; label: string; kind: 'somme' | 'moyenne'; value: number }

/** Une page de résultats, avec le total : sans lui, « voir plus » ne saurait pas s'arrêter. */
export type RecordPage = {
  items: StoredRecord[]
  total: number
  /** Nom des fiches désignées par les renvois de cette page, par identifiant. */
  references: Record<string, string>
  aggregate: RecordAggregate | null
  /**
   * Valeurs hors liste réellement présentes dans les données, pour le champ de filtre.
   *
   * Vide sur une liste fermée : ses choix sont déjà connus du navigateur. Renseigné quand
   * le champ autorise une valeur libre, sans quoi un métier saisi à la main n'apparaîtrait
   * dans aucun filtre et deviendrait introuvable.
   */
  filterValues: string[]
}

const PAGE_SIZE = 20
const MAX_PAGE = 100
const MAX_SEARCH = 120

/** Champs où chercher du texte. Un nombre ou une date ne se cherchent pas au clavier. */
function searchableFields(model: DataModel): DataField[] {
  return model.fields.filter(
    (field) =>
      field.type === 'text' ||
      field.type === 'longText' ||
      field.type === 'email' ||
      field.type === 'url' ||
      field.type === 'select',
  )
  // Un renvoi n'est pas cherchable : sa valeur est un identifiant, que personne ne tape.
}

/**
 * Motif `ILIKE` pour une recherche libre.
 *
 * Les jokers de SQL sont neutralisés : sans cela, chercher « 100 % » ramènerait tout, et
 * chercher un souligné ramènerait n'importe quel caractère. Le visiteur cherche du texte,
 * pas un motif.
 */
function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (caractere) => `\\${caractere}`)}%`
}

/**
 * La condition de lecture, écrite une seule fois.
 *
 * Elle sert au décompte et à la page : deux expressions de la même règle finiraient par
 * diverger, et c'est toujours celle qu'on relit le moins qui compterait des lignes que
 * l'autre n'affiche pas.
 *
 * Aucun nom de champ n'y entre sans avoir été retrouvé dans le modèle publié, et il y passe
 * ensuite comme paramètre, jamais par concaténation.
 */
function condition(params: {
  projectId: string
  modelId: string
  ownerEndUserId: string | null
  filterField?: DataField
  filterValue?: string
  search: string
  searchFields: DataField[]
}): Prisma.Sql {
  const morceaux: Prisma.Sql[] = [
    Prisma.sql`"projectId" = ${params.projectId}::uuid AND "modelId" = ${params.modelId}`,
  ]
  if (params.ownerEndUserId !== null) {
    morceaux.push(Prisma.sql`"ownerEndUserId" = ${params.ownerEndUserId}::uuid`)
  }
  if (params.filterField !== undefined && params.filterValue !== undefined) {
    morceaux.push(Prisma.sql`"data"->>${params.filterField.id} = ${params.filterValue}`)
  }
  if (params.search !== '' && params.searchFields.length > 0) {
    const motif = likePattern(params.search)
    const ou = params.searchFields.map(
      (field) => Prisma.sql`"data"->>${field.id} ILIKE ${motif} ESCAPE '\\'`,
    )
    morceaux.push(Prisma.sql`(${Prisma.join(ou, ' OR ')})`)
  }
  return Prisma.join(morceaux, ' AND ')
}

/**
 * L'ordre demandé, traduit en SQL.
 *
 * L'ordre alphabétique porte sur le champ demandé — celui que la liste affiche en titre —
 * et non sur un champ choisi ici : trier sur une valeur invisible donnerait un ordre que
 * personne ne peut lire. Le champ est retrouvé dans le modèle publié avant d'entrer dans la
 * requête, et il y entre comme paramètre. Seul le sens est écrit en clair, et il sort d'une
 * liste de deux valeurs.
 */
function ordre(model: DataModel, sort: RecordSort, sortField?: string): Prisma.Sql {
  if (sort === 'recent') return Prisma.sql`"createdAt" DESC`
  if (sort === 'ancien') return Prisma.sql`"createdAt" ASC`
  const champ =
    model.fields.find((field) => field.id === sortField) ??
    model.fields.find((field) => field.type === 'text')
  // Sans champ sur lequel trier, l'ordre alphabétique n'a pas d'objet : on retombe sur la
  // date plutôt que sur rien.
  if (champ === undefined) return Prisma.sql`"createdAt" DESC`
  const sens = Prisma.raw(sort === 'az' ? 'ASC' : 'DESC')
  return Prisma.sql`"data"->>${champ.id} ${sens} NULLS LAST, "createdAt" DESC`
}

type LigneBrute = {
  id: string
  data: RecordData
  createdAt: Date
  ownerEndUserId: string | null
}

/**
 * Liste les enregistrements, avec recherche, filtre, tri et pagination.
 *
 * Tout se fait dans la base, jamais dans le navigateur : chercher parmi les cinquante
 * fiches déjà chargées ne serait pas chercher, ce serait en donner l'illusion.
 *
 * La requête est écrite à la main parce que l'ordre et la recherche portent sur des clés
 * d'un document JSON, que l'interface de Prisma ne sait pas ordonner. Elle reste exécutée
 * dans la portée du projet, donc sous la même protection de la base que le reste.
 */
export async function listRecords(params: {
  projectId: string
  spec: AppSpec
  modelId: string
  endUserId: string | null
  query?: RecordQuery
}): Promise<RecordPage> {
  const model = findModel(params.spec, params.modelId)
  if (model.scope === 'user' && params.endUserId === null) {
    return { items: [], total: 0, references: {}, aggregate: null, filterValues: [] }
  }
  return withRuntimeScope(params.projectId, (tx) =>
    lirePage(tx, {
      projectId: params.projectId,
      spec: params.spec,
      model,
      // Sur un modèle privé, chacun ne lit que ses propres fiches.
      ownerEndUserId: model.scope === 'user' ? params.endUserId : null,
      viewerEndUserId: params.endUserId,
      query: params.query ?? {},
    }),
  )
}

/**
 * Une page de résultats, quel que soit celui qui la demande.
 *
 * Visiteur ou créateur, la recherche, le filtre, l'ordre, la pagination et le total sont
 * les mêmes ; seuls changent la portée de la base et le fait de restreindre ou non aux
 * fiches d'une personne. Deux implémentations de cette lecture finiraient par ne pas
 * compter pareil.
 */
async function lirePage(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  params: {
    projectId: string
    spec: AppSpec
    model: DataModel
    /** Restreint la lecture aux fiches de cette personne. `null` : toutes. */
    ownerEndUserId: string | null
    /** Qui regarde, pour dire de quelles fiches il dispose. */
    viewerEndUserId: string | null
    query: RecordQuery
  },
): Promise<RecordPage> {
  const { model, query } = params
  const limit = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), MAX_PAGE)
  const offset = Math.max(query.offset ?? 0, 0)

  // On ne filtre que sur un champ à choix : sur du texte libre, aucune valeur ne se
  // répéterait assez pour faire un filtre utile.
  const champFiltre =
    query.filterField === undefined
      ? undefined
      : model.fields.find((field) => field.id === query.filterField && field.type === 'select')

  // Le champ de filtre est connu même sans valeur choisie : c'est lui qui dit s'il faut
  // aller chercher les valeurs saisies à la main pour garnir le menu.
  const filterField =
    champFiltre !== undefined && query.filterValue !== undefined && query.filterValue !== ''
      ? champFiltre
      : undefined

  const ou = condition({
    projectId: params.projectId,
    modelId: model.id,
    ownerEndUserId: params.ownerEndUserId,
    ...(filterField !== undefined ? { filterField, filterValue: query.filterValue } : {}),
    search: (query.search ?? '').trim().slice(0, MAX_SEARCH),
    searchFields: searchableFields(model),
  })

  const [compte] = await tx.$queryRaw<Array<{ total: bigint }>>(
    Prisma.sql`SELECT count(*) AS total FROM "AppRecord" WHERE ${ou}`,
  )
  const total = Number(compte?.total ?? 0)
  if (total === 0) {
    return { items: [], total, references: {}, aggregate: null, filterValues: [] }
  }

  const rows = await tx.$queryRaw<LigneBrute[]>(
    Prisma.sql`SELECT id, "data", "createdAt", "ownerEndUserId"
               FROM "AppRecord"
               WHERE ${ou}
               ORDER BY ${ordre(model, query.sort ?? 'recent', query.sortField)}
               LIMIT ${limit} OFFSET ${offset}`,
  )
  const items = rows.map((row) => ({
    id: row.id,
    data: row.data,
    createdAt: row.createdAt,
    isMine: row.ownerEndUserId !== null && row.ownerEndUserId === params.viewerEndUserId,
  }))
  return {
    items,
    total,
    references: await resoudreRenvois(tx, params.projectId, params.spec, model, items),
    aggregate: await calculer(tx, ou, model, query.sumField, query.sumKind ?? 'somme'),
    filterValues:
      champFiltre?.allowOther === true
        ? await valeursSaisies(tx, {
            projectId: params.projectId,
            modelId: model.id,
            ownerEndUserId: params.ownerEndUserId,
            field: champFiltre,
          })
        : [],
  }
}

/** Au-delà, un menu déroulant n'aide plus personne : il faudrait chercher, pas dérouler. */
const MAX_VALEURS_LIBRES = 50

/**
 * Les valeurs hors liste réellement présentes, pour garnir le menu de filtre.
 *
 * Volontairement calculées **sans** le filtre en cours ni la recherche : sinon, dès qu'une
 * valeur serait choisie, le menu ne proposerait plus qu'elle et on ne pourrait plus en
 * changer sans tout remettre à zéro.
 */
async function valeursSaisies(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  params: {
    projectId: string
    modelId: string
    ownerEndUserId: string | null
    field: DataField
  },
): Promise<string[]> {
  const base = condition({
    projectId: params.projectId,
    modelId: params.modelId,
    ownerEndUserId: params.ownerEndUserId,
    search: '',
    searchFields: [],
  })
  const lignes = await tx.$queryRaw<Array<{ valeur: string | null }>>(
    Prisma.sql`SELECT DISTINCT "data"->>${params.field.id} AS valeur
               FROM "AppRecord"
               WHERE ${base} AND "data"->>${params.field.id} IS NOT NULL
               ORDER BY 1
               LIMIT ${MAX_VALEURS_LIBRES}`,
  )
  const declarees = new Set(params.field.options ?? [])
  return lignes
    .map((ligne) => ligne.valeur)
    .filter((valeur): valeur is string => valeur !== null && valeur !== '' && !declarees.has(valeur))
}

/**
 * Remplace les identifiants des renvois par le nom des fiches visées.
 *
 * Une requête par modèle référencé, jamais une par ligne : une liste de vingt fiches qui
 * renverraient chacune vers un client ferait vingt allers-retours pour dire vingt noms.
 */
async function resoudreRenvois(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  projectId: string,
  spec: AppSpec,
  model: DataModel,
  items: StoredRecord[],
): Promise<Record<string, string>> {
  const noms: Record<string, string> = {}
  for (const field of model.fields) {
    if (field.type !== 'reference' || field.referenceModelId === undefined) continue
    const cible = spec.dataModels.find((candidate) => candidate.id === field.referenceModelId)
    if (cible === undefined) continue
    const ids = [
      ...new Set(
        items
          .map((item) => item.data[field.id])
          .filter((valeur): valeur is string => typeof valeur === 'string' && valeur !== ''),
      ),
    ]
    if (ids.length === 0) continue
    const vises = await tx.appRecord.findMany({
      where: { id: { in: ids }, projectId, modelId: cible.id },
      select: { id: true, data: true },
    })
    for (const vise of vises) noms[vise.id] = recordLabel(cible, vise.data as RecordData)
  }
  return noms
}

/**
 * Le total annoncé par une liste.
 *
 * Il porte sur l'ensemble filtré, jamais sur la page affichée : un total qui changerait en
 * cliquant « voir plus » ne serait pas un total. Les valeurs qui ne sont pas des nombres
 * sont ignorées plutôt que de faire échouer la lecture — un champ peut avoir changé de type
 * après que des fiches ont été saisies.
 */
async function calculer(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  ou: Prisma.Sql,
  model: DataModel,
  sumField: string | undefined,
  kind: 'somme' | 'moyenne',
): Promise<RecordAggregate | null> {
  const champ = model.fields.find((field) => field.id === sumField && field.type === 'number')
  if (champ === undefined) return null
  const nombre = Prisma.sql`CASE WHEN "data"->>${champ.id} ~ '^-?[0-9]+(\.[0-9]+)?$'
                            THEN ("data"->>${champ.id})::numeric END`
  const [ligne] = await tx.$queryRaw<Array<{ valeur: string | null }>>(
    kind === 'moyenne'
      ? Prisma.sql`SELECT avg(${nombre}) AS valeur FROM "AppRecord" WHERE ${ou}`
      : Prisma.sql`SELECT sum(${nombre}) AS valeur FROM "AppRecord" WHERE ${ou}`,
  )
  const brut = ligne?.valeur
  if (brut === null || brut === undefined) return null
  const valeur = Number(brut)
  if (!Number.isFinite(valeur)) return null
  // Deux décimales : au-delà, un total d'euros ou d'heures devient illisible.
  return { field: champ.id, label: champ.label, kind, value: Math.round(valeur * 100) / 100 }
}

/**
 * Retrouve un enregistrement et vérifie qu'on a le droit d'y toucher.
 *
 * La règle est la même pour corriger et pour supprimer, et c'est voulu : celui qui a saisi
 * une donnée en dispose, personne d'autre. Sur un modèle privé, l'élément d'autrui est
 * déclaré introuvable plutôt que refusé — répondre « interdit » révélerait son existence.
 * Sur un modèle partagé, où tout le monde le voit déjà, on peut dire la vraie raison.
 */
async function ownedRecord(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  params: { projectId: string; modelId: string; recordId: string; endUserId: string | null },
  model: DataModel,
  geste: 'modifier' | 'supprimer',
) {
  const record = await tx.appRecord.findFirst({
    where: { id: params.recordId, projectId: params.projectId, modelId: params.modelId },
  })
  if (!record) throw notFound('Cet élément est introuvable.')
  const ownsIt = record.ownerEndUserId !== null && record.ownerEndUserId === params.endUserId
  if (model.scope === 'user' && !ownsIt) throw notFound('Cet élément est introuvable.')
  if (model.scope === 'shared' && !ownsIt) {
    const verbe = geste === 'modifier' ? 'modifier' : 'supprimer'
    throw validation(`Seule la personne qui a créé cet élément peut le ${verbe}.`)
  }
  return record
}

/**
 * Corriger un enregistrement.
 *
 * Sans cette fonction, une application ne savait que créer et détruire : changer une
 * virgule imposait de supprimer puis de ressaisir, et tout ce qui a un état — une
 * réservation qu'on déplace, une tâche qu'on coche — était hors de portée.
 *
 * La saisie est revalidée en entier contre le modèle publié, exactement comme à la
 * création : le navigateur ne décide jamais de la forme des données, et un champ inconnu
 * glissé dans la requête est écarté.
 */
export async function updateRecord(params: {
  projectId: string
  spec: AppSpec
  modelId: string
  recordId: string
  endUserId: string | null
  input: Record<string, unknown>
}): Promise<StoredRecord> {
  const model = findModel(params.spec, params.modelId)
  const data = validateRecordData(model, params.input)

  return withRuntimeScope(params.projectId, async (tx) => {
    const record = await ownedRecord(tx, params, model, 'modifier')
    await assertReferences(tx, params.projectId, model, data)
    const updated = await tx.appRecord.update({
      where: { id: record.id },
      data: { data: data as unknown as Prisma.InputJsonValue },
    })
    return { id: updated.id, data, createdAt: updated.createdAt, isMine: true }
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
    const record = await ownedRecord(tx, params, model, 'supprimer')
    await tx.appRecord.delete({ where: { id: record.id } })
  })
}

/**
 * Les données d'une application, vues par son créateur.
 *
 * Il voit et corrige tout ce que son application collecte, y compris les fiches d'un
 * modèle privé : c'est lui qui répond des données de son application, et il en voyait déjà
 * le contenu dans l'aperçu. Ce qui change ici, c'est qu'il peut enfin agir dessus —
 * confirmer une réservation, rectifier une faute de frappe, écarter un doublon.
 *
 * Toutes ces fonctions passent par la portée « propriétaire » : la base vérifie elle-même
 * que le projet est bien le sien, en plus de la vérification faite ici.
 */
export type OwnerRecordPage = RecordPage & {
  /** Fiches proposées par chaque champ de renvoi, pour le formulaire de correction. */
  choices: Record<string, Array<{ id: string; label: string }>>
}

const MAX_CHOICES = 200

export async function listOwnerRecords(params: {
  userId: string
  projectId: string
  spec: AppSpec
  modelId: string
  query?: RecordQuery
}): Promise<OwnerRecordPage> {
  const model = findModel(params.spec, params.modelId)
  return withOwnerRuntimeScope(params.userId, params.projectId, async (tx) => {
    await requireOwnedProject(tx, params.projectId, params.userId)
    const page = await lirePage(tx, {
      projectId: params.projectId,
      spec: params.spec,
      model,
      // Le créateur lit tout ce que son application a collecté, sans restriction de
      // personne : c'est le seul point de vue depuis lequel il peut en répondre.
      ownerEndUserId: null,
      viewerEndUserId: null,
      query: params.query ?? {},
    })
    return { ...page, choices: await lireChoix(tx, params.projectId, params.spec, model) }
  })
}

/** Les fiches qu'un champ de renvoi peut désigner, pour la correction côté créateur. */
async function lireChoix(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  projectId: string,
  spec: AppSpec,
  model: DataModel,
): Promise<Record<string, Array<{ id: string; label: string }>>> {
  const choix: Record<string, Array<{ id: string; label: string }>> = {}
  for (const field of model.fields) {
    if (field.type !== 'reference' || field.referenceModelId === undefined) continue
    const cible = spec.dataModels.find((candidate) => candidate.id === field.referenceModelId)
    if (cible === undefined) continue
    const rows = await tx.appRecord.findMany({
      where: { projectId, modelId: cible.id },
      orderBy: { createdAt: 'desc' },
      take: MAX_CHOICES,
      select: { id: true, data: true },
    })
    choix[field.id] = rows.map((row) => ({
      id: row.id,
      label: recordLabel(cible, row.data as RecordData),
    }))
  }
  return choix
}

export async function updateOwnerRecord(params: {
  userId: string
  projectId: string
  spec: AppSpec
  modelId: string
  recordId: string
  input: Record<string, unknown>
}): Promise<StoredRecord> {
  const model = findModel(params.spec, params.modelId)
  const data = validateRecordData(model, params.input)
  return withOwnerRuntimeScope(params.userId, params.projectId, async (tx) => {
    await requireOwnedProject(tx, params.projectId, params.userId)
    const record = await tx.appRecord.findFirst({
      where: { id: params.recordId, projectId: params.projectId, modelId: params.modelId },
    })
    if (record === null) throw notFound('Cet élément est introuvable.')
    await assertReferences(tx, params.projectId, model, data)
    const updated = await tx.appRecord.update({
      where: { id: record.id },
      data: { data: data as unknown as Prisma.InputJsonValue },
    })
    return { id: updated.id, data, createdAt: updated.createdAt, isMine: false }
  })
}

export async function deleteOwnerRecord(params: {
  userId: string
  projectId: string
  modelId: string
  recordId: string
}): Promise<void> {
  await withOwnerRuntimeScope(params.userId, params.projectId, async (tx) => {
    await requireOwnedProject(tx, params.projectId, params.userId)
    const supprimees = await tx.appRecord.deleteMany({
      where: { id: params.recordId, projectId: params.projectId, modelId: params.modelId },
    })
    if (supprimees.count === 0) throw notFound('Cet élément est introuvable.')
  })
}

/**
 * Les fiches d'un modèle, en CSV.
 *
 * Une colonne par champ déclaré, dans l'ordre du modèle, plus l'identifiant et la date : un
 * export dont les colonnes suivraient les clés trouvées en base changerait de forme d'un
 * jour à l'autre. Les renvois sortent sous le nom de la fiche visée, pas sous son
 * identifiant — c'est un fichier fait pour être lu.
 */
export async function exportOwnerRecords(params: {
  userId: string
  projectId: string
  spec: AppSpec
  modelId: string
}): Promise<{ filename: string; content: string }> {
  const model = findModel(params.spec, params.modelId)
  return withOwnerRuntimeScope(params.userId, params.projectId, async (tx) => {
    await requireOwnedProject(tx, params.projectId, params.userId)
    const rows = await tx.appRecord.findMany({
      where: { projectId: params.projectId, modelId: params.modelId },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECORDS_PER_MODEL,
    })
    const items = rows.map((row) => ({
      id: row.id,
      data: row.data as RecordData,
      createdAt: row.createdAt,
      isMine: false,
    }))
    const noms = await resoudreRenvois(tx, params.projectId, params.spec, model, items)

    const entete = csvRow(['id', 'cree_le', ...model.fields.map((field) => field.label)])
    const corps = items.map((item) =>
      csvRow([
        item.id,
        item.createdAt.toISOString(),
        ...model.fields.map((field) => {
          const valeur = item.data[field.id]
          if (field.type !== 'reference') return valeur
          return typeof valeur === 'string' && valeur !== '' ? (noms[valeur] ?? '') : ''
        }),
      ]),
    )
    const jour = new Date().toISOString().slice(0, 10)
    return {
      filename: `${params.modelId}-${jour}.csv`,
      content: [entete, ...corps].join('\n'),
    }
  })
}

export type OwnerDataOverview = {
  endUserCount: number
  models: Array<{
    id: string
    label: string
    count: number
    recent: Array<{ id: string; createdAt: Date; summary: string }>
  }>
}

/**
 * Vue du créateur sur les données de sa propre application (onglet Utilisateurs).
 * Le créateur voit les données de son application ; il ne voit jamais celles d'une autre.
 */
export async function getOwnerDataOverview(
  userId: string,
  projectId: string,
  spec: AppSpec,
): Promise<OwnerDataOverview> {
  return withOwnerRuntimeScope(userId, projectId, async (tx) => {
    const endUserCount = await tx.appEndUser.count({ where: { projectId } })
    const models = []
    for (const model of spec.dataModels) {
      const [count, recent] = await Promise.all([
        tx.appRecord.count({ where: { projectId, modelId: model.id } }),
        tx.appRecord.findMany({
          where: { projectId, modelId: model.id },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
      ])
      models.push({
        id: model.id,
        label: model.labelPlural,
        count,
        recent: recent.map((row) => ({
          id: row.id,
          createdAt: row.createdAt,
          summary: summarise(model, row.data as RecordData),
        })),
      })
    }
    return { endUserCount, models }
  })
}

/** Résumé d'un enregistrement : les deux premiers champs texte renseignés. */
function summarise(model: DataModel, data: RecordData): string {
  const parts: string[] = []
  for (const field of model.fields) {
    const value = data[field.id]
    if (value === null || value === undefined || value === '') continue
    parts.push(`${field.label} : ${String(value).slice(0, 60)}`)
    if (parts.length === 2) break
  }
  return parts.length === 0 ? 'Enregistrement vide' : parts.join(' — ')
}
