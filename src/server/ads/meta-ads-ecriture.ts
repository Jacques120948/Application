import { env } from '@/lib/env'
import { logger } from '@/server/observability/logger'
import type { AccesAds } from './provider'
import { messageRefusMeta, type ReponseMeta } from './meta-ads'

/**
 * Les seules modifications qu'Evoliia sait envoyer chez Meta.
 *
 * Deux gestes : mettre en pause, et changer un budget quotidien. Pas de création, pas de
 * suppression, pas de reprise automatique. Le choix n'est pas une limite technique — l'API
 * de Meta en permet cent fois plus — c'est une limite de surface : chaque geste que ce
 * fichier connaît est un geste qu'il faut avoir borné, testé et rendu réversible, et il
 * vaut mieux deux gestes sûrs que dix approximatifs.
 *
 * Trois règles portent le fichier.
 *
 * **Une pause plutôt qu'une suppression.** Meta ne sait pas défaire une suppression. Une
 * pause se reprend d'un clic, chez nous comme chez eux, et c'est ce qui rend le retour
 * arrière honnête.
 *
 * **Le budget part en centimes, jamais en unités.** Meta lit les budgets en centimes
 * entiers et les dépenses en unités décimales — deux conventions dans la même API. Les
 * confondre donne un facteur cent : cinquante francs deviennent cinq mille, ou cinquante
 * centimes. C'est la seule conversion du fichier, elle est faite à un seul endroit, et elle
 * est testée.
 *
 * **Une coupure n'est pas un refus.** Si le réseau lâche au milieu, la modification a pu
 * partir. On le dit plutôt que d'annoncer un échec : le journal garde « prévu », et la
 * prochaine lecture des campagnes tranchera. Annoncer « non envoyé » sur une écriture
 * partie ferait recommencer, et deux fois vaut pire qu'une.
 */

const GRAPH = 'https://graph.facebook.com'
const DELAI_MS = 30_000

export type Ecriture = { ok: true } | { ok: false; raison: string; technique: string }

/**
 * Un budget quotidien, dans l'unité que Meta attend.
 *
 * L'inverse exact de `budgetEnMicros` : des micros de la devise vers des centimes entiers.
 * Meta refuse les décimales, et arrondir vers le bas plutôt qu'au plus proche évite qu'un
 * budget affiché à 40,00 parte à 40,01 — un centime qui ne se voit pas, mais qui fait
 * échouer la revérification de la valeur d'avant au retour arrière.
 */
export function budgetEnCentimes(micros: number): number {
  return Math.max(1, Math.floor(micros / 10_000))
}

/**
 * Un envoi chez Meta, borné en temps.
 *
 * Les paramètres partent en formulaire et non en JSON : c'est ce que l'API Graph attend
 * pour une écriture, et le jeton y voyage comme un champ ordinaire — il n'entre donc dans
 * aucune adresse, donc dans aucun journal d'accès intermédiaire.
 */
async function envoyer(objet: string, acces: AccesAds, champs: Record<string, string>): Promise<Ecriture> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)
  try {
    const corps = new URLSearchParams({ ...champs, access_token: acces.accessToken })
    const reponse = await fetch(`${GRAPH}/${env.metaApiVersion}/${objet}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: corps.toString(),
      signal: controle.signal,
    })
    const charge = (await reponse.json().catch(() => null)) as ReponseMeta | null

    if (reponse.status !== 200) {
      /* `message` est déclaré inconnu : Meta y met parfois autre chose qu'une chaîne. */
      const brut = charge?.error?.message
      const technique = typeof brut === 'string' ? brut : ''
      /*
       * Ni jeton, ni identifiant d'objet, ni montant : un journal se relit, se copie et
       * s'exporte. Le détail utile est écrit dans l'action, qui est cloisonnée.
       */
      logger.warn('Meta a refusé une écriture', { status: reponse.status })
      return {
        ok: false,
        raison: messageRefusMeta(reponse.status, charge?.error),
        technique: technique.slice(0, 500),
      }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      raison:
        'La modification n’a pas pu être envoyée à Meta. Vérifiez dans le gestionnaire de publicités avant de réessayer : elle a pu partir malgré tout.',
      technique: 'reseau',
    }
  } finally {
    clearTimeout(minuteur)
  }
}

/** Les statuts qu'Evoliia sait poser. Rien d'autre ne part, quoi qu'on lui demande. */
export const STATUTS_ECRITS = ['PAUSED', 'ACTIVE'] as const

export type StatutEcrit = (typeof STATUTS_ECRITS)[number]

/**
 * Change le statut d'un ensemble ou d'une annonce.
 *
 * `ACTIVE` n'existe ici que pour le retour arrière : aucune règle ne propose de rallumer
 * quoi que ce soit, et c'est délibéré. Remettre en marche ce qu'on a éteint est un geste de
 * réparation, pas une recommandation — une dépense qui reprend doit être voulue.
 */
export async function ecrireStatutMeta(
  acces: AccesAds,
  objetId: string,
  vers: StatutEcrit,
): Promise<Ecriture> {
  return envoyer(objetId, acces, { status: vers })
}

/**
 * Change le budget quotidien d'un ensemble de publicités.
 *
 * L'ensemble, pas la campagne : chez Meta, c'est là que vit le budget — sauf quand la
 * campagne le pilote, auquel cas cet appel échouerait. C'est `garde-fous-meta.ts` qui
 * refuse avant d'en arriver là, parce qu'un refus expliqué vaut mieux qu'un refus de Meta.
 */
export async function ecrireBudgetMeta(
  acces: AccesAds,
  ensembleId: string,
  micros: number,
): Promise<Ecriture> {
  return envoyer(ensembleId, acces, { daily_budget: String(budgetEnCentimes(micros)) })
}

/**
 * Relit un objet juste avant de l'écrire, pour connaître sa valeur d'avant.
 *
 * C'est la pièce qui rend le retour arrière honnête. La base porte ce que la dernière
 * lecture a vu, et quelqu'un a pu changer un budget dans le gestionnaire de publicités
 * depuis. Journaliser « avant : 20 CHF » alors que Meta était à 40 ferait d'un bouton
 * « restaurer » un bouton qui casse.
 *
 * Un appel de plus par écriture, et c'est le meilleur rapport du fichier.
 */
export async function relireObjetMeta(
  acces: AccesAds,
  objetId: string,
): Promise<{ ok: true; statut: string; budgetMicros: number } | { ok: false; raison: string }> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)
  try {
    const parametres = new URLSearchParams({
      access_token: acces.accessToken,
      fields: 'id,status,effective_status,daily_budget',
    })
    const reponse = await fetch(`${GRAPH}/${env.metaApiVersion}/${objetId}?${parametres.toString()}`, {
      headers: { accept: 'application/json' },
      signal: controle.signal,
    })
    const charge = (await reponse.json().catch(() => null)) as
      | (ReponseMeta & { status?: unknown; effective_status?: unknown; daily_budget?: unknown })
      | null

    if (reponse.status !== 200 || charge === null) {
      return { ok: false, raison: messageRefusMeta(reponse.status, charge?.error) }
    }

    const brut = charge.daily_budget
    const centimes = typeof brut === 'number' ? brut : Number.parseInt(String(brut ?? ''), 10)
    return {
      ok: true,
      /*
       * `effective_status` d'abord, comme à la lecture : une annonce active dans une
       * campagne en pause n'est pas diffusée, et `status` dirait pourtant ACTIVE.
       */
      statut:
        typeof charge.effective_status === 'string' && charge.effective_status !== ''
          ? charge.effective_status
          : String(charge.status ?? ''),
      budgetMicros: Number.isFinite(centimes) && centimes > 0 ? centimes * 10_000 : 0,
    }
  } catch {
    return { ok: false, raison: 'Meta est momentanément injoignable. Réessayez.' }
  } finally {
    clearTimeout(minuteur)
  }
}
