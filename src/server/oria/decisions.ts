import { findCheck } from '@/server/audit/scoring'
import { withUserScope } from '@/server/db/scope'
import type { VisibilityAgentId } from '@/server/agents/visibility'
import { OBJETS_MODIFIES } from './activite'
import { cumulSur, sensDe, type Cumul, type Resultat } from './rapport'

/**
 * Le journal des décisions, et ce qu'on a observé après chacune.
 *
 * **Il n'y a pas de table des décisions.** Chaque décision est déjà enregistrée là où elle
 * a été prise : une modification publicitaire validée dans le journal de Naya ou de MIRA,
 * une correction marquée faite dans le plan d'action, un article déposé dans Shopify, une
 * recommandation écartée. Recopier tout cela dans une table d'Oria ferait deux vérités qui
 * finiraient par diverger — et le jour où l'on défait une modification chez MIRA, le
 * journal d'Oria continuerait de dire qu'elle a été faite. On lit donc à la source.
 *
 * **L'impact est une évolution observée, jamais un effet.** Pour chaque décision, on
 * compare une fenêtre avant et une fenêtre après, de même longueur, en sautant le jour de
 * la décision lui-même — il mélangerait les deux états. On écrit ce qu'on voit, avec le
 * mot « après » et jamais « grâce à » : sur une semaine, une campagne bouge pour cent
 * raisons, et personne ne peut isoler la part d'une modification. Le cahier des charges
 * le demande ; c'est surtout ce qui permet de continuer à faire confiance au journal le
 * jour où une évolution favorable s'avère n'avoir rien dû à la décision.
 *
 * **Tant que la fenêtre d'après n'est pas écoulée, on attend.** Une mesure sur trois jours
 * présentée comme une mesure sur sept serait la façon la plus sûre de conclure trop tôt.
 * L'écran dit quand elle sera disponible.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

/** Les fenêtres de mesure, en jours. Plus longues pour ce qui agit lentement. */
export const FENETRES = {
  /** Une modification publicitaire se lit en une semaine : la diffusion réagit vite. */
  publicite: 7,
  /** Un article met des semaines à être trouvé : deux semaines sont un minimum. */
  article: 14,
} as const

/** Jusqu'où remonte le journal. Au-delà, on ne se souvient plus pourquoi. */
const JOURNAL_JOURS = 90

const JOURNAL_MAX = 40

export type Impact =
  | { etat: 'mesure'; mesures: Resultat[]; fenetre: string; portee: string }
  /** `disponibleLe` : quand la mesure sera possible, ou `null` quand cela dépend d'un événement. */
  | { etat: 'en-attente'; disponibleLe: Date | null; raison: string }
  | { etat: 'indisponible'; raison: string }

export type Decision = {
  cle: string
  quand: Date
  /** Ce qui a été fait de la proposition. */
  genre: 'appliquee' | 'corrigee' | 'publiee' | 'ecartee' | 'annulee'
  /** Ce qui a été décidé, en une phrase. */
  quoi: string
  /** Qui l'avait proposé. */
  proposePar: readonly VisibilityAgentId[]
  /** `null` pour ce qui a été écarté : rien n'a changé, il n'y a rien à mesurer. */
  impact: Impact | null
}

/**
 * Les deux fenêtres autour d'une décision.
 *
 * Le jour de la décision est sauté : il contient une partie de l'état d'avant et une
 * partie de celui d'après, et le compter d'un côté fausserait l'autre.
 */
export function fenetresAutour(quand: Date, jours: number) {
  const jour = new Date(Date.UTC(quand.getUTCFullYear(), quand.getUTCMonth(), quand.getUTCDate()))
  return {
    avant: { depuis: new Date(+jour - jours * JOUR_MS), jusqua: jour },
    apres: { depuis: new Date(+jour + JOUR_MS), jusqua: new Date(+jour + (jours + 1) * JOUR_MS) },
  }
}

/**
 * L'impact d'une décision publicitaire, à partir des chiffres des deux fenêtres.
 *
 * La mesure principale est la conversion quand il y en a eu d'un côté ou de l'autre, le
 * clic sinon : parler de conversions pour une campagne qui n'en a jamais fait n'apprend
 * rien. La dépense est toujours montrée à côté, sans jugement — une baisse de budget fait
 * baisser les clics, et l'oublier ferait lire comme un échec ce qui était le but.
 */
export function impactPublicitaire(avant: Cumul, apres: Cumul, devise: string): Resultat[] {
  const ligne = (quoi: string, a: number, b: number, plusEstMieux: boolean | null, unite: string): Resultat => ({
    quoi,
    avant: a,
    apres: b,
    unite,
    ...sensDe(a, b, plusEstMieux),
  })
  const convertit = avant.conversions > 0 || apres.conversions > 0
  const mesures = [
    convertit
      ? ligne('Conversions', avant.conversions, apres.conversions, true, '')
      : ligne('Clics', avant.clics, apres.clics, true, ''),
    ligne('Dépense', avant.cout, apres.cout, null, devise),
  ]
  if (avant.conversions > 0 && apres.conversions > 0) {
    mesures.push(
      ligne('Coût par conversion', avant.cout / avant.conversions, apres.cout / apres.conversions, false, devise),
    )
  }
  return mesures
}

const AGENT_DU_MOTEUR: Record<string, VisibilityAgentId> = { seo: 'seo', geo: 'geo', cro: 'cro' }
const AGENT_DE_PLATEFORME: Record<string, VisibilityAgentId> = { 'google-ads': 'ads', 'meta-ads': 'meta' }
const NOTE_DU_MOTEUR: Record<string, 'seoScore' | 'geoScore' | 'croScore'> = {
  seo: 'seoScore',
  geo: 'geoScore',
  cro: 'croScore',
}
const NOM_DE_LA_NOTE: Record<string, string> = {
  seo: 'Note de référencement',
  geo: 'Note « moteurs IA »',
  cro: 'Note de conversion',
}

type AuditNote = {
  finishedAt: Date | null
  seoScore: number | null
  geoScore: number | null
  croScore: number | null
}

/**
 * L'impact d'une correction : la note de son moteur, à l'analyse d'avant et à celle d'après.
 *
 * Une correction ne se mesure pas en jours mais en analyses : tant que le site n'a pas été
 * relu, rien ne dit si elle a pris. La seule vraie preuve est l'analyse suivante.
 */
export function impactDeCorrection(
  quand: Date,
  moteur: string,
  audits: readonly AuditNote[],
): Impact {
  const champ = NOTE_DU_MOTEUR[moteur]
  if (champ === undefined) return { etat: 'indisponible', raison: 'Aucune note ne suit ce contrôle.' }

  const tries = audits
    .filter((audit): audit is AuditNote & { finishedAt: Date } => audit.finishedAt !== null)
    .sort((a, b) => +a.finishedAt - +b.finishedAt)
  const avant = [...tries].reverse().find((audit) => audit.finishedAt <= quand)
  const apres = tries.find((audit) => audit.finishedAt > quand)

  if (apres === undefined) {
    return {
      etat: 'en-attente',
      disponibleLe: null,
      raison: 'À la prochaine analyse du site : c’est elle qui dira si la correction a pris.',
    }
  }
  const a = avant?.[champ] ?? null
  const b = apres[champ]
  if (a === null || b === null) {
    return { etat: 'indisponible', raison: 'Cette note n’était pas encore calculée à l’analyse d’avant.' }
  }
  return {
    etat: 'mesure',
    fenetre: 'analyse d’avant et analyse d’après',
    portee: 'le site entier',
    mesures: [
      {
        quoi: NOM_DE_LA_NOTE[moteur] ?? 'Note',
        avant: a,
        apres: b,
        unite: '/100',
        ecart: null,
        // Une note bouge d'un point pour une page de plus ou de moins : on parle en points.
        sens: b > a ? 'mieux' : b < a ? 'moins-bien' : 'stable',
      },
    ],
  }
}

async function sans<T>(lecture: Promise<T>, defaut: T): Promise<T> {
  return lecture.catch(() => defaut)
}

/**
 * Le journal des décisions des quatre-vingt-dix derniers jours, du plus récent au plus ancien.
 */
export async function lireDecisions(
  userId: string,
  siteId: string | null,
  maintenant = new Date(),
): Promise<Decision[]> {
  const depuis = new Date(+maintenant - JOURNAL_JOURS * JOUR_MS)

  const [actions, recosEcartees, items, articles, audits] = await Promise.all([
    sans(
      withUserScope(userId, (tx) =>
        tx.adsAction.findMany({
          where: { userId, resultat: 'reussi', createdAt: { gte: depuis } },
          orderBy: { createdAt: 'desc' },
          take: JOURNAL_MAX,
          select: {
            id: true,
            createdAt: true,
            quoi: true,
            mode: true,
            campagneId: true,
            accountId: true,
            annulees: { select: { id: true }, take: 1 },
            campagne: { select: { nom: true } },
            recommandation: { select: { titre: true, recommandation: true } },
            account: { select: { plateforme: true, devise: true } },
          },
        }),
      ),
      [],
    ),
    sans(
      withUserScope(userId, (tx) =>
        tx.adsRecommandation.findMany({
          where: { userId, etat: 'ignoree', closedAt: { gte: depuis } },
          orderBy: { closedAt: 'desc' },
          take: JOURNAL_MAX,
          select: { id: true, closedAt: true, titre: true, account: { select: { plateforme: true } } },
        }),
      ),
      [],
    ),
    siteId === null
      ? Promise.resolve([])
      : sans(
          withUserScope(userId, (tx) =>
            tx.actionItem.findMany({
              where: { userId, siteId, state: { in: ['done', 'ignored'] }, updatedAt: { gte: depuis } },
              orderBy: { updatedAt: 'desc' },
              take: JOURNAL_MAX,
              select: { checkId: true, state: true, updatedAt: true },
            }),
          ),
          [],
        ),
    siteId === null
      ? Promise.resolve([])
      : sans(
          withUserScope(userId, (tx) =>
            tx.siteArticle.findMany({
              where: { userId, siteId, shopifyAt: { gte: depuis } },
              orderBy: { shopifyAt: 'desc' },
              take: JOURNAL_MAX,
              select: { id: true, titre: true, shopifyAt: true },
            }),
          ),
          [],
        ),
    siteId === null
      ? Promise.resolve([])
      : sans(
          withUserScope(userId, (tx) =>
            tx.audit.findMany({
              where: { userId, siteId, status: 'done' },
              orderBy: { finishedAt: 'desc' },
              take: 50,
              select: { finishedAt: true, seoScore: true, geoScore: true, croScore: true },
            }),
          ),
          [],
        ),
  ])

  const decisions: Decision[] = []

  // ── Les modifications publicitaires validées ──
  for (const action of actions) {
    if (action.mode === 'restauration') continue
    const agent = AGENT_DE_PLATEFORME[action.account.plateforme]
    if (agent === undefined) continue
    const quoi =
      action.recommandation?.recommandation ||
      action.recommandation?.titre ||
      `Modification de ${OBJETS_MODIFIES[action.quoi] ?? 'la campagne'}${action.campagne?.nom ? ` sur « ${action.campagne.nom} »` : ''}`

    let impact: Impact
    if (action.annulees.length > 0) {
      impact = { etat: 'indisponible', raison: 'Défaite depuis : il n’y a plus rien à mesurer.' }
    } else if (action.campagneId === null) {
      impact = { etat: 'indisponible', raison: 'Elle ne porte sur aucune campagne précise.' }
    } else {
      const f = fenetresAutour(action.createdAt, FENETRES.publicite)
      if (maintenant < f.apres.jusqua) {
        impact = {
          etat: 'en-attente',
          disponibleLe: f.apres.jusqua,
          raison: `Il faut ${FENETRES.publicite} jours pleins après la modification pour la comparer aux ${FENETRES.publicite} d’avant.`,
        }
      } else {
        const campagneId = action.campagneId
        const [avant, apres] = await Promise.all([
          sans(cumulSur(userId, action.accountId, f.avant.depuis, f.avant.jusqua, campagneId), null),
          sans(cumulSur(userId, action.accountId, f.apres.depuis, f.apres.jusqua, campagneId), null),
        ])
        impact =
          avant === null || apres === null
            ? { etat: 'indisponible', raison: 'Les relevés n’ont pas pu être lus.' }
            : {
                etat: 'mesure',
                fenetre: `${FENETRES.publicite} jours avant, ${FENETRES.publicite} jours après`,
                portee: action.campagne?.nom ? `la campagne « ${action.campagne.nom} »` : 'la campagne concernée',
                mesures: impactPublicitaire(avant, apres, action.account.devise),
              }
      }
    }
    decisions.push({
      cle: `action:${action.id}`,
      quand: action.createdAt,
      genre: action.annulees.length > 0 ? 'annulee' : 'appliquee',
      quoi,
      proposePar: [agent],
      impact,
    })
  }

  // ── Les recommandations publicitaires écartées ──
  for (const reco of recosEcartees) {
    const agent = AGENT_DE_PLATEFORME[reco.account.plateforme]
    if (agent === undefined || reco.closedAt === null) continue
    decisions.push({
      cle: `ecartee:${reco.id}`,
      quand: reco.closedAt,
      genre: 'ecartee',
      quoi: reco.titre,
      proposePar: [agent],
      impact: null,
    })
  }

  // ── Les corrections du site, faites ou écartées ──
  for (const item of items) {
    const check = findCheck(item.checkId)
    const agent = check === undefined ? undefined : AGENT_DU_MOTEUR[check.engine]
    if (check === undefined || agent === undefined) continue
    const faite = item.state === 'done'
    decisions.push({
      cle: `correction:${item.checkId}`,
      quand: item.updatedAt,
      genre: faite ? 'corrigee' : 'ecartee',
      quoi: check.label,
      proposePar: [agent],
      impact: faite ? impactDeCorrection(item.updatedAt, check.engine, audits) : null,
    })
  }

  // ── Les articles déposés dans la boutique ──
  for (const article of articles) {
    if (article.shopifyAt === null) continue
    const f = fenetresAutour(article.shopifyAt, FENETRES.article)
    let impact: Impact
    if (maintenant < f.apres.jusqua) {
      impact = {
        etat: 'en-attente',
        disponibleLe: f.apres.jusqua,
        raison: `Un article met du temps à être trouvé : on attend ${FENETRES.article} jours avant de comparer.`,
      }
    } else {
      const releves = await sans(
        withUserScope(userId, (tx) =>
          tx.releveRecherche.findMany({
            where: { userId, siteId: siteId ?? '', jour: { gte: f.avant.depuis, lt: f.apres.jusqua } },
            select: { jour: true, clics: true },
          }),
        ),
        [],
      )
      if (releves.length === 0) {
        impact = {
          etat: 'indisponible',
          raison: 'Google Search Console n’est pas relié : aucun chiffre de recherche à comparer.',
        }
      } else {
        const somme = (debut: Date, fin: Date) =>
          releves.filter((un) => un.jour >= debut && un.jour < fin).reduce((total, un) => total + un.clics, 0)
        const a = somme(f.avant.depuis, f.avant.jusqua)
        const b = somme(f.apres.depuis, f.apres.jusqua)
        impact = {
          etat: 'mesure',
          fenetre: `${FENETRES.article} jours avant, ${FENETRES.article} jours après`,
          /*
           * Le site entier, et c'est écrit : les relevés quotidiens ne distinguent pas les
           * pages. L'évolution observée inclut donc tout ce qui a bougé ailleurs sur le site.
           */
          portee: 'le site entier — les relevés ne distinguent pas les pages',
          mesures: [{ quoi: 'Clics depuis Google', avant: a, apres: b, unite: '', ...sensDe(a, b, true) }],
        }
      }
    }
    decisions.push({
      cle: `article:${article.id}`,
      quand: article.shopifyAt,
      genre: 'publiee',
      quoi: `Article déposé : « ${article.titre} »`,
      proposePar: ['content'],
      impact,
    })
  }

  return decisions.sort((a, b) => +b.quand - +a.quand).slice(0, JOURNAL_MAX)
}
