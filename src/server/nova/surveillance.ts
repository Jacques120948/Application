import { NOM_CANAL } from '@/lib/nova'
import { cumulPub, cumulVentes, cumulVisites, type Donnees, type PlateformePayante } from './metriques'

/**
 * La surveillance : chaque chiffre comparé à lui-même, sur quatre fenêtres.
 *
 * Hier, les 7 derniers jours, les 30 derniers, les 90 derniers — tous finissant hier, et
 * ramenés à une moyenne par jour pour se comparer (une dépense de 7 jours ne se compare pas
 * à une dépense de 30). Les ratios (coût par conversion, ROAS, taux) se calculent sur les
 * sommes de chaque fenêtre, jamais en moyennant des ratios journaliers.
 *
 * Un écart n'est signalé qu'au-delà d'un volume minimal : sur trois conversions, un coût par
 * conversion qui double n'est pas une anomalie, c'est une conversion de moins. Ce sont des
 * règles chiffrées, sans modèle — le cahier des charges demandait « des règles statistiques
 * simples » avant tout le reste.
 */

export type Fenetre = 'hier' | '7' | '30' | '90'
export const FENETRES: readonly Fenetre[] = ['hier', '7', '30', '90']

export type LigneSurveillance = {
  cle: string
  source: string
  mesure: string
  format: 'argent' | 'nombre' | 'pourcent'
  /** Ce qui est une bonne nouvelle : que le chiffre monte, qu'il baisse, ou ni l'un ni l'autre. */
  mieux: 'hausse' | 'baisse' | 'neutre'
  valeurs: Record<Fenetre, number | null>
  /** L'écart qui fait signaler la ligne : 7 jours (ou hier) contre la moyenne de 30 jours. */
  ecart: { de: Fenetre; contre: Fenetre; variation: number } | null
  niveau: 'normal' | 'attention' | 'alerte'
}

const JOUR_MS = 24 * 60 * 60 * 1000

function decaler(jour: string, n: number): string {
  return new Date(Date.parse(`${jour}T00:00:00Z`) + n * JOUR_MS).toISOString().slice(0, 10)
}

function bornesDe(hier: string, fenetre: Fenetre): { du: string; au: string; jours: number } {
  const jours = fenetre === 'hier' ? 1 : Number(fenetre)
  return { du: decaler(hier, -(jours - 1)), au: hier, jours }
}

function arrondi(valeur: number, decimales = 2): number {
  const facteur = 10 ** decimales
  return Math.round(valeur * facteur) / facteur
}

function variation(de: number | null, contre: number | null): number | null {
  if (de === null || contre === null || contre === 0) return null
  return Math.round(((de - contre) / contre) * 100)
}

type Regle = {
  /** Le volume minimal, sur la fenêtre courte et sur la référence, pour que l'écart compte. */
  assez: (court: Fenetre) => boolean
  attention: number
  alerte: number
}

function niveauDe(ligne: Omit<LigneSurveillance, 'ecart' | 'niveau'>, regle: Regle | null, de: Fenetre = '7'): Pick<LigneSurveillance, 'ecart' | 'niveau'> {
  const ecart = variation(ligne.valeurs[de], ligne.valeurs['30'])
  if (ecart === null || regle === null || !regle.assez(de)) return { ecart: null, niveau: 'normal' }
  // Dans le mauvais sens seulement ; une dépense (neutre) se signale dans les deux.
  const mauvais = ligne.mieux === 'neutre' ? Math.abs(ecart) : ligne.mieux === 'hausse' ? -ecart : ecart
  const niveau = mauvais >= regle.alerte ? 'alerte' : mauvais >= regle.attention ? 'attention' : 'normal'
  return { ecart: niveau === 'normal' ? null : { de, contre: '30', variation: ecart }, niveau }
}

export function surveillance(donnees: Donnees, hier: string, nomVentes = 'Shopify'): LigneSurveillance[] {
  const lignes: LigneSurveillance[] = []
  const bornes = Object.fromEntries(FENETRES.map((fenetre) => [fenetre, bornesDe(hier, fenetre)])) as Record<Fenetre, ReturnType<typeof bornesDe>>

  for (const plateforme of donnees.regies as PlateformePayante[]) {
    const cumuls = Object.fromEntries(
      FENETRES.map((fenetre) => [fenetre, cumulPub(donnees.campagnes, bornes[fenetre], (ligne) => ligne.plateforme === plateforme)]),
    ) as Record<Fenetre, ReturnType<typeof cumulPub>>
    const source = NOM_CANAL[plateforme]
    const parJour = (fenetre: Fenetre, valeur: number) => arrondi(valeur / bornes[fenetre].jours)
    const valeurs = (f: (fenetre: Fenetre) => number | null) =>
      Object.fromEntries(FENETRES.map((fenetre) => [fenetre, f(fenetre)])) as Record<Fenetre, number | null>

    const depense = { cle: `${plateforme}.depense`, source, mesure: 'Dépense par jour', format: 'argent' as const, mieux: 'neutre' as const, valeurs: valeurs((f) => parJour(f, cumuls[f].depense)) }
    const aDepense = (court: Fenetre) => cumuls[court].depense * (30 / bornes[court].jours) >= 50 && cumuls['30'].depense >= 50
    lignes.push({ ...depense, ...niveauDe(depense, { assez: aDepense, attention: 50, alerte: 100 }, depense.valeurs.hier !== null && depense.valeurs['30'] !== null && depense.valeurs.hier > 2 * depense.valeurs['30'] ? 'hier' : '7') })

    const conversions = { cle: `${plateforme}.conversions`, source, mesure: 'Conversions par jour', format: 'nombre' as const, mieux: 'hausse' as const, valeurs: valeurs((f) => parJour(f, cumuls[f].conversions)) }
    lignes.push({ ...conversions, ...niveauDe(conversions, { assez: () => cumuls['7'].conversions >= 5 && cumuls['30'].conversions >= 15, attention: 30, alerte: 50 }) })

    const cpa = {
      cle: `${plateforme}.cpa`,
      source,
      mesure: 'Coût par conversion',
      format: 'argent' as const,
      mieux: 'baisse' as const,
      valeurs: valeurs((f) => (cumuls[f].conversions === 0 ? null : arrondi(cumuls[f].depense / cumuls[f].conversions))),
    }
    lignes.push({ ...cpa, ...niveauDe(cpa, { assez: () => cumuls['7'].conversions >= 5 && cumuls['30'].conversions >= 15, attention: 30, alerte: 60 }) })

    const roas = {
      cle: `${plateforme}.roas`,
      source,
      mesure: 'ROAS',
      format: 'pourcent' as const,
      mieux: 'hausse' as const,
      valeurs: valeurs((f) => (cumuls[f].depense === 0 ? null : Math.round((cumuls[f].valeur / cumuls[f].depense) * 100))),
    }
    lignes.push({ ...roas, ...niveauDe(roas, { assez: () => cumuls['7'].depense >= 50 && cumuls['7'].conversions >= 5, attention: 30, alerte: 50 }) })
  }

  // Les ventes : une fenêtre qui commence avant les ventes connues reste vide.
  const ventes = Object.fromEntries(FENETRES.map((fenetre) => [fenetre, cumulVentes(donnees.ventes, bornes[fenetre])])) as Record<Fenetre, ReturnType<typeof cumulVentes>>
  if (ventes['30'] !== null) {
    const valeurs = (f: (fenetre: Fenetre) => number | null) =>
      Object.fromEntries(FENETRES.map((fenetre) => [fenetre, f(fenetre)])) as Record<Fenetre, number | null>
    const chiffre = { cle: 'ventes.chiffre', source: nomVentes, mesure: 'Chiffre d’affaires par jour', format: 'argent' as const, mieux: 'hausse' as const, valeurs: valeurs((f) => (ventes[f] === null ? null : arrondi(ventes[f]!.chiffre / bornes[f].jours))) }
    const assez = () => (ventes['30']?.commandes ?? 0) >= 30 && (ventes['7']?.commandes ?? 0) >= 3
    lignes.push({ ...chiffre, ...niveauDe(chiffre, { assez, attention: 30, alerte: 50 }) })
    const commandes = { cle: 'ventes.commandes', source: nomVentes, mesure: 'Commandes par jour', format: 'nombre' as const, mieux: 'hausse' as const, valeurs: valeurs((f) => (ventes[f] === null ? null : arrondi(ventes[f]!.commandes / bornes[f].jours))) }
    lignes.push({ ...commandes, ...niveauDe(commandes, { assez, attention: 30, alerte: 50 }) })
  }

  const visites = Object.fromEntries(FENETRES.map((fenetre) => [fenetre, cumulVisites(donnees.visites, bornes[fenetre])])) as Record<Fenetre, ReturnType<typeof cumulVisites>>
  if (visites['30'] !== null) {
    const valeurs = (f: (fenetre: Fenetre) => number | null) =>
      Object.fromEntries(FENETRES.map((fenetre) => [fenetre, f(fenetre)])) as Record<Fenetre, number | null>
    const sessions = { cle: 'visites.sessions', source: 'Google Analytics 4', mesure: 'Visites par jour', format: 'nombre' as const, mieux: 'hausse' as const, valeurs: valeurs((f) => (visites[f] === null ? null : arrondi(visites[f]!.sessions / bornes[f].jours))) }
    lignes.push({ ...sessions, ...niveauDe(sessions, { assez: () => (visites['30']?.sessions ?? 0) >= 1_000, attention: 30, alerte: 50 }) })
  }
  return lignes
}
