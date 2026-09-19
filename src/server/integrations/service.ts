import { z } from 'zod'
import { AppError, notFound, validation } from '@/lib/errors'
import { assertEncryptionReady, decryptSecret, encryptSecret, secretHint } from '@/lib/crypto'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { getEffectivePlan } from '@/server/billing/plans'
import { findProvider, INTEGRATION_PROVIDERS, type IntegrationProvider } from './catalog'
import { findVerifier } from './verify'
import { isEnabled } from '@/server/settings/flags'
import { isStripeAvailable } from '@/server/billing/stripe/client'
import { estConfigure as estConfigureGoogle } from './providers/google-search-console'

/**
 * Fournisseurs suspendus à un interrupteur d'exploitation.
 *
 * Un fournisseur peut être construit, testé et pourtant fermé : celui-ci dépend d'une
 * autorisation extérieure qui n'est pas encore arrivée. Il apparaît alors comme à venir,
 * ce qui est exactement ce qu'il est.
 */
const GATED: Record<string, 'socialPublishing'> = { postelya: 'socialPublishing' }

export async function isProviderOpen(provider: IntegrationProvider): Promise<boolean> {
  if (provider.status !== 'available') return false
  // Stripe Connect n'existe que si Evoliia a son propre compte de plateforme configuré.
  if (provider.id === 'stripe' && !isStripeAvailable()) return false
  /*
   * Même raison pour Google : sans application déclarée chez Google, il n'y a nulle part où
   * envoyer la personne. Le fournisseur se présente alors comme à venir plutôt que d'offrir
   * un bouton qui répondrait « introuvable ».
   */
  if (provider.id === 'google-search-console' && !estConfigureGoogle()) return false
  const flag = GATED[provider.id]
  return flag === undefined ? true : isEnabled(flag)
}

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
  /**
   * Les champs réclamés par le catalogue en plus de la clé, par `extraFields`.
   *
   * Les identifiants Shopify ne disent pas à quelle boutique ils s'appliquent : l'adresse
   * fait donc partie de ce qu'il faut demander. Ce qui arrive ici est filtré sur les noms
   * déclarés avant d'atteindre un fournisseur.
   */
  account: z.record(z.string(), z.string().trim().max(200)).optional(),
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

  /*
   * Un fournisseur fermé par interrupteur est présenté comme à venir. Sa connexion déjà
   * établie reste visible : la cacher donnerait l'impression d'avoir été déconnecté.
   */
  return Promise.all(
    INTEGRATION_PROVIDERS.map(async (provider) => ({
      provider: (await isProviderOpen(provider))
        ? provider
        : { ...provider, status: 'planned' as const },
      connection: byProvider.get(provider.id) ?? null,
    })),
  )
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
  if (!(await isProviderOpen(provider))) {
    throw validation("Ce service n'est pas encore connectable. Il arrive bientôt.")
  }
  if (provider.credential !== 'API_KEY') {
    throw validation(
      'Ce service se connecte par autorisation, pas par clé. Utilisez le bouton de connexion.',
    )
  }

  await assertConnectionSlot(userId, provider.id)
  assertEncryptionReady()

  /*
   * La clé est vérifiée auprès du fournisseur AVANT d'être écrite. Une clé fautive
   * rejetée tout de suite vaut mieux qu'une connexion verte qui échoue le jour où un
   * visiteur pose sa première question.
   */
  /*
   * Le navigateur propose, le catalogue dispose : seuls les champs déclarés traversent. Un
   * champ inventé côté client n'atteint jamais un fournisseur, et un champ déclaré mais
   * laissé vide arrête la connexion ici plutôt qu'à la première lecture.
   */
  const champs: Record<string, string> = {}
  for (const attendu of provider.extraFields ?? []) {
    const valeur = (input.account ?? {})[attendu.name]?.trim() ?? ''
    if (valeur === '') throw validation(`Indiquez également ${attendu.label.toLowerCase()}.`)
    champs[attendu.name] = valeur
  }

  const verifier = findVerifier(provider.id)
  const verdict = verifier === undefined ? null : await verifier(input.apiKey, champs)
  if (verdict !== null && !verdict.ok) throw validation(verdict.reason)
  const accountLabel = verdict === null ? null : verdict.label

  /*
   * Ce qui est conservé n'est pas toujours ce qui a été saisi. Un code d'appairage est
   * périmé dès l'instant où il a servi : garder l'autorisation qu'il a produite est le
   * seul choix qui ait du sens.
   */
  const secret = verdict !== null && verdict.ok && verdict.secret !== undefined
    ? verdict.secret
    : input.apiKey

  return storeConnection(userId, provider, {
    kind: 'API_KEY',
    secret,
    accountLabel,
    ...(verdict !== null && verdict.ok && verdict.hint !== undefined
      ? { hintSource: verdict.hint }
      : {}),
  })
}

/**
 * Une place de plus dans l'offre ?
 *
 * Reconnecter un service déjà connecté ne compte pas pour une connexion de plus : on
 * remplace, on n'empile pas.
 */
export async function assertConnectionSlot(userId: string, providerId: string): Promise<void> {
  const plan = await getEffectivePlan(userId)
  const { total, same } = await withUserScope(userId, async (tx) => ({
    total: await tx.integrationConnection.count({ where: { userId, disconnectedAt: null } }),
    same: await tx.integrationConnection.count({
      where: { userId, providerId, disconnectedAt: null },
    }),
  }))
  if (same === 0 && total >= plan.maxConnections) {
    throw new AppError(
      'PLAN_LIMIT',
      plan.maxConnections === 0
        ? "Votre offre actuelle ne permet pas de connecter de service extérieur."
        : `Votre offre permet ${plan.maxConnections} connexion(s). Déconnectez-en une ou changez d'offre.`,
    )
  }
}

/**
 * Enregistre (ou remplace) la connexion d'un fournisseur, avec son secret chiffré.
 *
 * Reconnecter le même service remplace l'ancienne connexion plutôt que d'en empiler une
 * seconde. La recherche est faite à la main : une clé unique portant une colonne
 * nullable ne se prête pas à un upsert. C'est le seul chemin d'écriture d'un secret,
 * quel que soit le fournisseur ou son mode d'autorisation.
 */
export async function storeConnection(
  userId: string,
  provider: IntegrationProvider,
  params: {
    kind: 'API_KEY' | 'OAUTH'
    secret: string
    accountLabel: string | null
    /** `ERROR` pour une autorisation commencée mais pas terminée, avec la raison. */
    status?: 'CONNECTED' | 'ERROR'
    lastError?: string | null
    expiresAt?: Date | null
    /**
     * Ce dont l'indice est tiré, quand il diffère du secret conservé.
     *
     * L'indice sert à ce que la personne reconnaisse ce qu'elle a collé. Quand le secret
     * conservé est composé — une boutique et un jeton, par exemple — ses quatre derniers
     * signes ne diraient rien ; ceux du jeton, si.
     */
    hintSource?: string
    /**
     * Jeton de rafraîchissement, quand le fournisseur en délivre un.
     *
     * Il vaut plus longtemps que le jeton d'accès, et souvent jusqu'à révocation : il est
     * chiffré comme le reste, et n'est jamais rendu à un écran.
     */
    refreshSecret?: string
  },
): Promise<ConnectionView> {
  const target = provider.connectionTarget
  const status = params.status ?? 'CONNECTED'
  const lastError = status === 'CONNECTED' ? null : (params.lastError ?? null)
  const expiresAt = params.expiresAt ?? null
  const indice = secretHint(params.hintSource ?? params.secret)

  const created = await withUserScope(userId, async (tx) => {
    const previous = await tx.integrationConnection.findFirst({
      where: { userId, providerId: provider.id, target, projectId: null },
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
              status,
              scopes: [...provider.scopes],
              accountLabel: params.accountLabel,
              lastError,
              expiresAt,
            },
            select: { id: true, connectedAt: true },
          })
        : await tx.integrationConnection.update({
            where: { id: previous.id },
            data: {
              status,
              scopes: [...provider.scopes],
              accountLabel: params.accountLabel,
              lastError,
              expiresAt,
              disconnectedAt: null,
              connectedAt: new Date(),
            },
            select: { id: true, connectedAt: true },
          })

    await tx.integrationCredential.upsert({
      where: { connectionId: connection.id },
      update: {
        kind: params.kind,
        secret: encryptSecret(params.secret),
        /*
         * Absent, le jeton de rafraîchissement est effacé plutôt que conservé : il
         * appartenait à l'autorisation précédente, et en garder un qui ne correspond plus
         * au secret enregistré donnerait un renouvellement qui échoue sans raison lisible.
         */
        refreshSecret:
          params.refreshSecret === undefined ? null : encryptSecret(params.refreshSecret),
        hint: indice,
      },
      create: {
        connectionId: connection.id,
        kind: params.kind,
        secret: encryptSecret(params.secret),
        ...(params.refreshSecret === undefined
          ? {}
          : { refreshSecret: encryptSecret(params.refreshSecret) }),
        hint: indice,
      },
    })

    return connection
  })

  await record(userId, provider.id, status === 'CONNECTED' ? 'connected' : 'pending', undefined, created.id)

  return {
    id: created.id,
    providerId: provider.id,
    target,
    projectId: null,
    status,
    scopes: [...provider.scopes],
    accountLabel: params.accountLabel,
    connectedAt: created.connectedAt.toISOString(),
    lastUsedAt: null,
    expiresAt: expiresAt?.toISOString() ?? null,
    lastError,
    hint: indice,
  }
}

/** Une connexion active existe-t-elle ? Ne touche pas aux secrets. */
export async function hasConnection(
  userId: string,
  providerId: string,
  options: { target?: 'EVOLIIA' | 'APP' } = {},
): Promise<boolean> {
  const count = await withUserScope(userId, (tx) =>
    tx.integrationConnection.count({
      where: {
        userId,
        providerId,
        status: 'CONNECTED',
        disconnectedAt: null,
        ...(options.target === undefined ? {} : { target: options.target }),
      },
    }),
  )
  return count > 0
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
  options: {
    target?: 'EVOLIIA' | 'APP'
    projectId?: string | null
    /** Lire aussi une autorisation commencée mais pas terminée (reprise d'inscription). */
    includePending?: boolean
  } = {},
): Promise<{ connectionId: string; secret: string } | null> {
  const found = await withUserScope(userId, async (tx) => {
    const connection = await tx.integrationConnection.findFirst({
      where: {
        userId,
        providerId,
        status: options.includePending === true ? { in: ['CONNECTED', 'ERROR'] } : 'CONNECTED',
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
 * Un jeton d'accès valable, renouvelé en silence quand il a expiré.
 *
 * Les autorisations OAuth ne se comportent pas comme les clés : un jeton d'accès vaut une
 * heure, parfois moins. Sans renouvellement, la connexion marcherait le jour où on la crée
 * et serait morte le lendemain — et personne ne comprendrait pourquoi, puisque rien
 * n'aurait été révoqué.
 *
 * Le renouvellement est confié à l'appelant plutôt qu'écrit ici : chaque fournisseur a son
 * adresse et ses paramètres. Ce qui appartient à cette fonction, c'est le reste — lire le
 * jeton dans le bon périmètre, le déchiffrer, décider s'il est encore bon, et réécrire le
 * nouveau chiffré.
 *
 * Deux détails coûteux s'ils manquent. Le jeton de rafraîchissement n'est pas toujours
 * redonné au renouvellement : l'écraser par rien reviendrait à perdre l'autorisation au
 * renouvellement suivant. Et un renouvellement refusé marque la connexion, parce qu'une
 * autorisation révoquée chez le fournisseur ne se découvre autrement qu'au moment où un
 * écran reste vide.
 */
export async function useOAuthAccess(
  userId: string,
  providerId: string,
  renouveler: (
    refreshToken: string,
  ) => Promise<
    | { ok: true; jetons: { accessToken: string; refreshToken?: string; expiresAt: Date } }
    | { ok: false; raison: string }
  >,
): Promise<{ ok: true; accessToken: string; connectionId: string } | { ok: false; raison: string }> {
  const found = await withUserScope(userId, async (tx) => {
    const connection = await tx.integrationConnection.findFirst({
      where: { userId, providerId, status: 'CONNECTED', disconnectedAt: null },
      select: {
        id: true,
        expiresAt: true,
        credential: { select: { secret: true, refreshSecret: true } },
      },
    })
    if (connection === null || connection.credential === null) return null

    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { lastUsedAt: new Date() },
    })
    return { id: connection.id, expiresAt: connection.expiresAt, ...connection.credential }
  })

  if (found === null) return { ok: false, raison: "Ce service n'est pas connecté." }

  let acces: string
  let rafraichissement: string | null
  try {
    acces = decryptSecret(found.secret)
    rafraichissement = found.refreshSecret === null ? null : decryptSecret(found.refreshSecret)
  } catch {
    await markConnectionError(userId, found.id, 'Jeton illisible. Reconnectez le service.')
    return { ok: false, raison: 'Reconnectez ce service depuis Connexions.' }
  }

  if (found.expiresAt === null || found.expiresAt.getTime() > Date.now()) {
    return { ok: true, accessToken: acces, connectionId: found.id }
  }

  if (rafraichissement === null) {
    await markConnectionError(userId, found.id, 'Autorisation expirée. Reconnectez le service.')
    return {
      ok: false,
      raison: 'Cette autorisation a expiré. Reconnectez le service depuis Connexions.',
    }
  }

  const neuf = await renouveler(rafraichissement)
  if (!neuf.ok) {
    await markConnectionError(userId, found.id, 'Autorisation refusée. Reconnectez le service.')
    return { ok: false, raison: neuf.raison }
  }

  await withUserScope(userId, async (tx) => {
    await tx.integrationConnection.update({
      where: { id: found.id },
      data: { expiresAt: neuf.jetons.expiresAt, lastError: null },
    })
    await tx.integrationCredential.update({
      where: { connectionId: found.id },
      data: {
        secret: encryptSecret(neuf.jetons.accessToken),
        // Absent, l'ancien reste valable : Google n'en redonne pas à chaque renouvellement.
        ...(neuf.jetons.refreshToken === undefined
          ? {}
          : { refreshSecret: encryptSecret(neuf.jetons.refreshToken) }),
      },
    })
  })

  return { ok: true, accessToken: neuf.jetons.accessToken, connectionId: found.id }
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
