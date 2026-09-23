import { AUTRES_PAYS } from './agregat-ga4'
import type { CumulVisites, SegmentVisites } from './metriques'

/**
 * Qui vient sur le site, et qui achète : par pays, et selon qu'on vient pour la première
 * fois ou qu'on revient.
 *
 * Deux lectures seulement, parce que ce sont celles qui changent une décision : un pays qui
 * envoie beaucoup de visites et n'achète pas (une publicité mal ciblée, une livraison qui
 * n'y va pas) ; des visiteurs qui reviennent et achètent bien plus que les nouveaux (ce que
 * rapporte la fidélité, et ce que coûte de ne pas la travailler). L'âge et le sexe demandent
 * les signaux Google, que beaucoup de sites n'ont pas : Nova ne les suppose pas.
 */

export type LigneAudience = {
  cle: string
  nom: string
  sessions: number
  /** Part des visites, de 0 à 1. */
  part: number
  achats: number
  /** Achats ÷ visites, de 0 à 1 ; `null` sous le volume minimal. */
  conversion: number | null
}

export type Audiences = {
  pays: LigneAudience[]
  nouveaux: LigneAudience
  connus: LigneAudience
  /**
   * Tranches d'âge et sexe, seulement quand Google les connaît pour la moitié des visites au
   * moins (ses signaux sont souvent désactivés ou masqués) ; `null` sinon.
   */
  ages: LigneAudience[] | null
  sexes: LigneAudience[] | null
}

const SEXES: Record<string, string> = { female: 'Femmes', male: 'Hommes' }

function repartition(segments: Record<string, SegmentVisites>, nom: (cle: string) => string): LigneAudience[] | null {
  const total = Object.values(segments).reduce((somme, segment) => somme + segment.sessions, 0)
  const connus = Object.entries(segments).filter(([cle]) => cle !== 'unknown')
  const vus = connus.reduce((somme, [, segment]) => somme + segment.sessions, 0)
  if (total < 500 || vus / total < 0.5) return null
  return connus.map(([cle, segment]) => ligne(cle, nom(cle), segment, vus)).sort((un, autre) => un.cle.localeCompare(autre.cle))
}

/** En deçà, un taux de conversion par segment tient du hasard. */
export const SESSIONS_SEGMENT_MIN = 100
const PAYS_AFFICHES = 8

let noms: Intl.DisplayNames | null = null
export function nomPays(code: string): string {
  if (code === AUTRES_PAYS) return 'Autres pays'
  try {
    noms ??= new Intl.DisplayNames(['fr'], { type: 'region' })
    return noms.of(code) ?? code
  } catch {
    return code
  }
}

function ligne(cle: string, nom: string, segment: SegmentVisites, total: number): LigneAudience {
  return {
    cle,
    nom,
    sessions: segment.sessions,
    part: total === 0 ? 0 : segment.sessions / total,
    achats: segment.achats,
    conversion: segment.sessions < SESSIONS_SEGMENT_MIN ? null : segment.achats / segment.sessions,
  }
}

export function lireAudiences(visites: CumulVisites | null | undefined): Audiences | null {
  if (visites == null || !visites.audiencesLues || visites.sessions < SESSIONS_SEGMENT_MIN) return null
  const total = Object.values(visites.pays).reduce((somme, segment) => somme + segment.sessions, 0)
  if (total === 0) return null
  const tries = Object.entries(visites.pays)
    .filter(([code]) => code !== AUTRES_PAYS)
    .sort((un, autre) => autre[1].sessions - un[1].sessions)
  const affiches = tries.slice(0, PAYS_AFFICHES).map(([code, segment]) => ligne(code, nomPays(code), segment, total))
  const reste = [...tries.slice(PAYS_AFFICHES).map(([, segment]) => segment), visites.pays[AUTRES_PAYS]].filter(
    (segment): segment is SegmentVisites => segment !== undefined,
  )
  if (reste.length > 0) {
    const cumul = reste.reduce((somme, segment) => ({ sessions: somme.sessions + segment.sessions, achats: somme.achats + segment.achats }), { sessions: 0, achats: 0 })
    affiches.push(ligne(AUTRES_PAYS, 'Autres pays', cumul, total))
  }
  const visiteurs = visites.visiteurs.nouveaux.sessions + visites.visiteurs.connus.sessions
  return {
    pays: affiches,
    nouveaux: ligne('nouveaux', 'Nouveaux visiteurs', visites.visiteurs.nouveaux, visiteurs),
    connus: ligne('connus', 'Visiteurs qui reviennent', visites.visiteurs.connus, visiteurs),
    ages: repartition(visites.ages, (cle) => `${cle} ans`),
    sexes: repartition(visites.sexes, (cle) => SEXES[cle] ?? cle),
  }
}

/**
 * Le pays qui envoie du monde sans acheter : au moins 10 % des visites, et une conversion
 * inférieure à la moitié de celle du premier pays. `null` s'il n'y en a pas.
 */
export function paysQuiNAchetePas(audiences: Audiences): { pays: LigneAudience; reference: LigneAudience } | null {
  const [reference, ...autres] = audiences.pays.filter((un) => un.cle !== AUTRES_PAYS)
  if (reference === undefined || reference.conversion === null || reference.conversion === 0) return null
  const faible = autres
    .filter((un) => un.part >= 0.1 && un.conversion !== null && un.conversion < reference.conversion! / 2)
    .sort((un, autre) => autre.sessions - un.sessions)[0]
  return faible === undefined ? null : { pays: faible, reference }
}
