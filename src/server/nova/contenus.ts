import type { CumulVisites } from './metriques'

/**
 * Les contenus qui attirent un trafic qualifié : ce que Milo peut reproduire.
 *
 * Un article se juge rarement à ses ventes directes — on le lit avant d'acheter, pas en
 * achetant. Nova regarde donc d'abord l'engagement (la part des visites qui restent, lisent,
 * cliquent : la mesure « session engagée » de GA4), comparé à la moyenne du site, puis les
 * achats quand il y en a. Seules les pages d'entrée d'un blog comptent ; une page produit
 * n'est pas un contenu éditorial, et la mêler fausserait la moyenne.
 */

export type LigneContenu = {
  page: string
  sessions: number
  /** Part des visites engagées, de 0 à 1. `null` : GA4 ne l'a pas donnée pour toute la période. */
  engagement: number | null
  achats: number
  revenu: number
}

export type Contenus = {
  lignes: LigneContenu[]
  /** Engagement moyen de tout le site sur la période, pour situer chaque article. */
  engagementSite: number | null
}

/** Shopify range ses articles sous /blogs/…, la plupart des autres sous /blog/… */
const BLOG = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?blogs?\/[^/?#]+\/[^/?#]+|^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?blog\/[^/?#]+/iu

/** En deçà, un taux d'engagement ne dit rien d'un article. */
export const SESSIONS_CONTENU_MIN = 30

export function estArticle(page: string): boolean {
  return BLOG.test(page)
}

export function contenusQuiAttirent(visites: CumulVisites | null, max = 8): Contenus {
  if (visites === null) return { lignes: [], engagementSite: null }
  const lignes = visites.pages
    .filter((page) => estArticle(page.page) && page.sessions >= SESSIONS_CONTENU_MIN)
    .map((page) => ({
      page: page.page,
      sessions: page.sessions,
      engagement: page.engagees === undefined || page.sessions === 0 ? null : page.engagees / page.sessions,
      achats: page.achats,
      revenu: page.revenu,
    }))
    .sort((une, autre) => autre.sessions - une.sessions)
    .slice(0, max)
  return { lignes, engagementSite: visites.sessions === 0 ? null : visites.sessionsEngagees / visites.sessions }
}

/**
 * L'article qui attire le trafic le plus qualifié : au moins cinquante visites, et un
 * engagement nettement au-dessus du site (dix points ou plus). C'est un fait mesuré ; ce qui
 * en fait le succès — le sujet, le ton, la forme — reste à comprendre, et c'est le métier de Milo.
 */
export function contenuQualifie(contenus: Contenus): LigneContenu | null {
  if (contenus.engagementSite === null) return null
  const site = contenus.engagementSite
  return (
    contenus.lignes
      .filter((ligne) => ligne.sessions >= 50 && ligne.engagement !== null && ligne.engagement - site >= 0.1)
      .sort((une, autre) => autre.engagement! * autre.sessions - une.engagement! * une.sessions)[0] ?? null
  )
}
