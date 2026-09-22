import type { ProfilAds } from './profil'
import type { LigneMeta, VueMeta } from './tableau-meta'

/**
 * Ce qui déclenche une recommandation chez MIRA, et pourquoi c'est du code.
 *
 * Même raison que pour Naya, et elle n'a pas changé : un modèle de langage à qui l'on donne
 * un tableau de chiffres en sort des conseils plausibles. Plausibles, c'est exactement le
 * problème — il conclurait sur deux journées, inventerait un seuil quand la marge manque, et
 * ne dirait jamais deux fois la même chose devant les mêmes chiffres. Une recommandation
 * publicitaire décide d'une dépense réelle : elle doit être reproductible, contestable, et
 * adossée à une condition qu'on peut lire.
 *
 * Ce que ces règles ont de propre à Meta tient en une phrase : **une audience se lasse**.
 * Chez Google, on paie une intention déjà formée — une requête ne se fatigue pas de rien.
 * Chez Meta, on interrompt, et la même personne finit par voir la même image pour la
 * cinquième fois. Cela se lit dans les chiffres avant de se lire dans les ventes : la
 * fréquence monte, le taux de clic baisse, le coût des mille affichages monte parce que Meta
 * doit insister davantage. C'est la première règle du fichier, et c'est celle qui justifie
 * que MIRA existe à côté de Naya.
 *
 * Quatre principes, repris tels quels.
 *
 * **Aucune règle ne se prononce sans matière.** Chacune porte ses planchers.
 *
 * **Rien ne se juge sans objectif.** Sans ROAS visé ni coût par vente acceptable, les règles
 * de rentabilité se taisent plutôt que d'emprunter une moyenne de marché à personne.
 *
 * **Un constat porte ses chiffres.** `donnees` conserve ce qui l'a déclenché : c'est ce qui
 * permet de dire non.
 *
 * **Une action proposée n'est pas une action faite.** `action` décrit ce qu'il faudrait
 * envoyer à Meta, sous une forme que le serveur saura exécuter le jour où la personne le
 * demandera. Aujourd'hui, rien ne l'exécute.
 */

export type Priorite = 'urgent' | 'surveiller' | 'opportunite' | 'information'
export type Risque = 'faible' | 'moyen' | 'eleve'
export type NiveauCible = 'campagne' | 'ensemble' | 'annonce'

/**
 * Un constat, en quatre temps.
 *
 * La séparation est demandée par l'usage, pas par l'esthétique. « Votre fréquence est à 4,2 »
 * ne fait agir personne ; « votre fréquence est à 4,2, donc les mêmes personnes voient la
 * même image quatre fois, donc votre coût par vente va continuer de monter, donc changez de
 * visuel » fait agir. Les quatre parties sont écrites par le code — MIRA les reformulera
 * dans ses mots quand on le lui demandera, sans rien y ajouter.
 */
export type ConstatMeta = {
  regle: string
  /** L'identifiant interne de la campagne concernée, pour le lien. */
  campagneId: string | null
  niveau: NiveauCible
  /** Le nom de l'objet visé, tel qu'il s'affiche. */
  cible: string
  /** Son identifiant interne : c'est lui que portera l'action. */
  cibleId: string
  priorite: Priorite
  titre: string
  /** Ce qui est constaté. Des faits, des chiffres, rien d'autre. */
  observation: string
  /** Pourquoi cela se produit. Le mécanisme, pas une supposition sur l'intention. */
  pourquoi: string
  /** Ce qu'il arrive si l'on ne fait rien. Jamais une promesse chiffrée. */
  consequence: string
  /** Ce qu'on propose, en français. L'action exécutable est dans `action`. */
  recommandation: string
  jours: number
  donnees: Record<string, number | string | null>
  action: Record<string, string | number>
  risque: Risque
}

export type ContexteMeta = {
  devise: string
  profil: ProfilAds
  vue: VueMeta
}

/*
 * Les planchers, au même endroit pour être discutables d'un coup d'œil : ce sont eux qui
 * décident de ce dont on parle et de ce qu'on laisse passer.
 */

/** En deçà, une ligne n'a pas assez dépensé pour mériter qu'on en parle. */
const DEPENSE_MINIMALE = 30

/** En deçà, un taux calculé sur si peu d'affichages est du bruit. */
const IMPRESSIONS_MINIMALES = 2_000

/** En deçà, un coût par vente ou un ROAS repose sur trop peu de ventes. */
const VENTES_MINIMALES = 3

/**
 * La fréquence à partir de laquelle une audience commence à se lasser.
 *
 * Trois. Le chiffre est le nôtre et il est discutable ; le mécanisme ne l'est pas. Au-delà,
 * la même personne a vu la même publicité trois fois, et chaque affichage supplémentaire
 * coûte autant en rapportant moins. On ne s'en sert jamais seul : voir `fatigue`.
 */
const FREQUENCE_LASSITUDE = 3

/** La baisse de taux de clic qui, jointe à la fréquence, signe la lassitude. */
const CHUTE_CTR = 0.15

/** La hausse de coût des mille affichages qui mérite d'être dite. */
const HAUSSE_CPM = 0.25

/** Une chute de ROAS se signale quand elle est à la fois relative et large. */
const CHUTE_ROAS_RELATIVE = 0.25
const CHUTE_ROAS_POINTS = 30

/** Au-delà de ce dépassement, le coût par vente s'écarte vraiment de la cible. */
const DERIVE_CPA = 1.25

/** En deçà de ce multiple du ROAS du compte, une annonce est nettement au-dessus. */
const CREATIVE_GAGNANTE = 1.4

/** La part de la dépense au-delà de laquelle une ligne pèse assez pour alerter. */
const PART_MINIMALE = 15

function argent(valeur: number, devise: string): string {
  return `${valeur.toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

/** Les lignes qui ont assez dépensé et assez été vues pour qu'on en juge. */
function matieres(lignes: readonly LigneMeta[]): LigneMeta[] {
  return lignes.filter(
    (ligne) =>
      ligne.actuel.cout >= DEPENSE_MINIMALE &&
      ligne.actuel.impressions >= IMPRESSIONS_MINIMALES,
  )
}

/** Un objectif est-il posé ? Sans cela, les règles de rentabilité se taisent. */
function vise(profil: ProfilAds): boolean {
  return profil.roasCible > 0 || profil.cpaCible > 0
}

// ─────────────────────────────── Les règles ──────────────────────────────────

/**
 * La fatigue publicitaire : la règle qui n'existe que chez Meta.
 *
 * Trois signaux ensemble, jamais un seul. La fréquence seule ne dit rien — une campagne de
 * notoriété peut viser la répétition. Le taux de clic seul baisse pour dix raisons. Le coût
 * des mille affichages seul monte quand la concurrence s'anime, à Noël comme au solde. Les
 * trois en même temps, sur la même annonce, ne laissent qu'une explication : les mêmes
 * personnes revoient la même image et n'y réagissent plus, et Meta doit payer plus cher pour
 * continuer de la leur montrer.
 *
 * C'est aussi pourquoi cette règle ne demande aucun objectif : elle ne juge pas la
 * rentabilité, elle constate un mécanisme.
 */
function fatigue(contexte: ContexteMeta): ConstatMeta[] {
  const { vue, devise } = contexte
  return matieres(vue.annonces).flatMap((annonce) => {
    const frequence = annonce.actuel.frequence
    if (frequence < FREQUENCE_LASSITUDE) return []

    const ctr = annonce.actuel.ctr
    const ctrAvant = annonce.precedent.ctr
    if (ctr === null || ctrAvant === null || ctrAvant <= 0) return []
    if ((ctrAvant - ctr) / ctrAvant < CHUTE_CTR) return []

    const cpm = annonce.actuel.cpm
    const cpmAvant = annonce.precedent.cpm
    if (cpm === null || cpmAvant === null || cpmAvant <= 0) return []
    if ((cpm - cpmAvant) / cpmAvant < HAUSSE_CPM) return []

    return [
      {
        regle: 'meta.creative.fatigue',
        campagneId: null,
        niveau: 'annonce' as const,
        cible: annonce.nom,
        cibleId: annonce.id,
        priorite: 'urgent' as const,
        titre: `« ${annonce.nom} » fatigue son audience`,
        observation:
          `Sur ${vue.jours} jours, chaque personne a vu cette publicité ${frequence} fois en` +
          ` moyenne. Son taux de clic est passé de ${ctrAvant} % à ${ctr} %, et le coût des` +
          ` mille affichages de ${argent(cpmAvant, devise)} à ${argent(cpm, devise)}.`,
        pourquoi:
          'Les trois signaux vont ensemble, et c’est ce qui les rend lisibles : les mêmes ' +
          'personnes revoient la même image, elles n’y réagissent plus, et Meta doit payer ' +
          'plus cher pour continuer de la leur montrer.',
        consequence:
          'Sans changement, la dépense continue en produisant de moins en moins de clics, ' +
          'et le coût par vente monte sans que la publicité soit devenue mauvaise.',
        recommandation:
          'Changez le visuel ou le texte de cette publicité, ou élargissez l’audience de ' +
          'son ensemble pour renouveler les personnes touchées.',
        jours: vue.jours,
        donnees: {
          frequence,
          ctr,
          ctrAvant,
          cpm,
          cpmAvant,
          depense: annonce.actuel.cout,
        },
        action: { type: 'pause-annonce', annonce: annonce.id },
        risque: 'moyen' as const,
      },
    ]
  })
}

/** Une ligne qui dépense sans qu'aucune vente ne lui soit attribuée. */
function sansVente(contexte: ContexteMeta): ConstatMeta[] {
  const { vue, devise } = contexte
  if (!vise(contexte.profil)) return []

  /*
   * Au niveau des ensembles, et non des campagnes : chez Meta, c'est là que vit le budget,
   * donc c'est là que se met la pause. Remonter à la campagne éteindrait aussi ce qui marche.
   */
  return matieres(vue.ensembles)
    .filter((ensemble) => ensemble.actuel.conversions === 0)
    .map((ensemble) => ({
      regle: 'meta.sans.vente',
      campagneId: null,
      niveau: 'ensemble' as const,
      cible: ensemble.nom,
      cibleId: ensemble.id,
      priorite: 'urgent' as const,
      titre: `« ${ensemble.nom} » dépense sans aucune vente`,
      observation:
        `Sur ${vue.jours} jours, cet ensemble a dépensé ${argent(ensemble.actuel.cout, devise)}` +
        ` pour ${ensemble.actuel.clics} clics, sans qu’aucune vente ne lui soit attribuée.`,
      pourquoi:
        'Trois causes possibles, et elles ne se corrigent pas de la même façon : l’audience ' +
        'ne correspond pas à l’offre, la page d’arrivée ne convertit pas, ou le suivi des ' +
        'achats ne remonte pas à Meta.',
      consequence:
        'Chaque jour qui passe reproduit la même dépense pour le même résultat.',
      recommandation:
        'Vérifiez d’abord que vos achats remontent bien dans Meta — une vente non comptée ' +
        'ressemble exactement à une vente inexistante. Si le suivi fonctionne, mettez cet ' +
        'ensemble en pause.',
      jours: vue.jours,
      donnees: {
        depense: ensemble.actuel.cout,
        clics: ensemble.actuel.clics,
        impressions: ensemble.actuel.impressions,
        conversions: 0,
      },
      action: { type: 'pause-ensemble', ensemble: ensemble.id },
      risque: 'moyen' as const,
    }))
}

/** Un ROAS qui décroche par rapport à la période précédente. */
function chuteRoas(contexte: ContexteMeta): ConstatMeta[] {
  const { vue } = contexte
  if (!vise(contexte.profil)) return []

  return matieres(vue.campagnes)
    .filter((campagne) => campagne.actuel.conversions >= VENTES_MINIMALES)
    .flatMap((campagne) => {
      const points = campagne.ecarts.roas
      const actuel = campagne.actuel.roas
      if (points === null || actuel === null || points >= 0) return []
      const avant = actuel - points
      if (avant <= 0) return []
      /*
       * Les deux conditions ensemble : une chute de vingt points sur un ROAS de mille n'est
       * pas un événement, et une chute de moitié sur un ROAS de vingt n'en est pas un non plus.
       */
      if (Math.abs(points) < CHUTE_ROAS_POINTS) return []
      if (Math.abs(points) / avant < CHUTE_ROAS_RELATIVE) return []

      return [
        {
          regle: 'meta.roas.chute',
          campagneId: campagne.id,
          niveau: 'campagne' as const,
          cible: campagne.nom,
          cibleId: campagne.id,
          priorite: 'surveiller' as const,
          titre: `Le retour de « ${campagne.nom} » recule`,
          observation:
            `Sur ${vue.jours} jours, le retour de cette campagne est passé de ${avant} % à` +
            ` ${actuel} %, soit ${Math.abs(points)} points de moins que la période précédente.`,
          pourquoi:
            'Un retour qui recule vient soit d’une audience qui s’épuise, soit d’une ' +
            'concurrence qui s’est renforcée sur le même public, soit d’une offre qui ' +
            'convertit moins bien qu’avant.',
          consequence:
            'Au rythme actuel, chaque franc dépensé rapporte moins que la semaine dernière.',
          recommandation:
            'Regardez les annonces de cette campagne : si l’une d’elles fatigue son ' +
            'audience, c’est souvent elle qui tire l’ensemble vers le bas.',
          jours: vue.jours,
          donnees: {
            roas: actuel,
            roasAvant: avant,
            points,
            depense: campagne.actuel.cout,
            ventes: campagne.actuel.conversions,
          },
          action: {},
          risque: 'faible' as const,
        },
      ]
    })
}

/** Un coût par vente qui s'écarte nettement de la cible. */
function deriveCpa(contexte: ContexteMeta): ConstatMeta[] {
  const { vue, devise, profil } = contexte
  const cible = profil.cpaCible
  if (cible <= 0) return []

  return matieres(vue.ensembles)
    .filter((ensemble) => ensemble.actuel.conversions >= VENTES_MINIMALES)
    .flatMap((ensemble) => {
      const cpa = ensemble.actuel.cpa
      if (cpa === null || cpa <= cible * DERIVE_CPA) return []
      const ecart = Math.round(((cpa - cible) / cible) * 100)

      return [
        {
          regle: 'meta.cpa.derive',
          campagneId: null,
          niveau: 'ensemble' as const,
          cible: ensemble.nom,
          cibleId: ensemble.id,
          priorite: 'surveiller' as const,
          titre: `« ${ensemble.nom} » vend trop cher`,
          observation:
            `Sur ${vue.jours} jours, chaque vente de cet ensemble a coûté` +
            ` ${argent(cpa, devise)}, soit ${ecart} % de plus que les ${argent(cible, devise)}` +
            ' que vous vous êtes fixés.',
          pourquoi:
            'Le coût par vente monte quand l’audience coûte plus cher à atteindre, ou quand ' +
            'elle clique autant mais achète moins.',
          consequence:
            'Cet ensemble consomme une part du budget pour des ventes qui rapportent moins ' +
            'que ce que vous aviez prévu.',
          recommandation:
            'Comparez-le aux autres ensembles de la même campagne : si l’un d’eux tient ' +
            'votre objectif, c’est vers lui que le budget doit aller.',
          jours: vue.jours,
          donnees: {
            cpa,
            cible,
            ecart,
            depense: ensemble.actuel.cout,
            ventes: ensemble.actuel.conversions,
          },
          action: {},
          risque: 'faible' as const,
        },
      ]
    })
}

/**
 * Une créative nettement au-dessus de la moyenne du compte.
 *
 * La seule règle qui annonce une bonne nouvelle, et elle a sa raison d'être : un tableau de
 * bord qui ne signale que les problèmes apprend à ne chercher que des problèmes. Ce qui
 * marche mérite d'être vu, parce que c'est là qu'il y a quelque chose à reproduire.
 *
 * Elle est prudente à dessein — `CREATIVE_GAGNANTE` demande un écart net, et les planchers
 * de matière s'appliquent. Attribuer un résultat à une créative sur douze affichages serait
 * une coïncidence présentée comme une découverte.
 */
function creativeGagnante(contexte: ContexteMeta): ConstatMeta[] {
  const { vue, devise } = contexte
  const reference = vue.total.roas
  if (reference === null || reference <= 0) return []
  if (!vise(contexte.profil)) return []

  return matieres(vue.annonces)
    .filter((annonce) => annonce.actuel.conversions >= VENTES_MINIMALES)
    .flatMap((annonce) => {
      const roas = annonce.actuel.roas
      if (roas === null || roas < reference * CREATIVE_GAGNANTE) return []

      return [
        {
          regle: 'meta.creative.gagnante',
          campagneId: null,
          niveau: 'annonce' as const,
          cible: annonce.nom,
          cibleId: annonce.id,
          priorite: 'opportunite' as const,
          titre: `« ${annonce.nom} » fonctionne nettement mieux que les autres`,
          observation:
            `Sur ${vue.jours} jours, cette publicité a rapporté ${roas} % de ce qu’elle a` +
            ` coûté, contre ${reference} % pour l’ensemble de votre compte, avec` +
            ` ${annonce.actuel.conversions} ventes pour ${argent(annonce.actuel.cout, devise)}.`,
          pourquoi:
            'Un écart de cette ampleur tient rarement au hasard : quelque chose dans ce ' +
            'visuel ou dans ce texte parle mieux à votre audience que le reste.',
          consequence:
            'Tant qu’elle reste une publicité parmi d’autres, elle ne reçoit qu’une part du ' +
            'budget — et elle finira par fatiguer son audience comme les autres.',
          recommandation:
            'Déclinez-la : reprenez son angle dans deux ou trois variantes, pour continuer ' +
            'd’en profiter quand celle-ci s’essoufflera.',
          jours: vue.jours,
          donnees: {
            roas,
            roasCompte: reference,
            ventes: annonce.actuel.conversions,
            depense: annonce.actuel.cout,
          },
          action: {},
          risque: 'faible' as const,
        },
      ]
    })
}

/**
 * Un ensemble qui prend la plus grosse part du budget sans être le meilleur.
 *
 * Le constat n'est pas « il est mauvais » mais « il est cher pour ce qu'il rend, et c'est
 * lui qui mange ». Le geste qui suit n'est pas une pause mais un rééquilibrage, et cette
 * nuance décide de ce qu'on propose.
 */
function budgetMalPlace(contexte: ContexteMeta): ConstatMeta[] {
  const { vue, devise } = contexte
  if (!vise(contexte.profil)) return []

  const jugeables = matieres(vue.ensembles).filter(
    (ensemble) => ensemble.actuel.conversions >= VENTES_MINIMALES,
  )
  if (jugeables.length < 2) return []

  const total = jugeables.reduce((somme, un) => somme + un.actuel.cout, 0)
  if (total <= 0) return []

  const meilleur = jugeables.reduce((a, b) =>
    (b.actuel.roas ?? 0) > (a.actuel.roas ?? 0) ? b : a,
  )

  return jugeables.flatMap((ensemble) => {
    if (ensemble.id === meilleur.id) return []
    const part = Math.round((ensemble.actuel.cout / total) * 100)
    if (part < PART_MINIMALE) return []
    if (ensemble.actuel.cout <= meilleur.actuel.cout) return []

    const sien = ensemble.actuel.roas
    const autre = meilleur.actuel.roas
    if (sien === null || autre === null || sien >= autre) return []

    return [
      {
        regle: 'meta.budget.mal.place',
        campagneId: null,
        niveau: 'ensemble' as const,
        cible: ensemble.nom,
        cibleId: ensemble.id,
        priorite: 'surveiller' as const,
        titre: `Le budget va surtout à « ${ensemble.nom} », qui rend moins`,
        observation:
          `Sur ${vue.jours} jours, cet ensemble a pris ${part} % de la dépense pour un retour` +
          ` de ${sien} %, alors que « ${meilleur.nom} » rend ${autre} % en dépensant` +
          ` ${argent(meilleur.actuel.cout, devise)}.`,
        pourquoi:
          'Meta répartit le budget selon ce qu’il anticipe, pas selon ce que vous avez ' +
          'constaté : un ensemble lancé plus tôt, ou dont l’audience est plus large, capte ' +
          'souvent la dépense avant que les résultats ne soient comparables.',
        consequence:
          'La majeure partie de votre budget travaille moins bien qu’une part minoritaire.',
        recommandation:
          'Envisagez de déplacer une partie du budget vers l’ensemble qui rend le plus, par ' +
          'paliers, sans tout basculer d’un coup.',
        jours: vue.jours,
        donnees: {
          part,
          roas: sien,
          roasMeilleur: autre,
          depense: ensemble.actuel.cout,
          depenseMeilleur: meilleur.actuel.cout,
        },
        action: {},
        risque: 'moyen' as const,
      },
    ]
  })
}

/** Le coût des mille affichages qui monte franchement, sans autre signal. */
function cpmEnHausse(contexte: ContexteMeta): ConstatMeta[] {
  const { vue, devise } = contexte
  return matieres(vue.campagnes).flatMap((campagne) => {
    const cpm = campagne.actuel.cpm
    const avant = campagne.precedent.cpm
    if (cpm === null || avant === null || avant <= 0) return []
    const hausse = (cpm - avant) / avant
    if (hausse < HAUSSE_CPM) return []

    return [
      {
        regle: 'meta.cpm.hausse',
        campagneId: campagne.id,
        niveau: 'campagne' as const,
        cible: campagne.nom,
        cibleId: campagne.id,
        priorite: 'information' as const,
        titre: `Atteindre votre audience coûte plus cher sur « ${campagne.nom} »`,
        observation:
          `Sur ${vue.jours} jours, les mille affichages sont passés de ${argent(avant, devise)}` +
          ` à ${argent(cpm, devise)}, soit ${Math.round(hausse * 100)} % de plus.`,
        pourquoi:
          'Le prix des enchères monte quand davantage d’annonceurs visent le même public — ' +
          'périodes de fêtes, soldes, rentrée — ou quand votre audience se rétrécit.',
        consequence:
          'À budget égal, vous touchez moins de monde qu’avant. Si le taux de clic tient, ' +
          'ce n’est pas un défaut de vos publicités : c’est le marché.',
        recommandation:
          'Rien à faire dans l’immédiat. Surveillez le coût par vente : c’est lui qui dira ' +
          'si la hausse des enchères vous coûte réellement quelque chose.',
        jours: vue.jours,
        donnees: { cpm, cpmAvant: avant, hausse: Math.round(hausse * 100) },
        action: {},
        risque: 'faible' as const,
      },
    ]
  })
}

const REGLES: Array<(contexte: ContexteMeta) => ConstatMeta[]> = [
  fatigue,
  sansVente,
  chuteRoas,
  deriveCpa,
  budgetMalPlace,
  creativeGagnante,
  cpmEnHausse,
]

const RANG: Record<Priorite, number> = {
  urgent: 0,
  surveiller: 1,
  opportunite: 2,
  information: 3,
}

/**
 * Tous les constats d'un compte, dédoublonnés et classés.
 *
 * Un ensemble déjà signalé comme dépensant sans vente n'a pas besoin de l'être une seconde
 * fois parce que son coût par vente dépasse la cible — c'est le même argent et le même
 * problème, dit deux fois. Une liste qui répète est une liste qu'on cesse de lire.
 */
export function evaluerMeta(contexte: ContexteMeta): ConstatMeta[] {
  const constats = REGLES.flatMap((regle) => regle(contexte))

  const muets = new Set(
    constats.filter((constat) => constat.regle === 'meta.sans.vente').map((une) => une.cibleId),
  )

  return constats
    .filter(
      (constat) =>
        !(constat.regle === 'meta.cpa.derive' && muets.has(constat.cibleId)) &&
        !(constat.regle === 'meta.budget.mal.place' && muets.has(constat.cibleId)),
    )
    .sort((a, b) => RANG[a.priorite] - RANG[b.priorite] || a.regle.localeCompare(b.regle))
}
