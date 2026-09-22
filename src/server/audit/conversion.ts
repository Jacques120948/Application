import { readPlan, type LignePlan } from './plan'

/**
 * Ce que Cleo montre, et ce qu'elle se refuse à montrer.
 *
 * Tout vient du plan d'action déjà en base : les constats du dernier audit, avec l'état que
 * la personne leur a donné. Rien n'est recalculé ici, rien n'est demandé à un modèle, et
 * aucune page n'est rechargée — le site n'est lu qu'une fois, par Léa, et les trois moteurs
 * se servent du même parcours.
 *
 * **Trois priorités, pas trente.** La question devant cet écran est « par quoi je
 * commence », et une liste de trente lignes n'y répond pas. Les trois qui coûtent le plus
 * de points passent devant ; le reste attend plus bas, à la même place que d'habitude.
 *
 * **Ce qui se règle aujourd'hui est séparé de ce qui rapporte le plus.** Un « quick win »
 * est un jugement sur l'effort, déclaré à la main dans le catalogue, et il ne prétend rien
 * sur le gain : personne ne sait ce qu'un bouton renommé rapporte. Les deux listes ne se
 * recouvrent pas — une même ligne affichée deux fois ferait croire à deux chantiers.
 *
 * **Aucune vente n'est mesurée.** Evoliia n'a aucune source reliée : ni panier, ni chiffre
 * d'affaires, ni abandon. Cette vue ne porte donc que des constats de page, et l'écran doit
 * le dire plutôt que de laisser lire ses chiffres comme un taux de conversion.
 */

/** Au-delà, ce n'est plus « par quoi je commence ». */
const PRIORITES_MAX = 3

/** Au-delà, la liste de ce qui se règle vite devient une liste tout court. */
const RAPIDES_MAX = 4

export type VueConversion = {
  auditId: string
  finishedAt: Date | null
  /** Les constats de conversion restant à traiter, les plus coûteux d'abord. */
  lignes: LignePlan[]
  /** Les trois premiers d'entre eux. */
  priorites: LignePlan[]
  /** Ce qui se corrige en une modification locale, hors des trois priorités. */
  rapides: LignePlan[]
  /** Ce qui a été marqué corrigé ou ignoré et ne remonte plus. */
  reglees: { checkId: string; label: string; state: string }[]
}

/**
 * La vue de Cleo pour un site, ou `null` si ce site n'a pas encore d'audit terminé.
 *
 * Les constats déjà marqués « corrigée » ou « ignorée » sortent des priorités : ils ont
 * été tranchés, et les remettre en tête reviendrait à redemander une décision déjà prise.
 * Ils restent dans `lignes`, où le plan d'action les affiche avec leur état.
 */
export async function lireConversion(
  userId: string,
  siteId: string,
): Promise<VueConversion | null> {
  const plan = await readPlan(userId, siteId)
  if (plan === null) return null

  const lignes = plan.lignes.filter((ligne) => ligne.engine === 'cro')
  const aTraiter = lignes.filter((ligne) => ligne.state === 'todo' || ligne.state === 'doing')

  const priorites = aTraiter.slice(0, PRIORITES_MAX)
  const dejaVues = new Set(priorites.map((ligne) => ligne.checkId))
  const rapides = aTraiter
    .filter((ligne) => ligne.rapide && !dejaVues.has(ligne.checkId))
    .slice(0, RAPIDES_MAX)

  return {
    auditId: plan.auditId,
    finishedAt: plan.finishedAt,
    lignes,
    priorites,
    rapides,
    reglees: plan.reglees
      .filter((reglee) => reglee.engine === 'cro')
      .map(({ checkId, label, state }) => ({ checkId, label, state })),
  }
}
