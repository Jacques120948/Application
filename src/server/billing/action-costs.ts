import { readSetting } from '@/server/settings/store'

/**
 * Ce que coûte chaque action, en crédits.
 *
 * La règle qui décide de tout le reste : **ce qui se compte ne se paie pas.** Un H1 absent,
 * un titre trop long, une image sans texte alternatif, une balise manquante, une erreur de
 * serveur — tout cela se constate par du calcul, en quelques millisecondes et sans appeler
 * personne. Le faire payer reviendrait à facturer une addition.
 *
 * Les crédits ne partent que lorsqu'un modèle travaille vraiment : rédiger, reformuler,
 * expliquer, juger un contenu. C'est la seule dépense réelle d'Evoliia, et c'est donc la
 * seule qui se répercute.
 *
 * Les fourchettes ci-dessous sont indicatives et servent à annoncer un ordre de grandeur
 * avant de lancer une action. Le débit réel, lui, est mesuré sur les jetons réellement
 * consommés : personne n'est facturé sur une estimation.
 */

export type ActionCost = {
  /**
   * Identifiant stable, et c'est lui qui relie une action de l'écran à sa fourchette.
   *
   * Il désigne une famille de travail — réécrire une méta, rédiger une FAQ, écrire un
   * article — et non une opération technique : l'exploitant règle un prix pour ce que la
   * personne demande, pas pour la façon dont c'est exécuté.
   */
  id: string
  /** Ce que la personne demande, dit comme elle le dirait. */
  label: string
  min: number
  max: number
}

/**
 * Valeurs de départ, à l'échelle de ce qu'un modèle rend pour chacune.
 *
 * Un titre est une phrase ; un article est une page. Il serait absurde qu'ils coûtent la
 * même chose, et la grille doit se comprendre sans explication : plus le texte rendu est
 * long, plus il coûte.
 *
 * La fourchette de l'article vient de mesures, pas d'une estimation : les trois premiers
 * écrits en production ont coûté 8, 8 et 10 crédits, pour 441, 526 et 759 mots. Elle
 * annonçait 15 à 30, et aucun n'y entrait — une annonce trop haute n'est pas une prudence,
 * c'est ce qui fait renoncer à une action deux fois moins chère qu'annoncée.
 *
 * Le plancher est donc ce qui a été observé, et le plafond laisse la place à un article
 * long sans mentir : le coût suit bien moins la longueur qu'on ne le croit, parce que
 * l'essentiel est le contexte envoyé — les pages du site, les constats, les recherches —
 * qui ne varie pas. Un article deux fois plus long ne coûte pas deux fois plus.
 *
 * Ces valeurs ne servent qu'aux installations neuves : l'exploitant les règle depuis le
 * back-office, et son réglage prend le pas sur celles-ci.
 */
export const DEFAULT_ACTION_COSTS: readonly ActionCost[] = [
  { id: 'meta', label: 'Réécrire un titre ou une description', min: 1, max: 1 },
  { id: 'analyse', label: 'Analyser le contenu d’une page en détail', min: 2, max: 3 },
  { id: 'faq', label: 'Rédiger une foire aux questions', min: 3, max: 5 },
  { id: 'page', label: 'Améliorer une page entière', min: 5, max: 10 },
  { id: 'article', label: 'Écrire un article', min: 8, max: 20 },
  /*
   * Le relevé de visibilité dans les assistants, facturé à la question posée.
   *
   * Ce coût n'est pas fait de jetons mais d'appels payants à des plateformes extérieures :
   * une question est posée plusieurs fois, sur plusieurs assistants, et chaque interrogation
   * a un prix. La fourchette est fixe parce que le nombre d'interrogations l'est aussi — le
   * nombre de plateformes et de répétitions est une décision d'Evoliia, pas de la personne,
   * et lui facturer nos réglages serait malhonnête.
   */
  { id: 'visibilite-ia', label: 'Mesurer une question dans les assistants', min: 3, max: 3 },
  /*
   * Le point hebdomadaire : un long contexte lu, une réponse courte. Son coût est celui de
   * la lecture, pas de l'écriture — d'où une fourchette étroite malgré la portée.
   */
  { id: 'point', label: 'Le point hebdomadaire de Léa', min: 3, max: 6 },
]

/** Clé de réglage : les fourchettes annoncées, en JSON. */
export const ACTION_COSTS_SETTING = 'billing.action.costs'

type CoutBrut = Partial<Record<keyof ActionCost, unknown>>

/**
 * Lit une ligne venue du réglage.
 *
 * Ce qui ne ressemble pas à une fourchette est écarté plutôt que rattrapé : un maximum
 * inférieur au minimum, affiché tel quel, ferait douter de tout le reste de la grille.
 */
function lireCout(valeur: unknown): ActionCost | null {
  if (valeur === null || typeof valeur !== 'object') return null
  const brut = valeur as CoutBrut
  const id = typeof brut.id === 'string' ? brut.id.trim() : ''
  const label = typeof brut.label === 'string' ? brut.label.trim() : ''
  const min = Number(brut.min)
  const max = Number(brut.max)
  if (id === '' || label === '') return null
  if (!Number.isInteger(min) || min < 0) return null
  if (!Number.isInteger(max) || max < min) return null
  return { id, label, min, max }
}

/**
 * Les fourchettes en vigueur.
 *
 * Elles sont annoncées avant chaque action, et elles n'ont rien à faire dans le code : un
 * exploitant qui ajuste ses prix ne doit pas attendre un déploiement. Un réglage illisible
 * n'éteint pas la fonction — on retombe sur les valeurs de départ, parce qu'une erreur de
 * saisie ne doit pas faire disparaître le prix annoncé.
 *
 * Ce qui est annoncé n'est jamais ce qui est débité : le débit suit les jetons réellement
 * consommés. La fourchette sert à décider, pas à facturer.
 */
export async function actionCosts(): Promise<readonly ActionCost[]> {
  const brut = await readSetting(ACTION_COSTS_SETTING)
  if (brut === null || brut.trim() === '') return DEFAULT_ACTION_COSTS
  try {
    const valeur: unknown = JSON.parse(brut)
    if (!Array.isArray(valeur)) return DEFAULT_ACTION_COSTS
    const couts = valeur.map(lireCout).filter((cout): cout is ActionCost => cout !== null)
    return couts.length > 0 ? couts : DEFAULT_ACTION_COSTS
  } catch {
    return DEFAULT_ACTION_COSTS
  }
}

/** La fourchette d'une action, ou `null` si l'exploitant l'a retirée du catalogue. */
export async function actionCost(id: string): Promise<ActionCost | null> {
  return (await actionCosts()).find((cout) => cout.id === id) ?? null
}

/** Ce qui ne coûte rien, et qu'il faut dire aussi clairement que ce qui coûte. */
export const FREE_ACTIONS: readonly string[] = [
  'Parcourir votre site',
  'Tous les contrôles techniques',
  'Les deux notes sur 100',
  'Le classement des priorités',
  'L’historique de vos audits',
]
