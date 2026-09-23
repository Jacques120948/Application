import { lookup as dnsLookup } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { validation } from '@/lib/errors'

/**
 * Aller chercher une page sur Internet sans se faire retourner contre soi.
 *
 * C'est la pièce la plus dangereuse de tout le produit. Evoliia va, sur commande d'un
 * utilisateur, émettre des requêtes vers une adresse qu'il choisit. Sans garde-fou, cette
 * fonction est une porte ouverte sur tout ce que le serveur peut joindre et que l'extérieur
 * ne peut pas : la base de données, les services internes de l'hébergeur, et surtout les
 * métadonnées d'instance — l'endroit précis où un fournisseur de cloud range les jetons
 * d'identité de la machine. Une requête vers `169.254.169.254` qui renvoie son contenu à
 * l'utilisateur, c'est la fin de la partie.
 *
 * Quatre défenses, et aucune n'est optionnelle.
 *
 * **Le protocole est décidé par nous.** `http` et `https`, rien d'autre. Un `file://` lirait
 * le disque, un `gopher://` parlerait à des services qui ne parlent pas HTTP.
 *
 * **L'adresse est vérifiée après résolution, pas avant.** Interdire « localhost » ne sert à
 * rien : n'importe quel nom de domaine public peut pointer vers 127.0.0.1, et c'est la façon
 * ordinaire de contourner un filtre écrit sur le texte. On résout le nom, on regarde où il
 * mène vraiment, et on refuse toute adresse qui n'est pas publique.
 *
 * **L'adresse vérifiée est celle qui est appelée.** C'est le point que presque toutes les
 * implémentations manquent. Vérifier la résolution puis laisser le client refaire sa propre
 * résolution laisse une fenêtre : entre les deux, le domaine peut répondre une autre adresse
 * — un serveur de noms hostile n'a qu'à alterner. En passant notre propre résolveur au
 * client, l'adresse contrôlée est exactement celle qui sera jointe. Le nom continue de
 * servir au certificat et à l'en-tête `Host`, donc rien n'est cassé.
 *
 * **Chaque redirection repasse par tout ce qui précède.** Une page publique qui renvoie vers
 * `http://127.0.0.1:5432` est le contournement le plus simple qui soit, et le plus courant.
 *
 * S'y ajoutent trois bornes qui ne protègent pas contre une attaque mais contre un accident :
 * un délai, une taille maximale lue au fil de l'eau, et un nombre de redirections. Sans la
 * deuxième, une adresse servant un flux infini remplirait la mémoire du serveur.
 */

/** Au-delà, ce n'est plus une page web, et nous n'en ferions rien. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Un serveur qui n'a pas répondu en dix secondes ne répondra pas mieux en trente. */
export const TIMEOUT_MS = 10_000

/** Trois sauts suffisent à tout usage légitime ; au-delà, c'est une boucle. */
export const MAX_REDIRECTS = 3

/** Ce qu'Evoliia annonce être. Un robot qui se cache se fait bloquer, et il le mérite. */
export const USER_AGENT = 'EvoliiaBot/1.0 (+https://evoliia.com/robot)'

/**
 * Les adresses que le serveur peut joindre et que le public ne peut pas.
 *
 * La liste est écrite en dur plutôt que déduite : chaque plage a une raison d'être là, et
 * une liste qu'on peut relire vaut mieux qu'une règle qu'on croit avoir comprise.
 */
function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const [a = 0, b = 0] = parts
  if (a === 0) return true // « cette machine »
  if (a === 10) return true // privé
  if (a === 127) return true // boucle locale
  if (a === 169 && b === 254) return true // lien-local, et les métadonnées d'instance
  if (a === 172 && b >= 16 && b <= 31) return true // privé
  if (a === 192 && b === 168) return true // privé
  if (a === 192 && b === 0) return true // usages protocolaires réservés
  if (a === 100 && b >= 64 && b <= 127) return true // partagé entre abonnés d'un opérateur
  if (a === 198 && (b === 18 || b === 19)) return true // bancs d'essai
  if (a === 198 && b === 51) return true // documentation
  if (a === 203 && b === 0) return true // documentation
  if (a >= 224) return true // multidiffusion et réservé
  return false
}

function isPrivateV6(address: string): boolean {
  const bas = address.toLowerCase().split('%')[0] ?? ''
  if (bas === '::' || bas === '::1') return true // indéterminée, boucle locale
  // Une adresse v4 habillée en v6 doit être jugée sur son adresse v4.
  const mappee = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bas)
  if (mappee !== null) return isPrivateV4(mappee[1] as string)
  if (/^f[cd]/.test(bas)) return true // usage local unique
  if (/^fe[89ab]/.test(bas)) return true // lien-local
  if (/^ff/.test(bas)) return true // multidiffusion
  return false
}

/** Vrai pour toute adresse que le public ne peut pas joindre depuis Internet. */
export function isPrivateAddress(address: string): boolean {
  const famille = isIP(address)
  if (famille === 4) return isPrivateV4(address)
  if (famille === 6) return isPrivateV6(address)
  // Ni v4 ni v6 : on ne sait pas ce que c'est, donc on n'y va pas.
  return true
}

export type Reponse = {
  url: string
  status: number
  contentType: string
  body: string
  /** Octets réellement lus. Sert aux contrôles de poids de page. */
  bytes: number
  /** La chaîne de redirections suivie, adresse de départ comprise. */
  chain: readonly string[]
}

/**
 * Le résolveur que l'on impose au client HTTP.
 *
 * Il fait deux choses : il refuse ce qui ne mène pas à une adresse publique, et il fige
 * l'adresse retenue. Le client n'a donc plus l'occasion de résoudre le nom une seconde fois.
 */
function lookupSurveille(
  hostname: string,
  options: unknown,
  callback: (
    erreur: NodeJS.ErrnoException | null,
    adresse: string | { address: string; family: number }[],
    famille?: number,
  ) => void,
): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (erreur, adresses) => {
    if (erreur !== null) {
      callback(erreur, '')
      return
    }
    const publiques = adresses.filter((entree) => !isPrivateAddress(entree.address))
    const retenue = publiques[0]
    if (retenue === undefined) {
      const refus: NodeJS.ErrnoException = new Error(
        `« ${hostname} » ne mène pas à une adresse publique.`,
      )
      refus.code = 'EVOLIIA_ADRESSE_PRIVEE'
      callback(refus, '')
      return
    }
    // Le client accepte les deux formes ; la forme « toutes » évite qu'il en redemande.
    const toutes = typeof options === 'object' && options !== null && 'all' in options
      ? (options as { all?: boolean }).all === true
      : false
    if (toutes) {
      callback(null, [{ address: retenue.address, family: retenue.family }])
      return
    }
    callback(null, retenue.address, retenue.family)
  })
}

/** Une adresse acceptable en entrée : http ou https, sans identifiants, hôte nommé. */
export function parseTargetUrl(brut: string): URL {
  let url: URL
  try {
    url = new URL(brut.trim())
  } catch {
    throw validation("Cette adresse n'est pas une adresse web valide.")
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw validation('Seules les adresses commençant par http:// ou https:// sont acceptées.')
  }
  if (url.username !== '' || url.password !== '') {
    throw validation("Retirez les identifiants de l'adresse : Evoliia ne s'y connecte pas.")
  }
  if (url.hostname === '') throw validation("Cette adresse n'a pas de nom de domaine.")
  // Une adresse IP écrite en clair n'est jamais un site qu'on audite, et c'est le chemin le
  // plus direct vers un service interne.
  if (isIP(url.hostname) !== 0) {
    throw validation('Indiquez un nom de domaine, pas une adresse IP.')
  }
  /*
   * Les noms qui ne désignent rien de public.
   *
   * Ce contrôle ne remplace pas la vérification après résolution — c'est elle qui protège
   * réellement, et elle seule. Il évite deux choses plus modestes : qu'une saisie manifestement
   * locale traverse la moitié du produit avant d'échouer, et qu'elle s'affiche entre-temps
   * comme si elle était un site.
   *
   * Un nom sans point est décisif : aucun domaine public n'existe sans extension.
   */
  const nom = url.hostname.toLowerCase()
  const locaux = ['.local', '.localhost', '.internal', '.home.arpa', '.lan']
  if (!nom.includes('.') || locaux.some((fin) => nom.endsWith(fin))) {
    throw validation('Indiquez l’adresse publique de votre site.')
  }
  url.hash = ''
  return url
}

type Brute = { message: IncomingMessage; body: string; bytes: number }

/** Une requête, une réponse, bornée en temps et en taille. Aucune redirection suivie ici. */
function requeteUnique(url: URL): Promise<Brute> {
  return new Promise((resolve, reject) => {
    const demande = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'GET',
        // Le résolveur surveillé : c'est ici que la défense contre le SSRF devient réelle.
        lookup: lookupSurveille,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'fr,en;q=0.8',
        },
        timeout: TIMEOUT_MS,
      },
      (message) => {
        const type = String(message.headers['content-type'] ?? '')
        /*
         * Ce qui n'est pas du HTML est abandonné sans être lu. Un fichier de cent mégaoctets
         * annoncé « application/zip » n'a aucune raison de traverser le réseau jusqu'ici.
         */
        const estHtml = type === '' || /text\/html|application\/xhtml|text\/plain|xml/i.test(type)
        const redirige = message.statusCode !== undefined && message.statusCode >= 300 && message.statusCode < 400
        if (!estHtml && !redirige) {
          message.destroy()
          resolve({ message, body: '', bytes: 0 })
          return
        }

        const morceaux: Buffer[] = []
        let lus = 0
        message.on('data', (morceau: Buffer) => {
          lus += morceau.length
          if (lus > MAX_BODY_BYTES) {
            // On coupe au lieu de continuer : la page est trop lourde, c'est en soi un
            // constat d'audit, et lire la suite ne dirait rien de plus.
            message.destroy()
            resolve({ message, body: Buffer.concat(morceaux).toString('utf8'), bytes: lus })
            return
          }
          morceaux.push(morceau)
        })
        message.on('end', () => {
          resolve({ message, body: Buffer.concat(morceaux).toString('utf8'), bytes: lus })
        })
        message.on('error', reject)
      },
    )

    demande.on('timeout', () => {
      demande.destroy(new Error("Le serveur n'a pas répondu à temps."))
    })
    demande.on('error', reject)
    demande.end()
  })
}

/**
 * Va chercher une image, en octets, sous les mêmes protections qu'une page.
 *
 * Séparée de la lecture de page parce qu'elle ne lit pas la même chose : une page se
 * convertit en texte, une image serait détruite par cette conversion. Tout le reste est
 * identique, et c'est le point — le résolveur surveillé, le refus des adresses privées, le
 * plafond d'octets, le délai. Écrire un second client HTTP « juste pour les images » serait
 * écrire une seconde porte, et la seconde porte est toujours celle qu'on oublie de fermer.
 *
 * Les redirections ne sont pas suivies ici : l'adresse vient du catalogue d'une boutique,
 * elle pointe droit sur un fichier. Une redirection y serait inhabituelle, et refuser
 * l'inhabituel est moins coûteux que de le suivre.
 */
export async function secureFetchBytes(
  brut: string,
  maxOctets: number,
): Promise<{ octets: Buffer; contentType: string }> {
  const url = parseTargetUrl(brut)
  if (url.protocol !== 'https:') {
    throw validation('Cette image doit être servie en HTTPS.')
  }

  return new Promise((resolve, reject) => {
    const demande = httpsRequest(
      url,
      {
        method: 'GET',
        // Le résolveur surveillé : c'est ici que la défense contre le SSRF devient réelle.
        lookup: lookupSurveille,
        headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
        timeout: TIMEOUT_MS,
      },
      (message) => {
        const status = message.statusCode ?? 0
        if (status !== 200) {
          message.destroy()
          reject(validation(`Cette image est introuvable (code ${status}).`))
          return
        }

        const morceaux: Buffer[] = []
        let lus = 0
        message.on('data', (morceau: Buffer) => {
          lus += morceau.length
          if (lus > maxOctets) {
            /*
             * Rejeté plutôt que tronqué : une image coupée en deux est un fichier invalide,
             * et l'envoyer à Google donnerait un refus incompréhensible. Ici, le poids est
             * la raison, et elle se dit.
             */
            message.destroy()
            reject(validation('Cette image est trop lourde pour être déposée.'))
            return
          }
          morceaux.push(morceau)
        })
        message.on('end', () => {
          resolve({
            octets: Buffer.concat(morceaux),
            contentType: String(message.headers['content-type'] ?? ''),
          })
        })
        message.on('error', reject)
      },
    )

    demande.on('timeout', () => {
      demande.destroy(new Error("Le serveur n'a pas répondu à temps."))
    })
    demande.on('error', reject)
    demande.end()
  })
}

/**
 * Va chercher une page, en suivant les redirections une par une.
 *
 * Suivre soi-même les redirections n'est pas une coquetterie : c'est la seule façon de
 * soumettre chaque étape aux mêmes vérifications que la première. Un client qui les suit
 * tout seul ne vérifie que le départ.
 */
export async function secureFetch(brut: string): Promise<Reponse> {
  const chain: string[] = []
  let url = parseTargetUrl(brut)

  for (let saut = 0; saut <= MAX_REDIRECTS; saut += 1) {
    chain.push(url.toString())
    const { message, body, bytes } = await requeteUnique(url)
    const status = message.statusCode ?? 0
    const emplacement = message.headers.location

    if (status >= 300 && status < 400 && typeof emplacement === 'string') {
      if (saut === MAX_REDIRECTS) {
        throw validation('Cette adresse enchaîne trop de redirections.')
      }
      // Résolue contre l'adresse courante : une redirection relative est légitime et
      // fréquente. Puis revalidée entièrement, protocole compris.
      const suivante = new URL(emplacement, url)
      url = parseTargetUrl(suivante.toString())
      continue
    }

    return {
      url: url.toString(),
      status,
      contentType: String(message.headers['content-type'] ?? ''),
      body,
      bytes,
      chain,
    }
  }

  throw validation('Cette adresse enchaîne trop de redirections.')
}

/** Une réponse d'API JSON, bornée comme une page. */
export type ReponseJson = { status: number; corps: unknown; entetes: Record<string, string> }

/** Au-delà, une page d'API est anormale : une page de cent commandes pèse quelques centaines de ko. */
export const MAX_JSON_BYTES = 8 * 1024 * 1024

/**
 * Appelle une API JSON sur un serveur choisi par la personne — sa boutique WooCommerce —,
 * sous les mêmes protections qu'une page.
 *
 * Deux différences avec la lecture d'une page, et chacune protège un secret. **HTTPS
 * seulement** : les identifiants partent dans l'en-tête, et en clair ils se liraient sur le
 * chemin. **Aucune redirection suivie** : une redirection emporterait l'en-tête
 * d'autorisation vers une adresse que personne n'a vérifiée ; elle est rendue telle quelle,
 * et l'appelant dit à la personne quelle adresse corriger.
 */
export function requeteJson(url: URL, entetes: Readonly<Record<string, string>>): Promise<ReponseJson> {
  if (url.protocol !== 'https:') return Promise.reject(validation('La boutique doit être servie en https.'))
  return new Promise((resolve, reject) => {
    const demande = httpsRequest(
      url,
      {
        method: 'GET',
        lookup: lookupSurveille,
        headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...entetes },
        timeout: TIMEOUT_MS * 2,
      },
      (message) => {
        const morceaux: Buffer[] = []
        let lus = 0
        message.on('data', (morceau: Buffer) => {
          lus += morceau.length
          if (lus > MAX_JSON_BYTES) {
            message.destroy()
            reject(new Error('La réponse de la boutique est trop volumineuse.'))
            return
          }
          morceaux.push(morceau)
        })
        message.on('end', () => {
          const texte = Buffer.concat(morceaux).toString('utf8')
          let corps: unknown = null
          try {
            corps = texte === '' ? null : JSON.parse(texte)
          } catch {
            corps = null
          }
          const plats: Record<string, string> = {}
          for (const [cle, valeur] of Object.entries(message.headers)) {
            if (typeof valeur === 'string') plats[cle.toLowerCase()] = valeur
          }
          resolve({ status: message.statusCode ?? 0, corps, entetes: plats })
        })
        message.on('error', reject)
      },
    )
    demande.on('timeout', () => demande.destroy(new Error("La boutique n'a pas répondu à temps.")))
    demande.on('error', reject)
    demande.end()
  })
}
