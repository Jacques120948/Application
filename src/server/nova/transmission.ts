import { withUserScope } from '@/server/db/scope'

/**
 * Ce que Nova transmet à ses collègues, hors d'Oria.
 *
 * Deux lignes, pour deux spécialistes qui en ont l'usage direct : Gia, qui travaille ce que
 * les assistants IA comprennent du site, reçoit le trafic qu'ils envoient ; Néo, qui travaille
 * le référencement, reçoit les pages de recherche naturelle qui vendent. Lu en base, sur
 * trente jours, sans rien recalculer d'autre : c'est Nova qui mesure, eux qui agissent.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

async function joursRecents(userId: string) {
  const depuis = new Date(Date.now() - 30 * JOUR_MS)
  return withUserScope(userId, (tx) =>
    tx.analyticsJour.findMany({
      where: { userId, jour: { gte: depuis } },
      select: { canaux: true, pagesSeo: true },
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
