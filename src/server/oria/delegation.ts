import { membre } from '@/lib/equipe'
import { notFound, validation } from '@/lib/errors'
import { askVisibility, type VisibilityNoteView } from '@/server/agents/visibility-service'
import type { VisibilityAgentId } from '@/server/agents/visibility'
import { lireSignaux, type Signal } from './signaux'

/**
 * Oria transmet une priorité à un spécialiste.
 *
 * C'est le cœur de son rôle d'orchestratrice, et il tient en une règle du cahier des
 * charges : elle ne refait pas le travail d'un spécialiste, elle le lui demande. Quand MIRA
 * voit une campagne qui s'essouffle, ce n'est pas à Oria d'analyser la page d'arrivée —
 * c'est à Cleo. Oria prépare la question, la personne la valide d'un clic, et Cleo répond
 * dans sa propre conversation, avec son propre contexte.
 *
 * **Rien ne part sans clic.** Une délégation est une question posée à un spécialiste, et
 * une question coûte des crédits. Oria la prépare ; elle ne l'envoie jamais seule. Le jour
 * où l'on voudra qu'elle le fasse, ce sera un réglage explicite, borné, et affiché.
 *
 * **Le navigateur désigne, il ne rédige pas.** On ne reçoit de lui que l'identifiant du
 * point et le destinataire. Le point est relu côté serveur parmi ceux de la personne, la
 * question est écrite ici, et le destinataire doit figurer parmi ceux qu'Oria propose pour
 * ce point. Une question arbitraire envoyée au nom d'Oria n'est pas possible.
 *
 * **Le chemin est celui de toute question.** Droits, crédits, contexte du spécialiste :
 * une délégation passe exactement par là où passe une question posée à la main. Elle n'en
 * diffère que par une trace — `demandePar` — qui permet au fil d'activité de dire, cette
 * fois vrai, « Oria a demandé à Cleo ».
 */

export type Destinataire = {
  agent: VisibilityAgentId
  /** Ce qu'on lui demande, en quelques mots, pour le bouton. */
  pour: string
}

/** Trois au plus : au-delà, un choix de destinataire redevient une liste. */
const DESTINATAIRES_MAX = 3

/** La longueur que la conversation d'un spécialiste accepte pour une question. */
const QUESTION_MAX = 600

function nom(id: string): string {
  return membre(id)?.name ?? id
}

/**
 * À qui ce point peut être transmis, et pour quoi faire.
 *
 * D'abord ceux qui l'ont relevé, pour qu'ils le détaillent. Puis les collègues dont le
 * métier complète le leur — c'est là qu'Oria sert réellement : MIRA voit la fatigue d'une
 * campagne, Milo peut proposer d'autres angles ; Naya voit des clics sans vente, Cleo peut
 * regarder la page où ils arrivent. Ces enchaînements sont ceux du cahier des charges, et
 * ils sont écrits ici plutôt que devinés par un modèle.
 */
export function destinataires(signal: Pick<Signal, 'sources'>): Destinataire[] {
  const liste: Destinataire[] = []
  const ajouter = (agent: VisibilityAgentId, pour: string) => {
    if (!liste.some((un) => un.agent === agent)) liste.push({ agent, pour })
  }

  for (const source of signal.sources) ajouter(source, 'détailler ce point')

  const payant = signal.sources.includes('ads') || signal.sources.includes('meta')
  if (payant) ajouter('cro', 'vérifier les pages où arrive le trafic')
  if (signal.sources.includes('meta')) ajouter('content', 'proposer de nouveaux angles')
  if (signal.sources.some((source) => source === 'cro' || source === 'seo' || source === 'geo')) {
    ajouter('content', 'rédiger le texte à mettre à la place')
  }

  return liste.slice(0, DESTINATAIRES_MAX)
}

function couper(texte: string, longueur: number): string {
  const propre = texte.replace(/\s+/gu, ' ').trim()
  return propre.length <= longueur ? propre : `${propre.slice(0, longueur - 1).trimEnd()}…`
}

/**
 * La question qu'Oria pose, écrite ici et nulle part ailleurs.
 *
 * Elle cite le point tel que le spécialiste d'origine l'a formulé et nomme celui-ci : le
 * destinataire sait d'où vient la demande, et la personne qui relit sa conversation aussi.
 */
export function questionPour(
  signal: Pick<Signal, 'titre' | 'pourquoi' | 'mesure' | 'sources'>,
  agent: VisibilityAgentId,
): string {
  const auteurs = signal.sources.map(nom).join(' et ')
  const titre = couper(signal.titre, 140)
  const pourquoi = couper(signal.pourquoi, 220)

  let question: string
  if (signal.sources.includes(agent)) {
    question = `Oria vous transmet ce point, classé parmi les priorités : « ${titre} ». ${pourquoi} Que faut-il faire, concrètement, et par quoi commencer ?`
  } else if (agent === 'cro') {
    question = `${auteurs} a relevé : « ${titre} ». Avant de toucher au budget, Oria veut savoir si les pages du site donnent de quoi décider à ceux qui arrivent par la publicité. Qu’est-ce qui cloche en premier sur ces pages ?`
  } else if (agent === 'content' && signal.sources.includes('meta')) {
    question = `MIRA a relevé : « ${titre} ». Proposez cinq angles de message différents pour renouveler cette publicité, à partir de ce que le site vend. N’inventez aucun chiffre.`
  } else if (agent === 'content') {
    question = `${auteurs} a relevé : « ${titre} ». ${pourquoi} Proposez le texte à mettre à la place, prêt à copier.`
  } else {
    question = `${auteurs} a relevé : « ${titre} ». ${pourquoi} Qu’en pensez-vous, et que faut-il faire ?`
  }
  return couper(question, QUESTION_MAX)
}

/**
 * Transmet un point à un spécialiste, et rend sa réponse.
 *
 * Le point est relu ici, parmi ceux de la personne : l'identifiant venu du navigateur ne
 * désigne rien d'autre que ce qu'elle voit déjà sur son cockpit.
 */
export async function deleguer(
  userId: string,
  entree: { siteId?: string; cle: string; agent: VisibilityAgentId },
  locale: string,
): Promise<VisibilityNoteView> {
  const vue = await lireSignaux(userId, locale, entree.siteId)
  if (vue.site === null) {
    throw validation('Oria ne transmet que sur un site analysé : lancez d’abord une analyse.')
  }
  const signal = vue.signaux.find((un) => un.cle === entree.cle)
  if (signal === undefined) throw notFound('Ce point n’est plus ouvert.')
  if (!destinataires(signal).some((un) => un.agent === entree.agent)) {
    throw validation('Oria ne transmet pas ce point à ce spécialiste.')
  }

  return askVisibility(
    userId,
    { siteId: vue.site.id, agent: entree.agent, question: questionPour(signal, entree.agent), history: [] },
    locale,
    { demandePar: 'oria' },
  )
}
