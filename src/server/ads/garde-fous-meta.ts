import { FACTEUR_MAX, FACTEUR_MIN } from '@/lib/bornes-budget'
import { autorise, type Demande, type Verdict } from './garde-fous'
import type { DroitsMeta } from './droits-meta'

/**
 * Ce que MIRA s'interdit d'envoyer chez Meta, et pourquoi chaque borne existe.
 *
 * Les bornes communes — le mode du compte, le nombre de gestes par jour, l'amplitude d'un
 * pas de budget — vivent dans `garde-fous.ts` et sont reprises telles quelles : elles ne
 * doivent rien à Google, elles protègent l'argent de quelqu'un. Ce fichier n'ajoute que ce
 * qui est vrai chez Meta et faux ailleurs.
 *
 * Trois différences, et chacune a coûté un écran à quelqu'un quelque part.
 *
 * **Le budget ne vit pas toujours là où on le regarde.** Chez Meta, il est sur l'ensemble de
 * publicités — sauf quand la campagne le pilote, ce que Meta appelle un budget de campagne.
 * Dans ce cas, le budget de l'ensemble n'existe pas : le modifier est refusé par Meta, ou
 * pire, accepté sans effet. On refuse donc avant d'envoyer, en disant où aller.
 *
 * **Mettre en pause le dernier objet actif éteint tout.** Mettre en pause la seule annonce
 * active d'un ensemble arrête l'ensemble ; le seul ensemble actif d'une campagne arrête la
 * campagne. MIRA proposait d'éteindre une créative fatiguée : elle aurait éteint la
 * diffusion. Une extinction se demande, elle ne se déduit pas d'un constat de fatigue.
 *
 * **Un droit d'écriture accordé n'est pas un droit d'écriture supposé.** Voir
 * `droits-meta.ts` : l'écran de consentement de Meta permet de décocher une permission, et
 * le jeton part alors amputé. La borne est ici parce que c'est ici qu'on refuse.
 *
 * Aucune dépendance à la base ni au réseau : les limites de ce qu'un produit peut faire à
 * l'argent de quelqu'un doivent se lire d'un bloc et se tester sans rien monter.
 */

export { FACTEUR_MAX, FACTEUR_MIN } from '@/lib/bornes-budget'

/** Le contexte d'une écriture chez Meta, réduit à ce dont les bornes ont besoin. */
export type DemandeMeta = Demande & {
  /** Ce que Meta a réellement accordé. Voir `droits-meta.ts`. */
  droits: DroitsMeta
}

const MICROS = 1_000_000

function argent(micros: number, devise: string): string {
  return `${(micros / MICROS).toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

/**
 * Les conditions communes à toute écriture chez Meta.
 *
 * Le droit accordé passe **avant** le mode du compte, et l'ordre est le message : quelqu'un
 * dont le jeton ne sait pas écrire doit lire « Meta ne nous a pas donné ce droit », pas
 * « passez en mode assisté » — sans quoi il change un réglage qui n'y changera rien, et
 * revient avec la même erreur et un peu moins de patience.
 */
export function autoriseMeta(demande: DemandeMeta): Verdict {
  if (!demande.droits.ecrire) {
    return {
      ok: false,
      raison:
        'Meta n’a pas accordé à Evoliia le droit de modifier vos campagnes. Reconnectez votre compte Meta et laissez cochée l’autorisation « gérer les publicités » : MIRA pourra alors appliquer ce qu’elle propose.',
    }
  }
  return autorise(demande)
}

/** Où vit le budget de l'objet visé, tel que la lecture l'a constaté. */
export type OuVitLeBudget = {
  /** Vrai quand la campagne pilote le budget : l'ensemble n'a alors pas le sien. */
  surLaCampagne: boolean
  /** Le nom de la campagne, pour dire où aller plutôt que de renvoyer à Meta en vrac. */
  campagne: string
}

/**
 * Les bornes d'un changement de budget chez Meta.
 *
 * L'amplitude est celle de Google — pas plus de moitié en hausse, pas moins de moitié en
 * baisse — et pour la même raison : au-delà, on ne pilote plus une campagne, on la secoue,
 * et Meta remet de toute façon son apprentissage à zéro à chaque grand écart.
 */
export function autoriseBudgetMeta(
  demande: DemandeMeta,
  actuelMicros: number,
  versMicros: number,
  ou: OuVitLeBudget,
): Verdict {
  const commun = autoriseMeta(demande)
  if (!commun.ok) return commun

  if (ou.surLaCampagne) {
    return {
      ok: false,
      raison: `Le budget de cet ensemble est piloté par la campagne « ${ou.campagne} ». Le modifier ici n’aurait aucun effet : c’est le budget de la campagne qu’il faut changer, et MIRA ne touche pas encore à ce niveau.`,
    }
  }
  if (!Number.isFinite(versMicros) || versMicros <= 0) {
    return { ok: false, raison: 'Un budget quotidien doit être un montant positif.' }
  }
  if (actuelMicros <= 0) {
    return {
      ok: false,
      raison:
        'Evoliia ne connaît pas le budget actuel de cet ensemble. Relisez vos campagnes, puis réessayez.',
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
      raison: `Evoliia n’augmente pas un budget de plus de moitié d’un coup. Le plus haut possible ici est ${argent(actuelMicros * FACTEUR_MAX, demande.devise)} par jour. Vous pourrez remonter demain si l’ensemble tient.`,
    }
  }
  return { ok: true }
}

/** Ce qu'on sait de l'objet qu'on s'apprête à éteindre. */
export type ObjetAEteindre = {
  /** Le statut effectif rendu par Meta : ACTIVE, PAUSED, CAMPAIGN_PAUSED… */
  statut: string
  /** Le nom de l'objet qui le contient : son ensemble, ou sa campagne. */
  parent: string
  /**
   * Combien d'objets actifs resteraient dans ce parent après l'extinction.
   *
   * Zéro veut dire que l'on éteint la diffusion du parent sans l'avoir demandé.
   */
  restantsActifs: number
}

/**
 * Les bornes d'une mise en pause.
 *
 * Meta n'a pas de « supprimer » réversible : une pause est le geste sûr, et c'est le seul
 * que MIRA proposera. Reste à ne pas éteindre plus que ce qu'on croit éteindre.
 */
export function autorisePauseMeta(demande: DemandeMeta, objet: ObjetAEteindre): Verdict {
  const commun = autoriseMeta(demande)
  if (!commun.ok) return commun

  /*
   * Seul ce qui diffuse peut être mis en pause. Meta accepterait la demande sans rien
   * changer, et le journal garderait une trace de quelque chose qui n'a pas eu lieu — le
   * genre de ligne qui fait douter de toutes les autres.
   */
  if (objet.statut !== 'ACTIVE') {
    return {
      ok: false,
      raison: `Cet élément ne diffuse pas en ce moment (${objet.statut}). Il n’y a rien à mettre en pause.`,
    }
  }
  if (objet.restantsActifs <= 0) {
    return {
      ok: false,
      raison: `C’est le dernier élément actif de « ${objet.parent} » : le mettre en pause arrêterait toute la diffusion. Si c’est ce que vous voulez, faites-le depuis le gestionnaire de publicités, où vous verrez l’ensemble de ce que cela éteint.`,
    }
  }
  return { ok: true }
}
