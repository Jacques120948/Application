import { NOM_CANAL, type CanalNova } from '@/lib/nova'
import type { InstantaneCrm } from './agregat-crm'

/**
 * Ce que le CRM dit que les autres sources ne disent pas : combien de prospects deviennent
 * clients, par où ils sont arrivés, et en combien de temps.
 *
 * Le taux se lit par cohorte (les prospects d'un mois, et combien ont signé depuis) : un
 * prospect du mois dernier n'a pas eu le temps de signer, et mêler les mois récents aux
 * anciens ferait baisser le taux sans que rien n'ait changé. Le taux global ne compte donc
 * que les cohortes d'au moins un mois terminé.
 */

export type LigneTaux = { cle: string; nom: string; prospects: number; clients: number; taux: number | null }

export type LectureCrm = {
  /** Prospects des cohortes d'au moins un mois terminé, et part devenue cliente. */
  global: LigneTaux | null
  cohortes: LigneTaux[]
  parCanal: LigneTaux[]
  delaiMoyenJours: number | null
  affaires: number
}

/** En deçà, un taux de transformation tient du hasard. */
export const PROSPECTS_MIN_TAUX = 20

function taux(prospects: number, clients: number): number | null {
  return prospects < PROSPECTS_MIN_TAUX ? null : clients / prospects
}

function moisPrecedent(mois: string): string {
  const [annee, m] = mois.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(annee, m - 2, 1)).toISOString().slice(0, 7)
}

export function lireCrm(instantane: InstantaneCrm | null): LectureCrm | null {
  if (instantane === null) return null
  const courant = instantane.au.slice(0, 7)
  const limite = moisPrecedent(courant)
  const murs = instantane.cohortes.filter((cohorte) => cohorte.mois < limite)
  const prospects = murs.reduce((total, cohorte) => total + cohorte.prospects, 0)
  const clients = murs.reduce((total, cohorte) => total + cohorte.clients, 0)
  return {
    global: murs.length === 0 ? null : { cle: 'global', nom: 'Cohortes d’au moins un mois', prospects, clients, taux: taux(prospects, clients) },
    cohortes: instantane.cohortes.map((cohorte) => ({ cle: cohorte.mois, nom: cohorte.mois, prospects: cohorte.prospects, clients: cohorte.clients, taux: taux(cohorte.prospects, cohorte.clients) })),
    parCanal: (Object.entries(instantane.parCanal) as [CanalNova, { prospects: number; clients: number }][])
      .map(([canal, ligne]) => ({ cle: canal, nom: NOM_CANAL[canal], prospects: ligne.prospects, clients: ligne.clients, taux: taux(ligne.prospects, ligne.clients) }))
      .sort((un, autre) => autre.prospects - un.prospects),
    delaiMoyenJours: instantane.delaiMoyenJours,
    affaires: instantane.affaires,
  }
}

/**
 * Le canal qui amène des prospects qui ne signent pas : au moins vingt prospects, et un taux
 * inférieur à la moitié du taux de l'ensemble — ou aucun client du tout pour un canal payant.
 */
export function canalQuiNeSignePas(lecture: LectureCrm): LigneTaux | null {
  const total = lecture.parCanal.reduce((somme, ligne) => ({ p: somme.p + ligne.prospects, c: somme.c + ligne.clients }), { p: 0, c: 0 })
  if (total.p < PROSPECTS_MIN_TAUX || total.c === 0) return null
  const reference = total.c / total.p
  return (
    lecture.parCanal
      .filter((ligne) => ligne.taux !== null && (ligne.taux < reference / 2 || (ligne.clients === 0 && (ligne.cle === 'google-ads' || ligne.cle === 'meta-ads'))))
      .sort((un, autre) => autre.prospects - un.prospects)[0] ?? null
  )
}
