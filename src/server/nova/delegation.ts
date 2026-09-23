import { membre } from '@/lib/equipe'
import { notFound, validation } from '@/lib/errors'
import { askVisibility, type VisibilityNoteView } from '@/server/agents/visibility-service'
import type { VisibilityAgentId } from '@/server/agents/visibility'
import { lireNova } from './service'

/**
 * Nova transmet une mesure au spécialiste qui peut agir.
 *
 * Mêmes règles que les délégations d'Oria, et pour les mêmes raisons. Rien ne part sans
 * clic : une transmission est une question posée à un spécialiste, et elle coûte ce qu'une
 * question coûte. Le navigateur désigne un point et un destinataire ; le point est relu ici,
 * parmi ceux que Nova a calculés pour la personne, et le destinataire doit être celui que
 * Nova a nommé pour ce point. La question est écrite ici, avec les chiffres de Nova — le
 * spécialiste part d'une mesure, pas d'une impression.
 */

const QUESTION_MAX = 600

function couper(texte: string, longueur: number): string {
  const propre = texte.replace(/\s+/gu, ' ').trim()
  return propre.length <= longueur ? propre : `${propre.slice(0, longueur - 1).trimEnd()}…`
}

/** Ce que Nova demande, selon qui reçoit. */
export function questionNova(point: { titre: string; pourquoi: string }, agent: VisibilityAgentId): string {
  const titre = couper(point.titre, 160)
  const pourquoi = couper(point.pourquoi, 260)
  const suite: Partial<Record<VisibilityAgentId, string>> = {
    cro: 'Qu’est-ce qui, sur les pages concernées, peut retenir les visiteurs d’acheter ? Par quoi commencer ?',
    ads: 'Qu’en conclure pour les campagnes Google Ads, et que faut-il ajuster en premier — sans rien modifier sans accord ?',
    meta: 'Qu’en conclure pour les campagnes Meta, et que faut-il ajuster en premier — sans rien modifier sans accord ?',
    seo: 'Comment renforcer ces pages dans Google, concrètement ?',
    geo: 'Comment rendre le site plus facile à citer pour ces assistants ?',
    content: 'Quel contenu faudrait-il produire pour en tirer parti ?',
    audit: 'Un audit technique est-il nécessaire, et que faut-il vérifier en premier ?',
  }
  return couper(
    `Nova vous transmet une mesure : « ${titre} ». ${pourquoi} ${suite[agent] ?? 'Que faut-il faire ?'} Ce sont des chiffres observés, pas une cause prouvée.`,
    QUESTION_MAX,
  )
}

export async function deleguerNova(
  userId: string,
  entree: { siteId?: string; cle: string; agent: VisibilityAgentId; periode?: string; du?: string; au?: string },
  locale: string,
): Promise<VisibilityNoteView> {
  // La période est revalidée par periodeDe : une valeur fantaisiste retombe sur trente jours.
  const vue = await lireNova(userId, locale, { periode: entree.periode ?? '30', du: entree.du, au: entree.au, siteId: entree.siteId })
  if (vue.siteId === '') throw validation('Nova ne transmet que sur un site analysé : lancez d’abord une analyse.')
  const opportunite = vue.opportunites.find((un) => un.cle === entree.cle)
  const alerte = vue.alertes.find((un) => un.cle === entree.cle)
  const point =
    opportunite !== undefined
      ? { titre: opportunite.titre, pourquoi: opportunite.pourquoi, agent: opportunite.agent }
      : alerte !== undefined
        ? { titre: alerte.texte, pourquoi: alerte.fondement, agent: alerte.agent }
        : null
  if (point === null) throw notFound('Ce point n’est plus d’actualité.')
  if (point.agent !== entree.agent) {
    throw validation(`Nova transmet ce point à ${membre(point.agent)?.name ?? point.agent}, pas à ce spécialiste.`)
  }
  return askVisibility(
    userId,
    { siteId: vue.siteId, agent: entree.agent, question: questionNova(point, entree.agent), history: [] },
    locale,
    { demandePar: 'nova' },
  )
}
