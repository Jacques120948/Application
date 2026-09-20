import { notFound } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { normaliser } from '@/server/commerce/illustrations'
import { useOAuthAccess } from '@/server/integrations/service'
import {
  listerProprietes,
  rafraichir,
  requetes,
  requetesEtPages,
  type Ligne,
} from '@/server/integrations/providers/google-search-console'
import { choisirPropriete } from './recherches'
import { classer, type Intention } from './intentions'

/**
 * Le calendrier de rédaction, tiré de la demande réelle.
 *
 * Écrire un article par semaine est un conseil que tout le monde donne ; sur quoi l'écrire
 * est la seule question qui compte, et personne n'y répond avec des chiffres. Ce module le
 * fait avec ceux de Google sur les pages de la personne : ce qu'on lui a tapé, combien de
 * fois, et à quelle place elle est sortie.
 *
 * Quatre décisions.
 *
 * **Rien n'est estimé, et surtout pas un gain.** On pourrait annoncer « cette requête
 * rapporterait quarante clics » en multipliant les affichages par un taux de clic moyen.
 * Ce serait une invention présentée comme une prévision. Le calendrier dit ce qui est
 * mesuré — affichages, clics, position — et laisse la personne juger.
 *
 * **La deuxième page passe devant.** Une requête où le site sort onzième a déjà tout pour
 * remonter ; une requête où il sort centième part de zéro. Classer par affichages sans
 * tenir compte de la position mettrait les secondes devant, et ferait écrire des articles
 * qui ne bougeront rien.
 *
 * **La première page est écartée.** Un nouvel article n'y ajoute rien : ce qui s'y joue,
 * c'est le titre et la description, et c'est le métier de Néo. Proposer d'écrire là serait
 * vendre un article contre un problème qu'il ne résout pas.
 *
 * **Ce qui est déjà écrit ne se réécrit pas.** Un article qui double un article existant
 * crée le contenu dupliqué que l'analyse reprochera au suivant.
 *
 * **La langue vient de Google, pas d'un dictionnaire.** Un site multilingue reçoit des
 * requêtes dans plusieurs langues, et écrire en français un article demandé en italien
 * revient à payer un texte que personne de ce public ne lira. On pourrait deviner la langue
 * de deux mots ; on préfère regarder sur quelle page Google classe la requête, parce que le
 * chemin de cette page la porte — et parce que c'est mesuré.
 *
 * Aucun crédit : c'est du comptage sur une lecture gratuite.
 */

/** La période lue. Plus longue que l'écran des recherches : un calendrier regarde loin. */
export const JOURS_CALENDRIER = 90

/** Sous ce nombre d'affichages, la demande est trop mince pour porter un article. */
const AFFICHAGES_MINIMUM = 20

/** Les bornes de la deuxième page, en position moyenne. Identiques au reste du produit. */
const PAGE_DEUX = { haut: 10.5, bas: 20.5 }

/** Ce qu'il faut de mots en commun pour considérer qu'un article couvre déjà le sujet. */
const RECOUVREMENT = 0.6

/**
 * Le rythme de publication, choisi par la personne.
 *
 * Il ne change pas l'ordre des sujets — celui-ci vient des chiffres — mais il change
 * combien on en propose et sur quelle durée. Une boutique qui tient un article par mois ne
 * doit pas recevoir un plan de huit semaines qu'elle abandonnera à la troisième.
 */
export type Rythme = {
  /** Combien d'articles par période. */
  parPeriode: number
  periode: 'semaine' | 'mois'
  /** Combien de périodes couvrir. */
  periodes: number
}

export type Creneau = {
  /** Rang de la période, à partir de 1. */
  semaine: number
  /**
   * La langue dans laquelle écrire, quand elle diffère de celle du site.
   *
   * `null` veut dire « celle du site » : ou bien la requête tombe sur une page sans préfixe
   * de langue, ou bien Google ne l'a associée à aucune page dans ce qu'il a rendu. Dans les
   * deux cas on ne sait pas, et on ne prétend pas savoir.
   */
  langue: string | null
  /** Le lundi de cette semaine-là. */
  date: Date
  requete: string
  impressions: number
  clics: number
  position: number
  /** Pourquoi ce sujet, dit avec les chiffres et sans promesse. */
  pourquoi: string
  /**
   * Ce que cette recherche veut, déduit de ses mots.
   *
   * Affichée avant le clic : c'est elle qui décide de la forme de l'article, et quelqu'un
   * qui la voit avant de payer peut la contester — en changeant le sujet, ou en écrivant
   * le sien. Une déduction montrée vaut mieux qu'une déduction cachée.
   */
  intention: Intention
}

export type VueCalendrier = {
  site: { id: string; host: string }
  propriete: string | null
  jours: number
  creneaux: Creneau[]
  /** Sujets écartés parce qu'un article les couvre déjà. */
  dejaEcrits: number
}

/**
 * Cette requête est-elle déjà traitée par un article existant ?
 *
 * Par recouvrement de mots, comme les illustrations : « bougie obsidienne noire » est
 * couverte par un article intitulé « Obsidienne noire : origine et vertus ». Ce n'est pas
 * exact, et ça n'a pas à l'être — le coût d'une erreur est de proposer un sujet de trop ou
 * d'en taire un, jamais de casser quoi que ce soit.
 */
export function dejaCouvert(requete: string, titres: readonly string[]): boolean {
  const mots = normaliser(requete)
  if (mots.length === 0) return false

  return titres.some((titre) => {
    const presents = new Set(normaliser(titre))
    const communs = mots.filter((mot) => presents.has(mot)).length
    return communs / mots.length >= RECOUVREMENT
  })
}

/**
 * La langue portée par le chemin d'une adresse, ou `null`.
 *
 * Conventionnellement, un site multilingue préfixe ses chemins du code de la langue —
 * `/it/bougies`, `/de/kerzen`. Deux lettres minuscules en tête de chemin, et rien d'autre :
 * un segment plus long serait une page ordinaire, et s'y fier ferait passer `/fr-CH/` ou
 * `/produits/` pour des langues.
 */
export function langueDuChemin(adresse: string): string | null {
  try {
    const segment = new URL(adresse).pathname.split('/').filter(Boolean)[0] ?? ''
    return /^[a-z]{2}$/.test(segment) ? segment : null
  } catch {
    return null
  }
}

/** Le lundi de la semaine qui suit, puis les suivants. */
function lundi(depuis: Date, rang: number): Date {
  const date = new Date(depuis)
  const jour = date.getDay()
  // getDay() rend 0 pour dimanche : le prochain lundi est donc à 1 jour.
  const versLundi = jour === 0 ? 1 : 8 - jour
  date.setDate(date.getDate() + versLundi + (rang - 1) * 7)
  date.setHours(0, 0, 0, 0)
  return date
}

/**
 * Le plan de rédaction, à partir des requêtes mesurées.
 *
 * Séparée de la lecture pour être vérifiable sans réseau : c'est ici que se joue l'ordre,
 * et un ordre faux fait écrire les mauvais articles pendant des mois.
 */
export function planifier(
  lignes: readonly Ligne[],
  dejaEcrits: readonly string[],
  options: Rythme & {
    depuis?: Date
    /** La page que Google associe à chaque requête, quand il l'a dit. */
    pages?: ReadonlyMap<string, string>
  },
): { creneaux: Creneau[]; ecartes: number } {
  const depuis = options.depuis ?? new Date()
  let ecartes = 0

  const candidates = lignes
    .filter((ligne) => ligne.impressions >= AFFICHAGES_MINIMUM)
    // La première page ne se gagne pas avec un article de plus : c'est le métier de Néo.
    .filter((ligne) => ligne.position > PAGE_DEUX.haut)
    .filter((ligne) => {
      if (!dejaCouvert(ligne.cle, dejaEcrits)) return true
      ecartes += 1
      return false
    })
    .sort((a, b) => {
      const aProche = a.position < PAGE_DEUX.bas
      const bProche = b.position < PAGE_DEUX.bas
      if (aProche !== bProche) return aProche ? -1 : 1
      return b.impressions - a.impressions
    })
    .slice(0, options.parPeriode * options.periodes)

  const semainesParPeriode = options.periode === 'mois' ? 4 : 1
  const creneaux = candidates.map((ligne, rang) => {
    const semaine = Math.floor(rang / options.parPeriode) + 1
    const proche = ligne.position < PAGE_DEUX.bas
    const page = options.pages?.get(ligne.cle)
    return {
      semaine,
      langue: page === undefined ? null : langueDuChemin(page),
      date: lundi(depuis, (semaine - 1) * semainesParPeriode + 1),
      requete: ligne.cle,
      intention: classer(ligne.cle),
      impressions: ligne.impressions,
      clics: ligne.clics,
      position: ligne.position,
      pourquoi: proche
        ? `${ligne.impressions} affichages pour ${ligne.clics} clic${ligne.clics > 1 ? 's' : ''}, à la place ${ligne.position}. Vous y êtes presque : c'est là que quelques places gagnées changent le plus.`
        : `${ligne.impressions} affichages pour ${ligne.clics} clic${ligne.clics > 1 ? 's' : ''}, à la place ${ligne.position}. La demande existe, votre site n'y répond pas encore.`,
    }
  })

  return { creneaux, ecartes }
}

/** Le calendrier d'un site. Une seule lecture chez Google, aucun crédit. */
export async function lireCalendrier(
  userId: string,
  siteId: string,
  options: Rythme,
): Promise<VueCalendrier> {
  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { id: true, host: true, origin: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const articles = await withUserScope(userId, (tx) =>
    tx.siteArticle.findMany({
      where: { siteId, userId },
      select: { sujet: true, titre: true },
    }),
  )
  const dejaEcrits = articles.map((article) => `${article.sujet} ${article.titre}`)

  const vide = {
    site: { id: site.id, host: site.host },
    propriete: null,
    jours: JOURS_CALENDRIER,
    creneaux: [],
    dejaEcrits: 0,
  }

  const acces = await useOAuthAccess(userId, 'google-search-console', rafraichir)
  if (!acces.ok) return vide

  const proprietes = await listerProprietes(acces.accessToken)
  const propriete = proprietes.ok ? choisirPropriete(site.origin, proprietes.proprietes) : null
  if (propriete === null) return vide

  /*
   * Deux lectures : le classement vient de la première, la langue de la seconde. Le
   * croisement requête/page couvre moins de requêtes à nombre de lignes égal — il sert donc
   * de table d'appoint, et une requête absente n'a simplement pas de langue connue.
   */
  const [lignes, croisees] = await Promise.all([
    requetes(acces.accessToken, propriete, 'query', JOURS_CALENDRIER),
    requetesEtPages(acces.accessToken, propriete, JOURS_CALENDRIER),
  ])
  if (!lignes.ok) return vide

  const pages = new Map<string, string>()
  if (croisees.ok) {
    for (const ligne of croisees.lignes) {
      if (!pages.has(ligne.cle)) pages.set(ligne.cle, ligne.page)
    }
  }

  const plan = planifier(lignes.lignes, dejaEcrits, { ...options, pages })
  return {
    site: { id: site.id, host: site.host },
    propriete,
    jours: JOURS_CALENDRIER,
    creneaux: plan.creneaux,
    dejaEcrits: plan.ecartes,
  }
}
