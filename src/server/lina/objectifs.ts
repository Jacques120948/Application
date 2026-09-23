import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { withUserScope } from '@/server/db/scope'
import { argent, nombreLisible } from './recommandations'
import type { Releve } from './releves'

/**
 * Les objectifs CRM que la personne se fixe, et où elle en est.
 *
 * Rien n'est proposé par défaut : une cible inventée par Evoliia serait une promesse. Chaque
 * objectif est facultatif ; un objectif vide n'est pas affiché.
 */

export const objectifsLinaSchema = z
  .object({
    /** Taux de réachat visé, en pour cent. */
    tauxReachat: z.number().min(1).max(100).nullable().default(null),
    /** Chiffre d'affaires des clients existants sur trente jours, en unités de la devise. */
    caExistants30: z.number().min(1).max(100_000_000).nullable().default(null),
    /** Clients réactivés sur trente jours. */
    reactives30: z.number().int().min(1).max(1_000_000).nullable().default(null),
    /** V4 : dépense moyenne d'un acheteur visée (valeur client observée), en unités de la devise. */
    valeurClient: z.number().min(1).max(10_000_000).nullable().default(null),
    /** Score de fidélité visé (indicateur interne). */
    score: z.number().int().min(1).max(100).nullable().default(null),
  })
  .strict()

export type ObjectifsLina = z.infer<typeof objectifsLinaSchema>

export const OBJECTIFS_VIDES: ObjectifsLina = { tauxReachat: null, caExistants30: null, reactives30: null, valeurClient: null, score: null }

export function lireObjectifs(brut: unknown): ObjectifsLina {
  const lu = objectifsLinaSchema.safeParse(brut !== null && typeof brut === 'object' ? brut : {})
  return lu.success ? lu.data : OBJECTIFS_VIDES
}

export async function objectifsLina(userId: string): Promise<ObjectifsLina> {
  const ligne = await withUserScope(userId, (tx) => tx.linaReglages.findUnique({ where: { userId }, select: { objectifs: true } }))
  return lireObjectifs(ligne?.objectifs ?? null)
}

export async function enregistrerObjectifs(userId: string, objectifs: ObjectifsLina): Promise<ObjectifsLina> {
  const propres = objectifsLinaSchema.parse(objectifs)
  const valeur = propres as unknown as Prisma.InputJsonValue
  await withUserScope(userId, (tx) =>
    tx.linaReglages.upsert({ where: { userId }, create: { userId, objectifs: valeur }, update: { objectifs: valeur } }),
  )
  return propres
}

export type ProgressionObjectif = {
  cle: keyof ObjectifsLina
  libelle: string
  cible: string
  /** `null` : la mesure manque (commandes pas encore lues, trop peu d'acheteurs). */
  actuel: string | null
  /** Part de la cible atteinte, de 0 à 1 ; `null` sans mesure. */
  part: number | null
  atteint: boolean
}

export function progression(objectifs: ObjectifsLina, releve: Releve | null, devise: string, valeurObserveeCents: number | null = null): ProgressionObjectif[] {
  const lignes: ProgressionObjectif[] = []
  const ajouter = (cle: keyof ObjectifsLina, libelle: string, cible: number, actuel: number | null, format: (valeur: number) => string) => {
    const part = actuel === null ? null : Math.max(0, Math.min(1, actuel / cible))
    lignes.push({ cle, libelle, cible: format(cible), actuel: actuel === null ? null : format(actuel), part, atteint: actuel !== null && actuel >= cible })
  }
  if (objectifs.tauxReachat !== null)
    ajouter('tauxReachat', 'Taux de réachat', objectifs.tauxReachat, releve?.tauxReachat == null ? null : releve.tauxReachat * 100, (v) => `${nombreLisible(v, 1)} %`)
  if (objectifs.caExistants30 !== null)
    ajouter(
      'caExistants30',
      'CA des clients existants sur 30 jours',
      objectifs.caExistants30,
      releve?.caExistants30Cents == null ? null : releve.caExistants30Cents / 100,
      (v) => argent(Math.round(v * 100), devise),
    )
  if (objectifs.reactives30 !== null) ajouter('reactives30', 'Clients réactivés sur 30 jours', objectifs.reactives30, releve?.reactives30 ?? null, (v) => nombreLisible(v))
  if (objectifs.valeurClient !== null)
    ajouter(
      'valeurClient',
      'Valeur client (dépense moyenne observée d’un acheteur)',
      objectifs.valeurClient,
      valeurObserveeCents === null ? null : valeurObserveeCents / 100,
      (v) => argent(Math.round(v * 100), devise),
    )
  if (objectifs.score !== null) ajouter('score', 'Score de fidélité (indicateur interne)', objectifs.score, releve?.score ?? null, (v) => `${nombreLisible(v)}/100`)
  return lignes
}
