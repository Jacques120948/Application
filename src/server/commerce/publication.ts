import { AppError, validation } from '@/lib/errors'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { markConnectionError, useCredential } from '@/server/integrations/service'
import {
  deposerBrouillon,
  frapperJeton,
  lireAcces,
  lireBlogs,
  televerserImages,
  type AccesShopify,
} from '@/server/integrations/providers/shopify'
import { readArticle } from '@/server/audit/articles'
import { SHOPIFY_FEATURE } from './boutique'

/**
 * Le dépôt d'un article dans Shopify.
 *
 * C'est la première et la seule chose qu'Evoliia écrive hors de sa propre base. Trois règles
 * la tiennent, et la première n'est pas négociable.
 *
 * **Un brouillon, jamais une publication.** L'article arrive dans Shopify non publié. Le
 * marchand le relit chez lui, dans l'écran qu'il connaît, et publie lui-même. Une
 * intelligence artificielle qui publie seule sur une boutique marchande, c'est le jour où
 * elle publie une bêtise et où son propriétaire l'apprend par un client. Aucun réglage ne
 * permet de changer ça : `isPublished` vaut `false`, en dur, dans le connecteur.
 *
 * **Une seule fois.** Un article déjà déposé porte son identifiant Shopify. Le redéposer
 * créerait un doublon dans la boutique — et le contenu dupliqué est précisément ce que
 * l'analyse reproche ensuite.
 *
 * **Rien n'est débité.** Le texte a déjà été payé quand il a été écrit. L'envoyer est un
 * appel d'API sans frais : le refacturer reviendrait à faire payer deux fois le même
 * travail.
 */

/**
 * L'auteur de l'article, tel qu'il s'affiche sur la boutique.
 *
 * C'est le nom de la boutique, pas celui d'Evoliia. L'article paraît chez le marchand,
 * sous sa marque, et signer du nom de l'outil qui l'a mis en forme reviendrait à mettre
 * le nom de son traitement de texte au bas de ses lettres. Le marchand le change dans
 * Shopify s'il préfère autre chose.
 *
 * Quand Shopify ne rend pas de nom, on retombe sur la poignée de la boutique — moins
 * joli, toujours le sien.
 */
export function auteur(nomDeBoutique: string, boutique: string): string {
  const propre = nomDeBoutique.trim()
  if (propre !== '') return propre.slice(0, 100)
  return boutique.replace(/\.myshopify\.com$/u, '')
}

/** Échappe ce qui partirait pour du HTML. Le texte vient d'un modèle, jamais de confiance. */
function echapper(texte: string): string {
  return texte
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
}

/**
 * Le corps de l'article, du Markdown simple vers le HTML qu'attend Shopify.
 *
 * Écrit à la main plutôt qu'emprunté à une bibliothèque, pour une raison de sûreté : ce
 * texte vient d'un modèle et part sur une boutique en ligne. Un convertisseur complet
 * accepterait le HTML brut mêlé au Markdown, et donc tout ce qu'un modèle pourrait produire
 * — une balise de script, un cadre, un pixel de suivi. Ici, seules quatre formes existent :
 * intertitre, paragraphe, liste, image. Tout le reste est échappé et devient du texte.
 *
 * Ce n'est pas une conversion générale du Markdown, et elle n'a pas à l'être : c'est la
 * conversion de ce que Milo produit, dont la forme est fixée par son schéma.
 */
/**
 * La légende d'une photo : le nom de la fiche, cliquable quand elle est en ligne.
 *
 * L'image était déjà enveloppée dans un lien, mais rien ne le montrait — il fallait la
 * survoler pour découvrir qu'elle menait quelque part. Une légende donne au lecteur un
 * repère visible, et à Google une ancre lisible : l'ancre d'un lien-image se réduit à son
 * texte alternatif.
 */
function legende(photo: { titre?: string; lien: string | null }): string {
  const nom = (photo.titre ?? '').trim()
  if (nom === '') return ''
  const texte = echapper(nom)
  return photo.lien === null
    ? `<p><em>${texte}</em></p>`
    : `<p><em><a href="${echapper(photo.lien)}">${texte}</a></em></p>`
}

export function enHtml(
  corps: string,
  illustrations: readonly {
    section: number
    image: string
    alt: string
    lien: string | null
    titre?: string
  }[],
): string {
  const blocs = corps.split(/\n{2,}/u).filter((bloc) => bloc.trim() !== '')
  const sortie: string[] = []
  let section = -1

  for (const bloc of blocs) {
    const propre = bloc.trim()

    if (propre.startsWith('## ')) {
      section += 1
      sortie.push(`<h2>${echapper(propre.slice(3).trim())}</h2>`)

      const photo = illustrations.find((image) => image.section === section)
      if (photo !== undefined) {
        const balise = `<img src="${echapper(photo.image)}" alt="${echapper(photo.alt)}" loading="lazy">`
        sortie.push(
          photo.lien === null
            ? `<p>${balise}</p>`
            : `<p><a href="${echapper(photo.lien)}">${balise}</a></p>`,
        )
        const sous = legende(photo)
        if (sous !== '') sortie.push(sous)
      }
      continue
    }

    const lignes = propre.split('\n')
    if (lignes.every((ligne) => /^\s*[-*]\s+/u.test(ligne))) {
      const items = lignes
        .map((ligne) => `<li>${echapper(ligne.replace(/^\s*[-*]\s+/u, ''))}</li>`)
        .join('')
      sortie.push(`<ul>${items}</ul>`)
      continue
    }

    sortie.push(`<p>${echapper(propre)}</p>`)
  }

  return sortie.join('\n')
}

/** Les questions en fin d'article, déclarées comme telles. */
function questionsEnHtml(questions: readonly { question: string; reponse: string }[]): string {
  if (questions.length === 0) return ''
  const blocs = questions
    .map((paire) => `<h3>${echapper(paire.question)}</h3>\n<p>${echapper(paire.reponse)}</p>`)
    .join('\n')
  return `\n<h2>Questions fréquentes</h2>\n${blocs}`
}

/**
 * Ouvre la boutique : la connexion, l'offre, puis le jeton.
 *
 * Mis en commun parce que deux entrées en ont besoin — lister les blogs pour choisir, et
 * déposer dedans. L'ordre ne change pas : ce qui n'a pas lieu d'être est refusé avant de
 * toucher au réseau.
 */
async function ouvrirBoutique(
  userId: string,
): Promise<{ acces: AccesShopify; jeton: string; connectionId: string }> {
  const connexion = await useCredential(userId, 'shopify')
  if (connexion === null) {
    throw validation('Aucune boutique Shopify n’est connectée.')
  }
  requireFeature(await getEntitlements(userId), SHOPIFY_FEATURE)

  const acces = lireAcces(connexion.secret)
  if (acces === null) {
    await markConnectionError(userId, connexion.connectionId, 'Accès illisible. Reconnectez Shopify.')
    throw validation('Votre connexion Shopify est abîmée. Reconnectez-la.')
  }

  const frappe = await frapperJeton(acces)
  if (!frappe.ok) {
    await markConnectionError(userId, connexion.connectionId, frappe.raison)
    throw new AppError('VALIDATION', frappe.raison)
  }

  return { acces, jeton: frappe.jeton, connectionId: connexion.connectionId }
}

/** Un blog de la boutique, tel que l'écran le propose. */
export type BlogChoisissable = { id: string; titre: string }

/**
 * Le blog qui recevra l'article, parmi ceux que la boutique vient de rendre.
 *
 * Le choix vient du navigateur : il est retrouvé dans la liste, jamais employé tel quel.
 * Sans cela, un identifiant fabriqué désignerait un blog d'une autre boutique — et une
 * écriture qui accepte une cible non vérifiée est exactement la façon dont on dépose chez
 * quelqu'un d'autre.
 *
 * Un choix devenu introuvable — blog supprimé entre l'affichage et le clic — rend
 * `undefined` plutôt que le premier venu : déposer ailleurs que là où l'on a dit ne se
 * rattrape pas, l'article est public dès qu'il est publié.
 */
export function choisirBlog<T extends { id: string }>(
  blogs: readonly T[],
  demande: string | undefined,
): T | undefined {
  if (demande === undefined || demande === '') return blogs[0]
  return blogs.find((candidat) => candidat.id === demande)
}

/**
 * Les blogs où l'article peut atterrir.
 *
 * Une boutique en a souvent plusieurs — « Bougies », « Minéraux », « Bijoux » — et déposer
 * dans le premier que Shopify renvoie revient à choisir au hasard pour quelqu'un qui, lui,
 * sait très bien où va son texte.
 */
export async function blogsDisponibles(userId: string): Promise<BlogChoisissable[]> {
  const { acces, jeton } = await ouvrirBoutique(userId)
  const blogs = await lireBlogs(acces, jeton)
  if (!blogs.ok) throw new AppError('VALIDATION', blogs.raison)
  return blogs.blogs.map((blog) => ({ id: blog.id, titre: blog.titre }))
}

export type Depot = {
  /** L'identifiant Shopify de l'article créé. */
  shopifyId: string
  /** L'adresse de l'écran Shopify où le relire et le publier. */
  lien: string
  blog: string
  /**
   * Images créées qui n'ont pas pu être copiées dans la boutique, et pourquoi.
   *
   * Zéro dans le cas normal. Au-dessus, l'article est déposé et complet — ces images-là
   * restent servies par Evoliia — mais la personne doit le savoir : c'est une dépendance
   * qu'elle n'a pas choisie, et la cause est presque toujours une portée manquante sur sa
   * clé Shopify, qui se corrige en une minute.
   */
  imagesNonCopiees: number
  raisonImages: string | null
}

/**
 * Dépose un article rédigé dans le blog Shopify, en brouillon.
 *
 * L'ordre des vérifications compte : on refuse d'abord ce qui n'a pas lieu d'être — article
 * inconnu, déjà déposé, offre qui ne l'ouvre pas — avant de toucher au réseau. Un appel
 * lancé puis regretté laisserait un brouillon orphelin dans la boutique de quelqu'un.
 */
export async function deposerDansShopify(
  userId: string,
  articleId: string,
  blogDemande?: string,
): Promise<Depot> {
  const article = await readArticle(userId, articleId)

  const deja = await withUserScope(userId, (tx) =>
    tx.siteArticle.findFirst({
      where: { id: articleId, userId },
      select: { shopifyId: true, shopifyUrl: true },
    }),
  )
  if (deja?.shopifyId != null && deja.shopifyId !== '') {
    throw validation('Cet article est déjà dans Shopify. Relisez-le là-bas.')
  }

  const { acces, jeton } = await ouvrirBoutique(userId)

  const blogs = await lireBlogs(acces, jeton)
  if (!blogs.ok) throw new AppError('VALIDATION', blogs.raison)
  if (blogs.blogs.length === 0) {
    throw validation(
      'Votre boutique n’a aucun blog. Créez-en un dans Shopify, puis réessayez.',
    )
  }

  const blog = choisirBlog(blogs.blogs, blogDemande)
  if (blog === undefined) {
    throw validation('Ce blog n’existe plus dans votre boutique. Rouvrez la page et réessayez.')
  }

  /*
   * La première photo devient l'image à la une, et quitte le corps.
   *
   * Sans elle, l'article n'a pas de vignette : il apparaît nu sur la liste du blog et dans
   * les partages, alors que la boutique a les photos qu'il faut. La retirer du corps évite
   * de la voir deux fois — la plupart des thèmes affichent l'image à la une en tête de
   * l'article, juste au-dessus du texte où elle se trouvait.
   *
   * C'est le seul endroit où cette distinction existe : l'écran d'Evoliia et la copie en
   * Markdown gardent toutes les photos dans le texte, faute d'un « à la une » où la mettre.
   */
  /*
   * Les images créées passent chez le marchand avant l'article.
   *
   * Une image créée pour illustrer une section est hébergée chez Evoliia le temps de
   * l'écrire. Si on la laissait là, le blog du marchand pointerait indéfiniment vers une
   * adresse d'Evoliia : une dépendance qu'il n'a pas demandée, une bande passante servie
   * sans fin, et des images qui casseraient le jour où son compte serait fermé. Une image
   * qui illustre son blog doit vivre chez lui.
   *
   * Les photos de ses produits, elles, ne bougent pas : elles sont déjà dans sa boutique,
   * les téléverser une seconde fois y créerait des doublons.
   *
   * Un échec ne fait pas échouer le dépôt. L'article part avec les adresses d'Evoliia, qui
   * fonctionnent, et la personne est prévenue de ce qui n'a pas abouti — c'est infiniment
   * mieux qu'un article perdu pour une portée manquante.
   */
  const creees = article.illustrations.filter((photo) => photo.genere === true)
  const televerse = await televerserImages(
    acces,
    jeton,
    creees.map((photo) => ({ url: photo.image, alt: photo.alt })),
  ).catch(() => ({ ok: false as const, raison: 'Le téléversement des images a échoué.' }))

  const adresses = televerse.ok ? televerse.adresses : new Map<string, string>()
  const restees = creees.filter((photo) => !adresses.has(photo.image)).length

  const rangees = [...article.illustrations]
    .sort((une, autre) => une.section - autre.section)
    .map((photo) => {
      const chezLeMarchand = adresses.get(photo.image)
      return chezLeMarchand === undefined ? photo : { ...photo, image: chezLeMarchand }
    })
  const [vedette, ...dansLeCorps] = rangees

  const depot = await deposerBrouillon(acces, jeton, {
    blogId: blog.id,
    titre: article.titre,
    auteur: auteur(blogs.boutique, acces.boutique),
    ...(vedette === undefined
      ? {}
      : { image: { url: vedette.image, altText: vedette.alt } }),
    /*
     * La légende de l'image à la une ouvre le corps, juste sous la photo que le thème
     * affiche en tête. Sans elle, cette photo-là ne mènerait à rien : Shopify n'enveloppe
     * pas l'image à la une dans un lien, et c'est un renvoi vers une fiche qu'on perdrait.
     */
    corpsHtml: `${vedette === undefined ? '' : `${legende(vedette)}\n`}<p>${echapper(article.chapo)}</p>\n${enHtml(article.corps, dansLeCorps)}${questionsEnHtml(article.questions)}`,
    resume: `<p>${echapper(article.chapo)}</p>`,
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
  })
  if (!depot.ok) throw new AppError('VALIDATION', depot.raison)

  /*
   * L'identifiant de Shopify est un « gid://shopify/Article/123 ». L'écran d'édition, lui,
   * veut le nombre seul, précédé du blog. On garde les deux : l'identifiant pour savoir que
   * c'est fait, le lien pour y aller.
   */
  const numero = depot.article.id.split('/').at(-1) ?? ''
  const numeroBlog = blog.id.split('/').at(-1) ?? ''
  const lien = `https://${acces.boutique}/admin/articles/${numero}`

  await withUserScope(userId, (tx) =>
    tx.siteArticle.updateMany({
      where: { id: articleId, userId },
      data: { shopifyId: depot.article.id, shopifyUrl: lien, shopifyAt: new Date() },
    }),
  )

  logger.info('article déposé dans Shopify', {
    blog: numeroBlog,
    brouillon: true,
    imagesCopiees: adresses.size,
    imagesRestees: restees,
  })
  return {
    shopifyId: depot.article.id,
    lien,
    blog: blog.titre,
    imagesNonCopiees: restees,
    raisonImages: televerse.ok ? null : televerse.raison,
  }
}
