import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import type { Severity } from './checks/types'
import { estCorrigeable } from './corrections'
import { findCheck } from './scoring'

/**
 * Le plan d'action et l'historique.
 *
 * Un audit qui rend trente constats et repart de zéro le mois suivant n'est pas un plan,
 * c'est un rapport. Quatre décisions font la différence.
 *
 * **L'état appartient au site, pas à l'audit.** « Corrigée » ou « ignorée » doit survivre à
 * l'audit suivant, sinon la liste se réinitialise chaque mois et tout le travail de tri est
 * à refaire. C'est pour cela que `ActionItem` pend au site et porte un identifiant de
 * contrôle, jamais un identifiant d'audit.
 *
 * **Ce qu'on a dit corrigé se vérifie tout seul.** Marquer « corrigée » est une déclaration ;
 * l'audit suivant est la preuve. Quand le constat a disparu, on le dit — c'est le seul
 * moment du produit où quelqu'un voit que son travail a porté. Quand il est toujours là, on
 * le dit aussi, et c'est plus utile encore : la correction n'a pas pris.
 *
 * **Comparer deux audits, c'est nommer ce qui a bougé.** Deux notes côte à côte disent qu'on
 * a gagné quatre points ; la comparaison dit lesquels, et sur quoi. « Trois pages ont
 * retrouvé une description, une nouvelle page est apparue sans titre » est une phrase qu'on
 * peut agir, « +4 » ne l'est pas.
 *
 * **Rien n'est jamais effacé.** Un audit reste, ses constats restent. C'est ce qui permet de
 * remonter six mois en arrière et de voir d'où l'on part.
 */

/** Les états d'une ligne du plan. Une liste de travail, pas une case à cocher. */
export const ETATS_ACTION = ['todo', 'doing', 'done', 'ignored'] as const

export type EtatAction = (typeof ETATS_ACTION)[number]

export function estUnEtat(valeur: string): valeur is EtatAction {
  return (ETATS_ACTION as readonly string[]).includes(valeur)
}

export type LignePlan = {
  checkId: string
  engine: string
  label: string
  why: string
  scope: string
  severity: Severity
  affected: number
  examined: number
  lost: number
  sample: { path: string; url: string; title: string }[]
  state: EtatAction
  note: string
  /** L'équipe sait rédiger la correction de ce constat. */
  corrigeable: boolean
  /** La correction tient en une modification locale. Un jugement d'effort, pas de gain. */
  rapide: boolean
  /**
   * Ce qui a déjà été rédigé pour ce constat, et déjà payé.
   *
   * Relire ne coûte rien, et c'est la moindre des choses : un texte payé une fois ne se
   * repaie pas parce qu'on a rechargé la page.
   */
  corrections: { path: string; url: string; field: string; before: string; after: string }[]
}

export type Plan = {
  auditId: string
  finishedAt: Date | null
  /** Les constats du dernier audit, avec leur état. Les plus coûteux d'abord. */
  lignes: LignePlan[]
  /**
   * Ce qui avait été marqué corrigé ou ignoré et ne figure plus dans le dernier audit.
   *
   * On le montre à part plutôt que de le faire disparaître : voir ce qu'on a réglé est ce
   * qui donne envie de continuer, et c'est la seule trace du travail accompli.
   */
  reglees: { checkId: string; label: string; engine: string; state: EtatAction }[]
}

/** Le dernier audit terminé d'un site, et son identifiant. */
async function dernierAudit(userId: string, siteId: string) {
  return withUserScope(userId, (tx) =>
    tx.audit.findFirst({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      select: { id: true, finishedAt: true },
    }),
  )
}

/**
 * Le plan d'action d'un site.
 *
 * Les libellés viennent du catalogue et non de la base : réécrire une explication ne doit
 * pas demander de migrer des milliers de lignes, ni laisser d'anciens constats porter
 * d'anciennes formulations.
 */
export async function readPlan(userId: string, siteId: string): Promise<Plan | null> {
  const audit = await dernierAudit(userId, siteId)
  if (audit === null) return null

  const [constats, etats, redigees] = await Promise.all([
    withUserScope(userId, (tx) =>
      tx.auditFinding.findMany({
        where: { auditId: audit.id, audit: { userId } },
        orderBy: [{ lost: 'desc' }, { weight: 'desc' }],
      }),
    ),
    withUserScope(userId, (tx) => tx.actionItem.findMany({ where: { siteId, userId } })),
    withUserScope(userId, (tx) =>
      tx.auditCorrection.findMany({
        where: { siteId, userId },
        orderBy: { path: 'asc' },
        select: { checkId: true, path: true, url: true, field: true, before: true, after: true },
      }),
    ),
  ])

  const corrections = new Map<string, LignePlan['corrections']>()
  for (const ligne of redigees) {
    const { checkId, ...reste } = ligne
    corrections.set(checkId, [...(corrections.get(checkId) ?? []), reste])
  }

  const parCheck = new Map(etats.map((item) => [item.checkId, item]))
  const presents = new Set<string>()

  const lignes: LignePlan[] = []
  for (const constat of constats) {
    presents.add(constat.checkId)
    // Un contrôle réussi n'est pas une ligne de travail : il n'y a rien à faire.
    if (constat.affected === 0) continue
    const check = findCheck(constat.checkId)
    const item = parCheck.get(constat.checkId)
    lignes.push({
      checkId: constat.checkId,
      engine: constat.engine,
      label: check?.label ?? constat.checkId,
      why: check?.why ?? '',
      scope: check?.scope ?? 'page',
      severity: constat.severity as Severity,
      affected: constat.affected,
      examined: constat.examined,
      lost: constat.lost,
      sample: (constat.sample as unknown as LignePlan['sample']) ?? [],
      state: item !== undefined && estUnEtat(item.state) ? item.state : 'todo',
      note: item?.note ?? '',
      corrigeable: estCorrigeable(constat.checkId),
      rapide: check?.rapide === true,
      corrections: corrections.get(constat.checkId) ?? [],
    })
  }

  /*
   * Les constats qui ont disparu. Un contrôle réussi au dernier audit compte ici au même
   * titre qu'un contrôle qui ne s'applique plus : dans les deux cas, le problème n'est plus
   * là, et c'est ce qu'on veut montrer.
   */
  const reglees = etats
    .filter((item) => item.state === 'done' || item.state === 'ignored')
    .filter((item) => !lignes.some((ligne) => ligne.checkId === item.checkId))
    .map((item) => ({
      checkId: item.checkId,
      label: findCheck(item.checkId)?.label ?? item.checkId,
      engine: findCheck(item.checkId)?.engine ?? 'seo',
      state: estUnEtat(item.state) ? item.state : 'done',
    }))

  return { auditId: audit.id, finishedAt: audit.finishedAt, lignes, reglees }
}

/**
 * Change l'état d'une ligne du plan.
 *
 * Le site est vérifié avant tout : un identifiant venu du navigateur ne donne accès à rien
 * qu'on ne possède déjà. Le contrôle est vérifié aussi — écrire un identifiant inventé en
 * base ferait une ligne fantôme, visible nulle part et impossible à retirer.
 */
export async function setActionState(
  userId: string,
  siteId: string,
  checkId: string,
  state: EtatAction,
  note?: string,
): Promise<void> {
  if (findCheck(checkId) === undefined) throw validation("Ce contrôle n'existe pas.")

  const site = await withUserScope(userId, (tx) =>
    tx.site.findFirst({ where: { id: siteId, userId, deletedAt: null }, select: { id: true } }),
  )
  if (site === null) throw notFound('Ce site est introuvable.')

  const propre = (note ?? '').slice(0, 500)
  await withUserScope(userId, (tx) =>
    tx.actionItem.upsert({
      where: { siteId_checkId: { siteId, checkId } },
      update: { state, ...(note === undefined ? {} : { note: propre }) },
      create: { siteId, userId, checkId, state, note: propre },
    }),
  )
  logger.info('plan d’action mis à jour', { siteId, checkId, state })
}

// ── Historique ───────────────────────────────────────────────────────────────

export type LigneHistorique = {
  id: string
  finishedAt: Date | null
  pagesCrawled: number
  seoScore: number | null
  geoScore: number | null
  /** Écart avec l'analyse précédente. `null` pour la première, qui n'a rien à comparer. */
  seoDelta: number | null
  geoDelta: number | null
}

/** Au-delà, personne ne remonte : on garde tout en base, on n'affiche pas tout. */
const HISTORIQUE_MAX = 50

/**
 * Les analyses terminées d'un site, de la plus récente à la plus ancienne.
 *
 * L'écart est calculé ici et non à l'écran : il se lit par rapport à l'analyse précédente,
 * ce qui suppose de connaître l'ordre — une information que le composant n'a pas à
 * reconstruire, et qu'il reconstruirait à l'envers une fois sur deux.
 */
export async function listAudits(
  userId: string,
  siteId: string,
  combien = HISTORIQUE_MAX,
): Promise<LigneHistorique[]> {
  const audits = await withUserScope(userId, (tx) =>
    tx.audit.findMany({
      where: { siteId, userId, status: 'done' },
      orderBy: { finishedAt: 'desc' },
      take: Math.max(1, Math.min(HISTORIQUE_MAX, combien)),
      select: {
        id: true,
        finishedAt: true,
        pagesCrawled: true,
        seoScore: true,
        geoScore: true,
      },
    }),
  )

  const ecart = (note: number | null, avant: number | null | undefined): number | null =>
    note === null || avant === null || avant === undefined ? null : note - avant

  return audits.map((audit, index) => {
    // La liste descend le temps : le précédent d'une ligne est celui qui la suit.
    const precedent = audits[index + 1]
    return {
      ...audit,
      seoDelta: ecart(audit.seoScore, precedent?.seoScore),
      geoDelta: ecart(audit.geoScore, precedent?.geoScore),
    }
  })
}

export type Mouvement = {
  checkId: string
  label: string
  engine: string
  severity: Severity
  /** Pages concernées avant et après. Zéro d'un côté veut dire apparu ou disparu. */
  avant: number
  apres: number
  sens: 'resolu' | 'apparu' | 'ameliore' | 'aggrave'
}

export type Comparaison = {
  avant: { id: string; finishedAt: Date | null; seoScore: number | null; geoScore: number | null }
  apres: { id: string; finishedAt: Date | null; seoScore: number | null; geoScore: number | null }
  mouvements: Mouvement[]
  /**
   * Faux quand l'un des deux audits ne porte aucun constat, et il n'y a alors rien à
   * comparer.
   *
   * Le cas existe : les audits menés avant que les contrôles n'existent ont été explorés et
   * enregistrés, mais jamais notés. Les confronter à un audit récent ferait passer chaque
   * constat pour une apparition — un site parfaitement stable se lirait comme un site qui
   * vient de s'effondrer, et c'est le genre de chiffre qu'on croit.
   */
  mesurable: boolean
}

/**
 * Ce qui a bougé entre deux audits.
 *
 * Deux notes disent qu'on a gagné quatre points ; ceci dit lesquels et sur quoi. Un contrôle
 * qui n'a pas bougé n'apparaît pas : une comparaison qui liste trente lignes dont vingt-huit
 * identiques cache les deux qui comptent.
 */
export async function compareAudits(
  userId: string,
  avantId: string,
  apresId: string,
): Promise<Comparaison> {
  const audits = await withUserScope(userId, (tx) =>
    tx.audit.findMany({
      where: { id: { in: [avantId, apresId] }, userId },
      select: { id: true, finishedAt: true, seoScore: true, geoScore: true },
    }),
  )
  const avant = audits.find((audit) => audit.id === avantId)
  const apres = audits.find((audit) => audit.id === apresId)
  if (avant === undefined || apres === undefined) throw notFound('Cet audit est introuvable.')

  const constats = await withUserScope(userId, (tx) =>
    tx.auditFinding.findMany({
      where: { auditId: { in: [avantId, apresId] }, audit: { userId } },
      select: { auditId: true, checkId: true, engine: true, severity: true, affected: true },
    }),
  )

  const porte = (id: string) => constats.some((constat) => constat.auditId === id)
  const mesurable = avantId === apresId || (porte(avantId) && porte(apresId))
  if (!mesurable) return { avant, apres, mouvements: [], mesurable: false }

  const touches = new Map<string, { avant: number; apres: number }>()
  for (const constat of constats) {
    const ligne = touches.get(constat.checkId) ?? { avant: 0, apres: 0 }
    /*
     * Deux affectations indépendantes, jamais un `sinon` : quand les deux identifiants sont
     * le même, un `sinon` ne remplirait qu'un côté et ferait passer tout l'audit pour réglé.
     */
    if (constat.auditId === avantId) ligne.avant = constat.affected
    if (constat.auditId === apresId) ligne.apres = constat.affected
    touches.set(constat.checkId, ligne)
  }

  const mouvements: Mouvement[] = []
  for (const [checkId, { avant: debut, apres: fin }] of touches) {
    if (debut === fin) continue
    const check = findCheck(checkId)
    const modele = constats.find((constat) => constat.checkId === checkId)
    mouvements.push({
      checkId,
      label: check?.label ?? checkId,
      engine: modele?.engine ?? 'seo',
      severity: (modele?.severity ?? 'improvement') as Severity,
      avant: debut,
      apres: fin,
      sens: fin === 0 ? 'resolu' : debut === 0 ? 'apparu' : fin < debut ? 'ameliore' : 'aggrave',
    })
  }

  /*
   * Ce qui s'est réglé d'abord, ce qui s'est dégradé ensuite, et à l'intérieur de chaque
   * groupe le plus étendu en tête. On ouvre sur les bonnes nouvelles : le reste sera lu de
   * toute façon, l'inverse n'est pas vrai.
   */
  const rang: Record<Mouvement['sens'], number> = { resolu: 0, ameliore: 1, aggrave: 2, apparu: 3 }
  mouvements.sort(
    (a, b) => rang[a.sens] - rang[b.sens] || Math.abs(b.apres - b.avant) - Math.abs(a.apres - a.avant),
  )

  return { avant, apres, mouvements, mesurable: true }
}
