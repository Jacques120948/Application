import { AppError } from '@/lib/errors'
import { BORNES_BALISES } from '@/server/audit/checks/seo'
import {
  frapperJeton,
  lireAcces,
  lireArticles,
  lireProduits,
  PIECES_MAX,
  type ArticleShopify,
  type ProduitShopify,
} from '@/server/integrations/providers/shopify'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import { logger } from '@/server/observability/logger'

/**
 * La boutique d'un marchand, lue chez lui.
 *
 * L'analyse du site public voit ce qu'un visiteur voit : une page rendue. Ici on lit ce que
 * le marchand a réellement saisi, champ par champ — et ce n'est pas la même chose. Un thème
 * fabrique une balise quand elle manque, souvent en tronquant le début du descriptif et en
 * collant le nom de la boutique à la fin ; la page semble alors pourvue, alors que le champ
 * est vide. Seule la lecture directe fait la différence entre « rempli » et « rempli par
 * défaut ».
 *
 * Trois décisions portent ce module.
 *
 * **Lecture seule, et rien d'autre.** Aucune mutation n'existe dans le connecteur, et les
 * autorisations demandées à l'installation ne portent que la lecture. C'est ce qui permet de
 * proposer cette connexion sans rien faire risquer à une boutique en activité.
 *
 * **Les mêmes bornes que l'analyse.** Un titre trop court l'est ici comme là-bas. Les
 * chiffres viennent du module de contrôle, jamais d'une recopie : le produit ne peut pas
 * dire deux choses du même texte selon l'écran où on le regarde.
 *
 * **Rien n'est conservé.** Les fiches et les articles ne sont pas recopiés en base. Ils
 * appartiennent au marchand, ils changent chez lui, et une copie qui vieillit serait un
 * deuxième endroit où se tromper. On lit à la demande, on affiche, on oublie.
 */

/** Ce qu'on reproche à une pièce. Calculé, gratuit, et dit dans les mots du plan d'action. */
export type DefautBalise = 'manquant' | 'court' | 'long'

export type PieceVue = {
  id: string
  titre: string
  /** L'adresse publique, quand la pièce est en ligne. */
  url: string | null
  /** Ce qui situe la pièce : son état pour un produit, son blog pour un article. */
  contexte: string
  metaTitle: string
  metaDescription: string
  defautTitre: DefautBalise | null
  defautDescription: DefautBalise | null
}

export type BoutiqueVue = {
  /** Le libellé de la connexion, tel que la personne l'a reconnu. */
  boutique: string
  produits: PieceVue[]
  articles: PieceVue[]
  /** Vrai quand la boutique dépasse ce qu'on rapatrie : le dire plutôt que le taire. */
  tronque: boolean
  /** Le plafond appliqué, pour que « tronqué » veuille dire quelque chose. */
  plafond: number
}

/**
 * Le défaut d'une balise, s'il y en a un.
 *
 * Une balise vide n'est pas une balise courte : l'une se remplit, l'autre se reprend. Les
 * distinguer évite de ranger cent fiches jamais renseignées avec trois fiches perfectibles.
 */
export function jugerBalise(
  valeur: string,
  bornes: { min: number; max: number },
): DefautBalise | null {
  const propre = valeur.trim()
  if (propre === '') return 'manquant'
  if (propre.length < bornes.min) return 'court'
  if (propre.length > bornes.max) return 'long'
  return null
}

function juger(metaTitle: string, metaDescription: string) {
  return {
    defautTitre: jugerBalise(metaTitle, {
      min: BORNES_BALISES.titreMin,
      max: BORNES_BALISES.titreMax,
    }),
    defautDescription: jugerBalise(metaDescription, {
      min: BORNES_BALISES.descriptionMin,
      max: BORNES_BALISES.descriptionMax,
    }),
  }
}

function vueProduit(produit: ProduitShopify): PieceVue {
  const etat =
    produit.statut === 'ACTIVE'
      ? 'En ligne'
      : produit.statut === 'DRAFT'
        ? 'Brouillon'
        : 'Archivée'
  return {
    id: produit.id,
    titre: produit.titre,
    url: produit.url,
    contexte: produit.descriptionVide ? `${etat} · sans descriptif` : etat,
    metaTitle: produit.metaTitle,
    metaDescription: produit.metaDescription,
    ...juger(produit.metaTitle, produit.metaDescription),
  }
}

function vueArticle(article: ArticleShopify): PieceVue {
  return {
    id: article.id,
    titre: article.titre,
    url: null,
    contexte: article.publie ? article.blog : `${article.blog} · non publié`,
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    ...juger(article.metaTitle, article.metaDescription),
  }
}

/**
 * Lit la boutique connectée, ou rend `null` quand il n'y en a pas.
 *
 * `null` n'est pas une erreur : ne pas avoir connecté Shopify est l'état ordinaire de la
 * plupart des gens. C'est à l'écran de proposer la connexion, pas à ce module de lever.
 */
export async function readBoutique(userId: string): Promise<BoutiqueVue | null> {
  const connexion = await useCredential(userId, 'shopify')
  if (connexion === null) return null

  const acces = lireAcces(connexion.secret)
  if (acces === null) {
    await markConnectionError(userId, connexion.connectionId, 'Accès illisible. Reconnectez Shopify.')
    throw new AppError('VALIDATION', 'Votre connexion Shopify est abîmée. Reconnectez-la.')
  }

  try {
    /*
     * Le jeton se frappe ici, pour cette lecture, et disparaît avec elle. Il vaut
     * vingt-quatre heures ; le conserver demanderait une expiration, une invalidation et un
     * renouvellement, soit trois occasions de servir un jeton périmé pour économiser un
     * aller-retour.
     */
    const frappe = await frapperJeton(acces)
    if (!frappe.ok) {
      await markConnectionError(userId, connexion.connectionId, frappe.raison)
      throw new AppError('VALIDATION', frappe.raison)
    }

    const [produits, articles] = await Promise.all([
      lireProduits(acces, frappe.jeton),
      lireArticles(acces, frappe.jeton),
    ])

    logger.info('boutique lue', {
      produits: produits.pieces.length,
      articles: articles.pieces.length,
    })

    return {
      boutique: acces.boutique,
      produits: produits.pieces.map(vueProduit),
      articles: articles.pieces.map(vueArticle),
      tronque: produits.tronque || articles.tronque,
      plafond: PIECES_MAX,
    }
  } catch (error) {
    // Un refus déjà traduit et déjà noté ne se note pas deux fois.
    if (error instanceof AppError) throw error
    /*
     * Un refus de Shopify se note sur la connexion : la personne le verra dans « Connexions »
     * plutôt que de retrouver un écran vide sans savoir pourquoi. Le message vient du
     * connecteur, qui l'a déjà écrit pour elle et sans aucun fragment d'identifiant.
     */
    const raison = error instanceof Error ? error.message : 'Shopify n’a pas répondu.'
    await markConnectionError(userId, connexion.connectionId, raison)
    throw new AppError('VALIDATION', raison)
  }
}
