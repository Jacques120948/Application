import { validation } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'
import { notify } from '@/server/notifications/service'
import { getEffectivePlan } from '@/server/billing/plans'
import { availableCredits } from '@/server/billing/credits'
import { recentIncidents } from '@/server/agent/incidents'

/**
 * Le dernier maillon : un créateur qui écrit à l'exploitant.
 *
 * L'agent résout l'essentiel — ce qui est mal réglé dans l'application, ce qui tient au
 * compte ou à l'offre. Reste ce qu'il ne peut pas résoudre : une panne de la plateforme, un
 * écran qui ne répond pas, un comportement que rien n'explique. Jusqu'ici, ce créateur-là
 * n'avait aucun chemin. Il n'écrivait pas : il partait, et personne ne savait qu'il était
 * passé.
 *
 * Trois partis pris.
 *
 * **Le contexte est rassemblé par le serveur, pas demandé au créateur.** Personne ne sait
 * dire de tête son offre, son solde de crédits et ce qui a échoué avant-hier — et le lui
 * demander, c'est trois allers-retours avant de commencer à comprendre. Ces faits, le
 * serveur les connaît : il les joint.
 *
 * **Rien de ce que le navigateur annonce n'est cru**, sauf le texte écrit et le nom de
 * l'écran, qui sont bornés. L'identité, l'offre, les crédits et les incidents viennent de
 * la session et de la base.
 *
 * **Une notification, pas un courriel.** La cloche d'Evoliia ne coûte rien et suffit : un
 * exploitant qui ouvre son atelier voit ce qui l'attend. Ajouter l'e-mail serait une
 * dépense, donc une décision, et elle n'est pas nécessaire pour que le chemin existe.
 */

const MAX_MESSAGE = 2_000
const MIN_MESSAGE = 10

export type ReportInput = {
  userId: string
  /** L'écran d'où il écrit, tel que l'interface le nomme. Borné, jamais interprété. */
  screen: string
  message: string
  projectId?: string | undefined
}

/**
 * Les faits que l'exploitant aurait demandés, rassemblés d'avance.
 *
 * Écrits en français plutôt qu'en JSON : c'est un humain qui les lit, au moment où il
 * cherche à comprendre, et un objet technique lui coûterait une traduction de plus.
 */
async function assembleContext(userId: string): Promise<string> {
  const [plan, credits, incidents] = await Promise.all([
    getEffectivePlan(userId).catch(() => null),
    availableCredits(userId).catch(() => null),
    recentIncidents(userId).catch(() => []),
  ])

  const lignes = [
    `Offre : ${plan?.name ?? 'inconnue'}`,
    `Crédits disponibles : ${credits ?? 'inconnu'}`,
  ]
  if (incidents.length === 0) {
    lignes.push("Aucun échec enregistré pour ce compte ces deux derniers jours.")
  } else {
    lignes.push('Échecs récents :')
    for (const incident of incidents) {
      lignes.push(`  - ${incident.quoi} : ${incident.pourquoi} (${incident.quand.toISOString()})`)
    }
  }
  return lignes.join('\n')
}

export async function reportProblem(input: ReportInput): Promise<void> {
  const message = input.message.trim()
  if (message.length < MIN_MESSAGE) {
    throw validation('Décrivez en une phrase ce qui ne se passe pas comme prévu.')
  }
  if (message.length > MAX_MESSAGE) throw validation('Votre message est trop long.')

  const context = await assembleContext(input.userId)
  await prisma.creatorReport.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      screen: input.screen.slice(0, 80),
      message,
      context,
    },
  })

  // La cloche de chaque exploitant. Elle ne coûte rien, et c'est ce qui permet de ne pas
  // faire dépendre ce chemin d'une décision de dépense.
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } })
  for (const admin of admins) {
    await notify(admin.id, {
      kind: 'creator_report',
      title: 'Un créateur signale un problème',
      body: message.slice(0, 160),
      href: '/fr/administration',
    }).catch(() => undefined)
  }

  logger.info('signalement reçu', { userId: input.userId, screen: input.screen })
}

/**
 * Une demande à laquelle l'assistant n'a rien changé.
 *
 * Ne lève jamais : elle est appelée après une réponse déjà rendue au créateur, et une
 * statistique manquée ne doit pas transformer une réponse réussie en erreur.
 *
 * `explicit` distingue les deux cas, et la distinction compte à la lecture. Vrai, l'assistant
 * a dit que la demande sortait de son vocabulaire : c'est une fonction qui manque. Faux, il
 * n'a simplement rien changé — ce peut être une question, une réponse suffisante, ou un
 * échec. Les mêler ferait passer des conversations ordinaires pour des manques.
 */
export async function recordUnmetRequest(params: {
  userId: string
  projectId: string
  request: string
  reply: string
  explicit: boolean
}): Promise<void> {
  await prisma.unmetRequest
    .create({
      data: {
        userId: params.userId,
        projectId: params.projectId,
        request: params.request.slice(0, 2_000),
        reply: params.reply.slice(0, 1_000),
        explicit: params.explicit,
      },
    })
    .catch((error: unknown) => {
      logger.warn('demande sans suite non enregistrée', {
        reason: error instanceof Error ? error.name : 'inconnu',
      })
    })
}
