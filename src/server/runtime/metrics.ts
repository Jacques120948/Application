import { Prisma } from '@prisma/client'
import { parseFormula } from '@/lib/formula'
import { withRuntimeScope } from '@/server/db/scope'
import type { AppSpec, DataModel, Page } from '@/server/spec/schema'

/**
 * Les chiffres d'un tableau de bord.
 *
 * Une liste montre les fiches ; elle ne dit pas « combien », ni « combien ce mois-ci ».
 * C'est pourtant la première question de celui qui ouvre son application le matin, et la
 * seule qui compte quand elle contient deux mille fiches.
 *
 * Trois règles, et la deuxième est une règle de sécurité.
 *
 * **La base compte, pas le navigateur.** Compter les fiches déjà chargées donnerait un
 * nombre faux dès la vingt-et-unième, et personne ne s'en apercevrait.
 *
 * **Une mesure ne voit que ce que son lecteur a le droit de voir.** Sur un modèle privé,
 * elle est restreinte aux fiches du visiteur. Un tableau de bord qui compterait les fiches
 * de tout le monde sur des données privées serait une fuite — discrète, chiffrée, mais une
 * fuite.
 *
 * **Une mesure impossible ne vaut pas zéro.** Modèle disparu, champ absent, aucune fiche
 * dans la période : le résultat est « rien », et l'écran affiche un tiret. Un zéro
 * s'interprète comme un fait ; il ne doit pas être le déguisement d'une absence.
 */

export type MetricValue = {
  id: string
  label: string
  /** `null` quand la mesure n'a pas de sens ou qu'aucune fiche n'entre dedans. */
  value: number | null
  unit: string | undefined
  /** Phrase de contexte : « sur les 30 derniers jours ». Vide quand la mesure porte sur tout. */
  period: string
}

/** Les mesures d'une page, par identifiant de bloc. */
export type PageMetrics = Record<string, MetricValue[]>

const PERIOD_LABEL = {
  tout: '',
  '7j': 'sur les 7 derniers jours',
  '30j': 'sur les 30 derniers jours',
  '12m': 'sur les 12 derniers mois',
} as const

const PERIOD_MS = {
  tout: null,
  '7j': 7 * 24 * 60 * 60 * 1000,
  '30j': 30 * 24 * 60 * 60 * 1000,
  '12m': 365 * 24 * 60 * 60 * 1000,
} as const

/** Un champ traduit en nombre, en écartant ce qui n'en est pas un. */
function nombreSql(id: string): Prisma.Sql {
  return Prisma.sql`CASE WHEN "data"->>${id} ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN ("data"->>${id})::numeric END`
}

/**
 * Une formule traduite en SQL, depuis son arbre et jamais depuis son texte.
 *
 * C'est la même règle que pour les listes : aucune chaîne écrite par un modèle de langage
 * n'entre dans une requête, seuls des identifiants de champs passés en paramètres.
 */
function formuleSql(source: string): Prisma.Sql | null {
  let node
  try {
    node = parseFormula(source)
  } catch {
    return null
  }
  const rendu = (courant: ReturnType<typeof parseFormula>): Prisma.Sql => {
    switch (courant.kind) {
      case 'number':
        return Prisma.sql`${courant.value}::numeric`
      case 'field':
        return nombreSql(courant.id)
      case 'negate':
        return Prisma.sql`(- ${rendu(courant.value)})`
      case 'binary': {
        const gauche = rendu(courant.left)
        const droite = rendu(courant.right)
        if (courant.op === '+') return Prisma.sql`(${gauche} + ${droite})`
        if (courant.op === '-') return Prisma.sql`(${gauche} - ${droite})`
        if (courant.op === '*') return Prisma.sql`(${gauche} * ${droite})`
        return Prisma.sql`(${gauche} / NULLIF(${droite}, 0))`
      }
    }
  }
  return rendu(node)
}

/**
 * Calcule toutes les mesures des blocs d'une page.
 *
 * Fait au serveur, avant le rendu : la page arrive avec ses chiffres, sans requête
 * supplémentaire depuis le navigateur ni écran qui se remplit après coup.
 */
export async function computePageMetrics(params: {
  projectId: string
  spec: AppSpec
  page: Page
  /** Le visiteur connecté, ou `null`. Décide de ce que les modèles privés laissent compter. */
  endUserId: string | null
}): Promise<PageMetrics> {
  const blocs = params.page.blocks.filter((block) => block.type === 'metrics')
  if (blocs.length === 0) return {}

  return withRuntimeScope(params.projectId, async (tx) => {
    const resultat: PageMetrics = {}

    for (const bloc of blocs) {
      const valeurs: MetricValue[] = []

      for (const item of bloc.items) {
        const model = params.spec.dataModels.find((candidate) => candidate.id === item.modelId)
        valeurs.push({
          id: item.id,
          label: item.label,
          unit: item.unit,
          period: PERIOD_LABEL[item.period],
          value:
            model === undefined
              ? null
              : await mesurer(tx, {
                  projectId: params.projectId,
                  model,
                  item,
                  endUserId: params.endUserId,
                }),
        })
      }

      resultat[bloc.id] = valeurs
    }

    return resultat
  })
}

type Item = Extract<Page['blocks'][number], { type: 'metrics' }>['items'][number]

async function mesurer(
  tx: Parameters<Parameters<typeof withRuntimeScope>[1]>[0],
  params: {
    projectId: string
    model: DataModel
    item: Item
    endUserId: string | null
  },
): Promise<number | null> {
  const { model, item } = params

  // Un modèle privé ne se compte que pour soi. Sans visiteur connecté, il n'y a rien à
  // compter — et surtout, il n'est pas question de compter les fiches des autres.
  if (model.scope === 'user' && params.endUserId === null) return null

  const conditions: Prisma.Sql[] = [
    Prisma.sql`"projectId" = ${params.projectId}::uuid`,
    Prisma.sql`"modelId" = ${model.id}`,
  ]
  if (model.scope === 'user') {
    conditions.push(Prisma.sql`"ownerEndUserId" = ${params.endUserId}::uuid`)
  }

  const fenetre = PERIOD_MS[item.period]
  if (fenetre !== null) {
    conditions.push(Prisma.sql`"createdAt" >= ${new Date(Date.now() - fenetre)}`)
  }

  if (item.filterField !== undefined && item.filterValue !== undefined && item.filterValue !== '') {
    const champ = model.fields.find((field) => field.id === item.filterField)
    if (champ === undefined) return null
    conditions.push(Prisma.sql`"data"->>${champ.id} = ${item.filterValue}`)
  }

  const ou = Prisma.join(conditions, ' AND ')

  if (item.kind === 'nombre') {
    const [ligne] = await tx.$queryRaw<Array<{ valeur: bigint }>>(
      Prisma.sql`SELECT count(*) AS valeur FROM "AppRecord" WHERE ${ou}`,
    )
    return Number(ligne?.valeur ?? 0)
  }

  const champ = model.fields.find((field) => field.id === item.field)
  if (champ === undefined) return null

  let expression: Prisma.Sql | null
  if (champ.type === 'computed') {
    // Un champ calculé n'existe pas en base : c'est sa formule qu'on totalise.
    expression = formuleSql(champ.formula ?? '')
  } else if (champ.type === 'number') {
    expression = nombreSql(champ.id)
  } else {
    return null
  }
  if (expression === null) return null

  const [ligne] = await tx.$queryRaw<Array<{ valeur: string | null }>>(
    item.kind === 'moyenne'
      ? Prisma.sql`SELECT avg(${expression}) AS valeur FROM "AppRecord" WHERE ${ou}`
      : Prisma.sql`SELECT sum(${expression}) AS valeur FROM "AppRecord" WHERE ${ou}`,
  )
  if (ligne?.valeur === null || ligne?.valeur === undefined) return null
  const valeur = Number(ligne.valeur)
  if (!Number.isFinite(valeur)) return null
  // Deux décimales : au-delà, un total d'euros ou d'heures devient illisible.
  return Math.round(valeur * 100) / 100
}
