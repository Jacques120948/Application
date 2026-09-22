/**
 * L'unité dans laquelle Google accepte qu'on lui parle d'argent.
 *
 * Un montant en micros doit être un multiple de « l'unité facturable » de la devise, faute
 * de quoi Google refuse : « Value must be a multiple of billable unit. » Pour le franc,
 * l'euro, le dollar et toutes les devises à deux décimales, cette unité est le centime —
 * dix mille micros.
 *
 * Une médiane ne tombe pas sur un centime rond. Une enchère calculée à 0,375 CHF faisait
 * donc refuser la création entière, avec un message qui ne disait pas quel champ était en
 * cause. D'où cette fonction, appliquée là où le montant naît plutôt qu'au moment de
 * l'envoi : ce que la personne lit à l'écran doit être ce qui part chez Google.
 *
 * Limite assumée : les devises sans décimale — le yen, le won — ont une unité facturable
 * différente. Evoliia ne sert aujourd'hui que des marchés européens et nord-américains, et
 * un arrondi au centime y est juste partout. Le jour où un compte en yens se relie, c'est
 * ici que la table des devises viendra.
 */
export const PAS_FACTURABLE = 10_000

/** Arrondit un montant en micros au centime le plus proche, jamais en dessous de zéro. */
export function auPasFacturable(micros: number): number {
  if (!Number.isFinite(micros) || micros <= 0) return 0
  return Math.round(micros / PAS_FACTURABLE) * PAS_FACTURABLE
}
