import type { PatchOperation } from '@/server/spec/patch'
import type { AppSpec } from '@/server/spec/schema'

/**
 * Quand demander confirmation avant d'appliquer.
 *
 * Le besoin est venu d'un essai réel. Un créateur demande « ajoute un champ métier avec
 * une liste de choix » ; l'agent le rend obligatoire, ce qui est défendable, et ne le dit
 * pas. Le créateur le découvre en modifiant une ancienne fiche que le formulaire refuse
 * désormais d'enregistrer. La modification était bonne ; c'est le silence qui ne l'était
 * pas.
 *
 * D'où cette règle : **les modifications qui engagent, on les annonce ; les autres, on les
 * fait.** Demander confirmation pour « mets le bouton en bleu » transformerait l'atelier en
 * formulaire administratif, et le créateur cliquerait « Appliquer » sans lire — ce qui
 * reviendrait à ne rien annoncer du tout.
 *
 * Trois choses distinguent une modification qui engage.
 *
 * **Elle touche aux données.** Ajouter, retirer ou changer un champ retentit sur toutes les
 * fiches déjà saisies. C'est le cas du champ obligatoire, et c'est le plus important.
 *
 * **Elle supprime.** Une suppression ne se voit pas : une section disparue ne laisse pas de
 * trace à l'écran, et le créateur ne s'en aperçoit que plus tard. Le retour arrière existe,
 * mais encore faut-il savoir qu'il y a quelque chose à défaire.
 *
 * **Elle est large.** Beaucoup d'opérations, ou plusieurs pages à la fois : là, le créateur
 * ne peut pas vérifier d'un coup d'œil que le résultat correspond à ce qu'il voulait.
 *
 * Rien ici ne dépend du modèle : c'est le serveur qui décide, en lisant les opérations
 * proposées. Un agent ne peut donc pas contourner la confirmation en affirmant que sa
 * modification est petite.
 */

/** Au-delà, une modification ne se vérifie plus d'un coup d'œil. */
const BEAUCOUP_D_OPERATIONS = 8

/** Au-delà, la modification ne porte plus sur « une page » mais sur l'application. */
const BEAUCOUP_DE_PAGES = 3

export type PlanVerdict = {
  /** Vrai quand la modification doit être annoncée avant d'être appliquée. */
  required: boolean
  /** Ce qui l'a rendue nécessaire, en français courant. Affiché au créateur tel quel. */
  reasons: string[]
  /** Résumé chiffré de l'ampleur, affiché sous le plan. */
  scale: { operations: number; pages: number; models: number; deletions: number }
}

/** La racine d'un chemin d'opération : `pages[2].blocks[0].title` → `pages`, indice 2. */
function root(path: string): { key: string; index: number | null } {
  const match = /^([a-zA-Z][a-zA-Z0-9_]*)(?:\[(\d+)\])?/.exec(path)
  return {
    key: match?.[1] ?? '',
    index: match?.[2] === undefined ? null : Number(match[2]),
  }
}

export function planVerdict(operations: readonly PatchOperation[]): PlanVerdict {
  const pages = new Set<number>()
  const models = new Set<number>()
  let deletions = 0
  let touchesAuth = false
  let touchesMonetization = false

  for (const operation of operations) {
    const { key, index } = root(operation.path)
    if (operation.op === 'delete') deletions += 1
    if (key === 'pages' && index !== null) pages.add(index)
    if (key === 'dataModels') models.add(index ?? -1)
    if (key === 'auth') touchesAuth = true
    if (key === 'monetization') touchesMonetization = true
  }

  const reasons: string[] = []
  if (models.size > 0) {
    reasons.push(
      "elle modifie la façon dont vos données sont enregistrées, ce qui retentit sur les fiches déjà saisies",
    )
  }
  if (deletions > 0) {
    reasons.push(
      deletions === 1 ? 'elle supprime un élément' : `elle supprime ${deletions} éléments`,
    )
  }
  if (touchesAuth) reasons.push('elle change le fonctionnement des comptes de vos visiteurs')
  if (touchesMonetization) reasons.push('elle touche à ce que vous vendez et à quel prix')
  if (pages.size >= BEAUCOUP_DE_PAGES) reasons.push(`elle modifie ${pages.size} pages à la fois`)
  if (operations.length >= BEAUCOUP_D_OPERATIONS) {
    reasons.push(`elle compte ${operations.length} modifications`)
  }

  return {
    required: reasons.length > 0,
    reasons,
    scale: {
      operations: operations.length,
      pages: pages.size,
      models: models.size,
      deletions,
    },
  }
}

/**
 * Ce que la modification touche, nommé comme le créateur le connaît.
 *
 * Les chemins d'opération sont techniques — `pages[2].blocks[0].title` ne dit rien à
 * personne. On les traduit en noms de pages et de modèles tels qu'ils apparaissent à
 * l'écran. Un plan qu'il faut décoder n'est pas un plan.
 */
export function planTargets(spec: AppSpec, operations: readonly PatchOperation[]): string[] {
  const noms = new Set<string>()
  for (const operation of operations) {
    const { key, index } = root(operation.path)
    if (key === 'pages' && index !== null) {
      const page = spec.pages[index]
      if (page !== undefined) noms.add(`la page « ${page.title} »`)
    } else if (key === 'dataModels' && index !== null) {
      const model = spec.dataModels[index]
      if (model !== undefined) noms.add(`vos données « ${model.labelPlural} »`)
    } else if (key === 'theme') {
      noms.add("l'apparence")
    } else if (key === 'navigation') {
      noms.add('le menu')
    } else if (key === 'auth') {
      noms.add('les comptes visiteurs')
    } else if (key === 'monetization') {
      noms.add('la monétisation')
    }
  }
  return [...noms]
}
