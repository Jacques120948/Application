import type { Signaux } from '../extract'

/**
 * Ce qu'est un contrôle.
 *
 * Trois partis pris, et ils décident de tout ce que le créateur verra.
 *
 * **Un contrôle dit ce que le problème coûte, pas ce qui manque.** « Meta description
 * absente » ne veut rien dire à quelqu'un dont ce n'est pas le métier. « Google n'a rien à
 * afficher sous votre titre : il prend un bout de texte au hasard, souvent votre menu » lui
 * dit pourquoi s'en occuper. C'est la raison d'être du champ `why`, et c'est ce qui sépare
 * cet outil d'un rapport qu'on referme.
 *
 * **Un contrôle est du calcul, jamais un modèle.** Compter des H1, mesurer un titre,
 * constater une balise absente sont des opérations exactes, instantanées et gratuites. Les
 * confier à une intelligence artificielle les rendrait lentes, coûteuses et approximatives.
 * L'IA vient après, pour expliquer et pour rédiger.
 *
 * **Un contrôle peut ne pas s'appliquer.** Une page en erreur n'a pas de titre à juger ; la
 * compter comme fautive gonflerait le constat d'un problème qu'elle n'a pas. `null` dit
 * « hors sujet ici », et la page sort du dénominateur.
 */

/** La page telle qu'un contrôle la voit. */
export type PageVue = {
  url: string
  path: string
  depth: number
  statusCode: number
  bytes: number
  fetchMs: number
  redirects: number
  signals: Signaux
}

/** Ce qu'on sait du site entier, relevé à la première tranche. */
export type SiteVu = {
  origin: string
  /** Un fichier robots.txt a été trouvé et lu. */
  robotsFound: boolean
  /** Il interdit l'exploration de l'accueil. */
  robotsBlocksHome: boolean
  /** Une carte du site existe et est lisible. */
  sitemapFound: boolean
  /**
   * Les assistants que `robots.txt` écarte nommément, par nom d'usage.
   *
   * Absent des audits menés avant que ce relevé n'existe : un contrôle qui s'en sert doit
   * s'abstenir plutôt que de conclure « rien n'est bloqué » d'une information manquante.
   */
  aiBlocked?: readonly string[]
}

export type Verdict = boolean | null

export type Severity = 'critical' | 'important' | 'improvement'

export type Check = {
  /** Identifiant stable : il relie un constat d'un audit à l'autre, et au plan d'action. */
  id: string
  engine: 'seo' | 'geo'
  /** Le constat, dit comme le créateur le lira. */
  label: string
  /** Ce que ça lui coûte. Jamais la définition du terme technique. */
  why: string
  severity: Severity
  /**
   * Poids dans la note.
   *
   * Il n'a de sens que relativement aux autres : la note est la part des poids qui ne sont
   * pas perdus. Un contrôle à 10 pèse deux fois un contrôle à 5, et c'est tout ce qu'il faut
   * comprendre pour le régler.
   */
  weight: number
} & (
  | {
      /** Examiné page par page. Vrai = cette page a le problème. */
      scope: 'page'
      run: (page: PageVue, contexte: Contexte) => Verdict
    }
  | {
      /** Examiné une fois pour le site. Vrai = le site a le problème. */
      scope: 'site'
      run: (site: SiteVu, contexte: Contexte) => Verdict
    }
)

/**
 * Ce qu'un contrôle peut consulter au-delà de sa page.
 *
 * Certains constats n'existent qu'en regardant l'ensemble : un titre n'est en double que par
 * rapport aux autres, une page n'est orpheline que si rien ne pointe vers elle. Le contexte
 * est calculé une fois, avant les contrôles, plutôt que reconstruit par chacun.
 */
export type Contexte = {
  pages: readonly PageVue[]
  site: SiteVu
  /** Adresse normalisée → nombre de pages du site qui pointent vers elle. */
  entrants: Map<string, number>
  /** Titre en minuscules → nombre de pages qui le portent. */
  titres: Map<string, number>
  /** Description en minuscules → nombre de pages qui la portent. */
  descriptions: Map<string, number>
  /** Adresses relevées, pour distinguer un lien interne cassé d'un lien non exploré. */
  connues: Map<string, number>
}
