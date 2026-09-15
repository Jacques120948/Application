import { env } from './env'

/**
 * L'adresse propre d'une application publiée.
 *
 * Une application vit par défaut sous le chemin `/a/<nom-court>` du domaine d'Evoliia.
 * C'est simple, c'est gratuit, et cela se voit : l'adresse annonce l'atelier avant
 * d'annoncer l'application. Quand un domaine d'applications est configuré, chaque
 * application reçoit en plus son propre sous-domaine — `mon-appli-a1b2c3.evoliia.app` —
 * et se sert alors à la racine, sans rien qui rappelle Evoliia.
 *
 * Trois partis pris.
 *
 * **Un seul domaine générique, jamais un domaine par application.** L'hébergeur ne
 * déclare qu'une entrée et qu'un certificat, quel que soit le nombre d'applications :
 * mille créateurs ne coûtent pas mille fois plus. Brancher le domaine d'un créateur est
 * une autre fonction, avec un autre coût, et elle n'est pas ici.
 *
 * **Le nom court fait le sous-domaine, sans champ supplémentaire.** Il est déjà unique en
 * base, déjà limité aux minuscules, chiffres et traits d'union, et il se termine toujours
 * par un suffixe aléatoire — un nom court ne peut donc jamais valoir `www` ou `api`.
 *
 * **L'ancienne adresse continue de fonctionner.** Les liens déjà partagés ne se cassent
 * pas ; la nouvelle adresse devient simplement l'adresse canonique.
 *
 * Aucun secret ici : ce module est lu aussi par le routage de bordure, qui doit rester
 * léger et sans dépendance.
 */

/** Le domaine des applications, ou `null` tant qu'il n'est pas configuré. */
export function appsDomain(): string | null {
  return env.appsDomain ?? null
}

/** Un hôte sans son port, en minuscules. */
function bareHost(host: string | null | undefined): string | null {
  if (host === null || host === undefined || host === '') return null
  const withoutPort = host.split(':')[0]
  return withoutPort === undefined || withoutPort === '' ? null : withoutPort.toLowerCase()
}

/** Une étiquette de sous-domaine valide : ce que produit déjà `slugify`. */
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

/**
 * Le nom court porté par cet hôte, ou `null` quand l'hôte n'est pas celui d'une
 * application. Un sous-domaine à plusieurs niveaux est refusé : seul `x.domaine` compte.
 */
export function slugFromHost(host: string | null | undefined): string | null {
  const domain = appsDomain()
  const bare = bareHost(host)
  if (domain === null || bare === null) return null
  const suffix = `.${domain.toLowerCase()}`
  if (!bare.endsWith(suffix)) return null
  const label = bare.slice(0, -suffix.length)
  return label.length > 0 && label.length <= 63 && LABEL.test(label) ? label : null
}

/** L'hôte d'une application, ou `null` sans domaine configuré. */
export function appHost(slug: string): string | null {
  const domain = appsDomain()
  return domain === null ? null : `${slug}.${domain}`
}

/** Vrai quand la requête arrive sur l'adresse propre de cette application. */
export function servedFromAppHost(host: string | null | undefined, slug: string): boolean {
  return slugFromHost(host) === slug
}

/**
 * Le préfixe des liens internes. Vide sur l'adresse propre, où l'application occupe la
 * racine ; `/a/<nom-court>` sur le domaine partagé, comme avant.
 */
export function appBasePath(host: string | null | undefined, slug: string): string {
  return servedFromAppHost(host, slug) ? '' : `/a/${slug}`
}

/**
 * L'adresse publique complète d'une application : celle qu'on affiche, qu'on copie et
 * qu'on donne à Stripe pour le retour d'un paiement.
 */
export function publicAppUrl(slug: string): string {
  const host = appHost(slug)
  const base = env.appUrl.replace(/\/$/, '')
  if (host === null) return `${base}/a/${slug}`
  // Le protocole suit celui d'Evoliia : `http` en développement, `https` en ligne.
  const protocol = base.startsWith('https://') ? 'https' : 'http'
  return `${protocol}://${host}`
}
