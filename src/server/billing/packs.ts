import { readSetting } from '@/server/settings/store'

/**
 * Recharges de crédits, achetées à l'unité.
 *
 * Un abonnement donne une réserve mensuelle. Elle suffit la plupart du temps, et pas le
 * mois où l'on refait vingt fiches produits d'un coup. Sans recharge, ce mois-là force à
 * changer d'offre pour de bon — une décision trop lourde pour un besoin passager, et le
 * genre de friction qui fait fermer l'onglet.
 *
 * Trois règles, et chacune tient une promesse faite à l'acheteur.
 *
 * **Les crédits achetés n'expirent pas.** Ils ont été payés ; les périmer reviendrait à
 * garder de l'argent pour un service non rendu. Les crédits mensuels, eux, sont une
 * réserve incluse dans un abonnement : ils se renouvellent, donc ils se remplacent. Les
 * deux ne se mélangent pas, et le grand livre garde la distinction.
 *
 * **Les montants ne sont écrits qu'ici.** Ni dans une page, ni dans un écran, ni dans un
 * appel à Stripe. Un prix recopié à trois endroits finit par différer à l'un des trois, et
 * c'est toujours celui que le client regarde.
 *
 * **Chaque pack est réglable sans déploiement.** Le prix d'un pack est une décision
 * commerciale, pas une décision de code.
 */

export type CreditPack = {
  id: string
  credits: number
  /** En centimes, dans la monnaie du pack. */
  priceCents: number
  currency: string
  /** Mis en avant dans la grille : celui qui convient au plus grand nombre. */
  isRecommended: boolean
}

/**
 * Valeurs de départ.
 *
 * Le prix par crédit baisse avec la taille, ce qui est le seul comportement qu'un acheteur
 * trouve normal : cinq centimes l'unité pour le petit, un peu plus de trois pour le grand.
 */
export const DEFAULT_CREDIT_PACKS: readonly CreditPack[] = [
  { id: 'pack-100', credits: 100, priceCents: 500, currency: 'CHF', isRecommended: false },
  { id: 'pack-500', credits: 500, priceCents: 1900, currency: 'CHF', isRecommended: true },
  { id: 'pack-1500', credits: 1500, priceCents: 4900, currency: 'CHF', isRecommended: false },
]

/** Clé de réglage : le catalogue complet, en JSON, modifiable depuis l'administration. */
export const PACKS_SETTING = 'billing.credit.packs'

type PackBrut = Partial<Record<keyof CreditPack, unknown>>

/**
 * Lit un pack venu du réglage.
 *
 * Tout ce qui ne ressemble pas à un pack est écarté plutôt que corrigé : un prix mal saisi
 * qu'on « rattraperait » serait affiché à un client et encaissé pour de bon.
 */
function lirePack(valeur: unknown): CreditPack | null {
  if (valeur === null || typeof valeur !== 'object') return null
  const brut = valeur as PackBrut
  const id = typeof brut.id === 'string' ? brut.id.trim() : ''
  const credits = Number(brut.credits)
  const priceCents = Number(brut.priceCents)
  const currency = typeof brut.currency === 'string' ? brut.currency.trim().toUpperCase() : ''
  if (id === '' || currency.length !== 3) return null
  if (!Number.isInteger(credits) || credits <= 0) return null
  if (!Number.isInteger(priceCents) || priceCents <= 0) return null
  return { id, credits, priceCents, currency, isRecommended: brut.isRecommended === true }
}

/**
 * Le catalogue en vigueur.
 *
 * Un réglage illisible ou vide n'éteint pas la fonction : on retombe sur les valeurs de
 * départ. Une erreur de saisie dans le back-office ne doit pas faire disparaître la
 * possibilité d'acheter.
 */
export async function creditPacks(): Promise<readonly CreditPack[]> {
  const brut = await readSetting(PACKS_SETTING)
  if (brut === null || brut.trim() === '') return DEFAULT_CREDIT_PACKS
  try {
    const valeur: unknown = JSON.parse(brut)
    if (!Array.isArray(valeur)) return DEFAULT_CREDIT_PACKS
    const packs = valeur.map(lirePack).filter((pack): pack is CreditPack => pack !== null)
    return packs.length > 0 ? packs : DEFAULT_CREDIT_PACKS
  } catch {
    return DEFAULT_CREDIT_PACKS
  }
}
