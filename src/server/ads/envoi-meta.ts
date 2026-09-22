import type { Prisma } from '@prisma/client'
import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { isEnabled } from '@/server/settings/flags'
import { accesCompteActif } from './comptes'
import { droitsMeta } from './droits-meta'
import { autoriseMeta } from './garde-fous-meta'
import { metaAds } from './meta-ads'
import { ecrireBudgetMeta, ecrireStatutMeta, relireObjetMeta } from './meta-ads-ecriture'
import { contexteActionsMeta, proposerActionMeta } from './actions-meta'
import { PROFIL_VIDE } from './profil'
import { lireRecommandationsMeta } from './recommandations-meta'

/**
 * Le moment où MIRA cesse de proposer et modifie vraiment.
 *
 * Tout ce fichier tient dans un ordre, et l'ordre est la sécurité.
 *
 * **1. On revérifie tout, au moment d'écrire.** Les bornes ont déjà parlé à l'affichage,
 * mais l'affichage date : entre la page et le clic, un budget a pu bouger, un ensemble a pu
 * être mis en pause à la main, une cinquième modification a pu partir. Tout repasse.
 *
 * **2. On relit l'objet chez Meta.** La base porte ce que la dernière lecture a vu.
 * Quelqu'un a pu changer un budget dans le gestionnaire depuis. Journaliser « avant :
 * 20 CHF » alors que Meta est à 40 ferait d'un bouton « restaurer » un bouton qui casse — et
 * si la valeur a changé, on refuse plutôt que d'écraser un geste qu'on n'a pas vu.
 *
 * **3. On écrit le journal AVANT d'envoyer.** C'est ce qui distingue un journal d'un
 * historique : une modification partie pendant une coupure réseau laisse une ligne
 * « prévu », qui est l'état exact de ce qu'on sait. Écrire après l'envoi perdrait
 * précisément les cas où l'on a besoin de savoir.
 *
 * **4. On envoie, puis on note ce que Meta a répondu.** En clair, sans secret.
 *
 * **Rien n'est automatique.** Aucune fonction de ce fichier ne s'appelle depuis la tournée
 * nocturne. Elles ne s'atteignent que par une route, qui ne s'atteint que par un clic.
 */

/** Ce qu'une écriture rend, dans les deux sens. */
export type Envoi = { ok: true; resume: string } | { ok: false; raison: string }

/** Ce que le journal garde d'une modification, prêt à afficher. */
export type ActionVue = {
  id: string
  quoi: string
  /** La règle qui l'a motivée. Sans elle, le journal est une suite de gestes sans raison. */
  motif: string
  resume: string
  /** prevu | reussi | refuse */
  resultat: string
  detail: string
  createdAt: Date
  /** Vrai quand cette modification a déjà été défaite. */
  annulee: boolean
  /** Vrai quand elle peut l'être : réussie, pas déjà défaite, et pas elle-même un retour. */
  restaurable: boolean
}

/**
 * Le tour de garde commun aux deux gestes d'écriture.
 *
 * Rend tout ce dont l'envoi a besoin, ou la raison pour laquelle il n'aura pas lieu. Le
 * drapeau d'exploitation passe en premier : quand l'écriture Meta est fermée pour tout le
 * monde, le reste des vérifications ne regarde personne.
 */
async function ouvrir(userId: string) {
  if (!(await isEnabled('publiciteEcritureMeta'))) {
    return {
      ok: false as const,
      raison:
        'L’envoi de modifications vers Meta n’est pas ouvert sur cette installation d’Evoliia. MIRA continue de lire et de proposer.',
    }
  }

  const acces = await accesCompteActif(userId, metaAds)
  if (!acces.ok) return { ok: false as const, raison: acces.raison }

  const debutDuJour = new Date()
  debutDuJour.setHours(0, 0, 0, 0)
  const [droits, faitesAujourdhui] = await Promise.all([
    droitsMeta(userId),
    withUserScope(userId, (tx) =>
      tx.adsAction.count({
        where: { accountId: acces.compte.id, createdAt: { gte: debutDuJour } },
      }),
    ),
  ])

  return { ok: true as const, acces: acces.acces, compte: acces.compte, droits, faitesAujourdhui }
}

/**
 * Applique un constat, après confirmation.
 *
 * `recommandationId` vient du navigateur et n'ouvre rien : la recommandation n'est cherchée
 * que parmi celles de cette personne, sur le compte qu'elle suit. Ce qui arrive du
 * navigateur désigne, il n'autorise pas.
 */
export async function appliquerActionMeta(userId: string, recommandationId: string): Promise<Envoi> {
  const porte = await ouvrir(userId)
  if (!porte.ok) return porte

  const { acces, compte, droits, faitesAujourdhui } = porte

  const constats = await lireRecommandationsMeta(userId, compte.id)
  const constat = constats.find((un) => un.id === recommandationId)
  if (constat === undefined) throw notFound('Ce constat est introuvable.')

  const contexte = await contexteActionsMeta(userId, compte.id)

  /*
   * Le profil n'est pas relu ici, et c'est délibéré : la seule borne qui s'en sert — le
   * plafond déduit du budget mensuel — ne s'applique qu'aux hausses, et MIRA n'en propose
   * aucune. Un profil vide donne donc le même verdict, sans une lecture de plus sur le
   * chemin d'un clic. Le jour où une règle proposera une hausse, cette ligne devra changer,
   * et le commentaire est là pour qu'on s'en souvienne.
   */
  const cadre = { mode: compte.mode, devise: compte.devise, profil: PROFIL_VIDE, droits, faitesAujourdhui }

  const proposition = proposerActionMeta(constat, contexte, cadre)
  if (proposition.etat === 'aucune') {
    return { ok: false, raison: 'Ce constat ne propose aucune modification applicable.' }
  }
  if (proposition.etat === 'refusee') return { ok: false, raison: proposition.raison }

  const action = proposition.action

  /*
   * La relecture chez Meta, juste avant d'écrire. C'est elle qui donne la valeur d'avant du
   * journal, et c'est elle qui refuse d'écraser un geste fait à la main entre-temps.
   */
  const relu = await relireObjetMeta(acces, action.objetId)
  if (!relu.ok) return { ok: false, raison: relu.raison }

  if (action.type === 'pause' && relu.statut !== 'ACTIVE') {
    return {
      ok: false,
      raison: `Cet élément ne diffuse plus (${relu.statut}) : quelqu’un l’a déjà arrêté. Rien n’a été envoyé.`,
    }
  }
  if (action.type === 'budget' && relu.budgetMicros !== action.attenduMicros) {
    return {
      ok: false,
      raison:
        'Le budget de cet ensemble a changé depuis l’affichage de cette page. Rechargez-la pour voir la proposition recalculée — Evoliia n’écrase pas une modification qu’elle n’a pas vue.',
    }
  }

  const avant: Prisma.InputJsonValue =
    action.type === 'pause' ? { statut: relu.statut } : { budgetMicros: relu.budgetMicros }
  const apres: Prisma.InputJsonValue =
    action.type === 'pause'
      ? { statut: 'PAUSED', objetId: action.objetId, niveau: action.niveau }
      : { budgetMicros: action.versMicros, objetId: action.objetId }

  /*
   * Le journal d'abord, et « prévu » comme premier état. Si la suite se coupe, la ligne
   * restera « prévu » : c'est exactement ce qu'on saura, et la prochaine lecture tranchera.
   */
  const journal = await withUserScope(userId, (tx) =>
    tx.adsAction.create({
      data: {
        userId,
        accountId: compte.id,
        campagneId: action.campagneId === '' ? null : action.campagneId,
        quoi: action.type,
        motif: constat.regle,
        avant,
        apres,
        mode: compte.mode,
        resultat: 'prevu',
        recommandationId: constat.id,
      },
      select: { id: true },
    }),
  )

  const issue =
    action.type === 'pause'
      ? await ecrireStatutMeta(acces, action.objetId, 'PAUSED')
      : await ecrireBudgetMeta(acces, action.objetId, action.versMicros)

  await withUserScope(userId, (tx) =>
    tx.adsAction.updateMany({
      where: { id: journal.id, userId },
      data: {
        resultat: issue.ok ? 'reussi' : 'refuse',
        detail: issue.ok ? '' : issue.technique,
      },
    }),
  )

  if (!issue.ok) return { ok: false, raison: issue.raison }

  /*
   * Ce qu'on vient d'écrire est reporté en base sans attendre la prochaine lecture : on sait
   * exactement ce qu'on a posé, et laisser l'écran afficher l'ancienne valeur ferait douter
   * que la modification soit partie.
   */
  await withUserScope(userId, async (tx) => {
    if (action.type === 'budget') {
      await tx.adsGroupe.updateMany({
        where: { id: action.cibleId, userId },
        data: { budgetMicros: BigInt(action.versMicros) },
      })
    } else if (action.niveau === 'ensemble') {
      await tx.adsGroupe.updateMany({ where: { id: action.cibleId, userId }, data: { statut: 'PAUSED' } })
    } else {
      await tx.adsAnnonce.updateMany({ where: { id: action.cibleId, userId }, data: { statut: 'PAUSED' } })
    }
    /* Le constat est clos par son application : il a servi. */
    await tx.adsRecommandation.updateMany({
      where: { id: constat.id, userId },
      data: { etat: 'appliquee', closedAt: new Date() },
    })
  })

  logger.info('modification Meta envoyée', { quoi: action.type, motif: constat.regle })
  return { ok: true, resume: action.resume }
}

/**
 * Défait une modification, en remettant la valeur d'avant.
 *
 * Le plafond de gestes quotidiens ne s'y applique pas, et c'est voulu : défaire une erreur
 * ne doit jamais être empêché par le compteur qui a servi à la commettre. Le mode du compte
 * et le droit accordé par Meta, eux, restent exigés — on ne réécrit pas chez quelqu'un qui a
 * repassé son compte en lecture.
 */
export async function restaurerActionMeta(userId: string, actionId: string): Promise<Envoi> {
  const porte = await ouvrir(userId)
  if (!porte.ok) return porte

  const { acces, compte, droits } = porte

  const verdict = autoriseMeta({
    mode: compte.mode,
    devise: compte.devise,
    profil: PROFIL_VIDE,
    droits,
    faitesAujourdhui: 0,
  })
  if (!verdict.ok) return { ok: false, raison: verdict.raison }

  const ligne = await withUserScope(userId, (tx) =>
    tx.adsAction.findFirst({
      where: { id: actionId, userId, accountId: compte.id, resultat: 'reussi' },
      select: { id: true, quoi: true, avant: true, apres: true, campagneId: true },
    }),
  )
  if (ligne === null) throw notFound('Cette modification est introuvable.')

  const dejaDefaite = await withUserScope(userId, (tx) =>
    tx.adsAction.count({ where: { userId, annuleId: ligne.id } }),
  )
  if (dejaDefaite > 0) throw validation('Cette modification a déjà été défaite.')

  const avant = (ligne.avant ?? {}) as Record<string, unknown>
  const apres = (ligne.apres ?? {}) as Record<string, unknown>
  const objetId = typeof apres.objetId === 'string' ? apres.objetId : ''
  if (objetId === '') throw validation('Cette modification ne peut pas être défaite.')

  const issue =
    ligne.quoi === 'pause'
      ? await ecrireStatutMeta(acces, objetId, 'ACTIVE')
      : await ecrireBudgetMeta(
          acces,
          objetId,
          typeof avant.budgetMicros === 'number' ? avant.budgetMicros : 0,
        )

  await withUserScope(userId, (tx) =>
    tx.adsAction.create({
      data: {
        userId,
        accountId: compte.id,
        campagneId: ligne.campagneId,
        quoi: ligne.quoi,
        motif: 'retour arrière',
        avant: apres as Prisma.InputJsonValue,
        apres: avant as Prisma.InputJsonValue,
        mode: 'restauration',
        resultat: issue.ok ? 'reussi' : 'refuse',
        detail: issue.ok ? '' : issue.technique,
        annuleId: ligne.id,
      },
    }),
  )

  if (!issue.ok) return { ok: false, raison: issue.raison }

  logger.info('modification Meta défaite', { quoi: ligne.quoi })
  return {
    ok: true,
    resume:
      ligne.quoi === 'pause'
        ? 'La diffusion a été relancée chez Meta.'
        : 'Le budget d’avant a été remis chez Meta.',
  }
}

/** Au-delà, le journal cesse d'être un journal et devient une archive. */
const JOURNAL_MAX = 20

/** Ce que MIRA a modifié sur ce compte, du plus récent au plus ancien. */
export async function journalMeta(userId: string, accountId: string): Promise<ActionVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsAction.findMany({
      where: { userId, accountId },
      orderBy: { createdAt: 'desc' },
      take: JOURNAL_MAX,
      select: {
        id: true,
        quoi: true,
        motif: true,
        avant: true,
        apres: true,
        mode: true,
        resultat: true,
        detail: true,
        createdAt: true,
        annuleId: true,
      },
    }),
  )

  const defaites = new Set(
    lignes.map((une) => une.annuleId).filter((un): un is string => un !== null),
  )

  return lignes.map((ligne) => {
    const avant = (ligne.avant ?? {}) as Record<string, unknown>
    const apres = (ligne.apres ?? {}) as Record<string, unknown>
    const resume =
      ligne.quoi === 'pause'
        ? `${apres.statut === 'ACTIVE' ? 'Diffusion relancée' : 'Mise en pause'} (${apres.niveau ?? 'élément'})`
        : `Budget quotidien : ${montant(avant.budgetMicros)} → ${montant(apres.budgetMicros)}`

    return {
      id: ligne.id,
      quoi: ligne.quoi,
      motif: ligne.motif,
      resume,
      resultat: ligne.resultat,
      detail: ligne.detail,
      createdAt: ligne.createdAt,
      annulee: defaites.has(ligne.id),
      restaurable:
        ligne.resultat === 'reussi' && ligne.mode !== 'restauration' && !defaites.has(ligne.id),
    }
  })
}

function montant(micros: unknown): string {
  const nombre = typeof micros === 'number' ? micros : 0
  return (nombre / 1_000_000).toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
