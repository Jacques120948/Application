import { logger } from '@/server/observability/logger'
import { DELAI_MS, entetes, messageErreur, RACINE } from './google-ads'
import type { AccesAds } from './provider'

/**
 * Google Ads, en écriture — le seul fichier d'Evoliia qui sache modifier une campagne.
 *
 * Il est séparé du connecteur de lecture, et ce n'est pas un rangement. Le fichier voisin
 * porte une garantie vérifiée par un test sur son texte même : aucune fonction d'écriture
 * n'y figure. Y ajouter ces deux appels effacerait la seule preuve mécanique qu'une lecture
 * reste une lecture — et cette preuve compte, parce que Google, lui, n'en donne aucune : la
 * portée `adwords` ouvre l'écriture, et il n'en existe pas de version en lecture seule.
 *
 * Trois règles portent ce fichier.
 *
 * **Il ne décide de rien.** Pas de garde-fou ici, pas de plafond, pas de vérification de
 * mode. Ce sont des fonctions de transport : elles prennent une valeur déjà validée et
 * l'envoient. Mêler les règles au transport donnerait deux endroits où lire ce qu'Evoliia
 * s'autorise, et le jour où ils divergeraient, personne ne saurait lequel fait foi.
 *
 * **Il n'est appelé que d'un seul endroit.** `actions.ts` écrit le journal avant d'appeler,
 * avec la valeur d'avant. Un test le vérifie : si un second appelant apparaissait, une
 * modification pourrait partir sans que rien ne permette de revenir en arrière.
 *
 * **Un refus est une valeur de retour.** Google refuse pour des raisons ordinaires — un
 * budget partagé, une campagne supprimée entre-temps, une limite de compte. Ces refus
 * doivent être écrits dans le journal, pas levés au milieu d'une transaction.
 */

export type Ecriture = { ok: true } | { ok: false; raison: string; technique: string }

/** Ce que Google refuse, dit à quelqu'un qui peut y faire quelque chose. */
function refus(status: number, message: string): string {
  if (status === 401) {
    return 'Votre autorisation Google a expiré. Reconnectez votre compte Google Ads, puis réessayez.'
  }
  if (status === 403) {
    return 'Google refuse cette modification : le compte connecté n’a pas les droits d’écriture sur ce compte publicitaire.'
  }
  if (status === 429) {
    return 'Google limite les demandes en ce moment. Réessayez dans quelques minutes.'
  }
  return message === ''
    ? 'Google n’a pas accepté la modification, sans dire pourquoi.'
    : `Google refuse : ${message.slice(0, 200)}`
}

async function envoyer(
  chemin: string,
  acces: AccesAds,
  corps: unknown,
): Promise<Ecriture> {
  const controle = new AbortController()
  const minuteur = setTimeout(() => controle.abort(), DELAI_MS)
  try {
    const reponse = await fetch(`${RACINE}/customers/${acces.compteId}/${chemin}`, {
      method: 'POST',
      headers: entetes(acces.accessToken),
      body: JSON.stringify(corps),
      signal: controle.signal,
    })
    const charge = (await reponse.json().catch(() => null)) as unknown

    if (reponse.status !== 200) {
      /*
       * Même lecture que pour les requêtes de lecture : le refus précis de Google vit sous
       * `details`, et c'est lui qui nomme la cause — « budget partagé », « campagne
       * supprimée » — là où le message général ne dit que « requête invalide ».
       */
      const message = messageErreur(charge)
      /*
       * Ni jeton, ni identifiant de compte, ni montant : un journal se relit, se copie et
       * s'exporte. Le détail utile est écrit dans l'action, qui est cloisonnée.
       */
      logger.warn('Google Ads a refusé une écriture', { status: reponse.status })
      return { ok: false, raison: refus(reponse.status, message), technique: message.slice(0, 500) }
    }
    return { ok: true }
  } catch {
    /*
     * Une coupure au milieu d'un envoi laisse une incertitude réelle : la modification a pu
     * partir. Le journal conservera « prévu », qui est l'état exact de ce qu'on sait — et
     * la prochaine lecture des campagnes dira ce qu'il en est réellement.
     */
    return {
      ok: false,
      raison:
        'La modification n’a pas pu être envoyée à Google. Vérifiez dans Google Ads avant de réessayer : elle a pu partir malgré tout.',
      technique: 'reseau',
    }
  } finally {
    clearTimeout(minuteur)
  }
}

/**
 * Change le montant quotidien d'un budget.
 *
 * Le budget, pas la campagne : chez Google, un budget est un objet à part qui peut servir
 * plusieurs campagnes. C'est précisément ce qui rend cette écriture dangereuse sans
 * vérification, et c'est `garde-fous.ts` qui refuse de toucher à un budget partagé.
 */
export async function ecrireBudget(
  acces: AccesAds,
  budgetId: string,
  montantMicros: number,
): Promise<Ecriture> {
  return envoyer('campaignBudgets:mutate', acces, {
    operations: [
      {
        update: {
          resourceName: `customers/${acces.compteId}/campaignBudgets/${budgetId}`,
          amountMicros: String(Math.round(montantMicros)),
        },
        updateMask: 'amountMicros',
      },
    ],
  })
}

/** Met une campagne en pause, ou la remet en route. */
export async function ecrireStatut(
  acces: AccesAds,
  campagneId: string,
  statut: 'ENABLED' | 'PAUSED',
): Promise<Ecriture> {
  return envoyer('campaigns:mutate', acces, {
    operations: [
      {
        update: {
          resourceName: `customers/${acces.compteId}/campaigns/${campagneId}`,
          status: statut,
        },
        updateMask: 'status',
      },
    ],
  })
}
