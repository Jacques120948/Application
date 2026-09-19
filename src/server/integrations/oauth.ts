import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * L'état qui voyage pendant une autorisation OAuth.
 *
 * Une autorisation se déroule en deux temps : Evoliia envoie la personne chez le
 * fournisseur, le fournisseur la renvoie avec un code. Entre les deux, rien ne garantit que
 * celui qui revient est celui qui est parti — c'est exactement la faille que le paramètre
 * `state` existe pour fermer, et la raison pour laquelle il ne peut pas être une valeur
 * quelconque.
 *
 * Trois décisions.
 *
 * **L'état est signé, pas stocké.** Une table de demandes en cours demanderait d'être
 * nettoyée, migrée, et de survivre à un redémarrage au mauvais moment. Un jeton signé se
 * vérifie sans rien lire : ce qui revient est valable ou ne l'est pas.
 *
 * **Il porte qui l'a demandé.** Sans cela, un code obtenu par quelqu'un d'autre et rejoué
 * sur le retour d'Evoliia relierait le compte de l'attaquant à la session de la victime, ou
 * l'inverse. Le retour vérifie que la personne connectée est bien celle qui est partie.
 *
 * **Il expire vite.** Une autorisation se termine en une minute ou s'abandonne. Dix minutes
 * laissent le temps de lire un écran de consentement, et pas celui de retrouver un lien
 * dans un historique trois jours plus tard.
 */

/** Au-delà, une autorisation commencée est considérée comme abandonnée. */
const VALIDITE_MS = 10 * 60 * 1000

export type EtatOAuth = {
  /** Qui a lancé l'autorisation. Vérifié au retour contre la session. */
  userId: string
  providerId: string
  /** Aléa, pour que deux demandes identiques ne produisent pas le même jeton. */
  nonce: string
  /** Fin de validité, en millisecondes. */
  expire: number
}

function encoder(valeur: string): string {
  return Buffer.from(valeur, 'utf8').toString('base64url')
}

function signer(charge: string): string {
  return createHmac('sha256', env.sessionSecret).update(charge).digest('base64url')
}

/** Un état signé, à confier au fournisseur le temps de l'aller-retour. */
export function creerEtat(userId: string, providerId: string): string {
  const etat: EtatOAuth = {
    userId,
    providerId,
    nonce: randomBytes(12).toString('base64url'),
    expire: Date.now() + VALIDITE_MS,
  }
  const charge = encoder(JSON.stringify(etat))
  return `${charge}.${signer(charge)}`
}

/**
 * L'état rendu par le fournisseur, ou `null`.
 *
 * `null` pour tout ce qui cloche — signature fausse, forme inattendue, délai dépassé — et
 * sans dire lequel : un retour qui explique pourquoi il refuse apprend à forger le suivant.
 */
export function lireEtat(jeton: string): EtatOAuth | null {
  const separateur = jeton.lastIndexOf('.')
  if (separateur <= 0) return null

  const charge = jeton.slice(0, separateur)
  const signature = jeton.slice(separateur + 1)

  const attendue = Buffer.from(signer(charge))
  const fournie = Buffer.from(signature)
  if (attendue.length !== fournie.length || !timingSafeEqual(attendue, fournie)) return null

  try {
    const etat = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8')) as Partial<EtatOAuth>
    if (typeof etat.userId !== 'string' || typeof etat.providerId !== 'string') return null
    if (typeof etat.expire !== 'number' || etat.expire < Date.now()) return null
    return etat as EtatOAuth
  } catch {
    return null
  }
}

export type Jetons = {
  accessToken: string
  /** Absent quand le fournisseur n'en délivre pas, ou n'en redonne pas au renouvellement. */
  refreshToken?: string
  /** Fin de validité du jeton d'accès. */
  expiresAt: Date
}

/** Ce qu'un fournisseur rend à l'échange. Les noms sont ceux de la norme OAuth 2. */
type ReponseJeton = {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  error?: unknown
  error_description?: unknown
}

/**
 * Échange un code ou un jeton de rafraîchissement contre un jeton d'accès.
 *
 * Le secret de l'application part dans le corps de la requête, de serveur à serveur, et
 * n'apparaît nulle part ailleurs. Aucun jeton, aucun code et aucun secret n'entre dans le
 * journal : un journal se relit, se copie et s'exporte.
 */
export async function echangerJeton(
  url: string,
  parametres: Record<string, string>,
): Promise<{ ok: true; jetons: Jetons } | { ok: false; raison: string }> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), 20_000)

  let reponse: Response
  try {
    reponse = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(parametres).toString(),
      signal: controle.signal,
    })
  } catch {
    return { ok: false, raison: 'Le service est momentanément injoignable. Réessayez.' }
  } finally {
    clearTimeout(minuteur)
  }

  const charge = (await reponse.json().catch(() => null)) as ReponseJeton | null

  if (reponse.status !== 200 || typeof charge?.access_token !== 'string') {
    const detail =
      typeof charge?.error_description === 'string'
        ? charge.error_description
        : typeof charge?.error === 'string'
          ? charge.error
          : ''
    return {
      ok: false,
      raison:
        detail === ''
          ? "L'autorisation n'a pas abouti. Reprenez la connexion depuis le début."
          : `Le service répond : ${detail.slice(0, 150)}`,
    }
  }

  /*
   * `expires_in` est une durée en secondes. Une minute est retranchée : un jeton employé
   * à la seconde près de son expiration est refusé pour rien, et l'appel qui échoue est
   * toujours celui qu'on ne réessaie pas.
   */
  const secondes = typeof charge.expires_in === 'number' ? charge.expires_in : 3600
  return {
    ok: true,
    jetons: {
      accessToken: charge.access_token,
      ...(typeof charge.refresh_token === 'string' ? { refreshToken: charge.refresh_token } : {}),
      expiresAt: new Date(Date.now() + Math.max(60, secondes - 60) * 1000),
    },
  }
}
