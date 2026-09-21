import type { Prisma } from '@prisma/client'
import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { isEnabled } from '@/server/settings/flags'
import { accesCompteActif, compteActif, type CompteRelie } from './comptes'
import type { AccesAds, TexteAnnonceAds } from './provider'
import { googleAds } from './google-ads'
import { ecrireBudget, ecrireStatut, ecrireTextesAnnonce } from './google-ads-ecriture'
import { autoriseBudget, autoriseStatut, autoriseTexte, type Demande } from './garde-fous'
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

/** Le début de la journée en cours, pour les compteurs quotidiens. */
function aujourdhui(): Date {
  const debut = new Date()
  debut.setHours(0, 0, 0, 0)
  return debut
}

/** Les gestes d'argent déjà tentés aujourd'hui, refus compris : c'est la vitesse qu'on borne. */
async function faitesAujourdhui(userId: string, accountId: string): Promise<number> {
  return withUserScope(userId, (tx) =>
    tx.adsAction.count({
      where: {
        userId,
        accountId,
        createdAt: { gte: aujourdhui() },
        mode: { not: 'restauration' },
        /*
         * Les dépôts de texte n'y comptent pas. La limite de cinq borne une vitesse de
         * pilotage — au-delà, on ne pilote plus une campagne, on la secoue — et ajouter un
         * titre ne pilote rien : ça ne change aucune dépense. Les mêler ferait refuser le
         * sixième titre d'un samedi matin au motif qu'on a touché un budget la veille.
         */
        quoi: { in: ['budget', 'pause', 'reprise'] },
      },
    }),
  )
}

/** Les textes déposés aujourd'hui. Compteur distinct, pour une limite distincte. */
async function textesAujourdhui(userId: string, accountId: string): Promise<number> {
  return withUserScope(userId, (tx) =>
    tx.adsAction.count({
      where: {
        userId,
        accountId,
        createdAt: { gte: aujourdhui() },
        mode: { not: 'restauration' },
        quoi: { in: ['titre', 'description'] },
      },
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
    /** `null` pour ce qui porte sur un contenant plutôt que sur une campagne. */
    campagneId: string | null
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
 * Dépose un texte proposé dans une annonce.
 *
 * C'est l'écriture la plus délicate du produit, et pour une raison qui ne se devine pas :
 * Google ne sait pas « ajouter un titre ». Il remplace la liste entière. Déposer le dixième
 * exige donc de renvoyer les neuf autres — et si l'on renvoyait ceux que notre base a lus la
 * semaine dernière, on effacerait ce que la personne a écrit entre-temps dans Google Ads.
 *
 * L'annonce est donc relue chez Google à l'instant du dépôt, et c'est cette liste-là, plus
 * le texte, qui repart. La valeur d'avant conservée au journal est également celle-là : le
 * retour arrière remet exactement ce qui était en place, épinglages compris.
 *
 * Un contenant qui porte plusieurs annonces est refusé. Choisir à la place de la personne
 * dans laquelle déposer serait deviner ; les modifier toutes serait changer plus qu'elle
 * n'a demandé.
 */
export async function deposerTexte(userId: string, propositionId: string): Promise<Issue> {
  const ouverture = await ouvrir(userId)
  if (!ouverture.ok) return ouverture
  const { compte } = ouverture

  const proposition = await withUserScope(userId, (tx) =>
    tx.adsProposition.findFirst({
      where: { id: propositionId, userId, accountId: compte.id, etat: 'proposee' },
      select: {
        id: true,
        champ: true,
        texte: true,
        groupe: { select: { id: true, nom: true, genre: true, groupeId: true } },
      },
    }),
  )
  if (proposition === null) throw notFound('Cette proposition est introuvable.')

  if (proposition.groupe.genre !== 'annonces') {
    return {
      ok: false,
      raison:
        'Le dépôt dans un groupe d’éléments Performance Max n’est pas encore construit : il passe par un autre chemin chez Google, celui des éléments, qui arrivera avec les images.',
    }
  }
  if (proposition.champ !== 'titre' && proposition.champ !== 'description') {
    return { ok: false, raison: 'Seuls les titres et les descriptions peuvent être déposés.' }
  }

  const acces = await accesCompteActif(userId)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  /*
   * Relue maintenant, pas reprise de la base. C'est la seule façon de ne pas écraser ce qui
   * a changé depuis la dernière lecture hebdomadaire.
   */
  const annonces = await googleAds.lireAnnoncesDuGroupe(acces.acces, proposition.groupe.groupeId)
  if (!annonces.ok) return { ok: false, raison: annonces.raison }

  if (annonces.valeur.length === 0) {
    return {
      ok: false,
      raison: 'Ce groupe n’a aucune annonce responsive où déposer ce texte.',
    }
  }
  if (annonces.valeur.length > 1) {
    return {
      ok: false,
      raison: `Ce groupe porte ${annonces.valeur.length} annonces. Evoliia ne choisit pas à votre place dans laquelle déposer, et les modifier toutes changerait plus que vous ne demandez. Faites-le depuis Google Ads.`,
    }
  }

  const annonce = annonces.valeur[0]
  if (annonce === undefined) return { ok: false, raison: 'Annonce introuvable.' }

  const liste = proposition.champ === 'titre' ? annonce.titres : annonce.descriptions
  if (liste.some((une) => une.texte.trim() === proposition.texte.trim())) {
    return { ok: false, raison: 'Ce texte est déjà dans l’annonce.' }
  }

  const textes = await textesAujourdhui(userId, compte.id)
  const verdict = autoriseTexte(
    { ...ouverture.demande, textesAujourdhui: textes },
    proposition.champ,
    proposition.texte,
    liste.length,
  )
  if (!verdict.ok) return verdict

  const apres = [...liste, { texte: proposition.texte, epingle: '' }]
  const champ = proposition.champ

  return journaliser(
    userId,
    compte,
    {
      quoi: champ,
      motif: `${champ === 'titre' ? 'Titre' : 'Description'} ajouté à « ${proposition.groupe.nom} » : ${proposition.texte}`,
      campagneId: null,
      /*
       * La liste entière, avant et après. C'est plus verbeux qu'un seul texte, et c'est la
       * condition du retour arrière : remettre « la liste d'avant » remet aussi les
       * épinglages, qu'un retrait naïf du dernier élément aurait perdus.
       */
      avant: { champ, textes: liste },
      apres: { champ, textes: apres },
      mode: 'assiste',
    },
    () => ecrireTextesAnnonce(acces.acces, annonce.resourceName, champ, apres),
    async () => {
      await withUserScope(userId, async (tx) => {
        await tx.adsProposition.updateMany({
          where: { id: proposition.id, userId },
          data: { etat: 'deposee', closedAt: new Date() },
        })
        /*
         * Le texte rejoint les éléments réels, marqué comme venant d'Evoliia. C'est la
         * seule mesure de ce que Naya a apporté, et la prochaine lecture hebdomadaire ne
         * l'écrasera pas : `origine` n'est jamais réécrit.
         */
        await tx.adsElement.createMany({
          data: [
            {
              userId,
              accountId: compte.id,
              groupeId: proposition.groupe.id,
              champ,
              texte: proposition.texte,
              origine: 'evoliia',
            },
          ],
          skipDuplicates: true,
        })
      })
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
        apres: true,
        annulees: { select: { id: true }, take: 1 },
      },
    }),
  )
  if (origine === null) throw notFound('Cette modification est introuvable, ou n’a jamais abouti.')
  if (origine.annulees.length > 0) {
    return { ok: false, raison: 'Cette modification a déjà été annulée.' }
  }

  const avant = (origine.avant ?? {}) as {
    budgetMicros?: number
    statut?: string
    champ?: string
    textes?: TexteAnnonceAds[]
  }

  const acces = await accesCompteActif(userId)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  /*
   * Le retour d'un dépôt de texte remet la liste d'avant, épinglages compris. Retirer
   * simplement le dernier élément de la liste actuelle serait faux dès que quelqu'un a
   * modifié l'annonce entre-temps : on enlèverait son texte à lui.
   */
  if (
    (origine.quoi === 'titre' || origine.quoi === 'description') &&
    Array.isArray(avant.textes)
  ) {
    return restaurerTexte(userId, compte, acces.acces, origine.id, {
      champ: origine.quoi,
      textes: avant.textes,
      apres: (origine.apres ?? {}) as { textes?: TexteAnnonceAds[] },
    })
  }

  if (origine.campagneId === null) {
    return { ok: false, raison: 'Cette modification ne sait pas se défaire.' }
  }
  const cible = await cibleDe(userId, compte.id, origine.campagneId)

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

/**
 * Le retour arrière d'un dépôt de texte.
 *
 * L'annonce est relue avant d'être réécrite, et pour une raison précise : si quelqu'un y a
 * ajouté un texte depuis, renvoyer la liste d'avant le supprimerait sans que personne l'ait
 * demandé. On ne restaure donc que si l'annonce est encore telle qu'on l'avait laissée.
 */
async function restaurerTexte(
  userId: string,
  compte: CompteRelie,
  acces: AccesAds,
  annuleId: string,
  origine: {
    champ: 'titre' | 'description'
    textes: TexteAnnonceAds[]
    apres: { textes?: TexteAnnonceAds[] }
  },
): Promise<Issue> {
  const depose = (origine.apres.textes ?? []).at(-1)
  if (depose === undefined) return { ok: false, raison: 'Cette modification ne sait pas se défaire.' }

  const groupe = await withUserScope(userId, (tx) =>
    tx.adsElement.findFirst({
      where: { userId, accountId: compte.id, champ: origine.champ, texte: depose.texte },
      select: { groupe: { select: { id: true, groupeId: true } } },
    }),
  )
  if (groupe === null) return { ok: false, raison: 'Le contenant de ce texte est introuvable.' }

  const annonces = await googleAds.lireAnnoncesDuGroupe(acces, groupe.groupe.groupeId)
  if (!annonces.ok) return { ok: false, raison: annonces.raison }
  const annonce = annonces.valeur[0]
  if (annonce === undefined || annonces.valeur.length > 1) {
    return { ok: false, raison: 'Ce groupe ne porte plus une seule annonce : le retour arrière ne peut pas être sûr.' }
  }

  const actuelle = origine.champ === 'titre' ? annonce.titres : annonce.descriptions
  const attendue = origine.apres.textes ?? []
  if (
    actuelle.length !== attendue.length ||
    actuelle.some((une, index) => une.texte !== attendue[index]?.texte)
  ) {
    return {
      ok: false,
      raison:
        'Cette annonce a changé depuis le dépôt. Evoliia ne la remet pas dans son état d’avant : elle effacerait ce qui a été écrit entre-temps. Retirez le texte depuis Google Ads.',
    }
  }

  return journaliser(
    userId,
    compte,
    {
      quoi: origine.champ,
      motif: `Retrait de « ${depose.texte} »`,
      campagneId: null,
      avant: { champ: origine.champ, textes: actuelle },
      apres: { champ: origine.champ, textes: origine.textes },
      mode: 'restauration',
      annuleId,
    },
    () => ecrireTextesAnnonce(acces, annonce.resourceName, origine.champ, origine.textes),
    async () => {
      await withUserScope(userId, (tx) =>
        tx.adsElement.deleteMany({
          where: {
            userId,
            groupeId: groupe.groupe.id,
            champ: origine.champ,
            texte: depose.texte,
          },
        }),
      )
    },
  )
}
