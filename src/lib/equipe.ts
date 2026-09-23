/**
 * Qui compose l'équipe, et sous quels traits.
 *
 * Ce fichier ne contient que ce qui s'affiche : un prénom, une spécialité, un portrait, une
 * couleur. Ni droits, ni fonctions ouvertes, ni exemples de questions — tout cela relève de
 * la politique du produit et vit dans `server/agents/visibility.ts`, qui construit ses fiches
 * à partir d'ici.
 *
 * La séparation n'est pas une élégance : le menu du studio affiche l'équipe, et un composant
 * de navigateur ne peut pas importer une valeur du serveur — il tirerait la base de données
 * avec lui. Sans ce fichier, il aurait fallu recopier chaque prénom dans le menu, et le
 * jour où l'un change, l'écran en afficherait un que le reste du produit ne connaît plus.
 */

/** Le jeton de couleur d'une pastille. Fond tendre, lettre sombre : lisible partout. */
export type TeinteMembre = 'brand' | 'accent' | 'warm' | 'night' | 'sun' | 'sea'

/**
 * Les identifiants de l'équipe, comme type et comme valeur.
 *
 * Un identifiant mal orthographié ailleurs dans le produit doit se voir à la compilation, pas
 * sur un écran vide : c'est ce que cette union achète.
 */
export const IDS_MEMBRES = [
  'oria',
  'audit',
  'seo',
  'geo',
  'content',
  'cro',
  'ads',
  'meta',
] as const

export type IdMembre = (typeof IDS_MEMBRES)[number]

export type MembreEquipe = {
  id: IdMembre
  /** Prénom affiché. Un interlocuteur se retient mieux qu'un intitulé de fonction. */
  name: string
  /** Sa spécialité, en deux mots. */
  role: string
  /** Portrait. Absent : la pastille à initiale prend le relais. */
  avatar?: string
  tint: TeinteMembre
}

export const MEMBRES: readonly MembreEquipe[] = [
  /*
   * Oria ouvre la liste, et cette liste est l'ordre du menu.
   *
   * Ce n'est pas une préséance décorative : elle est la seule à répondre à « par quoi je
   * commence », et les sept autres répondent à « où en suis-je sur mon sujet ». Quelqu'un
   * qui ouvre le studio se pose la première question ; s'il faut d'abord choisir un
   * spécialiste, on lui demande de savoir ce qu'il vient chercher avant de le lui avoir
   * dit. Les spécialistes restent entiers derrière elle — elle oriente, elle ne remplace
   * personne.
   */
  { id: 'oria', name: 'Oria', role: 'Direction marketing', avatar: '/equipe/oria.webp', tint: 'night' },
  { id: 'audit', name: 'Léa', role: 'Audit', avatar: '/equipe/lea.webp', tint: 'brand' },
  { id: 'seo', name: 'Néo', role: 'Référencement', avatar: '/equipe/neo.webp', tint: 'night' },
  { id: 'geo', name: 'Gia', role: 'Moteurs IA', avatar: '/equipe/gia.webp', tint: 'accent' },
  { id: 'content', name: 'Milo', role: 'Contenu', avatar: '/equipe/milo.webp', tint: 'warm' },
  /*
   * Cleo est placée entre le contenu et la publicité, et l'ordre de cette liste est celui du
   * menu. Ce n'est pas un détail : on attire d'abord (Léa, Néo, Gia, Milo), on transforme
   * ensuite (Cleo), on achète du trafic en dernier (Naya, MIRA). Mettre Cleo après les
   * publicitaires laisserait croire qu'on optimise ce qu'on a payé, alors que son intérêt
   * est justement de passer avant — un visiteur qu'on convertit mieux ne se rachète pas.
   */
  { id: 'cro', name: 'Cleo', role: 'Conversion', avatar: '/equipe/cleo.webp', tint: 'accent' },
  { id: 'ads', name: 'Naya', role: 'Publicité', avatar: '/equipe/naya.webp', tint: 'sun' },
  { id: 'meta', name: 'MIRA', role: 'Meta Ads', avatar: '/equipe/mira.webp', tint: 'sea' },
] as const

export function membre(id: string): MembreEquipe | undefined {
  return MEMBRES.find((un) => un.id === id)
}

/**
 * Où mène chaque membre de l'équipe, et sous quel nom d'écran.
 *
 * Ici plutôt que dans le menu, parce que deux endroits en ont besoin — le menu et la vue
 * d'équipe d'Oria — et que deux tables recopiées finissent par diverger : un jour, le menu
 * envoie Cleo sur son écran et le cockpit sur la conversation.
 *
 * Ceux qui montrent des chiffres ont leur propre écran ; les autres mènent à la
 * conversation, qui est tout ce qu'ils savent faire aujourd'hui. On ne fabrique pas
 * d'écran vide pour l'uniformité.
 */
export function ecranDuMembre(
  id: IdMembre,
  locale: string,
  siteId: string,
): { href: string; ecran: string } {
  const site = siteId === '' ? '' : `?siteId=${siteId}`
  const propres: Partial<Record<IdMembre, { href: string; ecran: string }>> = {
    oria: { href: `/${locale}/oria${site}`, ecran: 'oria' },
    audit: { href: `/${locale}/visibilite${site}`, ecran: 'visibilite' },
    geo: { href: `/${locale}/visibilite/assistants${site}`, ecran: 'assistants' },
    content: { href: `/${locale}/visibilite/articles${site}`, ecran: 'articles' },
    cro: { href: `/${locale}/visibilite/conversion${site}`, ecran: 'conversion' },
    ads: { href: `/${locale}/publicite`, ecran: 'publicite' },
    meta: { href: `/${locale}/publicite/meta`, ecran: 'publicite-meta' },
  }
  return (
    propres[id] ?? {
      href: `/${locale}/visibilite/equipe${site === '' ? `?agent=${id}` : `${site}&agent=${id}`}`,
      ecran: `equipe-${id}`,
    }
  )
}
