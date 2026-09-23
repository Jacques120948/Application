import { CANAUX, NOM_CANAL, type CanalNova } from '@/lib/nova'
import { variation } from '@/server/ads/metriques'

/**
 * Le moteur de métriques de Nova. Du calcul, rien d'autre.
 *
 * Tout chiffre que Nova affiche ou cite sort d'ici. Le modèle de langage n'en calcule
 * aucun : il reçoit des résultats et les explique. Une erreur d'arithmétique sur un coût
 * d'acquisition ressemble à un chiffre, ne se voit pas, et décide d'un budget.
 *
 * Quatre règles, reprises de Naya et étendues.
 *
 * **Ce qu'on ne peut pas calculer vaut `null`, et on dit pourquoi.** Un CAC sans nouveaux
 * clients connus n'est pas zéro : il n'existe pas. Chaque indicateur absent porte la phrase
 * qui dit ce qui manque, et ce qu'il faudrait relier.
 *
 * **Les ventes réelles viennent de la boutique, jamais des régies.** Google et Meta
 * déclarent chacune les ventes qu'elles pensent avoir provoquées, avec leur propre modèle ;
 * la même vente peut figurer chez les deux. Le chiffre d'affaires est donc celui que la
 * boutique encaisse, et les déclarations des régies restent à part, nommées comme telles.
 *
 * **On ne mélange pas les devises.** Un compte Meta en euros et une boutique en francs ne
 * s'additionnent pas. La devise de référence est celle de la boutique ; ce qui est tenu
 * dans une autre est écarté des totaux et signalé.
 *
 * **ROAS et MER ne se confondent pas.** Le ROAS rapporte ce que les régies déclarent à ce
 * qu'elles ont coûté ; le MER rapporte tout le chiffre d'affaires à toute la dépense. Le
 * premier dit ce que chaque régie revendique, le second ce que le marketing produit en tout.
 */

// ── Périodes ─────────────────────────────────────────────────────────────────

export type CleePeriode = 'aujourdhui' | '7' | '30' | '90' | 'perso'

export type Periode = {
  cle: CleePeriode
  du: string
  au: string
  jours: number
  libelle: string
}

const JOUR_MS = 24 * 60 * 60 * 1000
/** La plus longue période personnalisée : au-delà, l'historique conservé ne suit plus. */
const PERSO_MAX_JOURS = 366

function decaler(jour: string, jours: number): string {
  return new Date(Date.parse(jour) + jours * JOUR_MS).toISOString().slice(0, 10)
}

function ecartJours(du: string, au: string): number {
  return Math.round((Date.parse(au) - Date.parse(du)) / JOUR_MS) + 1
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u

function dateLisible(jour: string): string {
  return new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(jour))
}

/**
 * La période demandée, bornée et vérifiée.
 *
 * Les périodes de 7, 30 et 90 jours s'arrêtent hier : la journée en cours est incomplète
 * par définition, et la mettre dans une moyenne ferait plonger chaque matin tous les
 * indicateurs. « Aujourd'hui » est la seule exception, et elle se dit partielle.
 */
export function periodeDe(
  cle: string | undefined,
  aujourdhui: string,
  du?: string,
  au?: string,
): Periode {
  if (cle === 'aujourdhui') {
    return { cle, du: aujourdhui, au: aujourdhui, jours: 1, libelle: 'Aujourd’hui (journée en cours)' }
  }
  if (cle === 'perso' && du !== undefined && au !== undefined && DATE.test(du) && DATE.test(au)) {
    const fin = au > aujourdhui ? aujourdhui : au
    const jours = ecartJours(du, fin)
    if (du <= fin && jours <= PERSO_MAX_JOURS) {
      return { cle, du, au: fin, jours, libelle: `Du ${dateLisible(du)} au ${dateLisible(fin)}` }
    }
  }
  const n = cle === '7' ? 7 : cle === '90' ? 90 : 30
  const hier = decaler(aujourdhui, -1)
  return {
    cle: String(n) as CleePeriode,
    du: decaler(hier, -(n - 1)),
    au: hier,
    jours: n,
    libelle: `${n} derniers jours`,
  }
}

/** La période de même durée qui précède immédiatement. */
export function periodePrecedente(periode: Periode): { du: string; au: string } {
  const au = decaler(periode.du, -1)
  return { du: decaler(au, -(periode.jours - 1)), au }
}

export function dansPeriode(jour: string, bornes: { du: string; au: string }): boolean {
  return jour >= bornes.du && jour <= bornes.au
}

// ── Données normalisées ──────────────────────────────────────────────────────

export type PlateformePayante = 'google-ads' | 'meta-ads'

/**
 * Une journée d'une campagne, quelle que soit la régie.
 *
 * C'est la couche commune : Google dit `cost`, `conversions`, `conversion_value` ; Meta dit
 * `spend`, `purchases`, `purchase_value`. Les deux arrivent déjà rangés ainsi par les
 * synchronisations de Naya et de MIRA — Nova les relit, elle ne les redemande pas.
 */
export type JourCampagne = {
  plateforme: PlateformePayante
  campagneId: string
  nom: string
  jour: string
  /** En unités de la devise du compte. */
  depense: number
  clics: number
  impressions: number
  conversions: number
  /** Valeur des conversions déclarée par la régie, en unités. */
  valeur: number
}

export type CanalVentes = { commandes: number; chiffre: number; origines: Record<string, number> }

export type ProduitVentes = { id: string; titre: string; commandes: number; quantite: number; chiffre: number }

/** Une journée de ventes, en unités de la devise de la boutique. */
export type JourVentes = {
  jour: string
  commandes: number
  chiffre: number
  nouveauxClients: number
  /** Ce qu'ont rapporté les premières commandes. */
  chiffreNouveaux: number
  clientsIdentifies: number
  canaux: Partial<Record<CanalNova, CanalVentes>>
  /** Les mêmes commandes, par canal de première visite. Vide pour les jours lus avant la V2. */
  canauxPremier: Partial<Record<CanalNova, CanalVentes>>
  produits: ProduitVentes[]
}

export type Donnees = {
  devise: string
  /** Les régies dont les chiffres entrent dans les totaux, dans la devise de référence. */
  regies: PlateformePayante[]
  campagnes: JourCampagne[]
  ventes: {
    disponibles: boolean
    /** Le premier jour lu. Avant, on ne sait pas — ce n'est pas zéro. */
    couvertureDepuis: string | null
    jours: JourVentes[]
  }
  /** Search Console : des cumuls sur 28 jours, seule forme qu'Evoliia conserve. */
  recherche: { clics28: number; clics28Avant: number | null; au: string } | null
  /** Google Analytics 4, quand il est relié. Même règle de couverture que les ventes. */
  visites?: { disponibles: boolean; couvertureDepuis: string | null; jours: JourVisites[] }
}

export type CanalSessions = { sessions: number; achats: number; revenu: number; origines: Record<string, number> }
export type PageSessions = { page: string; sessions: number; achats: number; revenu: number }

/** Une journée de visites GA4, en unités de la devise de la propriété. */
export type JourVisites = {
  jour: string
  sessions: number
  sessionsEngagees: number
  achats: number
  revenu: number
  canaux: Partial<Record<CanalNova, CanalSessions>>
  appareils: Record<string, { sessions: number; achats: number }>
  pages: PageSessions[]
  pagesSeo: PageSessions[]
}

export type CumulVisites = {
  sessions: number
  sessionsEngagees: number
  achats: number
  revenu: number
  canaux: Partial<Record<CanalNova, CanalSessions>>
  appareils: Record<string, { sessions: number; achats: number }>
  pages: PageSessions[]
  pagesSeo: PageSessions[]
}

function cumulerPages(cible: Map<string, PageSessions>, pages: readonly PageSessions[]): void {
  for (const page of pages) {
    const deja = cible.get(page.page) ?? { page: page.page, sessions: 0, achats: 0, revenu: 0 }
    deja.sessions += page.sessions
    deja.achats += page.achats
    deja.revenu += page.revenu
    cible.set(page.page, deja)
  }
}

/** Les visites d'une période, ou `null` si GA4 n'est pas relié ou ne couvre pas la période. */
export function cumulVisites(visites: Donnees['visites'], bornes: { du: string; au: string }): CumulVisites | null {
  if (visites === undefined || !visites.disponibles || visites.couvertureDepuis === null || bornes.du < visites.couvertureDepuis) {
    return null
  }
  const total: CumulVisites = { sessions: 0, sessionsEngagees: 0, achats: 0, revenu: 0, canaux: {}, appareils: {}, pages: [], pagesSeo: [] }
  const pages = new Map<string, PageSessions>()
  const pagesSeo = new Map<string, PageSessions>()
  for (const jour of visites.jours) {
    if (!dansPeriode(jour.jour, bornes)) continue
    total.sessions += jour.sessions
    total.sessionsEngagees += jour.sessionsEngagees
    total.achats += jour.achats
    total.revenu += jour.revenu
    for (const [canal, ligne] of Object.entries(jour.canaux) as [CanalNova, CanalSessions][]) {
      const deja = total.canaux[canal] ?? { sessions: 0, achats: 0, revenu: 0, origines: {} }
      deja.sessions += ligne.sessions
      deja.achats += ligne.achats
      deja.revenu += ligne.revenu
      for (const [origine, n] of Object.entries(ligne.origines)) deja.origines[origine] = (deja.origines[origine] ?? 0) + n
      total.canaux[canal] = deja
    }
    for (const [appareil, ligne] of Object.entries(jour.appareils)) {
      const deja = total.appareils[appareil] ?? { sessions: 0, achats: 0 }
      deja.sessions += ligne.sessions
      deja.achats += ligne.achats
      total.appareils[appareil] = deja
    }
    cumulerPages(pages, jour.pages)
    cumulerPages(pagesSeo, jour.pagesSeo)
  }
  total.pages = [...pages.values()].sort((une, autre) => autre.revenu - une.revenu || autre.sessions - une.sessions)
  total.pagesSeo = [...pagesSeo.values()].sort((une, autre) => autre.revenu - une.revenu || autre.sessions - une.sessions)
  return total
}

// ── Cumuls ───────────────────────────────────────────────────────────────────

export type CumulPub = { depense: number; clics: number; impressions: number; conversions: number; valeur: number }

const PUB_VIDE: CumulPub = { depense: 0, clics: 0, impressions: 0, conversions: 0, valeur: 0 }

export function cumulPub(
  campagnes: readonly JourCampagne[],
  bornes: { du: string; au: string },
  filtre: (ligne: JourCampagne) => boolean = () => true,
): CumulPub {
  return campagnes
    .filter((ligne) => dansPeriode(ligne.jour, bornes) && filtre(ligne))
    .reduce<CumulPub>(
      (total, ligne) => ({
        depense: total.depense + ligne.depense,
        clics: total.clics + ligne.clics,
        impressions: total.impressions + ligne.impressions,
        conversions: total.conversions + ligne.conversions,
        valeur: total.valeur + ligne.valeur,
      }),
      { ...PUB_VIDE },
    )
}

export type CumulVentes = {
  commandes: number
  chiffre: number
  nouveauxClients: number
  chiffreNouveaux: number
  clientsIdentifies: number
  canaux: Partial<Record<CanalNova, CanalVentes>>
  canauxPremier: Partial<Record<CanalNova, CanalVentes>>
  produits: ProduitVentes[]
}

function additionner(
  cible: Partial<Record<CanalNova, CanalVentes>>,
  source: Partial<Record<CanalNova, CanalVentes>>,
): void {
  for (const [canal, ligne] of Object.entries(source) as [CanalNova, CanalVentes][]) {
    const deja = cible[canal] ?? { commandes: 0, chiffre: 0, origines: {} }
    deja.commandes += ligne.commandes
    deja.chiffre += ligne.chiffre
    for (const [origine, n] of Object.entries(ligne.origines)) deja.origines[origine] = (deja.origines[origine] ?? 0) + n
    cible[canal] = deja
  }
}

/**
 * Les ventes d'une période, ou `null` quand la période n'est pas couverte.
 *
 * Une période qui commence avant le premier jour lu ne se somme pas : on afficherait un
 * chiffre d'affaires amputé de ses premiers jours comme s'il était complet.
 */
export function cumulVentes(ventes: Donnees['ventes'], bornes: { du: string; au: string }): CumulVentes | null {
  if (!ventes.disponibles || ventes.couvertureDepuis === null || bornes.du < ventes.couvertureDepuis) return null
  const total: CumulVentes = {
    commandes: 0,
    chiffre: 0,
    nouveauxClients: 0,
    chiffreNouveaux: 0,
    clientsIdentifies: 0,
    canaux: {},
    canauxPremier: {},
    produits: [],
  }
  const produits = new Map<string, ProduitVentes>()
  for (const jour of ventes.jours) {
    if (!dansPeriode(jour.jour, bornes)) continue
    total.commandes += jour.commandes
    total.chiffre += jour.chiffre
    total.nouveauxClients += jour.nouveauxClients
    total.chiffreNouveaux += jour.chiffreNouveaux
    total.clientsIdentifies += jour.clientsIdentifies
    additionner(total.canaux, jour.canaux)
    additionner(total.canauxPremier, jour.canauxPremier)
    for (const produit of jour.produits) {
      const deja = produits.get(produit.id) ?? { ...produit, commandes: 0, quantite: 0, chiffre: 0 }
      deja.commandes += produit.commandes
      deja.quantite += produit.quantite
      deja.chiffre += produit.chiffre
      produits.set(produit.id, deja)
    }
  }
  total.produits = [...produits.values()].sort((un, autre) => autre.chiffre - un.chiffre)
  return total
}

// ── Indicateurs ──────────────────────────────────────────────────────────────

function arrondi(valeur: number, decimales = 2): number {
  const facteur = 10 ** decimales
  return Math.round(valeur * facteur) / facteur
}

export function diviser(haut: number, bas: number): number | null {
  return bas === 0 ? null : haut / bas
}

/** Un rapport en pour cent entier, comme chez Naya et MIRA : 245 veut dire 245 %. */
export function enPourcent(haut: number, bas: number): number | null {
  const rapport = diviser(haut, bas)
  return rapport === null ? null : Math.round(rapport * 100)
}

export type FormatKpi = 'argent' | 'nombre' | 'pourcent'

export type Kpi = {
  cle: 'chiffre' | 'depenses' | 'roas' | 'mer' | 'commandes' | 'cpa' | 'cac' | 'panier' | 'conversion'
  label: string
  valeur: number | null
  format: FormatKpi
  /** En pour cent par rapport à la période précédente. `null` : pas de comparaison possible. */
  variation: number | null
  /** Ce qui est une bonne nouvelle : une dépense qui baisse n'en est pas forcément une. */
  mieux: 'hausse' | 'baisse' | 'neutre'
  /** D'où vient le chiffre, en quelques mots. */
  source: string
  /** Pourquoi il manque, et ce qu'il faudrait relier. Vide quand la valeur existe. */
  absent: string
}

export const MANQUE_VENTES = 'Connectez Shopify pour voir vos ventes réelles.'
export const MANQUE_PUB = 'Aucun compte publicitaire relié.'
export const MANQUE_CAC = 'Données insuffisantes pour calculer précisément votre coût d’acquisition client.'
export const MANQUE_CONVERSION =
  'Il faut le nombre de visites de votre site : connectez Google Analytics 4 depuis Connexions.'

type Ensemble = { pub: CumulPub; ventes: CumulVentes | null; aDesRegies: boolean; visites?: CumulVisites | null }

/**
 * Le taux de conversion : des commandes pour cent visites.
 *
 * Les commandes de la boutique quand elle est lue — ce sont les vraies ventes ; sinon, les
 * achats que GA4 a vus. Les visites viennent toujours de GA4. Une décimale : 1,8 % et 2,4 %
 * ne racontent pas la même boutique.
 */
export function tauxConversion(ventes: CumulVentes | null, visites: CumulVisites | null | undefined): number | null {
  if (visites == null || visites.sessions === 0) return null
  const commandes = ventes?.commandes ?? visites.achats
  return Math.round((commandes / visites.sessions) * 1000) / 10
}

function valeursKpi(ensemble: Ensemble): Record<Kpi['cle'], number | null> {
  const { pub, ventes, aDesRegies } = ensemble
  const depenses = aDesRegies ? arrondi(pub.depense) : null
  const commandes = ventes?.commandes ?? null
  const cac =
    ventes === null || !aDesRegies || ventes.clientsIdentifies === 0 || ventes.nouveauxClients === 0 || pub.depense === 0
      ? null
      : arrondi(pub.depense / ventes.nouveauxClients)
  return {
    chiffre: ventes === null ? null : arrondi(ventes.chiffre),
    depenses,
    roas: aDesRegies ? enPourcent(pub.valeur, pub.depense) : null,
    mer: ventes === null || !aDesRegies ? null : enPourcent(ventes.chiffre, pub.depense),
    /*
     * Sans boutique, pas de total de commandes : la somme des conversions de Google et de
     * Meta compterait deux fois les ventes qu'elles se partagent. Chaque régie garde les
     * siennes, sur sa ligne de canal.
     */
    commandes,
    cpa: !aDesRegies || ventes === null || ventes.commandes === 0 ? null : arrondi(pub.depense / ventes.commandes),
    cac,
    panier: ventes === null || ventes.commandes === 0 ? null : arrondi(ventes.chiffre / ventes.commandes),
    conversion: tauxConversion(ventes, ensemble.visites),
  }
}

/**
 * Les indicateurs de tête, avec leur variation.
 *
 * Les commandes et le coût par commande viennent de la boutique, et d'elle seule. Sans
 * boutique reliée, ils restent absents plutôt que remplacés par les conversions des régies :
 * additionner celles de Google et de Meta est précisément l'erreur que Nova existe pour
 * éviter.
 */
export function indicateursNova(actuel: Ensemble, precedent: Ensemble, manqueVentes: string = MANQUE_VENTES): Kpi[] {
  const a = valeursKpi(actuel)
  const p = valeursKpi(precedent)
  const avecVentes = actuel.ventes !== null
  const pub = actuel.aDesRegies
  const kpi = (
    cle: Kpi['cle'],
    label: string,
    format: FormatKpi,
    mieux: Kpi['mieux'],
    source: string,
    absent: string,
  ): Kpi => ({
    cle,
    label,
    valeur: a[cle],
    format,
    variation: variation(a[cle], p[cle]),
    mieux,
    source,
    absent: a[cle] === null ? absent : '',
  })
  return [
    kpi('chiffre', 'Chiffre d’affaires', 'argent', 'hausse', 'Shopify, remboursements déduits', manqueVentes),
    kpi('depenses', 'Dépenses marketing', 'argent', 'neutre', 'Google Ads et Meta Ads', MANQUE_PUB),
    kpi('roas', 'ROAS', 'pourcent', 'hausse', 'Revenu déclaré par les régies ÷ dépenses', pub ? 'Aucune dépense sur la période.' : MANQUE_PUB),
    kpi(
      'mer',
      'MER',
      'pourcent',
      'hausse',
      'Chiffre d’affaires total ÷ dépenses marketing',
      !avecVentes ? manqueVentes : pub ? 'Aucune dépense sur la période.' : MANQUE_PUB,
    ),
    kpi('commandes', 'Commandes', 'nombre', 'hausse', 'Shopify', `${manqueVentes} Les conversions déclarées par chaque régie sont plus bas, par canal.`),
    kpi(
      'cpa',
      'Coût par commande',
      'argent',
      'baisse',
      'Dépenses ÷ commandes Shopify',
      !pub ? MANQUE_PUB : !avecVentes ? `${manqueVentes} Le coût par conversion de chaque régie est plus bas, par canal.` : 'Aucune commande sur la période.',
    ),
    kpi('cac', 'CAC', 'argent', 'baisse', 'Dépenses ÷ nouveaux clients Shopify', MANQUE_CAC),
    kpi('panier', 'Panier moyen', 'argent', 'hausse', 'Chiffre d’affaires ÷ commandes', manqueVentes),
    kpi(
      'conversion',
      'Taux de conversion',
      'pourcent',
      'hausse',
      avecVentes ? 'Commandes Shopify ÷ visites GA4' : 'Achats ÷ visites, selon GA4',
      MANQUE_CONVERSION,
    ),
  ]
}

export function ensemble(donnees: Donnees, bornes: { du: string; au: string }): Ensemble {
  return {
    pub: cumulPub(donnees.campagnes, bornes, (ligne) => donnees.regies.includes(ligne.plateforme)),
    ventes: cumulVentes(donnees.ventes, bornes),
    aDesRegies: donnees.regies.length > 0,
    visites: cumulVisites(donnees.visites, bornes),
  }
}

// ── Canaux ───────────────────────────────────────────────────────────────────

export type LigneCanal = {
  canal: CanalNova
  nom: string
  /** Clics pour une régie, clics Google pour le SEO (sur 28 jours). `null` : pas mesuré. */
  trafic: number | null
  traficNote: string
  depenses: number | null
  /** Déclarées par la régie. */
  conversionsDeclarees: number | null
  revenuDeclare: number | null
  /** Vues par la boutique, au dernier clic. */
  commandes: number | null
  chiffre: number | null
  cpa: number | null
  roas: number | null
  /** Conversions ÷ clics, pour une régie. Ailleurs, il faudrait le nombre de visites. */
  tauxConversion: number | null
  /** Sessions GA4 de ce canal, `null` sans GA4. */
  sessions: number | null
  /** Achats ÷ sessions de ce canal, selon GA4, en pour cent à une décimale. */
  conversionGa4: number | null
  /** Les étiquettes d'origine regroupées dans ce canal, les plus fréquentes d'abord. */
  origines: string[]
}

/**
 * La performance par canal.
 *
 * Deux sources par ligne quand elles existent, et jamais fondues : ce que la régie déclare,
 * et ce que la boutique a vu arriver au dernier clic. Les deux se lisent côte à côte ; les
 * additionner serait compter deux fois.
 */
export function performanceCanaux(
  donnees: Donnees,
  bornes: { du: string; au: string },
  ventes: CumulVentes | null,
  visites: CumulVisites | null = null,
): LigneCanal[] {
  const lignes: LigneCanal[] = []
  for (const canal of CANAUX) {
    const vues = ventes?.canaux[canal] ?? null
    const ga4 = visites?.canaux[canal] ?? null
    const payant = canal === 'google-ads' || canal === 'meta-ads'
    const pub = payant && donnees.regies.includes(canal) ? cumulPub(donnees.campagnes, bornes, (l) => l.plateforme === canal) : null
    const seo = canal === 'seo' ? donnees.recherche : null
    if (vues === null && pub === null && seo === null && ga4 === null) continue
    lignes.push({
      canal,
      nom: NOM_CANAL[canal],
      trafic: pub !== null ? pub.clics : seo !== null ? seo.clics28 : null,
      traficNote: pub !== null ? 'clics sur les annonces' : seo !== null ? `clics Google sur les 28 jours au ${dateLisible(seo.au)}` : '',
      depenses: pub === null ? null : arrondi(pub.depense),
      conversionsDeclarees: pub === null ? null : arrondi(pub.conversions, 1),
      revenuDeclare: pub === null ? null : arrondi(pub.valeur),
      commandes: vues?.commandes ?? (ventes === null ? null : 0),
      chiffre: vues === null ? (ventes === null ? null : 0) : arrondi(vues.chiffre),
      cpa: pub === null || pub.conversions === 0 ? null : arrondi(pub.depense / pub.conversions),
      roas: pub === null ? null : enPourcent(pub.valeur, pub.depense),
      tauxConversion: pub === null || pub.clics === 0 ? null : arrondi((pub.conversions / pub.clics) * 100, 1),
      sessions: ga4?.sessions ?? (visites === null ? null : 0),
      conversionGa4: ga4 === null || ga4.sessions === 0 ? null : arrondi((ga4.achats / ga4.sessions) * 100, 1),
      origines: Object.entries(vues?.origines ?? {})
        .sort((un, autre) => autre[1] - un[1])
        .slice(0, 5)
        .map(([origine]) => origine),
    })
  }
  return lignes
}

// ── Attribution ──────────────────────────────────────────────────────────────

export type Attribution = {
  plateformes: { plateforme: PlateformePayante; nom: string; conversions: number; revenu: number }[]
  reel: { commandes: number; chiffre: number } | null
  /** Ce que les régies revendiquent ensemble. Affiché pour être comparé, jamais additionné au réel. */
  revendique: number
  chevauchement: boolean
  explication: string
  modele: string
}

export const PRUDENCE =
  'Plusieurs plateformes peuvent revendiquer la même vente. Les résultats doivent donc être interprétés avec prudence.'

export const MODELE =
  'Régies : chacune selon son propre modèle et sa fenêtre d’attribution. Canaux vus par la boutique : dernier clic (la dernière visite enregistrée avant l’achat).'

function montant(valeur: number, devise: string): string {
  return `${devise} ${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 }).format(valeur)}`.trim()
}

/**
 * Ce que les régies revendiquent, face à ce que la boutique a encaissé.
 *
 * Le cœur du métier de Nova, et la phrase qu'aucune régie n'écrira : si Google et Meta
 * revendiquent ensemble plus que ce que la boutique a vendu, au moins une des deux compte
 * des ventes qu'elle partage avec l'autre.
 */
export function attribution(
  donnees: Donnees,
  bornes: { du: string; au: string },
  ventes: CumulVentes | null,
): Attribution {
  const plateformes = donnees.regies.map((plateforme) => {
    const pub = cumulPub(donnees.campagnes, bornes, (ligne) => ligne.plateforme === plateforme)
    return { plateforme, nom: NOM_CANAL[plateforme], conversions: arrondi(pub.conversions, 1), revenu: arrondi(pub.valeur) }
  })
  const revendique = arrondi(plateformes.reduce((total, ligne) => total + ligne.revenu, 0))
  const reel = ventes === null ? null : { commandes: ventes.commandes, chiffre: arrondi(ventes.chiffre) }
  const chevauchement = reel !== null && plateformes.length > 1 && revendique > reel.chiffre

  let explication = PRUDENCE
  if (reel !== null && plateformes.length > 0 && revendique > 0) {
    const qui = plateformes.map((ligne) => ligne.nom.replace(' Ads', '')).join(' et ')
    const verbe = plateformes.length > 1 ? 'revendiquent ensemble' : 'revendique'
    explication =
      revendique > reel.chiffre
        ? `${qui} ${verbe} ${montant(revendique, donnees.devise)} de revenu attribué alors que Shopify enregistre ${montant(reel.chiffre, donnees.devise)} de chiffre d’affaires total sur la période. ${plateformes.length > 1 ? 'Cela indique probablement un chevauchement d’attribution entre les plateformes.' : 'La régie s’attribue probablement des ventes qui venaient d’ailleurs.'}`
        : `${qui} ${verbe} ${montant(revendique, donnees.devise)} sur ${montant(reel.chiffre, donnees.devise)} encaissés par la boutique. Le reste vient d’autres canaux, ou de ventes que les régies n’ont pas vues. ${PRUDENCE}`
  }
  return { plateformes, reel, revendique, chevauchement, explication, modele: MODELE }
}

// ── Campagnes et produits ────────────────────────────────────────────────────

export type LigneCampagne = {
  plateforme: PlateformePayante
  campagneId: string
  nom: string
  depenses: number
  conversions: number
  revenu: number
  cpa: number | null
  roas: number | null
  /** Variation du ROAS, en pour cent, par rapport à la période précédente. */
  evolution: number | null
}

export function performanceCampagnes(
  donnees: Donnees,
  bornes: { du: string; au: string },
  avant: { du: string; au: string },
): LigneCampagne[] {
  const ids = new Map<string, { plateforme: PlateformePayante; nom: string }>()
  for (const ligne of donnees.campagnes) {
    if (dansPeriode(ligne.jour, bornes) && donnees.regies.includes(ligne.plateforme)) {
      ids.set(`${ligne.plateforme}:${ligne.campagneId}`, { plateforme: ligne.plateforme, nom: ligne.nom })
    }
  }
  return [...ids.entries()]
    .map(([cle, { plateforme, nom }]) => {
      const campagneId = cle.slice(plateforme.length + 1)
      const filtre = (ligne: JourCampagne) => ligne.plateforme === plateforme && ligne.campagneId === campagneId
      const pub = cumulPub(donnees.campagnes, bornes, filtre)
      const precedent = cumulPub(donnees.campagnes, avant, filtre)
      const roas = enPourcent(pub.valeur, pub.depense)
      return {
        plateforme,
        campagneId,
        nom,
        depenses: arrondi(pub.depense),
        conversions: arrondi(pub.conversions, 1),
        revenu: arrondi(pub.valeur),
        cpa: pub.conversions === 0 ? null : arrondi(pub.depense / pub.conversions),
        roas,
        evolution: variation(roas, enPourcent(precedent.valeur, precedent.depense)),
      }
    })
    .filter((ligne) => ligne.depenses > 0 || ligne.conversions > 0)
    .sort((une, autre) => autre.depenses - une.depenses)
}

export type LigneProduit = {
  id: string
  titre: string
  chiffre: number
  commandes: number
  quantite: number
  /** Part du chiffre d'affaires de la période, de 0 à 1. */
  part: number
  /** Chiffre moyen par commande contenant ce produit. */
  panier: number | null
  evolution: number | null
}

export function performanceProduits(actuel: CumulVentes | null, precedent: CumulVentes | null): LigneProduit[] {
  if (actuel === null) return []
  const avant = new Map((precedent?.produits ?? []).map((produit) => [produit.id, produit]))
  return actuel.produits.map((produit) => ({
    id: produit.id,
    titre: produit.titre,
    chiffre: arrondi(produit.chiffre),
    commandes: produit.commandes,
    quantite: produit.quantite,
    part: actuel.chiffre === 0 ? 0 : produit.chiffre / actuel.chiffre,
    panier: produit.commandes === 0 ? null : arrondi(produit.chiffre / produit.commandes),
    evolution: precedent === null ? null : variation(produit.chiffre, avant.get(produit.id)?.chiffre ?? 0),
  }))
}
