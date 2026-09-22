import { withUserScope } from '@/server/db/scope'
import { BAISSE_BUDGET } from './regles-meta'
import type { DroitsMeta } from './droits-meta'
import {
  autoriseBudgetMeta,
  autorisePauseMeta,
  type DemandeMeta,
} from './garde-fous-meta'
import type { RecommandationMetaVue } from './recommandations-meta'
import type { ProfilAds } from './profil'

/**
 * Ce qu'Evoliia enverrait à Meta pour un constat, et si elle a le droit de l'envoyer.
 *
 * Deux principes, et le premier explique la moitié du fichier.
 *
 * **L'action est remontée sur les chiffres d'aujourd'hui, jamais relue du constat.** Un
 * constat ouvert il y a douze jours porte le budget qu'il a vu ce jour-là. Proposer « passer
 * de 20 à 16 » alors que le budget est à 40 depuis serait proposer une division par deux en
 * la nommant palier. Seule la cible vient du constat — c'est l'objet dont on a parlé ; tout
 * le reste est relu.
 *
 * **La phrase et l'action sont écrites ensemble, au même endroit.** `resume` dit exactement
 * ce qui partira, dans les mots de la personne ; `type` et ses champs disent la même chose
 * dans ceux de Meta. Les séparer, c'est le jour où l'écran annonce une pause et où le
 * serveur change un budget. Rien ici n'est déduit d'un texte libre — voir la règle du cahier
 * des charges : on ne parse jamais du français pour décider d'un appel d'API.
 *
 * Rien n'est envoyé depuis ce module. Il décrit et il juge ; l'envoi viendra ailleurs, et
 * repassera par ces mêmes garde-fous au moment d'écrire — parce qu'entre l'affichage et le
 * clic, le budget a pu bouger.
 */

const MICROS = 1_000_000

/** Ce qu'on enverrait, sous une forme que le serveur saura exécuter. */
export type ActionMetaProposee =
  | {
      type: 'pause'
      niveau: 'ensemble' | 'annonce'
      cibleId: string
      /** Le statut attendu au moment de l'envoi. Une dernière vérification avant d'écrire. */
      attendu: string
      resume: string
    }
  | {
      type: 'budget'
      cibleId: string
      versMicros: number
      /** Le budget attendu au moment de l'envoi : s'il a bougé, on ne l'écrase pas. */
      attenduMicros: number
      resume: string
    }

/**
 * Le sort d'un constat : rien à proposer, une action possible, ou une action refusée.
 *
 * Le refus est une réponse à part entière et se montre. Cacher un geste impossible
 * laisserait croire que le produit n'y a pas pensé ; le montrer barré, avec son motif, dit
 * ce qui manque et comment y remédier.
 */
export type PropositionMeta =
  | { etat: 'aucune' }
  | { etat: 'possible'; action: ActionMetaProposee }
  | { etat: 'refusee'; action: ActionMetaProposee; raison: string }

/** Ce que la base sait des objets, à plat, pour monter les actions sans requête par constat. */
export type ContexteActions = {
  ensembles: Map<
    string,
    {
      nom: string
      statut: string
      budgetMicros: number
      campagneNom: string
      /** Vrai quand la campagne pilote le budget : l'ensemble n'a pas le sien. */
      budgetSurLaCampagne: boolean
      /** Ensembles encore actifs dans la campagne, celui-ci exclu. */
      voisinsActifs: number
    }
  >
  annonces: Map<
    string,
    { nom: string; statut: string; ensembleNom: string; voisinsActifs: number }
  >
}

const VIDE: ContexteActions = { ensembles: new Map(), annonces: new Map() }

/** Diffuse-t-il vraiment ? `effective_status` distingue l'actif du parent en pause. */
function diffuse(statut: string): boolean {
  return statut === 'ACTIVE'
}

/**
 * Tout ce qu'il faut pour monter les actions d'un compte, en trois lectures.
 *
 * Trois requêtes plutôt qu'une par constat : un écran qui en affiche huit ferait sinon
 * vingt-quatre allers-retours pour afficher des phrases. Les voisins actifs se comptent en
 * mémoire, sur les mêmes lignes — c'est gratuit une fois qu'on les a.
 */
export async function contexteActionsMeta(
  userId: string,
  accountId: string,
): Promise<ContexteActions> {
  const [campagnes, groupes, annonces] = await Promise.all([
    withUserScope(userId, (tx) =>
      tx.adsCampagne.findMany({
        where: { accountId },
        select: { id: true, nom: true, budgetMicros: true },
      }),
    ),
    withUserScope(userId, (tx) =>
      tx.adsGroupe.findMany({
        where: { accountId },
        select: { id: true, nom: true, statut: true, budgetMicros: true, campagneId: true },
      }),
    ),
    withUserScope(userId, (tx) =>
      tx.adsAnnonce.findMany({
        where: { accountId },
        select: { id: true, nom: true, statut: true, groupeId: true },
      }),
    ),
  ])

  const parCampagne = new Map(campagnes.map((une) => [une.id, une]))

  /* Les actifs par parent, comptés une fois pour toutes. */
  const actifsParCampagne = new Map<string, number>()
  for (const groupe of groupes) {
    if (!diffuse(groupe.statut)) continue
    actifsParCampagne.set(groupe.campagneId, (actifsParCampagne.get(groupe.campagneId) ?? 0) + 1)
  }
  const actifsParGroupe = new Map<string, number>()
  for (const annonce of annonces) {
    if (!diffuse(annonce.statut)) continue
    actifsParGroupe.set(annonce.groupeId, (actifsParGroupe.get(annonce.groupeId) ?? 0) + 1)
  }

  const contexte: ContexteActions = { ensembles: new Map(), annonces: new Map() }

  for (const groupe of groupes) {
    const campagne = parCampagne.get(groupe.campagneId)
    const sien = Number(groupe.budgetMicros)
    contexte.ensembles.set(groupe.id, {
      nom: groupe.nom,
      statut: groupe.statut,
      budgetMicros: sien,
      campagneNom: campagne?.nom ?? '',
      /*
       * Zéro sur l'ensemble et un montant sur la campagne : c'est la campagne qui pilote.
       * Les deux à zéro veut dire qu'on ne sait pas — on ne conclut alors pas au pilotage
       * par la campagne, parce qu'un refus faux vaut moins qu'un contrôle de plus à l'envoi.
       */
      budgetSurLaCampagne: sien === 0 && Number(campagne?.budgetMicros ?? 0) > 0,
      voisinsActifs: Math.max(
        0,
        (actifsParCampagne.get(groupe.campagneId) ?? 0) - (diffuse(groupe.statut) ? 1 : 0),
      ),
    })
  }

  for (const annonce of annonces) {
    contexte.annonces.set(annonce.id, {
      nom: annonce.nom,
      statut: annonce.statut,
      ensembleNom: contexte.ensembles.get(annonce.groupeId)?.nom ?? '',
      voisinsActifs: Math.max(
        0,
        (actifsParGroupe.get(annonce.groupeId) ?? 0) - (diffuse(annonce.statut) ? 1 : 0),
      ),
    })
  }

  return contexte
}

function argent(micros: number, devise: string): string {
  return `${(micros / MICROS).toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

/** Le contexte d'une écriture, sans ce qui touche à la base. */
export type CadreMeta = {
  mode: string
  devise: string
  profil: ProfilAds
  droits: DroitsMeta
  /** Écritures déjà faites aujourd'hui sur ce compte, refus compris. */
  faitesAujourdhui: number
}

/**
 * L'action proposée pour un constat, et son verdict.
 *
 * Pure : elle ne lit ni la base ni le réseau, et c'est ce qui permet de vérifier sans rien
 * monter qu'une pause du dernier élément actif est refusée, ou qu'un budget piloté par la
 * campagne ne se modifie pas ici.
 */
export function proposerActionMeta(
  recommandation: RecommandationMetaVue,
  contexte: ContexteActions = VIDE,
  cadre: CadreMeta,
): PropositionMeta {
  const brut = recommandation.action
  const type = typeof brut.type === 'string' ? brut.type : ''
  const demande: DemandeMeta = {
    mode: cadre.mode,
    devise: cadre.devise,
    profil: cadre.profil,
    droits: cadre.droits,
    faitesAujourdhui: cadre.faitesAujourdhui,
  }

  if (type === 'pause-annonce') {
    const cibleId = typeof brut.annonce === 'string' ? brut.annonce : ''
    const annonce = contexte.annonces.get(cibleId)
    if (annonce === undefined) return { etat: 'aucune' }

    const action: ActionMetaProposee = {
      type: 'pause',
      niveau: 'annonce',
      cibleId,
      attendu: annonce.statut,
      resume: `Mettre en pause la publicité « ${annonce.nom} ». Elle cessera d’être diffusée ; les autres publicités de « ${annonce.ensembleNom} » continuent.`,
    }
    const verdict = autorisePauseMeta(demande, {
      statut: annonce.statut,
      parent: annonce.ensembleNom,
      restantsActifs: annonce.voisinsActifs,
    })
    return verdict.ok ? { etat: 'possible', action } : { etat: 'refusee', action, raison: verdict.raison }
  }

  if (type === 'pause-ensemble') {
    const cibleId = typeof brut.ensemble === 'string' ? brut.ensemble : ''
    const ensemble = contexte.ensembles.get(cibleId)
    if (ensemble === undefined) return { etat: 'aucune' }

    const action: ActionMetaProposee = {
      type: 'pause',
      niveau: 'ensemble',
      cibleId,
      attendu: ensemble.statut,
      resume: `Mettre en pause l’ensemble « ${ensemble.nom} ». Il cessera de diffuser et de dépenser ; le reste de « ${ensemble.campagneNom} » continue.`,
    }
    const verdict = autorisePauseMeta(demande, {
      statut: ensemble.statut,
      parent: ensemble.campagneNom,
      restantsActifs: ensemble.voisinsActifs,
    })
    return verdict.ok ? { etat: 'possible', action } : { etat: 'refusee', action, raison: verdict.raison }
  }

  if (type === 'budget-ensemble') {
    const cibleId = typeof brut.ensemble === 'string' ? brut.ensemble : ''
    const ensemble = contexte.ensembles.get(cibleId)
    if (ensemble === undefined) return { etat: 'aucune' }

    /*
     * Le palier est calculé sur le budget d'aujourd'hui. Reprendre celui du constat ferait
     * proposer une valeur qui ne s'accorde plus avec le « budget attendu » envoyé juste à
     * côté — et le serveur refuserait une action qu'il suffisait de recalculer.
     */
    const vers = Math.round(ensemble.budgetMicros * BAISSE_BUDGET)
    const action: ActionMetaProposee = {
      type: 'budget',
      cibleId,
      versMicros: vers,
      attenduMicros: ensemble.budgetMicros,
      resume: `Baisser le budget quotidien de « ${ensemble.nom} » de ${argent(ensemble.budgetMicros, cadre.devise)} à ${argent(vers, cadre.devise)}.`,
    }
    const verdict = autoriseBudgetMeta(demande, ensemble.budgetMicros, vers, {
      surLaCampagne: ensemble.budgetSurLaCampagne,
      campagne: ensemble.campagneNom,
    })
    return verdict.ok ? { etat: 'possible', action } : { etat: 'refusee', action, raison: verdict.raison }
  }

  return { etat: 'aucune' }
}
