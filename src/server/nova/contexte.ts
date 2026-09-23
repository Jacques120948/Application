import { membre } from '@/lib/equipe'
import type { Kpi } from './metriques'
import type { VueNova } from './service'

/**
 * Ce que Nova sait, mis en phrases pour sa conversation — et pour Oria.
 *
 * Rien n'est calculé ici : tout vient de `lireNova`. Ce module choisit et formule. Deux
 * règles le gouvernent.
 *
 * **Chaque absence est écrite.** Un indicateur manquant arrive avec la phrase qui dit
 * pourquoi et ce qu'il faudrait relier. Un modèle à qui l'on ne dit rien comble, et il
 * comble avec un chiffre plausible.
 *
 * **Les déclarations des régies sont nommées comme telles.** Jamais « revenu » tout court
 * pour ce que Google ou Meta s'attribuent : le mot seul ferait additionner.
 */

function nombre(valeur: number, decimales = 0): string {
  return new Intl.NumberFormat('fr-CH', { maximumFractionDigits: decimales }).format(valeur)
}

function valeurKpi(kpi: Kpi, devise: string): string {
  if (kpi.valeur === null) return `indisponible — ${kpi.absent}`
  const texte =
    kpi.format === 'argent' ? `${devise} ${nombre(kpi.valeur, 2)}` : kpi.format === 'pourcent' ? `${kpi.valeur} %` : nombre(kpi.valeur, 1)
  const ecart = kpi.variation === null ? 'pas de comparaison possible' : `${kpi.variation > 0 ? '+' : ''}${nombre(kpi.variation, 1)} % vs période précédente`
  return `${texte} (${ecart}) — ${kpi.source}`
}

/** Les faits de Nova, une ligne par fait. */
export function faitsNova(vue: VueNova): string[] {
  const lignes: string[] = [
    `Période : ${vue.periode.libelle} (${vue.periode.du} au ${vue.periode.au}). Période précédente comparée : ${vue.precedente.du} au ${vue.precedente.au}.`,
    `Sources : ${vue.sources.length === 0 ? 'aucune' : vue.sources.join(' + ')}. Devise : ${vue.devise}.`,
    'Indicateurs, calculés par Evoliia :',
    ...vue.kpis.map((kpi) => `- ${kpi.label} : ${valeurKpi(kpi, vue.devise)}`),
  ]

  if (vue.canaux.length === 0) {
    lignes.push('Performance par canal : aucune donnée.')
  } else {
    lignes.push('Performance par canal (régies : déclaré par la régie ; boutique : dernier clic) :')
    for (const canal of vue.canaux) {
      const parts = [
        canal.depenses === null ? null : `dépense ${vue.devise} ${nombre(canal.depenses, 2)}`,
        canal.conversionsDeclarees === null ? null : `conversions déclarées ${nombre(canal.conversionsDeclarees, 1)}`,
        canal.revenuDeclare === null ? null : `revenu déclaré ${vue.devise} ${nombre(canal.revenuDeclare, 2)}`,
        canal.roas === null ? null : `ROAS ${canal.roas} %`,
        canal.cpa === null ? null : `CPA ${vue.devise} ${nombre(canal.cpa, 2)}`,
        canal.trafic === null ? null : `trafic ${nombre(canal.trafic)} (${canal.traficNote})`,
        canal.commandes === null ? null : `commandes boutique ${canal.commandes}`,
        canal.chiffre === null ? null : `chiffre boutique ${vue.devise} ${nombre(canal.chiffre, 2)}`,
        canal.origines.length === 0 ? null : `étiquettes d’origine : ${canal.origines.join(', ')}`,
      ].filter((part): part is string => part !== null)
      lignes.push(`- ${canal.nom} : ${parts.join(' ; ')}`)
    }
  }

  const a = vue.attribution
  lignes.push(
    `Attribution — ${a.explication}`,
    `Modèle utilisé : ${a.modele}`,
    ...a.plateformes.map((ligne) => `- ${ligne.nom} déclare ${nombre(ligne.conversions, 1)} conversions et ${vue.devise} ${nombre(ligne.revenu, 2)}.`),
    a.reel === null
      ? '- Ventes réelles : inconnues, aucune boutique lue.'
      : `- Ventes réelles (Shopify) : ${a.reel.commandes} commandes, ${vue.devise} ${nombre(a.reel.chiffre, 2)}.`,
  )

  if (vue.campagnes.length > 0) {
    lignes.push('Campagnes, par dépense :')
    for (const campagne of vue.campagnes.slice(0, 8)) {
      lignes.push(
        `- [${campagne.plateforme === 'google-ads' ? 'Google' : 'Meta'}] ${campagne.nom} : dépense ${vue.devise} ${nombre(campagne.depenses, 2)}, ${nombre(campagne.conversions, 1)} conversions, ROAS ${campagne.roas ?? '—'} %, CPA ${campagne.cpa === null ? '—' : `${vue.devise} ${nombre(campagne.cpa, 2)}`}${campagne.evolution === null ? '' : `, ROAS ${campagne.evolution > 0 ? '+' : ''}${nombre(campagne.evolution, 1)} % vs avant`}`,
      )
    }
  }
  if (vue.produits.length > 0) {
    lignes.push('Produits, par chiffre d’affaires :')
    for (const produit of vue.produits.slice(0, 5)) {
      lignes.push(
        `- ${produit.titre} : ${vue.devise} ${nombre(produit.chiffre, 2)} (${Math.round(produit.part * 100)} % du CA), ${produit.commandes} commandes, ${produit.quantite} unités`,
      )
    }
  }

  lignes.push(
    vue.alertes.length === 0
      ? 'Alertes : aucune.'
      : `Alertes : ${vue.alertes.map((alerte) => `[${alerte.niveau}] ${alerte.texte} (${alerte.fondement})`).join(' | ')}`,
    vue.insights.length === 0
      ? 'Constats : aucun qui dépasse les seuils de volume.'
      : `Constats : ${vue.insights.map((insight) => `${insight.texte} (${insight.fondement})`).join(' | ')}`,
    vue.opportunites.length === 0
      ? 'Opportunités : aucune.'
      : `Opportunités : ${vue.opportunites.map((un) => `${un.titre} — ${un.pourquoi} (agent : ${membre(un.agent)?.name ?? un.agent})`).join(' | ')}`,
    `Santé des données : ${vue.sante.lignes.map((ligne) => `${ligne.source} ${ligne.etat} — ${ligne.texte}`).join(' | ')}`,
  )

  // V2 : ce que la personne a déclaré, et ce qui en découle.
  const activites: Record<string, string> = { ecommerce: 'boutique en ligne', services: 'prestations de services', saas: 'abonnement en ligne' }
  lignes.push(`Type d’activité déclaré : ${activites[vue.reglages.activite] ?? 'non précisé'}.`)
  if (vue.aVenir !== null) lignes.push(`Indicateurs indisponibles pour cette activité : ${vue.aVenir}`)
  lignes.push(
    vue.objectifs.length === 0
      ? 'Objectifs : aucun fixé. Si la question en dépend, propose d’en fixer dans l’onglet « Objectifs et marge ».'
      : `Objectifs : ${vue.objectifs
          .map((suivi) => `${suivi.label} — objectif ${suivi.objectif}, actuel ${suivi.actuel ?? 'inconnu'}${suivi.projection === null ? '' : `, projection fin de mois ${suivi.projection} (au rythme actuel, pas une prévision)`}, état ${suivi.tendance}`)
          .join(' | ')}`,
  )
  lignes.push(
    vue.marge.etat === 'impossible'
      ? `Marge : non calculable — ${vue.marge.raison}`
      : `Marge estimée sur la période (estimation basée sur les coûts renseignés) : ${vue.devise} ${nombre(vue.marge.marge, 2)}, soit ${nombre(vue.marge.taux * 100, 1)} % du CA${vue.marge.manquants.length === 0 ? '' : ` ; non renseignés : ${vue.marge.manquants.join(', ')} (marge réelle probablement plus basse)`}.`,
  )
  if (vue.clients !== null) {
    lignes.push(
      `Clients sur la période : ${vue.clients.nouveaux.commandes} commandes de nouveaux clients (${vue.devise} ${nombre(vue.clients.nouveaux.chiffre, 2)}), ${vue.clients.existants.commandes} de clients revenus, ${vue.clients.inconnus.commandes} sans client identifié.`,
    )
  }
  lignes.push(
    vue.valeurClient.etat === 'calculee'
      ? `Valeur moyenne d’un client sur ${vue.valeurClient.depuis} → ${vue.valeurClient.au} : ${vue.devise} ${nombre(vue.valeurClient.valeur, 2)}, ${nombre(vue.valeurClient.commandesParClient, 2)} commandes par client, ${Math.round(vue.valeurClient.tauxRetour * 100)} % revenus. Ce n’est PAS une LTV : ne l’appelle jamais ainsi.`
      : `Valeur client / LTV : indisponible — ${vue.valeurClient.raison}`,
  )
  if (vue.modeles !== null) {
    lignes.push(
      'CA boutique par canal selon le modèle (dernier clic / premier clic / partagé 50-50) :',
      ...vue.modeles.map((ligne) => `- ${ligne.nom} : ${nombre(ligne.chiffre.dernier, 2)} / ${nombre(ligne.chiffre.premier, 2)} / ${nombre(ligne.chiffre.partage, 2)}`),
    )
  }
  if (vue.visitesPeriode === null) {
    lignes.push(
      vue.visites.etat === 'absent'
        ? 'Visites : Google Analytics 4 n’est pas relié. Tu ne connais ni les visites, ni le taux de conversion, ni les appareils. Propose de le connecter si la question en dépend.'
        : `Visites : pas encore lues ou période non couverte (${vue.visites.message || 'actualiser'}).`,
    )
  } else {
    const v = vue.visitesPeriode
    const appareils = Object.entries(v.appareils)
      .filter(([, ligne]) => ligne.sessions > 0)
      .map(([appareil, ligne]) => `${appareil} ${ligne.sessions} visites, ${nombre((ligne.achats / ligne.sessions) * 100, 1)} % achètent`)
    lignes.push(
      `Visites GA4 sur la période : ${nombre(v.sessions)} (dont ${nombre(v.sessionsEngagees)} engagées), ${nombre(v.achats)} achats vus par GA4.`,
      `Par appareil : ${appareils.join(' ; ') || 'aucune donnée'}.`,
      `Pages d’entrée qui vendent le plus : ${v.pages.filter((page) => page.revenu > 0).slice(0, 5).map((page) => `${page.page} (${page.achats} achats, ${vue.devise} ${nombre(page.revenu, 0)})`).join(' ; ') || 'aucune'}.`,
      `Pages de recherche naturelle qui vendent : ${v.pagesSeo.filter((page) => page.revenu > 0).slice(0, 5).map((page) => `${page.page} (${vue.devise} ${nombre(page.revenu, 0)})`).join(' ; ') || 'aucune'}.`,
    )
    const ia = v.canaux.ia
    if (ia !== undefined && ia.sessions > 0) {
      lignes.push(`Visites venues d’assistants IA : ${ia.sessions} (${Object.keys(ia.origines).map((o) => o.split(' / ')[0]).join(', ')}).`)
    }
  }
  if (vue.parcours.length > 0) lignes.push(`Lecture du parcours (INTERPRÉTATION, à présenter comme telle) : ${vue.parcours.join(' ')}`)
  return lignes
}

/**
 * Le rapport de Nova à Oria, en quelques lignes.
 *
 * Oria ne recalcule rien : elle reçoit ceci, le cite, et le classe avec le reste.
 */
export function transmissionOria(vue: VueNova): string[] {
  const kpi = (cle: Kpi['cle']) => vue.kpis.find((un) => un.cle === cle)
  const chiffres = (['chiffre', 'depenses', 'roas', 'mer', 'cac'] as const)
    .map((cle) => kpi(cle))
    .filter((un): un is Kpi => un !== undefined && un.valeur !== null)
    .map((un) => `${un.label} ${valeurKpi(un, vue.devise).split(' — ')[0]}`)
  const marge =
    vue.marge.etat === 'calculee'
      ? [`- Marge estimée : ${vue.devise} ${nombre(vue.marge.marge, 0)} (${nombre(vue.marge.taux * 100, 1)} % du CA, d’après les coûts renseignés).`]
      : []
  return [
    `NOVA → ORIA (${vue.pourOria.periode}, sources : ${vue.sources.length === 0 ? 'aucune' : vue.sources.join(' + ')}). Chiffres de référence, ne les recalcule pas :`,
    chiffres.length === 0 ? '- Aucun indicateur calculable : ni boutique ni régie reliée.' : `- ${chiffres.join(' ; ')}`,
    ...marge,
    ...vue.pourOria.observations.map((observation, rang) => `${rang + 1}. ${observation}`),
    vue.pourOria.recommandation === null ? 'Recommandation de Nova : aucune.' : `Recommandation de Nova : ${vue.pourOria.recommandation}`,
  ]
}
