import type { VisibilityAgentId } from '@/server/agents/visibility'

/**
 * L'état de chaque canal, en un mot.
 *
 * C'est le bloc qu'on lit en trois secondes avant tout le reste, et c'est pour cela qu'il
 * est le plus exposé au mensonge par simplification. Trois règles le tiennent.
 *
 * **Un canal sans donnée n'est pas un canal en bonne santé.** Sans compte Meta relié, Oria
 * ne dit pas « Meta : bon » ni « Meta : à surveiller » : elle dit qu'elle ne sait pas, et
 * elle dit comment le savoir. C'est la différence entre un produit qui informe et un
 * produit qui rassure, et c'est exactement le reproche qu'on fait aux tableaux de bord.
 *
 * **Chaque état vient d'un nombre.** Une note calculée, un nombre de constats ouverts. La
 * phrase qui l'accompagne cite ce nombre : personne ne doit avoir à croire Oria sur parole,
 * et « pourquoi à renforcer ? » doit avoir une réponse en une ligne.
 *
 * **Les seuils sont ici, nommés.** Ils encodent un jugement — à partir de quand une note
 * inquiète — et un jugement dispersé dans quinze conditions n'est plus discutable.
 */

/** En deçà, la note demande du travail. Au-dessus du second seuil, elle n'appelle rien. */
const NOTE_BONNE = 75
const NOTE_MOYENNE = 50

export const ETATS_CANAL = ['bon', 'surveiller', 'renforcer', 'inconnu'] as const

export type EtatCanal = (typeof ETATS_CANAL)[number]

export type Canal = {
  id: VisibilityAgentId | 'technique'
  /** Le nom du canal, pas celui de l'agent : on lit « Référencement », pas « Néo ». */
  nom: string
  etat: EtatCanal
  /** Le chiffre qui a décidé de l'état, dit en une phrase. */
  pourquoi: string
  /** Ce qu'il faut relier pour que ce canal cesse d'être inconnu. Vide sinon. */
  aRelier: string
}

function deLaNote(note: number | null, quoi: string): { etat: EtatCanal; pourquoi: string } {
  if (note === null) {
    return { etat: 'inconnu', pourquoi: `Pas encore mesuré : lancez une analyse de votre site.` }
  }
  if (note >= NOTE_BONNE) return { etat: 'bon', pourquoi: `${note}/100 ${quoi}.` }
  if (note >= NOTE_MOYENNE) return { etat: 'surveiller', pourquoi: `${note}/100 ${quoi}.` }
  return { etat: 'renforcer', pourquoi: `${note}/100 ${quoi}.` }
}

/**
 * L'état d'un canal publicitaire.
 *
 * Il ne se juge pas sur une note — il n'y en a pas — mais sur ce que les règles de Naya ou
 * de MIRA ont laissé ouvert. Un constat urgent ouvert est le signe le plus direct qu'un
 * budget part sans contrepartie, et c'est du calcul : les règles sont du code.
 */
function duPublicitaire(
  relie: boolean,
  urgents: number,
  aSurveiller: number,
  nomPlateforme: string,
): { etat: EtatCanal; pourquoi: string; aRelier: string } {
  if (!relie) {
    return {
      etat: 'inconnu',
      pourquoi: `Aucun compte ${nomPlateforme} n’est relié : je ne peux rien dire de ce canal.`,
      aRelier: nomPlateforme,
    }
  }
  if (urgents > 0) {
    return {
      etat: 'renforcer',
      pourquoi: `${urgents} constat${urgents > 1 ? 's' : ''} urgent${urgents > 1 ? 's' : ''} ouvert${urgents > 1 ? 's' : ''}.`,
      aRelier: '',
    }
  }
  if (aSurveiller > 0) {
    return {
      etat: 'surveiller',
      pourquoi: `${aSurveiller} point${aSurveiller > 1 ? 's' : ''} à surveiller.`,
      aRelier: '',
    }
  }
  return { etat: 'bon', pourquoi: 'Aucun constat ouvert sur ce compte.', aRelier: '' }
}

export type EntreeSante = {
  seoScore: number | null
  geoScore: number | null
  croScore: number | null
  /** Le site a-t-il été analysé jusqu'au bout au moins une fois ? */
  siteAnalyse: boolean
  /** Ce que la surveillance trouve cassé en ce moment. */
  pannes: number
  ads: { relie: boolean; urgents: number; aSurveiller: number }
  meta: { relie: boolean; urgents: number; aSurveiller: number }
}

/**
 * La santé marketing, canal par canal.
 *
 * Fonction pure : elle ne lit rien, elle juge ce qu'on lui donne. C'est ce qui permet de
 * l'éprouver sur les cas qui comptent — le canal sans donnée, la note absente — sans monter
 * une base de données.
 */
export function santeMarketing(entree: EntreeSante): Canal[] {
  const technique: Canal =
    !entree.siteAnalyse
      ? {
          id: 'technique',
          nom: 'Technique',
          etat: 'inconnu',
          pourquoi: 'Pas encore d’analyse de votre site.',
          aRelier: '',
        }
      : entree.pannes > 0
        ? {
            id: 'technique',
            nom: 'Technique',
            etat: 'renforcer',
            pourquoi: `${entree.pannes} problème${entree.pannes > 1 ? 's' : ''} détecté${entree.pannes > 1 ? 's' : ''} par la surveillance.`,
            aRelier: '',
          }
        : {
            id: 'technique',
            nom: 'Technique',
            etat: 'bon',
            pourquoi: 'Rien de cassé depuis le dernier passage de la surveillance.',
            aRelier: '',
          }

  const ads = duPublicitaire(
    entree.ads.relie,
    entree.ads.urgents,
    entree.ads.aSurveiller,
    'Google Ads',
  )
  const meta = duPublicitaire(
    entree.meta.relie,
    entree.meta.urgents,
    entree.meta.aSurveiller,
    'Meta Ads',
  )

  return [
    { id: 'seo', nom: 'Référencement', ...deLaNote(entree.seoScore, 'sur la note de Néo'), aRelier: '' },
    { id: 'geo', nom: 'Moteurs IA', ...deLaNote(entree.geoScore, 'sur la note de Gia'), aRelier: '' },
    {
      id: 'cro',
      nom: 'Conversion',
      ...deLaNote(entree.croScore, 'sur la note de Cleo'),
      aRelier: '',
    },
    { id: 'ads', nom: 'Google Ads', ...ads },
    { id: 'meta', nom: 'Meta Ads', ...meta },
    technique,
  ]
}

/**
 * La faiblesse principale, quand il y en a une.
 *
 * Elle sert la phrase d'Oria — « votre acquisition fonctionne, votre faiblesse est la
 * conversion ». On prend le canal le plus dégradé, et jamais un canal inconnu : ne pas
 * savoir n'est pas une faiblesse du marketing, c'est une donnée qui manque, et les
 * confondre ferait dire à Oria qu'un canal va mal parce qu'elle ne l'a pas regardé.
 */
export function faiblessePrincipale(canaux: readonly Canal[]): Canal | null {
  return (
    canaux.find((canal) => canal.etat === 'renforcer') ??
    canaux.find((canal) => canal.etat === 'surveiller') ??
    null
  )
}

/** Ce qui manque pour qu'Oria voie plus loin. Sert le « Connecter Meta Ads » de l'écran. */
export function canauxInconnus(canaux: readonly Canal[]): Canal[] {
  return canaux.filter((canal) => canal.etat === 'inconnu')
}
