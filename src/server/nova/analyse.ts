import { ecranDuMembre, membre, type IdMembre } from '@/lib/equipe'
import { NOM_CANAL } from '@/lib/nova'
import { variation } from '@/server/ads/metriques'
import { contenuQualifie, contenusQuiAttirent } from './contenus'
import type { IndicateursAbonnements } from './abonnements'
import { lireAudiences, paysQuiNAchetePas } from './audiences'
import { canalQuiNeSignePas, type LectureCrm } from './crm'
import {
  cumulPub,
  enPourcent,
  type Attribution,
  type CumulPub,
  type CumulVentes,
  type CumulVisites,
  tauxConversion,
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
  /** Les visites GA4, quand GA4 est relié et couvre la période. */
  visites?: CumulVisites | null
  visitesAvant?: CumulVisites | null
  attribution: Attribution
  campagnes: LigneCampagne[]
  produits: LigneProduit[]
  /** Le MER sous lequel la publicité coûte plus qu'elle ne laisse (voir pilotage.ts), s'il se calcule. */
  merEquilibre?: number | null
  /** Les abonnements Stripe, quand ils ont été lus. */
  abonnements?: IndicateursAbonnements | null
  /** Le CRM, quand il a été lu : taux de transformation par cohorte et par canal. */
  crm?: LectureCrm | null
}

const AGENT_DE: Record<PlateformePayante, IdMembre> = { 'google-ads': 'ads', 'meta-ads': 'meta' }

/** Les volumes en dessous desquels une variation n'est pas une tendance. */
export const SEUILS = {
  conversionsMin: 10,
  commandesMin: 20,
  depenseMin: 50,
  partProduit: 0.2,
  nonAttribue: 0.3,
  sessionsAppareil: 200,
  /** Un churn mensuel au-delà : un abonné sur vingt part chaque mois. */
  churnEleve: 0.05,
  /** Un produit qui pèse au moins cette part du CA, et laisse moins que cette marge brute. */
  partMarge: 0.1,
  margeFaible: 0.35,
  sessionsTendance: 500,
} as const

/** Le taux de conversion d'un appareil, en pour cent, s'il y a assez de visites pour qu'il dise quelque chose. */
function tauxAppareil(visites: CumulVisites, appareil: string): number | null {
  const ligne = visites.appareils[appareil]
  if (ligne === undefined || ligne.sessions < SEUILS.sessionsAppareil) return null
  return (ligne.achats / ligne.sessions) * 100
}

/** Le nom de la source de ventes, pour dire d'où vient un chiffre. */
function vend(ctx: Contexte): string {
  return ctx.donnees.nomVentes ?? 'Shopify'
}

function fmt(valeur: number): string {
  return new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 1 }).format(valeur)
}

/** Mobile nettement en dessous de l'ordinateur : l'écart que Cleo peut réduire. */
function ecartMobile(visites: CumulVisites | null | undefined): { mobile: number; ordinateur: number; part: number } | null {
  if (visites == null || visites.achats < 10) return null
  const mobile = tauxAppareil(visites, 'mobile')
  const ordinateur = tauxAppareil(visites, 'desktop')
  if (mobile === null || ordinateur === null || ordinateur === 0 || mobile > ordinateur * 0.7) return null
  return { mobile, ordinateur, part: (visites.appareils.mobile?.sessions ?? 0) / visites.sessions }
}

/** Le trafic de recherche monte, les commandes non : sessions GA4 d'abord, clics Search Console à défaut. */
function traficSansVentes(ctx: Contexte): { hausse: number; source: string } | null {
  if (ctx.ventes === null || ctx.ventesAvant === null || ctx.ventesAvant.commandes < SEUILS.commandesMin) return null
  const commandes = variation(ctx.ventes.commandes, ctx.ventesAvant.commandes)
  if (commandes === null || Math.abs(commandes) > 5) return null
  if (ctx.visites != null && ctx.visitesAvant != null && ctx.visitesAvant.sessions >= SEUILS.sessionsTendance) {
    const hausse = variation(ctx.visites.sessions, ctx.visitesAvant.sessions)
    return hausse !== null && hausse >= 20 ? { hausse, source: `Visites GA4 comparées à la période précédente ; commandes ${vend(ctx)}.` } : null
  }
  const recherche = ctx.donnees.recherche
  if (recherche === null || recherche.clics28Avant === null) return null
  const hausse = variation(recherche.clics28, recherche.clics28Avant)
  return hausse !== null && hausse >= 20
    ? { hausse, source: `Clics Search Console sur 28 jours, comparés aux 28 jours d’avant ; commandes ${vend(ctx)} sur la période.` }
    : null
}

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
      fondement: `Revenu déclaré par chaque régie, comparé au chiffre d’affaires ${vend(ctx)} de la même période.`,
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
        fondement: `${argent(ctx.ventesAvant.chiffre, devise)} avant, ${argent(ctx.ventes.chiffre, devise)} maintenant (${vend(ctx)}).`,
        ton: ecart > 0 ? 'positif' : 'attention',
      })
    }
  }

  // Les abonnements : le MRR et sa tendance, puis ce qui part.
  const abos = ctx.abonnements
  if (abos != null && abos.actifs > 0) {
    const argentAbos = (valeur: number) => argent(valeur, devise)
    trouves.push({
      cle: 'abonnements.mrr',
      texte: `Votre revenu mensuel récurrent est de ${argentAbos(abos.mrr)}${abos.croissance === null ? '' : `, ${abos.croissance >= 0 ? 'en hausse' : 'en baisse'} de ${pourcent(Math.abs(abos.croissance))} sur trois mois`}.`,
      fondement: `${abos.actifs} abonné${abos.actifs > 1 ? 's' : ''} payant${abos.actifs > 1 ? 's' : ''}, au prix actuel de leur formule, remises non déduites (Stripe).`,
      ton: abos.croissance === null || abos.croissance >= 0 ? 'positif' : 'attention',
    })
    if (abos.churn !== null && abos.churn >= SEUILS.churnEleve) {
      trouves.push({
        cle: 'abonnements.churn',
        texte: `Vous perdez ${fmt(abos.churn * 100)} % de vos abonnés chaque mois.`,
        fondement: `Départs ÷ abonnés en début de mois, moyenne des trois derniers mois terminés (Stripe).${abos.ltv === null ? '' : ` À ce rythme, un abonné rapporte en moyenne ${argentAbos(abos.ltv)} sur sa durée (estimation).`}`,
        ton: 'attention',
      })
    }
  }

  // Le CRM : ce que deviennent les prospects.
  const crm = ctx.crm
  if (crm != null) {
    if (crm.global !== null && crm.global.taux !== null) {
      trouves.push({
        cle: 'crm.taux',
        texte: `${pourcent(crm.global.taux * 100)} de vos prospects deviennent clients.`,
        fondement: `${crm.global.clients} clients sur ${crm.global.prospects} prospects créés dans HubSpot, cohortes d’au moins un mois${crm.delaiMoyenJours === null ? '' : ` ; une transaction gagnée se signe en ${fmt(crm.delaiMoyenJours)} jours en moyenne`}.`,
        ton: 'neutre',
      })
    }
    const faible = canalQuiNeSignePas(crm)
    if (faible !== null) {
      trouves.push({
        cle: `crm.canal.${faible.cle}`,
        texte:
          faible.clients === 0
            ? `${faible.nom} a amené ${faible.prospects} prospects, et aucun n’est devenu client.`
            : `Les prospects venus de ${faible.nom} deviennent clients deux fois moins souvent que les autres (${pourcent(faible.taux! * 100)}).`,
        fondement: 'Source d’origine des contacts selon HubSpot, sur les six derniers mois. Des prospects récents peuvent encore signer.',
        ton: 'attention',
      })
    }
  }

  // Le trafic monte, les ventes non : la question est pour Cleo.
  const sansVentes = traficSansVentes(ctx)
  if (sansVentes !== null) {
    trouves.push({
      cle: 'trafic-sans-ventes',
      texte: `Le trafic a augmenté de ${pourcent(sansVentes.hausse)}, mais les ventes restent stables.`,
      fondement: sansVentes.source,
      ton: 'attention',
    })
  }

  const mobile = ecartMobile(ctx.visites)
  if (mobile !== null) {
    trouves.push({
      cle: 'conversion.mobile',
      texte: `Votre taux de conversion mobile (${fmt(mobile.mobile)} %) est inférieur à celui sur ordinateur (${fmt(mobile.ordinateur)} %).`,
      fondement: `Achats ÷ visites par appareil, selon GA4. Le mobile fait ${Math.round(mobile.part * 100)} % des visites.`,
      ton: 'attention',
    })
  }

  const premier = ctx.produits[0]
  if (premier !== undefined && premier.part >= SEUILS.partProduit && ctx.produits.length > 1) {
    trouves.push({
      cle: `produit.${premier.id}`,
      texte: `« ${premier.titre} » représente ${pourcent(premier.part * 100)} de votre chiffre d’affaires.`,
      fondement: `${argent(premier.chiffre, devise)} sur ${premier.commandes} commande${premier.commandes > 1 ? 's' : ''} (${vend(ctx)}).`,
      ton: 'neutre',
    })
  }

  // Un produit qui pèse dans le CA mais laisse peu : il fait du chiffre, pas forcément de l'argent.
  const faible = ctx.produits
    .filter((produit) => produit.part >= SEUILS.partMarge && produit.tauxMarge !== null && produit.commandes >= 5)
    .sort((un, autre) => un.tauxMarge! - autre.tauxMarge!)[0]
  if (faible !== undefined && faible.tauxMarge! < SEUILS.margeFaible) {
    trouves.push({
      cle: `marge.${faible.id}`,
      texte: `« ${faible.titre} » pèse ${pourcent(faible.part * 100)} de votre chiffre d’affaires mais ne laisse que ${pourcent(faible.tauxMarge! * 100)} de marge brute.`,
      fondement: `${argent(faible.chiffre, devise)} de ventes, ${argent(faible.marge!, devise)} de marge brute après coût d’achat (Shopify, coût actuel), hors livraison, frais et publicité. Estimation basée sur les coûts renseignés.`,
      ton: 'attention',
    })
  }

  // Les audiences : un pays qui visite sans acheter, et ce que rapportent ceux qui reviennent.
  const audiences = lireAudiences(ctx.visites)
  if (audiences !== null) {
    const faiblePays = paysQuiNAchetePas(audiences)
    if (faiblePays !== null) {
      trouves.push({
        cle: `audience.pays.${faiblePays.pays.cle}`,
        texte: `${faiblePays.pays.nom} apporte ${pourcent(faiblePays.pays.part * 100)} de vos visites mais convertit à ${fmt(faiblePays.pays.conversion! * 100)} %, contre ${fmt(faiblePays.reference.conversion! * 100)} % pour ${faiblePays.reference.nom}.`,
        fondement: 'Achats ÷ visites par pays, selon GA4. Une publicité qui cible trop large, une livraison ou une langue qui ne suivent pas en sont des causes fréquentes — à vérifier, pas à supposer.',
        ton: 'attention',
      })
    }
    const { nouveaux, connus } = audiences
    if (nouveaux.conversion !== null && connus.conversion !== null && nouveaux.conversion > 0 && connus.conversion >= nouveaux.conversion * 2) {
      trouves.push({
        cle: 'audience.fideles',
        texte: `Les visiteurs qui reviennent achètent ${fmt(connus.conversion / nouveaux.conversion)} fois plus que les nouveaux (${fmt(connus.conversion * 100)} % contre ${fmt(nouveaux.conversion * 100)} %).`,
        fondement: `Achats ÷ visites, nouveaux et connus, selon GA4. Ils font ${pourcent(connus.part * 100)} des visites.`,
        ton: 'neutre',
      })
    }
  }

  const iaVisites = ctx.visites?.canaux.ia
  if (iaVisites !== undefined && iaVisites.sessions > 0 && (ctx.ventes?.canaux.ia?.commandes ?? 0) === 0) {
    trouves.push({
      cle: 'ia.visites',
      texte: `${iaVisites.sessions} visite${iaVisites.sessions > 1 ? 's sont venues' : ' est venue'} d’assistants IA (${Object.keys(iaVisites.origines).map((o) => o.split(' / ')[0]).slice(0, 3).join(', ')}).`,
      fondement: 'Sessions GA4 dont la source est un assistant reconnu.',
      ton: 'neutre',
    })
  }
  const ia = ctx.ventes?.canaux.ia
  if (ia !== undefined && ia.commandes > 0) {
    const assistants = Object.keys(ia.origines).slice(0, 3).join(', ')
    trouves.push({
      cle: 'ia.ventes',
      texte: `${ia.commandes} commande${ia.commandes > 1 ? 's sont arrivées' : ' est arrivée'} depuis un assistant IA (${assistants}).`,
      fondement: `Dernière visite enregistrée par ${vend(ctx)} avant l’achat, venant d’un assistant reconnu.`,
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
        fondement: `Commandes ${vend(ctx)} sans dernière visite enregistrée.`,
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

  /*
   * La publicité sous le seuil de rentabilité : le MER (CA total ÷ dépense) ne couvre pas les
   * coûts. Transmis à la régie qui dépense le plus, parce que c'est là que se joue l'ajustement.
   */
  if (ctx.merEquilibre != null && ctx.ventes !== null && ctx.donnees.regies.length > 0) {
    const cumuls = ctx.donnees.regies.map((plateforme) => ({ plateforme, cumul: pub(ctx, plateforme, ctx.bornes) }))
    const depense = cumuls.reduce((total, un) => total + un.cumul.depense, 0)
    if (depense >= SEUILS.depenseMin && ctx.ventes.commandes >= 5) {
      const mer = Math.round((ctx.ventes.chiffre / depense) * 100)
      if (mer < ctx.merEquilibre) {
        const principale = cumuls.sort((un, autre) => autre.cumul.depense - un.cumul.depense)[0]!.plateforme
        alertes.push({
          cle: 'marge.seuil',
          niveau: mer < ctx.merEquilibre * 0.8 ? 'rouge' : 'orange',
          texte: `Votre MER (${mer} %) est sous votre seuil de rentabilité publicitaire (${ctx.merEquilibre} %) : la publicité coûte plus qu’elle ne laisse.`,
          fondement: `${argent(ctx.ventes.chiffre, devise)} de ventes ${vend(ctx)} pour ${argent(depense, devise)} de publicité. Seuil calculé avec vos coûts (produits, livraison, frais) — estimation basée sur les coûts renseignés. Des clients qui reviennent acheter peuvent le justifier.`,
          agent: AGENT_DE[principale],
        })
      }
    }
  }

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
        fondement: `${ctx.ventesAvant.commandes} commandes avant, ${ctx.ventes.commandes} maintenant (${vend(ctx)}).`,
        agent: 'cro',
      })
    }
  }

  // Le taux de conversion qui décroche, à trafic comparable : GA4 seul peut le voir.
  if (ctx.visites != null && ctx.visitesAvant != null && ctx.visitesAvant.sessions >= SEUILS.sessionsTendance && ctx.visites.sessions >= SEUILS.sessionsTendance) {
    const avant = tauxConversion(ctx.ventesAvant, ctx.visitesAvant)
    const maintenant = tauxConversion(ctx.ventes, ctx.visites)
    const ecart = variation(maintenant, avant)
    if (ecart !== null && ecart <= -25 && (ctx.ventesAvant?.commandes ?? ctx.visitesAvant.achats) >= 10) {
      alertes.push({
        cle: 'conversion.baisse',
        niveau: 'orange',
        texte: 'Votre taux de conversion a baissé de manière inhabituelle.',
        fondement: `${fmt(avant!)} % la période précédente, ${fmt(maintenant!)} % sur celle-ci (commandes ÷ visites GA4).`,
        agent: 'cro',
      })
    }
  }

  // Le dernier jour de la période, comparé à ses quatre semaines.
  alertes.push(...detecterEcarts(ctx))

  const rang = { rouge: 0, orange: 1, vert: 2 } as const
  return alertes.sort((une, autre) => rang[une.niveau] - rang[autre.niveau]).slice(0, ALERTES_MAX)
}

// ── Écarts inhabituels ───────────────────────────────────────────────────────

/** Le nombre d'écarts-types au-delà duquel une journée est dite inhabituelle. */
export const Z_SEUIL = 2.5
/** Les jours de référence : quatre semaines, pour que chaque jour de la semaine y figure. */
export const JOURS_REFERENCE = 28

export type Ecart = { valeur: number; moyenne: number; ecartType: number; z: number }

/**
 * Une journée comparée aux vingt-huit précédentes : moyenne et écart-type.
 *
 * Rien de plus savant, et c'est voulu : une règle qu'on peut refaire à la main se discute,
 * un modèle ne se discute pas. Les jours sans valeur comptent pour zéro — une série de ventes
 * n'a pas de trou, elle a des jours sans vente. `null` quand il manque des jours de référence
 * ou que la série ne varie jamais.
 */
export function ecartDuJour(serie: ReadonlyMap<string, number>, jour: string, veille: (jour: string, n: number) => string): Ecart | null {
  const valeurs: number[] = []
  for (let n = 1; n <= JOURS_REFERENCE; n += 1) valeurs.push(serie.get(veille(jour, n)) ?? 0)
  const moyenne = valeurs.reduce((a, b) => a + b, 0) / valeurs.length
  const variance = valeurs.reduce((total, valeur) => total + (valeur - moyenne) ** 2, 0) / valeurs.length
  const ecartType = Math.sqrt(variance)
  if (ecartType === 0) return null
  const valeur = serie.get(jour) ?? 0
  return { valeur, moyenne, ecartType, z: (valeur - moyenne) / ecartType }
}

function jourAvant(jour: string, n: number): string {
  return new Date(Date.parse(jour) - n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Les journées inhabituelles, pour le dernier jour de la période.
 *
 * Trois séries seulement : commandes et chiffre d'affaires de la boutique, visites de GA4.
 * Les dépenses publicitaires ont déjà leurs anomalies chez Oria (arrêt, envolée du coût par
 * clic) ; les répéter ici ferait deux alertes pour une panne. Un volume minimal écarte les
 * boutiques où un seul jour sans vente passerait pour un effondrement.
 */
export function detecterEcarts(ctx: Contexte): Alerte[] {
  // « Aujourd'hui » est une journée en cours : la comparer à des journées pleines la dirait toujours basse.
  if (ctx.jours === 1) return []
  const jour = ctx.bornes.au
  const alertes: Alerte[] = []
  const couvert = (depuis: string | null) => depuis !== null && jourAvant(jour, JOURS_REFERENCE) >= depuis

  const series: { cle: string; quoi: string; serie: Map<string, number>; minimum: number; format: (v: number) => string; agent: IdMembre }[] = []
  if (ctx.donnees.ventes.disponibles && couvert(ctx.donnees.ventes.couvertureDepuis)) {
    series.push({
      cle: 'commandes',
      quoi: 'le nombre de commandes',
      serie: new Map(ctx.donnees.ventes.jours.map((un) => [un.jour, un.commandes])),
      minimum: 3,
      format: (v) => fmt(v),
      agent: 'cro',
    })
    series.push({
      cle: 'chiffre',
      quoi: 'le chiffre d’affaires',
      serie: new Map(ctx.donnees.ventes.jours.map((un) => [un.jour, un.chiffre])),
      minimum: 100,
      format: (v) => argent(v, ctx.donnees.devise),
      agent: 'cro',
    })
  }
  const visites = ctx.donnees.visites
  if (visites !== undefined && visites.disponibles && couvert(visites.couvertureDepuis)) {
    series.push({
      cle: 'visites',
      quoi: 'le nombre de visites',
      serie: new Map(visites.jours.map((un) => [un.jour, un.sessions])),
      minimum: 30,
      format: (v) => fmt(v),
      agent: 'audit',
    })
  }

  for (const { cle, quoi, serie, minimum, format, agent } of series) {
    const ecart = ecartDuJour(serie, jour, jourAvant)
    if (ecart === null || ecart.moyenne < minimum || Math.abs(ecart.z) < Z_SEUIL) continue
    const bas = ecart.z < 0
    alertes.push({
      cle: `ecart.${cle}`,
      niveau: bas ? 'orange' : 'vert',
      texte: `Le ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(jour))}, ${quoi} a été inhabituellement ${bas ? 'bas' : 'élevé'}.`,
      fondement: `${format(ecart.valeur)} ce jour-là, pour ${format(ecart.moyenne)} en moyenne sur les ${JOURS_REFERENCE} jours précédents (écart de ${fmt(Math.abs(ecart.z))} fois la variation habituelle).`,
      // Des visites qui s'effondrent d'un coup : souvent une panne ou un suivi cassé, ce que Léa vérifie.
      agent,
    })
  }
  return alertes
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

  const sansVentes = traficSansVentes(ctx)
  if (sansVentes !== null) {
    trouvees.push({
      cle: 'cleo.conversion',
      titre: 'Plus de visiteurs, pas plus de ventes',
      pourquoi: `Le trafic a augmenté de ${pourcent(sansVentes.hausse)} sans que les commandes suivent. Cleo peut chercher ce qui retient les visiteurs d’acheter.`,
      impact: 'eleve',
      agent: 'cro',
      cta: voirAvec('cro', locale, siteId),
    })
  }

  const mobile = ecartMobile(ctx.visites)
  if (mobile !== null) {
    trouvees.push({
      cle: 'cleo.mobile',
      titre: 'L’expérience mobile coûte des ventes',
      pourquoi: `Sur mobile, ${fmt(mobile.mobile)} % des visites achètent, contre ${fmt(mobile.ordinateur)} % sur ordinateur — et le mobile fait ${Math.round(mobile.part * 100)} % du trafic. Cleo peut regarder les pages sur téléphone.`,
      impact: mobile.part >= 0.5 ? 'eleve' : 'moyen',
      agent: 'cro',
      cta: voirAvec('cro', locale, siteId),
    })
  }

  // La page de recherche naturelle qui vend le plus : ce que Néo doit protéger en premier.
  const pagesSeo = ctx.visites?.pagesSeo ?? []
  const revenuSeo = pagesSeo.reduce((total, page) => total + page.revenu, 0)
  // Un article qui retient nettement mieux que le site : Milo peut écrire dans la même veine.
  const contenus = contenusQuiAttirent(ctx.visites ?? null)
  const article = contenuQualifie(contenus)
  if (article !== null) {
    const site = contenus.engagementSite!
    trouvees.push({
      cle: `contenu.${article.page}`,
      titre: `L’article ${article.page} attire un trafic qualifié`,
      pourquoi: `${article.sessions} visites y sont entrées, ${pourcent(article.engagement! * 100)} engagées contre ${pourcent(site * 100)} en moyenne sur le site${article.achats > 0 ? `, et ${article.achats} achat${article.achats > 1 ? 's' : ''} ont suivi` : ''} (GA4). Milo peut produire d’autres contenus dans la même veine.`,
      impact: 'moyen',
      agent: 'content',
      cta: voirAvec('content', locale, siteId),
    })
  }

  const pageSeo = pagesSeo[0]
  if (pageSeo !== undefined && revenuSeo > 0 && pageSeo.achats >= 3 && pageSeo.revenu / revenuSeo >= 0.15) {
    trouvees.push({
      cle: `seo.page.${pageSeo.page}`,
      titre: `La page ${pageSeo.page} vend depuis Google`,
      pourquoi: `Elle apporte ${pourcent((pageSeo.revenu / revenuSeo) * 100)} du CA venu de la recherche naturelle (${pageSeo.achats} achats, selon GA4). Néo peut la renforcer en priorité.`,
      impact: 'moyen',
      agent: 'seo',
      cta: voirAvec('seo', locale, siteId),
    })
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
