import { prisma } from '@/server/db/client'

/**
 * Ce qui a récemment échoué pour un créateur.
 *
 * L'agent sait lire l'application et ses contrôles, donc diagnostiquer ce qui cloche dans
 * ce qui a été construit. Il ne voyait rien, en revanche, de ce qui s'est mal passé *en
 * chemin* : une publication interrompue, une image refusée, une modification qui n'a pas
 * abouti. Or c'est exactement ce qu'un créateur signale — « j'ai essayé et ça n'a pas
 * marché » — sans pouvoir en dire plus, parce qu'il n'a vu qu'un message d'erreur qu'il a
 * refermé.
 *
 * Trois règles, et chacune est une limite qu'on se donne.
 *
 * **Seulement les siens.** La requête est bornée à l'identifiant du créateur. Un agent qui
 * pourrait lire les incidents d'un autre serait une fuite, même sans intention.
 *
 * **Seulement ce qui le concerne.** Le message brut du fournisseur ne sort pas d'ici : il
 * peut contenir un nom d'hôte, une limite de compte, un détail d'infrastructure. On en
 * garde le code, traduit en une phrase que le créateur comprend et que l'agent peut
 * répéter sans rien apprendre à personne.
 *
 * **Seulement le récent.** Un échec d'il y a trois semaines n'explique pas ce qui vient
 * d'arriver, et l'évoquer ferait douter d'une application qui marche.
 */

/** Au-delà, ce n'est plus un incident, c'est une habitude — et ce n'est plus à l'agent d'y répondre. */
const MAX_INCIDENTS = 5

/** Fenêtre : ce qui est arrivé pendant la session de travail en cours, en gros. */
const FENETRE_MS = 48 * 60 * 60 * 1000

export type Incident = {
  /** L'opération, nommée comme le créateur la connaît. */
  quoi: string
  /** Ce qui s'est passé, en français courant. */
  pourquoi: string
  quand: Date
}

/** Les opérations, dites comme le créateur les a vécues, pas comme le code les nomme. */
const OPERATIONS: Record<string, string> = {
  blueprint: 'analyse de votre idée',
  specsheet: 'rédaction du cahier des charges',
  generate: 'construction de votre application',
  edit: 'modification de votre application',
  image: "création d'une image",
  assistant: "réponse de l'assistant de votre application",
  coach: 'réponse du coach',
  launchKit: 'préparation de votre lancement',
  radar: 'recherche du Radar',
  liaAnswer: 'réponse de Lia à un visiteur',
}

/**
 * Le code technique, traduit.
 *
 * Chaque phrase dit ce que le créateur peut faire, ou qu'il n'a rien à faire. Un code
 * inconnu n'invente rien : il dit qu'on ne sait pas, ce qui est la seule réponse honnête et
 * ce qui conduit l'agent à proposer de transmettre plutôt qu'à broder.
 */
const MOTIFS: Record<string, string> = {
  INSUFFICIENT_CREDITS: 'il ne restait plus assez de crédits pour aller au bout',
  PLAN_LIMIT: "l'offre en cours ne permettait pas cette action",
  RATE_LIMITED: 'trop de demandes se sont succédé en peu de temps',
  AI_UNAVAILABLE: "l'assistant était momentanément indisponible ; réessayer suffit en général",
  AI_REFUSED: "l'assistant a refusé la demande telle qu'elle était formulée",
  VALIDATION: "la demande n'était pas valide en l'état",
  UNSUPPORTED_REQUEST: 'la demande sortait de ce que la plateforme sait construire',
  CREATOR_KEY_REJECTED: 'le compte extérieur relié a refusé la clé',
  network: 'la connexion avec le fournisseur a échoué',
}

export async function recentIncidents(userId: string): Promise<Incident[]> {
  const depuis = new Date(Date.now() - FENETRE_MS)
  const rows = await prisma.aiUsage
    .findMany({
      where: { userId, success: false, createdAt: { gte: depuis } },
      orderBy: { createdAt: 'desc' },
      take: MAX_INCIDENTS,
      // `errorMessage` n'est volontairement pas lu : il ne doit pas pouvoir remonter
      // jusqu'au modèle, donc jusqu'au créateur.
      select: { operation: true, errorCode: true, createdAt: true },
    })
    .catch(() => [])

  return rows.map((row) => ({
    quoi: OPERATIONS[row.operation] ?? row.operation,
    pourquoi:
      row.errorCode === null
        ? "la cause exacte n'a pas été enregistrée"
        : (MOTIFS[row.errorCode] ?? "la cause exacte n'est pas connue de moi"),
    quand: row.createdAt,
  }))
}

/** Le rapport tel que l'agent le lit. Vide quand rien n'a échoué, et c'est le cas courant. */
export function describeIncidents(incidents: readonly Incident[]): string {
  if (incidents.length === 0) {
    return [
      "Rien n'a échoué pour ce créateur ces deux derniers jours.",
      "Si quelque chose ne marche pas malgré tout, ce n'est pas une panne de la plateforme :",
      "cherche dans l'application elle-même, avec les contrôles et les pages.",
    ].join(' ')
  }
  return [
    'Ce qui a échoué récemment, du plus récent au plus ancien :',
    ...incidents.map(
      (incident) =>
        `- ${incident.quoi}, le ${incident.quand.toLocaleDateString('fr-FR')} : ${incident.pourquoi}.`,
    ),
  ].join('\n')
}
