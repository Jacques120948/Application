import { parse, type HTMLElement } from 'node-html-parser'

/**
 * Ce qu'on retient d'une page.
 *
 * Tout ce qui suit est relevé par du code, jamais par un modèle. C'est la règle la plus
 * rentable du produit : compter des H1, mesurer un titre, constater qu'une balise manque
 * sont des opérations exactes, instantanées et gratuites. Les confier à une IA les rendrait
 * lentes, coûteuses et — c'est le pire — approximatives. L'IA vient après, pour expliquer et
 * pour rédiger, là où elle est irremplaçable.
 *
 * Deux partis pris méritent d'être dits.
 *
 * **On relève, on ne juge pas.** Ce fichier ne sait pas qu'un titre de trois cents signes
 * est mauvais ; il sait qu'il fait trois cents signes. Les seuils vivent dans les contrôles,
 * où ils sont lisibles et modifiables sans toucher à l'extraction.
 *
 * **Ce qui est absent vaut zéro, jamais `undefined`.** Un relevé où tout peut manquer force
 * chaque contrôle à se défendre, et c'est ainsi qu'on oublie un cas.
 */

export type LienReleve = {
  href: string
  /** Adresse absolue résolue contre la page. Vide si elle n'a pas pu l'être. */
  url: string
  texte: string
  interne: boolean
  nofollow: boolean
}

export type ImageRelevee = {
  src: string
  /** `null` quand l'attribut est absent : ce n'est pas la même chose qu'un texte vide. */
  alt: string | null
}

export type Signaux = {
  title: string
  description: string
  /** Les titres, par niveau : `h1` à `h6`. */
  headings: { level: number; text: string }[]
  h1: string[]
  canonical: string
  robotsMeta: string
  lang: string
  /** Texte visible, script et style retirés. */
  text: string
  wordCount: number
  links: LienReleve[]
  images: ImageRelevee[]
  /** Les blocs JSON-LD correctement formés. Les blocs illisibles sont comptés à part. */
  jsonLd: Record<string, unknown>[]
  jsonLdBroken: number
  /** Les types déclarés dans les blocs JSON-LD, à plat. */
  schemaTypes: string[]
  openGraph: Record<string, string>
  /** Nombre de listes, de tableaux et de questions repérées : matière du moteur GEO. */
  lists: number
  tables: number
  /** Éléments de liste, toutes listes confondues. */
  listItems: number
  /** Listes de définitions. Un assistant en reprend volontiers le couple terme–sens. */
  definitions: number
  /** Paragraphes qui disent quelque chose. Ceux d'un mot ne comptent pas. */
  paragraphs: number
  /** Le plus long, en mots. Au-delà d'un certain point, plus rien n'est citable. */
  longestParagraphWords: number
  /**
   * Le premier paragraphe substantiel.
   *
   * C'est ce qu'un assistant lit pour savoir si la page répond à la question posée. Une page
   * qui commence par une mise en bouche sans information se fait écarter avant d'être lue.
   */
  intro: string
  hasViewport: boolean
  /** Date de publication ou de modification déclarée, brute. */
  publishedTime: string
  /** Auteur déclaré, par la méta ou par les données structurées. */
  author: string
}

/** Le texte d'un élément, espaces normalisés. */
function texteDe(element: HTMLElement | null): string {
  if (element === null) return ''
  return element.text.replace(/\s+/g, ' ').trim()
}

function attribut(element: HTMLElement | null, nom: string): string {
  return element?.getAttribute(nom)?.trim() ?? ''
}

/**
 * Les types déclarés par un bloc JSON-LD, y compris ceux de ses graphes.
 *
 * Un `@graph` est la façon normale dont un site sérieux déclare plusieurs entités d'un coup.
 * Ne regarder que le premier niveau reviendrait à annoncer « aucune donnée structurée » à
 * des sites qui en ont plus que la moyenne.
 */
function typesDe(valeur: unknown, sortie: string[], profondeur = 0): void {
  if (profondeur > 6 || valeur === null || typeof valeur !== 'object') return
  if (Array.isArray(valeur)) {
    for (const entree of valeur) typesDe(entree, sortie, profondeur + 1)
    return
  }
  const objet = valeur as Record<string, unknown>
  const type = objet['@type']
  if (typeof type === 'string') sortie.push(type)
  if (Array.isArray(type)) {
    for (const item of type) if (typeof item === 'string') sortie.push(item)
  }
  for (const [cle, sous] of Object.entries(objet)) {
    // On descend dans les graphes et les entités imbriquées, pas dans le texte.
    if (cle === '@context') continue
    if (typeof sous === 'object') typesDe(sous, sortie, profondeur + 1)
  }
}

/**
 * L'auteur déclaré, cherché en profondeur.
 *
 * Comme pour les types, l'auteur d'un article se trouve presque toujours à l'intérieur d'un
 * `@graph` et non au premier niveau. Le chercher seulement en surface reviendrait à conclure
 * « aucun auteur » sur les pages qui en déclarent un dans les règles — et l'auteur est l'un
 * des signaux que les moteurs génératifs regardent le plus.
 */
function auteurDe(valeur: unknown, profondeur = 0): string {
  if (profondeur > 6 || valeur === null || typeof valeur !== 'object') return ''
  if (Array.isArray(valeur)) {
    for (const entree of valeur) {
      const trouve = auteurDe(entree, profondeur + 1)
      if (trouve !== '') return trouve
    }
    return ''
  }
  const objet = valeur as Record<string, unknown>
  const auteur = objet['author']
  if (typeof auteur === 'string' && auteur.trim() !== '') return auteur.trim()
  if (auteur !== null && typeof auteur === 'object') {
    const premier = Array.isArray(auteur) ? auteur[0] : auteur
    const nom = (premier as Record<string, unknown> | undefined)?.['name']
    if (typeof nom === 'string' && nom.trim() !== '') return nom.trim()
  }
  for (const [cle, sous] of Object.entries(objet)) {
    if (cle === '@context') continue
    if (typeof sous === 'object') {
      const trouve = auteurDe(sous, profondeur + 1)
      if (trouve !== '') return trouve
    }
  }
  return ''
}

/** Lit une page et en tire tout ce dont les contrôles auront besoin. */
export function extractSignals(html: string, pageUrl: string): Signaux {
  /*
   * Le contenu des `<script>` est conservé à la lecture, et c'est nécessaire : les données
   * structurées y vivent. Il est retiré plus bas, avant de compter le texte visible — sans
   * quoi le code d'un site moderne compterait pour des milliers de mots de contenu.
   */
  const racine = parse(html, {
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  })

  const base = (() => {
    try {
      return new URL(pageUrl)
    } catch {
      return null
    }
  })()

  const headings: { level: number; text: string }[] = []
  for (let niveau = 1; niveau <= 6; niveau += 1) {
    for (const element of racine.querySelectorAll(`h${niveau}`)) {
      headings.push({ level: niveau, text: texteDe(element) })
    }
  }

  const jsonLd: Record<string, unknown>[] = []
  let jsonLdBroken = 0
  for (const bloc of racine.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const valeur = JSON.parse(bloc.text) as unknown
      if (Array.isArray(valeur)) {
        for (const entree of valeur) {
          if (entree !== null && typeof entree === 'object') {
            jsonLd.push(entree as Record<string, unknown>)
          }
        }
      } else if (valeur !== null && typeof valeur === 'object') {
        jsonLd.push(valeur as Record<string, unknown>)
      }
    } catch {
      // Un bloc illisible est un constat en soi : un moteur ne le lira pas non plus.
      jsonLdBroken += 1
    }
  }
  const schemaTypes: string[] = []
  typesDe(jsonLd, schemaTypes)

  const links: LienReleve[] = []
  for (const element of racine.querySelectorAll('a[href]')) {
    const href = attribut(element, 'href')
    if (href === '' || href.startsWith('#')) continue
    let absolue = ''
    let interne = false
    if (base !== null) {
      try {
        const resolue = new URL(href, base)
        if (resolue.protocol === 'http:' || resolue.protocol === 'https:') {
          resolue.hash = ''
          absolue = resolue.toString()
          interne = resolue.hostname === base.hostname
        }
      } catch {
        // Une adresse illisible reste relevée telle quelle : c'est un constat.
      }
    }
    links.push({
      href,
      url: absolue,
      texte: texteDe(element).slice(0, 200),
      interne,
      nofollow: /\bnofollow\b/i.test(attribut(element, 'rel')),
    })
  }

  const images: ImageRelevee[] = racine.querySelectorAll('img').map((element) => ({
    src: attribut(element, 'src'),
    alt: element.getAttribute('alt') === undefined ? null : (element.getAttribute('alt') ?? ''),
  }))

  const openGraph: Record<string, string> = {}
  for (const element of racine.querySelectorAll('meta[property^="og:"]')) {
    const propriete = attribut(element, 'property')
    if (propriete !== '') openGraph[propriete] = attribut(element, 'content')
  }

  // Le texte visible : sans les scripts ni les styles, qui pèsent lourd et ne se lisent pas.
  for (const element of racine.querySelectorAll('script, style, noscript, template')) {
    element.remove()
  }
  const text = racine.text.replace(/\s+/g, ' ').trim()
  const wordCount = text === '' ? 0 : text.split(' ').length

  /*
   * Les paragraphes, mesurés après le retrait des scripts : sans quoi le code d'un site
   * moderne compterait pour du texte, et le « plus long paragraphe » serait toujours lui.
   */
  const paragraphes = racine
    .querySelectorAll('p')
    .map((element) => texteDe(element))
    .filter((texte) => texte.split(' ').length >= 5)
  const longueurs = paragraphes.map((texte) => texte.split(' ').length)

  const meta = (nom: string): string =>
    attribut(racine.querySelector(`meta[name="${nom}"]`), 'content')
  const metaPropriete = (nom: string): string =>
    attribut(racine.querySelector(`meta[property="${nom}"]`), 'content')

  return {
    title: texteDe(racine.querySelector('title')),
    description: meta('description'),
    headings,
    h1: headings.filter((titre) => titre.level === 1).map((titre) => titre.text),
    canonical: attribut(racine.querySelector('link[rel="canonical"]'), 'href'),
    robotsMeta: meta('robots'),
    lang: attribut(racine.querySelector('html'), 'lang'),
    text,
    wordCount,
    links,
    images,
    jsonLd,
    jsonLdBroken,
    schemaTypes,
    openGraph,
    lists: racine.querySelectorAll('ul, ol').length,
    tables: racine.querySelectorAll('table').length,
    listItems: racine.querySelectorAll('li').length,
    definitions: racine.querySelectorAll('dl').length,
    paragraphs: paragraphes.length,
    longestParagraphWords: longueurs.length === 0 ? 0 : Math.max(...longueurs),
    intro: (paragraphes.find((texte) => texte.length >= 40) ?? '').slice(0, 400),
    hasViewport: racine.querySelector('meta[name="viewport"]') !== null,
    publishedTime:
      metaPropriete('article:published_time') ||
      metaPropriete('article:modified_time') ||
      attribut(racine.querySelector('time[datetime]'), 'datetime'),
    author: meta('author') || auteurDe(jsonLd),
  }
}
