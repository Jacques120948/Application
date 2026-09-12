import { z } from 'zod'
import { AppError, notFound, validation } from '@/lib/errors'
import { decryptSecret, encryptSecret, secretHint } from '@/lib/crypto'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { getEffectivePlan } from '@/server/billing/plans'
import { findProvider, INTEGRATION_PROVIDERS, type IntegrationProvider } from './catalog'
import { findVerifier } from './verify'

/**
 * Gestionnaire d'intégrations.
 *
 * Il ne connaît aucun fournisseur en particulier : il sait enregistrer une connexion, la
 * lire, la révoquer, et compter combien un créateur a le droit d'en avoir. Ajouter Google
 * Drive ou Dropbox demain consistera à écrire l'aller-retour OAuth du fournisseur, pas à
 * revenir ici.
 *
 * Trois règles tiennent la sécurité :
 *   1. Aucune fonction de ce module ne renvoie un secret. Le seul chemin qui déchiffre est
 *      `useCredential`, réservé au moment d'appeler le fournisseur.
 *   2. Tout passe par la portée de locataire : une connexion appartient à un créateur, et
 *      le cloisonnement est appliqué par la base, pas seulement par ce code.
 *   3. Les journaux ne reçoivent jamais qu'un identifiant de fournisseur et un type
 *      d'événement. Jamais un jeton, jamais une clé, jamais un fragment de l'un des deux.
 */

export type ConnectionView = {
  id: string
  providerId: string
  target: 'EVOLIIA' | 'APP'
  projectId: string | null
  status: 'CONNECTED' | 'EXPIRED' | 'REVOKED' | 'ERROR'
  scopes: string[]
  accountLabel: string | null
  connectedAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  lastError: string | null
  /** Indice de la clé, jamais la clé. */
  hint: string | null
}

export type CatalogueEntry = {
  provider: IntegrationProvider
  connection: ConnectionView | null
}

/*
 * Le navigateur ne choisit ni la portée ni le projet : le catalogue déclare à quoi sert
 * une connexion, et le gestionnaire l'impose. Un champ de moins envoyé depuis le client
 * est un champ de moins à ne pas se faire tordre.
 */
export const connectInput = z.object({
  providerId: z.string().trim().min(1).max(60),
  /** Secret fourni par le créateur, pour les fournisseurs sans OAuth. */
  apiKey: z.string().trim().min(8).max(400),
})

export const disconnectInput = z.object({
  connectionId: z.string().uuid(),
})

/** Liste destinée à l'écran « Connexions ». Ne touche jamais la table des secrets. */
export async function listConnections(userId: string): Promise<CatalogueEntry[]> {
  const rows = await withUserScope(userId, (tx) =>
    tx.integrationConnection.findMany({
      where: { userId, disconnectedAt: null },
      orderBy: { connectedAt: 'desc' },
      select: {
        id: true,
        providerId: true,
        target: true,
        projectId: true,
        status: true,
        scopes: true,
        accountLabel: true,
        connectedAt: true,
        lastUsedAt: true,
        expiresAt: true,
        lastError: true,
        credential: { select: { hint: true } },
      },
    }),
  )

  const byProvider = new Map<string, ConnectionView>(
    rows.map((row) => [
      row.providerId,
      {
        id: row.id,
        providerId: row.providerId,
        target: row.target,
        projectId: row.projectId,
        status: row.status,
        scopes: row.scopes,
        accountLabel: row.accountLabel,
        connectedAt: row.connectedAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        lastError: row.lastError,
        hint: row.credential?.hint ?? null,
      },
    ]),
  )

  return INTEGRATION_PROVIDERS.map((provider) => ({
    provider,
    connection: byProvider.get(provider.id) ?? null,
  }))
}

/** Connexions actives, pour la limite d'offre. */
export async function countConnections(userId: string): Promise<number> {
  return withUserScope(userId, (tx) =>
    tx.integrationConnection.count({ where: { userId, disconnectedAt: null } }),
  )
}

async function record(
  userId: string,
  providerId: string,
  type: string,
  detail?: string,
  connectionId?: string,
): Promise<void> {
  await withUserScope(userId, (tx) =>
    tx.integrationEvent.create({
      data: { userId, providerId, type, detail: detail ?? null, connectionId: connectionId ?? null },
    }),
  ).catch(() => undefined)
  logger.info('intégration', { userId, providerId, type })
}

/**
 * Enregistre une connexion par clé fournie par le créateur.
 *
 * Réservée aux fournisseurs déclarés `API_KEY` dans le catalogue : partout où OAuth existe,
 * demander une clé serait un recul de sécurité. La clé est chiffrée avant d'atteindre la
 * base, et seul son indice est conservé en clair.
 */
export async function connectWithApiKey(
  userId: string,
  input: z.infer<typeof connectInput>,
): Promise<ConnectionView> {
  const provider = findProvider(input.providerId)
  if (provider === undefined) throw notFound("Ce service n'existe pas dans le catalogue.")
  if (provider.status !== 'available') {
    throw validation("Ce service n'est pas encore connectable. Il arrive bientôt.")
  }
  if (provider.credential !== 'API_KEY') {
    throw validation(
      'Ce service se connecte par autorisation, pas par clé. Utilisez le bouton de connexion.',
    )
  }

  const plan = await getEffectivePlan(userId)
  const existing = await countConnections(userId)
  if (existing >= plan.maxConnections) {
    throw new AppError(
      'PLAN_LIMIT',
      plan.maxConnections === 0
        ? "Votre offre actuelle ne permet pas de connecter de service extérieur."
        : `Votre offre permet ${plan.maxConnections} connexion(s). Déconnectez-en une ou changez d'offre.`,
    )
  }

  /*
   * La clé est vérifiée auprès du fournisseur AVANT d'être écrite. Une clé fautive
   * rejetée tout de suite vaut mieux qu'une connexion verte qui échoue le jour où un
   * visiteur pose sa première question.
   */
  const verifier = findVerifier(provider.id)
  const verdict = verifier === undefined ? null : await verifier(input.apiKey)
  if (verdict !== null && !verdict.ok) throw validation(verdict.reason)
  const accountLabel = verdict === null ? null : verdict.label

  /*
   * Reconnecter le même service remplace l'ancienne connexion plutôt que d'en empiler une
   * seconde. La recherche est faite à la main : une clé unique portant une colonne
   * nullable ne se prête pas à un upsert.
   */
  const target = provider.connectionTarget

  const created = await withUserScope(userId, async (tx) => {
    const previous = await tx.integrationConnection.findFirst({
      where: {
        userId,
        providerId: provider.id,
        target,
        projectId: null,
      },
      select: { id: true },
    })

    const connection =
      previous === null
        ? await tx.integrationConnection.create({
            data: {
              userId,
              providerId: provider.id,
              target,
              projectId: null,
              status: 'CONNECTED',
              scopes: [...provider.scopes],
              accountLabel,
            },
            select: { id: true, connectedAt: true },
          })
        : await tx.integrationConnection.update({
            where: { id: previous.id },
            data: {
              status: 'CONNECTED',
              scopes: [...provider.scopes],
              accountLabel,
              lastError: null,
              disconnectedAt: null,
              connectedAt: new Date(),
            },
            select: { id: true, connectedAt: true },
          })

    await tx.integrationCredential.upsert({
      where: { connectionId: connection.id },
      update: {
        kind: 'API_KEY',
        secret: encryptSecret(input.apiKey),
        refreshSecret: null,
        hint: secretHint(input.apiKey),
      },
      create: {
        connectionId: connection.id,
        kind: 'API_KEY',
        secret: encryptSecret(input.apiKey),
        hint: secretHint(input.apiKey),
      },
    })

    return connection
  })

  await record(userId, provider.id, 'connected', undefined, created.id)

  return {
    id: created.id,
    providerId: provider.id,
    target,
    projectId: null,
    status: 'CONNECTED',
    scopes: [...provider.scopes],
    accountLabel,
    connectedAt: created.connectedAt.toISOString(),
    lastUsedAt: null,
    expiresAt: null,
    lastError: null,
    hint: secretHint(input.apiKey),
  }
}

/**
 * Déconnecte un service.
 *
 * Le secret est supprimé, pas seulement marqué inutilisable : ce qui n'existe plus ne peut
 * pas fuir. La connexion, elle, est conservée avec sa date de déconnexion, pour que le
 * créateur garde une trace de ce qu'il a autorisé un jour.
 */
export async function disconnect(userId: string, connectionId: string): Promise<void> {
  const connection = await withUserScope(userId, async (tx) => {
    const found = await tx.integrationConnection.findFirst({
      where: { id: connectionId, userId },
      select: { id: true, providerId: true },
    })
    if (found === null) return null

    await tx.integrationCredential.deleteMany({ where: { connectionId: found.id } })
    await tx.integrationConnection.update({
      where: { id: found.id },
      data: { status: 'REVOKED', disconnectedAt: new Date(), scopes: [] },
    })
    return found
  })

  if (connection === null) throw notFound("Cette connexion n'existe pas.")
  await record(userId, connection.providerId, 'disconnected', undefined, connection.id)
}

/**
 * Seul chemin par lequel un secret est déchiffré.
 *
 * Il n'y en a qu'un, et il est ici, pour que la question « qui peut lire une clé de
 * créateur ? » ait une réponse d'une ligne. La valeur renvoyée sert à l'appel qui suit,
 * puis disparaît : elle n'est ni journalisée, ni renvoyée à une page, ni ajoutée à un
 * prompt.
 *
 * Renvoie `null` plutôt qu'une erreur quand la connexion n'existe pas : l'appelant a
 * presque toujours un plan de repli, et une absence de connexion n'est pas une panne.
 */
export async function useCredential(
  userId: string,
  providerId: string,
  options: { target?: 'EVOLIIA' | 'APP'; projectId?: string | null } = {},
): Promise<{ connectionId: string; secret: string } | null> {
  const found = await withUserScope(userId, async (tx) => {
    const connection = await tx.integrationConnection.findFirst({
      where: {
        userId,
        providerId,
        status: 'CONNECTED',
        disconnectedAt: null,
        ...(options.target === undefined ? {} : { target: options.target }),
        ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      },
      select: { id: true, credential: { select: { secret: true } } },
    })
    if (connection === null || connection.credential === null) return null

    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { lastUsedAt: new Date() },
    })
    return { id: connection.id, secret: connection.credential.secret }
  })

  if (found === null) return null

  try {
    return { connectionId: found.id, secret: decryptSecret(found.secret) }
  } catch {
    // Un secret illisible est un secret perdu : la connexion est marquée, pas silencieuse.
    await markConnectionError(userId, found.id, 'Clé illisible. Reconnectez le service.')
    return null
  }
}

/**
 * Note sur la connexion ce que le fournisseur a répondu de travers.
 *
 * Le texte est destiné au créateur et passe sous ses yeux : il dit ce qui ne va pas, sans
 * jamais contenir de secret ni de fragment de secret.
 */
export async function markConnectionError(
  userId: string,
  connectionId: string,
  reason: string,
): Promise<void> {
  const detail = reason.slice(0, 200)
  const touched = await withUserScope(userId, async (tx) => {
    const connection = await tx.integrationConnection.findFirst({
      where: { id: connectionId, userId },
      select: { id: true, providerId: true },
    })
    if (connection === null) return null
    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { status: 'ERROR', lastError: detail },
    })
    return connection
  }).catch(() => null)

  if (touched === null) return
  await record(userId, touched.providerId, 'error', detail, touched.id)
}
