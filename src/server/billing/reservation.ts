import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { getWallet } from './credits'

/**
 * Crédits mis de côté le temps d'une opération.
 *
 * Le problème que cela règle est concret. Jusqu'ici le solde était vérifié avant l'appel
 * et débité après. Entre les deux, une opération pouvait durer une minute, et deux
 * opérations lancées ensemble voyaient toutes les deux le même solde : chacune se croyait
 * autorisée, et le dépassement était rattrapé après coup en plafonnant le débit au solde
 * disponible. Autrement dit, Evoliia payait la différence.
 *
 * Une réservation retire les crédits du solde **disponible** avant l'appel, sans les
 * débiter. À la fin, on débite ce qui a réellement été consommé et on rend le reste.
 *
 * Trois règles.
 *
 * **Le solde disponible n'est pas le solde.** C'est le solde moins les réservations
 * vivantes. Le portefeuille n'est touché qu'au moment du vrai débit : le solde affiché ne
 * descend donc pas pendant une opération pour remonter ensuite.
 *
 * **Une réservation expire.** Un processus tué entre la réservation et le débit ne doit
 * pas geler des crédits pour toujours. Passé son échéance, une réservation ne compte plus,
 * même si personne n'est venu la libérer.
 *
 * **La pose est transactionnelle et sérialisée sur le portefeuille.** La ligne du
 * portefeuille est verrouillée le temps de vérifier le disponible et d'écrire la
 * réservation : deux opérations simultanées passent l'une après l'autre, et la seconde
 * voit la réservation de la première.
 */

/** Au-delà, une réservation est considérée comme abandonnée. Une opération dépasse rarement deux minutes. */
const RESERVATION_TTL_MS = 10 * 60_000

export type Reservation = { id: string; amount: number }

/**
 * Met de côté un plafond de crédits, ou refuse.
 *
 * `amount` est une estimation haute, pas une facture : c'est le coût maximum que
 * l'opération pourrait atteindre. Mieux vaut réserver large et rendre beaucoup que
 * réserver juste et découvrir le dépassement une fois l'argent dépensé.
 */
export async function reserveCredits(params: {
  userId: string
  operation: string
  amount: number
  projectId?: string | undefined
}): Promise<Reservation> {
  // Crée le portefeuille et applique le renouvellement mensuel s'il est dû, avant de
  // regarder le solde : sinon on refuserait une opération au motif d'un solde périmé.
  await getWallet(params.userId)
  const amount = Math.max(1, Math.ceil(params.amount))
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS)

  return prisma.$transaction(async (tx) => {
    // Verrou sur la ligne du portefeuille : tout ce qui touche au solde de cet utilisateur
    // passe par ici, donc deux opérations simultanées se sérialisent.
    const locked = await tx.$queryRaw<Array<{ balance: number }>>`
      SELECT "balance" FROM "CreditWallet" WHERE "userId" = ${params.userId}::uuid FOR UPDATE
    `
    const balance = locked[0]?.balance ?? 0

    const held = await tx.creditReservation.aggregate({
      where: { userId: params.userId, releasedAt: null, expiresAt: { gt: new Date() } },
      _sum: { amount: true },
    })
    const available = balance - (held._sum.amount ?? 0)

    if (available < amount) {
      throw new AppError(
        'INSUFFICIENT_CREDITS',
        "Vous n'avez plus assez de crédits pour cette opération. Vos crédits se renouvellent chaque mois.",
        { details: { available, required: amount } },
      )
    }

    const reservation = await tx.creditReservation.create({
      data: {
        userId: params.userId,
        operation: params.operation,
        amount,
        expiresAt,
        projectId: params.projectId ?? null,
      },
      select: { id: true, amount: true },
    })
    return reservation
  })
}

/**
 * Libère une réservation sans rien débiter.
 *
 * Appelé quand l'opération échoue : un appel qui n'a rien produit n'est pas facturé, et
 * les crédits redeviennent disponibles immédiatement plutôt qu'à l'échéance.
 */
export async function releaseReservation(id: string): Promise<void> {
  await prisma.creditReservation
    .updateMany({ where: { id, releasedAt: null }, data: { releasedAt: new Date() } })
    .catch(() => undefined)
}

/**
 * Ménage des réservations abandonnées.
 *
 * Elles ne comptent déjà plus dans le disponible une fois expirées ; les marquer libérées
 * ne change donc rien au calcul, mais évite qu'une table grossisse sans fin et qu'on
 * confonde plus tard une réservation morte avec une réservation vivante.
 */
export async function sweepExpiredReservations(): Promise<number> {
  const result = await prisma.creditReservation.updateMany({
    where: { releasedAt: null, expiresAt: { lte: new Date() } },
    data: { releasedAt: new Date() },
  })
  if (result.count > 0) logger.info('réservations de crédits expirées libérées', { count: result.count })
  return result.count
}
