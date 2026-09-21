import { FACTEUR_MAX, FACTEUR_MIN } from '@/lib/bornes-budget'
import type { ProfilAds } from './profil'

/**
 * Ce qu'Evoliia s'interdit d'envoyer chez Google, et pourquoi chaque borne existe.
 *
 * Un fichier à part, sans base de données, sans réseau, sans dépendance : les limites de ce
 * qu'un produit peut faire à l'argent de quelqu'un doivent se lire d'un bloc, se tester sans
 * rien monter, et ne pas être noyées dans le code qui les applique. Mêlées au transport,
 * elles seraient vraies à l'endroit où on les a écrites et fausses partout ailleurs.
 *
 * Le principe qui les gouverne : **Naya n'a jamais d'autonomie financière illimitée.** Un
 * mode assisté sans plafond est un autopilote qui demande poliment avant chaque virage — et
 * une personne qui confirme dix fois par jour ne lit plus ce qu'elle confirme.
 *
 * Ce fichier ne doit acquérir aucune dépendance de code : l'écran importe ses facteurs pour
 * afficher les bornes autorisées avant la frappe, et un champ qui accepterait ce que le
 * serveur refuse — ou l'inverse — ferait de ces bornes une devinette. Les redéclarer côté
 * navigateur créerait deux vérités, et le jour où l'une changerait, l'écran annoncerait une
 * limite que le serveur ne reconnaîtrait pas.
 */

/*
 * L'amplitude d'un pas vit dans `@/lib/bornes-budget` : l'écran l'affiche avant la frappe, et
 * un composant de navigateur ne peut pas importer de valeur depuis le serveur. Réexportée
 * pour que le reste du module n'ait qu'une porte d'entrée.
 */
export { FACTEUR_MAX, FACTEUR_MIN } from '@/lib/bornes-budget'

/**
 * Le plafond absolu, quand un budget mensuel est renseigné.
 *
 * Deux fois la moyenne quotidienne. Assez pour rattraper une campagne bridée, trop peu pour
 * qu'un enchaînement de hausses fasse tripler la dépense d'un mois sans que rien n'arrête.
 */
export const FACTEUR_PLAFOND_MENSUEL = 2

/** Jours d'un mois, pour ramener un budget mensuel à un plafond quotidien. */
const JOURS_MOIS = 30

/**
 * Le nombre d'écritures autorisées par jour et par compte.
 *
 * Cinq. Ce n'est pas une limite technique — Google en accepte des milliers — c'est une
 * limite de vitesse. Au-delà de quelques gestes par jour, on ne pilote plus une campagne :
 * on la secoue, et chaque changement efface la mesure du précédent.
 */
export const ACTIONS_PAR_JOUR = 5

const MICROS = 1_000_000

export type Refus = { ok: false; raison: string }
export type Accord = { ok: true }
export type Verdict = Accord | Refus

/** Le contexte d'une écriture, réduit à ce dont les bornes ont besoin. */
export type Demande = {
  mode: string
  devise: string
  profil: ProfilAds
  /** Écritures déjà faites aujourd'hui sur ce compte, refus compris. */
  faitesAujourdhui: number
}

function argent(micros: number, devise: string): string {
  return `${(micros / MICROS).toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

/** Les conditions communes à toute écriture, quel qu'en soit le type. */
export function autorise(demande: Demande): Verdict {
  if (demande.mode !== 'assiste') {
    return {
      ok: false,
      raison:
        'Ce compte est en lecture seule. Passez-le en mode assisté pour qu’une modification puisse être envoyée à Google.',
    }
  }
  if (demande.faitesAujourdhui >= ACTIONS_PAR_JOUR) {
    return {
      ok: false,
      raison: `Vous avez atteint la limite de ${ACTIONS_PAR_JOUR} modifications pour aujourd’hui. Une campagne a besoin de quelques jours pour montrer l’effet d’un changement — c’est le sens de cette limite.`,
    }
  }
  return { ok: true }
}

/**
 * Les bornes d'un changement de budget.
 *
 * `partage` compte les campagnes qui utilisent ce budget. Chez Google, un budget est un
 * objet à part : le modifier pour une campagne le modifie pour toutes celles qui s'en
 * servent. Une hausse demandée pour une campagne rentable augmenterait alors, en silence,
 * la dépense d'une campagne qu'on ne regardait pas.
 */
export function autoriseBudget(
  demande: Demande,
  actuelMicros: number,
  versMicros: number,
  partage: number,
): Verdict {
  const commun = autorise(demande)
  if (!commun.ok) return commun

  if (partage > 1) {
    return {
      ok: false,
      raison: `Ce budget est partagé par ${partage} campagnes : le modifier ici changerait aussi la dépense des autres. Faites-le depuis Google Ads, où vous verrez lesquelles sont concernées.`,
    }
  }
  if (!Number.isFinite(versMicros) || versMicros <= 0) {
    return { ok: false, raison: 'Un budget quotidien doit être un montant positif.' }
  }
  if (actuelMicros <= 0) {
    return {
      ok: false,
      raison: 'Evoliia ne connaît pas le budget actuel de cette campagne. Relisez vos campagnes, puis réessayez.',
    }
  }

  if (versMicros < actuelMicros * FACTEUR_MIN) {
    return {
      ok: false,
      raison: `Evoliia ne divise pas un budget par plus de deux d’un coup. Le plus bas possible ici est ${argent(actuelMicros * FACTEUR_MIN, demande.devise)} par jour.`,
    }
  }
  if (versMicros > actuelMicros * FACTEUR_MAX) {
    return {
      ok: false,
      raison: `Evoliia n’augmente pas un budget de plus de moitié d’un coup. Le plus haut possible ici est ${argent(actuelMicros * FACTEUR_MAX, demande.devise)} par jour. Vous pourrez remonter demain si la campagne tient.`,
    }
  }

  /*
   * Le plafond adossé au budget mensuel. Il ne s'applique que s'il est renseigné : sans
   * chiffre de la personne, inventer un plafond reviendrait à décider à sa place de ce
   * qu'elle peut dépenser.
   */
  if (demande.profil.budgetMensuel > 0) {
    const plafond = (demande.profil.budgetMensuel / JOURS_MOIS) * FACTEUR_PLAFOND_MENSUEL * MICROS
    if (versMicros > plafond) {
      return {
        ok: false,
        raison: `Ce budget dépasserait le plafond déduit de votre budget mensuel de ${argent(demande.profil.budgetMensuel * MICROS, demande.devise)} : au maximum ${argent(plafond, demande.devise)} par jour pour une seule campagne. Relevez votre budget mensuel si vous voulez aller plus loin.`,
      }
    }
  }

  return { ok: true }
}

/** Les bornes d'un changement de statut. Mettre en pause ne coûte rien ; reprendre, si. */
export function autoriseStatut(demande: Demande, vers: string): Verdict {
  if (vers !== 'ENABLED' && vers !== 'PAUSED') {
    return { ok: false, raison: 'Seules la mise en pause et la reprise sont possibles.' }
  }
  /*
   * Une mise en pause échappe au plafond quotidien, et c'est délibéré : elle arrête une
   * dépense. Refuser d'arrêter une campagne qui brûle de l'argent au motif qu'on a déjà fait
   * cinq gestes aujourd'hui serait exactement le contraire de ce que ces bornes protègent.
   */
  if (vers === 'PAUSED') {
    return demande.mode === 'assiste'
      ? { ok: true }
      : {
          ok: false,
          raison:
            'Ce compte est en lecture seule. Passez-le en mode assisté pour qu’une modification puisse être envoyée à Google.',
        }
  }
  return autorise(demande)
}
