import { AppError } from '@/lib/errors'
import { logger } from '@/server/observability/logger'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { useOAuthAccess } from '@/server/integrations/service'
import {
  rafraichir,
  requetes,
  listerProprietes,
  type Ligne,
  type Propriete,
} from '@/server/integrations/providers/google-search-console'

/**
 * Les chiffres de recherche, lus chez Google Search Console.
 *
 * C'est la moitié que le produit n'avait pas. Evoliia mesure un site : ce qu'il contient, ce
 * qu'il déclare, ce qu'une machine peut en reprendre. Elle ne mesurait pas la demande — ni
 * ce que les gens tapent, ni où le site sort. Tout ce qu'elle disait jusqu'ici portait sur
 * la forme des pages, jamais sur leur audience.
 *
 * Quatre décisions.
 *
 * **Rien n'est estimé.** Ce sont les chiffres de Google sur les propres pages de la
 * personne, pas un volume de recherche acheté chez un tiers et extrapolé. Un écran qui dit
 * « 340 impressions » doit dire ce que Google dit, et un écran qui ne sait pas doit se taire
 * plutôt que d'estimer.
 *
 * **Rien n'est conservé.** Les chiffres ne sont pas recopiés en base : ils sont lus à
 * l'ouverture de l'écran et jetés avec lui. Les garder voudrait dire une table de plus à
 * cloisonner, un rafraîchissement à planifier, et deux versions de la vérité dont l'une
 * serait périmée. Google garde seize mois d'historique ; c'est son travail, pas celui
 * d'Evoliia.
 *
 * **La page 2 est ce qu'on met devant.** Les listes brutes se regardent une fois. Ce qui
 * décide d'une action, c'est la poignée de pages qui sortent entre la onzième et la
 * vingtième place : elles ont déjà la matière pour figurer sur Google, et personne ne les
 * voit. Quelques positions gagnées y valent plus qu'une page neuve, et c'est la seule
 * lecture du tableau qui désigne un travail plutôt qu'un constat.
 *
 * **Aucun crédit n'est débité.** Rien ici n'appelle un modèle : on lit une API gratuite,
 * avec le compte Google de la personne. Ce qui ne coûte rien ne se facture pas.
 */

/** Le droit qui ouvre cet écran. Nommé ici, vérifié ici : un seul endroit à relire. */
export const SEARCH_CONSOLE_FEATURE = 'search_console'

/** La période lue. Assez pour lisser une semaine creuse, assez court pour rester actuel. */
export const JOURS_LUS = 28

/** Les bornes de la deuxième page de Google, en position moyenne. */
const PAGE_DEUX = { haut: 10.5, bas: 20.5 }

/** Sous ce nombre d'impressions, un écart de position ne veut rien dire. */
const IMPRESSIONS_MINIMALES = 10

/** Ce qu'on montre d'une liste. Au-delà, l'écran cesse d'être lu. */
export const LIGNES_AFFICHEES = 25

export type Occasion = {
  /** La requête tapée, ou l'adresse de la page, selon la liste d'où elle sort. */
  cle: string
  position: number
  impressions: number
  clics: number
}

export type VueRecherches = {
  /** La propriété Search Console retenue, telle que Google la nomme. */
  propriete: string
  jours: number
  requetes: Ligne[]
  pages: Ligne[]
  /** Les pages de deuxième page, les plus vues d'abord. */
  occasions: Occasion[]
  /** Les recherches de deuxième page. C'est la demande réelle sur laquelle écrire. */
  occasionsDeRequetes: Occasion[]
  totaux: { clics: number; impressions: number }
}

/** L'hôte d'une adresse, sans « www. », ou une chaîne vide si elle est illisible. */
function hote(adresse: string): string {
  try {
    return new URL(adresse).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * La propriété Search Console qui correspond à ce site, ou `null`.
 *
 * Google en tient deux formes : `sc-domain:exemple.com`, qui couvre tout le domaine, et
 * `https://exemple.com/`, qui ne couvre qu'un préfixe. La première est préférée quand les
 * deux existent — elle voit les sous-domaines et les deux protocoles, là où la seconde
 * laisserait tomber la moitié des lignes sans rien dire.
 *
 * Le rapprochement se fait sur l'hôte, « www. » retiré : une personne qui déclare son site
 * avec le préfixe et sa propriété sans, ou l'inverse, a raison les deux fois.
 */
export function choisirPropriete(origin: string, proprietes: Propriete[]): string | null {
  const cible = hote(origin)
  if (cible === '') return null

  const domaine = proprietes.find(
    (propriete) =>
      propriete.siteUrl.startsWith('sc-domain:') &&
      propriete.siteUrl.slice('sc-domain:'.length).replace(/^www\./, '').toLowerCase() === cible,
  )
  if (domaine !== undefined) return domaine.siteUrl

  const prefixe = proprietes.find((propriete) => hote(propriete.siteUrl) === cible)
  return prefixe?.siteUrl ?? null
}

/**
 * Ce qui sort en deuxième page de Google.
 *
 * S'applique aux pages comme aux recherches, parce que le calcul est le même et que les
 * deux répondent à la même question sous deux angles : quelles adresses sont à portée, et
 * sur quels mots. Deux fonctions auraient divergé à la première correction de seuil.
 *
 * Elles se voient mal dans une liste triée par clics : elles en font peu, précisément parce
 * qu'elles sont en deuxième page. Triées par impressions, elles disent l'inverse — « Google
 * vous a montré trois cents fois et personne n'a cliqué », ce qui est une occasion et non
 * un échec.
 */
export function occasions(lignes: Ligne[]): Occasion[] {
  return lignes
    .filter(
      (ligne) =>
        ligne.position > PAGE_DEUX.haut &&
        ligne.position < PAGE_DEUX.bas &&
        ligne.impressions >= IMPRESSIONS_MINIMALES,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .map((ligne) => ({
      cle: ligne.cle,
      position: ligne.position,
      impressions: ligne.impressions,
      clics: ligne.clics,
    }))
}

/** Ce que la lecture peut renvoyer d'autre que des chiffres, et qui n'est pas une panne. */
export type EchecRecherches =
  | { etat: 'non-connecte' }
  | { etat: 'sans-propriete'; hote: string }
  /** L'offre n'ouvre pas la fonction. Ni une panne, ni un refus de Google. */
  | { etat: 'hors-offre'; raison: string }
  | { etat: 'refus'; raison: string }

/**
 * Les chiffres de recherche d'un site, ou la raison pour laquelle il n'y en a pas.
 *
 * Aucune de ces raisons n'est une panne : un site non connecté, une offre qui ne l'ouvre
 * pas, une propriété absente et une autorisation révoquée sont quatre états ordinaires,
 * chacun avec son geste suivant. Une exception les aurait confondus en un écran cassé.
 *
 * Et ils restent distincts jusqu'à l'écran. Ranger le refus d'offre avec la panne de Google
 * a coûté exactement ce qu'on pouvait craindre : un écran qui annonçait « Google n'a pas
 * répondu » alors que Google avait parfaitement répondu, et qui envoyait chercher la cause
 * du mauvais côté.
 */
export async function lireRecherches(
  userId: string,
  origin: string,
): Promise<{ ok: true; vue: VueRecherches } | ({ ok: false } & EchecRecherches)> {
  const acces = await useOAuthAccess(userId, 'google-search-console', rafraichir)
  if (!acces.ok) {
    // L'absence de connexion n'est pas un refus : c'est l'état de départ de tout le monde.
    return acces.raison === "Ce service n'est pas connecté."
      ? { ok: false, etat: 'non-connecte' }
      : { ok: false, etat: 'refus', raison: acces.raison }
  }

  /*
   * Le droit se vérifie après l'absence de connexion et avant le premier appel, comme pour
   * la boutique. Après, parce que ne rien avoir connecté est l'état ordinaire et appelle une
   * invitation, pas un discours sur les offres. Avant, parce qu'une grille tarifaire qui
   * annonce une fonction sans que rien ne l'applique est une ligne décorative : le jour où
   * l'exploitant la retire d'une offre, le tableau dirait « non » et le produit « oui ».
   */
  try {
    requireFeature(await getEntitlements(userId), SEARCH_CONSOLE_FEATURE)
  } catch (error) {
    return {
      ok: false,
      etat: 'hors-offre',
      raison:
        error instanceof AppError
          ? error.message
          : "Votre offre n'ouvre pas les chiffres de recherche.",
    }
  }

  const proprietes = await listerProprietes(acces.accessToken)
  if (!proprietes.ok) return { ok: false, etat: 'refus', raison: proprietes.raison }

  const propriete = choisirPropriete(origin, proprietes.proprietes)
  if (propriete === null) return { ok: false, etat: 'sans-propriete', hote: hote(origin) }

  /*
   * Les deux dimensions se lisent en parallèle et sur la même période. Google ne permet pas
   * de croiser requête et page sans multiplier les lignes par dix ; deux lectures séparées
   * répondent aux deux questions qu'on se pose vraiment, et coûtent deux appels.
   */
  const [parRequete, parPage] = await Promise.all([
    requetes(acces.accessToken, propriete, 'query', JOURS_LUS),
    requetes(acces.accessToken, propriete, 'page', JOURS_LUS),
  ])
  if (!parRequete.ok) return { ok: false, etat: 'refus', raison: parRequete.raison }
  if (!parPage.ok) return { ok: false, etat: 'refus', raison: parPage.raison }

  /*
   * Les totaux sont ceux des lignes rendues, et l'écran le dit : Google ne renvoie que les
   * cent premières, et les annoncer comme le total du site serait un chiffre faux.
   */
  const totaux = parPage.lignes.reduce(
    (somme, ligne) => ({
      clics: somme.clics + ligne.clics,
      impressions: somme.impressions + ligne.impressions,
    }),
    { clics: 0, impressions: 0 },
  )

  logger.info('recherches lues', {
    requetes: parRequete.lignes.length,
    pages: parPage.lignes.length,
  })

  return {
    ok: true,
    vue: {
      propriete,
      jours: JOURS_LUS,
      requetes: parRequete.lignes.slice(0, LIGNES_AFFICHEES),
      pages: parPage.lignes.slice(0, LIGNES_AFFICHEES),
      occasions: occasions(parPage.lignes).slice(0, LIGNES_AFFICHEES),
      occasionsDeRequetes: occasions(parRequete.lignes).slice(0, LIGNES_AFFICHEES),
      totaux,
    },
  }
}

/** Une recherche réelle, telle qu'elle est donnée au rédacteur. */
export type RequeteReelle = {
  requete: string
  impressions: number
  clics: number
  position: number
}

/** Ce qu'on donne au rédacteur. Au-delà, il dilue son sujet au lieu de le choisir. */
const REQUETES_POUR_ARTICLE = 12

/**
 * Le temps accordé à cette lecture avant de s'en passer.
 *
 * Bien plus court que le délai des appels eux-mêmes, et c'est le but : trois allers-retours
 * chez Google peuvent prendre une quarantaine de secondes dans le pire des cas, et cette
 * lecture précède un appel à un modèle qui en prendra autant. Une source d'appoint ne doit
 * pas décider du temps que met l'action principale — surtout celle qui est payée.
 */
const BUDGET_MS = 8_000

/**
 * Les recherches réelles à donner au rédacteur, ou une liste vide.
 *
 * Jusqu'ici, Milo choisissait son sujet à partir des manques du site — ce qui est honnête
 * quand on n'a rien d'autre, et faible quand on a mieux. Écrire sur ce que le site ne
 * couvre pas, c'est deviner la demande ; écrire sur ce que les gens tapent déjà pour
 * tomber en deuxième page, c'est la connaître.
 *
 * Deux règles tiennent cette fonction.
 *
 * **Elle ne fait jamais échouer un article.** Pas de connexion, propriété absente, Google
 * en panne, offre qui ne l'ouvre pas : tout rend la même liste vide, et la rédaction
 * continue sur les manques du site comme avant. Un article coûte quinze à trente crédits ;
 * le faire échouer parce qu'une source facultative n'a pas répondu serait indéfendable.
 *
 * **Les recherches de deuxième page passent devant.** Ce sont celles où le site figure déjà
 * sans être vu : un article qui les traite a une chance de gagner des places, là où un
 * article sur une requête où le site n'apparaît nulle part part de zéro. Les plus vues
 * complètent, jamais l'inverse.
 */
export async function recherchesPourArticle(
  userId: string,
  origin: string,
): Promise<RequeteReelle[]> {
  const lecture = await Promise.race([
    lireRecherches(userId, origin).catch(() => ({ ok: false }) as const),
    new Promise<{ ok: false }>((resoudre) => {
      const minuteur = setTimeout(() => resoudre({ ok: false }), BUDGET_MS)
      // Sans cela, le minuteur retiendrait le processus jusqu'à son terme après la réponse.
      minuteur.unref?.()
    }),
  ])
  return !lecture.ok || !('vue' in lecture) ? [] : retenirPourArticle(lecture.vue)
}

/** Le choix proprement dit, séparé de la lecture pour être vérifiable sans réseau. */
export function retenirPourArticle(
  vue: Pick<VueRecherches, 'occasionsDeRequetes' | 'requetes'>,
): RequeteReelle[] {
  const retenues: RequeteReelle[] = []
  const vues = new Set<string>()
  for (const ligne of [...vue.occasionsDeRequetes, ...vue.requetes]) {
    if (retenues.length >= REQUETES_POUR_ARTICLE) break
    if (vues.has(ligne.cle)) continue
    vues.add(ligne.cle)
    retenues.push({
      requete: ligne.cle,
      impressions: ligne.impressions,
      clics: ligne.clics,
      position: ligne.position,
    })
  }
  return retenues
}
