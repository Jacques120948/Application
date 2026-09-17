import { USER_AGENT } from './net'

/**
 * Ce que le site nous autorise à lire.
 *
 * Evoliia explore des sites qu'elle ne possède pas. Respecter `robots.txt` n'est donc pas
 * une politesse mais la condition pour que ce robot soit fréquentable : un robot qui passe
 * outre finit bloqué par les hébergeurs, et fait porter à Evoliia la responsabilité de ce
 * que ses utilisateurs lui font explorer.
 *
 * L'analyse est volontairement simple et son parti pris est clair : **en cas de doute, on
 * s'interdit.** Un fichier qu'on ne comprend pas, un motif exotique, une ligne malformée —
 * chaque fois, la règle la plus restrictive gagne. Manquer une page coûte un constat ;
 * explorer une page interdite coûte la réputation du robot.
 *
 * Deux exceptions notables, et elles sont assumées. `Crawl-delay` est lu et appliqué, borné
 * pour qu'un site ne puisse pas immobiliser un audit pendant une heure. Les cartes de site
 * sont relevées : elles sont la meilleure porte d'entrée qui soit, bien meilleure que de
 * suivre des liens au hasard.
 */

export type Robots = {
  /** Vrai si le chemin peut être exploré par notre robot. */
  allows: (path: string) => boolean
  /** Délai demandé entre deux requêtes, en millisecondes. Borné. */
  delayMs: number
  /** Cartes de site déclarées. */
  sitemaps: readonly string[]
  /**
   * Les assistants génératifs que ce fichier écarte nommément, par nom d'usage.
   *
   * Beaucoup de sites portent ces lignes sans le savoir : un thème, une extension ou un
   * hébergeur les ajoute par défaut. Elles ne changent rien au référencement classique et
   * suffisent à retirer le site des réponses de ChatGPT ou de Perplexity — c'est le constat
   * GEO le plus utile qu'un fichier de trois lignes puisse donner.
   */
  aiBlocked: readonly string[]
}

/** Politesse par défaut : assez lent pour ne gêner personne, assez vif pour finir. */
export const DEFAULT_DELAY_MS = 500

/** Un site ne doit pas pouvoir immobiliser un audit : au-delà, on plafonne. */
export const MAX_DELAY_MS = 5_000

/** Tout est permis. Ce qu'on applique quand le fichier n'existe pas — ce qui est la norme. */
export const ROBOTS_OUVERT: Robots = {
  allows: () => true,
  delayMs: DEFAULT_DELAY_MS,
  sitemaps: [],
  aiBlocked: [],
}

/** Rien n'est permis. Ce qu'on applique quand le fichier nous exclut. */
export const ROBOTS_FERME: Robots = {
  allows: () => false,
  delayMs: DEFAULT_DELAY_MS,
  sitemaps: [],
  aiBlocked: [],
}

/** Le nom sous lequel notre robot se reconnaît dans un `robots.txt`. */
const NOTRE_NOM = USER_AGENT.split('/')[0]?.toLowerCase() ?? 'evoliiabot'

type Groupe = { agents: string[]; allow: string[]; disallow: string[]; delay: number | null }

/**
 * Un motif de `robots.txt` appliqué à un chemin.
 *
 * Deux caractères spéciaux seulement, parce que ce sont les deux que la pratique a retenus :
 * `*` pour n'importe quelle suite, `$` pour la fin du chemin. Tout le reste est littéral.
 */
function motifCorrespond(motif: string, chemin: string): boolean {
  if (motif === '') return false
  const ancre = motif.endsWith('$')
  const corps = ancre ? motif.slice(0, -1) : motif
  const morceaux = corps.split('*')
  let position = 0
  for (let index = 0; index < morceaux.length; index += 1) {
    const morceau = morceaux[index] as string
    if (morceau === '') continue
    const trouve = index === 0 ? (chemin.startsWith(morceau) ? 0 : -1) : chemin.indexOf(morceau, position)
    if (trouve === -1) return false
    position = trouve + morceau.length
  }
  if (!ancre) return true
  return position === chemin.length
}

/**
 * Les robots des assistants, et l'assistant auquel chacun sert.
 *
 * On raisonne par nom d'usage plutôt que par robot : dire « ChatGPT » à quelqu'un lui parle,
 * « OAI-SearchBot » ne lui parle pas. Plusieurs robots peuvent désigner le même assistant, et
 * en bloquer un seul suffit à se priver d'une partie des réponses.
 */
const ROBOTS_IA: Record<string, string> = {
  gptbot: 'ChatGPT',
  'oai-searchbot': 'ChatGPT',
  'chatgpt-user': 'ChatGPT',
  claudebot: 'Claude',
  'claude-web': 'Claude',
  'anthropic-ai': 'Claude',
  perplexitybot: 'Perplexity',
  'perplexity-user': 'Perplexity',
  'google-extended': 'Gemini',
  'applebot-extended': 'Apple',
  'meta-externalagent': 'Meta AI',
  facebookbot: 'Meta AI',
  bytespider: 'Doubao',
  ccbot: 'Common Crawl',
}

/** Vrai si ce groupe de règles ferme la racine du site. */
function fermeLaRacine(groupe: Groupe): boolean {
  const meilleurAllow = groupe.allow
    .filter((motif) => motifCorrespond(motif, '/'))
    .reduce((max, motif) => Math.max(max, motif.length), -1)
  const meilleurDisallow = groupe.disallow
    .filter((motif) => motif !== '' && motifCorrespond(motif, '/'))
    .reduce((max, motif) => Math.max(max, motif.length), -1)
  if (meilleurDisallow === -1) return false
  return meilleurAllow < meilleurDisallow
}

/**
 * Lit un `robots.txt`.
 *
 * Les groupes qui nous nomment l'emportent sur le groupe générique : c'est la règle du
 * format, et c'est aussi ce qui permet à un site de nous traiter à part.
 */
export function parseRobots(texte: string): Robots {
  const groupes: Groupe[] = []
  const sitemaps: string[] = []
  let courant: Groupe | null = null
  let dernierEtaitAgent = false

  for (const ligneBrute of texte.split(/\r?\n/)) {
    const ligne = (ligneBrute.split('#')[0] ?? '').trim()
    if (ligne === '') continue
    const separateur = ligne.indexOf(':')
    if (separateur === -1) continue
    const champ = ligne.slice(0, separateur).trim().toLowerCase()
    const valeur = ligne.slice(separateur + 1).trim()

    if (champ === 'sitemap') {
      if (valeur !== '') sitemaps.push(valeur)
      continue
    }
    if (champ === 'user-agent') {
      // Plusieurs agents d'affilée partagent le même groupe de règles.
      if (courant === null || !dernierEtaitAgent) {
        courant = { agents: [], allow: [], disallow: [], delay: null }
        groupes.push(courant)
      }
      courant.agents.push(valeur.toLowerCase())
      dernierEtaitAgent = true
      continue
    }
    dernierEtaitAgent = false
    if (courant === null) continue
    if (champ === 'allow') courant.allow.push(valeur)
    else if (champ === 'disallow') courant.disallow.push(valeur)
    else if (champ === 'crawl-delay') {
      const secondes = Number(valeur.replace(',', '.'))
      if (Number.isFinite(secondes) && secondes >= 0) courant.delay = secondes * 1000
    }
  }

  /*
   * Seuls les groupes qui nomment un robot d'assistant comptent. Un `User-agent: *` fermé
   * bloquerait aussi notre propre exploration : l'audit s'arrêterait avant d'en arriver là,
   * et le dire ici en ferait un reproche adressé deux fois.
   */
  const bloques = new Set<string>()
  for (const groupe of groupes) {
    if (!fermeLaRacine(groupe)) continue
    for (const agent of groupe.agents) {
      const assistant = ROBOTS_IA[agent]
      if (assistant !== undefined) bloques.add(assistant)
    }
  }
  const aiBlocked = [...bloques].sort()

  const nous = groupes.filter((groupe) => groupe.agents.includes(NOTRE_NOM))
  const generiques = groupes.filter((groupe) => groupe.agents.includes('*'))
  const retenus = nous.length > 0 ? nous : generiques
  if (retenus.length === 0) return { ...ROBOTS_OUVERT, sitemaps, aiBlocked }

  const allow = retenus.flatMap((groupe) => groupe.allow).filter((motif) => motif !== '')
  const disallow = retenus.flatMap((groupe) => groupe.disallow).filter((motif) => motif !== '')
  const delais = retenus.map((groupe) => groupe.delay).filter((valeur) => valeur !== null)
  const delayMs = Math.min(MAX_DELAY_MS, Math.max(DEFAULT_DELAY_MS, ...delais))

  return {
    /*
     * Le motif le plus long l'emporte, et `Allow` l'emporte à longueur égale. C'est la règle
     * que suivent les moteurs, et elle a une raison d'être : `Disallow: /` suivi de
     * `Allow: /boutique` est la façon normale d'ouvrir une seule partie d'un site.
     */
    allows: (chemin: string) => {
      const meilleurAllow = allow
        .filter((motif) => motifCorrespond(motif, chemin))
        .reduce((max, motif) => Math.max(max, motif.length), -1)
      const meilleurDisallow = disallow
        .filter((motif) => motifCorrespond(motif, chemin))
        .reduce((max, motif) => Math.max(max, motif.length), -1)
      if (meilleurDisallow === -1) return true
      return meilleurAllow >= meilleurDisallow
    },
    delayMs,
    sitemaps,
    aiBlocked,
  }
}
