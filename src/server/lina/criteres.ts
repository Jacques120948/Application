import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { withUserScope } from '@/server/db/scope'

/**
 * Les seuils des segments de Lina, réglables par la personne.
 *
 * Un « client actif » ne veut pas dire la même chose pour un torréfacteur, dont les clients
 * rachètent tous les mois, et pour un vendeur de matelas, qu'on revoit dans dix ans. Les
 * valeurs par défaut conviennent à une boutique de produits d'usage courant ; elles se
 * changent sur l'écran des segments, jamais dans le code.
 */

export const criteresSchema = z
  .object({
    /** Dernière commande depuis au plus N jours : client actif. */
    actifJours: z.number().int().min(14).max(730),
    /** Dernière commande depuis plus de N jours : client dormant. */
    dormantJours: z.number().int().min(30).max(1_095),
    /** Première commande depuis au plus N jours : nouveau client. */
    nouveauJours: z.number().int().min(7).max(180),
    /** À partir de N commandes : client fidèle. */
    fideleCommandes: z.number().int().min(2).max(50),
    /** La part des clients qui dépensent le plus et forment les VIP (0,05 = 5 %). */
    vipPart: z.number().min(0.01).max(0.3),
  })
  .strict()
  .refine((criteres) => criteres.dormantJours > criteres.actifJours, {
    message: 'Un client dormant doit l’être depuis plus longtemps qu’un client actif ne l’est.',
    path: ['dormantJours'],
  })

export type Criteres = z.infer<typeof criteresSchema>

export const CRITERES_DEFAUT: Criteres = {
  actifJours: 90,
  dormantJours: 180,
  nouveauJours: 30,
  fideleCommandes: 3,
  vipPart: 0.05,
}

/** Ce qui est en base, relu ; tout champ illisible retombe sur sa valeur par défaut. */
export function lireCriteres(brut: unknown): Criteres {
  const complet = { ...CRITERES_DEFAUT, ...(brut !== null && typeof brut === 'object' ? (brut as object) : {}) }
  const lu = criteresSchema.safeParse(complet)
  return lu.success ? lu.data : CRITERES_DEFAUT
}

export async function criteresLina(userId: string): Promise<Criteres> {
  const ligne = await withUserScope(userId, (tx) => tx.linaReglages.findUnique({ where: { userId }, select: { criteres: true } }))
  return lireCriteres(ligne?.criteres ?? null)
}

export async function enregistrerCriteres(userId: string, criteres: Criteres): Promise<Criteres> {
  const propres = criteresSchema.parse(criteres)
  const valeur = propres as unknown as Prisma.InputJsonValue
  await withUserScope(userId, (tx) =>
    tx.linaReglages.upsert({ where: { userId }, create: { userId, criteres: valeur }, update: { criteres: valeur } }),
  )
  return propres
}
