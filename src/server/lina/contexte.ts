import { argent, NOM_NIVEAU, nombreLisible } from './recommandations'
import type { VueLina } from './service'
import type { ResultatVu, VerdictAB } from './resultats'

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

/** V3 : services et SaaS, objectifs — ce qui se dit même sans boutique lue. */
function faitsCommuns(vue: VueLina): string[] {
  const lignes: string[] = []
  if (vue.pistesServices.length > 0) {
    lignes.push('Pistes pour une activité de services ou un SaaS (depuis Nova, totaux seulement) :', ...vue.pistesServices.map((piste) => `- ${piste.titre} : ${piste.constat} ${piste.mesure}`))
  }
  if (vue.progression.length > 0) {
    lignes.push(
      'Objectifs CRM fixés par la personne :',
      ...vue.progression.map((un) => `- ${un.libelle} : cible ${un.cible}, actuel ${un.actuel ?? 'non mesuré'}${un.atteint ? ' (atteint)' : ''}.`),
    )
  }
  return lignes
}

export function faitsLina(vue: VueLina, resultats: readonly ResultatVu[] = [], tests: readonly VerdictAB[] = []): string[] {
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
    return [...lignes, ...faitsCommuns(vue)]
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
  // V2 : ce que les commandes ont appris.
  if (vue.analyse === null) {
    lignes.push(
      vue.etat.commandesEnCours
        ? 'Commandes : lecture en cours chez Shopify (produits, réachat, cohortes à venir).'
        : `Commandes : pas encore lues${vue.etat.commandesMessage === '' ? '' : ` (${vue.etat.commandesMessage})`}. Réachat par produit, produits complémentaires et cohortes indisponibles.`,
    )
  } else {
    const a = vue.analyse
    lignes.push(`Commandes lues depuis le ${a.depuis} : ${nombreLisible(a.commandes)}${a.tronque ? ' (lecture partielle)' : ''}.`)
    if (a.reachat.medianeJours !== null) {
      lignes.push(
        `Délai entre la première et la deuxième commande : médiane ${a.reachat.medianeJours} j (la moitié des cas entre ${a.reachat.p25Jours} et ${a.reachat.p75Jours} j). Part des clients qui recommandent : ${a.reachat.sous.map((un) => `${pourcent(un.part)} sous ${un.jours} j`).join(', ')} (sur ${nombreLisible(a.reachat.base)} clients arrivés il y a plus de 6 mois).`,
      )
    }
    if (vue.reachat.length > 0) lignes.push('Produits qui se rachètent (observé) :', ...vue.reachat.slice(0, 5).map((un) => `- ${un.texte}`))
    if (vue.croisees.length > 0) lignes.push('Produits achetés ensuite (observé) :', ...vue.croisees.slice(0, 5).map((un) => `- ${un.texte}`))
    if (vue.montees.length > 0) lignes.push('Montées en gamme observées :', ...vue.montees.slice(0, 3).map((un) => `- ${un.texte}`))
    const cohortes = a.cohortes.slice(-4)
    if (cohortes.length > 0) {
      lignes.push(
        'Cohortes (mois de première commande) :',
        ...cohortes.map((cohorte) => `- ${cohorte.mois} : ${nombreLisible(cohorte.clients)} clients, ${pourcent(cohorte.revenus.at(-1) ?? 0)} ont recommandé depuis, CA cumulé par client ${argent(cohorte.chiffreParClientCents.at(-1) ?? 0, devise)}.`),
      )
    }
  }
  if (vue.valeur !== null) {
    const v = vue.valeur
    lignes.push(
      `Valeur client observée (dépense moyenne d’un acheteur jusqu’ici) : ${v.observeeCents === null ? 'inconnue' : argent(v.observeeCents, devise)}.`,
      v.estimeeCents === null
        ? `Valeur client estimée : pas assez d’historique (${nombreLisible(v.base)} clients arrivés il y a plus d’un an, il en faut 50).`
        : `Valeur client estimée : ${argent(v.estimeeCents, devise)} (${v.commandesParAn} commandes par an, durée de vie ${v.dureeVieAns} ans, attrition annuelle ${pourcent(v.attritionAnnuelle)}). ${v.methode}`,
    )
  }
  const risques = vue.risques.filter((risque) => risque.clients > 0)
  if (risques.length > 0) lignes.push(`Risque de départ estimé : ${risques.map((risque) => `${risque.niveau === 'eleve' ? 'élevé' : 'moyen'} ${nombreLisible(risque.clients)} clients (${argent(risque.caCents, devise)} de CA historique)`).join(' ; ')}.`)
  if (resultats.length > 0) {
    lignes.push(
      'Résultats de campagnes saisis :',
      ...resultats.slice(0, 8).map((r) => `- ${r.nom}${r.variante === '' ? '' : ` (variante ${r.variante})`} : ${nombreLisible(r.envoyes)} envois, ${r.source === 'manuel' ? 'saisi' : `relu dans ${r.source}`}, ouverture ${pourcent(r.tauxOuverture)}, clic ${pourcent(r.tauxClic)}, conversion ${r.tauxConversion === null ? 'non mesurée' : pourcent(r.tauxConversion)}, CA ${r.caCents === null ? 'non mesuré' : argent(r.caCents, devise)}, revenu par destinataire ${r.revenuParDestinataireCents === null ? 'non mesuré' : argent(r.revenuParDestinataireCents, devise)}${r.tauxDesinscription === null ? '' : `, désinscriptions ${pourcent(r.tauxDesinscription)}`}.`),
    )
  }
  // V3 : le bilan de la semaine, les alertes, le score.
  if (vue.bilan !== null) {
    lignes.push(
      `Bilan de la semaine du ${vue.bilan.semaine}${vue.bilan.compareA === null ? ' (premier relevé : pas encore de comparaison)' : `, comparé au relevé de la semaine du ${vue.bilan.compareA}`} :`,
      ...vue.bilan.lignes.map((ligne) => `- ${ligne.libelle} : ${ligne.valeur}${ligne.evolution === null ? '' : ` (${ligne.evolution})`}.`),
    )
  }
  if (vue.alertes.length > 0) lignes.push('Alertes de la semaine :', ...vue.alertes.map((alerte) => `- ${alerte.titre} : ${alerte.texte}`))
  if (vue.score !== null) {
    lignes.push(
      `Score de fidélité : ${vue.score.score}/100 (indicateur interne d’Evoliia, repères fixes, pas une norme du marché) — ${vue.score.composantes.map((un) => `${un.libelle} ${un.valeur} = ${nombreLisible(un.points, 1)}/${un.max}`).join(' ; ')}.`,
    )
  }
  if (tests.length > 0) lignes.push('Tests A/B :', ...tests.map((test) => `- ${test.groupe} : ${test.explication}`))
  if (vue.insights.length > 0) lignes.push('Ce que Lina a détecté :', ...vue.insights.map((insight) => `- ${insight.texte}`))
  const aVerifier = vue.sante.filter((ligne) => ligne.etat !== 'bon')
  if (aVerifier.length > 0) lignes.push('Santé de la base :', ...aVerifier.map((ligne) => `- ${ligne.texte}`))
  return [...lignes, ...faitsCommuns(vue)]
}

/** Ce qu'Oria reçoit de Lina : les opportunités, une par ligne, déjà chiffrées. */
export function transmissionOria(vue: VueLina): string[] {
  if (vue.vierge || vue.pourOria.length === 0) return []
  return ['Opportunités CRM relevées par Lina (clients déjà acquis) :', ...vue.pourOria.map((ligne) => `- ${ligne}`)]
}
