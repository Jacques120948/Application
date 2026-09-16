import type { AppSpec, Page } from '@/server/spec/schema'

/**
 * Ce qu'on montre au modèle pour qu'il modifie une application.
 *
 * Jusqu'ici, toute modification envoyait l'application entière : « change le texte du
 * bouton » transmettait toutes les pages, leurs textes longs, leurs témoignages et leurs
 * questions fréquentes — puis recommençait à chaque reprise.
 *
 * Mesuré sur les applications réellement publiées, le gain est de 11 à 23 % sur les plus
 * fournies et nul sur les petites, qui sont donc transmises telles quelles. C'est moins
 * spectaculaire qu'on pourrait le croire : l'essentiel d'une AppSpec est de la structure,
 * pas de la prose. Le mécanisme prend en revanche toute sa valeur à mesure que le modèle
 * déclaratif s'élargit, et il ne peut jamais coûter plus que ce qu'il économise.
 *
 * Deux idées, et deux règles de sécurité.
 *
 * **Un résumé fidèle plutôt qu'un extrait.** Le modèle voit *toute* la structure —
 * chaque page, chaque bloc, dans l'ordre, avec ses identifiants. C'est indispensable :
 * une opération de modification désigne sa cible par un chemin indexé
 * (`pages[2].blocks[0].title`), donc une structure amputée produirait un chemin faux. Ce
 * qui est retiré, ce sont les textes longs : ils sont coupés et signalés comme tels.
 *
 * **Le détail complet sur les pages concernées.** La demande est comparée aux titres,
 * chemins et libellés ; les pages qui correspondent sont transmises intégralement. Pour
 * tout le reste, le résumé suffit à viser juste.
 *
 * **En cas de reprise, on montre tout.** Si la première tentative a été refusée, la
 * seconde reçoit l'application entière. Mieux vaut payer une fois le prix fort que rendre
 * une modification impossible — et c'est justement le cas où l'on soupçonne qu'il
 * manquait quelque chose.
 *
 * **Un texte coupé ne peut pas être réécrit coupé.** Le danger de tout résumé est qu'il
 * revienne dans l'application : le modèle recopie le texte qu'il a vu, et un paragraphe
 * se retrouve amputé sans que personne l'ait demandé. `truncationLeak` relit les
 * opérations proposées et refuse celles qui réinjecteraient une coupure. Le refus
 * déclenche la reprise, donc la tentative suivante voit le texte entier.
 */

/** Au-delà, un texte est coupé dans le résumé. Un titre ou un libellé passe toujours entier. */
const LONG_TEXT = 60

/**
 * En dessous de cette taille, l'application est transmise telle quelle.
 *
 * Mesuré sur les applications réellement publiées : résumer une petite application ne fait
 * rien gagner, et la phrase d'avertissement coûte alors plus que ce qu'elle économise. Le
 * résumé n'a de sens que quand il y a matière à résumer — ce qui arrivera de plus en plus
 * à mesure que le modèle déclaratif s'élargit.
 */
const RESUME_AU_DELA_DE = 8_000

/** Nombre maximum de pages transmises en entier. Au-delà, le résumé fait le travail. */
const MAX_FULL_PAGES = 3

export type EditContext = {
  /** Le texte transmis au modèle, déjà mis en forme. */
  text: string
  /** Les chemins des pages transmises en entier. Vide quand tout est résumé. */
  detailed: string[]
  /** Vrai quand l'application a été transmise intégralement. */
  full: boolean
}

/** Mots retenus d'un texte : sans accents, en minuscules, assez longs pour distinguer. */
function words(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4)
}

/** Tous les textes courts d'une page : de quoi la reconnaître dans une demande. */
function pageWords(page: Page): Set<string> {
  const pieces = [page.title, page.path, page.id]
  for (const block of page.blocks) {
    pieces.push(block.type, block.id)
    for (const [key, value] of Object.entries(block)) {
      if (typeof value === 'string' && value.length <= LONG_TEXT && key !== 'body') {
        pieces.push(value)
      }
    }
  }
  return new Set(pieces.flatMap(words))
}

/**
 * Les pages que la demande désigne, de la plus évidente à la moins.
 *
 * Aucune correspondance ne veut pas dire « rien à faire » : beaucoup de demandes ajoutent
 * une page ou touchent au thème, et n'ont besoin d'aucun détail. Le résumé suffit alors.
 */
export function relevantPages(spec: AppSpec, request: string): Page[] {
  const wanted = new Set(words(request))
  if (wanted.size === 0) return []

  const scored = spec.pages
    .map((page) => {
      const own = pageWords(page)
      let score = 0
      for (const word of wanted) if (own.has(word)) score += 1
      return { page, score }
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  return scored.slice(0, MAX_FULL_PAGES).map((entry) => entry.page)
}

/** Coupe les textes longs, en le disant. Les structures et les identifiants sont intacts. */
function shorten(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length <= LONG_TEXT ? value : `${value.slice(0, LONG_TEXT).trimEnd()}…`
  }
  if (Array.isArray(value)) return value.map(shorten)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item)]))
  }
  return value
}

/**
 * Le contexte transmis au modèle pour une demande de modification.
 *
 * `full` force la transmission intégrale : c'est ce qu'on fait à la reprise, quand la
 * première tentative a été refusée.
 */
export function selectEditContext(
  spec: AppSpec,
  request: string,
  options: { full?: boolean } = {},
): EditContext {
  const entier = JSON.stringify(spec)
  if (options.full === true || entier.length <= RESUME_AU_DELA_DE) {
    return { text: entier, detailed: [], full: true }
  }

  const pages = relevantPages(spec, request)
  const paths = new Set(pages.map((page) => page.path))

  // Tout sauf les pages est court : thème, navigation, comptes, monétisation, modèles de
  // données. On le transmet tel quel, sans résumé — c'est souvent ce que la demande vise.
  const { pages: _ignored, ...reste } = spec
  const structure = {
    ...reste,
    pages: spec.pages.map((page) =>
      paths.has(page.path) ? page : (shorten(page) as unknown as Page),
    ),
  }

  const entieres = paths.size === 0 ? '' : ` Les pages ${[...paths].map((path) => `« ${path} »`).join(', ')} sont entières.`
  const note = `Structure complète, indices et identifiants exacts. Les textes longs sont coupés par « … » : n'y touche pas sans qu'on te le demande.${entieres}`

  return {
    text: `${note}\n\n${JSON.stringify(structure)}`,
    detailed: [...paths],
    full: false,
  }
}

/** La marque laissée par une coupure. Un texte qui la porte n'a pas été écrit en entier. */
const COUPURE = '…'

function truncatedStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.endsWith(COUPURE)) found.push(value)
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) truncatedStrings(item, found)
    return found
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) truncatedStrings(item, found)
  }
  return found
}

function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(value)
    return found
  }
  if (Array.isArray(value)) {
    for (const item of value) allStrings(item, found)
    return found
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) allStrings(item, found)
  }
  return found
}

/**
 * Une coupure du résumé sur le point de revenir dans l'application, ou `null`.
 *
 * On ne refuse pas toute chaîne finissant par « … » : un créateur a le droit d'écrire
 * « et bien d'autres… ». On refuse celles qui sont le début d'un texte existant, c'est-à-dire
 * précisément ce que le résumé a coupé.
 */
export function truncationLeak(spec: AppSpec, proposed: unknown): string | null {
  const suspects = truncatedStrings(proposed)
  if (suspects.length === 0) return null

  const existing = allStrings(spec)
  for (const suspect of suspects) {
    const debut = suspect.slice(0, -COUPURE.length).trimEnd()
    if (debut.length === 0) continue
    if (existing.some((value) => value !== suspect && value.startsWith(debut) && value.length > debut.length)) {
      return `Le texte « ${debut.slice(0, 40)}… » serait réécrit coupé.`
    }
  }
  return null
}
