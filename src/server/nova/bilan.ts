import { jourDansFuseau } from '@/server/ads/metriques'
import type { Kpi } from './metriques'
import { lireEtatVentes } from './collecte'
import { lireNova, type VueNova } from './service'

/**
 * Le bilan de la semaine : la dernière semaine complète, du lundi au dimanche.
 *
 * Pas un nouveau calcul : la vue de Nova sur ces sept jours, comparée aux sept d'avant, et
 * réduite à ce qu'on lit le lundi matin. Une semaine en cours n'est jamais un bilan — elle
 * se comparerait mal, et changerait à chaque ouverture.
 */

const JOUR_MS = 24 * 60 * 60 * 1000

/** Le lundi et le dimanche de la dernière semaine terminée, pour un jour donné (AAAA-MM-JJ). */
export function semainePassee(aujourdhui: string): { du: string; au: string } {
  const jour = new Date(`${aujourdhui}T00:00:00Z`)
  const depuisDimanche = jour.getUTCDay() === 0 ? 7 : jour.getUTCDay()
  const dimanche = new Date(+jour - depuisDimanche * JOUR_MS)
  const lundi = new Date(+dimanche - 6 * JOUR_MS)
  return { du: lundi.toISOString().slice(0, 10), au: dimanche.toISOString().slice(0, 10) }
}

export type Evolution = { quoi: string; texte: string }

export type Bilan = {
  vue: VueNova
  chiffres: Kpi[]
  topCanal: string | null
  topCampagne: string | null
  topProduit: string | null
  anomalie: string | null
  opportunite: string | null
  progresse: Evolution[]
  baisse: Evolution[]
  attention: string[]
}

/** Au-dessous, une variation d'une semaine sur l'autre n'est qu'un bruit. */
const SEUIL_VARIATION = 5

function pourcent(valeur: number): string {
  return `${valeur > 0 ? '+' : '−'}${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 1 }).format(Math.abs(valeur))} %`
}

export function composerBilan(vue: VueNova): Bilan {
  const cles: Kpi['cle'][] = ['chiffre', 'depenses', 'roas', 'cac', 'commandes']
  const chiffres = cles.map((cle) => vue.kpis.find((kpi) => kpi.cle === cle)).filter((kpi): kpi is Kpi => kpi !== undefined)

  const progresse: Evolution[] = []
  const baisse: Evolution[] = []
  for (const kpi of vue.kpis) {
    if (kpi.variation === null || Math.abs(kpi.variation) < SEUIL_VARIATION || kpi.mieux === 'neutre') continue
    const mieux = (kpi.variation > 0) === (kpi.mieux === 'hausse')
    const ligne = { quoi: kpi.label, texte: `${kpi.label} : ${pourcent(kpi.variation)}` }
    ;(mieux ? progresse : baisse).push(ligne)
  }

  const canal = [...vue.canaux]
    .filter((ligne) => ligne.canal !== 'inconnu' && (ligne.chiffre ?? 0) > 0)
    .sort((un, autre) => (autre.chiffre ?? 0) - (un.chiffre ?? 0))[0]
  const campagne = [...vue.campagnes].sort((une, autre) => autre.revenu - une.revenu)[0]
  const produit = vue.produits[0]
  const anomalie = vue.alertes.find((alerte) => alerte.niveau !== 'vert')

  return {
    vue,
    chiffres,
    topCanal: canal === undefined ? null : `${canal.nom} — ${vue.devise} ${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 0 }).format(canal.chiffre ?? 0)} au dernier clic`,
    topCampagne:
      campagne === undefined || campagne.revenu === 0
        ? null
        : `${campagne.nom} (${campagne.plateforme === 'google-ads' ? 'Google' : 'Meta'}) — ROAS ${campagne.roas ?? '—'} %`,
    topProduit: produit === undefined ? null : `${produit.titre} — ${Math.round(produit.part * 100)} % du chiffre d’affaires`,
    anomalie: anomalie?.texte ?? null,
    opportunite: vue.opportunites[0] === undefined ? null : vue.opportunites[0].titre,
    progresse,
    baisse,
    attention: [
      ...vue.alertes.filter((alerte) => alerte.niveau !== 'vert').map((alerte) => alerte.texte),
      ...vue.sante.lignes.filter((ligne) => ligne.etat === 'probleme').map((ligne) => `${ligne.source} : ${ligne.texte}`),
    ].slice(0, 4),
  }
}

/** Le bilan de la dernière semaine complète, dans le fuseau de la boutique ou du compte. */
export async function lireBilan(userId: string, locale: string, siteId?: string, maintenant = new Date()): Promise<Bilan> {
  // Le fuseau de la boutique découpe les semaines ; à défaut, celui de la Suisse.
  const ventes = await lireEtatVentes(userId).catch(() => null)
  const aujourdhui = jourDansFuseau(maintenant, ventes?.fuseau || 'Europe/Zurich')
  const { du, au } = semainePassee(aujourdhui)
  const vue = await lireNova(userId, locale, { periode: 'perso', du, au, siteId }, maintenant)
  return composerBilan(vue)
}
