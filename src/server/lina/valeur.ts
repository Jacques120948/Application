import type { Paire, ProduitAnalyse } from './commandes'
import type { Criteres } from './criteres'
import { argent, nombreLisible, type Campagne, type Niveau } from './recommandations'
import { appartient, jours, type ClientIndex, type ContexteSegments, type Segment } from './segments'

/**
 * Lina V2 : ce que les commandes permettent de dire en plus — quel produit se rachète, quoi
 * proposer ensuite, combien vaut un client, qui risque de partir, quelles audiences et quels
 * scénarios préparer. Pur et déterministe, comme le reste.
 *
 * Deux mots reviennent partout, et ce n'est pas une coquetterie : **observé** (ce qui s'est
 * passé) et **estimé** (ce qu'on en déduit). Une valeur client estimée n'est jamais montrée
 * sans sa méthode.
 */

const ANNEE = 365

function pourcent(part: number): string {
  return `${nombreLisible(part * 100, part < 0.1 ? 1 : 0)} %`
}

// ── Réachat par produit ─────────────────────────────────────────────────────

export type ReachatProduit = {
  ref: string
  titre: string
  acheteurs: number
  reacheteurs: number
  part: number
  p25: number
  p75: number
  mediane: number
  texte: string
}

/** Les produits qui se rachètent : au moins cinq clients les ont rachetés, et on connaît le rythme. */
export function reachatParProduit(produits: readonly ProduitAnalyse[]): ReachatProduit[] {
  return produits
    .filter((produit) => produit.reacheteurs >= 5 && produit.intervalleMedian !== null && produit.intervalleP25 !== null && produit.intervalleP75 !== null)
    .map((produit) => ({
      ref: produit.ref,
      titre: produit.titre,
      acheteurs: produit.acheteurs,
      reacheteurs: produit.reacheteurs,
      part: produit.acheteurs === 0 ? 0 : produit.reacheteurs / produit.acheteurs,
      p25: produit.intervalleP25!,
      p75: produit.intervalleP75!,
      mediane: produit.intervalleMedian!,
      texte: `Les clients ayant acheté « ${produit.titre} » le rachètent souvent entre ${produit.intervalleP25} et ${produit.intervalleP75} jours après (observé sur ${nombreLisible(produit.reacheteurs)} clients).`,
    }))
    .sort((a, b) => b.reacheteurs - a.reacheteurs)
}

// ── Cross-sell et montée en gamme ───────────────────────────────────────────

export type SuggestionProduit = {
  de: { ref: string; titre: string }
  vers: { ref: string; titre: string }
  clients: number
  part: number
  /** Aussi souvent achetés ensemble dans une même commande : une offre groupée a du sens. */
  ensemble: boolean
  texte: string
  /** Pour retrouver, dans Shopify, les acheteurs de A qui n'ont pas encore B. */
  requeteShopify: string
}

function titreDe(produits: ReadonlyMap<string, ProduitAnalyse>, ref: string): string {
  return produits.get(ref)?.titre ?? `Produit ${ref}`
}

export function suggestions(paires: readonly Paire[], produits: readonly ProduitAnalyse[], ensemble: readonly Paire[], montee: boolean): SuggestionProduit[] {
  const index = new Map(produits.map((produit) => [produit.ref, produit]))
  const groupes = new Set(ensemble.map((paire) => [paire.de, paire.vers].sort().join('>')))
  return paires
    .filter((paire) => paire.part >= 0.05)
    .map((paire) => {
      const de = titreDe(index, paire.de)
      const vers = titreDe(index, paire.vers)
      return {
        de: { ref: paire.de, titre: de },
        vers: { ref: paire.vers, titre: vers },
        clients: paire.clients,
        part: paire.part,
        ensemble: groupes.has([paire.de, paire.vers].sort().join('>')),
        texte: montee
          ? `${pourcent(paire.part)} des clients ayant acheté « ${de} » sont ensuite passés à « ${vers} », de la même gamme et plus cher (observé).`
          : `${pourcent(paire.part)} des clients ayant acheté « ${de} » ont ensuite acheté « ${vers} » (observé sur ${nombreLisible(paire.clients)} clients).`,
        requeteShopify: `products_purchased MATCHES (id = ${paire.de}) AND products_purchased NOT MATCHES (id = ${paire.vers})`,
      }
    })
}

// ── Valeur client ───────────────────────────────────────────────────────────

export type ValeurClient = {
  /** Ce qu'un acheteur a dépensé en moyenne jusqu'ici. */
  observeeCents: number | null
  /** Panier moyen × commandes par an × durée de vie estimée. `null` sans assez d'historique. */
  estimeeCents: number | null
  commandesParAn: number | null
  dureeVieAns: number | null
  /** Part des clients arrivés il y a plus d'un an qui n'ont rien commandé depuis un an. */
  attritionAnnuelle: number | null
  base: number
  methode: string
}

/** En dessous, l'attrition d'une année ne se lit pas. */
export const BASE_VALEUR_MIN = 50
const DUREE_VIE_MAX_ANS = 5

export function valeurClient(clients: readonly ClientIndex[], maintenant: Date): ValeurClient {
  const acheteurs = clients.filter((client) => client.commandes > 0 && client.derniereCommande !== null)
  const ca = acheteurs.reduce((total, client) => total + client.caCents, 0)
  const commandes = acheteurs.reduce((total, client) => total + client.commandes, 0)
  const observee = acheteurs.length === 0 ? null : Math.round(ca / acheteurs.length)
  const anciens = acheteurs.filter((client) => jours(client.premiereCommande ?? client.creeLe, maintenant) > ANNEE)
  const methode =
    'Estimée : panier moyen × commandes par an × durée de vie. La durée de vie vient de l’attrition observée (clients arrivés il y a plus d’un an qui n’ont rien commandé depuis un an), plafonnée à cinq ans.'
  if (anciens.length < BASE_VALEUR_MIN || commandes === 0) {
    return { observeeCents: observee, estimeeCents: null, commandesParAn: null, dureeVieAns: null, attritionAnnuelle: null, base: anciens.length, methode }
  }
  const partis = anciens.filter((client) => jours(client.derniereCommande!, maintenant) > ANNEE).length
  const attrition = partis / anciens.length
  const commandesParAn =
    anciens.reduce((total, client) => total + client.commandes / Math.max(1, jours(client.premiereCommande ?? client.creeLe, maintenant) / ANNEE), 0) / anciens.length
  const dureeVie = attrition === 0 ? DUREE_VIE_MAX_ANS : Math.min(DUREE_VIE_MAX_ANS, 1 / attrition)
  const panier = ca / commandes
  return {
    observeeCents: observee,
    estimeeCents: Math.round(panier * commandesParAn * dureeVie),
    commandesParAn: Math.round(commandesParAn * 100) / 100,
    dureeVieAns: Math.round(dureeVie * 10) / 10,
    attritionAnnuelle: attrition,
    base: anciens.length,
    methode,
  }
}

// ── Risque de départ ────────────────────────────────────────────────────────

export type NiveauRisque = { niveau: 'eleve' | 'moyen'; clients: number; caCents: number; libelle: string }

/**
 * Le risque estimé des clients réguliers : leur silence rapporté à leur propre rythme. Au-delà
 * de trois fois leur rythme, risque élevé ; entre deux et trois fois, moyen. Les dormants n'y
 * sont pas : ils sont déjà partis, ils relèvent de la reconquête.
 */
export function risquesDepart(clients: readonly ClientIndex[], contexte: ContexteSegments): NiveauRisque[] {
  const eleve = { clients: 0, caCents: 0 }
  const moyen = { clients: 0, caCents: 0 }
  for (const client of clients) {
    if (!appartient(client, 'a-risque', contexte) || client.derniereCommande === null) continue
    const rythme = client.intervalleJours ?? null
    const silence = jours(client.derniereCommande, contexte.maintenant)
    const cible = rythme === null ? moyen : silence > 3 * Math.max(7, rythme) ? eleve : moyen
    cible.clients += 1
    cible.caCents += client.caCents
  }
  return [
    { niveau: 'eleve', ...eleve, libelle: 'Silence de plus de trois fois leur rythme habituel' },
    { niveau: 'moyen', ...moyen, libelle: 'Silence de deux à trois fois leur rythme habituel' },
  ]
}

// ── Programme de fidélité ───────────────────────────────────────────────────

export type PalierFidelite = { cle: string; nom: string; regle: string; clients: number; caCents: number; partCa: number | null; avantage: string }

/** Des paliers tirés de la base elle-même ; les avantages proposés ne coûtent pas une remise. */
export function programmeFidelite(segments: readonly Segment[], clients: readonly ClientIndex[], criteres: Criteres): PalierFidelite[] {
  const caTotal = clients.reduce((total, client) => total + client.caCents, 0)
  const vip = segments.find((segment) => segment.cle === 'vip')
  const compte = (filtre: (client: ClientIndex) => boolean) => {
    const membres = clients.filter(filtre)
    const ca = membres.reduce((total, client) => total + client.caCents, 0)
    return { clients: membres.length, caCents: ca, partCa: caTotal === 0 ? null : ca / caTotal }
  }
  return [
    {
      cle: 'decouverte',
      nom: 'Découverte',
      regle: 'Une commande',
      ...compte((client) => client.commandes === 1),
      avantage: 'Conseils d’utilisation et une raison de revenir (nouveauté, complément).',
    },
    {
      cle: 'habitue',
      nom: 'Habitué',
      regle: `De 2 à ${criteres.fideleCommandes - 1} commandes`,
      ...compte((client) => client.commandes >= 2 && client.commandes < criteres.fideleCommandes),
      avantage: 'Accès aux nouveautés avant les autres.',
    },
    {
      cle: 'fidele',
      nom: 'Fidèle',
      regle: `${criteres.fideleCommandes} commandes ou plus`,
      ...compte((client) => client.commandes >= criteres.fideleCommandes),
      avantage: 'Contenu réservé, invitation aux avant-premières, attention personnelle.',
    },
    {
      cle: 'vip',
      nom: 'VIP',
      regle: vip?.critere ?? 'Les plus gros clients',
      clients: vip?.nombre ?? 0,
      caCents: vip?.caCents ?? 0,
      partCa: vip?.partCa ?? null,
      avantage: 'Remerciement personnel, accès anticipé, cadeau surprise plutôt qu’une remise.',
    },
  ]
}

// ── Audiences publicitaires ─────────────────────────────────────────────────

export type AudiencePub = { cle: string; segment: string; nom: string; clients: number; usage: string; agent: 'meta' | 'ads' }

/**
 * Les audiences utiles à MIRA et à Naya. Rien ne sort d'Evoliia : Shopify synchronise ses
 * segments clients avec Meta et Google par ses propres canaux de vente, sur autorisation de
 * la personne. Lina dit quels segments valent la peine, et transmet à MIRA et Naya des totaux.
 */
export function audiencesPub(segments: readonly Segment[]): AudiencePub[] {
  const nombre = (cle: string) => segments.find((segment) => segment.cle === cle)?.nombre ?? 0
  const liste: AudiencePub[] = [
    { cle: 'similaires-meta', segment: 'vip', nom: 'Meilleurs clients (VIP)', clients: nombre('vip'), usage: 'Base d’une audience similaire : trouver des gens qui leur ressemblent.', agent: 'meta' },
    { cle: 'similaires-google', segment: 'fideles', nom: 'Clients fidèles', clients: nombre('fideles'), usage: 'Liste de clients (Customer Match) pour des audiences similaires ou des enchères adaptées.', agent: 'ads' },
    { cle: 'exclusion', segment: 'nouveaux', nom: 'Acheteurs récents', clients: nombre('nouveaux'), usage: 'À exclure des campagnes d’acquisition : ils viennent d’acheter.', agent: 'meta' },
    { cle: 'reconquete', segment: 'dormants', nom: 'Clients dormants', clients: nombre('dormants'), usage: 'Campagne de reconquête, en complément des emails.', agent: 'meta' },
  ]
  return liste.filter((audience) => audience.clients >= 100 || (audience.cle === 'exclusion' && audience.clients > 0))
}

// ── Scénarios automatisés, préparés ─────────────────────────────────────────

export type Scenario = { cle: string; si: string; alors: string; concernes: number | null; ou: string }

/**
 * Les scénarios « SI… ALORS… », préparés et comptés. Lina ne les déclenche pas : Shopify le
 * fait (Automatisations marketing, Shopify Flow), une fois que la personne les a activés.
 */
export function scenarios(segments: readonly Segment[], reachat: readonly ReachatProduit[], paniersRestants: number | null, criteres: Criteres): Scenario[] {
  const nombre = (cle: string) => segments.find((segment) => segment.cle === cle)?.nombre ?? null
  const liste: Scenario[] = [
    { cle: 'panier', si: 'Un panier est abandonné depuis 1 heure', alors: 'Envoyer le rappel de panier (sans remise)', concernes: paniersRestants, ou: 'Shopify → Marketing → Automatisations → Panier abandonné' },
    { cle: 'deuxieme', si: 'Première commande il y a 30 jours, sans deuxième', alors: 'Envoyer conseils puis produit complémentaire', concernes: nombre('une-fois'), ou: 'Shopify → Marketing → Automatisations → Post-achat' },
    { cle: 'reactivation', si: `Aucune commande depuis ${criteres.dormantJours} jours`, alors: 'Ajouter au segment de reconquête et préparer l’email', concernes: nombre('dormants'), ou: 'Shopify Flow (déclencheur planifié) ou segment Shopify' },
    { cle: 'fidele', si: `${criteres.fideleCommandes} commandes ou plus`, alors: 'Passer au palier « Fidèle » (tag client)', concernes: nombre('fideles'), ou: 'Shopify Flow : « Commande créée » → condition sur le nombre de commandes → ajouter un tag' },
    { cle: 'vip', si: 'Le client entre dans les VIP', alors: 'Remerciement personnel et invitation aux avant-premières', concernes: nombre('vip'), ou: 'Segment Shopify VIP + email manuel' },
  ]
  const premier = reachat[0]
  if (premier !== undefined) {
    liste.push({
      cle: 'reachat',
      si: `« ${premier.titre} » acheté il y a ${premier.p25} jours`,
      alors: 'Envoyer un rappel de réachat',
      concernes: null,
      ou: 'Shopify Flow ou votre outil d’emailing, déclencheur « commande créée » + délai',
    })
  }
  return liste
}

// ── Campagnes V2 ────────────────────────────────────────────────────────────

const TAUX_REACHAT = 0.15
const TAUX_CROSS = 0.05

/**
 * Les campagnes que les produits rendent possibles : réachat au bon moment, produit
 * complémentaire, montée en gamme. L'audience est comptée dans l'analyse (acheteurs de A qui
 * n'ont pas encore B) ; le consentement se vérifie dans Shopify, par la requête fournie.
 */
export function campagnesProduits(
  reachat: readonly ReachatProduit[],
  croisees: readonly SuggestionProduit[],
  montees: readonly SuggestionProduit[],
  produits: readonly ProduitAnalyse[],
  devise: string,
): Campagne[] {
  const prix = new Map(produits.map((produit) => [produit.ref, produit.prixMoyenCents]))
  const liste: Campagne[] = []
  const niveau = (potentiel: number, max: number): Niveau => (max === 0 ? 'faible' : potentiel / max >= 0.5 ? 'eleve' : potentiel / max >= 0.2 ? 'moyen' : 'faible')
  for (const produit of reachat.slice(0, 2)) {
    const audience = produit.acheteurs
    const panier = prix.get(produit.ref) ?? 0
    liste.push({
      cle: `reachat-${produit.ref}`,
      titre: `Rappel de réachat : « ${produit.titre} »`,
      segment: null,
      audience,
      audienceLibelle: 'acheteurs de ce produit (consentement à vérifier dans Shopify)',
      objectif: 'Rappeler le produit au moment où il est habituellement racheté.',
      message: 'Un rappel pratique, au bon moment : « il est peut-être temps de le renouveler ».',
      timing: `Entre ${produit.p25} et ${produit.p75} jours après l’achat (rythme observé).`,
      canal: 'Email',
      etapes: [{ quand: `J+${produit.p25}`, contenu: 'Rappel de réachat, avec le produit et un lien direct.' }],
      impact: 'moyen',
      effort: 'faible',
      potentielCents: Math.round(audience * TAUX_REACHAT * panier),
      hypothese: `Hypothèse de calcul : ${pourcent(TAUX_REACHAT)} de l’audience rachète au prix moyen observé du produit (${argent(panier, devise)}). Ce n’est pas une prévision.`,
      remise: 'Pas de remise : le bon moment suffit.',
      consentement: 'Vérifiez dans Shopify qu’ils acceptent vos emails : la requête ci-dessous les filtre.',
      requeteShopify: `products_purchased MATCHES (id = ${produit.ref}, date BETWEEN -${produit.p75}d AND -${produit.p25}d) AND email_subscription_status = 'SUBSCRIBED'`,
    })
  }
  for (const [suggestion, montee] of [...croisees.slice(0, 2).map((un) => [un, false] as const), ...montees.slice(0, 1).map((un) => [un, true] as const)]) {
    const base = produits.find((produit) => produit.ref === suggestion.de.ref)?.acheteurs ?? 0
    const audience = Math.max(0, base - suggestion.clients)
    const panier = prix.get(suggestion.vers.ref) ?? 0
    liste.push({
      cle: `${montee ? 'upsell' : 'cross-sell'}-${suggestion.de.ref}-${suggestion.vers.ref}`,
      titre: montee ? `Montée en gamme : de « ${suggestion.de.titre} » à « ${suggestion.vers.titre} »` : `Produit complémentaire : « ${suggestion.vers.titre} » après « ${suggestion.de.titre} »`,
      segment: null,
      audience,
      audienceLibelle: `acheteurs de « ${suggestion.de.titre} » qui ne l’ont pas encore (consentement à vérifier)`,
      objectif: montee ? 'Proposer la version supérieure à ceux qui connaissent déjà le produit.' : 'Proposer ce que les autres clients achètent ensuite.',
      message: suggestion.texte,
      timing: 'Après la première utilisation, typiquement trois à six semaines après l’achat.',
      canal: suggestion.ensemble && !montee ? 'Email, bloc « souvent achetés ensemble » sur la fiche produit, ou offre groupée' : 'Email ou bloc de recommandation sur la fiche produit',
      etapes: [{ quand: 'J+30', contenu: montee ? 'Ce que la version supérieure apporte en plus.' : 'Pourquoi ce produit complète le premier.' }],
      impact: 'moyen',
      effort: 'faible',
      potentielCents: Math.round(audience * TAUX_CROSS * panier),
      hypothese: `Hypothèse de calcul : ${pourcent(TAUX_CROSS)} de l’audience achète au prix moyen observé (${argent(panier, devise)}). Ce n’est pas une prévision.`,
      remise: 'Pas de remise par défaut ; une offre groupée se décide, elle ne se donne pas.',
      consentement: 'Vérifiez dans Shopify qu’ils acceptent vos emails : ajoutez email_subscription_status = \'SUBSCRIBED\' à la requête.',
      requeteShopify: `${suggestion.requeteShopify} AND email_subscription_status = 'SUBSCRIBED'`,
    })
  }
  const max = Math.max(0, ...liste.map((campagne) => campagne.potentielCents))
  return liste.filter((campagne) => campagne.audience > 0).map((campagne) => ({ ...campagne, impact: niveau(campagne.potentielCents, max) }))
}

/** Le produit que les clients d'un segment achètent le plus souvent. */
export function produitPrincipalSegment(
  clients: readonly ClientIndex[],
  cle: Segment['cle'],
  contexte: ContexteSegments,
  produits: readonly ProduitAnalyse[],
): string | null {
  const comptes = new Map<string, number>()
  for (const client of clients) {
    if (client.produitPrincipal == null || !appartient(client, cle, contexte)) continue
    comptes.set(client.produitPrincipal, (comptes.get(client.produitPrincipal) ?? 0) + 1)
  }
  const premier = [...comptes.entries()].sort((a, b) => b[1] - a[1])[0]
  if (premier === undefined) return null
  return produits.find((produit) => produit.ref === premier[0])?.titre ?? null
}

