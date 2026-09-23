import { argent, NOM_NIVEAU, nombreLisible } from './recommandations'
import type { VueLina } from './service'

/**
 * Ce que Lina sait quand on lui parle : des totaux et des segments, jamais un client.
 *
 * C'est la règle qui compte le plus ici. Le modèle reçoit « 184 clients, panier moyen
 * CHF 78 », pas 184 fiches : il n'a besoin de rien d'autre pour conseiller, et ce qu'il ne
 * reçoit pas, il ne peut ni le répéter ni le perdre.
 */

function pourcent(part: number | null): string {
  return part === null ? 'inconnu' : `${nombreLisible(part * 100, 1)} %`
}

function quand(date: Date | null): string {
  return date === null ? 'jamais' : date.toISOString().slice(0, 10)
}

export function faitsLina(vue: VueLina): string[] {
  const { etat, devise } = vue
  const lignes: string[] = []
  if (vue.vierge || vue.indicateurs === null) {
    const raison =
      etat.etat === 'absent'
        ? 'Aucune boutique Shopify n’est reliée : il faut la relier dans Connexions.'
        : etat.etat === 'offre'
          ? 'La lecture de la boutique n’est pas incluse dans l’offre actuelle.'
          : etat.etat === 'en-cours'
            ? 'La lecture des clients est en cours chez Shopify.'
            : etat.message !== ''
              ? etat.message
              : 'La base clients n’a pas encore été analysée : bouton « Analyser mes clients » sur l’écran de Lina.'
    lignes.push('Données de Lina : aucune base clients lue.', `Pourquoi : ${raison}`)
    if (vue.activite === 'services' || vue.activite === 'saas') {
      lignes.push(
        `Activité déclarée : ${vue.activite === 'services' ? 'services' : 'logiciel par abonnement'}. Lina lit aujourd’hui une base clients Shopify ; pour cette activité, les prospects (HubSpot) et les abonnements (Stripe) sont suivis par Nova.`,
      )
    }
    return lignes
  }
  const i = vue.indicateurs
  lignes.push(
    `Sources : base clients Shopify (${nombreLisible(etat.clients)} fiches, lue le ${quand(etat.synchroAt)}${etat.tronque ? ', lecture partielle' : ''}), paniers abandonnés Shopify.`,
    `Consentement marketing : ${etat.consentement ? `lu — ${nombreLisible(i.contactables ?? 0)} clients acceptent les emails, ${nombreLisible(i.sansEmail ?? 0)} fiches sans email` : 'non lu, à vérifier dans Shopify avant tout envoi'}.`,
    `Réglages : actif ≤ ${vue.criteres.actifJours} j, dormant > ${vue.criteres.dormantJours} j, nouveau ≤ ${vue.criteres.nouveauJours} j, fidèle ≥ ${vue.criteres.fideleCommandes} commandes, VIP = ${Math.round(vue.criteres.vipPart * 100)} % qui dépensent le plus.`,
    `Acheteurs : ${nombreLisible(i.acheteurs)} ; actifs ${nombreLisible(i.actifs)} ; nouveaux ${nombreLisible(i.nouveaux)} ; récurrents ${nombreLisible(i.recurrents)} ; taux de réachat ${pourcent(i.tauxReachat)} ; panier moyen ${i.panierMoyenCents === null ? 'inconnu' : argent(i.panierMoyenCents, devise)}.`,
    `Chiffre d’affaires cumulé des clients : ${argent(i.caTotalCents, devise)} ; dont clients récurrents ${argent(i.caRecurrentsCents, devise)} (${pourcent(i.partCaRecurrents)}).`,
    'Segments (un client peut être dans plusieurs) :',
    ...vue.segments
      .filter((segment) => segment.nombre > 0)
      .map(
        (segment) =>
          `- ${segment.nom} (${segment.critere}) : ${nombreLisible(segment.nombre)} clients, CA ${argent(segment.caCents, devise)}${segment.partCa === null ? '' : ` (${pourcent(segment.partCa)})`}, panier moyen ${segment.panierMoyenCents === null ? 'inconnu' : argent(segment.panierMoyenCents, devise)}${segment.joursMedian === null ? '' : `, dernier achat il y a ${segment.joursMedian} j (médiane)`}${segment.contactables === null ? '' : `, ${nombreLisible(segment.contactables)} joignables par email`}${segment.tropPetit ? ', segment trop petit pour une règle' : ''}.`,
      ),
  )
  if (vue.rfm !== null) {
    lignes.push(`RFM (indicateur interne) : ${vue.rfm.map((ligne) => `${ligne.nom} ${nombreLisible(ligne.nombre)}`).join(', ')}.`)
  }
  const paniers = vue.paniers
  if (paniers !== null && paniers.erreur === undefined) {
    lignes.push(
      `Paniers abandonnés, ${paniers.jours} derniers jours : ${nombreLisible(paniers.courant.nombre)} (${argent(paniers.courant.valeurCents, devise)}), ${nombreLisible(paniers.courant.recuperes)} finalement payés ; ${paniers.jours} jours précédents : ${nombreLisible(paniers.precedent.nombre)}.`,
    )
  } else {
    lignes.push(`Paniers abandonnés : non lus${paniers?.erreur === undefined ? '' : ` (${paniers.erreur})`}.`)
  }
  if (vue.nova !== null) {
    lignes.push(
      `Selon Nova, 30 derniers jours : chiffre d’affaires ${vue.nova.chiffre30 === null ? 'inconnu' : `${vue.nova.devise} ${nombreLisible(vue.nova.chiffre30)}`}, coût d’acquisition d’un nouveau client ${vue.nova.cac === null ? 'inconnu' : `${vue.nova.devise} ${nombreLisible(vue.nova.cac, 2)}`}.`,
    )
  }
  if (vue.campagnes.length > 0) {
    lignes.push(
      'Campagnes recommandées, dans l’ordre (potentiel = hypothèse de calcul, pas une prévision) :',
      ...vue.campagnes.map(
        (campagne) =>
          `- ${campagne.titre} : ${nombreLisible(campagne.audience)} ${campagne.audienceLibelle} ; impact ${NOM_NIVEAU[campagne.impact].toLowerCase()}, effort ${NOM_NIVEAU[campagne.effort].toLowerCase()} ; ${campagne.hypothese} Potentiel ${argent(campagne.potentielCents, devise)}.`,
      ),
    )
  }
  if (vue.insights.length > 0) lignes.push('Ce que Lina a détecté :', ...vue.insights.map((insight) => `- ${insight.texte}`))
  const aVerifier = vue.sante.filter((ligne) => ligne.etat !== 'bon')
  if (aVerifier.length > 0) lignes.push('Santé de la base :', ...aVerifier.map((ligne) => `- ${ligne.texte}`))
  return lignes
}

/** Ce qu'Oria reçoit de Lina : les opportunités, une par ligne, déjà chiffrées. */
export function transmissionOria(vue: VueLina): string[] {
  if (vue.vierge || vue.pourOria.length === 0) return []
  return ['Opportunités CRM relevées par Lina (clients déjà acquis) :', ...vue.pourOria.map((ligne) => `- ${ligne}`)]
}
