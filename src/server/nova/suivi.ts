import type { IdMembre } from '@/lib/equipe'
import type { CumulPub, CumulVentes, PlateformePayante } from './metriques'

/**
 * La qualité du suivi : ce qui fausse les chiffres avant même qu'on les lise.
 *
 * Nova ne voit pas le code du site ; elle voit ce qui en sort. Des publicités Meta dont les
 * ventes tombent toutes en « réseaux sociaux », des ventes Google Ads que la boutique n'attribue
 * jamais à Google Ads, des étiquettes UTM qu'aucune règle ne sait ranger : chacun de ces
 * signes a une cause probable et quelqu'un qui peut la corriger. Chaque contrôle exige un
 * volume minimal — sur trois commandes, une absence ne prouve rien.
 */

export type ControleSuivi = {
  cle: string
  source: string
  etat: 'verifier' | 'probleme'
  texte: string
  /** Qui peut corriger : la régie concernée, ou Léa pour un audit du site. */
  agent: IdMembre
}

const COMMANDES_MIN = 20
const DEPENSE_MIN = 50
const CONVERSIONS_MIN = 5
/** Part des commandes aux étiquettes UTM que Nova ne sait pas ranger. */
const PART_AUTRES = 0.1

const META = /facebook|instagram|\bfb\b|\big\b|meta/iu

export function controlesSuivi(entree: {
  ventes: CumulVentes | null
  regies: readonly PlateformePayante[]
  pub: (plateforme: PlateformePayante) => CumulPub
}): ControleSuivi[] {
  const { ventes } = entree
  if (ventes === null || ventes.commandes < COMMANDES_MIN) return []
  const controles: ControleSuivi[] = []

  if (entree.regies.includes('meta-ads')) {
    const meta = entree.pub('meta-ads')
    const social = ventes.canaux.social
    const depuisMeta = Object.entries(social?.origines ?? {})
      .filter(([origine]) => META.test(origine))
      .reduce((total, [, n]) => total + n, 0)
    if (meta.depense >= DEPENSE_MIN && (ventes.canaux['meta-ads']?.commandes ?? 0) === 0 && depuisMeta > 0) {
      controles.push({
        cle: 'suivi.utm-meta',
        source: 'UTM des publicités Meta',
        etat: 'verifier',
        texte: `Vos publicités Meta ne semblent pas porter de paramètres UTM : aucune commande n’est rangée en « Meta Ads », mais ${depuisMeta} arrivent de Facebook ou Instagram en « Réseaux sociaux ». Ajoutez utm_source=facebook&utm_medium=paid aux liens de vos publicités.`,
        agent: 'meta',
      })
    }
  }

  if (entree.regies.includes('google-ads')) {
    const google = entree.pub('google-ads')
    if (google.depense >= DEPENSE_MIN && google.conversions >= CONVERSIONS_MIN && (ventes.canaux['google-ads']?.commandes ?? 0) === 0) {
      controles.push({
        cle: 'suivi.gclid',
        source: 'Marquage Google Ads',
        etat: 'verifier',
        texte: `Google Ads déclare ${Math.round(google.conversions)} conversions, la boutique n’attribue aucune commande à Google Ads. Le marquage automatique (gclid) est peut-être désactivé, ou une redirection efface les paramètres des liens.`,
        agent: 'ads',
      })
    }
  }

  const autres = ventes.canaux.autres
  if (autres !== undefined && autres.commandes >= 5 && autres.commandes / ventes.commandes >= PART_AUTRES) {
    const etiquettes = Object.entries(autres.origines)
      .sort((une, autre) => autre[1] - une[1])
      .slice(0, 3)
      .map(([origine]) => `« ${origine} »`)
      .join(', ')
    controles.push({
      cle: 'suivi.utm-inconnues',
      source: 'Étiquettes UTM',
      etat: 'verifier',
      texte: `${Math.round((autres.commandes / ventes.commandes) * 100)} % des commandes portent des étiquettes UTM qu’aucun canal ne reconnaît (${etiquettes}). Des noms homogènes (utm_source=google, facebook, newsletter ; utm_medium=cpc, paid, email) rendent la répartition fiable.`,
      agent: 'audit',
    })
  }

  return controles
}
