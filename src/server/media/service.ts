import sharp from 'sharp'
import { AppError, notFound, validation } from '@/lib/errors'
import { withUserScope, withRuntimeScope, type TenantClient } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { getEffectivePlan } from '@/server/billing/plans'
import {
  generationContext,
  readGeneration,
  type GenerationStatus,
} from './generate'
import {
  MAX_UPLOAD_BYTES,
  MAX_WIDTH,
  STORED_MIME,
  THUMB_WIDTH,
  detectFormat,
  humanSize,
} from './rules'

/**
 * Bibliothèque d'images d'un projet.
 *
 * La dépense de stockage est la seule de la plateforme qui grandirait avec l'usage plutôt
 * qu'avec le nombre de clients. Elle est donc bornée en amont, par un quota d'offre vérifié
 * avant d'écrire quoi que ce soit : un créateur atteint sa limite, il ne creuse pas une
 * facture. Le quota se règle depuis le back-office comme le reste.
 */

export type MediaView = {
  id: string
  filename: string
  width: number
  height: number
  bytes: number
  createdAt: string
}

export type MediaLibrary = {
  items: MediaView[]
  usedBytes: number
  quotaBytes: number
  /**
   * Part du stockage occupée par les photos envoyées par les visiteurs.
   *
   * Elles ne figurent pas dans la liste ci-dessus — la bibliothèque est un espace de
   * travail, pas une boîte de réception — mais elles pèsent dans le quota. Sans ce chiffre,
   * le créateur lirait « 30 Mo utilisés » en ne voyant que 5 Mo d'images, et il en
   * conclurait que le compteur ment.
   */
  visitorBytes: number
  /** Génération d'images avec la clé du créateur : quel fournisseur, combien aujourd'hui. */
  generation: GenerationStatus
}

export async function listMedias(userId: string, projectId: string): Promise<MediaLibrary> {
  const [plan, contexte] = await Promise.all([getEffectivePlan(userId), generationContext(userId)])

  /*
   * Une seule transaction pour tout ce que cet écran demande.
   *
   * Chaque portée de locataire ouvre une transaction : un BEGIN, un réglage de session, la
   * requête, un COMMIT — quatre allers-retours. Les huit lectures de cet écran, prises
   * séparément, se payaient donc en secondes sur une base distante. Mesuré en conditions
   * réelles, c'est le seul endroit du produit où la différence se voyait à l'œil nu.
   */
  const { rows, poids, generation } = await withUserScope(userId, async (tx) => {
    const [rows, poids, generation] = await Promise.all([
      tx.mediaAsset.findMany({
        // Les photos des visiteurs appartiennent aux fiches de l'application, pas à la
        // bibliothèque du créateur : elles se consultent avec leur fiche.
        where: { userId, projectId, origin: { not: VISITOR } },
        orderBy: { createdAt: 'desc' },
        // `data` et `thumb` ne sont jamais chargés ici : une liste de vingt images
        // rapatrierait plusieurs mégaoctets pour afficher des noms de fichiers.
        select: {
          id: true,
          filename: true,
          width: true,
          height: true,
          bytes: true,
          createdAt: true,
        },
      }),
      // Le total et la part des visiteurs sortent du même regroupement : deux sommes
      // successives, c'était deux fois la même lecture de table.
      tx.mediaAsset.groupBy({ by: ['origin'], where: { userId }, _sum: { bytes: true } }),
      readGeneration(tx, userId, contexte),
    ])
    return { rows, poids, generation }
  })

  const total = poids.reduce((somme, ligne) => somme + (ligne._sum.bytes ?? 0), 0)
  const visitor = poids
    .filter((ligne) => ligne.origin === VISITOR)
    .reduce((somme, ligne) => somme + (ligne._sum.bytes ?? 0), 0)

  return {
    generation,
    visitorBytes: visitor,
    items: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      width: row.width,
      height: row.height,
      bytes: row.bytes,
      createdAt: row.createdAt.toISOString(),
    })),
    usedBytes: total,
    quotaBytes: plan.storageBytes,
  }
}

/** Somme des images d'un créateur, tous projets confondus. C'est elle qui est plafonnée. */
export async function usedBytes(userId: string): Promise<number> {
  const total = await withUserScope(userId, (tx) =>
    tx.mediaAsset.aggregate({ where: { userId }, _sum: { bytes: true } }),
  )
  return total._sum.bytes ?? 0
}

/** Origine des images reçues d'un visiteur, par opposition à `upload` et `ai`. */
export const VISITOR = 'visitor'

/**
 * Délai au bout duquel une photo que plus aucune fiche ne désigne est reprise.
 *
 * Une heure, parce qu'elle doit couvrir un formulaire long — on choisit sa photo, puis on
 * cherche son numéro de TVA — sans laisser s'accumuler ce qu'un formulaire abandonné laisse
 * derrière lui. En deçà, on effacerait la photo de quelqu'un qui est encore en train
 * d'écrire.
 */
const ORPHAN_AGE_MS = 60 * 60 * 1000

/**
 * Reprend les photos qu'aucune fiche ne réclame.
 *
 * Une photo est envoyée avant que le formulaire ne soit validé — il faut bien la montrer à
 * celui qui la choisit. Un formulaire sur trois est abandonné ; sans ce ménage, le quota du
 * créateur se remplirait d'images que personne n'a jamais vues.
 *
 * Le ménage a lieu là où naît la pression, et là seulement : juste avant d'accepter une
 * nouvelle photo. Aucune tâche périodique n'est nécessaire, et une application que plus
 * personne n'utilise ne coûte aucun calcul.
 *
 * Il a aussi eu lieu, un temps, quand le créateur ouvrait son écran d'images — pour que son
 * quota y soit toujours juste. C'était une écriture sur un chemin de lecture, payée par
 * chaque visite de chaque créateur, et l'écran s'en est trouvé sensiblement ralenti. Le prix
 * de ce retrait est qu'un quota peut rester surévalué jusqu'à une heure sur une application
 * dont les visiteurs ont cessé d'envoyer des photos. Un écran lent se voit tous les jours ;
 * ce décalage-là, presque jamais.
 */
export async function sweepOrphanPhotos(userId: string, projectId: string): Promise<number> {
  const limite = new Date(Date.now() - ORPHAN_AGE_MS)
  const supprimees = await withUserScope(userId, (tx) =>
    tx.mediaAsset.deleteMany({
      where: { userId, projectId, origin: VISITOR, recordId: null, createdAt: { lt: limite } },
    }),
  )
  if (supprimees.count > 0) {
    logger.info('photos orphelines reprises', { projectId, count: supprimees.count })
  }
  return supprimees.count
}

/**
 * Enregistre une image.
 *
 * Le fichier reçu n'est jamais celui qui est stocké : il est décodé puis ré-encodé en WebP.
 * C'est à la fois ce qui garantit un poids raisonnable et ce qui fait tomber tout ce qu'un
 * fichier d'image peut transporter d'autre — un script glissé dans un commentaire, la
 * position GPS de l'endroit où la photo a été prise, le nom du téléphone.
 */
export async function addMedia(
  userId: string,
  projectId: string,
  file: {
    name: string
    bytes: Uint8Array
    /**
     * `ai` quand l'image vient d'un fournisseur payé par le créateur, `ai-evoliia` quand
     * c'est la plateforme qui a payé — la distinction décide du quota décompté ; `visitor`
     * quand elle a été envoyée depuis un formulaire de l'application publiée.
     */
    origin?: 'upload' | 'ai' | 'ai-evoliia' | 'visitor'
    prompt?: string
  },
): Promise<MediaView> {
  if (file.bytes.length === 0) throw validation('Ce fichier est vide.')
  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    throw validation(`Cette image dépasse ${humanSize(MAX_UPLOAD_BYTES)}. Réduisez-la avant de l'envoyer.`)
  }

  const format = detectFormat(file.bytes)
  if (format === null) {
    throw validation("Ce fichier n'est pas une image reconnue. Formats acceptés : JPEG, PNG, WebP, AVIF, GIF.")
  }

  const project = await withUserScope(userId, (tx) =>
    tx.project.findFirst({
      where: { id: projectId, ownerId: userId, deletedAt: null },
      select: { id: true },
    }),
  )
  if (project === null) throw notFound("Ce projet n'existe pas.")

  const plan = await getEffectivePlan(userId)
  if (plan.storageBytes <= 0) {
    throw new AppError(
      'PLAN_LIMIT',
      "Votre offre actuelle ne permet pas d'ajouter des images.",
    )
  }

  let image: Buffer
  let thumb: Buffer
  let width: number
  let height: number
  try {
    // `failOn: 'truncated'` refuse un fichier tronqué plutôt que d'en deviner la fin ;
    // `limitInputPixels` arrête une image dont les dimensions déclarées feraient exploser
    // la mémoire du serveur alors que le fichier, lui, est tout petit.
    const source = sharp(Buffer.from(file.bytes), {
      failOn: 'truncated',
      limitInputPixels: 40_000_000,
    })
    const metadata = await source.metadata()
    if (!metadata.width || !metadata.height) throw new Error('dimensions illisibles')

    image = await sharp(Buffer.from(file.bytes), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()

    thumb = await sharp(image)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer()

    const stored = await sharp(image).metadata()
    width = stored.width ?? metadata.width
    height = stored.height ?? metadata.height
  } catch {
    // Le détail technique reste dans le serveur : il ne dit rien d'utile au créateur et
    // renseignerait un attaquant sur la bibliothèque de décodage.
    logger.warn('image illisible refusée', { projectId, format })
    throw validation("Cette image n'a pas pu être lue. Essayez avec un autre fichier.")
  }

  const used = await usedBytes(userId)
  if (used + image.length + thumb.length > plan.storageBytes) {
    throw new AppError(
      'PLAN_LIMIT',
      `Vous avez utilisé ${humanSize(used)} sur ${humanSize(plan.storageBytes)}. Supprimez une image ou changez d'offre.`,
    )
  }

  const saved = await withUserScope(userId, (tx) =>
    tx.mediaAsset.create({
      data: {
        userId,
        projectId,
        filename: file.name.slice(0, 120),
        mime: STORED_MIME,
        width,
        height,
        bytes: image.length + thumb.length,
        data: new Uint8Array(image),
        thumb: new Uint8Array(thumb),
        origin: file.origin ?? 'upload',
        prompt: file.prompt?.slice(0, 1000) ?? null,
      },
      select: { id: true, filename: true, width: true, height: true, bytes: true, createdAt: true },
    }),
  )

  logger.info('image enregistrée', { userId, projectId, bytes: saved.bytes })

  return {
    id: saved.id,
    filename: saved.filename,
    width: saved.width,
    height: saved.height,
    bytes: saved.bytes,
    createdAt: saved.createdAt.toISOString(),
  }
}

export async function removeMedia(userId: string, mediaId: string): Promise<void> {
  const removed = await withUserScope(userId, (tx) =>
    tx.mediaAsset.deleteMany({ where: { id: mediaId, userId } }),
  )
  if (removed.count === 0) throw notFound("Cette image n'existe pas.")
}

/**
 * Lit une image pour l'afficher, côté application publiée.
 *
 * Le projet fait partie de la demande, et pas seulement l'identifiant de l'image : une
 * spécification qui référencerait l'image d'un autre projet — par erreur de l'assistant ou
 * par malveillance — ne renvoie rien plutôt que le fichier de quelqu'un d'autre.
 */
export async function readMedia(
  projectId: string,
  mediaId: string,
  variant: 'full' | 'thumb',
): Promise<{ bytes: Buffer; mime: string } | null> {
  /*
   * Deux requêtes distinctes plutôt qu'une sélection conditionnelle : une seule des deux
   * colonnes est chargée, et le typage le sait. Une vignette pèse quelques dizaines de
   * kilooctets, l'originale plusieurs centaines ; les charger toutes les deux pour n'en
   * servir qu'une doublerait le trafic entre la base et le serveur.
   */
  if (variant === 'thumb') {
    const row = await withRuntimeScope(projectId, (tx) =>
      tx.mediaAsset.findFirst({
        where: { id: mediaId, projectId },
        select: { mime: true, thumb: true },
      }),
    )
    return row === null ? null : { bytes: Buffer.from(row.thumb), mime: row.mime }
  }

  const row = await withRuntimeScope(projectId, (tx) =>
    tx.mediaAsset.findFirst({
      where: { id: mediaId, projectId },
      select: { mime: true, data: true },
    }),
  )
  return row === null ? null : { bytes: Buffer.from(row.data), mime: row.mime }
}

/**
 * Accepte la photo d'un visiteur.
 *
 * C'est le même traitement que pour une image du créateur, et c'est voulu : un fichier
 * reçu d'un inconnu mérite au moins autant de méfiance qu'un fichier reçu du propriétaire.
 * Il est donc identifié par ses octets et non par ce que le navigateur annonce, puis
 * ré-encodé — ce qui fait tomber au passage la position GPS du chantier photographié, que
 * personne n'a l'intention de publier.
 *
 * L'image est portée par le compte du créateur : c'est son quota de stockage qui la
 * supporte, comme c'est son offre qui a ouvert la fonction. Un visiteur ne peut donc pas
 * créer de dépense nouvelle, seulement occuper de la place déjà payée — et il ne l'occupe
 * que jusqu'à ce que sa fiche soit effacée, ou une heure s'il abandonne son formulaire.
 *
 * Ce qui remonte au visiteur ne dit jamais l'état du compte du créateur. « Il ne reste que
 * 3 Mo sur 50 » est une information qui ne le regarde pas, et qui renseignerait un curieux
 * sur l'offre souscrite par quelqu'un d'autre.
 */
export async function addVisitorPhoto(params: {
  ownerId: string
  projectId: string
  name: string
  bytes: Uint8Array
}): Promise<{ id: string; width: number; height: number }> {
  await sweepOrphanPhotos(params.ownerId, params.projectId).catch(() => undefined)

  try {
    const media = await addMedia(params.ownerId, params.projectId, {
      name: params.name,
      bytes: params.bytes,
      origin: VISITOR,
    })
    return { id: media.id, width: media.width, height: media.height }
  } catch (error) {
    if (error instanceof AppError && error.code === 'PLAN_LIMIT') {
      logger.warn('photo de visiteur refusée faute de place', { projectId: params.projectId })
      throw new AppError(
        'PLAN_LIMIT',
        "Cette application ne peut plus recevoir de photos pour le moment. Vous pouvez envoyer votre demande sans photo.",
      )
    }
    throw error
  }
}

/**
 * Rattache à une fiche les photos qu'elle désigne, et reprend celles qu'elle a lâchées.
 *
 * Les deux gestes vont ensemble. Rattacher sans reprendre laisserait derrière chaque
 * correction la photo remplacée, qui occuperait le quota sans que rien ne l'affiche —
 * exactement l'accumulation silencieuse qu'on cherche à éviter.
 *
 * Appelée dans la transaction qui écrit la fiche : une fiche enregistrée dont les photos ne
 * seraient pas rattachées les verrait reprises comme orphelines une heure plus tard, et
 * l'application afficherait des images manquantes.
 */
export async function attachPhotos(
  tx: TenantClient,
  params: { projectId: string; recordId: string; mediaIds: string[] },
): Promise<void> {
  if (params.mediaIds.length > 0) {
    await tx.mediaAsset.updateMany({
      where: {
        projectId: params.projectId,
        origin: VISITOR,
        id: { in: params.mediaIds },
        // Une photo déjà prise par une autre fiche n'est pas reprise : sans cela, désigner
        // l'identifiant de la photo d'autrui suffirait à l'emporter en supprimant sa
        // propre fiche.
        OR: [{ recordId: null }, { recordId: params.recordId }],
      },
      data: { recordId: params.recordId },
    })
  }

  // Ce que la fiche ne désigne plus redevient orphelin, et sera reprise comme telle.
  await tx.mediaAsset.updateMany({
    where: {
      projectId: params.projectId,
      origin: VISITOR,
      recordId: params.recordId,
      id: { notIn: params.mediaIds },
    },
    data: { recordId: null },
  })
}

/** Une image jointe à une demande faite à l'assistant. */
export type ChatAttachment = {
  id: string
  filename: string
  width: number
  height: number
}

/** Au-delà, une demande cesse d'être « place cette photo » et devient un album. */
export const MAX_ATTACHMENTS = 4

/**
 * Les images qu'une demande peut légitimement joindre.
 *
 * Le navigateur annonce des identifiants ; ce sont les seuls que le serveur retient, et
 * seulement après avoir vérifié qu'ils désignent des images **de ce créateur et de ce
 * projet**. Sans cette relecture, joindre l'identifiant de l'image d'un autre projet
 * suffirait à la faire apparaître dans le sien.
 *
 * Les photos reçues des visiteurs sont écartées : elles appartiennent à une fiche, pas à la
 * décoration des pages, et les placer dans un bandeau publierait la photo d'un client.
 */
export async function resolveAttachments(
  userId: string,
  projectId: string,
  mediaIds: readonly string[],
): Promise<ChatAttachment[]> {
  if (mediaIds.length === 0) return []
  const uniques = [...new Set(mediaIds)].slice(0, MAX_ATTACHMENTS)

  const rows = await withUserScope(userId, (tx) =>
    tx.mediaAsset.findMany({
      where: { userId, projectId, id: { in: uniques }, origin: { not: VISITOR } },
      select: { id: true, filename: true, width: true, height: true },
    }),
  )
  // L'ordre du créateur est conservé : c'est celui dans lequel il les a jointes, et il
  // compte quand il écrit « la première en haut, la seconde en bas ».
  return uniques.flatMap((id) => rows.filter((row) => row.id === id))
}
