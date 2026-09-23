import type { PaniersLina } from './collecte'
import type { Criteres } from './criteres'
import type { Indicateurs, Segment } from './segments'

/**
 * Ce que Lina tire des segments : les campagnes à préparer, ce qu'elle a remarqué, les
 * gains rapides, et l'état de la base. Tout est déterministe : mêmes clients, mêmes
 * recommandations.
 *
 * **Le potentiel d'une campagne est une hypothèse de calcul, et elle est affichée comme
 * telle.** Personne ne sait combien de clients reviendront ; Lina pose un taux de retour
 * prudent par type de campagne, le multiplie par l'audience et par le panier moyen observé,
 * et écrit le taux à côté du résultat. Le taux sert à comparer les campagnes entre elles, pas
 * à promettre un chiffre d'affaires.
 */

export type Niveau = 'eleve' | 'moyen' | 'faible'

export const NOM_NIVEAU: Record<Niveau, string> = { eleve: 'Élevé', moyen: 'Moyen', faible: 'Faible' }

export type EtapeCampagne = { quand: string; contenu: string }

export type Campagne = {
  cle: string
  titre: string
  /** Le segment visé, quand la campagne en vise un. */
  segment: string | null
  audience: number
  /** Ce que l'audience compte : clients joignables, clients, paniers. */
  audienceLibelle: string
  objectif: string
  message: string
  timing: string
  canal: string
  etapes: EtapeCampagne[]
  impact: Niveau
  effort: Niveau
  potentielCents: number
  hypothese: string
  /** La conduite à tenir sur les remises : jamais par défaut. */
  remise: string
  consentement: string
  /** La requête Shopify, déjà restreinte aux clients qui acceptent les emails quand on le sait. */
  requeteShopify: string | null
}

/**
 * Les taux de retour supposés, par type de campagne. Volontairement bas : ils servent à
 * classer, et un classement faux par optimisme coûte plus cher qu'un classement prudent.
 */
export const TAUX_HYPOTHESE = {
  'panier-abandonne': 0.1,
  reactivation: 0.05,
  'win-back': 0.02,
  'deuxieme-achat': 0.08,
  vip: 0.15,
  'post-achat': 0.1,
  'a-risque': 0.08,
  bienvenue: 0.03,
} as const

type TypeCampagne = keyof typeof TAUX_HYPOTHESE

const EFFORT: Record<TypeCampagne, Niveau> = {
  'panier-abandonne': 'faible',
  reactivation: 'faible',
  'win-back': 'faible',
  'deuxieme-achat': 'moyen',
  vip: 'moyen',
  'post-achat': 'moyen',
  'a-risque': 'moyen',
  bienvenue: 'faible',
}

const POIDS_EFFORT: Record<Niveau, number> = { faible: 1, moyen: 2, eleve: 3 }

export function nombreLisible(valeur: number, decimales = 0): string {
  return new Intl.NumberFormat('fr-CH', { maximumFractionDigits: decimales }).format(valeur)
}

export function argent(cents: number, devise: string): string {
  const valeur = cents / 100
  return `${devise} ${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: valeur < 100 ? 2 : 0 }).format(valeur)}`.trim()
}

function pourcent(part: number): string {
  return `${nombreLisible(part * 100, part < 0.1 ? 1 : 0)} %`
}

function segmentDe(segments: readonly Segment[], cle: string): Segment | undefined {
  return segments.find((segment) => segment.cle === cle)
}

const CONSENTEMENT_OUI = 'Seulement les clients qui acceptent vos emails marketing.'
const CONSENTEMENT_INCONNU = 'Consentement non lu : vérifiez dans Shopify qu’ils acceptent vos emails avant tout envoi.'
const SANS_REMISE = 'Sans remise d’abord : un rappel utile suffit souvent. Une offre ne se justifie qu’à la deuxième relance, et reste votre décision.'

function audienceDe(segment: Segment): { audience: number; libelle: string; consentement: string; requete: string | null } {
  return segment.contactables === null
    ? { audience: segment.nombre, libelle: 'clients (consentement à vérifier)', consentement: CONSENTEMENT_INCONNU, requete: segment.requeteShopify }
    : {
        audience: segment.contactables,
        libelle: 'clients joignables par email',
        consentement: CONSENTEMENT_OUI,
        requete: segment.requeteShopify === null ? null : `${segment.requeteShopify} AND email_subscription_status = 'SUBSCRIBED'`,
      }
}

type Brouillon = Omit<Campagne, 'impact' | 'effort'> & { type: TypeCampagne }

function jour(n: number): string {
  return n === 0 ? 'Le jour même' : `J+${n}`
}

/**
 * Les campagnes, classées : potentiel divisé par l'effort. Une campagne sans audience n'est
 * pas proposée — on ne recommande pas d'écrire à personne.
 */
export function campagnes(
  segments: readonly Segment[],
  indicateurs: Indicateurs,
  paniers: PaniersLina | null,
  criteres: Criteres,
  devise: string,
): Campagne[] {
  const brouillons: Brouillon[] = []
  const panierMoyen = indicateurs.panierMoyenCents ?? 0
  const potentiel = (audience: number, type: TypeCampagne, panier: number) => Math.round(audience * TAUX_HYPOTHESE[type] * panier)
  const hypothese = (type: TypeCampagne, panier: number) =>
    `Hypothèse de calcul : ${pourcent(TAUX_HYPOTHESE[type])} de l’audience rachète au panier moyen observé (${argent(panier, devise)}). Ce n’est pas une prévision.`

  if (paniers !== null && paniers.erreur === undefined) {
    const restants = paniers.courant.nombre - paniers.courant.recuperes
    const valeurMoyenne = paniers.courant.nombre === 0 ? 0 : Math.round(paniers.courant.valeurCents / paniers.courant.nombre)
    if (restants > 0) {
      brouillons.push({
        type: 'panier-abandonne',
        cle: 'panier-abandonne',
        titre: 'Récupérer les paniers abandonnés',
        segment: null,
        audience: restants,
        audienceLibelle: `paniers non finalisés en ${paniers.jours} jours`,
        objectif: 'Faire finaliser des achats presque faits.',
        message: 'Rappeler le panier tel qu’il était, lever les doutes (livraison, retours, paiement), sans pression.',
        timing: 'Automatique, dans les heures qui suivent l’abandon.',
        canal: 'Email (automatisation Shopify « Panier abandonné »)',
        etapes: [
          { quand: '1 heure après', contenu: 'Rappel simple : le panier, un bouton pour le reprendre.' },
          { quand: '24 heures après', contenu: 'Réassurance : bénéfices du produit, livraison, retours, avis clients.' },
          { quand: '72 heures après', contenu: 'Dernier rappel, court. Pas de remise par défaut.' },
        ],
        potentielCents: potentiel(restants, 'panier-abandonne', valeurMoyenne),
        hypothese: hypothese('panier-abandonne', valeurMoyenne),
        remise: SANS_REMISE,
        consentement:
          'Un rappel de panier n’est pas un envoi marketing partout : selon votre pays, il peut demander un consentement. Shopify n’écrit qu’aux acheteurs qui ont laissé leur adresse.',
        requeteShopify: null,
      })
    }
  }

  const tiedes = segmentDe(segments, 'a-reactiver')
  if (tiedes !== undefined && tiedes.nombre > 0) {
    const { audience, libelle, consentement, requete } = audienceDe(tiedes)
    const panier = tiedes.panierMoyenCents ?? panierMoyen
    brouillons.push({
      type: 'reactivation',
      cle: 'reactivation',
      titre: `Réactiver les clients inactifs depuis ${criteres.actifJours} à ${criteres.dormantJours} jours`,
      segment: 'a-reactiver',
      audience,
      audienceLibelle: libelle,
      objectif: 'Faire revenir des clients qui ne sont pas encore partis.',
      message: 'Donner une raison de revenir : nouveautés, conseil d’utilisation, rappel du produit qu’ils ont aimé.',
      timing: 'Cette semaine, en deux envois.',
      canal: 'Email',
      etapes: [
        { quand: jour(0), contenu: 'Nouveautés ou conseil utile, lié à ce qu’ils ont acheté.' },
        { quand: jour(7), contenu: 'Relance courte à ceux qui n’ont pas ouvert ou pas acheté.' },
      ],
      potentielCents: potentiel(audience, 'reactivation', panier),
      hypothese: hypothese('reactivation', panier),
      remise: SANS_REMISE,
      consentement,
      requeteShopify: requete,
    })
  }

  const dormants = segmentDe(segments, 'dormants')
  if (dormants !== undefined && dormants.nombre > 0) {
    const { audience, libelle, consentement, requete } = audienceDe(dormants)
    const panier = dormants.panierMoyenCents ?? panierMoyen
    brouillons.push({
      type: 'win-back',
      cle: 'win-back',
      titre: `Reconquérir les clients sans commande depuis plus de ${criteres.dormantJours} jours`,
      segment: 'dormants',
      audience,
      audienceLibelle: libelle,
      objectif: `Réveiller une base qui a déjà rapporté ${argent(dormants.caCents, devise)}.`,
      message: '« Ça fait longtemps » : ce qui a changé depuis leur dernier achat, sans insister.',
      timing: 'Deux envois espacés de dix jours.',
      canal: 'Email',
      etapes: [
        { quand: jour(0), contenu: 'Ce qui a changé : nouveaux produits, améliorations, avis récents.' },
        { quand: jour(10), contenu: 'Dernier message. Une offre seulement si le premier n’a rien donné, et si vous le décidez.' },
      ],
      potentielCents: potentiel(audience, 'win-back', panier),
      hypothese: hypothese('win-back', panier),
      remise: SANS_REMISE,
      consentement,
      requeteShopify: requete,
    })
  }

  const uneFois = segmentDe(segments, 'une-fois')
  if (uneFois !== undefined && uneFois.nombre > 0) {
    const { audience, libelle, consentement, requete } = audienceDe(uneFois)
    brouillons.push({
      type: 'deuxieme-achat',
      cle: 'deuxieme-achat',
      titre: 'Obtenir la deuxième commande',
      segment: 'une-fois',
      audience,
      audienceLibelle: libelle,
      objectif: 'Transformer un premier achat en habitude : la deuxième commande est la plus difficile.',
      message: 'Conseils pour bien utiliser le produit acheté, puis un produit complémentaire.',
      timing: 'Entre trente et soixante jours après la première commande.',
      canal: 'Email',
      etapes: [
        { quand: 'J+30', contenu: 'Conseils d’utilisation et réponse aux questions fréquentes.' },
        { quand: 'J+45', contenu: 'Un produit complémentaire, expliqué.' },
      ],
      potentielCents: potentiel(audience, 'deuxieme-achat', panierMoyen),
      hypothese: hypothese('deuxieme-achat', panierMoyen),
      remise: SANS_REMISE,
      consentement,
      requeteShopify: requete,
    })
  }

  const nouveaux = segmentDe(segments, 'nouveaux')
  if (nouveaux !== undefined && nouveaux.nombre > 0) {
    const { audience, libelle, consentement, requete } = audienceDe(nouveaux)
    brouillons.push({
      type: 'post-achat',
      cle: 'post-achat',
      titre: 'Mettre en place un parcours post-achat',
      segment: 'nouveaux',
      audience,
      audienceLibelle: libelle,
      objectif: 'Accompagner après l’achat : satisfaction, avis, puis réachat.',
      message: 'Aider à bien utiliser le produit avant de vendre quoi que ce soit d’autre.',
      timing: 'Automatique après chaque commande. Délais à adapter à votre cycle d’achat.',
      canal: 'Email (automatisation Shopify)',
      etapes: [
        { quand: 'J+3', contenu: 'Conseils d’utilisation.' },
        { quand: 'J+10', contenu: 'Demande d’avis.' },
        { quand: 'J+30', contenu: 'Produit complémentaire.' },
        { quand: 'J+60', contenu: 'Rappel de réachat, si le produit s’use ou se consomme.' },
      ],
      potentielCents: potentiel(audience, 'post-achat', panierMoyen),
      hypothese: hypothese('post-achat', panierMoyen),
      remise: 'Aucune remise : c’est un parcours de service.',
      consentement,
      requeteShopify: requete,
    })
  }

  const vip = segmentDe(segments, 'vip')
  if (vip !== undefined && vip.nombre > 0) {
    const { audience, libelle, consentement, requete } = audienceDe(vip)
    const panier = vip.panierMoyenCents ?? panierMoyen
    brouillons.push({
      type: 'vip',
      cle: 'vip',
      titre: 'Chouchouter vos VIP',
      segment: 'vip',
      audience,
      audienceLibelle: libelle,
      objectif: `Garder les clients qui pèsent ${vip.partCa === null ? 'le plus' : pourcent(vip.partCa)} de votre chiffre d’affaires.`,
      message: 'Remercier, et donner un accès anticipé ou un contenu réservé — pas une remise.',
      timing: 'Au prochain lancement ou à la prochaine nouveauté.',
      canal: 'Email',
      etapes: [{ quand: jour(0), contenu: 'Accès anticipé, avant-première ou contenu exclusif.' }],
      potentielCents: potentiel(audience, 'vip', panier),
      hypothese: hypothese('vip', panier),
      remise: 'Pas de remise : la reconnaissance compte plus qu’un pourcentage pour ces clients.',
      consentement,
      requeteShopify: requete,
    })
  }

  const risque = segmentDe(segments, 'a-risque')
  if (risque !== undefined && risque.nombre > 0) {
    const { audience, libelle, consentement } = audienceDe(risque)
    const panier = risque.panierMoyenCents ?? panierMoyen
    brouillons.push({
      type: 'a-risque',
      cle: 'a-risque',
      titre: 'Reprendre contact avec les clients au comportement inhabituel',
      segment: 'a-risque',
      audience,
      audienceLibelle: libelle,
      objectif: 'Des clients réguliers commandent moins que d’habitude : comprendre avant qu’ils partent.',
      message: 'Un message personnel : demander leur avis, rappeler ce qui est nouveau.',
      timing: 'Dans les deux semaines.',
      canal: 'Email',
      etapes: [{ quand: jour(0), contenu: 'Demande d’avis courte, et ce qui est nouveau.' }],
      potentielCents: potentiel(audience, 'a-risque', panier),
      hypothese: hypothese('a-risque', panier),
      remise: SANS_REMISE,
      consentement: `${consentement} Risque estimé à partir de leur rythme passé, pas une certitude.`,
      requeteShopify: null,
    })
  }

  const inscrits = segmentDe(segments, 'sans-commande')
  if (inscrits !== undefined && inscrits.nombre > 0) {
    const { audience, libelle, consentement, requete } = audienceDe(inscrits)
    brouillons.push({
      type: 'bienvenue',
      cle: 'bienvenue',
      titre: 'Convertir les inscrits qui n’ont jamais commandé',
      segment: 'sans-commande',
      audience,
      audienceLibelle: libelle,
      objectif: 'Faire passer à la première commande des personnes qui vous connaissent déjà.',
      message: 'Présenter les produits les plus appréciés, et pourquoi.',
      timing: 'Une série de bienvenue, puis un rappel mensuel.',
      canal: 'Email',
      etapes: [
        { quand: jour(0), contenu: 'Les produits les plus appréciés, et ce qui vous distingue.' },
        { quand: jour(7), contenu: 'Avis de clients et réponses aux questions fréquentes.' },
      ],
      potentielCents: potentiel(audience, 'bienvenue', panierMoyen),
      hypothese: hypothese('bienvenue', panierMoyen),
      remise: SANS_REMISE,
      consentement,
      requeteShopify: requete,
    })
  }

  const utiles = brouillons.filter((brouillon) => brouillon.audience > 0)
  const maximum = Math.max(0, ...utiles.map((brouillon) => brouillon.potentielCents))
  return utiles
    .map(({ type, ...reste }) => {
      const part = maximum === 0 ? 0 : reste.potentielCents / maximum
      const impact: Niveau = part >= 0.5 ? 'eleve' : part >= 0.2 ? 'moyen' : 'faible'
      return { ...reste, impact, effort: EFFORT[type] }
    })
    .sort((a, b) => b.potentielCents / POIDS_EFFORT[b.effort] - a.potentielCents / POIDS_EFFORT[a.effort])
}

// ── Ce que Lina a détecté ───────────────────────────────────────────────────

export type InsightLina = { cle: string; texte: string }

export const INSIGHTS_MAX = 5

export function insights(
  segments: readonly Segment[],
  indicateurs: Indicateurs,
  paniers: PaniersLina | null,
  criteres: Criteres,
  devise: string,
): InsightLina[] {
  const liste: InsightLina[] = []
  const dormants = segmentDe(segments, 'dormants')
  const uneFois = segmentDe(segments, 'une-fois')
  const recurrents = segmentDe(segments, 'recurrents')
  const vip = segmentDe(segments, 'vip')
  const risque = segmentDe(segments, 'a-risque')

  if (dormants !== undefined && dormants.nombre >= 20) {
    const mois = Math.round(criteres.dormantJours / 30)
    liste.push({
      cle: 'dormants',
      texte: `${nombreLisible(dormants.nombre)} clients n’ont rien commandé depuis plus de ${mois} mois. Ils ont rapporté ${argent(dormants.caCents, devise)} au total.`,
    })
  }
  if (paniers !== null && paniers.erreur === undefined && paniers.courant.nombre >= 5) {
    const taux = paniers.courant.recuperes / paniers.courant.nombre
    const hausse =
      paniers.precedent.nombre >= 5 && paniers.courant.nombre >= paniers.precedent.nombre * 1.25
        ? ` C’est ${pourcent(paniers.courant.nombre / paniers.precedent.nombre - 1)} de plus que les ${paniers.jours} jours précédents.`
        : ''
    liste.push({
      cle: 'paniers',
      texte: `${nombreLisible(paniers.courant.nombre)} paniers abandonnés en ${paniers.jours} jours (${argent(paniers.courant.valeurCents, devise)}), dont ${pourcent(taux)} finalement payés.${hausse}`,
    })
  }
  if (uneFois !== undefined && indicateurs.acheteurs >= 50) {
    liste.push({ cle: 'une-fois', texte: `${pourcent(uneFois.nombre / indicateurs.acheteurs)} de vos clients n’ont acheté qu’une seule fois.` })
  }
  if (recurrents !== undefined && uneFois !== undefined && recurrents.nombre >= 20 && uneFois.nombre >= 20) {
    const r = recurrents.panierMoyenCents
    const u = uneFois.panierMoyenCents
    if (r !== null && u !== null && u > 0 && Math.abs(r / u - 1) >= 0.1) {
      liste.push({
        cle: 'panier-recurrents',
        texte: `Vos clients récurrents ont un panier moyen ${pourcent(Math.abs(r / u - 1))} ${r > u ? 'plus élevé' : 'plus bas'} que ceux qui n’ont commandé qu’une fois (${argent(r, devise)} contre ${argent(u, devise)}).`,
      })
    }
  }
  if (indicateurs.partCaRecurrents !== null && indicateurs.recurrents >= 20) {
    liste.push({ cle: 'ca-recurrents', texte: `Les clients récurrents représentent ${pourcent(indicateurs.partCaRecurrents)} de votre chiffre d’affaires.` })
  }
  if (vip !== undefined && vip.nombre > 0 && vip.partCa !== null) {
    liste.push({ cle: 'vip', texte: `Vos ${nombreLisible(vip.nombre)} VIP pèsent ${pourcent(vip.partCa)} de votre chiffre d’affaires.` })
  }
  if (risque !== undefined && risque.nombre >= 10) {
    liste.push({
      cle: 'a-risque',
      texte: `${nombreLisible(risque.nombre)} clients réguliers commandent moins que d’habitude (comportement inhabituel, risque estimé).`,
    })
  }
  if (indicateurs.contactables !== null && indicateurs.acheteurs >= 50) {
    const part = indicateurs.contactables / Math.max(1, indicateurs.acheteurs + indicateurs.sansCommande)
    if (part < 0.3) liste.push({ cle: 'consentement', texte: `Seuls ${pourcent(part)} de vos clients acceptent vos emails marketing : c’est la limite de toute campagne.` })
  }
  return liste.slice(0, INSIGHTS_MAX)
}

// ── Quick wins ──────────────────────────────────────────────────────────────

export const QUICK_WINS_MAX = 5

/** Les gains rapides : les campagnes à faible effort d'abord, dites comme une action. */
export function quickWins(liste: readonly Campagne[]): { cle: string; texte: string }[] {
  const phrases: Record<string, (campagne: Campagne) => string> = {
    'panier-abandonne': (c) => `Relancer les ${nombreLisible(c.audience)} paniers abandonnés du mois.`,
    reactivation: (c) => `Réactiver ${nombreLisible(c.audience)} clients inactifs depuis quelques mois.`,
    'win-back': (c) => `Écrire aux ${nombreLisible(c.audience)} clients dormants.`,
    'deuxieme-achat': (c) => `Demander la deuxième commande à ${nombreLisible(c.audience)} clients.`,
    'post-achat': () => 'Créer une séquence post-achat (conseils, avis, réachat).',
    vip: (c) => `Créer un segment VIP (${nombreLisible(c.audience)} clients) et le remercier.`,
    'a-risque': (c) => `Reprendre contact avec ${nombreLisible(c.audience)} clients au comportement inhabituel.`,
    bienvenue: (c) => `Convertir ${nombreLisible(c.audience)} inscrits qui n’ont jamais commandé.`,
  }
  return [...liste]
    .sort((a, b) => POIDS_EFFORT[a.effort] - POIDS_EFFORT[b.effort])
    .slice(0, QUICK_WINS_MAX)
    .map((campagne) => ({ cle: campagne.cle, texte: phrases[campagne.cle]?.(campagne) ?? campagne.titre }))
}

// ── Santé CRM ───────────────────────────────────────────────────────────────

export type LigneSanteCrm = { cle: string; etat: 'bon' | 'verifier' | 'probleme'; texte: string }

export function santeCrm(
  segments: readonly Segment[],
  indicateurs: Indicateurs,
  paniers: PaniersLina | null,
  base: { clients: number; tronque: boolean; consentement: boolean; plusAncien: Date | null; maintenant: Date },
): LigneSanteCrm[] {
  const lignes: LigneSanteCrm[] = []
  lignes.push({
    cle: 'base',
    etat: base.tronque ? 'verifier' : 'bon',
    texte: base.tronque
      ? `${nombreLisible(base.clients)} clients lus : la base est plus grande, les chiffres portent sur cette partie.`
      : `${nombreLisible(base.clients)} fiches clients lues. Les doublons ne se voient pas sans courriel : Shopify les signale dans Clients (fusionner les fiches).`,
  })
  if (!base.consentement) {
    lignes.push({
      cle: 'consentement',
      etat: 'verifier',
      texte: 'Le consentement marketing n’a pas pu être lu : chaque campagne demande de vérifier dans Shopify qui accepte vos emails.',
    })
  } else {
    const total = Math.max(1, base.clients)
    const oui = indicateurs.contactables ?? 0
    const sansEmail = indicateurs.sansEmail ?? 0
    lignes.push({
      cle: 'consentement',
      etat: oui / total < 0.2 ? 'verifier' : 'bon',
      texte: `${pourcent(oui / total)} des clients acceptent vos emails marketing ; ${nombreLisible(total - oui - sansEmail)} ne les acceptent pas.`,
    })
    if (sansEmail > 0) {
      lignes.push({
        cle: 'emails',
        etat: sansEmail / total > 0.2 ? 'verifier' : 'bon',
        texte: `${nombreLisible(sansEmail)} fiches sans adresse email : ces clients ne peuvent être joints que par un autre canal.`,
      })
    }
  }
  const joursHistorique = base.plusAncien === null ? 0 : (+base.maintenant - +base.plusAncien) / (24 * 60 * 60 * 1000)
  if (indicateurs.acheteurs < 50 || joursHistorique < 180) {
    lignes.push({
      cle: 'historique',
      etat: 'verifier',
      texte:
        indicateurs.acheteurs < 50
          ? `${nombreLisible(indicateurs.acheteurs)} acheteurs seulement : les taux sont fragiles, et les segments relatifs (VIP, RFM) attendent au moins 50 acheteurs.`
          : 'Moins de six mois d’historique : les clients dormants et le réachat se liront mieux avec le temps.',
    })
  }
  const petits = segments.filter((segment) => segment.tropPetit)
  if (petits.length > 0) {
    lignes.push({
      cle: 'petits',
      etat: 'bon',
      texte: `Segments trop petits pour en tirer une règle : ${petits.map((segment) => segment.nom.toLowerCase()).join(', ')}.`,
    })
  }
  if (paniers === null) {
    lignes.push({ cle: 'paniers', etat: 'verifier', texte: 'Paniers abandonnés non lus : l’autorisation « read_orders » manque.' })
  } else if (paniers.erreur !== undefined) {
    lignes.push({ cle: 'paniers', etat: 'verifier', texte: paniers.erreur })
  } else if (paniers.tronque) {
    lignes.push({ cle: 'paniers', etat: 'verifier', texte: 'Paniers abandonnés très nombreux : seuls les premiers milliers ont été lus.' })
  }
  return lignes
}
