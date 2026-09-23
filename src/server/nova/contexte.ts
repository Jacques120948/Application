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
  return [
    `NOVA → ORIA (${vue.pourOria.periode}, sources : ${vue.sources.length === 0 ? 'aucune' : vue.sources.join(' + ')}). Chiffres de référence, ne les recalcule pas :`,
    chiffres.length === 0 ? '- Aucun indicateur calculable : ni boutique ni régie reliée.' : `- ${chiffres.join(' ; ')}`,
    ...vue.pourOria.observations.map((observation, rang) => `${rang + 1}. ${observation}`),
    vue.pourOria.recommandation === null ? 'Recommandation de Nova : aucune.' : `Recommandation de Nova : ${vue.pourOria.recommandation}`,
  ]
}
