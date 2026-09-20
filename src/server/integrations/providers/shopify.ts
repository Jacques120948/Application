import { logger } from '@/server/observability/logger'
import type { KeyVerifier } from '../verify'

/**
 * Accès à une boutique Shopify, en lecture seule.
 *
 * Cinq décisions portent ce fichier, et chacune vient d'une contrainte réelle.
 *
 * **Par identifiants d'application, et non par jeton collé.** Shopify a retiré en cours de
 * route la création d'applications personnalisées depuis l'administrateur de la boutique :
 * le jeton permanent qu'on collait une fois n'existe plus pour les nouvelles installations.
 * Son remplaçant, pour une boutique qu'on possède, est l'échange d'un identifiant et d'un
 * secret contre un jeton d'accès valable vingt-quatre heures. C'est plus de travail ici, et
 * c'est plus sûr : aucun jeton durable ne dort en base.
 *
 * **Le jeton se frappe à la demande, il ne se conserve pas.** Vingt-quatre heures est une
 * durée assez courte pour qu'une conservation demande une expiration, une invalidation et un
 * renouvellement — trois occasions de servir un jeton périmé, et trois fois plus de code que
 * l'échange lui-même. Un échange coûte un aller-retour ; on le paie à chaque lecture, et on
 * ne garde rien.
 *
 * **Le secret conservé est un triplet.** Des identifiants Shopify ne disent pas à quelle
 * boutique ils s'appliquent. L'adresse fait donc partie de l'accès, et se conserve chiffrée
 * avec lui plutôt que devinée ou reconstituée depuis un libellé.
 *
 * **La version d'API se résout, elle ne se fige pas.** Shopify publie une version par
 * trimestre et retire les anciennes au bout d'un an. Une constante écrite ici cesserait de
 * marcher un jour, chez tout le monde en même temps, avec un message que personne ne peut
 * interpréter. On part d'une version connue ; si elle est refusée, on demande à Shopify la
 * liste de ce qu'il accepte et on prend la plus récente.
 *
 * **Rien ici n'écrit.** Aucune mutation n'est formulée, et les portées déclarées à la
 * création de l'application ne portent que la lecture. Un jeton frappé n'accorde que ce que
 * l'application déclare : celui-ci ne peut pas acquérir l'écriture de lui-même.
 */

/**
 * La version d'API dont on part.
 *
 * Elle n'est pas une garantie : elle sera retirée un jour, et la résolution plus bas est là
 * pour ça. La tenir à jour évite simplement un aller-retour à chaque connexion.
 */
const VERSION_CONNUE = '2026-07'

/** Le temps accordé à Shopify. Au-delà, mieux vaut le dire que faire patienter. */
const DELAI_MS = 20_000

/** Par page. Shopify limite le débit ; des pages plus grosses le font tomber plus vite. */
const PAR_PAGE = 50

/**
 * Ce qu'on rapatrie au plus, par type.
 *
 * Mille tient une boutique ordinaire en entier — celle sur laquelle ce connecteur a été
 * mis au point en compte six cent soixante-douze. Ce plafond n'est tenable que parce que
 * chaque fiche est légère : on ne rapatrie ni le descriptif ni le HTML, seulement les
 * balises et de quoi savoir si le descriptif existe. Le même écran, s'il tirait le contenu
 * complet, ferait plusieurs mégaoctets et ne répondrait plus — c'est exactement ce qui est
 * arrivé à l'exploration de sites, arrêtée à deux cent quatre-vingt-sept pages par le poids
 * de ce qu'elle relisait à chaque tranche.
 */
export const PIECES_MAX = 1_000

export type AccesShopify = {
  /** Adresse en .myshopify.com. Ce n'est pas celle que voient les clients. */
  boutique: string
  /** Identifiant public de l'application. Pas un secret, mais conservé avec le reste. */
  clientId: string
  clientSecret: string
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
 * La valeur ressemble-t-elle à un identifiant d'application ?
 *
 * Volontairement large. Les identifiants de Shopify ont aujourd'hui une forme hexadécimale
 * de trente-deux signes, mais rejeter sur un format est une erreur déjà commise dans ce
 * dépôt, avec une clé Google : le fournisseur avait changé de format, et le contrôle
 * refusait des clés parfaitement valides en affirmant qu'elles n'en étaient pas. Seul ce qui
 * ne peut être aucun identifiant est écarté ; Shopify tranche le reste.
 */
export function ressembleAUnIdentifiant(valeur: string): boolean {
  const propre = valeur.trim()
  return propre.length >= 16 && !/\s/u.test(propre)
}

/** L'accès conservé, relu. `null` quand la connexion est abîmée ou d'un format révolu. */
export function lireAcces(secret: string): AccesShopify | null {
  try {
    const brut = JSON.parse(secret) as Partial<AccesShopify>
    if (typeof brut.boutique !== 'string') return null
    if (typeof brut.clientId !== 'string' || typeof brut.clientSecret !== 'string') return null
    const boutique = normaliserBoutique(brut.boutique)
    if (boutique === null) return null
    return {
      boutique,
      clientId: brut.clientId,
      clientSecret: brut.clientSecret,
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
  /** Les messages d'erreur, qui arrivent sous plusieurs formes selon la couche qui refuse. */
  erreurs: string[]
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

/**
 * Frappe un jeton d'accès à partir des identifiants de l'application.
 *
 * C'est l'échange dit « client credentials » : une intégration qui agit sur ses propres
 * boutiques demande son jeton directement, sans qu'un marchand ait à autoriser quoi que ce
 * soit. Le jeton vaut vingt-quatre heures ; on ne le conserve pas.
 *
 * Ni l'identifiant ni le secret n'entrent dans le journal. Un journal se relit, se copie et
 * s'exporte, et ce couple ouvre une boutique entière aussi longtemps qu'il n'est pas révoqué.
 */
export async function frapperJeton(acces: AccesShopify): Promise<
  { ok: true; jeton: string } | { ok: false; status: number; raison: string }
> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)

  let reponse: Response
  try {
    reponse = await fetch(`https://${acces.boutique}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: acces.clientId,
        client_secret: acces.clientSecret,
        grant_type: 'client_credentials',
      }),
      signal: controle.signal,
    })
  } finally {
    clearTimeout(minuteur)
  }

  const charge = (await reponse.json().catch(() => null)) as {
    access_token?: unknown
    error?: unknown
    error_description?: unknown
  } | null

  if (reponse.status !== 200 || typeof charge?.access_token !== 'string') {
    logger.warn('identifiants Shopify refusés', { status: reponse.status })
    return { ok: false, status: reponse.status, raison: refus(reponse.status, messages(charge?.error_description ?? charge?.error)) }
  }

  return { ok: true, jeton: charge.access_token }
}

/**
 * Un appel à l'API d'administration.
 *
 * GraphQL, parce que l'API REST est officiellement héritée depuis octobre 2024 et que les
 * champs qui nous intéressent n'y sont plus tous exposés.
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

  const versions = (reponse.data.publicApiVersions ?? []) as {
    handle?: string
    supported?: boolean
  }[]
  const stables = versions
    .filter((version) => version.supported === true && /^\d{4}-\d{2}$/u.test(version.handle ?? ''))
    .map((version) => version.handle as string)
    .sort()

  return stables.at(-1) ?? null
}

/** Ce que Shopify a refusé, dit à la personne qui peut y faire quelque chose. */
function refus(status: number, erreurs: readonly string[]): string {
  if (status === 401 || status === 403) {
    return 'Shopify refuse ces identifiants. Vérifiez que vous les avez copiés en entier, et que l’application est bien installée sur cette boutique.'
  }
  if (status === 404) {
    return 'Cette boutique est introuvable chez Shopify. Vérifiez son adresse en .myshopify.com.'
  }
  if (status === 429) {
    return 'Shopify limite les demandes en ce moment. Réessayez dans une minute.'
  }
  const detail = erreurs[0]
  return detail === undefined
    ? 'Shopify n’a pas accepté cette connexion. Vérifiez que l’application a bien été publiée et installée.'
    : `Shopify répond : ${detail.slice(0, 150)}`
}

/**
 * Vérifie un accès avant de l'enregistrer.
 *
 * L'appel sert trois fois : il prouve que les identifiants frappent bien un jeton, que ce
 * jeton ouvre bien cette boutique, et il rapporte son nom, que la personne reconnaîtra dans
 * la liste de ses connexions. Un accès fautif rejeté tout de suite vaut mieux qu'une
 * connexion verte qui échoue au premier usage.
 */
export const verifyShopifyToken: KeyVerifier = async (clientSecret, champs) => {
  const boutique = normaliserBoutique(champs?.boutique ?? '')
  if (boutique === null) {
    return {
      ok: false,
      reason:
        'Cette adresse de boutique n’est pas reconnue. Elle ressemble à « ma-boutique.myshopify.com ».',
    }
  }

  const clientId = (champs?.clientId ?? '').trim()
  if (!ressembleAUnIdentifiant(clientId)) {
    return { ok: false, reason: 'Cet identifiant client est trop court pour en être un.' }
  }
  if (!ressembleAUnIdentifiant(clientSecret)) {
    return { ok: false, reason: 'Ce secret client est trop court pour en être un.' }
  }

  const acces: AccesShopify = { boutique, clientId, clientSecret, version: VERSION_CONNUE }

  let frappe: Awaited<ReturnType<typeof frapperJeton>>
  try {
    frappe = await frapperJeton(acces)
  } catch {
    return { ok: false, reason: 'Shopify est momentanément injoignable. Réessayez.' }
  }
  if (!frappe.ok) return { ok: false, reason: frappe.raison }

  let reponse: Reponse
  try {
    reponse = await appeler(boutique, frappe.jeton, acces.version, REQUETE_BOUTIQUE)
  } catch {
    return { ok: false, reason: 'Shopify est momentanément injoignable. Réessayez.' }
  }

  /*
   * Une version retirée se reconnaît à un refus de la route elle-même. On redemande alors à
   * Shopify ce qu'il accepte, plutôt que de rendre une erreur que personne ne peut corriger
   * de son côté.
   */
  if (reponse.status === 404 || reponse.status === 400) {
    const autre = await versionUtilisable(boutique, frappe.jeton)
    if (autre !== null && autre !== acces.version) {
      logger.info('version d’API Shopify renégociée', { version: autre })
      acces.version = autre
      reponse = await appeler(boutique, frappe.jeton, acces.version, REQUETE_BOUTIQUE).catch(
        () => reponse,
      )
    }
  }

  const shop = reponse.data?.shop as
    | { name?: string; myshopifyDomain?: string; primaryDomain?: { host?: string } }
    | undefined

  if (reponse.status !== 200 || shop?.name === undefined) {
    // Aucun identifiant ni fragment d'identifiant n'entre dans le journal.
    logger.warn('connexion Shopify refusée', { status: reponse.status })
    return { ok: false, reason: refus(reponse.status, reponse.erreurs) }
  }

  const vitrine = shop.primaryDomain?.host
  return {
    ok: true,
    label: vitrine === undefined ? shop.name : `${shop.name} · ${vitrine}`,
    secret: JSON.stringify(acces satisfies AccesShopify),
    /*
     * L'indice porte sur le secret client : c'est lui que la personne a collé et
     * reconnaîtra. Tiré de l'accès entier, il finirait par « "} » — quatre signes qui ne
     * diraient rien à personne.
     */
    hint: clientSecret,
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
  /** La fiche n'a aucun descriptif. Su sans rapatrier le descriptif lui-même. */
  descriptionVide: boolean
}

/** Une fiche en vitrine : ce qu'il faut pour l'illustrer et y renvoyer, rien de plus. */
export type VitrineShopify = {
  titre: string
  handle: string
  /** L'adresse publique de la fiche. Absente quand elle n'est pas en ligne. */
  url: string | null
  /** L'image principale, telle que Shopify la sert. Jamais recopiée ailleurs. */
  image: string
  /** Le texte de remplacement saisi par le marchand, souvent vide. */
  alt: string
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
      id title handle status onlineStoreUrl
      seo { title description }
      # Borné : on ne veut pas le descriptif, on veut savoir s'il existe. Tiré en entier sur
      # mille fiches, il ferait plusieurs mégaoctets pour répondre à une question booléenne.
      apercu: description(truncateAt: 40)
    }
    pageInfo { hasNextPage endCursor }
  }
}`

/*
 * La vitrine : les fiches en ligne qui ont une photo.
 *
 * Le filtre est posé par Shopify, pas par nous : `status:active` écarte les brouillons et
 * les archives sans les faire voyager. Illustrer un article avec la photo d'un produit
 * retiré de la vente est exactement le genre de détail qui se voit tout de suite chez le
 * client, et jamais chez celui qui l'a écrit.
 */
const REQUETE_VITRINE = `query($n: Int!, $apres: String) {
  products(first: $n, after: $apres, query: "status:active") {
    nodes {
      title handle onlineStoreUrl
      featuredImage { url altText }
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
  jeton: string,
  requete: string,
  racine: string,
  convertir: (brut: Brut) => Vu,
  max: number,
): Promise<{ pieces: Vu[]; tronque: boolean }> {
  const pieces: Vu[] = []
  let apres: string | null = null

  while (pieces.length < max) {
    const reponse: Reponse = await appeler(acces.boutique, jeton, acces.version, requete, {
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

/**
 * Les entités HTML les plus courantes, et rien de plus.
 *
 * La table est volontairement courte : elle couvre ce qu'un marchand écrit réellement dans
 * une balise — des esperluettes, des guillemets, des accents échappés par un éditeur. Une
 * table complète ferait deux mille lignes pour traiter des cas qu'aucune fiche produit ne
 * contient. Ce qui n'y figure pas est laissé tel quel plutôt que déformé.
 */
const ENTITES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
  ['laquo', '«'],
  ['raquo', '»'],
  ['hellip', '…'],
  ['rsquo', '’'],
  ['lsquo', '‘'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['ndash', '–'],
  ['mdash', '—'],
  ['eacute', 'é'],
  ['egrave', 'è'],
  ['ecirc', 'ê'],
  ['agrave', 'à'],
  ['acirc', 'â'],
  ['ccedil', 'ç'],
  ['ocirc', 'ô'],
  ['ugrave', 'ù'],
  ['ucirc', 'û'],
  ['icirc', 'î'],
  ['iuml', 'ï'],
  ['euml', 'ë'],
  ['deg', '°'],
  ['euro', '€'],
])

/**
 * Le texte d'une balise, tel qu'un moteur le lira.
 *
 * Shopify conserve les balises telles qu'elles ont été saisies, entités comprises : une
 * description peut contenir `&amp;` là où le visiteur verra `&`. Sans décodage, deux choses
 * seraient fausses — l'écran afficherait `&amp;` en toutes lettres, ce qui fait douter de
 * tout le reste, et surtout le compte de signes serait gonflé de quatre par esperluette. Une
 * description à cent soixante-deux signes affichés peut en faire cent cinquante-huit une fois
 * décodée : de part et d'autre de la borne, donc de part et d'autre du verdict.
 *
 * Un seul passage, jamais récursif : `&amp;amp;` doit rendre `&amp;`, qui est ce que le
 * visiteur verra, et non `&`.
 */
export function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (entier, corps: string) => {
    if (!corps.startsWith('#')) return ENTITES.get(corps.toLowerCase()) ?? entier

    const point =
      corps[1]?.toLowerCase() === 'x'
        ? Number.parseInt(corps.slice(2), 16)
        : Number.parseInt(corps.slice(1), 10)

    // Hors plage ou moitié de paire de substitution : on laisse tel quel plutôt que de lever.
    if (!Number.isFinite(point) || point <= 0 || point > 0x10ffff) return entier
    if (point >= 0xd800 && point <= 0xdfff) return entier
    return String.fromCodePoint(point)
  })
}

/** Le texte d'un métachamp, ou une chaîne vide. Un métachamp absent rend `null`. */
function valeur(champ: unknown): string {
  if (typeof champ !== 'object' || champ === null) return ''
  const lu = (champ as { value?: unknown }).value
  return typeof lu === 'string' ? decoderEntites(lu) : ''
}

export async function lireProduits(
  acces: AccesShopify,
  jeton: string,
  max = PIECES_MAX,
): Promise<{ pieces: ProduitShopify[]; tronque: boolean }> {
  type Brut = {
    id: string
    title: string
    handle: string
    status: string
    onlineStoreUrl: string | null
    apercu: string | null
    seo: { title: string | null; description: string | null } | null
  }

  return parcourir<Brut, ProduitShopify>(
    acces,
    jeton,
    REQUETE_PRODUITS,
    'products',
    (brut) => ({
      id: brut.id,
      titre: brut.title,
      handle: brut.handle,
      statut: brut.status,
      url: brut.onlineStoreUrl,
      metaTitle: decoderEntites(brut.seo?.title ?? ''),
      metaDescription: decoderEntites(brut.seo?.description ?? ''),
      descriptionVide: (brut.apercu ?? '').trim() === '',
    }),
    max,
  )
}

/**
 * Les fiches qui peuvent illustrer un article.
 *
 * Bornée plus serré que la lecture d'audit : on cherche de quoi illustrer cinq sections, pas
 * de quoi inventorier une boutique. Une fiche sans photo est écartée ici plutôt que plus
 * loin — elle ne sert à rien et occuperait une place dans la borne.
 */
export async function lireVitrine(
  acces: AccesShopify,
  jeton: string,
  max: number,
): Promise<{ pieces: VitrineShopify[]; tronque: boolean }> {
  type Brut = {
    title: string
    handle: string
    onlineStoreUrl: string | null
    featuredImage: { url: string | null; altText: string | null } | null
  }

  const lu = await parcourir<Brut, VitrineShopify | null>(
    acces,
    jeton,
    REQUETE_VITRINE,
    'products',
    (brut) => {
      const image = brut.featuredImage?.url ?? ''
      if (image === '') return null
      return {
        titre: decoderEntites(brut.title),
        handle: brut.handle,
        url: brut.onlineStoreUrl,
        image,
        alt: decoderEntites(brut.featuredImage?.altText ?? ''),
      }
    },
    max,
  )

  return {
    pieces: lu.pieces.filter((piece): piece is VitrineShopify => piece !== null),
    tronque: lu.tronque,
  }
}

export async function lireArticles(
  acces: AccesShopify,
  jeton: string,
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
    jeton,
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
