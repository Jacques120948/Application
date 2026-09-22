import { notFound } from '@/lib/errors'
import { langueDuChemin } from '@/lib/langue-chemin'
import { withUserScope } from '@/server/db/scope'
import { motsUtiles, raretes, recouvrement, SEUIL_PROCHE } from '@/lib/sujets-proches'
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

// Réexportée : elle vivait ici, et deux modules l'importent déjà sous ce nom.
export { langueDuChemin }

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

/*
 * Ce qu'il faut de mots en commun pour considérer qu'un article couvre déjà le sujet, et
 * la façon de les compter, sont partagés avec l'écran de Milo : les deux répondent à la
 * même question — « a-t-on déjà écrit là-dessus ? » — et deux calculs séparés donneraient
 * un calendrier qui écarte un sujet pendant que l'écran voisin le propose sans un mot.
 */

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
  /**
   * Le jour prévu pour cet article.
   *
   * Les créneaux d'une même période sont étalés sur ses jours plutôt que posés tous au
   * lundi : trois articles par semaine empilés sur la même case rendaient le calendrier
   * illisible, et surtout faux — personne n'écrit trois articles le même lundi. Un par
   * semaine tombe le lundi, deux le lundi et le vendredi, trois le lundi, le mercredi et
   * le samedi.
   */
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

/**
 * Un article déjà écrit, tel que le calendrier le montre.
 *
 * Le plan ne regardait que devant, et c'était un demi-calendrier : quelqu'un qui demande
 * « ce qui est planifié » veut aussi savoir ce qui a été fait, ne serait-ce que pour juger
 * si le rythme qu'il s'est donné tient. Sans le passé, l'écran répétait chaque semaine des
 * propositions sans jamais rien porter au crédit de personne.
 */
export type ArticleEcrit = {
  id: string
  titre: string
  date: Date
  mots: number
  /** Déposé en brouillon dans la boutique. Jamais publié par Evoliia. */
  depose: boolean
}

/**
 * Ce que la personne a laissé tourner seul pour la rédaction.
 *
 * `null` quand rien n'est réglé pour ce site. Montré sur le calendrier parce que c'est le
 * seul endroit où la question se pose vraiment : un plan de huit semaines ne veut pas dire
 * la même chose selon que Milo l'écrira tout seul ou qu'il attend qu'on le lui demande.
 */
export type RythmeAutomatique = {
  active: boolean
  parPeriode: number
  periode: string
  /** Dernière rédaction automatique, ou `null` s'il n'y en a jamais eu. */
  dernier: Date | null
}

export type VueCalendrier = {
  site: { id: string; host: string }
  propriete: string | null
  jours: number
  creneaux: Creneau[]
  /** Sujets écartés parce qu'un article les couvre déjà. */
  dejaEcrits: number
  /** Les derniers articles écrits, du plus récent au plus ancien. */
  ecrits: ArticleEcrit[]
  redaction: RythmeAutomatique | null
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
  if (motsUtiles(requete).length === 0) return false
  // Pondéré par la rareté des mots dans ce que la personne a déjà écrit : « vertus » ne
  // distingue rien sur un blog de pierres, « labradorite » distingue tout.
  const rarete = raretes(titres)
  return titres.some((titre) => recouvrement(requete, titre, rarete) >= SEUIL_PROCHE)
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
 * Le décalage, en jours, du n-ième article d'une période.
 *
 * Les articles d'une même période étaient tous datés de son premier jour. Sur une liste
 * cela se voyait à peine ; sur une grille, trois articles s'empilaient dans la case du
 * lundi et les six autres jours restaient vides — un calendrier qui dit le contraire de ce
 * qu'on en attend. La division répartit : trois par semaine tombent le lundi, le mercredi
 * et le samedi, deux par mois le premier jour et deux semaines plus tard.
 */
export function decalageDansLaPeriode(rang: number, parPeriode: number, joursPeriode: number): number {
  if (parPeriode <= 1) return 0
  return Math.round((rang * joursPeriode) / parPeriode)
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
  const joursPeriode = semainesParPeriode * 7
  const creneaux = candidates.map((ligne, rang) => {
    const semaine = Math.floor(rang / options.parPeriode) + 1
    const proche = ligne.position < PAGE_DEUX.bas
    const page = options.pages?.get(ligne.cle)
    const debut = lundi(depuis, (semaine - 1) * semainesParPeriode + 1)
    const date = new Date(debut)
    date.setDate(
      date.getDate() +
        decalageDansLaPeriode(rang % options.parPeriode, options.parPeriode, joursPeriode),
    )
    return {
      semaine,
      langue: page === undefined ? null : langueDuChemin(page),
      date,
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

  const [articles, automatisation] = await withUserScope(userId, async (tx) => [
    await tx.siteArticle.findMany({
      where: { siteId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sujet: true,
        titre: true,
        createdAt: true,
        wordCount: true,
        shopifyId: true,
      },
    }),
    await tx.siteAutomatisation.findUnique({
      where: { siteId },
      select: { redaction: true, parPeriode: true, periode: true, redigeAt: true },
    }),
  ])
  const dejaEcrits = articles.map((article) => `${article.sujet} ${article.titre}`)

  /*
   * Le passé ne se tronque pas au hasard : douze lignes couvrent un trimestre au rythme
   * d'un article par semaine, c'est-à-dire l'horizon que le plus long des rythmes propose
   * devant. Au-delà, c'est l'écran de Milo qui garde tout.
   */
  const ecrits: ArticleEcrit[] = articles.slice(0, 12).map((article) => ({
    id: article.id,
    titre: article.titre,
    date: article.createdAt,
    mots: article.wordCount,
    depose: article.shopifyId !== null && article.shopifyId !== '',
  }))

  const redaction: RythmeAutomatique | null =
    automatisation === null
      ? null
      : {
          active: automatisation.redaction,
          parPeriode: automatisation.parPeriode,
          periode: automatisation.periode,
          dernier: automatisation.redigeAt,
        }

  /*
   * Sans Search Console il n'y a rien à proposer, mais il y a toujours quelque chose à
   * montrer : ce qui a déjà été écrit. L'écran vide renvoyait la personne à une connexion
   * manquante en taisant son propre travail.
   */
  const vide = {
    site: { id: site.id, host: site.host },
    propriete: null,
    jours: JOURS_CALENDRIER,
    creneaux: [],
    dejaEcrits: 0,
    ecrits,
    redaction,
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
    ecrits,
    redaction,
  }
}

// ─────────────────────────── La grille d'un mois ─────────────────────────────

/**
 * Une case du calendrier : un jour, et ce qui s'y trouve.
 *
 * `dansLeMois` est faux pour les jours des mois voisins qui complètent la première et la
 * dernière semaine. Ils sont affichés plutôt qu'omis : une grille à trous se lit mal, et
 * un lundi qui commence au milieu de la ligne fait chercher où l'on est.
 */
export type CaseCalendrier = {
  date: Date
  dansLeMois: boolean
  /** Les articles écrits ce jour-là. */
  ecrits: ArticleEcrit[]
  /** Les sujets prévus ce jour-là. */
  prevus: Creneau[]
}

/** Le même jour, au sens du calendrier : on compare des dates, pas des instants. */
function memeJour(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Le lundi de la semaine qui contient cette date. */
function lundiDe(date: Date): Date {
  const jour = new Date(date)
  jour.setHours(0, 0, 0, 0)
  // getDay() rend 0 pour dimanche, qui en Suisse termine la semaine et ne la commence pas.
  const recul = jour.getDay() === 0 ? 6 : jour.getDay() - 1
  jour.setDate(jour.getDate() - recul)
  return jour
}

/**
 * La grille d'un mois, semaine par semaine, du lundi au dimanche.
 *
 * Pure, et c'est ce qui permet de l'éprouver sans base ni réseau. Un calendrier est une
 * affaire de découpage et de bornes — le mois qui commence un dimanche, celui qui tient
 * sur six semaines, le changement d'heure — et aucune de ces erreurs ne se voit sur une
 * capture d'écran : on lit une grille plausible, avec un article sur la mauvaise case.
 *
 * La semaine commence le lundi parce que c'est ainsi qu'on lit une semaine ici, et parce
 * que le plan de rédaction pose son premier article ce jour-là.
 */
export function grilleDuMois(
  mois: Date,
  ecrits: readonly ArticleEcrit[],
  creneaux: readonly Creneau[],
): CaseCalendrier[][] {
  const premier = new Date(mois.getFullYear(), mois.getMonth(), 1)
  const dernier = new Date(mois.getFullYear(), mois.getMonth() + 1, 0)

  const semaines: CaseCalendrier[][] = []
  const curseur = lundiDe(premier)
  /*
   * On avance jusqu'à avoir dépassé le dernier jour du mois, puis on termine la semaine
   * en cours. Un mois qui commence un dimanche et en compte trente et un occupe six
   * lignes : compter les semaines à l'avance se trompe une fois par an, et la case perdue
   * est un article qui disparaît.
   */
  while (curseur <= dernier || curseur.getDay() !== 1) {
    const semaine: CaseCalendrier[] = []
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(curseur)
      semaine.push({
        date,
        dansLeMois: date.getMonth() === mois.getMonth(),
        ecrits: ecrits.filter((article) => memeJour(article.date, date)),
        prevus: creneaux.filter((creneau) => memeJour(creneau.date, date)),
      })
      curseur.setDate(curseur.getDate() + 1)
    }
    semaines.push(semaine)
    if (semaines.length >= 6) break
  }
  return semaines
}

/**
 * Les mois qu'il y a lieu de pouvoir ouvrir, du plus ancien au plus récent.
 *
 * Ni plus ni moins : proposer un mois vide donne une flèche qui mène à rien, et n'en
 * proposer aucun enferme dans le mois courant alors qu'un article a été écrit le mois
 * dernier. Le mois courant y figure toujours, même vide — c'est celui qu'on ouvre.
 */
export function moisDisponibles(
  ecrits: readonly ArticleEcrit[],
  creneaux: readonly Creneau[],
  maintenant: Date = new Date(),
): string[] {
  const cle = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  const tous = new Set<string>([cle(maintenant)])
  for (const article of ecrits) tous.add(cle(article.date))
  for (const creneau of creneaux) tous.add(cle(creneau.date))
  return [...tous].sort()
}
