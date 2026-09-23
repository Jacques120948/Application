import type { LectureCrm } from '@/server/nova/crm'
import { ACTIFS_MIN_CHURN, type IndicateursAbonnements } from '@/server/nova/abonnements'
import type { Activite } from '@/server/nova/reglages'
import { nombreLisible } from './recommandations'

/**
 * Lina pour une activité de services ou un SaaS : la fidélisation ne passe pas par des
 * paniers et des deuxièmes commandes, mais par des prospects qui signent et des abonnés qui
 * restent.
 *
 * Tout vient de Nova, déjà calculé : le CRM (HubSpot) et les abonnements (Stripe). Lina n'y
 * relit rien et ne voit aucune personne — des totaux, que Nova a déjà.
 */

export type AbonnementsPourLina = { indicateurs: IndicateursAbonnements; devise: string }

export type PisteService = {
  cle: string
  titre: string
  constat: string
  action: string
  /** Sur quoi la piste repose. */
  mesure: string
}

/** Churn mensuel à partir duquel prévenir les départs devient la priorité. */
export const CHURN_ALERTE = 0.03
const PROSPECTS_MIN = 20

const pourcent = (part: number) => `${nombreLisible(part * 100, part < 0.1 ? 1 : 0)} %`
const montant = (valeur: number, devise: string) => `${devise} ${nombreLisible(valeur, Math.abs(valeur) < 100 ? 2 : 0)}`.trim()

export function pistesServices(activite: Activite | '', crm: LectureCrm | null, abonnements: AbonnementsPourLina | null): PisteService[] {
  const pistes: PisteService[] = []
  const global = crm?.global ?? null
  if (global !== null && global.prospects >= PROSPECTS_MIN && global.prospects > global.clients) {
    const nonSignes = global.prospects - global.clients
    const delai = crm?.delaiMoyenJours ?? null
    pistes.push({
      cle: 'prospects-non-signes',
      titre: 'Relancer les prospects qui n’ont pas signé',
      constat: `${nombreLisible(nonSignes)} prospects des mois terminés n’ont pas signé${global.taux === null ? '' : ` (taux de transformation ${pourcent(global.taux)})`}.`,
      action: `Une séquence de relance dans le CRM : un contenu utile (cas client, réponse aux objections fréquentes), puis une proposition d’échange${delai === null ? '' : `, autour de ${nombreLisible(delai)} jours après le premier contact — le délai moyen de signature observé`}. Sans remise par défaut, et seulement auprès des contacts qui ont accepté d’être recontactés.`,
      mesure: 'Cohortes de prospects lues par Nova dans le CRM, mois terminés seulement.',
    })
  }
  if (global !== null && global.clients >= 5 && activite === 'services') {
    pistes.push({
      cle: 'recommandation',
      titre: 'Demander avis et recommandations aux clients signés',
      constat: `${nombreLisible(global.clients)} prospects sont devenus clients sur les mois terminés.`,
      action: 'Un message après la première prestation réussie : un avis, puis une recommandation. Le moment compte plus que l’offre.',
      mesure: 'Clients signés lus par Nova dans le CRM.',
    })
  }
  const abos = abonnements?.indicateurs ?? null
  if (abonnements !== null && abos !== null && abos.actifs >= ACTIFS_MIN_CHURN && abos.churn !== null) {
    const departsParMois = Math.round(abos.actifs * abos.churn)
    const eleve = abos.churn >= CHURN_ALERTE
    pistes.push({
      cle: 'churn-abonnes',
      titre: eleve ? 'Prévenir les départs d’abonnés' : 'Garder les abonnés engagés',
      constat: `Churn mensuel moyen ${pourcent(abos.churn)} sur trois mois, soit environ ${nombreLisible(departsParMois)} départs par mois pour ${nombreLisible(abos.actifs)} abonnés actifs.${abos.mrrPerduMois > 0 ? ` ${montant(abos.mrrPerduMois, abonnements.devise)} de revenu mensuel perdu depuis le début du mois.` : ''}`,
      action: eleve
        ? 'Un accompagnement des trente premiers jours (la plupart des départs se jouent là), un contact avant chaque renouvellement annuel, et une question simple aux partants sur la raison de leur départ.'
        : 'Un point régulier sur ce que les abonnés utilisent, et une proposition d’offre supérieure aux plus actifs.',
      mesure: `Abonnements lus par Nova dans Stripe.${abos.ltv === null ? '' : ` Valeur estimée d’un abonné : ${montant(abos.ltv, abonnements.devise)} (revenu moyen ÷ churn).`}`,
    })
  }
  return pistes
}
