import { NOM_CANAL } from '@/lib/nova'
import { compteActif, type CompteRelie } from '@/server/ads/comptes'
import { jourDansFuseau, enUnites } from '@/server/ads/metriques'
import { listSites } from '@/server/audit/service'
import { withUserScope } from '@/server/db/scope'
import {
  attribution,
  cumulVentes,
  ensemble,
  indicateursNova,
  performanceCampagnes,
  performanceCanaux,
  performanceProduits,
  periodeDe,
  periodePrecedente,
  type Attribution,
  type Donnees,
  type JourCampagne,
  type JourVentes,
  type Kpi,
  type LigneCampagne,
  type LigneCanal,
  type LigneProduit,
  type Periode,
  type PlateformePayante,
  MANQUE_VENTES,
} from './metriques'
import {
  detecterAlertes,
  detecterInsights,
  detecterOpportunites,
  rapportPourOria,
  type Alerte,
  type Insight,
  type Opportunite,
  type RapportOria,
} from './analyse'
import { lireEtatVentes, SOURCE_SHOPIFY, type EtatVentes } from './collecte'

/**
 * Nova, assemblée : les sources, la collecte, les calculs et l'analyse, en une lecture.
 *
 * **Rien ici n'appelle une plateforme.** Google Ads et Meta sont relus dans ce que Naya et
 * MIRA ont déjà synchronisé ; Search Console dans les relevés de l'automatisation ; Shopify
 * dans ce que la collecte de Nova a écrit. L'écran peut s'ouvrir cent fois sans coûter un
 * appel à qui que ce soit, ni un crédit.
 *
 * **Une source qui manque n'emporte pas les autres.** Chaque lecture est isolée ; un compte
 * Meta délié ou une boutique en panne laisse le reste debout et se signale dans la santé
 * des données.
 */

const JOUR_MS = 24 * 60 * 60 * 1000
/** Au-delà, une source est dite ancienne : ses chiffres d'hier manquent sans doute. */
const VIEILLE_MS = 48 * 60 * 60 * 1000
const FUSEAU_DEFAUT = 'Europe/Zurich'
const CAMPAGNES_MAX = 20
const PRODUITS_MAX = 10

export type EtatSante = 'bon' | 'verifier' | 'probleme' | 'absent' | 'bientot'

export type LigneSante = {
  cle: string
  source: string
  etat: EtatSante
  texte: string
  action: { label: string; href: string } | null
}

export type VueNova = {
  periode: Periode
  precedente: { du: string; au: string }
  devise: string
  /** Rien de relié : Nova n'a rien à mesurer et le dit. */
  vierge: boolean
  /** Les sources dont les chiffres entrent dans cette vue. */
  sources: string[]
  kpis: Kpi[]
  canaux: LigneCanal[]
  attribution: Attribution
  campagnes: LigneCampagne[]
  produits: LigneProduit[]
  insights: Insight[]
  alertes: Alerte[]
  opportunites: Opportunite[]
  sante: { global: 'bon' | 'verifier' | 'probleme'; lignes: LigneSante[] }
  ventes: EtatVentes
  /** Pourquoi les ventes manquent, dit selon l'état réel de la boutique. Vide quand elles sont là. */
  manqueVentes: string
  pourOria: RapportOria
  siteId: string
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function decaler(jour: string, jours: number): string {
  return jourIso(new Date(Date.parse(jour) + jours * JOUR_MS))
}

/** « 22 septembre à 18:20 », dans le fuseau suisse. */
export function quandLisible(date: Date): string {
  const jour = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: FUSEAU_DEFAUT }).format(date)
  const heure = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU_DEFAUT }).format(date)
  return `${jour} à ${heure}`
}

async function sans<T>(promesse: Promise<T>, repli: T): Promise<T> {
  try {
    return await promesse
  } catch {
    return repli
  }
}

async function lireCampagnes(
  userId: string,
  comptes: readonly CompteRelie[],
  depuis: string,
  jusqua: string,
): Promise<JourCampagne[]> {
  if (comptes.length === 0) return []
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsReleve.findMany({
      where: {
        userId,
        accountId: { in: comptes.map((compte) => compte.id) },
        // Les lignes de campagne seulement : les niveaux en dessous compteraient la même dépense deux fois.
        groupeId: '',
        annonceId: '',
        jour: { gte: new Date(depuis), lte: new Date(jusqua) },
      },
      select: {
        accountId: true,
        jour: true,
        coutMicros: true,
        clics: true,
        impressions: true,
        conversions: true,
        valeurConversion: true,
        campagne: { select: { campagneId: true, nom: true } },
      },
    }),
  )
  const plateforme = new Map(comptes.map((compte) => [compte.id, compte.plateforme as PlateformePayante]))
  return lignes.map((ligne) => ({
    plateforme: plateforme.get(ligne.accountId)!,
    campagneId: ligne.campagne.campagneId,
    nom: ligne.campagne.nom === '' ? ligne.campagne.campagneId : ligne.campagne.nom,
    jour: jourIso(ligne.jour),
    depense: enUnites(Number(ligne.coutMicros)),
    clics: Number(ligne.clics),
    impressions: Number(ligne.impressions),
    conversions: ligne.conversions,
    valeur: ligne.valeurConversion,
  }))
}

async function lireVentes(userId: string, boutique: string, depuis: string, jusqua: string): Promise<JourVentes[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.commerceJour.findMany({
      where: { userId, source: SOURCE_SHOPIFY, boutique, jour: { gte: new Date(depuis), lte: new Date(jusqua) } },
      orderBy: { jour: 'asc' },
    }),
  )
  return lignes.map((ligne) => {
    const canaux = (ligne.canaux ?? {}) as Record<string, { commandes: number; chiffreCents: number; origines: Record<string, number> }>
    const produits = (ligne.produits ?? []) as { id: string; titre: string; commandes: number; quantite: number; chiffreCents: number }[]
    return {
      jour: jourIso(ligne.jour),
      commandes: ligne.commandes,
      chiffre: Number(ligne.chiffreCents) / 100,
      nouveauxClients: ligne.nouveauxClients,
      clientsIdentifies: ligne.clientsIdentifies,
      canaux: Object.fromEntries(
        Object.entries(canaux).map(([canal, valeur]) => [
          canal,
          { commandes: valeur.commandes, chiffre: valeur.chiffreCents / 100, origines: valeur.origines ?? {} },
        ]),
      ),
      produits: produits.map((produit) => ({ ...produit, chiffre: produit.chiffreCents / 100 })),
    }
  })
}

/** Les clics Google sur 28 jours au dernier relevé de la période, et 28 jours plus tôt. */
async function lireRecherche(userId: string, siteId: string, jusqua: string): Promise<Donnees['recherche']> {
  if (siteId === '') return null
  const dernier = await withUserScope(userId, (tx) =>
    tx.releveRecherche.findFirst({
      where: { userId, siteId, jour: { lte: new Date(jusqua) } },
      orderBy: { jour: 'desc' },
      select: { jour: true, clics: true },
    }),
  )
  if (dernier === null) return null
  const avant = await withUserScope(userId, (tx) =>
    tx.releveRecherche.findFirst({
      where: { userId, siteId, jour: { lte: new Date(+dernier.jour - 28 * JOUR_MS), gte: new Date(+dernier.jour - 35 * JOUR_MS) } },
      orderBy: { jour: 'desc' },
      select: { clics: true },
    }),
  )
  return { clics28: dernier.clics, clics28Avant: avant?.clics ?? null, au: jourIso(dernier.jour) }
}

function santeCompte(
  compte: CompteRelie | null,
  nom: string,
  cle: string,
  devise: string,
  maintenant: Date,
): LigneSante {
  const relier = { label: `Relier ${nom}`, href: '' }
  if (compte === null) return { cle, source: nom, etat: 'absent', texte: 'Non relié.', action: relier }
  if (compte.devise !== '' && devise !== '' && compte.devise !== devise) {
    return {
      cle,
      source: nom,
      etat: 'verifier',
      texte: `Compte tenu en ${compte.devise}, boutique en ${devise} : Nova ne mélange pas les devises, ses chiffres sont écartés des totaux.`,
      action: null,
    }
  }
  if (compte.synchroAt === null) return { cle, source: nom, etat: 'verifier', texte: 'Relié, pas encore synchronisé.', action: null }
  if (compte.plateforme === 'google-ads' && compte.conversionsActives === 0) {
    return {
      cle,
      source: nom,
      etat: 'probleme',
      texte: 'Aucune action de conversion n’est comptée dans ce compte : les ventes qu’il provoque sont invisibles pour lui.',
      action: null,
    }
  }
  if (+maintenant - +compte.synchroAt > VIEILLE_MS) {
    return {
      cle,
      source: nom,
      etat: 'verifier',
      texte: `Les dernières données ${nom.replace(' Ads', '')} disponibles datent du ${quandLisible(compte.synchroAt)}.`,
      action: null,
    }
  }
  return { cle, source: nom, etat: 'bon', texte: `À jour — synchronisé le ${quandLisible(compte.synchroAt)}.`, action: null }
}

function santeVentes(ventes: EtatVentes, maintenant: Date): LigneSante {
  const base = { cle: 'shopify', source: 'Shopify' }
  const relier = { label: 'Connecter Shopify', href: '' }
  switch (ventes.etat) {
    case 'absent':
      return { ...base, etat: 'absent', texte: 'Non reliée : sans elle, pas de chiffre d’affaires réel.', action: relier }
    case 'offre':
      return { ...base, etat: 'absent', texte: 'Votre offre n’ouvre pas la lecture de la boutique.', action: null }
    case 'portee':
      return { ...base, etat: 'probleme', texte: ventes.message, action: null }
    case 'jamais':
      return { ...base, etat: 'verifier', texte: 'Reliée, ventes pas encore lues. Actualisez pour les récupérer.', action: null }
    case 'erreur':
      return {
        ...base,
        etat: 'probleme',
        texte:
          ventes.synchroAt === null
            ? ventes.message
            : `${ventes.message} Les dernières données Shopify disponibles datent du ${quandLisible(ventes.synchroAt)}.`,
        action: null,
      }
    case 'ok': {
      if (ventes.synchroAt !== null && +maintenant - +ventes.synchroAt > VIEILLE_MS) {
        return { ...base, etat: 'verifier', texte: `Les dernières données Shopify disponibles datent du ${quandLisible(ventes.synchroAt)}.`, action: null }
      }
      if (ventes.tronque) {
        return { ...base, etat: 'verifier', texte: 'Trop de commandes pour une seule lecture : les jours les plus récents peuvent manquer.', action: null }
      }
      return {
        ...base,
        etat: 'bon',
        texte: `À jour${ventes.synchroAt === null ? '' : ` — lue le ${quandLisible(ventes.synchroAt)}`}${ventes.couvertureDepuis === null ? '' : `, ventes connues depuis le ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(ventes.couvertureDepuis))}`}.`,
        action: null,
      }
    }
  }
}

/**
 * Pourquoi il n'y a pas de ventes, selon ce qui se passe réellement.
 *
 * « Connectez Shopify » à quelqu'un dont la boutique est reliée l'enverrait refaire une
 * connexion qui marche, alors que ce qui manque est une autorisation, ou un clic.
 */
export function raisonVentes(ventes: EtatVentes): string {
  switch (ventes.etat) {
    case 'absent':
      return MANQUE_VENTES
    case 'offre':
      return 'Votre offre n’ouvre pas la lecture de votre boutique.'
    case 'jamais':
      return 'Boutique reliée, ventes pas encore lues : cliquez « Actualiser ».'
    case 'portee':
    case 'erreur':
      return ventes.message === '' ? 'La lecture de votre boutique a échoué : cliquez « Actualiser ».' : ventes.message
    case 'ok':
      return 'Vos ventes ne sont connues que depuis le début de la lecture : choisissez une période plus courte.'
  }
}

/**
 * Tout ce que l'écran de Nova affiche, pour une période.
 *
 * Aucune écriture, aucun appel extérieur : une lecture de la base et du calcul.
 */
export async function lireNova(
  userId: string,
  locale: string,
  options: { periode?: string; du?: string; au?: string; siteId?: string } = {},
  maintenant = new Date(),
): Promise<VueNova> {
  const [ventes, google, meta, sites] = await Promise.all([
    sans(lireEtatVentes(userId), { etat: 'absent', message: '', boutique: '', synchroAt: null, couvertureDepuis: null, tronque: false, devise: '', fuseau: '' } as EtatVentes),
    sans(compteActif(userId, 'google-ads'), null),
    sans(compteActif(userId, 'meta-ads'), null),
    sans(listSites(userId), []),
  ])
  const site = sites.find((un) => un.id === options.siteId) ?? sites[0] ?? null
  const siteId = site?.id ?? ''

  const venteLues = ventes.etat === 'ok' || (ventes.etat === 'erreur' && ventes.synchroAt !== null)
  const comptes = [google, meta].filter((compte): compte is CompteRelie => compte !== null)
  // La devise de la boutique fait référence : c'est elle qui encaisse.
  const devise = (venteLues && ventes.devise !== '' ? ventes.devise : comptes[0]?.devise) || 'CHF'
  const regies = comptes.filter((compte) => compte.devise === '' || compte.devise === devise)
  const fuseau = (venteLues ? ventes.fuseau : '') || comptes[0]?.fuseau || FUSEAU_DEFAUT

  const aujourdhui = jourDansFuseau(maintenant, fuseau)
  const periode = periodeDe(options.periode, aujourdhui, options.du, options.au)
  const precedente = periodePrecedente(periode)
  const reference = { du: decaler(periode.du, -30), au: decaler(periode.du, -1) }
  const depuis = [precedente.du, reference.du].sort()[0]!

  const [campagnes, joursVentes, recherche] = await Promise.all([
    sans(lireCampagnes(userId, regies, depuis, periode.au), []),
    venteLues ? sans(lireVentes(userId, ventes.boutique, depuis, periode.au), []) : Promise.resolve([]),
    sans(lireRecherche(userId, siteId, periode.au), null),
  ])

  const donnees: Donnees = {
    devise,
    regies: regies.map((compte) => compte.plateforme as PlateformePayante),
    campagnes,
    ventes: { disponibles: venteLues, couvertureDepuis: ventes.couvertureDepuis, jours: joursVentes },
    recherche,
  }

  const actuel = ensemble(donnees, periode)
  const avant = ensemble(donnees, precedente)
  const ventesActuelles = cumulVentes(donnees.ventes, periode)
  const ventesAvant = cumulVentes(donnees.ventes, precedente)
  const lignesAttribution = attribution(donnees, periode, ventesActuelles)
  const lignesCampagnes = performanceCampagnes(donnees, periode, precedente)
  const lignesProduits = performanceProduits(ventesActuelles, ventesAvant)

  const contexte = {
    donnees,
    bornes: periode,
    avant: precedente,
    reference,
    jours: periode.jours,
    ventes: ventesActuelles,
    ventesAvant,
    attribution: lignesAttribution,
    campagnes: lignesCampagnes,
    produits: lignesProduits,
  }
  const insights = detecterInsights(contexte)
  const alertes = detecterAlertes(contexte)
  const opportunites = detecterOpportunites(contexte, locale, siteId)

  const connexions = `/${locale}/connexions`
  const lignesSante: LigneSante[] = [
    santeVentes(ventes, maintenant),
    santeCompte(google, 'Google Ads', 'google-ads', venteLues ? devise : '', maintenant),
    santeCompte(meta, 'Meta Ads', 'meta-ads', venteLues ? devise : '', maintenant),
    recherche === null
      ? { cle: 'search-console', source: 'Search Console', etat: 'absent', texte: siteId === '' ? 'Aucun site analysé.' : 'Aucun relevé de recherche pour ce site.', action: { label: 'Relier Search Console', href: connexions } }
      : { cle: 'search-console', source: 'Search Console', etat: 'bon', texte: `Relevé du ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(recherche.au))}.`, action: null },
    {
      cle: 'ga4',
      source: 'Google Analytics 4',
      etat: 'bientot',
      texte: 'Pas encore disponible dans Evoliia. Sans lui, Nova ne connaît ni vos visites ni votre taux de conversion.',
      action: null,
    },
  ]
  if (ventesActuelles !== null && ventesActuelles.commandes >= 20) {
    const inconnues = (ventesActuelles.canaux.inconnu?.commandes ?? 0) / ventesActuelles.commandes
    if (inconnues >= 0.3) {
      lignesSante.push({
        cle: 'non-attribue',
        source: 'Trafic non attribué',
        etat: 'verifier',
        texte: `${Math.round(inconnues * 100)} % des commandes n’ont pas d’origine connue. Des liens sans paramètres UTM en sont souvent la cause.`,
        action: null,
      })
    }
  }
  if (lignesAttribution.reel !== null && lignesAttribution.reel.chiffre > 0 && lignesAttribution.revendique > lignesAttribution.reel.chiffre * 1.3) {
    lignesSante.push({
      cle: 'doublons',
      source: 'Conversions en double',
      etat: 'verifier',
      texte: 'Les régies revendiquent nettement plus de revenu que la boutique n’en encaisse : des ventes sont probablement comptées deux fois.',
      action: null,
    })
  }
  for (const ligne of lignesSante) {
    if (ligne.action !== null && ligne.action.href === '') ligne.action = { ...ligne.action, href: connexions }
  }
  const etats = lignesSante.map((ligne) => ligne.etat)
  const global = etats.includes('probleme') ? 'probleme' : etats.includes('verifier') || !etats.includes('bon') ? 'verifier' : 'bon'

  const sources = [
    ...(venteLues ? ['Shopify'] : []),
    ...regies.map((compte) => NOM_CANAL[compte.plateforme as PlateformePayante]),
    ...(recherche === null ? [] : ['Search Console']),
  ]

  return {
    periode,
    precedente,
    devise,
    vierge: ventes.etat === 'absent' && comptes.length === 0 && recherche === null,
    sources,
    kpis: indicateursNova(actuel, avant, raisonVentes(ventes)),
    canaux: performanceCanaux(donnees, periode, ventesActuelles),
    attribution: lignesAttribution,
    campagnes: lignesCampagnes.slice(0, CAMPAGNES_MAX),
    produits: lignesProduits.slice(0, PRODUITS_MAX),
    insights,
    alertes,
    opportunites,
    sante: { global, lignes: lignesSante },
    ventes,
    manqueVentes: ventesActuelles === null ? raisonVentes(ventes) : '',
    pourOria: rapportPourOria(periode.libelle, sources, alertes, insights, opportunites),
    siteId,
  }
}
