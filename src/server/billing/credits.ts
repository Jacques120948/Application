import type { CreditMovement, Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { creditsFor, loadPricing } from './ai-pricing'
import { DEFAULT_PLANS, FREE_PLAN_ID, getEffectivePlan } from './plans'

/**
 * Crédits IA.
 *
 * Seules les opérations coûteuses consomment des crédits (exigence 35) : génération,
 * modification assistée, diagnostic, textes marketing. Naviguer, publier, restaurer une
 * version ou saisir des données ne coûte rien.
 *
 * `CreditWallet.balance` est un cache ; la vérité est la somme de `CreditLedger`.
 */

/**
 * Opérations réellement implémentées. Le diagnostic automatique et la génération de
 * textes marketing arrivent en phase 4 : ils ne sont pas déclarés ici tant qu'ils
 * n'existent pas.
 */
export type CreditedOperation =
  | 'ideas'
  | 'validate'
  | 'specsheet'
  | 'blueprint'
  | 'generate'
  | 'edit'
  /** Réponse de l'assistant intégré à une application, payée par son créateur. */
  | 'assistant'
  /** Réponse du coach qui accompagne le créateur dans Evoliia. */
  | 'coach'
  /** Kit de lancement marketing, produit par le moteur social. */
  | 'launchKit'
  /** Une semaine réécrite, déclinée ou adaptée à un autre réseau. */
  | 'contentVariation'
  /** Un mois de publications, plutôt qu'une semaine. */
  | 'monthlyPlan'
  /** Une question posée à l'un des trois spécialistes marketing. */
  | 'specialist'
  /** Une recherche du Radar : cinq opportunités structurées et expliquées. */
  | 'radar'
  /** La synthèse d'une comparaison entre deux ou trois opportunités. */
  | 'radarCompare'
  /** Une réponse de Lia à un visiteur, payée par le créateur de l'application. */
  | 'liaAnswer'
  /** Une FAQ proposée depuis l'application, à relire avant publication. */
  | 'liaFaq'
  /** Analyse par lot des conversations : ce que les clients demandent (V2). */
  | 'liaInsights'
  /** Une image créée par l'IA sur le compte d'Evoliia, refacturée à son créateur. */
  | 'image'
  /**
   * Des corrections rédigées pour un constat d'audit : titres, descriptions, introductions.
   *
   * C'est la première dépense réelle du produit de visibilité, et la seule. Explorer un
   * site, appliquer les contrôles et calculer les deux notes est du calcul : rien n'est
   * appelé, rien n'est facturé. Les crédits ne partent que lorsqu'un modèle écrit.
   */
  | 'visibilityFix'
  /** Une question posée à l'un des quatre spécialistes de la visibilité. */
  | 'visibilityAsk'
  /**
   * Des titres et des descriptions proposés pour une annonce.
   *
   * Un appel court et un seul, par contenant. Il existe parce que remplir quinze titres de
   * trente caractères est exactement le travail qu'une commerçante ne fera jamais — et
   * parce que la matière est déjà là : ce que les gens tapent, ce que la boutique vend, et
   * les titres qui existent déjà, dont il faut ne pas être le doublon.
   */
  | 'adsElements'
  | 'visibilityArticle'
  /**
   * Des questions proposées à partir des recherches réelles et du catalogue.
   *
   * Un appel court, et un seul. Il existe parce qu'inventer vingt questions qu'un client
   * poserait à une IA est exactement ce que la personne ne sait pas faire — et parce que
   * les matériaux de ces questions sont déjà là : ce que les gens tapent réellement, et ce
   * que la boutique vend. Rien n'est enregistré : elle choisit, puis ajoute.
   */
  | 'visibilityQuestions'
  /**
   * Le point hebdomadaire : où en est ce site, et par quoi continuer.
   *
   * Un appel par semaine et par site, sur tout ce qui est mesuré. C'est la seule opération
   * du produit qui regarde l'ensemble plutôt qu'un écran ; son coût est celui d'un long
   * contexte lu, pas d'une longue réponse écrite.
   */
  | 'visibilityPoint'
  /**
   * Le résumé d'Oria : ce qu'elle voit aujourd'hui, ou ce qu'a donné la semaine.
   *
   * Un appel court sur des faits déjà comptés et déjà classés. Le modèle n'y décide rien —
   * l'ordre et les chiffres lui arrivent faits — il met en cinq phrases ce que le cockpit
   * montre en blocs. C'est la seule opération d'Oria qui coûte : le reste est de la lecture.
   */
  | 'oriaResume'

/** Coût plancher d'une opération, débité même si l'appel a consommé peu de jetons. */
export const MINIMUM_COST: Record<CreditedOperation, number> = {
  ideas: 3,
  validate: 5,
  specsheet: 5,
  blueprint: 2,
  generate: 20,
  edit: 2,
  assistant: 1,
  coach: 1,
  /*
   * Plancher seulement. Le coût réel observé sur un premier kit complet est de 11 crédits,
   * soit environ 0,055 USD : la sortie fait près de 5 000 jetons, le double de ce qui
   * avait été estimé avant mesure. Le plancher reste bas pour ne pas surfacturer un kit
   * court ; c'est LAUNCH_KIT_ESTIMATED_CREDITS qui est annoncé au créateur.
   */
  launchKit: 5,
  /*
   * Une variation reprend une publication existante et la réécrit : l'entrée est courte,
   * la sortie aussi. Le plancher est celui d'une opération cadrée par le schéma.
   */
  contentVariation: 2,
  /*
   * Un mois est environ quatre fois une semaine. Le kit complet coûte 11 crédits mesurés,
   * dont la semaine n'est qu'une part : le plancher est posé à 12 et le coût réel, comme
   * partout, est celui des jetons effectivement consommés.
   */
  monthlyPlan: 12,
  /*
   * Une question à un spécialiste. Le contexte est un extrait de faits, la réponse fait six
   * phrases : c'est plus qu'une réponse de coach, moins qu'une génération.
   */
  specialist: 2,
  /*
   * Le Radar produit cinq opportunités structurées avec leurs raisons : c'est le même
   * ordre de grandeur qu'une recherche d'idées, dont il est l'héritier.
   */
  radar: 3,
  radarCompare: 2,
  /*
   * Une réponse de Lia est courte et fondée sur une entrée retrouvée : le plancher est
   * celui de l'assistant qu'elle prolonge. Le vrai garde-fou est le quota mensuel de
   * l'offre, pas ce plancher.
   */
  liaAnswer: 1,
  liaFaq: 3,
  liaInsights: 3,
  /*
   * Une image a un prix ferme chez le fournisseur : il n'y a pas de « petit appel » à
   * protéger d'un plancher trop haut, ni de gros à laisser filer. Le plancher vaut donc
   * un, et c'est le coût réel — lu dans le tarif réglable — qui décide.
   */
  image: 1,
  /*
   * Une correction porte sur quelques pages à la fois et rend, pour chacune, une ou deux
   * phrases. C'est l'ordre de grandeur d'une variation de contenu : le plancher est le même,
   * et c'est le coût réel des jetons qui décide au-delà.
   */
  visibilityFix: 2,
  /*
   * Une question à un spécialiste : le contexte est un extrait de faits mesurés, la réponse
   * fait six phrases. Même ordre de grandeur qu'un spécialiste marketing, dont elle reprend
   * la forme.
   */
  visibilityAsk: 2,
  /*
   * Un article est la plus grosse opération du produit, et la grille annonce quinze à trente
   * crédits. Le plancher n'a pas à refaire ce calcul : il empêche seulement qu'un article
   * rendu court soit facturé comme une phrase. Le coût réel des jetons décide au-delà.
   */
  visibilityArticle: 8,
  visibilityQuestions: 1,
  /*
   * Deux crédits, comme une question posée à un spécialiste : c'est un appel court sur le
   * modèle rapide. Assez peu pour qu'on relance en changeant d'angle — c'est ainsi qu'on
   * trouve le bon titre, pas du premier coup — et assez pour qu'une boucle accidentelle se
   * voie sur le compteur.
   */
  adsElements: 2,
  visibilityPoint: 3,
  oriaResume: 2,
}

/**
 * Crédits dus pour un coût observé.
 *
 * L'unité de conversion et la marge ne sont plus écrites ici : elles se règlent depuis
 * l'administration (voir `ai-pricing.ts`), avec pour valeurs de départ exactement celles
 * qui s'appliquaient auparavant. Le plancher de l'opération, lui, reste dans le code :
 * il dit ce qu'une opération coûte au minimum à Evoliia, ce qui est une donnée technique
 * et non un choix commercial.
 */
export async function creditsForCost(
  operation: CreditedOperation,
  costMicros: number,
): Promise<number> {
  return creditsFor(costMicros, MINIMUM_COST[operation], await loadPricing())
}

function nextResetDate(from: Date): Date {
  const next = new Date(from)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

/**
 * L'arithmétique du portefeuille, à part pour être éprouvée sans base de données.
 *
 * Le solde est le total disponible ; `purchased` en est la part achetée, qui n'expire pas.
 * La dotation mensuelle se consomme en premier — c'est elle qui disparaît au
 * renouvellement — et le renouvellement ne touche qu'à elle. Ainsi un crédit payé n'est
 * jamais effacé par le calendrier, et un crédit offert n'est jamais gardé au-delà de son
 * mois.
 */
export type Portefeuille = { balance: number; purchased: number }

/** La part mensuelle du solde : ce qui reste de la dotation, hors achats. */
export function partMensuelle(portefeuille: Portefeuille): number {
  return Math.max(0, portefeuille.balance - portefeuille.purchased)
}

/** Le mois recommence : la dotation repart à neuf, les achats restent. */
export function renouveler(portefeuille: Portefeuille, dotation: number): Portefeuille {
  const purchased = Math.min(portefeuille.purchased, portefeuille.balance)
  return { balance: dotation + purchased, purchased }
}

/**
 * Changement d'offre vers le haut : la part mensuelle monte à la nouvelle dotation sans
 * jamais redescendre, et les achats restent.
 */
export function surclasser(portefeuille: Portefeuille, dotation: number): Portefeuille {
  const purchased = Math.min(portefeuille.purchased, portefeuille.balance)
  return { balance: Math.max(partMensuelle(portefeuille), dotation) + purchased, purchased }
}

/** Un débit : la dotation d'abord, les achats ensuite. Jamais sous zéro. */
export function debiter(portefeuille: Portefeuille, montant: number): Portefeuille & { debite: number } {
  const debite = Math.min(Math.max(0, montant), portefeuille.balance)
  const balance = portefeuille.balance - debite
  return { balance, purchased: Math.min(portefeuille.purchased, balance), debite }
}

/** Une recharge achetée : elle s'ajoute au solde et à la part qui n'expire pas. */
export function crediterAchat(portefeuille: Portefeuille, credits: number): Portefeuille {
  return { balance: portefeuille.balance + credits, purchased: portefeuille.purchased + credits }
}

/**
 * Un remboursement : on reprend les crédits achetés qui restent, jamais plus. Ceux qui ont
 * déjà servi ont été consommés ; reprendre sur la dotation mensuelle ferait payer un
 * remboursement avec des crédits offerts.
 */
export function reprendreAchat(portefeuille: Portefeuille, credits: number): Portefeuille & { repris: number } {
  const repris = Math.min(credits, portefeuille.purchased, portefeuille.balance)
  return { balance: portefeuille.balance - repris, purchased: portefeuille.purchased - repris, repris }
}

export async function grantInitialCredits(userId: string): Promise<void> {
  const monthly = DEFAULT_PLANS.find((plan) => plan.id === FREE_PLAN_ID)?.monthlyCredits ?? 0
  const now = new Date()
  await prisma.$transaction([
    prisma.creditWallet.create({
      data: { userId, balance: monthly, monthlyGrant: monthly, resetsAt: nextResetDate(now) },
    }),
    prisma.creditLedger.create({
      data: {
        userId,
        delta: monthly,
        balanceAfter: monthly,
        reason: 'grant:inscription',
        type: 'SUBSCRIPTION_CREDIT',
      },
    }),
  ])
}

/**
 * Renvoie le portefeuille à jour, en appliquant le renouvellement mensuel si la date est
 * dépassée. Le renouvellement remet la dotation du plan à neuf : les crédits mensuels ne
 * se cumulent pas d'un mois sur l'autre, ce qui est indiqué dans l'interface. Les crédits
 * achetés, eux, restent.
 */
/**
 * Lit le portefeuille en le verrouillant jusqu'à la fin de la transaction.
 *
 * Toute écriture sur un solde passe par là. Sans verrou, deux écritures simultanées lisent
 * le même solde et la seconde écrase la première : une dépense qui tombe pendant qu'une
 * recharge est versée effacerait des crédits payés. Le verrou fait attendre l'une que
 * l'autre ait fini, et chacune repart du solde réel.
 */
export async function portefeuilleVerrouille(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT 1 FROM "CreditWallet" WHERE "userId" = ${userId}::uuid FOR UPDATE`
  return tx.creditWallet.findUniqueOrThrow({ where: { userId } })
}

export async function getWallet(userId: string) {
  let wallet = await prisma.creditWallet.findUnique({ where: { userId } })
  if (!wallet) {
    await grantInitialCredits(userId)
    wallet = await prisma.creditWallet.findUniqueOrThrow({ where: { userId } })
  }

  const plan = await getEffectivePlan(userId)
  const aJour = (w: typeof wallet, now: Date) =>
    w.resetsAt > now && w.monthlyGrant === plan.monthlyCredits

  // Le cas courant : rien à renouveler, aucune écriture, aucun verrou.
  if (aJour(wallet, new Date())) return wallet

  return prisma.$transaction(async (tx) => {
    // Relu sous verrou : une autre requête a pu renouveler, ou une recharge être versée, entre-temps.
    const courant = await portefeuilleVerrouille(tx, userId)
    const now = new Date()
    if (aJour(courant, now)) return courant

    const renew = courant.resetsAt <= now
    // Un changement d'offre vers le haut donne accès aux crédits immédiatement : faire
    // attendre le renouvellement mensuel après un paiement serait incompréhensible.
    const upgrade = !renew && plan.monthlyCredits > courant.monthlyGrant
    /*
     * Le renouvellement remet la dotation à neuf ; la part achetée, elle, reste. Il la
     * remettait à zéro avec le reste tant que rien ne s'achetait à part — et le jour où
     * les recharges ont existé, il aurait effacé chaque mois des crédits payés.
     */
    const suivant = renew
      ? renouveler(courant, plan.monthlyCredits)
      : upgrade
        ? surclasser(courant, plan.monthlyCredits)
        : { balance: courant.balance, purchased: courant.purchased }
    const balance = suivant.balance
    const previousBalance = courant.balance

    const misAJour = await tx.creditWallet.update({
      where: { userId },
      data: {
        balance,
        purchased: suivant.purchased,
        monthlyGrant: plan.monthlyCredits,
        resetsAt: renew ? nextResetDate(now) : courant.resetsAt,
      },
    })

    if (balance !== previousBalance) {
      await tx.creditLedger.create({
        data: {
          userId,
          delta: balance - previousBalance,
          balanceAfter: balance,
          reason: renew ? `grant:mensuel:${plan.id}` : `grant:offre:${plan.id}`,
          type: 'SUBSCRIPTION_CREDIT',
        },
      })
    }
    return misAJour
  })
}

/**
 * Vérifie le solde AVANT tout appel réseau facturé.
 *
 * Regarde le disponible et non le solde brut : une opération déjà en cours a mis ses
 * crédits de côté, et les compter deux fois autoriserait un dépassement.
 */
export async function ensureCredits(userId: string, operation: CreditedOperation): Promise<void> {
  const balance = await availableCredits(userId)
  if (balance < MINIMUM_COST[operation]) {
    throw new AppError(
      'INSUFFICIENT_CREDITS',
      "Vous n'avez plus assez de crédits pour cette opération. Vos crédits se renouvellent chaque mois.",
      { details: { balance, required: MINIMUM_COST[operation] } },
    )
  }
}

/**
 * Débite après coup, sur la base du coût réellement observé.
 * Le solde ne descend jamais sous zéro : un dépassement est journalisé, pas facturé.
 */
/**
 * Type d'un mouvement, déduit de son motif.
 *
 * Les motifs suivent une convention stable depuis l'origine (`ia:`, `grant:`), et
 * l'historique déjà écrit a été reclassé par la migration selon la même règle. La déduire
 * plutôt que l'exiger à chaque appel évite qu'un oubli à un seul endroit reclasse un
 * débit d'IA en correction manuelle.
 */
export function movementFor(reason: string): CreditMovement {
  if (reason.startsWith('ia:')) return 'AI_USAGE'
  if (reason.startsWith('grant:')) return 'SUBSCRIPTION_CREDIT'
  if (reason.startsWith('achat:')) return 'CREDIT_PURCHASE'
  if (reason.startsWith('remboursement:')) return 'REFUND'
  return 'ADJUSTMENT'
}

export type SpendDetails = {
  /** L'appel au modèle qui a provoqué ce débit, quand il y en a un. */
  aiUsageId?: string | undefined
  type?: CreditMovement | undefined
}

export async function spendCredits(
  userId: string,
  amount: number,
  reason: string,
  projectId?: string,
  details: SpendDetails = {},
): Promise<number> {
  if (amount <= 0) return (await getWallet(userId)).balance

  return prisma.$transaction(async (tx) => {
    const wallet = await portefeuilleVerrouille(tx, userId)
    const apres = debiter(wallet, amount)
    const spent = apres.debite
    if (spent < amount) {
      logger.warn('débit de crédits plafonné au solde disponible', { userId, amount, spent })
    }
    const balanceAfter = apres.balance
    await tx.creditWallet.update({
      where: { userId },
      data: { balance: balanceAfter, purchased: apres.purchased },
    })
    await tx.creditLedger.create({
      data: {
        userId,
        delta: -spent,
        balanceAfter,
        reason,
        type: details.type ?? movementFor(reason),
        projectId: projectId ?? null,
        aiUsageId: details.aiUsageId ?? null,
      },
    })
    return balanceAfter
  })
}

/**
 * Le solde disponible : le solde, moins ce que les opérations en cours ont mis de côté.
 *
 * C'est ce nombre qu'il faut regarder avant d'autoriser une opération. Le solde brut ment
 * dès que deux opérations tournent en même temps : chacune y lirait la totalité.
 */
export async function availableCredits(userId: string): Promise<number> {
  const wallet = await getWallet(userId)
  const held = await prisma.creditReservation.aggregate({
    where: { userId, releasedAt: null, expiresAt: { gt: new Date() } },
    _sum: { amount: true },
  })
  return Math.max(0, wallet.balance - (held._sum.amount ?? 0))
}
