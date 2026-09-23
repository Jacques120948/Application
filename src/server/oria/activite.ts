import { withUserScope } from '@/server/db/scope'
import type { VisibilityAgentId } from '@/server/agents/visibility'

/**
 * Ce que l'équipe a fait, dans l'ordre où elle l'a fait.
 *
 * Le cahier des charges voulait « donner l'impression d'une équipe qui travaille
 * ensemble », avec des lignes comme « Oria a demandé à Cleo d'analyser la landing page ».
 * Cette ligne n'apparaît que lorsque c'est arrivé : une délégation réellement faite, avec
 * la réponse du spécialiste enregistrée. Avant que les délégations existent, elle n'était
 * pas écrite du tout — mettre en scène un travail qui n'a pas eu lieu donne une équipe
 * qu'on découvre factice, et qu'on ne croit plus même quand elle dit vrai.
 *
 * Le fil ne contient donc que des événements enregistrés, avec leur heure réelle : une
 * analyse terminée, un article rédigé, un constat ouvert par une règle publicitaire, une
 * panne repérée, une modification envoyée à une plateforme, une priorité transmise par
 * Oria. La preuve est dans les dates.
 *
 * Chaque lecture est isolée : une table qui répond mal retire ses lignes du fil, elle ne
 * le fait pas tomber.
 */

export type Evenement = {
  quand: Date
  qui: VisibilityAgentId
  /** Ce qui s'est passé, en une phrase. */
  quoi: string
  /**
   * Un travail fait, ou une chose constatée.
   *
   * Le rapport de la semaine ne compte comme « actions réalisées » que les premières : un
   * constat ouvert par une règle n'est pas une action, et le compter comme tel gonflerait
   * la semaine d'un travail qui n'a pas eu lieu.
   */
  genre: 'action' | 'constat'
}

/** Au-delà, un fil d'activité devient un journal, et un journal ne se lit pas. */
export const ACTIVITE_MAX = 8

async function sans<T>(lecture: Promise<T>, defaut: T): Promise<T> {
  return lecture.catch(() => defaut)
}

const PLATEFORME_AGENT: Record<string, VisibilityAgentId> = {
  'google-ads': 'ads',
  'meta-ads': 'meta',
}

/** Le prénom derrière chaque identifiant d'agent. */
const NOMS: Record<string, string> = {
  audit: 'Léa',
  seo: 'Néo',
  geo: 'Gia',
  content: 'Milo',
  cro: 'Cleo',
  ads: 'Naya',
  meta: 'MIRA',
  nova: 'Nova',
  lina: 'Lina',
}

/** Ce qu'une modification envoyée à une plateforme a touché, dit en mots. */
export const OBJETS_MODIFIES: Record<string, string> = {
  budget: 'un budget',
  'budget-ensemble': 'le budget d’un ensemble de publicités',
  campagne: 'une campagne',
  pause: 'une mise en pause',
  'pause-ensemble': 'la mise en pause d’un ensemble de publicités',
  'pause-annonce': 'la mise en pause d’une publicité',
  exclusion: 'une exclusion de recherche',
  image: 'un visuel',
  'mot-cle': 'un mot-clé',
}

/**
 * Les derniers événements réels de l'équipe, du plus récent au plus ancien.
 *
 * `siteId` peut manquer — quelqu'un qui n'a encore analysé aucun site peut avoir un compte
 * publicitaire relié. Les événements du site sont alors simplement absents.
 */
export async function lireActivite(
  userId: string,
  siteId: string | null,
  limite = ACTIVITE_MAX,
): Promise<Evenement[]> {
  const [audits, articles, pannes, constats, actions, delegations] = await Promise.all([
    siteId === null
      ? Promise.resolve([])
      : sans(
          withUserScope(userId, (tx) =>
            tx.audit.findMany({
              where: { userId, siteId, status: 'done', finishedAt: { not: null } },
              orderBy: { finishedAt: 'desc' },
              take: limite,
              select: { finishedAt: true, pagesCrawled: true },
            }),
          ),
          [],
        ),
    siteId === null
      ? Promise.resolve([])
      : sans(
          withUserScope(userId, (tx) =>
            tx.siteArticle.findMany({
              where: { userId, siteId },
              orderBy: { createdAt: 'desc' },
              take: limite,
              select: { createdAt: true, titre: true },
            }),
          ),
          [],
        ),
    siteId === null
      ? Promise.resolve([])
      : sans(
          withUserScope(userId, (tx) =>
            tx.siteWatch.findMany({
              where: { userId, siteId },
              orderBy: { openedAt: 'desc' },
              take: limite,
              select: { openedAt: true, url: true },
            }),
          ),
          [],
        ),
    sans(
      withUserScope(userId, (tx) =>
        tx.adsRecommandation.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limite,
          select: { createdAt: true, titre: true, account: { select: { plateforme: true } } },
        }),
      ),
      [],
    ),
    sans(
      withUserScope(userId, (tx) =>
        tx.adsAction.findMany({
          // Seules les modifications réellement parties : une action refusée ou encore
          // prévue n'a rien changé, et la compter ici laisserait croire le contraire.
          where: { userId, resultat: 'reussi' },
          orderBy: { createdAt: 'desc' },
          take: limite,
          select: { createdAt: true, quoi: true, account: { select: { plateforme: true } } },
        }),
      ),
      [],
    ),
    /*
     * Les délégations d'Oria : des questions réellement posées à un spécialiste, et
     * réellement répondues. C'est la seule façon dont le fil peut dire « Oria a demandé à
     * Cleo » sans mentir — il ne le disait pas avant qu'elles existent.
     */
    siteId === null
      ? Promise.resolve([])
      : sans(
          withUserScope(userId, (tx) =>
            tx.visibilityNote.findMany({
              where: { userId, siteId, demandePar: { in: ['oria', 'nova', 'lina'] } },
              orderBy: { createdAt: 'desc' },
              take: limite,
              select: { createdAt: true, agent: true, demandePar: true },
            }),
          ),
          [],
        ),
  ])

  const fil: Evenement[] = [
    ...audits.flatMap((audit) =>
      audit.finishedAt === null
        ? []
        : [
            {
              quand: audit.finishedAt,
              qui: 'audit' as const,
              genre: 'action' as const,
              quoi: `Léa a terminé une analyse du site : ${audit.pagesCrawled} page${audit.pagesCrawled > 1 ? 's' : ''} lue${audit.pagesCrawled > 1 ? 's' : ''}.`,
            },
          ],
    ),
    ...articles.map((article) => ({
      quand: article.createdAt,
      qui: 'content' as const,
      genre: 'action' as const,
      quoi: `Milo a rédigé « ${article.titre} ».`,
    })),
    ...pannes.map((panne) => ({
      quand: panne.openedAt,
      qui: 'audit' as const,
      genre: 'constat' as const,
      quoi: `Léa a repéré un problème sur ${panne.url === '' ? 'le site' : panne.url}.`,
    })),
    ...constats.flatMap((constat) => {
      const qui = PLATEFORME_AGENT[constat.account.plateforme]
      if (qui === undefined) return []
      const nom = qui === 'ads' ? 'Naya' : 'MIRA'
      return [
        {
          quand: constat.createdAt,
          qui,
          genre: 'constat' as const,
          quoi: `${nom} a relevé : ${constat.titre}.`,
        },
      ]
    }),
    ...actions.flatMap((action) => {
      const qui = PLATEFORME_AGENT[action.account.plateforme]
      if (qui === undefined) return []
      const nom = qui === 'ads' ? 'Naya' : 'MIRA'
      return [
        {
          quand: action.createdAt,
          qui,
          genre: 'action' as const,
          quoi: `${nom} a appliqué une modification validée sur ${OBJETS_MODIFIES[action.quoi] ?? 'la plateforme'}.`,
        },
      ]
    }),
  ]

  for (const delegation of delegations) {
    const destinataire = NOMS[delegation.agent]
    if (destinataire === undefined) continue
    const qui = delegation.demandePar === 'nova' ? 'nova' : delegation.demandePar === 'lina' ? 'lina' : 'oria'
    fil.push({
      quand: delegation.createdAt,
      qui,
      genre: 'action',
      quoi:
        qui === 'nova'
          ? `Nova a transmis une mesure à ${destinataire}, qui a répondu.`
          : qui === 'lina'
            ? `Lina a confié une campagne à ${destinataire}, qui a répondu.`
            : `Oria a transmis une priorité à ${destinataire}, qui a répondu.`,
    })
  }

  return fil.sort((a, b) => +b.quand - +a.quand).slice(0, limite)
}
