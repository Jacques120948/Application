import { logger } from '@/server/observability/logger'
import type { KeyVerifier } from '../verify'

/**
 * Accès à une boutique Shopify, en lecture seule.
 *
 * Quatre décisions portent ce fichier, et chacune vient d'une contrainte réelle.
 *
 * **Par jeton, pas par OAuth.** Shopify propose les deux. L'autorisation en un clic suppose
 * une application publique, donc une revue de Shopify et des webhooks de conformité — des
 * semaines avant qu'un seul marchand puisse s'en servir, et une validation qui ne dépend pas
 * d'Evoliia. Le jeton d'application personnalisée marche le jour même.
 *
 * **Le secret conservé est une paire.** Un jeton Shopify n'est valable que pour une boutique,
 * et rien dans le jeton ne dit laquelle. L'adresse fait donc partie de l'accès, et se
 * conserve chiffrée avec lui plutôt que devinée ou reconstituée depuis un libellé.
 *
 * **La version d'API se résout, elle ne se fige pas.** Shopify publie une version par
 * trimestre et retire les anciennes au bout d'un an. Une constante écrite ici cesserait de
 * marcher un jour, chez tout le monde en même temps, avec un message que personne ne peut
 * interpréter. On part d'une version connue ; si elle est refusée, on demande à Shopify la
 * liste de ce qu'il accepte et on prend la plus récente. La version retenue voyage avec
 * l'accès.
 *
 * **Rien ici n'écrit.** Aucune mutation n'est formulée, et les autorisations demandées à
 * l'installation ne portent que la lecture. Un jeton accorde exactement ce qui a été coché :
 * celui-ci ne peut pas acquérir l'écriture après coup.
 */

/**
 * La version d'API dont on part.
 *
 * Elle n'est pas une garantie : elle sera retirée un jour, et la résolution ci-dessous est
 * là pour ça. La tenir à jour évite simplement un aller-retour à chaque connexion.
 */
const VERSION_CONNUE = '2026-07'

/** Le temps accordé à Shopify. Au-delà, mieux vaut le dire que faire patienter. */
const DELAI_MS = 20_000

/** Par page. Shopify limite le débit ; des pages plus grosses le font tomber plus vite. */
const PAR_PAGE = 50

/** Ce qu'on rapatrie au plus, par type. Au-delà, l'écran ne se lit plus de toute façon. */
export const PIECES_MAX = 250

export type AccesShopify = {
  /** Adresse en .myshopify.com. Ce n'est pas celle que voient les clients. */
  boutique: string
  jeton: string
  version: string
}

/**
 * L'adresse d'une boutique, telle qu'on peut l'employer.
 *
 * On accepte ce que les gens collent réellement : une adresse complète avec son protocole,
 * une barre oblique finale, ou le seul identifiant de la boutique. On rend `null` pour tout
 * le reste plutôt que de bricoler une adresse qui échouerait plus loin, dans un message que
 * personne ne saurait relier à ce champ.
 */
export function normaliserBoutique(brut: string): string | null {
  const propre = brut
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/\/.*$/u, '')

  if (propre === '') return null
  const nom = propre.endsWith('.myshopify.com') ? propre.slice(0, -'.myshopify.com'.length) : propre
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/u.test(nom)) return null
  return `${nom}.myshopify.com`
}

/**
 * Le jeton ressemble-t-il à un jeton ?
 *
 * Volontairement large. Les jetons d'application personnalisée commencent aujourd'hui par
 * `shpat_`, mais rejeter sur un préfixe est une erreur déjà commise ici avec une autre clé :
 * le fournisseur change ses formats, et le contrôle refuse alors des clés parfaitement
 * valides. Seul ce qui ne peut être aucun jeton est écarté ; Shopify tranche le reste.
 */
export function ressembleAUnJeton(valeur: string): boolean {
  const propre = valeur.trim()
  return propre.length >= 20 && !/\s/u.test(propre)
}

/** L'accès conservé, relu. `null` quand la connexion date d'avant ce format ou est abîmée. */
export function lireAcces(secret: string): AccesShopify | null {
  try {
    const brut = JSON.parse(secret) as Partial<AccesShopify>
    if (typeof brut.boutique !== 'string' || typeof brut.jeton !== 'string') return null
    const boutique = normaliserBoutique(brut.boutique)
    if (boutique === null) return null
    return {
      boutique,
      jeton: brut.jeton,
      version: typeof brut.version === 'string' ? brut.version : VERSION_CONNUE,
    }
  } catch {
    return null
  }
}

type Reponse = {
  status: number
  /** Les données, ou `null` quand la réponse n'en portait pas. */
  data: Record<string, unknown> | null
  /** Les messages d'erreur de GraphQL, qui répond souvent 200 en refusant. */
  erreurs: string[]
}

/**
 * Un appel à l'API d'administration.
 *
 * GraphQL, parce que l'API REST est officiellement héritée depuis octobre 2024 et que les
 * champs qui nous intéressent n'y sont plus tous exposés.
 *
 * Aucun jeton n'entre dans le journal, jamais : ni en entier, ni en fragment. Un journal se
 * relit, se copie et s'exporte, et un jeton Shopify ouvre une boutique entière.
 */
async function appeler(
  boutique: string,
  jeton: string,
  version: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<Reponse> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)

  let reponse: Response
  try {
    reponse = await fetch(`https://${boutique}/admin/api/${version}/graphql.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Shopify-Access-Token': jeton,
      },
      body: JSON.stringify({ query, variables }),
      signal: controle.signal,
    })
  } finally {
    clearTimeout(minuteur)
  }

  const charge = (await reponse.json().catch(() => null)) as {
    data?: Record<string, unknown>
    errors?: unknown
  } | null

  return {
    status: reponse.status,
    data: charge?.data ?? null,
    erreurs: messages(charge?.errors),
  }
}

/**
 * Les erreurs d'une réponse, quelle que soit la forme qu'elles ont prise.
 *
 * GraphQL rend une liste d'objets à `message`. Mais un refus d'authentification, qui est de
 * loin le cas le plus fréquent, ne passe pas par GraphQL : la couche d'administration répond
 * avant, et `errors` est alors une simple chaîne. Supposer la liste faisait échouer la
 * lecture et annonçait « Shopify injoignable » — le mauvais diagnostic sur la panne la plus
 * courante, et celui qui empêche la personne de corriger ce qu'elle peut corriger.
 */
function messages(brut: unknown): string[] {
  if (typeof brut === 'string') return brut.trim() === '' ? [] : [brut]
  if (!Array.isArray(brut)) return []
  return brut
    .map((erreur) => {
      if (typeof erreur === 'string') return erreur
      if (typeof erreur === 'object' && erreur !== null) {
        const message = (erreur as { message?: unknown }).message
        return typeof message === 'string' ? message : ''
      }
      return ''
    })
    .filter((message) => message !== '')
}

const REQUETE_BOUTIQUE = `{
  shop { name myshopifyDomain primaryDomain { host } }
}`

const REQUETE_VERSIONS = `{
  publicApiVersions { handle supported }
}`

/**
 * La version d'API à employer, demandée à Shopify quand celle qu'on connaît est refusée.
 *
 * On interroge par `unstable`, seule poignée dont l'existence ne dépend pas du calendrier.
 * C'est acceptable ici et nulle part ailleurs : la requête ne lit aucune donnée de la
 * boutique, elle demande la liste des versions.
 */
async function versionUtilisable(boutique: string, jeton: string): Promise<string | null> {
  const reponse = await appeler(boutique, jeton, 'unstable', REQUETE_VERSIONS).catch(() => null)
  if (reponse === null || reponse.data === null) return null

  const versions = (reponse.data.publicApiVersions ?? []) as { handle?: string; supported?: boolean }[]
  const stables = versions
    .filter((version) => version.supported === true && /^\d{4}-\d{2}$/u.test(version.handle ?? ''))
    .map((version) => version.handle as string)
    .sort()

  return stables.at(-1) ?? null
}

/** Ce que Shopify a refusé, dit à la personne qui peut y faire quelque chose. */
function refus(status: number, erreurs: readonly string[]): string {
  if (status === 401 || status === 403) {
    return 'Shopify refuse ce jeton. Vérifiez que vous l’avez copié en entier, et que l’application est bien installée sur cette boutique.'
  }
  if (status === 404) {
    return 'Cette boutique est introuvable chez Shopify. Vérifiez son adresse en .myshopify.com.'
  }
  if (status === 429) {
    return 'Shopify limite les demandes en ce moment. Réessayez dans une minute.'
  }
  const detail = erreurs[0]
  return detail === undefined
    ? 'Shopify n’a pas accepté cette connexion. Réessayez, ou recréez un jeton.'
    : `Shopify répond : ${detail.slice(0, 150)}`
}

/**
 * Vérifie un accès avant de l'enregistrer.
 *
 * L'appel sert deux fois : il prouve que le jeton ouvre bien cette boutique, et il rapporte
 * son nom, que la personne reconnaîtra dans la liste de ses connexions. Un accès fautif
 * rejeté tout de suite vaut mieux qu'une connexion verte qui échoue au premier usage.
 */
export const verifyShopifyToken: KeyVerifier = async (jeton, compte) => {
  const boutique = normaliserBoutique(compte ?? '')
  if (boutique === null) {
    return {
      ok: false,
      reason:
        'Cette adresse de boutique n’est pas reconnue. Elle ressemble à « ma-boutique.myshopify.com ».',
    }
  }
  if (!ressembleAUnJeton(jeton)) {
    return { ok: false, reason: 'Ce jeton est trop court pour être un jeton Shopify.' }
  }

  let version = VERSION_CONNUE
  let reponse: Reponse
  try {
    reponse = await appeler(boutique, jeton, version, REQUETE_BOUTIQUE)
  } catch {
    return { ok: false, reason: 'Shopify est momentanément injoignable. Réessayez.' }
  }

  /*
   * Une version retirée se reconnaît à un refus de la route elle-même. On redemande alors à
   * Shopify ce qu'il accepte, plutôt que de rendre une erreur que personne ne peut corriger
   * de son côté.
   */
  if (reponse.status === 404 || reponse.status === 400) {
    const autre = await versionUtilisable(boutique, jeton)
    if (autre !== null && autre !== version) {
      logger.info('version d’API Shopify renégociée', { version: autre })
      version = autre
      reponse = await appeler(boutique, jeton, version, REQUETE_BOUTIQUE).catch(() => reponse)
    }
  }

  const shop = reponse.data?.shop as
    | { name?: string; myshopifyDomain?: string; primaryDomain?: { host?: string } }
    | undefined

  if (reponse.status !== 200 || shop?.name === undefined) {
    // Ni le jeton ni un fragment de jeton n'entrent dans le journal.
    logger.warn('connexion Shopify refusée', { status: reponse.status })
    return { ok: false, reason: refus(reponse.status, reponse.erreurs) }
  }

  const vitrine = shop.primaryDomain?.host
  return {
    ok: true,
    label: vitrine === undefined ? shop.name : `${shop.name} · ${vitrine}`,
    secret: JSON.stringify({ boutique, jeton, version } satisfies AccesShopify),
    // L'indice porte sur le jeton : c'est lui que la personne a collé et reconnaîtra.
    hint: jeton,
  }
}

export type ProduitShopify = {
  id: string
  titre: string
  handle: string
  /** ACTIVE | DRAFT | ARCHIVED, tel que Shopify le dit. */
  statut: string
  url: string | null
  metaTitle: string
  metaDescription: string
  /** Longueur du descriptif, en signes. Sert à repérer une fiche vide sans la rapatrier. */
  descriptionLongueur: number
}

export type ArticleShopify = {
  id: string
  titre: string
  handle: string
  blog: string
  publie: boolean
  metaTitle: string
  metaDescription: string
}

const REQUETE_PRODUITS = `query($n: Int!, $apres: String) {
  products(first: $n, after: $apres) {
    nodes {
      id title handle status onlineStoreUrl descriptionHtml
      seo { title description }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

/*
 * Les balises d'un article ne vivent pas dans un champ `seo` : le type `Article` n'en a pas.
 * Elles sont rangées dans ses métachamps `global`, sous `title_tag` et `description_tag` —
 * la convention de Shopify pour les articles, les pages et les blogs. Vérifié sur une vraie
 * boutique : demander `seo` ici fait échouer toute la requête.
 */
const REQUETE_ARTICLES = `query($n: Int!, $apres: String) {
  articles(first: $n, after: $apres) {
    nodes {
      id title handle isPublished
      blog { title }
      titleTag: metafield(namespace: "global", key: "title_tag") { value }
      descriptionTag: metafield(namespace: "global", key: "description_tag") { value }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

/** Ce qu'une page de résultats a rendu, quel que soit le type demandé. */
type Page<T> = { nodes: T[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } }

/**
 * Parcourt une liste paginée jusqu'à la borne.
 *
 * Shopify limite le débit par un seau qui se vide : une boutique de mille fiches se lit, mais
 * lentement. La borne est là pour que l'écran réponde, pas pour cacher quoi que ce soit — ce
 * qui a été tronqué est dit.
 */
async function parcourir<Brut, Vu>(
  acces: AccesShopify,
  requete: string,
  racine: string,
  convertir: (brut: Brut) => Vu,
  max: number,
): Promise<{ pieces: Vu[]; tronque: boolean }> {
  const pieces: Vu[] = []
  let apres: string | null = null

  while (pieces.length < max) {
    const reponse: Reponse = await appeler(acces.boutique, acces.jeton, acces.version, requete, {
      n: Math.min(PAR_PAGE, max - pieces.length),
      apres,
    })
    if (reponse.status !== 200 || reponse.data === null) {
      throw new Error(refus(reponse.status, reponse.erreurs))
    }

    const page = reponse.data[racine] as Page<Brut> | undefined
    if (page === undefined) break

    for (const brut of page.nodes) pieces.push(convertir(brut))
    if (page.pageInfo?.hasNextPage !== true) return { pieces, tronque: false }
    apres = page.pageInfo.endCursor ?? null
    if (apres === null) return { pieces, tronque: false }
  }

  return { pieces, tronque: true }
}

/** Le texte d'un métachamp, ou une chaîne vide. Un métachamp absent rend `null`. */
function valeur(champ: unknown): string {
  if (typeof champ !== 'object' || champ === null) return ''
  const lu = (champ as { value?: unknown }).value
  return typeof lu === 'string' ? lu : ''
}

export async function lireProduits(
  acces: AccesShopify,
  max = PIECES_MAX,
): Promise<{ pieces: ProduitShopify[]; tronque: boolean }> {
  type Brut = {
    id: string
    title: string
    handle: string
    status: string
    onlineStoreUrl: string | null
    descriptionHtml: string | null
    seo: { title: string | null; description: string | null } | null
  }

  return parcourir<Brut, ProduitShopify>(
    acces,
    REQUETE_PRODUITS,
    'products',
    (brut) => ({
      id: brut.id,
      titre: brut.title,
      handle: brut.handle,
      statut: brut.status,
      url: brut.onlineStoreUrl,
      metaTitle: brut.seo?.title ?? '',
      metaDescription: brut.seo?.description ?? '',
      descriptionLongueur: (brut.descriptionHtml ?? '').replace(/<[^>]*>/gu, '').trim().length,
    }),
    max,
  )
}

export async function lireArticles(
  acces: AccesShopify,
  max = PIECES_MAX,
): Promise<{ pieces: ArticleShopify[]; tronque: boolean }> {
  type Brut = {
    id: string
    title: string
    handle: string
    isPublished: boolean
    blog: { title: string } | null
    titleTag: unknown
    descriptionTag: unknown
  }

  return parcourir<Brut, ArticleShopify>(
    acces,
    REQUETE_ARTICLES,
    'articles',
    (brut) => ({
      id: brut.id,
      titre: brut.title,
      handle: brut.handle,
      blog: brut.blog?.title ?? '',
      publie: brut.isPublished,
      metaTitle: valeur(brut.titleTag),
      metaDescription: valeur(brut.descriptionTag),
    }),
    max,
  )
}
