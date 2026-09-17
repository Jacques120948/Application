import { createHmac } from 'node:crypto'
import { prisma } from '@/server/db/client'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { logger } from '@/server/observability/logger'

/**
 * Tentatives de connexion : la limite qui tient vraiment.
 *
 * Il existait déjà un compteur en mémoire du processus. Il reste utile — il coupe une rafale
 * sans toucher la base — mais il ne peut pas être la limite : sur un hébergement sans état,
 * chaque requête peut tomber sur une instance neuve, dont le compteur est vide. Quelqu'un
 * qui essaie mille mots de passe ne verra jamais de blocage. Une limite qui ne tient que
 * dans une mémoire volatile n'est pas une limite.
 *
 * Celle-ci vit dans la base, donc elle survit aux instances, aux redémarrages et aux
 * déploiements.
 *
 * Quatre décisions.
 *
 * **On compte deux choses séparément.** L'adresse visée, et l'adresse d'où l'on vient. La
 * première protège un compte que quelqu'un s'acharne à ouvrir ; la seconde protège tous les
 * comptes de quelqu'un qui essaie un mot de passe courant sur des milliers d'adresses. Une
 * seule des deux laisse l'autre attaque entière.
 *
 * **Rien n'est stocké en clair.** Ni l'adresse e-mail, ni l'IP : seulement leur empreinte,
 * calculée avec le secret du serveur. Une copie de cette table ne dit pas qui a essayé de se
 * connecter, ni d'où. C'est la même règle que pour les jetons de session.
 *
 * **Le blocage ne dit pas si le compte existe.** Le message et la durée sont les mêmes pour
 * une adresse inscrite et pour une adresse inventée. Sinon, le blocage lui-même devient un
 * moyen de savoir qui est client.
 *
 * **Une réussite efface le compteur de l'adresse visée**, jamais celui de l'IP. Quelqu'un
 * qui ouvre un compte au hasard ne doit pas s'offrir un crédit de tentatives neuf pour le
 * compte suivant.
 */

/** Ce que l'utilisateur a demandé : cinq essais, pas un de plus. */
export const MAX_ATTEMPTS = 5

/** Fenêtre de comptage. Au-delà sans échec, l'ardoise repart de zéro. */
export const WINDOW_MS = 15 * 60_000

/** Durée du blocage une fois la limite atteinte. */
export const BLOCK_MS = 15 * 60_000

/**
 * L'IP tolère davantage que le compte.
 *
 * Plusieurs personnes partagent une même adresse — un bureau, un réseau mobile, un café. Le
 * même seuil pour les deux ferait bloquer des collègues innocents dès qu'un seul se trompe
 * cinq fois. Le compte reste à cinq, qui est ce qui protège un compte donné.
 */
export const MAX_ATTEMPTS_IP = 20

export type Scope = 'email' | 'ip'

function empreinte(scope: Scope, valeur: string): string {
  return createHmac('sha256', env.sessionSecret).update(`${scope}:${valeur.toLowerCase()}`).digest('hex')
}

function plafond(scope: Scope): number {
  return scope === 'ip' ? MAX_ATTEMPTS_IP : MAX_ATTEMPTS
}

/** Le refus, identique quelle que soit la raison. */
function bloque(jusqua: Date): AppError {
  const minutes = Math.max(1, Math.ceil((jusqua.getTime() - Date.now()) / 60_000))
  return new AppError(
    'RATE_LIMITED',
    `Trop de tentatives de connexion. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
  )
}

/**
 * Refuse si la clé est bloquée. À appeler avant de vérifier quoi que ce soit.
 *
 * Ne lève pas en cas de panne de base : une lecture impossible ne doit pas empêcher tout le
 * monde de se connecter. Le compteur en mémoire reste là pour ce cas, et l'échec est tracé.
 */
export async function assertNotBlocked(scope: Scope, valeur: string): Promise<void> {
  const keyHash = empreinte(scope, valeur)
  let ligne: { blockedUntil: Date | null } | null
  try {
    ligne = await prisma.authThrottle.findUnique({
      where: { scope_keyHash: { scope, keyHash } },
      select: { blockedUntil: true },
    })
  } catch (error) {
    logger.warn('compteur de tentatives illisible', {
      reason: error instanceof Error ? error.name : 'inconnu',
    })
    return
  }
  if (ligne?.blockedUntil != null && ligne.blockedUntil > new Date()) {
    throw bloque(ligne.blockedUntil)
  }
}

/**
 * Enregistre un échec, et bloque une fois la limite atteinte.
 *
 * Lève le refus au moment où la limite est franchie : la cinquième mauvaise tentative dit
 * déjà qu'il faudra attendre, plutôt que de laisser croire qu'une sixième est possible.
 */
export async function recordFailure(scope: Scope, valeur: string): Promise<void> {
  const keyHash = empreinte(scope, valeur)
  const maintenant = new Date()
  const limite = plafond(scope)

  try {
    const existant = await prisma.authThrottle.findUnique({
      where: { scope_keyHash: { scope, keyHash } },
    })

    // Fenêtre expirée, ou blocage terminé : on repart d'une ardoise propre.
    const fraiche =
      existant === null ||
      maintenant.getTime() - existant.windowStart.getTime() > WINDOW_MS ||
      (existant.blockedUntil !== null && existant.blockedUntil <= maintenant)

    const failures = fraiche ? 1 : existant.failures + 1
    const blockedUntil = failures >= limite ? new Date(maintenant.getTime() + BLOCK_MS) : null

    await prisma.authThrottle.upsert({
      where: { scope_keyHash: { scope, keyHash } },
      create: { scope, keyHash, failures, windowStart: maintenant, blockedUntil },
      update: {
        failures,
        blockedUntil,
        ...(fraiche ? { windowStart: maintenant } : {}),
      },
    })

    if (blockedUntil !== null) {
      // Ni l'adresse ni l'IP ne sont journalisées : seule l'existence du blocage l'est.
      logger.warn('connexion bloquée après trop de tentatives', { scope, failures })
      throw bloque(blockedUntil)
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    logger.warn('échec non compté', { reason: error instanceof Error ? error.name : 'inconnu' })
  }
}

/** Efface l'ardoise après une connexion réussie. */
export async function clearFailures(scope: Scope, valeur: string): Promise<void> {
  try {
    await prisma.authThrottle.deleteMany({ where: { scope, keyHash: empreinte(scope, valeur) } })
  } catch {
    // Un compteur qu'on n'a pas pu effacer se périmera tout seul à la fin de la fenêtre.
  }
}

/**
 * Efface les compteurs périmés.
 *
 * Sans ce ménage, la table grandit d'une ligne par adresse essayée, pour toujours. Appelé
 * au fil de l'eau plutôt que par une tâche planifiée : une ligne sur cent suffit largement
 * à tenir la table à sa taille, et cela n'ajoute ni horaire ni jeton à surveiller.
 */
export async function sweepThrottles(): Promise<void> {
  if (Math.random() > 0.01) return
  const limite = new Date(Date.now() - Math.max(WINDOW_MS, BLOCK_MS) * 2)
  await prisma.authThrottle
    .deleteMany({ where: { updatedAt: { lt: limite } } })
    .catch(() => undefined)
}
