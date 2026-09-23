import type { CanalNova } from '@/lib/nova'
import type { LigneRapport } from '@/server/integrations/providers/google-analytics'
import { canalGa4 } from './canaux'

/**
 * Des rapports GA4 aux journées : ce qui est conservé des visites.
 *
 * Trois formes, et aucune ne porte un visiteur : les totaux du jour par canal et par
 * appareil, et les pages d'entrée les plus visitées — toutes canaux confondus, puis pour la
 * seule recherche naturelle, qui est ce que Néo veut savoir.
 */

export type CanalVisites = { sessions: number; achats: number; revenuCents: number; origines: Record<string, number> }
export type AppareilVisites = { sessions: number; achats: number }
/** `engagees` : absent pour les jours lus avant la V4, où GA4 ne le donnait pas par page. */
export type PageVisites = { page: string; sessions: number; achats: number; revenuCents: number; engagees?: number }

/** Sessions et achats d'un segment (un pays, les nouveaux visiteurs…). */
export type Segment = { sessions: number; achats: number }
/** Un événement clé de GA4 (formulaire, contact, inscription…) : combien de fois, et par quel canal. */
export type EvenementCle = { total: number; canaux: Partial<Record<CanalNova, number>> }

export type JourVisites = {
  jour: string
  sessions: number
  sessionsEngagees: number
  achats: number
  revenuCents: number
  canaux: Partial<Record<CanalNova, CanalVisites>>
  appareils: Record<string, AppareilVisites>
  pages: PageVisites[]
  pagesSeo: PageVisites[]
  /** Par pays (code ISO), les plus visités ; le reste dans « ZZ ». Vide pour les jours lus avant la V6. */
  pays: Record<string, Segment>
  /** Nouveaux visiteurs et visiteurs déjà venus. */
  visiteurs: { nouveaux?: Segment; connus?: Segment }
  /** Les événements clés du jour, par nom. */
  evenements: Record<string, EvenementCle>
}

/** Les dimensions et métriques demandées, dans l'ordre où les rapports les rendent. */
export const DIMENSIONS_CANAUX = ['date', 'sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium', 'deviceCategory']
export const DIMENSIONS_PAGES = ['date', 'landingPage']
export const METRIQUES = ['sessions', 'engagedSessions', 'ecommercePurchases', 'purchaseRevenue']
export const METRIQUES_PAGES = ['sessions', 'ecommercePurchases', 'purchaseRevenue', 'engagedSessions']
export const DIMENSIONS_AUDIENCES = ['date', 'countryId', 'newVsReturning']
export const METRIQUES_AUDIENCES = ['sessions', 'ecommercePurchases']
export const DIMENSIONS_EVENEMENTS = ['date', 'eventName', 'sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium']
export const METRIQUES_EVENEMENTS = ['keyEvents']

/** Les pays gardés par jour. Au-delà, ils sont regroupés : une ligne par pays du monde ne dit rien. */
const PAYS_PAR_JOUR = 25
/** Le code sous lequel se rangent les pays regroupés, et ceux que GA4 ne sait pas situer. */
export const AUTRES_PAYS = 'ZZ'

/** Les pages gardées par jour : les plus visitées, et toutes celles qui ont vendu. */
const PAGES_PAR_JOUR = 30

/** « 20260922 » → « 2026-09-22 ». Illisible : `null`. */
export function dateGa4(brut: string): string | null {
  return /^\d{8}$/u.test(brut) ? `${brut.slice(0, 4)}-${brut.slice(4, 6)}-${brut.slice(6, 8)}` : null
}

function centimes(valeur: number): number {
  return Math.round(valeur * 100)
}

function nouveauJour(jour: string): JourVisites {
  return {
    jour,
    sessions: 0,
    sessionsEngagees: 0,
    achats: 0,
    revenuCents: 0,
    canaux: {},
    appareils: {},
    pages: [],
    pagesSeo: [],
    pays: {},
    visiteurs: {},
    evenements: {},
  }
}

function garderPages(lignes: LigneRapport[]): Map<string, PageVisites[]> {
  const parJour = new Map<string, PageVisites[]>()
  for (const ligne of lignes) {
    const jour = dateGa4(ligne.dimensions[0] ?? '')
    if (jour === null) continue
    const [sessions = 0, achats = 0, revenu = 0, engagees] = ligne.metriques
    const page = (ligne.dimensions[1] ?? '').slice(0, 300) || '(inconnue)'
    parJour.set(jour, [
      ...(parJour.get(jour) ?? []),
      { page, sessions, achats, revenuCents: centimes(revenu), ...(engagees === undefined ? {} : { engagees }) },
    ])
  }
  for (const [jour, pages] of parJour) {
    const triees = [...pages].sort((une, autre) => autre.sessions - une.sessions)
    const gardees = [...triees.slice(0, PAGES_PAR_JOUR), ...triees.slice(PAGES_PAR_JOUR).filter((page) => page.achats > 0)]
    parJour.set(jour, gardees)
  }
  return parJour
}

function ajouter(cible: Record<string, Segment>, cle: string, sessions: number, achats: number): void {
  const deja = cible[cle] ?? { sessions: 0, achats: 0 }
  deja.sessions += sessions
  deja.achats += achats
  cible[cle] = deja
}

export function agregerVisites(
  canaux: LigneRapport[],
  pages: LigneRapport[],
  pagesSeo: LigneRapport[],
  audiences: LigneRapport[] = [],
  evenements: LigneRapport[] = [],
): JourVisites[] {
  const jours = new Map<string, JourVisites>()
  for (const ligne of canaux) {
    const jour = dateGa4(ligne.dimensions[0] ?? '')
    if (jour === null) continue
    const [groupe = '', source = '', medium = '', appareil = ''] = ligne.dimensions.slice(1)
    const [sessions = 0, engagees = 0, achats = 0, revenu = 0] = ligne.metriques
    const courant = jours.get(jour) ?? nouveauJour(jour)
    courant.sessions += sessions
    courant.sessionsEngagees += engagees
    courant.achats += achats
    courant.revenuCents += centimes(revenu)

    const { canal, origine } = canalGa4(groupe, source === '(direct)' ? '' : source, medium === '(none)' ? '' : medium)
    const deja = courant.canaux[canal] ?? { sessions: 0, achats: 0, revenuCents: 0, origines: {} }
    deja.sessions += sessions
    deja.achats += achats
    deja.revenuCents += centimes(revenu)
    deja.origines[origine] = (deja.origines[origine] ?? 0) + sessions
    courant.canaux[canal] = deja

    const cle = appareil === '' ? 'autre' : appareil.toLowerCase()
    const app = courant.appareils[cle] ?? { sessions: 0, achats: 0 }
    app.sessions += sessions
    app.achats += achats
    courant.appareils[cle] = app
    jours.set(jour, courant)
  }
  const toutes = garderPages(pages)
  const seo = garderPages(pagesSeo)
  for (const [jour, liste] of toutes) {
    const courant = jours.get(jour) ?? nouveauJour(jour)
    courant.pages = liste
    jours.set(jour, courant)
  }
  for (const [jour, liste] of seo) {
    const courant = jours.get(jour) ?? nouveauJour(jour)
    courant.pagesSeo = liste
    jours.set(jour, courant)
  }
  for (const ligne of audiences) {
    const jour = dateGa4(ligne.dimensions[0] ?? '')
    if (jour === null) continue
    const [code = '', type = ''] = ligne.dimensions.slice(1)
    const [sessions = 0, achats = 0] = ligne.metriques
    const courant = jours.get(jour) ?? nouveauJour(jour)
    ajouter(courant.pays, /^[A-Z]{2}$/u.test(code) ? code : AUTRES_PAYS, sessions, achats)
    if (type === 'new' || type === 'returning') {
      const visiteurs = courant.visiteurs as Record<string, Segment>
      ajouter(visiteurs, type === 'new' ? 'nouveaux' : 'connus', sessions, achats)
    }
    jours.set(jour, courant)
  }
  // Les pays les plus visités de chaque jour ; les autres se regroupent.
  for (const courant of jours.values()) {
    const tries = Object.entries(courant.pays).sort((un, autre) => autre[1].sessions - un[1].sessions)
    if (tries.length <= PAYS_PAR_JOUR) continue
    const gardes: Record<string, Segment> = Object.fromEntries(tries.slice(0, PAYS_PAR_JOUR))
    for (const [, segment] of tries.slice(PAYS_PAR_JOUR)) ajouter(gardes, AUTRES_PAYS, segment.sessions, segment.achats)
    courant.pays = gardes
  }
  for (const ligne of evenements) {
    const jour = dateGa4(ligne.dimensions[0] ?? '')
    if (jour === null) continue
    const [nom = '', groupe = '', source = '', medium = ''] = ligne.dimensions.slice(1)
    const [cles = 0] = ligne.metriques
    if (cles <= 0 || nom === '') continue
    const courant = jours.get(jour) ?? nouveauJour(jour)
    const { canal } = canalGa4(groupe, source === '(direct)' ? '' : source, medium === '(none)' ? '' : medium)
    const evenement = courant.evenements[nom.slice(0, 80)] ?? { total: 0, canaux: {} }
    evenement.total += cles
    evenement.canaux[canal] = (evenement.canaux[canal] ?? 0) + cles
    courant.evenements[nom.slice(0, 80)] = evenement
    jours.set(jour, courant)
  }
  return [...jours.values()].sort((un, autre) => un.jour.localeCompare(autre.jour))
}
