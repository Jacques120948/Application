import { cpaAcceptable } from './mots-cles'
import type { LectureObjectifs, ProfilAds } from './profil'
import type { CampagneVue, TableauAds } from './tableau'

/**
 * Ce qui déclenche une recommandation, et pourquoi c'est du code et non un modèle.
 *
 * Un modèle de langage à qui l'on donnerait un tableau de chiffres en sortirait des conseils
 * plausibles. Plausibles : c'est exactement le problème. Il conclurait « votre ROAS baisse,
 * réduisez ce budget » sur deux journées de données, il inventerait un seuil de marché quand
 * la marge manque, et il ne dirait jamais deux fois la même chose devant les mêmes chiffres.
 * Une recommandation publicitaire décide d'une dépense réelle : elle doit être reproductible,
 * contestable, et adossée à une condition qu'on peut lire.
 *
 * Ici, chaque règle est une condition écrite. Elle sort un constat avec les chiffres qui
 * l'ont déclenchée. Naya, elle, explique — et seulement quand on le lui demande, parce que
 * la faire parler coûte des crédits et qu'une nuit de calcul n'a pas à en dépenser.
 *
 * Quatre principes.
 *
 * **Aucune règle ne se prononce sans matière.** Chacune porte un plancher : un nombre de
 * conversions, une part de la dépense, un nombre de jours. Une campagne qui a fait une vente
 * en trente jours ne se juge pas — et un avis rendu sur une vente est pire qu'un silence,
 * parce qu'il a l'air d'être fondé.
 *
 * **Rien ne se juge sans la marge.** Le seuil de rentabilité vient de la personne. Sans lui,
 * les règles qui parlent de rentabilité se taisent, au lieu d'emprunter une moyenne de marché
 * à personne en particulier.
 *
 * **Un constat porte ses chiffres.** `donnees` conserve ce qui l'a déclenché. C'est ce qui
 * permet de dire non : « 143 % sur 30 jours pour un seuil de 250 % » se vérifie, « cette
 * campagne sous-performe » ne se vérifie pas.
 *
 * **Une action proposée n'est pas une action faite.** `action` décrit ce qu'il faudrait
 * envoyer à Google, sous une forme que le serveur saura exécuter le jour où la personne le
 * demandera. Aujourd'hui, rien ne l'exécute.
 */

export type Priorite = 'urgent' | 'surveiller' | 'opportunite' | 'information'

export type Risque = 'faible' | 'moyen' | 'eleve'

export type Constat = {
  regle: string
  /** `null` pour un constat qui porte sur le compte entier. */
  campagneId: string | null
  priorite: Priorite
  titre: string
  /** Écrit par le code, à partir des chiffres. Jamais par un modèle. */
  observation: string
  jours: number
  donnees: Record<string, number | string | null>
  action: Record<string, string | number>
  risque: Risque
}

export type ContexteRegles = {
  devise: string
  profil: ProfilAds
  lecture: LectureObjectifs
  /** La fenêtre de jugement : assez longue pour qu'une conversion ne décide de rien. */
  longue: TableauAds
  /** La fenêtre courte, pour ce qui se constate vite : une campagne qui ne s'affiche plus. */
  courte: TableauAds
  /**
   * Ce que les gens ont réellement tapé, et ce que ça a coûté.
   *
   * Absent des huit premières règles, et c'était un trou : la donnée était lue et rangée
   * chaque semaine, et personne ne la regardait. Or sur un petit budget, c'est là que
   * l'argent fuit — une seule requête hors sujet mange la moitié d'une journée.
   */
  termes: TermeVu[]
}

/** Un terme tapé par quelqu'un, rapporté à la campagne qui l'a payé. */
export type TermeVu = {
  campagneId: string
  campagneNom: string
  terme: string
  clics: number
  conversions: number
  /** En unités de la devise, comme partout ailleurs dans ce fichier. */
  cout: number
}

/*
 * Les planchers. Ils sont au même endroit pour être discutables d'un coup d'œil : ce sont
 * eux qui décident de ce dont on parle et de ce qu'on laisse passer.
 */

/** En deçà, une campagne n'a pas assez vendu pour qu'on juge sa rentabilité. */
const CONVERSIONS_MINIMALES = 2

/** Idem pour le compte entier, qui agrège plusieurs campagnes. */
const CONVERSIONS_MINIMALES_COMPTE = 3

/** En deçà de cette part de la dépense, une campagne ne pèse pas assez pour alerter. */
const PART_MINIMALE = 10

/** Une chute de ROAS se signale quand elle est à la fois relative et large. */
const CHUTE_RELATIVE = 0.25
const CHUTE_EN_POINTS = 30

/**
 * Le nombre de journées de diffusion qu'il faut dans chaque période pour les comparer.
 *
 * Sans ce plancher, une campagne relancée il y a trois jours se compare à trente jours
 * pleins et paraît s'effondrer — ou décoller. Ce n'est pas un mouvement, c'est un artefact
 * de fenêtre, et c'est le genre de faux signal qui fait mettre en pause une campagne qui va
 * très bien. Sept jours de chaque côté : en dessous, la moyenne d'un côté est une anecdote.
 */
const JOURS_COMPARABLES = 7

/** Au-delà de ce dépassement projeté, le budget du mois mérite d'être dit. */
const DEPASSEMENT_BUDGET = 1.1

/** Avant cela, le mois est trop jeune pour qu'une projection veuille dire quelque chose. */
const JOURS_AVANT_PROJECTION = 5

/** Au-delà de ce dépassement, le coût par vente s'écarte vraiment de la cible. */
const DERIVE_CPA = 1.25

/** L'augmentation proposée quand une campagne rentable est bridée par son budget. */
export const HAUSSE_BUDGET = 1.2

/**
 * Ce qu'un terme doit avoir coûté, sans rien vendre, pour qu'on propose de l'exclure.
 *
 * Exprimé en multiples de ce qu'une vente peut coûter, et non en francs : un seuil en francs
 * serait arbitraire pour tout le monde sauf pour celui qui l'a écrit. Ici, le raisonnement se
 * lit — ce terme a consommé ce qu'une vente entière rapporte, et n'a rien vendu.
 *
 * Un seul multiple, pas deux : attendre davantage, c'est laisser filer une deuxième vente
 * pour être sûr d'avoir raison sur la première.
 */
const GACHIS_PAR_TERME = 1

const MICROS = 1_000_000

function argent(valeur: number, devise: string): string {
  return `${valeur.toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

/** Les campagnes qu'il vaut la peine d'examiner : elles ont dépensé et elles pèsent. */
function pesantes(tableau: TableauAds): CampagneVue[] {
  return tableau.campagnes.filter(
    (campagne) => campagne.actuel.cout > 0 && campagne.part >= PART_MINIMALE,
  )
}

// ─────────────────────────────── Les règles ──────────────────────────────────

/** Le compte entier perd de l'argent sur la fenêtre longue. */
function comptePerte(contexte: ContexteRegles): Constat[] {
  const { lecture, longue, devise } = contexte
  const seuil = lecture.seuil
  const roas = longue.total.roas
  if (seuil === null || roas === null) return []
  if (longue.total.conversions < CONVERSIONS_MINIMALES_COMPTE) return []
  if (roas >= seuil) return []

  const perte = lecture.benefice
  return [
    {
      regle: 'ads.compte.perte',
      campagneId: null,
      priorite: 'urgent',
      titre: 'Vos campagnes coûtent plus qu’elles ne rapportent',
      observation:
        `Sur ${longue.jours} jours, vos campagnes ont rapporté ${roas} % de ce que vous avez` +
        ` dépensé. Avec une marge de ${contexte.profil.margePourcent} %, il vous en faut` +
        ` ${seuil} % pour rentrer dans vos frais.` +
        (perte === null
          ? ''
          : ` Sur la période, la publicité vous a coûté ${argent(Math.abs(perte), devise)} de` +
            ' plus qu’elle ne vous a rapporté.'),
      jours: longue.jours,
      donnees: {
        roas,
        seuil,
        depense: longue.total.cout,
        valeur: longue.total.valeur,
        conversions: longue.total.conversions,
        benefice: perte,
      },
      action: {},
      risque: 'faible',
    },
  ]
}

/** Une campagne qui pèse et qui perd. */
function campagnePerte(contexte: ContexteRegles): Constat[] {
  const seuil = contexte.lecture.seuil
  if (seuil === null) return []

  return pesantes(contexte.longue)
    .filter(
      (campagne) =>
        campagne.actuel.roas !== null &&
        campagne.actuel.roas < seuil &&
        campagne.actuel.conversions >= CONVERSIONS_MINIMALES,
    )
    .map((campagne) => ({
      regle: 'ads.campagne.perte',
      campagneId: campagne.id,
      priorite: 'urgent' as const,
      titre: `« ${campagne.nom} » est en dessous de votre seuil`,
      observation:
        `Sur ${contexte.longue.jours} jours, cette campagne a dépensé` +
        ` ${argent(campagne.actuel.cout, contexte.devise)} — ${campagne.part} % de votre` +
        ` dépense — et rapporté ${campagne.actuel.roas} % pour un seuil de ${seuil} %.` +
        ` Elle a produit ${campagne.actuel.conversions} vente${
          campagne.actuel.conversions > 1 ? 's' : ''
        }.`,
      jours: contexte.longue.jours,
      donnees: {
        roas: campagne.actuel.roas,
        seuil,
        depense: campagne.actuel.cout,
        part: campagne.part,
        conversions: campagne.actuel.conversions,
      },
      action: { type: 'pause', campagne: campagne.id },
      risque: 'moyen' as const,
    }))
}

/** Une campagne bridée par son budget, et qui gagne de l'argent. */
function budgetLimite(contexte: ContexteRegles): Constat[] {
  const seuil = contexte.lecture.seuil
  if (seuil === null) return []

  return contexte.longue.campagnes
    .filter(
      (campagne) =>
        campagne.budgetLimite &&
        campagne.actuel.roas !== null &&
        campagne.actuel.roas > seuil &&
        campagne.actuel.conversions >= CONVERSIONS_MINIMALES &&
        campagne.budget > 0,
    )
    .map((campagne) => {
      const propose = Math.round(campagne.budget * HAUSSE_BUDGET * 100) / 100
      return {
        regle: 'ads.budget.limite',
        campagneId: campagne.id,
        priorite: 'opportunite' as const,
        titre: `« ${campagne.nom} » est bridée alors qu’elle rapporte`,
        observation:
          'Google signale que cette campagne est limitée par son budget : elle pourrait' +
          ` diffuser davantage. Sur ${contexte.longue.jours} jours elle a rapporté` +
          ` ${campagne.actuel.roas} % pour un seuil de ${seuil} %, donc au-dessus de ce qu'il` +
          ` vous faut. Son budget est de ${argent(campagne.budget, contexte.devise)} par jour ;` +
          ` une première marche serait ${argent(propose, contexte.devise)}.` +
          ' Rien ne garantit que les ventes suivent à la même cadence : une campagne qui' +
          ' diffuse plus touche aussi un public moins bien ciblé.',
        jours: contexte.longue.jours,
        donnees: {
          roas: campagne.actuel.roas,
          seuil,
          budget: campagne.budget,
          propose,
          conversions: campagne.actuel.conversions,
        },
        action: {
          type: 'budget',
          campagne: campagne.id,
          actuelMicros: Math.round(campagne.budget * MICROS),
          proposeMicros: Math.round(propose * MICROS),
        },
        risque: 'moyen' as const,
      }
    })
}

/** Une campagne qui pèse et qui n'a rien vendu du tout. */
function sansConversion(contexte: ContexteRegles): Constat[] {
  return pesantes(contexte.longue)
    .filter((campagne) => campagne.actuel.conversions === 0)
    .map((campagne) => ({
      regle: 'ads.sans.conversion',
      campagneId: campagne.id,
      priorite: 'urgent' as const,
      titre: `« ${campagne.nom} » dépense sans aucune vente`,
      observation:
        `Sur ${contexte.longue.jours} jours, cette campagne a dépensé` +
        ` ${argent(campagne.actuel.cout, contexte.devise)} — ${campagne.part} % de votre` +
        ' dépense — sans qu’aucune vente ne lui soit attribuée.' +
        ' Avant de la mettre en pause, vérifiez que le suivi des conversions fonctionne :' +
        ' une campagne sans vente mesurée peut aussi être une campagne dont les ventes ne' +
        ' sont simplement pas comptées.',
      jours: contexte.longue.jours,
      donnees: {
        depense: campagne.actuel.cout,
        part: campagne.part,
        clics: campagne.actuel.clics,
        conversions: 0,
      },
      action: { type: 'pause', campagne: campagne.id },
      risque: 'moyen' as const,
    }))
}

/** Un ROAS qui décroche par rapport à la période précédente. */
function chuteRoas(contexte: ContexteRegles): Constat[] {
  return pesantes(contexte.longue)
    .filter((campagne) => campagne.actuel.conversions >= CONVERSIONS_MINIMALES)
    .flatMap((campagne) => {
      const points = campagne.roas.points
      const actuel = campagne.actuel.roas
      if (points === null || actuel === null || points >= 0) return []
      const avant = actuel - points
      if (avant <= 0) return []
      /*
       * Les deux conditions ensemble, et pas l'une ou l'autre : une chute de vingt points
       * sur un ROAS de mille n'est pas un événement, et une chute de moitié sur un ROAS de
       * vingt n'en est pas un non plus.
       */
      if (Math.abs(points) < CHUTE_EN_POINTS) return []
      if (Math.abs(points) / avant < CHUTE_RELATIVE) return []
      /*
       * Et les deux périodes doivent avoir diffusé assez pour être comparables. Une
       * campagne remise en route il y a trois jours n'a pas « baissé » : elle a une
       * moyenne calculée sur trois jours, en face d'une moyenne calculée sur trente.
       */
      if (
        campagne.joursActifs < JOURS_COMPARABLES ||
        campagne.joursActifsAvant < JOURS_COMPARABLES
      ) {
        return []
      }

      return [
        {
          regle: 'ads.roas.chute',
          campagneId: campagne.id,
          priorite: 'surveiller' as const,
          titre: `« ${campagne.nom} » rapporte nettement moins qu’avant`,
          observation:
            `Sur ${contexte.longue.jours} jours, cette campagne a rapporté ${actuel} %, contre` +
            ` ${Math.round(avant)} % sur les ${contexte.longue.jours} jours précédents — une` +
            ` baisse de ${Math.abs(points)} points. Elle a dépensé` +
            ` ${argent(campagne.actuel.cout, contexte.devise)} sur la période, en` +
            ` ${campagne.joursActifs} jours de diffusion contre ${campagne.joursActifsAvant}.`,
          jours: contexte.longue.jours,
          donnees: {
            roas: actuel,
            avant: Math.round(avant),
            points,
            depense: campagne.actuel.cout,
            conversions: campagne.actuel.conversions,
            joursActifs: campagne.joursActifs,
            joursActifsAvant: campagne.joursActifsAvant,
          },
          action: {},
          risque: 'faible' as const,
        },
      ]
    })
}

/** Le budget mensuel que la personne s'est fixé sera dépassé au rythme constaté. */
function budgetDepasse(contexte: ContexteRegles): Constat[] {
  const budget = contexte.lecture.budget
  if (budget === null || budget.projection === null) return []
  if (budget.joursEcoules < JOURS_AVANT_PROJECTION) return []
  if (budget.projection <= budget.budget * DEPASSEMENT_BUDGET) return []

  const ecart = Math.round((budget.projection - budget.budget) * 100) / 100
  return [
    {
      regle: 'ads.budget.depasse',
      campagneId: null,
      priorite: 'surveiller',
      titre: 'Votre budget du mois sera dépassé',
      observation:
        `Vous avez dépensé ${argent(budget.depense, contexte.devise)} en` +
        ` ${budget.joursEcoules} jours sur ${budget.joursDuMois}. À ce rythme, le mois se` +
        ` terminera à ${argent(budget.projection, contexte.devise)}, soit` +
        ` ${argent(ecart, contexte.devise)} de plus que les` +
        ` ${argent(budget.budget, contexte.devise)} que vous vous êtes fixés.`,
      jours: budget.joursEcoules,
      donnees: {
        budget: budget.budget,
        depense: budget.depense,
        projection: budget.projection,
        ecart,
        joursEcoules: budget.joursEcoules,
        joursDuMois: budget.joursDuMois,
      },
      action: {},
      risque: 'faible',
    },
  ]
}

/** Une campagne active qui ne s'affiche plus du tout. */
function dormante(contexte: ContexteRegles): Constat[] {
  return contexte.courte.campagnes
    .filter(
      (campagne) => campagne.statut === 'ENABLED' && campagne.actuel.impressions === 0,
    )
    .map((campagne) => ({
      regle: 'ads.campagne.dormante',
      campagneId: campagne.id,
      priorite: 'information' as const,
      titre: `« ${campagne.nom} » est active mais ne s’affiche plus`,
      observation:
        `Cette campagne est activée chez Google, mais elle n'a été affichée aucune fois` +
        ` depuis ${contexte.courte.jours} jours. C'est le plus souvent le signe d'annonces` +
        ' refusées, d’un budget à zéro, ou d’un ciblage devenu trop étroit pour trouver du' +
        ' monde.',
      jours: contexte.courte.jours,
      donnees: { impressions: 0, statut: campagne.statut, budget: campagne.budget },
      action: {},
      risque: 'faible' as const,
    }))
}

/** Le coût par vente s'écarte de ce que la personne accepte de payer. */
function deriveCpa(contexte: ContexteRegles): Constat[] {
  const cible = contexte.lecture.cpaCible
  if (cible === null) return []

  return pesantes(contexte.longue)
    .filter(
      (campagne) =>
        campagne.actuel.cpa !== null &&
        campagne.actuel.conversions >= CONVERSIONS_MINIMALES &&
        campagne.actuel.cpa > cible * DERIVE_CPA,
    )
    .map((campagne) => ({
      regle: 'ads.cpa.derive',
      campagneId: campagne.id,
      priorite: 'surveiller' as const,
      titre: `« ${campagne.nom} » coûte plus cher par vente que prévu`,
      observation:
        `Chaque vente de cette campagne vous a coûté` +
        ` ${argent(campagne.actuel.cpa ?? 0, contexte.devise)} sur` +
        ` ${contexte.longue.jours} jours, alors que vous avez fixé votre maximum à` +
        ` ${argent(cible, contexte.devise)}. Elle a produit` +
        ` ${campagne.actuel.conversions} ventes pour` +
        ` ${argent(campagne.actuel.cout, contexte.devise)}.`,
      jours: contexte.longue.jours,
      donnees: {
        cpa: campagne.actuel.cpa,
        cible,
        depense: campagne.actuel.cout,
        conversions: campagne.actuel.conversions,
      },
      action: {},
      risque: 'faible' as const,
    }))
}

const REGLES: ReadonlyArray<(contexte: ContexteRegles) => Constat[]> = [
  comptePerte,
  campagnePerte,
  sansConversion,
  budgetLimite,
  chuteRoas,
  budgetDepasse,
  deriveCpa,
  dormante,
  termeParasite,
]

const RANG: Record<Priorite, number> = {
  urgent: 0,
  opportunite: 1,
  surveiller: 2,
  information: 3,
}

/**
 * Un terme qui a coûté ce que vaut une vente, sans rien vendre.
 *
 * La règle la plus rentable du lot, et la plus tardive : elle vise l'argent qui part sans
 * qu'on l'ait choisi. En correspondance d'expression, Google diffuse aussi sur les variantes
 * qu'il juge proches — « bougie citrine » peut servir « bougie parfumée pas chère », et
 * celle-là ne vendra jamais une bougie suisse à quarante francs.
 *
 * **Un seul terme par campagne à la fois**, et ce n'est pas une limite technique : les
 * recommandations sont classées par règle et par campagne, et surtout une liste de quinze
 * exclusions à valider ne se lit pas. Le pire terme d'abord ; le suivant réapparaîtra demain,
 * une fois celui-ci traité. L'observation dit combien il y en a derrière, pour qu'on sache
 * que la liste n'est pas finie.
 *
 * **Silencieuse sans marge.** Sans coût par vente acceptable, il n'existe aucun seuil qui ne
 * soit pas inventé — et la doctrine de ce fichier est de se taire plutôt que d'emprunter une
 * moyenne de marché à personne en particulier.
 */
function termeParasite(contexte: ContexteRegles): Constat[] {
  const acceptable = cpaAcceptable(contexte.profil)
  if (acceptable <= 0) return []
  const seuil = acceptable * GACHIS_PAR_TERME

  const parCampagne = new Map<string, TermeVu[]>()
  for (const terme of contexte.termes) {
    if (terme.conversions > 0 || terme.cout < seuil) continue
    const liste = parCampagne.get(terme.campagneId) ?? []
    liste.push(terme)
    parCampagne.set(terme.campagneId, liste)
  }

  return [...parCampagne.values()].map((liste) => {
    const tries = [...liste].sort((une, autre) => autre.cout - une.cout)
    const pire = tries[0] as TermeVu
    const autres = tries.length - 1
    const total = tries.reduce((somme, un) => somme + un.cout, 0)

    return {
      regle: 'ads.terme.parasite',
      campagneId: pire.campagneId,
      priorite: 'opportunite' as const,
      titre: `« ${pire.terme} » coûte sans vendre`,
      observation:
        `Dans « ${pire.campagneNom} », ce terme a été tapé et cliqué ${pire.clics} fois pour` +
        ` ${argent(pire.cout, contexte.devise)}, sans aucune vente — alors qu'une vente peut` +
        ` vous coûter ${argent(acceptable, contexte.devise)} au maximum.` +
        (autres === 0
          ? ''
          : ` ${autres} autre${autres > 1 ? 's' : ''} terme${autres > 1 ? 's' : ''} dans le` +
            ` même cas, pour ${argent(total - pire.cout, contexte.devise)} de plus : ils` +
            ' apparaîtront une fois celui-ci traité.') +
        ' L’exclure empêche vos annonces de sortir sur cette recherche, sans toucher au reste.',
      jours: contexte.longue.jours,
      donnees: {
        terme: pire.terme,
        cout: pire.cout,
        clics: pire.clics,
        conversions: 0,
        autres,
      },
      /*
       * Le terme voyage dans l'action, et non seulement dans l'observation : c'est lui que
       * le serveur enverra à Google. Le relire dans une phrase serait une occasion de se
       * tromper de mot.
       */
      action: { type: 'exclusion', campagne: pire.campagneId, terme: pire.terme },
      risque: 'faible' as const,
    }
  })
}

/**
 * Tous les constats d'un compte, dédoublonnés et classés.
 *
 * Une campagne déjà signalée comme perdante n'a pas besoin de l'être une seconde fois parce
 * que son coût par vente dépasse la cible : c'est le même argent et le même problème, dit
 * deux fois. Une liste qui répète est une liste qu'on cesse de lire.
 */
export function evaluer(contexte: ContexteRegles): Constat[] {
  const constats = REGLES.flatMap((regle) => regle(contexte))

  const perdantes = new Set(
    constats
      .filter((constat) => constat.regle === 'ads.campagne.perte' && constat.campagneId !== null)
      .map((constat) => constat.campagneId),
  )

  return constats
    .filter(
      (constat) =>
        !(constat.regle === 'ads.cpa.derive' && perdantes.has(constat.campagneId)) &&
        !(constat.regle === 'ads.roas.chute' && perdantes.has(constat.campagneId)),
    )
    .sort((a, b) => RANG[a.priorite] - RANG[b.priorite] || a.regle.localeCompare(b.regle))
}
