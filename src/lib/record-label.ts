import type { DataModel } from '@/server/spec/schema'

/**
 * Le nom d'une fiche, pour la désigner ailleurs.
 *
 * Le modèle peut l'écrire (`labelField`). À défaut, le premier champ texte : c'est presque
 * toujours celui qui nomme. À défaut encore, le premier champ renseigné — mieux vaut un
 * repère imparfait qu'un identifiant que personne ne reconnaît.
 *
 * Vit ici, et non dans le serveur, parce que les deux côtés en ont besoin : le serveur pour
 * résoudre les renvois d'une liste, le navigateur pour remplir la liste de choix d'un
 * formulaire. Deux versions de cette règle finiraient par nommer la même fiche autrement
 * d'un écran à l'autre.
 */
export function recordLabel(model: DataModel, data: Record<string, unknown>): string {
  const champ =
    model.fields.find((field) => field.id === model.labelField) ??
    model.fields.find((field) => field.type === 'text') ??
    model.fields[0]
  const valeur = champ === undefined ? null : data[champ.id]
  return valeur === null || valeur === undefined || valeur === ''
    ? 'Sans nom'
    : String(valeur).slice(0, 120)
}
