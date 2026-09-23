import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { withUserScope } from '@/server/db/scope'

/**
 * Ce que la personne dit de son activité à Nova.
 *
 * Trois choses que Nova ne peut pas deviner et ne devine pas : le type d'activité, qui
 * décide des indicateurs mis en avant ; les objectifs, qui donnent un sens aux chiffres ;
 * les coûts variables, sans lesquels aucune marge ne se calcule. Tout est facultatif, et
 * tout ce qui manque reste dit comme manquant — jamais remplacé par une moyenne.
 */

export const ACTIVITES = ['ecommerce', 'services', 'saas'] as const
export type Activite = (typeof ACTIVITES)[number]

const montant = z.number().finite().min(0).max(100_000_000)
const pourcent = z.number().finite().min(0).max(100)

export const objectifsSchema = z
  .object({
    /** Chiffre d'affaires visé pour un mois, dans la devise de la boutique. */
    caMensuel: montant.optional(),
    /** ROAS minimum, en pour cent comme partout dans Evoliia : 300 = 3 pour 1. */
    roasMin: z.number().finite().min(1).max(10_000).optional(),
    cacMax: montant.optional(),
    commandesMensuelles: z.number().int().min(0).max(10_000_000).optional(),
  })
  .strict()

export const coutsSchema = z
  .object({
    /** Coût des produits vendus, en pour cent du chiffre d'affaires. */
    coutProduitPct: pourcent.optional(),
    livraisonParCommande: montant.optional(),
    paiementPct: pourcent.optional(),
    paiementFixe: montant.optional(),
    commissionPct: pourcent.optional(),
    autresPct: pourcent.optional(),
  })
  .strict()

export const reglagesSchema = z.object({
  activite: z.enum(ACTIVITES).or(z.literal('')),
  objectifs: objectifsSchema,
  couts: coutsSchema,
})

export type Objectifs = z.infer<typeof objectifsSchema>
export type Couts = z.infer<typeof coutsSchema>
export type Reglages = z.infer<typeof reglagesSchema>

export const REGLAGES_VIDES: Reglages = { activite: '', objectifs: {}, couts: {} }

/** Un réglage illisible en base n'efface pas les autres : chaque partie se relit seule. */
export function lireReglages(brut: { activite: string; objectifs: unknown; couts: unknown } | null): Reglages {
  if (brut === null) return REGLAGES_VIDES
  const activite = (ACTIVITES as readonly string[]).includes(brut.activite) ? (brut.activite as Activite) : ''
  const objectifs = objectifsSchema.safeParse(brut.objectifs)
  const couts = coutsSchema.safeParse(brut.couts)
  return { activite, objectifs: objectifs.success ? objectifs.data : {}, couts: couts.success ? couts.data : {} }
}

export async function reglagesNova(userId: string): Promise<Reglages> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.novaReglages.findUnique({ where: { userId }, select: { activite: true, objectifs: true, couts: true } }),
  )
  return lireReglages(ligne)
}

export async function enregistrerReglages(userId: string, reglages: Reglages): Promise<Reglages> {
  const propre = reglagesSchema.parse(reglages)
  const data = {
    activite: propre.activite,
    objectifs: propre.objectifs as Prisma.InputJsonValue,
    couts: propre.couts as Prisma.InputJsonValue,
  }
  await withUserScope(userId, (tx) =>
    tx.novaReglages.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
  )
  return propre
}

/** Un nom d'événement GA4 : lettres, chiffres, soulignés — ce que GA4 accepte, et rien d'autre. */
export const prospectsSchema = z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/u)).max(10).nullable()

/** Les événements comptés comme prospects ; `undefined` : Nova les reconnaît à leur nom. */
export async function prospectsNova(userId: string): Promise<string[] | undefined> {
  const ligne = await withUserScope(userId, (tx) => tx.novaReglages.findUnique({ where: { userId }, select: { prospects: true } }))
  const lu = prospectsSchema.safeParse(ligne?.prospects ?? null)
  return lu.success && lu.data !== null ? lu.data : undefined
}

export async function enregistrerProspects(userId: string, evenements: string[] | null): Promise<void> {
  const propre = prospectsSchema.parse(evenements)
  const prospects = propre === null ? Prisma.DbNull : (propre as Prisma.InputJsonValue)
  await withUserScope(userId, (tx) =>
    tx.novaReglages.upsert({ where: { userId }, create: { userId, prospects }, update: { prospects } }),
  )
}
