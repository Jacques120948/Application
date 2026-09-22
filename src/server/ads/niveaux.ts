/**
 * À quel étage un relevé se situe, et pourquoi il faut le dire à chaque lecture.
 *
 * Les relevés vivaient dans une seule table à un seul étage : une ligne par campagne et par
 * jour. Meta se lit à trois — campagne, ensemble de publicités, annonce — et les trois
 * partagent désormais la même table, parce que ce sont les mêmes chiffres au même rythme et
 * que trois tables auraient donné trois façons de calculer un CPA.
 *
 * Le piège est immédiat et silencieux. Une somme de dépense qui ne filtre pas l'étage
 * additionne la campagne, ses ensembles et ses annonces : **la même dépense comptée trois
 * fois**. Le total reste un nombre plausible, aucune erreur ne se produit, et le budget
 * mensuel paraît dépassé alors qu'il ne l'est pas — avec, au bout, un garde-fou qui refuse
 * une hausse parfaitement légitime.
 *
 * D'où cette constante plutôt qu'un `groupeId: ''` recopié à chaque requête : elle se
 * cherche, elle se teste, et `tests/unit/ads-niveaux.test.ts` vérifie qu'aucune lecture de
 * `adsReleve` ne l'oublie. Une chaîne vide recopiée à la main ne se serait vue nulle part le
 * jour où quelqu'un aurait écrit la quatrième requête.
 */

/** Les lignes de campagne, seules. Le filtre à poser sur toute somme de compte. */
export const NIVEAU_CAMPAGNE = { groupeId: '', annonceId: '' } as const

/** Les lignes d'un ensemble de publicités : un groupe nommé, aucune annonce. */
export function niveauGroupe(groupeId: string) {
  return { groupeId, annonceId: '' }
}

/** Les lignes d'une annonce précise. */
export function niveauAnnonce(annonceId: string) {
  return { annonceId }
}

/**
 * La fréquence : combien de fois, en moyenne, une même personne a vu la publicité.
 *
 * Calculée, jamais stockée. Meta la rend, et la conserver à côté de ses deux termes
 * garantirait qu'un jour les trois se contredisent — une portée corrigée après coup, une
 * fréquence restée à l'ancienne valeur, et personne pour dire laquelle croire.
 *
 * `0` quand la portée est inconnue, ce qui est le cas de Google : la plateforme ne la donne
 * pas, et l'écran doit alors se taire plutôt qu'afficher une fréquence d'une décimale née
 * d'une division par rien.
 */
export function frequence(impressions: number, portee: number): number {
  if (!Number.isFinite(portee) || portee <= 0) return 0
  if (!Number.isFinite(impressions) || impressions <= 0) return 0
  return Math.round((impressions / portee) * 10) / 10
}
