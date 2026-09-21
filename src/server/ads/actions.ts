import type { Prisma } from '@prisma/client'
import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { isEnabled } from '@/server/settings/flags'
import { accesCompteActif, compteActif, type CompteRelie } from './comptes'
import { ecrireBudget, ecrireStatut } from './google-ads-ecriture'
import { autoriseBudget, autoriseStatut, type Demande } from './garde-fous'
import { lireProfil } from './profil'

/**
 * Le seul chemin par lequel une modification part chez Google.
 *
 * Tout ce module existe pour une phrase : **la valeur d'avant est écrite avant l'envoi.**
 * C'est ce qui fait la différence entre un bouton « restaurer 15,00 CHF » qui restaure
 * vraiment et un bouton qui ment. Si l'on écrivait le journal après coup, il suffirait d'une
 * coupure réseau au mauvais moment pour que la modification parte sans que rien ne permette
 * de revenir en arrière — et personne ne s'en apercevrait avant le relevé du mois.
 *
 * Cinq verrous se succèdent, et l'ordre compte.
 *
 * 1. **L'interrupteur d'exploitation.** Éteint, aucune écriture ne part, pour personne.
 * 2. **Le mode du compte.** « lecture » par défaut : relier un compte n'est pas consentir à
 *    ce qu'on le modifie, même si Google, lui, a donné les deux droits d'un coup.
 * 3. **La valeur attendue.** Le navigateur dit ce qu'il croit être la valeur actuelle. Si
 *    elle ne correspond plus, on refuse : appliquer une recommandation calculée sur un
 *    budget de 15 alors qu'il est passé à 40 entre-temps ferait un geste que personne n'a
 *    demandé.
 * 4. **Les garde-fous.** Ils vivent dans leur propre fichier, sans base ni réseau.
 * 5. **Le journal.** Écrit en « prévu », puis clos en « réussi » ou « refusé ».
 *
 * Un sixième verrou n'est pas ici mais dans la forme même du module : il n'existe aucune
 * fonction qui applique une recommandation sans qu'une personne ait cliqué. Il n'y a pas
 * d'autopilote, parce qu'il n'y a rien pour l'appeler.
 */

const MICROS = 1_000_000

/** Les modes qu'un compte peut prendre. « autopilote » n'en est pas un : rien ne l'exécute. */
export const MODES = ['lecture', 'assiste'] as const

export type Mode = (typeof MODES)[number]

export function modeValide(valeur: unknown): Mode {
  return typeof valeur === 'string' && (MODES as readonly string[]).includes(valeur)
    ? (valeur as Mode)
    : 'lecture'
}

export type ActionVue = {
  id: string
  quoi: string
  motif: string
  mode: string
  resultat: string
  detail: string
  campagne: string | null
  avant: Record<string, unknown>
  apres: Record<string, unknown>
  createdAt: Date
  /** Vrai quand cette action a déjà été annulée par une autre. */
  annulee: boolean
  /** Vrai quand elle est elle-même une restauration. */
  restauration: boolean
}

/** Au-delà, l'écran devient un registre comptable : personne ne remonte cinquante gestes. */
const JOURNAL_MAX = 25

/** Le journal du compte, du plus récent au plus ancien. */
export async function lireJournal(userId: string, accountId: string): Promise<ActionVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsAction.findMany({
      where: { userId, accountId },
      orderBy: { createdAt: 'desc' },
      take: JOURNAL_MAX,
      select: {
        id: true,
        quoi: true,
        motif: true,
        mode: true,
        resultat: true,
        detail: true,
        avant: true,
        apres: true,
        annuleId: true,
        createdAt: true,
        campagne: { select: { nom: true } },
        annulees: { select: { id: true }, take: 1 },
      },
    }),
  )

  return lignes.map((ligne) => ({
    id: ligne.id,
    quoi: ligne.quoi,
    motif: ligne.motif,
    mode: ligne.mode,
    resultat: ligne.resultat,
    detail: ligne.detail,
    campagne: ligne.campagne?.nom ?? null,
    avant: (ligne.avant ?? {}) as Record<string, unknown>,
    apres: (ligne.apres ?? {}) as Record<string, unknown>,
    createdAt: ligne.createdAt,
    annulee: ligne.annulees.length > 0,
    restauration: ligne.annuleId !== null,
  }))
}

/** Change ce que Naya a le droit de faire sur le compte suivi. */
export async function changerMode(userId: string, mode: Mode): Promise<CompteRelie> {
  const compte = await compteActif(userId)
  if (compte === null) throw notFound('Aucun compte publicitaire n’est suivi.')

  if (mode === 'assiste' && !(await isEnabled('publiciteEcriture'))) {
    /*
     * Refusé plutôt que accepté sans effet : un réglage qui s'enregistre et ne change rien
     * est pire qu'un refus, parce qu'on croit ensuite que le produit peut écrire.
     */
    throw validation(
      'Le mode assisté n’est pas ouvert sur cette installation d’Evoliia. Rien ne peut être envoyé à Google pour l’instant.',
    )
  }

  await withUserScope(userId, (tx) =>
    tx.adsAccount.updateMany({ where: { id: compte.id, userId }, data: { mode } }),
  )
  return { ...compte, mode }
}

/** Le mode du compte suivi, tel qu'il est enregistré. */
export async function lireMode(userId: string, accountId: string): Promise<Mode> {
  const ligne = await withUserScope(userId, (tx) =>
    tx.adsAccount.findFirst({ where: { id: accountId, userId }, select: { mode: true } }),
  )
  return modeValide(ligne?.mode)
}

/** Les écritures déjà tentées aujourd'hui, refus compris : c'est la vitesse qu'on borne. */
async function faitesAujourdhui(userId: string, accountId: string): Promise<number> {
  const debut = new Date()
  debut.setHours(0, 0, 0, 0)
  return withUserScope(userId, (tx) =>
    tx.adsAction.count({
      where: { userId, accountId, createdAt: { gte: debut }, mode: { not: 'restauration' } },
    }),
  )
}

type Cible = {
  id: string
  campagneId: string
  nom: string
  statut: string
  budgetMicros: bigint
  budgetId: string
}

/** La campagne visée, cherchée seulement parmi celles du compte suivi de cette personne. */
async function cibleDe(userId: string, accountId: string, id: string): Promise<Cible> {
  const campagne = await withUserScope(userId, (tx) =>
    tx.adsCampagne.findFirst({
      where: { id, userId, accountId },
      select: {
        id: true,
        campagneId: true,
        nom: true,
        statut: true,
        budgetMicros: true,
        budgetId: true,
      },
    }),
  )
  if (campagne === null) throw notFound('Cette campagne est introuvable.')
  return campagne
}

export type Issue =
  | { ok: true; action: ActionVue }
  | { ok: false; raison: string; action?: ActionVue }

/** Le contexte commun de toute écriture, monté une fois. */
async function ouvrir(userId: string): Promise<
  | { ok: true; compte: CompteRelie; demande: Demande }
  | { ok: false; raison: string }
> {
  if (!(await isEnabled('publiciteEcriture'))) {
    return {
      ok: false,
      raison:
        'Le mode assisté n’est pas ouvert sur cette installation d’Evoliia. Aucune modification ne peut être envoyée à Google.',
    }
  }

  const compte = await compteActif(userId)
  if (compte === null) return { ok: false, raison: 'Aucun compte publicitaire n’est suivi.' }

  const [profil, faites, mode] = await Promise.all([
    lireProfil(userId, compte.id),
    faitesAujourdhui(userId, compte.id),
    lireMode(userId, compte.id),
  ])

  return {
    ok: true,
    compte,
    demande: { mode, devise: compte.devise, profil, faitesAujourdhui: faites },
  }
}

/**
 * Écrit le journal, envoie, puis clôt la ligne.
 *
 * L'ordre est la seule chose qui compte ici. Une coupure entre l'écriture et l'envoi laisse
 * une ligne « prévu », qui est l'état exact de ce qu'on sait : la modification a pu partir.
 * La prochaine lecture des campagnes dira ce qu'il en est, et la ligne restera comme trace.
 */
async function journaliser(
  userId: string,
  compte: CompteRelie,
  ligne: {
    quoi: string
    motif: string
    campagneId: string
    avant: Record<string, unknown>
    apres: Record<string, unknown>
    mode: string
    annuleId?: string
    recommandationId?: string
  },
  envoi: () => Promise<{ ok: true } | { ok: false; raison: string; technique: string }>,
  apresSucces: () => Promise<void>,
): Promise<Issue> {
  const action = await withUserScope(userId, (tx) =>
    tx.adsAction.create({
      data: {
        userId,
        accountId: compte.id,
        campagneId: ligne.campagneId,
        quoi: ligne.quoi,
        motif: ligne.motif,
        avant: ligne.avant as Prisma.InputJsonValue,
        apres: ligne.apres as Prisma.InputJsonValue,
        mode: ligne.mode,
        resultat: 'prevu',
        ...(ligne.annuleId === undefined ? {} : { annuleId: ligne.annuleId }),
        ...(ligne.recommandationId === undefined
          ? {}
          : { recommandationId: ligne.recommandationId }),
      },
      select: { id: true },
    }),
  )

  const issue = await envoi()

  await withUserScope(userId, (tx) =>
    tx.adsAction.updateMany({
      where: { id: action.id, userId },
      data: issue.ok
        ? { resultat: 'reussi', detail: '' }
        : { resultat: 'refuse', detail: issue.technique.slice(0, 500) },
    }),
  )

  if (!issue.ok) {
    logger.info('écriture publicitaire refusée', { quoi: ligne.quoi })
    const journal = await lireJournal(userId, compte.id)
    return { ok: false, raison: issue.raison, action: journal.find((une) => une.id === action.id) }
  }

  await apresSucces()
  logger.info('écriture publicitaire réussie', { quoi: ligne.quoi })
  const journal = await lireJournal(userId, compte.id)
  const vue = journal.find((une) => une.id === action.id)
  if (vue === undefined) return { ok: false, raison: 'Modification envoyée, journal introuvable.' }
  return { ok: true, action: vue }
}

/** Marque le constat d'origine comme appliqué, quand l'action en venait d'un. */
async function cloreRecommandation(userId: string, id: string | undefined): Promise<void> {
  if (id === undefined) return
  await withUserScope(userId, (tx) =>
    tx.adsRecommandation.updateMany({
      where: { id, userId, etat: 'ouverte' },
      data: { etat: 'appliquee', closedAt: new Date() },
    }),
  )
}

/**
 * Le refus d'une action calculée sur une valeur qui n'est plus la bonne.
 *
 * Appliquer une recommandation faite sur un budget de 15 alors qu'il est passé à 40 entre
 * l'affichage et le clic ferait un geste que personne n'a demandé. Le navigateur envoie donc
 * ce qu'il croit être la valeur actuelle, et le serveur refuse si elle a bougé.
 */
function perime(quoi: string): { ok: false; raison: string } {
  return {
    ok: false,
    raison: `Le ${quoi} de cette campagne a changé depuis l’affichage de cette page. Rechargez-la pour voir les chiffres à jour avant d’agir.`,
  }
}

/** Change le budget quotidien d'une campagne. */
export async function appliquerBudget(
  userId: string,
  demande: {
    campagneId: string
    versMicros: number
    attenduMicros: number
    recommandationId?: string
  },
): Promise<Issue> {
  const ouverture = await ouvrir(userId)
  if (!ouverture.ok) return ouverture
  const { compte } = ouverture

  const cible = await cibleDe(userId, compte.id, demande.campagneId)
  if (Number(cible.budgetMicros) !== Math.round(demande.attenduMicros)) return perime('budget')
  if (cible.budgetId === '') {
    return {
      ok: false,
      raison: 'Evoliia ne connaît pas le budget de cette campagne chez Google. Relisez vos campagnes, puis réessayez.',
    }
  }

  /*
   * Combien de campagnes partagent ce budget. Chez Google, un budget est un objet à part :
   * le modifier ici changerait la dépense de toutes celles qui s'en servent, y compris
   * celles qu'on ne regardait pas.
   */
  const partage = await withUserScope(userId, (tx) =>
    tx.adsCampagne.count({
      where: {
        userId,
        accountId: compte.id,
        budgetId: cible.budgetId,
        statut: { not: 'REMOVED' },
      },
    }),
  )

  const verdict = autoriseBudget(
    ouverture.demande,
    Number(cible.budgetMicros),
    demande.versMicros,
    partage,
  )
  if (!verdict.ok) return verdict

  const acces = await accesCompteActif(userId)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  const vers = Math.round(demande.versMicros)
  return journaliser(
    userId,
    compte,
    {
      quoi: 'budget',
      motif: `Budget quotidien : ${(Number(cible.budgetMicros) / MICROS).toFixed(2)} → ${(vers / MICROS).toFixed(2)} ${compte.devise}`,
      campagneId: cible.id,
      avant: { budgetMicros: Number(cible.budgetMicros) },
      apres: { budgetMicros: vers },
      mode: 'assiste',
      ...(demande.recommandationId === undefined
        ? {}
        : { recommandationId: demande.recommandationId }),
    },
    () => ecrireBudget(acces.acces, cible.budgetId, vers),
    async () => {
      /*
       * La copie locale suit immédiatement : la page se recharge sur ce que Google a
       * accepté, et non sur l'ancienne valeur. La lecture de cette nuit fera foi.
       */
      await withUserScope(userId, (tx) =>
        tx.adsCampagne.updateMany({
          where: { id: cible.id, userId },
          data: { budgetMicros: BigInt(vers) },
        }),
      )
      await cloreRecommandation(userId, demande.recommandationId)
    },
  )
}

/** Met une campagne en pause, ou la remet en route. */
export async function appliquerStatut(
  userId: string,
  demande: {
    campagneId: string
    vers: 'ENABLED' | 'PAUSED'
    attendu: string
    recommandationId?: string
  },
): Promise<Issue> {
  const ouverture = await ouvrir(userId)
  if (!ouverture.ok) return ouverture
  const { compte } = ouverture

  const cible = await cibleDe(userId, compte.id, demande.campagneId)
  if (cible.statut !== demande.attendu) return perime('statut')
  if (cible.statut === demande.vers) {
    return { ok: false, raison: 'Cette campagne est déjà dans cet état.' }
  }

  const verdict = autoriseStatut(ouverture.demande, demande.vers)
  if (!verdict.ok) return verdict

  const acces = await accesCompteActif(userId)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  return journaliser(
    userId,
    compte,
    {
      quoi: demande.vers === 'PAUSED' ? 'pause' : 'reprise',
      motif:
        demande.vers === 'PAUSED'
          ? 'Campagne mise en pause'
          : 'Campagne remise en diffusion',
      campagneId: cible.id,
      avant: { statut: cible.statut },
      apres: { statut: demande.vers },
      mode: 'assiste',
      ...(demande.recommandationId === undefined
        ? {}
        : { recommandationId: demande.recommandationId }),
    },
    () => ecrireStatut(acces.acces, cible.campagneId, demande.vers),
    async () => {
      await withUserScope(userId, (tx) =>
        tx.adsCampagne.updateMany({
          where: { id: cible.id, userId },
          data: { statut: demande.vers },
        }),
      )
      await cloreRecommandation(userId, demande.recommandationId)
    },
  )
}

/**
 * Remet une action dans l'état d'avant.
 *
 * Elle réutilise les mêmes chemins d'écriture, avec les mêmes garde-fous, et laisse sa
 * propre trace : une restauration est une modification comme une autre. Elle ne « défait »
 * rien — elle envoie la valeur d'avant, qui avait été conservée avant l'envoi initial.
 */
export async function restaurer(userId: string, actionId: string): Promise<Issue> {
  const ouverture = await ouvrir(userId)
  if (!ouverture.ok) return ouverture
  const { compte } = ouverture

  const origine = await withUserScope(userId, (tx) =>
    tx.adsAction.findFirst({
      where: { id: actionId, userId, accountId: compte.id, resultat: 'reussi' },
      select: {
        id: true,
        quoi: true,
        campagneId: true,
        avant: true,
        annulees: { select: { id: true }, take: 1 },
      },
    }),
  )
  if (origine === null || origine.campagneId === null) {
    throw notFound('Cette modification est introuvable, ou n’a jamais abouti.')
  }
  if (origine.annulees.length > 0) {
    return { ok: false, raison: 'Cette modification a déjà été annulée.' }
  }

  const avant = (origine.avant ?? {}) as { budgetMicros?: number; statut?: string }
  const cible = await cibleDe(userId, compte.id, origine.campagneId)
  const acces = await accesCompteActif(userId)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  if (origine.quoi === 'budget' && typeof avant.budgetMicros === 'number') {
    const vers = Math.round(avant.budgetMicros)
    return journaliser(
      userId,
      compte,
      {
        quoi: 'budget',
        motif: `Retour à ${(vers / MICROS).toFixed(2)} ${compte.devise} par jour`,
        campagneId: cible.id,
        avant: { budgetMicros: Number(cible.budgetMicros) },
        apres: { budgetMicros: vers },
        mode: 'restauration',
        annuleId: origine.id,
      },
      () => ecrireBudget(acces.acces, cible.budgetId, vers),
      async () => {
        await withUserScope(userId, (tx) =>
          tx.adsCampagne.updateMany({
            where: { id: cible.id, userId },
            data: { budgetMicros: BigInt(vers) },
          }),
        )
      },
    )
  }

  if (avant.statut === 'ENABLED' || avant.statut === 'PAUSED') {
    const vers = avant.statut
    return journaliser(
      userId,
      compte,
      {
        quoi: vers === 'PAUSED' ? 'pause' : 'reprise',
        motif: vers === 'PAUSED' ? 'Retour à la pause' : 'Retour en diffusion',
        campagneId: cible.id,
        avant: { statut: cible.statut },
        apres: { statut: vers },
        mode: 'restauration',
        annuleId: origine.id,
      },
      () => ecrireStatut(acces.acces, cible.campagneId, vers),
      async () => {
        await withUserScope(userId, (tx) =>
          tx.adsCampagne.updateMany({ where: { id: cible.id, userId }, data: { statut: vers } }),
        )
      },
    )
  }

  return { ok: false, raison: 'Cette modification ne sait pas se défaire.' }
}
