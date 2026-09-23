import type { CanalNova } from '@/lib/nova'
import type { AffaireCrm, ContactCrm } from '@/server/integrations/providers/hubspot'
import { jourDansFuseau } from '@/server/ads/metriques'
import type { CanalJour, JourVentes } from './agregat'
import { canalHubspot } from './canaux'

/**
 * Du CRM aux journées : des comptes, jamais un contact.
 *
 * Trois formes sortent d'ici. Par jour, les prospects créés et les clients signés, par canal.
 * Par jour aussi, les transactions gagnées rangées comme des ventes — elles ne servent de
 * chiffre d'affaires que sans boutique ni Stripe relié. Et un instantané : les cohortes de
 * prospects par mois de création, avec combien sont devenus clients, et le délai moyen entre
 * la création d'une transaction et sa signature.
 */

export type CanalCrm = { prospects: number; clients: number }

export type JourCrm = {
  jour: string
  prospects: number
  clients: number
  canaux: Partial<Record<CanalNova, CanalCrm>>
}

export type InstantaneCrm = {
  au: string
  depuis: string
  /** Prospects créés chaque mois, et combien sont devenus clients depuis. */
  cohortes: { mois: string; prospects: number; clients: number }[]
  /** Sur toute la fenêtre : prospects créés et devenus clients, par canal d'origine. */
  parCanal: Partial<Record<CanalNova, CanalCrm>>
  /** Délai moyen, en jours, entre la création d'une transaction gagnée et sa signature. */
  delaiMoyenJours: number | null
  affaires: number
}

function jourDe(horodatage: string, fuseau: string): string {
  return jourDansFuseau(new Date(horodatage), fuseau)
}

export function agregerCrm(
  contacts: readonly ContactCrm[],
  affaires: readonly AffaireCrm[],
  fuseau: string,
  depuis: string,
  aujourdhui: string,
): { jours: JourCrm[]; ventes: JourVentes[]; instantane: InstantaneCrm } {
  const jours = new Map<string, JourCrm>()
  const jour = (cle: string) => {
    const courant = jours.get(cle) ?? { jour: cle, prospects: 0, clients: 0, canaux: {} }
    jours.set(cle, courant)
    return courant
  }
  const cohortes = new Map<string, { prospects: number; clients: number }>()
  const parCanal: Partial<Record<CanalNova, CanalCrm>> = {}

  for (const contact of contacts) {
    const { canal } = canalHubspot(contact.source)
    const cree = jourDe(contact.cree, fuseau)
    if (cree >= depuis) {
      const courant = jour(cree)
      courant.prospects += 1
      const ligne = courant.canaux[canal] ?? { prospects: 0, clients: 0 }
      ligne.prospects += 1
      courant.canaux[canal] = ligne
      const mois = cree.slice(0, 7)
      const cohorte = cohortes.get(mois) ?? { prospects: 0, clients: 0 }
      cohorte.prospects += 1
      if (contact.client !== null) cohorte.clients += 1
      cohortes.set(mois, cohorte)
      const total = parCanal[canal] ?? { prospects: 0, clients: 0 }
      total.prospects += 1
      if (contact.client !== null) total.clients += 1
      parCanal[canal] = total
    }
    if (contact.client !== null) {
      const signe = jourDe(contact.client, fuseau)
      if (signe >= depuis) {
        const courant = jour(signe)
        courant.clients += 1
        const ligne = courant.canaux[canal] ?? { prospects: 0, clients: 0 }
        ligne.clients += 1
        courant.canaux[canal] = ligne
      }
    }
  }

  // Les transactions gagnées, rangées comme des ventes : une transaction = une « commande ».
  const ventes = new Map<string, JourVentes>()
  let delais = 0
  for (const affaire of affaires) {
    const cle = jourDe(affaire.gagnee, fuseau)
    if (cle < depuis) continue
    delais += Math.max(0, (Date.parse(affaire.gagnee) - Date.parse(affaire.creee)) / 86_400_000)
    const courant =
      ventes.get(cle) ??
      ({
        jour: cle,
        devise: affaire.devise,
        commandes: 0,
        chiffreCents: 0,
        nouveauxClients: 0,
        chiffreNouveauxCents: 0,
        clientsIdentifies: 0,
        canaux: {},
        canauxPremier: {},
        produits: [],
        coutsLus: false,
        lignesCents: 0,
        lignesCouteesCents: 0,
        coutProduitsCents: 0,
      } satisfies JourVentes)
    courant.commandes += 1
    courant.chiffreCents += affaire.montantCents
    const { canal, origine } = canalHubspot(affaire.source)
    const ligne: CanalJour = courant.canaux[canal] ?? { commandes: 0, chiffreCents: 0, origines: {} }
    ligne.commandes += 1
    ligne.chiffreCents += affaire.montantCents
    ligne.origines[origine] = (ligne.origines[origine] ?? 0) + 1
    courant.canaux[canal] = ligne
    ventes.set(cle, courant)
  }
  const nombreAffaires = [...ventes.values()].reduce((total, un) => total + un.commandes, 0)

  return {
    jours: [...jours.values()].sort((a, b) => a.jour.localeCompare(b.jour)),
    ventes: [...ventes.values()].sort((a, b) => a.jour.localeCompare(b.jour)),
    instantane: {
      au: aujourdhui,
      depuis,
      cohortes: [...cohortes.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mois, valeur]) => ({ mois, ...valeur })),
      parCanal,
      delaiMoyenJours: nombreAffaires === 0 ? null : Math.round((delais / nombreAffaires) * 10) / 10,
      affaires: nombreAffaires,
    },
  }
}
