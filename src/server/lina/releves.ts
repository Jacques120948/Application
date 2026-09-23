import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { withUserScope } from '@/server/db/scope'
import { semaineLisible } from '@/lib/lina'
import { notify } from '@/server/notifications/service'
import type { PaniersLina } from './collecte'
import type { Recents } from './commandes'
import { argent, nombreLisible, type Campagne } from './recommandations'
import type { Indicateurs, Segment } from './segments'

/**
 * La mémoire de Lina : un relevé par semaine, et ce qu'on en tire.
 *
 * Les segments se recalculent à chaque ouverture ; sans relevé, Lina ne saurait pas dire si
 * le taux de réachat monte ou baisse. Chaque ouverture réécrit le relevé de la semaine en
 * cours (le lundi sert de clé) : il reste donc un point par semaine, le dernier connu. Des
 * totaux seulement, aucun client. Le bilan, les alertes et le score sont des fonctions pures.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

export const releveSchema = z.object({
  au: z.string(),
  acheteurs: z.number(),
  actifs: z.number(),
  nouveaux: z.number(),
  recurrents: z.number(),
  fideles: z.number(),
  tauxReachat: z.number().nullable(),
  panierMoyenCents: z.number().nullable(),
  caRecurrentsCents: z.number(),
  partCaRecurrents: z.number().nullable(),
  aReactiver: z.number(),
  dormants: z.number(),
  aRisque: z.number(),
  vip: z.number(),
  vipInactifs: z.number(),
  paniers: z.object({ nombre: z.number(), recuperes: z.number(), valeurRecupereeCents: z.number() }).nullable(),
  reactives30: z.number().nullable(),
  caExistants30Cents: z.number().nullable(),
  score: z.number().nullable(),
})

export type Releve = z.infer<typeof releveSchema>
export type ReleveDate = Releve & { semaine: string }

/** Le lundi de la semaine, en UTC, au format AAAA-MM-JJ. */
export function lundiDe(date: Date): string {
  const jour = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const decalage = (jour.getUTCDay() + 6) % 7
  return new Date(+jour - decalage * JOUR_MS).toISOString().slice(0, 10)
}

// ── Score de fidélité ───────────────────────────────────────────────────────

export type ComposanteScore = { cle: string; libelle: string; valeur: string; points: number; max: number }
export type ScoreFidelite = { score: number; composantes: ComposanteScore[]; note: string }

/** En dessous, un score ne dit rien : trois clients de plus le feraient bouger de dix points. */
export const ACHETEURS_MIN_SCORE = 20
/** Paniers en dessous desquels la récupération n'entre pas dans le score. */
const PANIERS_MIN_SCORE = 10

export { semaineLisible } from '@/lib/lina'

const pourcent = (part: number) => `${nombreLisible(part * 100, part < 0.1 ? 1 : 0)} %`

/**
 * Un indicateur interne, de 0 à 100, pour suivre la fidélité semaine après semaine.
 *
 * Six composantes, chacune plafonnée à un repère fixe choisi par Evoliia (40 % de réachat,
 * 40 % de clients actifs…). **Ce ne sont pas des normes du marché** et le score ne compare
 * pas une boutique à d'autres : il compare la boutique à elle-même dans le temps. Quand les
 * paniers ne sont pas lus, leurs points sont répartis sur les autres composantes.
 */
export function scoreFidelite(r: Omit<Releve, 'score' | 'au'>): ScoreFidelite | null {
  if (r.acheteurs < ACHETEURS_MIN_SCORE) return null
  const part = (valeur: number, repere: number) => Math.max(0, Math.min(1, valeur / repere))
  const composantes: ComposanteScore[] = []
  const ajouter = (cle: string, libelle: string, valeur: number, repere: number, max: number) =>
    composantes.push({ cle, libelle, valeur: pourcent(valeur), points: part(valeur, repere) * max, max })
  ajouter('reachat', 'Taux de réachat (repère : 40 %)', r.tauxReachat ?? 0, 0.4, 25)
  ajouter('actifs', 'Clients actifs parmi les acheteurs (repère : 40 %)', r.actifs / r.acheteurs, 0.4, 20)
  ajouter('fideles', 'Clients fidèles parmi les acheteurs (repère : 15 %)', r.fideles / r.acheteurs, 0.15, 15)
  ajouter('ca-recurrents', 'Part du CA venant des clients récurrents (repère : 60 %)', r.partCaRecurrents ?? 0, 0.6, 15)
  ajouter('eveilles', 'Clients qui ne sont pas dormants', 1 - r.dormants / r.acheteurs, 1, 15)
  const paniersLus = r.paniers !== null && r.paniers.nombre >= PANIERS_MIN_SCORE
  if (paniersLus) ajouter('paniers', 'Paniers abandonnés récupérés (repère : 15 %)', r.paniers!.recuperes / r.paniers!.nombre, 0.15, 10)
  const total = composantes.reduce((somme, un) => somme + un.points, 0)
  const max = composantes.reduce((somme, un) => somme + un.max, 0)
  return {
    score: Math.round((total / max) * 100),
    composantes: composantes.map((un) => ({ ...un, points: Math.round(un.points * 10) / 10 })),
    note: `Indicateur interne d’Evoliia : il compare votre base à elle-même d’une semaine à l’autre, pas à d’autres boutiques. Les repères sont fixes et ne sont pas des normes du marché.${paniersLus ? '' : ' Paniers non comptés (pas assez de paniers lus) : leurs points sont répartis sur le reste.'}`,
  }
}

/** Le relevé de la semaine, à partir de ce que la vue a calculé. */
export function construireReleve(entree: {
  indicateurs: Indicateurs
  segments: readonly Segment[]
  vipInactifs: number
  paniers: PaniersLina | null
  recents: Recents | null
  maintenant: Date
}): Releve {
  const nombre = (cle: string) => entree.segments.find((segment) => segment.cle === cle)?.nombre ?? 0
  const i = entree.indicateurs
  const paniers = entree.paniers === null || entree.paniers.erreur !== undefined ? null : entree.paniers.courant
  const base = {
    acheteurs: i.acheteurs,
    actifs: i.actifs,
    nouveaux: i.nouveaux,
    recurrents: i.recurrents,
    fideles: nombre('fideles'),
    tauxReachat: i.tauxReachat,
    panierMoyenCents: i.panierMoyenCents,
    caRecurrentsCents: i.caRecurrentsCents,
    partCaRecurrents: i.partCaRecurrents,
    aReactiver: i.aReactiver,
    dormants: i.dormants,
    aRisque: nombre('a-risque'),
    vip: nombre('vip'),
    vipInactifs: entree.vipInactifs,
    paniers: paniers === null ? null : { nombre: paniers.nombre, recuperes: paniers.recuperes, valeurRecupereeCents: paniers.valeurRecupereeCents },
    reactives30: entree.recents?.reactives30 ?? null,
    caExistants30Cents: entree.recents?.caExistants30Cents ?? null,
  }
  return { ...base, au: entree.maintenant.toISOString(), score: scoreFidelite(base)?.score ?? null }
}

/** Le relevé le plus récent d'une semaine antérieure, au moins `semaines` avant la semaine courante. */
export function releveAvant(releves: readonly ReleveDate[], semaineCourante: string, semaines: number): ReleveDate | null {
  const limite = new Date(+new Date(`${semaineCourante}T00:00:00Z`) - semaines * 7 * JOUR_MS).toISOString().slice(0, 10)
  return [...releves].filter((un) => un.semaine <= limite).sort((a, b) => b.semaine.localeCompare(a.semaine))[0] ?? null
}

// ── Bilan de la semaine ─────────────────────────────────────────────────────

export type LigneBilan = {
  cle: string
  libelle: string
  valeur: string
  /** L'évolution, déjà écrite ; `null` sans point de comparaison. */
  evolution: string | null
  sens: 'mieux' | 'moins-bien' | 'stable' | null
}

export type BilanLina = {
  semaine: string
  /** Le relevé auquel la semaine est comparée ; `null` la première semaine. */
  compareA: string | null
  lignes: LigneBilan[]
  progresse: string[]
  baisse: string[]
  aFaire: string[]
  segmentPrioritaire: string | null
  opportunite: string | null
}

type Comparable = { cle: string; libelle: string; actuel: number | null; avant: number | null; format: (valeur: number) => string; plusEstMieux: boolean; points?: boolean }

function comparer(c: Comparable): LigneBilan {
  const valeur = c.actuel === null ? 'non mesuré' : c.format(c.actuel)
  if (c.actuel === null || c.avant === null) return { cle: c.cle, libelle: c.libelle, valeur, evolution: null, sens: null }
  const ecart = c.actuel - c.avant
  // Un point de pourcentage, ou 5 % d'écart relatif : en dessous, c'est « stable ».
  const seuil = c.points === true ? 0.01 : Math.max(1, Math.abs(c.avant) * 0.05)
  const sens: LigneBilan['sens'] = Math.abs(ecart) < seuil ? 'stable' : ecart > 0 === c.plusEstMieux ? 'mieux' : 'moins-bien'
  const evolution =
    sens === 'stable'
      ? `stable (${c.format(c.avant)} avant)`
      : c.points === true
      ? `${ecart >= 0 ? '+' : '−'}${nombreLisible(Math.abs(ecart) * 100, 1)} pt (${c.format(c.avant)} avant)`
      : `${ecart >= 0 ? '+' : '−'}${c.format(Math.abs(ecart))} (${c.format(c.avant)} avant)`
  return { cle: c.cle, libelle: c.libelle, valeur, evolution, sens }
}

export function bilanSemaine(entree: {
  semaine: string
  actuel: Releve
  avant: ReleveDate | null
  nouveaux7: number
  nouveauxAvant7: number
  reactives7: number | null
  campagnes: readonly Campagne[]
  quickWins: readonly { texte: string }[]
  topSegment: Segment | null
  devise: string
}): BilanLina {
  const { actuel, avant, devise } = entree
  const entier = (valeur: number) => nombreLisible(valeur)
  const cents = (valeur: number) => argent(valeur, devise)
  const lignes = [
    comparer({ cle: 'nouveaux', libelle: 'Nouveaux clients (7 derniers jours)', actuel: entree.nouveaux7, avant: entree.nouveauxAvant7, format: entier, plusEstMieux: true }),
    comparer({ cle: 'recurrents', libelle: 'Clients récurrents', actuel: actuel.recurrents, avant: avant?.recurrents ?? null, format: entier, plusEstMieux: true }),
    comparer({ cle: 'reachat', libelle: 'Taux de réachat', actuel: actuel.tauxReachat, avant: avant?.tauxReachat ?? null, format: pourcent, plusEstMieux: true, points: true }),
    comparer({ cle: 'ca-existants', libelle: 'CA des clients existants (30 jours)', actuel: actuel.caExistants30Cents, avant: avant?.caExistants30Cents ?? null, format: cents, plusEstMieux: true }),
    comparer({ cle: 'paniers-recuperes', libelle: 'Paniers récupérés', actuel: actuel.paniers?.recuperes ?? null, avant: avant?.paniers?.recuperes ?? null, format: entier, plusEstMieux: true }),
    comparer({ cle: 'reactives', libelle: 'Clients réactivés (7 derniers jours)', actuel: entree.reactives7, avant: null, format: entier, plusEstMieux: true }),
    comparer({ cle: 'a-risque', libelle: 'Clients au risque estimé de départ', actuel: actuel.aRisque, avant: avant?.aRisque ?? null, format: entier, plusEstMieux: false }),
    comparer({ cle: 'dormants', libelle: 'Clients dormants', actuel: actuel.dormants, avant: avant?.dormants ?? null, format: entier, plusEstMieux: false }),
    comparer({ cle: 'score', libelle: 'Score de fidélité (indicateur interne)', actuel: actuel.score, avant: avant?.score ?? null, format: (v) => `${entier(v)}/100`, plusEstMieux: true }),
  ]
  const phrase = (ligne: LigneBilan) => `${ligne.libelle} : ${ligne.valeur}, ${ligne.evolution}.`
  const premiere = entree.campagnes[0]
  return {
    semaine: entree.semaine,
    compareA: avant?.semaine ?? null,
    lignes,
    progresse: lignes.filter((ligne) => ligne.sens === 'mieux').map(phrase),
    baisse: lignes.filter((ligne) => ligne.sens === 'moins-bien').map(phrase),
    aFaire: entree.quickWins.slice(0, 3).map((un) => un.texte),
    segmentPrioritaire: entree.topSegment === null ? null : `${entree.topSegment.nom} (${entier(entree.topSegment.nombre)} clients)`,
    opportunite:
      premiere === undefined
        ? null
        : `${premiere.titre} : ${entier(premiere.audience)} ${premiere.audienceLibelle}, potentiel estimé ${cents(premiere.potentielCents)} (hypothèse de calcul, pas une prévision).`,
  }
}

// ── Alertes ─────────────────────────────────────────────────────────────────

export type AlerteLina = {
  cle: string
  niveau: 'attention' | 'positif'
  titre: string
  texte: string
  /** L'onglet de Lina où agir. */
  onglet: 'tableau' | 'segments' | 'valeur' | 'resultats'
}

/** Au plus trois : une alerte de plus est une alerte de moins lue. */
export const ALERTES_MAX = 3

export function alertesLina(entree: {
  actuel: Releve
  semaine: string
  releves: readonly ReleveDate[]
  paniers: PaniersLina | null
  actifJours: number
}): AlerteLina[] {
  const { actuel } = entree
  const precedent = releveAvant(entree.releves, entree.semaine, 1)
  const ancien = releveAvant(entree.releves, entree.semaine, 4)
  const alertes: AlerteLina[] = []

  if (ancien !== null && actuel.tauxReachat !== null && ancien.tauxReachat !== null) {
    const ecart = actuel.tauxReachat - ancien.tauxReachat
    if (ecart <= -0.01) {
      alertes.push({
        cle: 'reachat-baisse',
        niveau: 'attention',
        titre: 'Le taux de réachat baisse',
        texte: `${pourcent(actuel.tauxReachat)} aujourd’hui contre ${pourcent(ancien.tauxReachat)} la semaine du ${semaineLisible(ancien.semaine)}. Une séquence post-achat et une campagne de deuxième commande sont les leviers les plus directs.`,
        onglet: 'tableau',
      })
    } else if (ecart >= 0.01) {
      alertes.push({
        cle: 'reachat-hausse',
        niveau: 'positif',
        titre: 'Le taux de réachat progresse',
        texte: `${pourcent(actuel.tauxReachat)} aujourd’hui contre ${pourcent(ancien.tauxReachat)} la semaine du ${semaineLisible(ancien.semaine)}.`,
        onglet: 'tableau',
      })
    }
  }

  if (actuel.vipInactifs >= 5 && (precedent === null || actuel.vipInactifs > precedent.vipInactifs)) {
    alertes.push({
      cle: 'vip-inactifs',
      niveau: 'attention',
      titre: 'Des clients VIP deviennent inactifs',
      texte: `${nombreLisible(actuel.vipInactifs)} de vos ${nombreLisible(actuel.vip)} VIP n’ont pas commandé depuis plus de ${entree.actifJours} jours${precedent === null ? '' : ` (${nombreLisible(precedent.vipInactifs)} la semaine du ${semaineLisible(precedent.semaine)})`}. Comportement inhabituel : un message personnel, sans remise, suffit souvent.`,
      onglet: 'segments',
    })
  } else if (precedent !== null && precedent.vipInactifs - actuel.vipInactifs >= 2) {
    alertes.push({
      cle: 'vip-reviennent',
      niveau: 'positif',
      titre: 'Des clients VIP reviennent',
      texte: `${nombreLisible(actuel.vipInactifs)} VIP inactifs aujourd’hui contre ${nombreLisible(precedent.vipInactifs)} la semaine du ${semaineLisible(precedent.semaine)}.`,
      onglet: 'segments',
    })
  }

  const paniers = entree.paniers
  if (paniers !== null && paniers.erreur === undefined && paniers.courant.nombre >= 20 && paniers.precedent.nombre > 0 && paniers.courant.nombre >= paniers.precedent.nombre * 1.25) {
    alertes.push({
      cle: 'paniers-hausse',
      niveau: 'attention',
      titre: 'Les paniers abandonnés augmentent',
      texte: `${nombreLisible(paniers.courant.nombre)} paniers abandonnés sur les ${paniers.jours} derniers jours, contre ${nombreLisible(paniers.precedent.nombre)} sur les ${paniers.jours} jours d’avant. Cleo peut regarder le tunnel de commande.`,
      onglet: 'tableau',
    })
  }

  if (precedent !== null && actuel.aRisque >= 10 && precedent.aRisque > 0 && actuel.aRisque >= precedent.aRisque * 1.2) {
    alertes.push({
      cle: 'a-risque-hausse',
      niveau: 'attention',
      titre: 'Plus de clients au risque estimé de départ',
      texte: `${nombreLisible(actuel.aRisque)} clients récurrents sont plus silencieux que d’habitude, contre ${nombreLisible(precedent.aRisque)} la semaine du ${semaineLisible(precedent.semaine)}. Risque estimé, pas une certitude.`,
      onglet: 'valeur',
    })
  }

  return [...alertes.filter((un) => un.niveau === 'attention'), ...alertes.filter((un) => un.niveau === 'positif')].slice(0, ALERTES_MAX)
}

// ── Base ────────────────────────────────────────────────────────────────────

export async function lireReleves(userId: string, nombre = 12): Promise<ReleveDate[]> {
  const lignes = await withUserScope(userId, (tx) => tx.linaReleve.findMany({ where: { userId }, orderBy: { semaine: 'desc' }, take: nombre }))
  return lignes.flatMap((ligne) => {
    const lu = releveSchema.safeParse(ligne.donnees)
    return lu.success ? [{ ...lu.data, semaine: ligne.semaine.toISOString().slice(0, 10) }] : []
  })
}

/** Réécrit le relevé de la semaine en cours : il en reste un par semaine, le dernier. */
export async function enregistrerReleve(userId: string, releve: Releve, semaine: string): Promise<void> {
  const donnees = releve as unknown as Prisma.InputJsonValue
  const date = new Date(`${semaine}T00:00:00Z`)
  await withUserScope(userId, (tx) =>
    tx.linaReleve.upsert({ where: { userId_semaine: { userId, semaine: date } }, create: { userId, semaine: date, donnees }, update: { donnees } }),
  )
}

/**
 * Une notification dans l'application par alerte nouvelle de la semaine — une baisse, jamais
 * une bonne nouvelle, et jamais deux fois la même la même semaine. Aucun e-mail : l'envoi
 * coûterait à Evoliia, et il attend une décision.
 */
export async function signalerAlertes(userId: string, semaine: string, alertes: readonly AlerteLina[]): Promise<number> {
  const baisses = alertes.filter((alerte) => alerte.niveau === 'attention')
  if (baisses.length === 0) return 0
  const ligne = await withUserScope(userId, (tx) => tx.linaSynchro.findUnique({ where: { userId }, select: { alertesVues: true } }))
  const vues = (ligne?.alertesVues ?? {}) as { semaine?: string; cles?: string[] }
  const deja = new Set(vues.semaine === semaine ? (vues.cles ?? []) : [])
  const nouvelles = baisses.filter((alerte) => !deja.has(alerte.cle))
  if (nouvelles.length === 0 || ligne === null) return 0
  for (const alerte of nouvelles) {
    await notify(userId, { kind: 'lina_alerte', title: `Lina : ${alerte.titre.toLowerCase()}`, body: alerte.texte.slice(0, 280), href: '/fr/lina/bilan' })
  }
  const cles = [...deja, ...nouvelles.map((alerte) => alerte.cle)]
  await withUserScope(userId, (tx) => tx.linaSynchro.update({ where: { userId }, data: { alertesVues: { semaine, cles } } }))
  return nouvelles.length
}
