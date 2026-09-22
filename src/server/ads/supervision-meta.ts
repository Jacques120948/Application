import { prisma } from '@/server/db/client'
import { logger } from '@/server/observability/logger'

/**
 * Le compteur d'exploitation de MIRA.
 *
 * Il répond à une question que le journal ne peut pas servir : **MIRA fonctionne-t-elle ?**
 * Le journal, lui, appartient à chaque client et reste cloisonné par propriétaire ; un
 * comptage fait depuis le back-office y rendrait zéro, parce qu'un administrateur est un
 * utilisateur comme un autre et que le cloisonnement ne lui fait pas d'exception. Percer
 * cette règle pour le confort de la supervision rouvrirait la porte que tout le reste du
 * produit ferme.
 *
 * On compte donc ailleurs ce qui n'a pas besoin d'appartenir à quelqu'un : le geste, son
 * issue, ce que Meta a répondu. Ni personne, ni compte, ni campagne, ni montant. C'est
 * exactement ce qu'il faut pour voir une intégration se dégrader, et rien de ce qu'il
 * faudrait pour observer le commerce d'un client — ce qui est le partage voulu.
 *
 * Aucune de ces écritures ne peut faire échouer une modification : ce sont des compteurs,
 * pas des garde-fous. Une panne ici doit coûter une statistique, jamais un geste.
 */

/**
 * Un identifiant Meta, dans un message d'erreur.
 *
 * Meta cite volontiers l'objet fautif : « Object with ID '120214...' does not exist ». Ces
 * suites de chiffres désignent le compte, l'ensemble ou l'annonce d'un client — c'est-à-dire
 * précisément ce que cette table ne doit pas contenir. On les masque plutôt que d'écarter
 * tout le message : la phrase qui reste dit ce qui cloche, et c'est elle qui sert.
 *
 * Six chiffres au moins : en dessous, c'est un nombre ordinaire — un budget, un compte de
 * jours — et le masquer rendrait le message illisible.
 */
const IDENTIFIANT = /\d{6,}/gu

/** Au-delà, un message d'erreur n'informe plus, il encombre. */
const DETAIL_MAX = 300

/** Nettoie la réponse de Meta de ce qui désignerait un client. */
export function sansIdentifiants(message: string): string {
  return message.replace(IDENTIFIANT, '…').slice(0, DETAIL_MAX)
}

/**
 * Note un geste dans les compteurs d'exploitation.
 *
 * Ne lève jamais. L'appelant est en train d'écrire chez Meta ou de journaliser ce qu'il
 * vient d'écrire : lui faire porter l'échec d'une statistique serait échanger une
 * modification contre un chiffre.
 */
export async function noterSupervisionMeta(entree: {
  quoi: string
  resultat: string
  detail?: string
  retour?: boolean
}): Promise<void> {
  try {
    await prisma.metaSupervision.create({
      data: {
        quoi: entree.quoi,
        resultat: entree.resultat,
        detail: sansIdentifiants(entree.detail ?? ''),
        retour: entree.retour ?? false,
      },
    })
  } catch (error) {
    logger.warn('supervision Meta : compteur non écrit', { message: (error as Error).message })
  }
}

/** La fenêtre du bilan. Trente jours couvrent un cycle de facturation publicitaire. */
export const JOURS_SUPERVISION = 30

/** Ce qu'on montre du détail. Au-delà, ce n'est plus un aperçu. */
const DERNIERS_MAX = 12

export type SupervisionMeta = {
  jours: number
  total: number
  reussies: number
  refusees: number
  /** Écritures coupées en plein vol : parties sans qu'on sache si elles sont arrivées. */
  inconnues: number
  retours: number
  /** Les refus récents, pour lire ce que Meta reproche. */
  derniersRefus: { id: string; detail: string; quoi: string; createdAt: Date }[]
}

/**
 * Le bilan des trente derniers jours.
 *
 * Trois signaux, et ils ne disent pas la même chose. Les **refus de Meta** mesurent la
 * santé de l'intégration : quelques-uns sont normaux — une publicité supprimée entre-temps,
 * un budget déjà modifié ailleurs — mais une proportion qui monte veut dire que le produit
 * propose des gestes que Meta n'accepte pas. Les **retours arrière** disent autre chose : un
 * client qui défait ce que MIRA a fait n'est pas d'accord avec elle, et beaucoup de retours
 * veulent dire qu'une règle propose de mauvais gestes. Les **issues inconnues**, enfin,
 * signalent des écritures coupées en plein vol, qu'aucune relecture n'a tranchées.
 */
export async function bilanSupervisionMeta(): Promise<SupervisionMeta> {
  const depuis = new Date(Date.now() - JOURS_SUPERVISION * 24 * 60 * 60 * 1000)
  const fenetre = { createdAt: { gte: depuis } }

  const [total, reussies, refusees, inconnues, retours, derniersRefus] = await Promise.all([
    prisma.metaSupervision.count({ where: fenetre }),
    prisma.metaSupervision.count({ where: { ...fenetre, resultat: 'reussi' } }),
    prisma.metaSupervision.count({ where: { ...fenetre, resultat: 'refuse' } }),
    prisma.metaSupervision.count({ where: { ...fenetre, resultat: 'prevu' } }),
    prisma.metaSupervision.count({ where: { ...fenetre, retour: true } }),
    prisma.metaSupervision.findMany({
      where: { ...fenetre, resultat: 'refuse' },
      orderBy: { createdAt: 'desc' },
      take: DERNIERS_MAX,
      select: { id: true, detail: true, quoi: true, createdAt: true },
    }),
  ])

  return { jours: JOURS_SUPERVISION, total, reussies, refusees, inconnues, retours, derniersRefus }
}
