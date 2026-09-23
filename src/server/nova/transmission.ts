import { withUserScope } from '@/server/db/scope'
import { estArticle, SESSIONS_CONTENU_MIN } from './contenus'

/**
 * Ce que Nova transmet à ses collègues, hors d'Oria.
 *
 * Une ligne par spécialiste qui en a l'usage direct : Gia, qui travaille ce que les
 * assistants IA comprennent du site, reçoit le trafic qu'ils envoient ; Néo, qui travaille
 * le référencement, reçoit les pages de recherche naturelle qui vendent ; Milo, qui écrit,
 * les articles qui retiennent ; Cleo, qui travaille la conversion, les taux par appareil.
 * Lu en base, sur trente jours, sans rien recalculer d'autre : c'est Nova qui mesure, eux
 * qui agissent.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

async function joursRecents(userId: string) {
  const depuis = new Date(Date.now() - 30 * JOUR_MS)
  return withUserScope(userId, (tx) =>
    tx.analyticsJour.findMany({
      where: { userId, jour: { gte: depuis } },
      select: { canaux: true, pagesSeo: true, pages: true, sessions: true, sessionsEngagees: true, appareils: true },
    }),
  )
}

/** Pour Gia : les visites venues d'assistants IA sur trente jours, ou `null` sans GA4. */
export async function traficAssistantsPourGia(userId: string): Promise<string | null> {
  const jours = await joursRecents(userId).catch(() => [])
  if (jours.length === 0) return null
  const parAssistant = new Map<string, number>()
  let total = 0
  for (const jour of jours) {
    const ia = (jour.canaux as Record<string, { sessions: number; origines?: Record<string, number> }>).ia
    if (ia === undefined) continue
    total += ia.sessions
    for (const [origine, n] of Object.entries(ia.origines ?? {})) {
      const source = origine.split(' / ')[0] ?? origine
      parAssistant.set(source, (parAssistant.get(source) ?? 0) + n)
    }
  }
  if (total === 0) return 'Mesuré par Nova (GA4, 30 jours) : aucune visite venue d’un assistant IA.'
  const detail = [...parAssistant.entries()].sort((a, b) => b[1] - a[1]).map(([source, n]) => `${source} ${n}`).join(', ')
  return `Mesuré par Nova (GA4, 30 jours) : ${total} visites venues d’assistants IA — ${detail}. Ce sont des visites, pas des citations : une IA peut vous citer sans envoyer de visite.`
}

/** Pour Néo : les pages de recherche naturelle qui ont vendu sur trente jours, ou `null` sans GA4. */
export async function pagesSeoPourNeo(userId: string): Promise<string | null> {
  const jours = await joursRecents(userId).catch(() => [])
  if (jours.length === 0) return null
  const pages = new Map<string, { achats: number; revenuCents: number }>()
  for (const jour of jours) {
    for (const page of (jour.pagesSeo ?? []) as { page: string; achats: number; revenuCents: number }[]) {
      const deja = pages.get(page.page) ?? { achats: 0, revenuCents: 0 }
      deja.achats += page.achats
      deja.revenuCents += page.revenuCents
      pages.set(page.page, deja)
    }
  }
  const total = [...pages.values()].reduce((somme, page) => somme + page.revenuCents, 0)
  const vendeuses = [...pages.entries()].filter(([, page]) => page.revenuCents > 0).sort((a, b) => b[1].revenuCents - a[1].revenuCents).slice(0, 5)
  if (vendeuses.length === 0) return 'Mesuré par Nova (GA4, 30 jours) : aucune vente venue de la recherche naturelle.'
  return `Mesuré par Nova (GA4, 30 jours), pages d’entrée de la recherche naturelle qui vendent : ${vendeuses
    .map(([page, valeur]) => `${page} — ${Math.round((valeur.revenuCents / total) * 100)} % du CA organique, ${valeur.achats} achats`)
    .join(' ; ')}. Protège-les en priorité.`
}

/** Pour Milo : les articles par lesquels on entre, et ce qu'ils retiennent, sur trente jours. */
export async function contenusPourMilo(userId: string): Promise<string | null> {
  const jours = await joursRecents(userId).catch(() => [])
  if (jours.length === 0) return null
  const articles = new Map<string, { sessions: number; engagees: number; mesure: boolean; achats: number }>()
  let sessions = 0
  let engagees = 0
  for (const jour of jours) {
    sessions += jour.sessions
    engagees += jour.sessionsEngagees
    for (const page of (jour.pages ?? []) as { page: string; sessions: number; achats: number; engagees?: number }[]) {
      if (!estArticle(page.page)) continue
      const deja = articles.get(page.page) ?? { sessions: 0, engagees: 0, mesure: true, achats: 0 }
      deja.sessions += page.sessions
      deja.achats += page.achats
      if (page.engagees === undefined) deja.mesure = false
      else deja.engagees += page.engagees
      articles.set(page.page, deja)
    }
  }
  const retenus = [...articles.entries()].filter(([, a]) => a.sessions >= SESSIONS_CONTENU_MIN).sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 5)
  if (retenus.length === 0) return 'Mesuré par Nova (GA4, 30 jours) : aucun article de blog n’a amené assez de visites pour être jugé.'
  const moyenne = sessions === 0 ? null : Math.round((engagees / sessions) * 100)
  return `Mesuré par Nova (GA4, 30 jours), articles par lesquels on entre sur le site${moyenne === null ? '' : ` (engagement moyen du site : ${moyenne} %)`} : ${retenus
    .map(([page, a]) => `${page} — ${a.sessions} visites${a.mesure && a.sessions > 0 ? `, ${Math.round((a.engagees / a.sessions) * 100)} % engagées` : ''}${a.achats > 0 ? `, ${a.achats} achats` : ''}`)
    .join(' ; ')}. Un article bien engagé indique un sujet et une forme qui retiennent : c'est une piste, pas une garantie.`
}

/**
 * Pour Cleo : les taux de conversion par appareil sur trente jours, ou `null` sans GA4.
 *
 * Cleo recevait l'interdiction de citer un taux de conversion, parce qu'aucune source n'en
 * donnait. Quand Nova en mesure un, l'interdiction devient fausse : Cleo refuserait de parler
 * d'un chiffre affiché sur l'écran voisin. Achats GA4 ÷ visites GA4, par appareil ; les
 * commandes de la boutique restent la référence du chiffre d'affaires.
 */
export async function conversionPourCleo(userId: string): Promise<string | null> {
  const jours = await joursRecents(userId).catch(() => [])
  if (jours.length === 0) return null
  const parAppareil = new Map<string, { sessions: number; achats: number }>()
  for (const jour of jours) {
    for (const [appareil, ligne] of Object.entries((jour.appareils ?? {}) as Record<string, { sessions: number; achats: number }>)) {
      const deja = parAppareil.get(appareil) ?? { sessions: 0, achats: 0 }
      deja.sessions += ligne.sessions
      deja.achats += ligne.achats
      parAppareil.set(appareil, deja)
    }
  }
  const noms: Record<string, string> = { mobile: 'mobile', desktop: 'ordinateur', tablet: 'tablette' }
  const lignes = [...parAppareil.entries()]
    .filter(([, ligne]) => ligne.sessions >= 100)
    .sort((a, b) => b[1].sessions - a[1].sessions)
    .map(([appareil, ligne]) => `${noms[appareil] ?? appareil} ${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 }).format((ligne.achats / ligne.sessions) * 100)} % (${ligne.sessions} visites)`)
  if (lignes.length === 0) return null
  return `Mesuré par Nova (GA4, 30 jours), taux de conversion par appareil (achats ÷ visites) : ${lignes.join(', ')}. Ce sont les seuls chiffres de conversion dont tu disposes : n’en cite aucun autre, et aucune estimation de gain.`
}
