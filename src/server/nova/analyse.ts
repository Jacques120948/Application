import { ecranDuMembre, membre, type IdMembre } from '@/lib/equipe'
import { NOM_CANAL } from '@/lib/nova'
import { variation } from '@/server/ads/metriques'
import {
  cumulPub,
  enPourcent,
  type Attribution,
  type CumulPub,
  type CumulVentes,
  type Donnees,
  type LigneCampagne,
  type LigneProduit,
  type PlateformePayante,
} from './metriques'

/**
 * Ce que Nova remarque. Des règles, pas un modèle.
 *
 * Chaque remarque naît d'une comparaison chiffrée, avec un seuil et un volume minimal. Le
 * volume minimal n'est pas une coquetterie : une hausse de 50 % du coût par vente sur deux
 * ventes n'est pas une tendance, c'est une vente. Sans lui, Nova crierait au loup tous les
 * lundis et on cesserait de la lire.
 *
 * Et chaque remarque dit ce qu'elle observe, jamais ce qui l'a causé. « Le coût par
 * conversion Meta a augmenté de 34 % » est un fait ; « parce que la créative s'use » serait
 * une hypothèse, et elle appartient à MIRA, qui a les données pour la vérifier.
 */

export type Contexte = {
  donnees: Donnees
  bornes: { du: string; au: string }
  avant: { du: string; au: string }
  /** Les trente jours qui précèdent la période : la moyenne à laquelle comparer une semaine. */
  reference: { du: string; au: string }
  jours: number
  ventes: CumulVentes | null
  ventesAvant: CumulVentes | null
  attribution: Attribution
  campagnes: LigneCampagne[]
  produits: LigneProduit[]
}

const AGENT_DE: Record<PlateformePayante, IdMembre> = { 'google-ads': 'ads', 'meta-ads': 'meta' }

/** Les volumes en dessous desquels une variation n'est pas une tendance. */
export const SEUILS = {
  conversionsMin: 10,
  commandesMin: 20,
  depenseMin: 50,
  partProduit: 0.2,
  nonAttribue: 0.3,
} as const

function pourcent(valeur: number): string {
  return `${Math.round(Math.abs(valeur))} %`
}

function argent(valeur: number, devise: string): string {
  return `${devise} ${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: valeur < 100 ? 2 : 0 }).format(valeur)}`.trim()
}

function nom(plateforme: PlateformePayante): string {
  return NOM_CANAL[plateforme]
}

function pub(ctx: Contexte, plateforme: PlateformePayante, bornes: { du: string; au: string }): CumulPub {
  return cumulPub(ctx.donnees.campagnes, bornes, (ligne) => ligne.plateforme === plateforme)
}

function cpa(cumul: CumulPub): number | null {
  return cumul.conversions === 0 ? null : cumul.depense / cumul.conversions
}

// ── Insights ─────────────────────────────────────────────────────────────────

export type Insight = {
  cle: string
  texte: string
  /** Sur quoi il repose : les chiffres et leur source. */
  fondement: string
  ton: 'positif' | 'neutre' | 'attention'
}

export const INSIGHTS_MAX = 5

/**
 * Ce que Nova a détecté, cinq au plus, du plus utile au moins.
 *
 * L'ordre est fixe et il est voulu : l'écart entre ce que les régies revendiquent et ce que
 * la boutique encaisse passe avant tout, parce qu'il change la lecture de tout le reste.
 */
export function detecterInsights(ctx: Contexte): Insight[] {
  const trouves: Insight[] = []
  const devise = ctx.donnees.devise
  const regies = ctx.donnees.regies

  if (ctx.attribution.chevauchement) {
    trouves.push({
      cle: 'attribution.chevauchement',
      texte: ctx.attribution.explication,
      fondement: 'Revenu déclaré par chaque régie, comparé au chiffre d’affaires Shopify de la même période.',
      ton: 'attention',
    })
  }

  // Part du revenu déclaré contre part de la dépense, quand les deux régies dépensent.
  if (regies.length === 2) {
    const cumuls = regies.map((plateforme) => ({ plateforme, cumul: pub(ctx, plateforme, ctx.bornes) }))
    const depense = cumuls.reduce((total, un) => total + un.cumul.depense, 0)
    const valeur = cumuls.reduce((total, un) => total + un.cumul.valeur, 0)
    if (depense > 0 && valeur > 0) {
      const meilleure = cumuls
        .map((un) => ({ ...un, partValeur: un.cumul.valeur / valeur, partDepense: un.cumul.depense / depense }))
        .sort((un, autre) => autre.partValeur - autre.partDepense - (un.partValeur - un.partDepense))[0]!
      if (meilleure.partValeur - meilleure.partDepense >= 0.05) {
        trouves.push({
          cle: `part.${meilleure.plateforme}`,
          texte: `${nom(meilleure.plateforme)} génère ${pourcent(meilleure.partValeur * 100)} du revenu déclaré par les régies avec ${pourcent(meilleure.partDepense * 100)} des dépenses publicitaires.`,
          fondement: 'Revenu et dépense déclarés par Google Ads et Meta Ads sur la période. Chaque régie compte à sa façon : c’est une comparaison, pas une preuve.',
          ton: 'positif',
        })
      }
    }
  }

  for (const plateforme of regies) {
    const actuel = pub(ctx, plateforme, ctx.bornes)
    const avant = pub(ctx, plateforme, ctx.avant)
    if (avant.conversions < SEUILS.conversionsMin || actuel.conversions < 5) continue
    const ecart = variation(cpa(actuel), cpa(avant))
    if (ecart === null || Math.abs(ecart) < 15) continue
    trouves.push({
      cle: `cpa.${plateforme}`,
      texte: `Votre coût par conversion ${nom(plateforme).replace(' Ads', '')} a ${ecart > 0 ? 'augmenté' : 'baissé'} de ${pourcent(ecart)} par rapport à la période précédente.`,
      fondement: `${argent(cpa(avant)!, devise)} avant, ${argent(cpa(actuel)!, devise)} maintenant, sur ${Math.round(actuel.conversions)} conversions déclarées.`,
      ton: ecart > 0 ? 'attention' : 'positif',
    })
  }

  if (ctx.ventes !== null && ctx.ventesAvant !== null && ctx.ventesAvant.commandes >= SEUILS.commandesMin) {
    const ecart = variation(ctx.ventes.chiffre, ctx.ventesAvant.chiffre)
    if (ecart !== null && Math.abs(ecart) >= 10) {
      trouves.push({
        cle: 'ventes.tendance',
        texte: `Votre chiffre d’affaires ${ecart > 0 ? 'progresse' : 'recule'} de ${pourcent(ecart)} par rapport à la période précédente.`,
        fondement: `${argent(ctx.ventesAvant.chiffre, devise)} avant, ${argent(ctx.ventes.chiffre, devise)} maintenant (Shopify).`,
        ton: ecart > 0 ? 'positif' : 'attention',
      })
    }
  }

  // Le trafic de recherche monte, les ventes non : la question est pour Cleo.
  const recherche = ctx.donnees.recherche
  if (recherche !== null && recherche.clics28Avant !== null && ctx.ventes !== null && ctx.ventesAvant !== null) {
    const trafic = variation(recherche.clics28, recherche.clics28Avant)
    const commandes = variation(ctx.ventes.commandes, ctx.ventesAvant.commandes)
    if (trafic !== null && trafic >= 20 && commandes !== null && Math.abs(commandes) <= 5 && ctx.ventesAvant.commandes >= SEUILS.commandesMin) {
      trouves.push({
        cle: 'seo.trafic-sans-ventes',
        texte: `Le trafic Google augmente de ${pourcent(trafic)} mais les commandes restent stables.`,
        fondement: 'Clics Search Console sur 28 jours, comparés aux 28 jours d’avant ; commandes Shopify sur la période.',
        ton: 'attention',
      })
    }
  }

  const premier = ctx.produits[0]
  if (premier !== undefined && premier.part >= SEUILS.partProduit && ctx.produits.length > 1) {
    trouves.push({
      cle: `produit.${premier.id}`,
      texte: `« ${premier.titre} » représente ${pourcent(premier.part * 100)} de votre chiffre d’affaires.`,
      fondement: `${argent(premier.chiffre, devise)} sur ${premier.commandes} commande${premier.commandes > 1 ? 's' : ''} (Shopify).`,
      ton: 'neutre',
    })
  }

  const ia = ctx.ventes?.canaux.ia
  if (ia !== undefined && ia.commandes > 0) {
    const assistants = Object.keys(ia.origines).slice(0, 3).join(', ')
    trouves.push({
      cle: 'ia.ventes',
      texte: `${ia.commandes} commande${ia.commandes > 1 ? 's sont arrivées' : ' est arrivée'} depuis un assistant IA (${assistants}).`,
      fondement: 'Dernière visite enregistrée par Shopify avant l’achat, venant d’un assistant reconnu.',
      ton: 'positif',
    })
  }

  if (ctx.ventes !== null && ctx.ventes.commandes >= SEUILS.commandesMin) {
    const inconnues = ctx.ventes.canaux.inconnu?.commandes ?? 0
    const part = inconnues / ctx.ventes.commandes
    if (part >= SEUILS.nonAttribue) {
      trouves.push({
        cle: 'attribution.inconnue',
        texte: `${pourcent(part * 100)} de vos commandes n’ont pas d’origine connue : la répartition par canal est à lire avec prudence.`,
        fondement: 'Commandes Shopify sans dernière visite enregistrée.',
        ton: 'attention',
      })
    }
  }

  return trouves.slice(0, INSIGHTS_MAX)
}

// ── Alertes ──────────────────────────────────────────────────────────────────

export type Alerte = {
  cle: string
  niveau: 'rouge' | 'orange' | 'vert'
  texte: string
  fondement: string
  agent: IdMembre
}

export const ALERTES_MAX = 4

/**
 * Les alertes : peu, et seulement ce qui mérite qu'on s'arrête.
 *
 * Trois comparaisons. La période précédente, pour toutes. Et pour une période courte — un
 * jour, une semaine — la moyenne des trente jours d'avant : une semaine se compare mal à la
 * semaine d'avant, qui peut elle-même être exceptionnelle.
 */
export function detecterAlertes(ctx: Contexte): Alerte[] {
  const alertes: Alerte[] = []
  const devise = ctx.donnees.devise

  for (const plateforme of ctx.donnees.regies) {
    const agent = AGENT_DE[plateforme]
    const actuel = pub(ctx, plateforme, ctx.bornes)
    const avant = pub(ctx, plateforme, ctx.avant)
    const court = nom(plateforme)

    // Le suivi qui se tait : des conversions avant, aucune maintenant, et de la dépense.
    if (ctx.jours >= 7 && avant.conversions >= 5 && actuel.conversions === 0 && actuel.depense > 0) {
      alertes.push({
        cle: `suivi.${plateforme}`,
        niveau: 'rouge',
        texte: `Le suivi ${court} semble ne plus enregistrer correctement les conversions.`,
        fondement: `${Math.round(avant.conversions)} conversions la période précédente, aucune sur celle-ci pour ${argent(actuel.depense, devise)} dépensés.`,
        agent,
      })
      continue
    }

    const ecartCpa = avant.conversions >= SEUILS.conversionsMin && actuel.conversions >= 5 ? variation(cpa(actuel), cpa(avant)) : null
    if (ecartCpa !== null && ecartCpa >= 30) {
      alertes.push({
        cle: `cpa.${plateforme}`,
        niveau: 'rouge',
        texte: `Votre coût par conversion ${court} a augmenté de ${pourcent(ecartCpa)}.`,
        fondement: `${argent(cpa(avant)!, devise)} la période précédente, ${argent(cpa(actuel)!, devise)} sur celle-ci.`,
        agent,
      })
    } else if (ctx.jours <= 7) {
      const reference = pub(ctx, plateforme, ctx.reference)
      const ecart = reference.conversions >= SEUILS.conversionsMin && actuel.conversions >= 3 ? variation(cpa(actuel), cpa(reference)) : null
      if (ecart !== null && ecart >= 50) {
        alertes.push({
          cle: `cpa-historique.${plateforme}`,
          niveau: 'rouge',
          texte: `Votre coût par conversion ${court} est inhabituellement élevé.`,
          fondement: `${argent(cpa(actuel)!, devise)} sur la période, contre ${argent(cpa(reference)!, devise)} en moyenne sur les 30 jours précédents.`,
          agent,
        })
      }
    }

    const ecartDepense = variation(actuel.depense, avant.depense)
    const ecartValeur = variation(actuel.valeur, avant.valeur)
    if (avant.depense >= SEUILS.depenseMin && ecartDepense !== null && ecartDepense >= 20 && ecartValeur !== null && ecartValeur <= -20) {
      alertes.push({
        cle: `rendement.${plateforme}`,
        niveau: 'orange',
        texte: `${court} dépense davantage mais le revenu attribué diminue.`,
        fondement: `Dépense ${ecartDepense > 0 ? '+' : ''}${Math.round(ecartDepense)} %, revenu déclaré ${Math.round(ecartValeur)} % par rapport à la période précédente.`,
        agent,
      })
    }

    const roas = variation(enPourcent(actuel.valeur, actuel.depense), enPourcent(avant.valeur, avant.depense))
    if (avant.conversions >= SEUILS.conversionsMin && roas !== null && roas >= 20 && (ecartCpa === null || ecartCpa < 30)) {
      alertes.push({
        cle: `roas.${plateforme}`,
        niveau: 'vert',
        texte: `${court} affiche une amélioration du ROAS de ${pourcent(roas)}.`,
        fondement: `${enPourcent(avant.valeur, avant.depense)} % la période précédente, ${enPourcent(actuel.valeur, actuel.depense)} % sur celle-ci.`,
        agent,
      })
    }
  }

  if (ctx.ventes !== null && ctx.ventesAvant !== null && ctx.ventesAvant.commandes >= SEUILS.commandesMin) {
    const ecart = variation(ctx.ventes.commandes, ctx.ventesAvant.commandes)
    if (ecart !== null && ecart <= -30) {
      alertes.push({
        cle: 'ventes.baisse',
        niveau: 'orange',
        texte: `Vos commandes ont baissé de ${pourcent(ecart)} par rapport à la période précédente.`,
        fondement: `${ctx.ventesAvant.commandes} commandes avant, ${ctx.ventes.commandes} maintenant (Shopify).`,
        agent: 'cro',
      })
    }
  }

  const rang = { rouge: 0, orange: 1, vert: 2 } as const
  return alertes.sort((une, autre) => rang[une.niveau] - rang[autre.niveau]).slice(0, ALERTES_MAX)
}

// ── Opportunités ─────────────────────────────────────────────────────────────

export type Opportunite = {
  cle: string
  titre: string
  pourquoi: string
  impact: 'faible' | 'moyen' | 'eleve'
  agent: IdMembre
  cta: { label: string; href: string }
}

export const OPPORTUNITES_MAX = 3

function voirAvec(agent: IdMembre, locale: string, siteId: string): { label: string; href: string } {
  return { label: `Voir avec ${membre(agent)?.name ?? agent}`, href: ecranDuMembre(agent, locale, siteId).href }
}

/**
 * Les opportunités : ce qui marche mieux que le reste, et qui peut s'en occuper.
 *
 * Nova ne fait rien elle-même : elle mesure, et elle passe la main au spécialiste qui a les
 * moyens d'agir. Chaque opportunité nomme donc un agent et mène à son écran.
 */
export function detecterOpportunites(ctx: Contexte, locale: string, siteId: string): Opportunite[] {
  const trouvees: Opportunite[] = []

  for (const plateforme of ctx.donnees.regies) {
    const total = pub(ctx, plateforme, ctx.bornes)
    const moyenne = enPourcent(total.valeur, total.depense)
    if (moyenne === null || total.depense === 0) continue
    const meilleure = ctx.campagnes
      .filter((ligne) => ligne.plateforme === plateforme && ligne.roas !== null && ligne.conversions >= 5)
      .filter((ligne) => ligne.depenses / total.depense >= 0.1 && ligne.roas! >= moyenne * 1.5)
      .sort((une, autre) => autre.roas! - une.roas!)[0]
    if (meilleure === undefined) continue
    const agent = AGENT_DE[plateforme]
    trouvees.push({
      cle: `campagne.${plateforme}.${meilleure.campagneId}`,
      titre: `« ${meilleure.nom} » particulièrement performante`,
      pourquoi: `ROAS de ${meilleure.roas} % contre ${moyenne} % en moyenne sur ${nom(plateforme)}, avec ${Math.round(meilleure.conversions)} conversions déclarées.`,
      impact: meilleure.depenses / total.depense >= 0.2 ? 'eleve' : 'moyen',
      agent,
      cta: voirAvec(agent, locale, siteId),
    })
  }

  const recherche = ctx.donnees.recherche
  if (recherche !== null && recherche.clics28Avant !== null && ctx.ventes !== null && ctx.ventesAvant !== null) {
    const trafic = variation(recherche.clics28, recherche.clics28Avant)
    const commandes = variation(ctx.ventes.commandes, ctx.ventesAvant.commandes)
    if (trafic !== null && trafic >= 20 && commandes !== null && Math.abs(commandes) <= 5 && ctx.ventesAvant.commandes >= SEUILS.commandesMin) {
      trouvees.push({
        cle: 'cleo.conversion',
        titre: 'Plus de visiteurs, pas plus de ventes',
        pourquoi: `Le trafic Google a augmenté de ${pourcent(trafic)} sans que les commandes suivent. Cleo peut chercher ce qui retient les visiteurs d’acheter.`,
        impact: 'eleve',
        agent: 'cro',
        cta: voirAvec('cro', locale, siteId),
      })
    }
  }

  if (ctx.ventes !== null && ctx.ventes.commandes >= SEUILS.commandesMin) {
    const seo = ctx.ventes.canaux.seo
    if (seo !== undefined && seo.commandes / ctx.ventes.commandes >= 0.15) {
      trouvees.push({
        cle: 'seo.ventes',
        titre: 'Le référencement naturel vend',
        pourquoi: `${pourcent((seo.commandes / ctx.ventes.commandes) * 100)} des commandes arrivent depuis un moteur de recherche, sans coût par clic. Néo peut renforcer les pages qui les apportent.`,
        impact: 'moyen',
        agent: 'seo',
        cta: voirAvec('seo', locale, siteId),
      })
    }
  }

  const ia = ctx.ventes?.canaux.ia
  if (ia !== undefined && ia.commandes > 0) {
    trouvees.push({
      cle: 'ia.visibilite',
      titre: 'Les assistants IA vous envoient des clients',
      pourquoi: `${ia.commandes} commande${ia.commandes > 1 ? 's' : ''} depuis ${Object.keys(ia.origines).slice(0, 3).join(', ')}. Gia peut travailler ce que ces assistants comprennent de vous.`,
      impact: 'faible',
      agent: 'geo',
      cta: voirAvec('geo', locale, siteId),
    })
  }

  const enCroissance = ctx.produits
    .filter((produit) => produit.commandes >= 5 && produit.evolution !== null && produit.evolution >= 30)
    .sort((un, autre) => autre.chiffre - un.chiffre)[0]
  if (enCroissance !== undefined) {
    trouvees.push({
      cle: `produit.${enCroissance.id}`,
      titre: `« ${enCroissance.titre} » en croissance`,
      pourquoi: `Chiffre d’affaires en hausse de ${pourcent(enCroissance.evolution!)} sur ${enCroissance.commandes} commandes. Milo peut en parler davantage.`,
      impact: 'moyen',
      agent: 'content',
      cta: voirAvec('content', locale, siteId),
    })
  }

  const poids = { eleve: 0, moyen: 1, faible: 2 } as const
  return trouvees.sort((une, autre) => poids[une.impact] - poids[autre.impact]).slice(0, OPPORTUNITES_MAX)
}

// ── Pour Oria ────────────────────────────────────────────────────────────────

export type RapportOria = {
  periode: string
  sources: string[]
  observations: string[]
  recommandation: string | null
}

/**
 * Le résumé que Nova transmet à Oria : structuré, calculé, sans une phrase de modèle.
 *
 * Oria ne recalcule rien : elle lit ceci. Les observations sont les alertes puis les
 * constats, dans cet ordre ; la recommandation est la première opportunité, avec le
 * spécialiste qui peut s'en charger.
 */
export function rapportPourOria(
  libelle: string,
  sources: string[],
  alertes: Alerte[],
  insights: Insight[],
  opportunites: Opportunite[],
): RapportOria {
  const observations = [...alertes.filter((alerte) => alerte.niveau !== 'vert').map((alerte) => alerte.texte), ...insights.map((insight) => insight.texte)]
  const premiere = opportunites[0]
  return {
    periode: libelle,
    sources,
    observations: [...new Set(observations)].slice(0, 5),
    recommandation:
      premiere === undefined ? null : `${premiere.titre} — ${membre(premiere.agent)?.name ?? premiere.agent} peut s’en charger.`,
  }
}
