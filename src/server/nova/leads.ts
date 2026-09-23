import type { CanalNova } from '@/lib/nova'
import type { CumulVisites } from './metriques'

/**
 * Les prospects : ce qu'une activité de services compte avant les ventes.
 *
 * Nova les lit dans les **événements clés** de Google Analytics 4 — un formulaire envoyé, un
 * clic sur « Appeler », une demande de devis — que le site déclare déjà. Aucun CRM n'est
 * nécessaire pour compter les prospects et ce qu'ils coûtent ; il le sera pour savoir combien
 * deviennent clients, et Nova ne le prétend pas.
 *
 * La personne choisit quels événements comptent. Tant qu'elle n'a rien choisi, Nova prend
 * ceux dont le nom dit « prospect » dans les usages courants, et le dit à l'écran : un
 * événement « purchase » n'est pas un prospect, un « generate_lead » oui.
 */

/** Les noms qui, dans les usages de GA4 et des outils de formulaires, désignent une demande. */
const NOMS_PROSPECT = /lead|contact|form|devis|quote|inscri|sign_?up|appointment|rendez|book|demande|call|appel|phone|telephone|whatsapp|mailto/iu
/** Ce qui n'est jamais un prospect : l'achat et ses étapes. */
const NOMS_ACHAT = /purchase|checkout|add_to_cart|add_payment|add_shipping|refund/iu

export const LEADS_MAX = 10

export type Leads = {
  total: number
  parCanal: Partial<Record<CanalNova, number>>
  /** Les événements comptés, et s'ils ont été choisis par la personne ou reconnus par Nova. */
  evenements: string[]
  auto: boolean
  /** Tous les événements clés vus sur la période, pour le choix. */
  disponibles: { nom: string; total: number }[]
}

/** Les événements qui comptent comme prospects : ceux choisis, sinon ceux que leur nom désigne. */
export function evenementsProspects(choisis: readonly string[] | undefined, disponibles: readonly string[]): { noms: string[]; auto: boolean } {
  if (choisis !== undefined) return { noms: [...choisis], auto: false }
  return { noms: disponibles.filter((nom) => NOMS_PROSPECT.test(nom) && !NOMS_ACHAT.test(nom)), auto: true }
}

/**
 * Les prospects d'une période, ou `null` quand GA4 ne peut pas les donner : pas relié, ou
 * une période dont un jour a été lu avant que Nova lise les événements.
 */
export function cumulLeads(visites: CumulVisites | null | undefined, choisis?: readonly string[]): Leads | null {
  if (visites == null || !visites.audiencesLues) return null
  // L'achat et ses étapes ne sont jamais proposés : ce ne sont pas des prospects.
  const disponibles = Object.entries(visites.evenements)
    .filter(([nom]) => !NOMS_ACHAT.test(nom))
    .map(([nom, evenement]) => ({ nom, total: evenement.total }))
    .sort((un, autre) => autre.total - un.total)
  const { noms, auto } = evenementsProspects(choisis, disponibles.map((un) => un.nom))
  const parCanal: Partial<Record<CanalNova, number>> = {}
  let total = 0
  for (const nom of noms) {
    const evenement = visites.evenements[nom]
    if (evenement === undefined) continue
    total += evenement.total
    for (const [canal, n] of Object.entries(evenement.canaux) as [CanalNova, number][]) parCanal[canal] = (parCanal[canal] ?? 0) + n
  }
  return { total: Math.round(total), parCanal, evenements: noms, auto, disponibles }
}
