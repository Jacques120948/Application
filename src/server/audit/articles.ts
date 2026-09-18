import { notFound, validation } from '@/lib/errors'
import { writeArticle, type ConstatPourArticle, type PageDuSite } from '@/server/ai/operations'
import { actionCost } from '@/server/billing/action-costs'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { SEUILS_REDACTION } from './checks/geo'
import type { Signaux } from './extract'
import { findCheck } from './scoring'

/**
 * Les articles rédigés par l'équipe.
 *
 * C'est la plus grosse opération du produit, et quatre décisions la tiennent.
 *
 * **Un article est écrit pour passer les contrôles qu'Evoliia mesure.** Les seuils viennent
 * du module qui les applique, jamais d'une recopie. Un produit qui vend un texte et le note
 * mal ensuite se contredit devant son client, et c'est la contradiction la plus chère qu'il
 * puisse s'offrir.
 *
 * **Une seule action payée.** Pas de « proposition de sujets » facturée avant la rédaction :
 * le sujet se choisit dans le même appel, et l'article dit pourquoi ce sujet. Deux appels
 * auraient voulu dire deux prix, donc une grille tarifaire modifiée — ce qui ne se fait pas
 * sans décision de l'exploitant.
 *
 * **Le sujet ne double aucune page.** On donne au rédacteur ce que le site couvre déjà,
 * précisément pour ça : un article qui refait une page existante crée le défaut de contenu
 * dupliqué que l'analyse reprochera à la prochaine.
 *
 * **Evoliia n'a aucune donnée de recherche.** Elle mesure le site, pas la demande : ni
 * volume, ni position, ni requête. Le sujet est donc fondé sur les manques du site, et
 * l'écran le dit dans ces termes. Appeler ça de la recherche de mots-clés serait une
 * promesse que rien ne soutient.
 */

/** Ce qu'on donne du site au rédacteur : assez pour ne pas se répéter, pas plus. */
const PAGES_DONNEES = 24

/** Ce qu'on garde de l'introduction de chaque page. Une page entière n'apprendrait rien de plus. */
const INTRO_MAX = 200

/** Ce que la personne peut demander comme sujet. Au-delà, ce n'est plus un sujet. */
const DEMANDE_MAX = 400

/**
 * Les constats qu'un article peut réellement combler.
 *
 * La liste est courte et c'est voulu. Un article ne répare pas un titre trop long ni une
 * image sans texte de remplacement : proposer d'en écrire un pour ça ferait dépenser quinze
 * crédits contre un défaut qui serait toujours là ensuite. Ce qu'un article comble, c'est
 * l'absence de contenu de fond — des pages trop minces, aucune question traitée, aucun fait
 * avancé, rien qu'un assistant puisse reprendre.
 */
const COMBLES_PAR_UN_ARTICLE: readonly string[] = [
  'seo.thin_content',
  'geo.not_quotable',
  'geo.no_questions',
  'geo.no_definitions',
  'geo.no_figures',
  'geo.faq_not_declared',
  'geo.wall_of_text',
  'geo.long_paragraphs',
]

export type ManqueDeContenu = {
  checkId: string
  label: string
  why: string
  affected: number
}

export type ArticleResume = {
  id: string
  sujet: string
  titre: string
  wordCount: number
  creditsSpent: number
  createdAt: Date
}

export type ArticleComplet = ArticleResume & {
  demande: string
  fondement: string
  checkIds: string[]
  chapo: string
  corps: string
  questions: { question: string; reponse: string }[]
  metaTitle: string
  metaDescription: string
}

/**
 * Ce que coûterait un article, annoncé avant de le lancer.
 *
 * La fourchette vient du catalogue administrable, jamais du code : un exploitant qui change
 * ses prix ne doit pas attendre un déploiement. Le débit réel, lui, suivra les jetons.
 */
export async function estimerArticle(): Promise<{ min: number; max: number } | null> {
  const cout = await actionCost('article')
  return cout === null ? null : { min: cout.min, max: cout.max }
}

/**
 * Les manques de contenu relevés par la dernière analyse.
 *
 * Gratuit : c'est du comptage déjà fait par le moteur de notation. Rien n'est calculé ici,
 * et surtout rien n'est demandé à un modèle.
 */
export async function listManquesDeContenu(
  userId: string,
  siteId: string,
): Promise<ManqueDeContenu[]> {
  const audit = await dernierAudit(userId, siteId)
  if (audit === null) return []

  const constats = await withUserScope(userId, (tx) =>
    tx.auditFinding.findMany({
      where: { auditId: audit.id, checkId: { in: [...COMBLES_PAR_UN_ARTICLE] }, audit: { userId } },
      select: { checkId: true, affected: true },
    }),
  )

  const manques: ManqueDeContenu[] = []
  for (const constat of constats) {
    if (constat.affected === 0) continue
    const check = findCheck(constat.checkId)
    if (check === undefined) continue
    manques.push({
      checkId: constat.checkId,
      label: check.label,
      why: check.why,
      affected: constat.affected,
    })
  }
  return manques.sort((a, b) => b.affected - a.affected)
}

/** Les articles déjà rédigés pour un site. Gratuits à relire, autant de fois qu'on veut. */
export async function listArticles(userId: string, siteId: string): Promise<ArticleResume[]> {
  return withUserScope(userId, (tx) =>
    tx.siteArticle.findMany({
      where: { siteId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sujet: true,
        titre: true,
        wordCount: true,
        creditsSpent: true,
        createdAt: true,
      },
    }),
  )
}

/** Un article en entier. */
export async function readArticle(userId: string, articleId: string): Promise<ArticleComplet> {
  const article = await withUserScope(userId, (tx) =>
    tx.siteArticle.findFirst({ where: { id: articleId, userId } }),
  )
  if (article === null) throw notFound('Cet article est introuvable.')

  return {
    id: article.id,
    sujet: article.sujet,
    demande: article.demande,
    fondement: article.fondement,
    checkIds: article.checkIds,
    titre: article.titre,
    chapo: article.chapo,
    corps: article.corps,
    questions: lireQuestions(article.questions),
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    wordCount: article.wordCount,
    creditsSpent: article.creditsSpent,
    createdAt: article.createdAt,
  }
}

/** Retire un article. Ce qui a été payé se jette quand on le décide, pas avant. */
export async function supprimerArticle(userId: string, articleId: string): Promise<void> {
  const efface = await withUserScope(userId, (tx) =>
    tx.siteArticle.deleteMany({ where: { id: articleId, userId } }),
  )
  if (efface.count === 0) throw notFound('Cet article est introuvable.')
}

/**
 * Fait rédiger un article, et l'enregistre.
 *
 * L'ordre des gestes n'est pas négociable : on vérifie ce qu'on possède, on rassemble les
 * faits, **puis** on appelle le modèle — qui réserve les crédits avant son premier octet et
 * ne débite qu'après avoir rendu quelque chose. Un appel lancé sur un site qu'on ne possède
 * pas serait payé pour rien, et un article coûte quinze à trente crédits.
 */
export async function redigerArticle(
  userId: string,
  siteId: string,
  demande: string,
  locale: string,
): Promise<ArticleComplet> {
  const voulu = demande.trim().slice(0, DEMANDE_MAX)

  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { id: true, host: true, about: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const audit = await dernierAudit(userId, siteId)
  if (audit === null) {
    throw validation("Analysez d’abord ce site : l’article se fonde sur ce que l’analyse a relevé.")
  }

  /*
   * Les pages déjà en ligne servent à deux choses, et les deux comptent : ne pas refaire un
   * sujet couvert, et écrire dans le registre du site plutôt que dans celui du modèle. On
   * prend les plus proches de l'accueil, qui sont celles qui disent ce que fait la maison.
   */
  const pages = await withUserScope(userId, (tx) =>
    tx.auditPage.findMany({
      where: { auditId: audit.id },
      orderBy: [{ depth: 'asc' }, { path: 'asc' }],
      take: PAGES_DONNEES,
      select: { path: true, title: true, signals: true },
    }),
  )

  const duSite: PageDuSite[] = pages.map((page) => {
    const signaux = page.signals as unknown as Signaux | null
    return {
      path: page.path,
      title: page.title,
      intro: (signaux?.intro ?? '').slice(0, INTRO_MAX),
    }
  })

  const manques = await listManquesDeContenu(userId, siteId)
  const constats: ConstatPourArticle[] = manques.map((manque) => ({
    label: manque.label,
    why: manque.why,
    affected: manque.affected,
  }))

  if (voulu === '' && constats.length === 0) {
    throw validation(
      'Votre dernière analyse ne relève aucun manque de contenu : dites sur quoi vous voulez un article.',
    )
  }

  const resultat = await writeArticle({
    userId,
    demande: voulu,
    about: site.about,
    host: site.host,
    pages: duSite,
    constats,
    seuils: SEUILS_REDACTION,
    locale,
  })

  const article = resultat.value
  const corps = article.sections
    .map((section) => `## ${section.titre}\n\n${section.corps.trim()}`)
    .join('\n\n')
  const wordCount = compterMots([article.chapo, corps].join(' '))

  const enregistre = await withUserScope(userId, (tx) =>
    tx.siteArticle.create({
      data: {
        siteId,
        userId,
        sujet: article.sujet,
        demande: voulu,
        fondement: article.fondement,
        checkIds: manques.map((manque) => manque.checkId),
        titre: article.titre,
        chapo: article.chapo,
        corps,
        questions: article.questions as unknown as object,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
        wordCount,
        creditsSpent: resultat.creditsSpent,
      },
      select: { id: true },
    }),
  )

  logger.info('article rédigé', {
    siteId,
    mots: wordCount,
    sections: article.sections.length,
    credits: resultat.creditsSpent,
  })

  return readArticle(userId, enregistre.id)
}

/** La dernière analyse terminée d'un site, ou `null`. */
async function dernierAudit(userId: string, siteId: string): Promise<{ id: string } | null> {
  return withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    }),
  )
}

/**
 * Les questions telles qu'elles ont été enregistrées.
 *
 * Défensif parce que la colonne est du JSON : un article écrit par une version précédente,
 * ou une ligne abîmée, ne doit pas faire tomber l'écran qui l'affiche.
 */
function lireQuestions(brut: unknown): { question: string; reponse: string }[] {
  if (!Array.isArray(brut)) return []
  const retenues: { question: string; reponse: string }[] = []
  for (const entree of brut) {
    if (typeof entree !== 'object' || entree === null) continue
    const ligne = entree as { question?: unknown; reponse?: unknown }
    if (typeof ligne.question !== 'string' || typeof ligne.reponse !== 'string') continue
    retenues.push({ question: ligne.question, reponse: ligne.reponse })
  }
  return retenues
}

/** Compte les mots comme le fait le moteur d'analyse, pour que les deux chiffres s'accordent. */
function compterMots(texte: string): number {
  const mots = texte.trim().split(/\s+/u).filter((mot) => mot !== '')
  return mots.length
}
