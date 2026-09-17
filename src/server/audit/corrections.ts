import { AppError, notFound, validation } from '@/lib/errors'
import { writeCorrections, type PageACorriger } from '@/server/ai/operations'
import { actionCost } from '@/server/billing/action-costs'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import type { Signaux } from './extract'
import { findCheck } from './scoring'

/**
 * Les corrections rédigées, et ce qu'elles coûtent.
 *
 * C'est le seul endroit du produit de visibilité où des crédits partent, et la règle qui le
 * décide est simple : **ce qui se compte ne se paie pas.** Explorer un site, appliquer
 * trente-et-un contrôles de référencement et dix-huit de visibilité, calculer deux notes,
 * classer les priorités, tenir l'historique — tout cela est du calcul, instantané et
 * gratuit. Les crédits ne bougent que lorsqu'un modèle écrit une phrase.
 *
 * Quatre décisions portent le reste.
 *
 * **Un seul système de crédits.** Rien n'a été construit ici : la réservation, le débit sur
 * les jetons réellement consommés et la ligne d'usage sont ceux de toutes les autres
 * opérations. Un second système serait un second endroit où se tromper, et le premier
 * dépassement se paierait en factures.
 *
 * **Le prix est annoncé avant, mesuré après.** L'écran affiche une fourchette tirée du
 * catalogue administrable ; le débit, lui, suit les jetons. Personne n'est facturé sur une
 * estimation, et personne ne découvre le prix après coup.
 *
 * **Le nombre de pages traitées est borné.** Un constat qui touche deux cents pages ne doit
 * pas donner lieu à un appel de deux cents pages : ni le modèle ni la facture n'y
 * survivraient. On traite les premières, et l'écran dit combien restent.
 *
 * **Ce qui est payé est conservé.** Un texte payé qui disparaît au rechargement de la page
 * est un texte volé. Les corrections vivent en base, et relancer la rédaction remplace la
 * proposition précédente au lieu d'en empiler dix.
 */

/** Au-delà, l'appel coûte plus qu'il ne rend et la relecture devient un travail. */
const PAGES_PAR_LOT = 8

/** Ce qu'on donne au modèle de chaque page, borné : une page entière n'apporte rien de plus. */
const INTRO_MAX = 300

/**
 * Les contrôles qu'on sait corriger, et la consigne de forme propre à chacun.
 *
 * La liste est courte et c'est voulu : un bouton « corriger » sur un constat que l'IA ne
 * sait pas traiter ne rend pas service, il déçoit et il facture. Les autres constats
 * s'expliquent, ils ne se rédigent pas encore.
 */
const CORRIGEABLES: Record<string, { champ: string; consigne: string }> = {
  'seo.title_missing': {
    champ: 'title',
    consigne:
      'Écris la balise title de chaque page : entre 25 et 60 signes, elle doit dire ce que la page contient et nommer l’entreprise. Rends-la dans le champ « title ».',
  },
  'seo.title_short': {
    champ: 'title',
    consigne:
      'Le titre actuel est trop court pour dire quoi que ce soit. Réécris-le entre 25 et 60 signes, en gardant ce qu’il a de juste. Rends-le dans le champ « title ».',
  },
  'seo.title_long': {
    champ: 'title',
    consigne:
      'Le titre actuel est tronqué dans les résultats. Réécris-le sous 60 signes sans perdre l’essentiel. Rends-le dans le champ « title ».',
  },
  'seo.description_missing': {
    champ: 'description',
    consigne:
      'Écris la meta description de chaque page : entre 70 et 160 signes, une phrase qui donne envie de cliquer et qui dit ce qu’on trouvera. Rends-la dans le champ « description ».',
  },
  'seo.description_short': {
    champ: 'description',
    consigne:
      'La description actuelle est trop courte. Réécris-la entre 70 et 160 signes. Rends-la dans le champ « description ».',
  },
  'seo.description_long': {
    champ: 'description',
    consigne:
      'La description actuelle est coupée dans les résultats. Réécris-la sous 160 signes. Rends-la dans le champ « description ».',
  },
  'seo.description_duplicate': {
    champ: 'description',
    consigne:
      'Ces pages portent la même description. Écris-en une différente pour chacune, tirée de son propre contenu. Rends-les dans le champ « description ».',
  },
  'seo.title_duplicate': {
    champ: 'title',
    consigne:
      'Ces pages portent le même titre. Écris-en un différent pour chacune, entre 25 et 60 signes. Rends-les dans le champ « title ».',
  },
  'seo.h1_missing': {
    champ: 'h1',
    consigne:
      'Écris le titre principal visible de chaque page : une ligne courte qui annonce son sujet. Rends-le dans le champ « h1 ».',
  },
  'geo.no_intro': {
    champ: 'intro',
    consigne:
      'Écris le premier paragraphe de chaque page : deux ou trois phrases qui répondent directement à ce que la page traite, avec un fait concret si la page en contient un. Pas de formule d’accueil. Rends-le dans le champ « intro ».',
  },
  'geo.title_generic': {
    champ: 'h1',
    consigne:
      'Le titre visible de ces pages n’apprend rien hors du site. Réécris-le pour qu’il dise de quoi la page traite, même lu seul. Rends-le dans le champ « h1 ».',
  },
  'geo.duplicate_intro': {
    champ: 'intro',
    consigne:
      'Ces pages ouvrent sur le même paragraphe. Écris-en un différent pour chacune, tiré de son propre contenu. Rends-le dans le champ « intro ».',
  },
}

/** Vrai si l'équipe sait rédiger la correction de ce constat. */
export function estCorrigeable(checkId: string): boolean {
  return CORRIGEABLES[checkId] !== undefined
}

export type CorrectionVue = {
  path: string
  url: string
  field: string
  before: string
  after: string
}

/**
 * Ce que coûterait la rédaction, annoncé avant de la lancer.
 *
 * La fourchette vient du catalogue administrable, jamais du code : un exploitant qui change
 * ses prix ne doit pas attendre un déploiement. Le débit réel, lui, suivra les jetons.
 */
export async function estimerCorrection(): Promise<{ min: number; max: number } | null> {
  const meta = await actionCost('meta')
  return meta === null ? null : { min: meta.min, max: meta.max }
}

/** Les corrections déjà rédigées pour un constat. Gratuites à relire, autant de fois qu'on veut. */
export async function listCorrections(
  userId: string,
  siteId: string,
  checkId: string,
): Promise<CorrectionVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.auditCorrection.findMany({
      where: { siteId, userId, checkId },
      orderBy: { path: 'asc' },
      select: { path: true, url: true, field: true, before: true, after: true },
    }),
  )
  return lignes
}

/**
 * Rédige les corrections d'un constat, et les enregistre.
 *
 * L'ordre des gestes n'est pas négociable : on vérifie ce qu'on possède, on rassemble les
 * faits, **puis** on appelle le modèle — qui réserve les crédits avant son premier octet et
 * ne débite qu'après avoir rendu quelque chose. Un appel lancé sur un site qu'on ne possède
 * pas, ou sur un constat qui n'existe plus, serait payé pour rien.
 */
export async function redigerCorrections(
  userId: string,
  siteId: string,
  checkId: string,
  locale: string,
): Promise<{ corrections: CorrectionVue[]; creditsSpent: number; restantes: number }> {
  const consigne = CORRIGEABLES[checkId]
  if (consigne === undefined) {
    throw validation("L’équipe ne sait pas encore rédiger la correction de ce constat.")
  }
  const check = findCheck(checkId)
  if (check === undefined) throw validation("Ce contrôle n'existe pas.")

  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({
      where: { id: siteId, userId, deletedAt: null },
      select: { id: true, about: true },
    }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const audit = await withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true },
    }),
  )
  if (audit === null) throw notFound("Ce site n'a pas encore été analysé.")

  const constat = await withUserScope(userId, (tx) =>
    tx.auditFinding.findFirst({
      where: { auditId: audit.id, checkId, audit: { userId } },
      select: { sample: true, affected: true },
    }),
  )
  if (constat === null || constat.affected === 0) {
    throw validation('Ce constat ne figure plus dans votre dernière analyse.')
  }

  /*
   * Les exemples du constat désignent les pages à corriger. Ils sont déjà bornés à cinq par
   * le moteur de notation, ce qui tombe bien : on ne veut pas en traiter davantage d'un
   * coup, et ce sont ceux que l'écran a montrés.
   */
  const exemples = (constat.sample as unknown as { path: string; url: string }[] | null) ?? []
  const chemins = exemples.slice(0, PAGES_PAR_LOT).map((exemple) => exemple.path)
  if (chemins.length === 0) {
    throw validation("Ce constat ne désigne aucune page : il n'y a rien à rédiger.")
  }

  const pages = await withUserScope(userId, (tx) =>
    tx.auditPage.findMany({
      where: { auditId: audit.id, path: { in: chemins } },
      select: { path: true, url: true, title: true, description: true, wordCount: true, signals: true },
    }),
  )
  if (pages.length === 0) throw notFound('Les pages de ce constat sont introuvables.')

  const aCorriger: PageACorriger[] = pages.map((page) => {
    const signaux = page.signals as unknown as Signaux | null
    return {
      path: page.path,
      title: page.title,
      description: page.description,
      h1: signaux?.h1?.[0] ?? '',
      intro: (signaux?.intro ?? '').slice(0, INTRO_MAX),
      wordCount: page.wordCount,
    }
  })

  const resultat = await writeCorrections({
    userId,
    constat: check.label,
    pourquoi: check.why,
    consigne: consigne.consigne,
    about: site.about,
    pages: aCorriger,
    locale,
  })

  /*
   * Le modèle rend les chemins qu'on lui a donnés ; on ne le croit pas sur parole. Une page
   * inventée serait enregistrée sous un chemin qui n'existe pas, invisible à l'écran et
   * impossible à retirer.
   */
  const connues = new Map(pages.map((page) => [page.path, page.url]))
  const retenues = resultat.value.items.filter((item) => connues.has(item.path))

  if (retenues.length === 0) {
    logger.warn('corrections rédigées hors des pages fournies', { siteId, checkId })
    throw new AppError('AI_REFUSED', "L'équipe n'a pas pu rédiger de correction utilisable.")
  }

  await withUserScope(userId, async (tx) => {
    for (const item of retenues) {
      await tx.auditCorrection.upsert({
        where: {
          siteId_checkId_path_field: { siteId, checkId, path: item.path, field: item.field },
        },
        update: { before: item.before, after: item.after, creditsSpent: resultat.creditsSpent },
        create: {
          siteId,
          userId,
          checkId,
          path: item.path,
          url: connues.get(item.path) ?? '',
          field: item.field,
          before: item.before,
          after: item.after,
          creditsSpent: resultat.creditsSpent,
        },
      })
    }
  })

  logger.info('corrections rédigées', {
    siteId,
    checkId,
    pages: retenues.length,
    credits: resultat.creditsSpent,
  })

  return {
    corrections: await listCorrections(userId, siteId, checkId),
    creditsSpent: resultat.creditsSpent,
    restantes: Math.max(0, constat.affected - retenues.length),
  }
}
