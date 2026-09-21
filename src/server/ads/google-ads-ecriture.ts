import { logger } from '@/server/observability/logger'
import { DELAI_MS, entetes, messageErreur, RACINE } from './google-ads'
import type { AccesAds, TexteAnnonceAds } from './provider'

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

/**
 * Remplace la liste des titres ou des descriptions d'une annonce responsive.
 *
 * « Remplace », et non « ajoute » : Google ne sait pas ajouter un texte à une annonce. Y
 * mettre le dixième titre exige de renvoyer les neuf autres, avec leur épinglage. C'est la
 * raison pour laquelle l'appelant relit l'annonce juste avant — une liste vieille d'une
 * semaine effacerait ce que la personne a fait entre-temps dans Google Ads.
 *
 * Le nom de ressource est celui que Google a rendu à la lecture, repris tel quel. Le
 * recomposer à partir d'identifiants serait une occasion de se tromper d'annonce, et une
 * annonce voisine écrasée ne se voit pas avant plusieurs jours.
 */
export async function ecrireTextesAnnonce(
  acces: AccesAds,
  resourceName: string,
  champ: 'titre' | 'description',
  textes: readonly TexteAnnonceAds[],
): Promise<Ecriture> {
  const liste = textes.map((une) =>
    une.epingle === '' ? { text: une.texte } : { text: une.texte, pinnedField: une.epingle },
  )
  const cle = champ === 'titre' ? 'headlines' : 'descriptions'

  return envoyer('ads:mutate', acces, {
    operations: [
      {
        update: { resourceName, responsiveSearchAd: { [cle]: liste } },
        updateMask: `responsive_search_ad.${cle}`,
      },
    ],
  })
}

/**
 * Crée un texte comme élément autonome, puis le rattache à un groupe d'éléments.
 *
 * C'est l'autre façon dont Google range les textes d'une annonce, et elle est plus saine que
 * celle des annonces responsives : un élément existe seul, on le rattache, on le détache.
 * Rien n'est remplacé, donc rien ne peut être effacé par mégarde — là où ajouter un titre à
 * une annonce responsive exige de renvoyer les quinze autres.
 *
 * Deux appels, et pas un : Google ne sait pas créer et rattacher d'un coup hors d'une
 * requête groupée. Le second échoue parfois seul, et l'élément reste alors créé sans être
 * rattaché — inoffensif, invisible, et l'appelant le dit plutôt que de prétendre au succès.
 */
export async function creerTexteElement(
  acces: AccesAds,
  texte: string,
): Promise<{ ok: true; resourceName: string } | { ok: false; raison: string; technique: string }> {
  const issue = await envoyerEtLire('assets:mutate', acces, {
    operations: [{ create: { textAsset: { text: texte } } }],
  })
  if (!issue.ok) return issue
  if (issue.resourceName === '') {
    return {
      ok: false,
      raison: 'Google a accepté le texte sans dire où il l’a rangé. Rien n’a été rattaché.',
      technique: 'resourceName manquant',
    }
  }
  return { ok: true, resourceName: issue.resourceName }
}

/**
 * Crée une image comme élément autonome.
 *
 * Les octets partent en base 64, dans le corps de la requête : Google n'a pas de dépôt de
 * fichier séparé pour cette API. Le nom n'est vu que par la personne, dans son compte, et il
 * doit être unique — d'où l'horodatage que l'appelant y met.
 */
export async function creerImageElement(
  acces: AccesAds,
  nom: string,
  base64: string,
): Promise<{ ok: true; resourceName: string } | { ok: false; raison: string; technique: string }> {
  const issue = await envoyerEtLire('assets:mutate', acces, {
    operations: [{ create: { name: nom, type: 'IMAGE', imageAsset: { data: base64 } } }],
  })
  if (!issue.ok) return issue
  if (issue.resourceName === '') {
    return {
      ok: false,
      raison: 'Google a accepté l’image sans dire où il l’a rangée. Rien n’a été rattaché.',
      technique: 'resourceName manquant',
    }
  }
  return { ok: true, resourceName: issue.resourceName }
}

/**
 * Rattache un élément à un groupe d'éléments, dans un champ donné.
 *
 * Rend le nom de ressource du rattachement, et non celui de l'élément : c'est lui qu'il
 * faudra donner pour détacher. Détacher n'efface pas l'élément, il le retire de ce groupe —
 * ce qui est exactement ce qu'un retour arrière doit faire.
 */
export async function rattacherElement(
  acces: AccesAds,
  groupeId: string,
  elementResourceName: string,
  champGoogle: string,
): Promise<{ ok: true; resourceName: string } | { ok: false; raison: string; technique: string }> {
  const issue = await envoyerEtLire('assetGroupAssets:mutate', acces, {
    operations: [
      {
        create: {
          assetGroup: `customers/${acces.compteId}/assetGroups/${groupeId}`,
          asset: elementResourceName,
          fieldType: champGoogle,
        },
      },
    ],
  })
  if (!issue.ok) return issue
  return { ok: true, resourceName: issue.resourceName }
}

/** Détache un élément d'un groupe. L'élément survit ; il ne sert simplement plus ici. */
export async function detacherElement(
  acces: AccesAds,
  rattachementResourceName: string,
): Promise<Ecriture> {
  return envoyer('assetGroupAssets:mutate', acces, {
    operations: [{ remove: rattachementResourceName }],
  })
}

/**
 * Ajoute un mot-clé à un groupe d'annonces.
 *
 * Même forme que le rattachement d'un élément — créer, garder la poignée, savoir retirer —
 * et pour la même raison : rien n'est remplacé, donc rien ne peut être effacé par mégarde.
 *
 * La correspondance est posée par le champ `matchType` et non par des guillemets dans le
 * texte, ce qui n'est pas une coquetterie. Google accepte les deux écritures, et un texte
 * qui porte déjà ses guillemets se retrouve acheté guillemets compris : un mot-clé qui ne
 * correspond à aucune recherche, et qui ne dépense rien en paraissant actif. Les garde-fous
 * refusent d'ailleurs un texte qui en contient.
 *
 * `BROAD` n'est volontairement pas atteignable depuis ici : `garde-fous.ts` n'accepte que
 * l'expression exacte et le mot-clé exact. Sur un petit budget, la correspondance large est
 * la façon la plus rapide de dépenser un mois en un matin sur des recherches que personne
 * n'a validées.
 */
export async function creerMotCle(
  acces: AccesAds,
  groupeId: string,
  texte: string,
  correspondance: 'phrase' | 'exact',
): Promise<{ ok: true; resourceName: string } | { ok: false; raison: string; technique: string }> {
  const issue = await envoyerEtLire('adGroupCriteria:mutate', acces, {
    operations: [
      {
        create: {
          adGroup: `customers/${acces.compteId}/adGroups/${groupeId}`,
          status: 'ENABLED',
          keyword: {
            text: texte,
            matchType: correspondance === 'exact' ? 'EXACT' : 'PHRASE',
          },
        },
      },
    ],
  })
  if (!issue.ok) return issue
  return { ok: true, resourceName: issue.resourceName }
}

/** Retire un mot-clé d'un groupe d'annonces. C'est le retour arrière d'un dépôt. */
export async function retirerMotCle(
  acces: AccesAds,
  critereResourceName: string,
): Promise<Ecriture> {
  return envoyer('adGroupCriteria:mutate', acces, {
    operations: [{ remove: critereResourceName }],
  })
}

/**
 * Un envoi dont on lit le nom de ressource créé.
 *
 * Séparé de `envoyer` parce que la plupart des écritures n'ont rien à relire : changer un
 * budget rend l'identifiant qu'on lui a donné. Créer un élément, si — et sans ce nom, on ne
 * peut ni le rattacher ni le détacher plus tard.
 */
async function envoyerEtLire(
  chemin: string,
  acces: AccesAds,
  corps: unknown,
): Promise<{ ok: true; resourceName: string } | { ok: false; raison: string; technique: string }> {
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
      const message = messageErreur(charge)
      logger.warn('Google Ads a refusé une création', { status: reponse.status })
      return { ok: false, raison: refus(reponse.status, message), technique: message.slice(0, 500) }
    }

    const resultats = (charge as { results?: unknown } | null)?.results
    const premier = Array.isArray(resultats) ? resultats[0] : undefined
    const nom = (premier as { resourceName?: unknown } | undefined)?.resourceName
    return { ok: true, resourceName: typeof nom === 'string' ? nom : '' }
  } catch {
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
