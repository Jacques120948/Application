import sharp from 'sharp'
import { env } from '@/lib/env'
import { prisma } from '@/server/db/client'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { getEffectivePlan } from '@/server/billing/plans'
import { currentPeriod } from '@/server/radar/quota'
import { creditsFor, loadPricing } from '@/server/billing/ai-pricing'
import { MINIMUM_COST, spendCredits } from '@/server/billing/credits'
import { releaseReservation, reserveCredits } from '@/server/billing/reservation'
import { generateGeminiImage, GEMINI_IMAGE_MODEL } from '@/server/integrations/providers/gemini'
import { isEnabled } from '@/server/settings/flags'

/**
 * Créer une image quand la boutique n'a rien qui corresponde.
 *
 * L'ordre des deux voies n'est pas négociable, et il est l'inverse de ce qu'on ferait par
 * facilité. **La photo réelle d'abord** : elle montre le produit tel qu'il est, elle mène à
 * une fiche, elle ne coûte rien, et aucune image inventée ne vaut mieux qu'elle. Ce module
 * n'intervient que pour les sections qu'aucune fiche ne sait montrer — un atelier, une
 * flamme de près, une main qui verse la cire — et pour lesquelles la seule autre option
 * était de rester vide.
 *
 * **Jamais pour remplacer un produit.** C'est la limite qui tient tout le reste : une image
 * inventée d'une obsidienne n'est pas l'obsidienne que le client vend, et la publier à côté
 * d'un texte qui en parle revient à montrer une marchandise qui n'existe pas. La consigne
 * envoyée au modèle le dit, et le rapprochement avec les vraies fiches passe de toute façon
 * en premier.
 *
 * **C'est de l'argent qui sort du compte d'Evoliia.** Trois bornes indépendantes, et la
 * première atteinte arrête : un interrupteur d'exploitant, le quota mensuel de l'offre — à
 * zéro par défaut, donc fermé tant que personne ne l'ouvre — et les crédits du créateur,
 * réservés avant l'appel et débités au coût constaté. Un plafond journalier s'y ajoute : il
 * ne borne pas une dépense mais un emballement, celui d'une boucle qui partirait seule.
 *
 * **Une image manquante n'empêche jamais un article.** Tout échec ici rend `null` et se
 * trace ; l'article part sans cette illustration. Faire échouer une rédaction déjà payée
 * parce qu'une image n'a pas abouti serait facturer deux fois la même panne.
 */

/** Largeur d'enregistrement. Au-delà, on paie du poids que personne ne regarde. */
const LARGEUR = 1200

/**
 * Plafond journalier, toutes images confondues.
 *
 * Le même esprit que celui du constructeur, mais plus bas : un article compte trois à cinq
 * sections, et personne n'écrit dix articles par jour à la main. Ce qui dépasse ce nombre
 * n'est pas un usage, c'est une boucle.
 */
export const IMAGES_PAR_JOUR = 12

export type EtatImages = {
  /** L'exploitant a-t-il ouvert la fonction, et Evoliia a-t-elle une clé ? */
  possible: boolean
  /** Ce que l'offre accorde par mois. Zéro : fermée pour cette personne. */
  parMois: number
  restantMois: number
  restantJour: number
  creditsParImage: number
}

/**
 * L'adresse publique d'Evoliia est-elle utilisable pour servir une image ?
 *
 * Une image créée n'a de valeur que si deux tiers peuvent aller la chercher : le navigateur
 * d'un lecteur, et Shopify lorsqu'il la copie dans la boutique. Si `APP_URL` pointait sur
 * `localhost` — une variable oubliée au déploiement —, l'image serait bel et bien créée,
 * facturée, et inaccessible : l'article partirait avec une image cassée et le téléversement
 * échouerait sans que rien ne dise pourquoi.
 *
 * Mieux vaut alors ne pas créer d'image du tout. Une section sans photo se lit très bien ;
 * une section à l'image brisée fait douter de tout l'article, et elle aura coûté des
 * crédits pour cela.
 */
export function adressePubliqueUtilisable(): boolean {
  try {
    const url = new URL(env.appUrl)
    if (url.protocol !== 'https:') return false
    return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1'
  } catch {
    return false
  }
}

/** Evoliia peut-elle créer des images elle-même ? Sans clé, la fonction est simplement éteinte. */
export function cleImagesPresente(): boolean {
  return env.geminiApiKey !== undefined
}

/**
 * Ce qui est possible, et à quel prix, avant d'engager quoi que ce soit.
 *
 * Lit l'offre en premier : une offre qui n'accorde aucune image rend la suite inutile, et
 * aller chercher un portefeuille pour rien est une requête de plus à chaque article.
 */
export async function etatImages(userId: string): Promise<EtatImages> {
  const ferme: EtatImages = {
    possible: false,
    parMois: 0,
    restantMois: 0,
    restantJour: 0,
    creditsParImage: 0,
  }
  if (!cleImagesPresente()) return ferme
  if (!adressePubliqueUtilisable()) {
    /*
     * Tracé plutôt que tu : c'est une erreur de déploiement, pas un choix de l'exploitant,
     * et elle éteint silencieusement une fonction qu'il croit allumée.
     */
    logger.warn('images article : APP_URL inutilisable, création désactivée')
    return ferme
  }
  if (!(await isEnabled('imagesArticlesIA'))) return ferme

  const plan = await getEffectivePlan(userId)
  if (plan.imagesPerMonth <= 0) return { ...ferme, parMois: 0 }

  const [periode, table] = await Promise.all([currentPeriod(userId), loadPricing()])
  const depuisHier = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [mois, jour] = await withUserScope(userId, async (tx) => [
    await tx.siteImage.count({ where: { userId, createdAt: { gte: periode.start } } }),
    await tx.siteImage.count({ where: { userId, createdAt: { gte: depuisHier } } }),
  ])

  return {
    possible: true,
    parMois: plan.imagesPerMonth,
    restantMois: Math.max(0, plan.imagesPerMonth - mois),
    restantJour: Math.max(0, IMAGES_PAR_JOUR - jour),
    creditsParImage: creditsFor(table.imageMicros, MINIMUM_COST.image, table),
  }
}

/**
 * La consigne envoyée au modèle.
 *
 * Trois interdits, et chacun a sa raison. **Pas de texte dans l'image** : un modèle qui
 * écrit se trompe de langue, d'orthographe, et le client ne peut pas corriger un mot peint
 * dans un pixel. **Pas de visage reconnaissable** : une personne inventée sur le blog d'un
 * commerçant fait croire à une photo d'équipe ou de cliente. **Pas de logo ni de marque** :
 * ce serait celle de quelqu'un d'autre.
 *
 * Le souhait de Milo passe tel quel, sans le sujet de l'article ni rien du contexte : ce
 * qui n'a pas besoin de sortir ne sort pas.
 */
export function consigneImage(souhait: string): string {
  return [
    `Photographie d'illustration éditoriale : ${souhait.trim()}.`,
    'Lumière naturelle, ambiance sobre et chaleureuse, profondeur de champ douce.',
    'Aucun texte, aucun mot, aucun chiffre dans l’image.',
    'Aucun logo, aucune marque, aucun emballage identifiable.',
    'Aucun visage humain reconnaissable.',
  ].join(' ')
}

export type ImageCreee = {
  id: string
  alt: string
  width: number
  height: number
  creditsSpent: number
}

/**
 * Crée une image et l'enregistre. Rend `null` dès que quoi que ce soit s'y oppose.
 *
 * Aucune exception ne remonte : cette fonction est appelée pendant la rédaction d'un
 * article déjà payé, et la seule bonne réponse à un échec est une section sans image.
 */
export async function creerImageArticle(
  userId: string,
  siteId: string,
  souhait: string,
  etat: EtatImages,
): Promise<ImageCreee | null> {
  const voulu = souhait.trim()
  if (voulu.length < 5 || voulu.length > 300) return null
  if (!etat.possible || etat.restantMois <= 0 || etat.restantJour <= 0) return null

  const cle = env.geminiApiKey
  if (cle === undefined) return null

  /*
   * Réserver avant d'appeler : vérifier le solde après coup laisserait passer un appel
   * qu'on ne peut pas facturer, et deux articles écrits en même temps passeraient tous les
   * deux. La réservation est rendue dans tous les cas, succès compris.
   */
  const reservation = await reserveCredits({
    userId,
    operation: 'image',
    amount: etat.creditsParImage,
  }).catch(() => null)
  if (reservation === null) return null

  try {
    const resultat = await generateGeminiImage(cle, consigneImage(voulu))
    if (!resultat.ok) {
      // La clé est celle d'Evoliia : un refus est un incident de la plateforme. On le trace
      // pour nous, et rien n'est débité — l'article continue sans cette image.
      logger.error('image article refusée', { userId, kind: resultat.kind })
      return null
    }

    /*
     * Ré-encodé en webp, redimensionné, et débarrassé de ses métadonnées. Trois raisons :
     * le poids, la cohérence de ce qu'on sert, et le fait qu'on ne relaie jamais tel quel
     * un fichier venu d'ailleurs.
     */
    const image = sharp(Buffer.from(resultat.bytes)).rotate().resize({
      width: LARGEUR,
      withoutEnlargement: true,
    })
    const { data, info } = await image.webp({ quality: 82 }).toBuffer({ resolveWithObject: true })

    const table = await loadPricing()
    const credits = creditsFor(table.imageMicros, MINIMUM_COST.image, table)
    const usage = await prisma.aiUsage
      .create({
        data: {
          userId,
          operation: 'image',
          model: GEMINI_IMAGE_MODEL,
          costMicros: table.imageMicros,
          creditsSpent: credits,
          success: true,
        },
        select: { id: true },
      })
      .catch(() => null)

    await spendCredits(userId, credits, 'image', undefined, {
      ...(usage === null ? {} : { aiUsageId: usage.id }),
    })

    const ligne = await withUserScope(userId, (tx) =>
      tx.siteImage.create({
        data: {
          siteId,
          userId,
          mime: 'image/webp',
          width: info.width,
          height: info.height,
          bytes: data.byteLength,
          data: new Uint8Array(data),
          /*
           * Le souhait fait le texte de remplacement : c'est exactement ce que l'image est
           * censée montrer, dit en français par quelqu'un qui a lu la section. Une image
           * sans alternative textuelle est précisément un des défauts que l'analyse
           * reproche — il serait absurde d'en créer en illustrant.
           */
          alt: voulu,
          creditsSpent: credits,
        },
        select: { id: true },
      }),
    )

    logger.info('image article créée', { siteId, credits, octets: data.byteLength })
    return { id: ligne.id, alt: voulu, width: info.width, height: info.height, creditsSpent: credits }
  } catch (error) {
    logger.error('image article : échec', { userId, message: (error as Error).message })
    return null
  } finally {
    await releaseReservation(reservation.id).catch(() => undefined)
  }
}

/** L'adresse publique d'une image. Servie sans session : voir la migration. */
export function adresseImage(base: string, id: string): string {
  return `${base.replace(/\/$/u, '')}/api/images/${id}`
}

/** Un identifiant qui n'a pas la forme d'un UUID ne touche jamais la base. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/**
 * Relit une image pour la servir, sans session et sans portée.
 *
 * C'est la seule lecture du produit qui se fasse hors de toute portée utilisateur, et elle
 * est délibérée : l'image part dans un article que le client copie sur son blog, où elle
 * sera chargée par des visiteurs qui ne sont ni lui ni inscrits. Une image que seul son
 * auteur peut voir n'illustre rien.
 *
 * Ce qui rend l'ouverture sans conséquence tient à la table, qui ne contient que l'image et
 * son texte de remplacement — rien du travail en cours. Le `select` ci-dessous s'en tient
 * d'ailleurs au strict nécessaire : deux colonnes, et pas même le propriétaire.
 */
export async function lireImagePubliee(
  id: string,
): Promise<{ data: ArrayBuffer; mime: string } | null> {
  if (!UUID.test(id)) return null
  const image = await prisma.siteImage
    .findUnique({ where: { id }, select: { data: true, mime: true } })
    .catch(() => null)
  if (image === null) return null
  /*
   * Une copie détachée plutôt que la vue rendue par le pilote : le corps d'une réponse
   * demande un tampon qui lui appartienne, et le recopier ici évite que la route ait à
   * connaître la forme que Prisma lui donne.
   */
  const octets = new Uint8Array(image.data)
  return { data: octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer, mime: image.mime }
}
