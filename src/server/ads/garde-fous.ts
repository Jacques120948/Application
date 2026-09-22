import { FACTEUR_MAX, FACTEUR_MIN } from '@/lib/bornes-budget'
import { PAS_FACTURABLE } from '@/lib/pas-facturable'
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

/**
 * Le nombre de textes déposés par jour et par compte.
 *
 * Bien plus haut que les gestes d'argent, et c'est volontaire : ajouter un titre ne dépense
 * rien. Google borne déjà naturellement — quinze titres et quatre descriptions par annonce —
 * et cette limite-ci n'existe que pour arrêter une boucle, pas pour freiner quelqu'un qui
 * remplit ses annonces un samedi matin.
 */
export const TEXTES_PAR_JOUR = 40

/** Ce que Google accepte, en caractères. Un texte plus long est refusé sans être lu. */
const LONGUEURS_ADS: Record<string, number> = { titre: 30, 'titre-long': 90, description: 90 }

/**
 * Ce que Google accepte par contenant, et ce n'est pas la même chose des deux côtés.
 *
 * Une annonce responsive accepte quatre descriptions ; un groupe d'éléments en accepte cinq,
 * et des titres longs en plus. Prendre les bornes de l'un pour l'autre ferait refuser un
 * dépôt légitime, ou pire, en laisser partir un que Google rejetterait.
 */
const PLACES_ADS: Record<string, Record<string, number>> = {
  annonces: { titre: 15, description: 4 },
  elements: { titre: 15, 'titre-long': 5, description: 5 },
}

/**
 * Les bornes d'un dépôt de texte.
 *
 * `places` est le nombre de textes déjà présents dans l'annonce, relu chez Google à
 * l'instant. Pas celui de notre base : entre la lecture hebdomadaire et le dépôt, quelqu'un
 * a pu remplir l'annonce, et déposer le seizième titre ferait refuser l'écriture entière —
 * donc perdre aussi les quinze autres que l'on renvoie avec.
 */
export function autoriseTexte(
  demande: Demande & { textesAujourdhui: number },
  /** annonces | elements : le genre du contenant, qui décide des places disponibles. */
  genre: string,
  champ: string,
  texte: string,
  places: number,
): Verdict {
  if (demande.mode !== 'assiste') {
    return {
      ok: false,
      raison:
        'Ce compte est en lecture seule. Passez-le en mode assisté pour qu’un texte puisse être envoyé à Google.',
    }
  }
  if (demande.textesAujourdhui >= TEXTES_PAR_JOUR) {
    return {
      ok: false,
      raison: `Vous avez déposé ${TEXTES_PAR_JOUR} textes aujourd’hui. Reprenez demain.`,
    }
  }

  const longueur = LONGUEURS_ADS[champ]
  const maximum = (PLACES_ADS[genre] ?? {})[champ]
  if (longueur === undefined || maximum === undefined) {
    return {
      ok: false,
      raison: 'Ce type de texte ne peut pas être déposé dans ce genre de contenant.',
    }
  }
  if (texte.trim() === '' || texte.length > longueur) {
    return {
      ok: false,
      raison: `Google refuse ce ${champ} : ${texte.length} caractères pour ${longueur} au maximum.`,
    }
  }
  if (places >= maximum) {
    return {
      ok: false,
      raison: `Cette annonce a déjà ${places} ${champ}s sur ${maximum} : Google n’en accepte pas davantage. Retirez-en un dans Google Ads avant d’en ajouter.`,
    }
  }
  return { ok: true }
}

/**
 * Ce que Google accepte d'images par groupe d'éléments, **et par format**.
 *
 * Le « et par format » est la leçon d'un vrai refus. Vingt images ne veut pas dire vingt en
 * tout : vingt paysages, vingt carrées, vingt portraits, chacune comptée à part. Et Google
 * vérifie ce compte au rattachement, c'est-à-dire après avoir créé l'image. Un rattachement
 * refusé laisse donc une image dans le compte, rattachée à rien, que l'API ne sait pas
 * supprimer. Compter avant, dans le bon format, est la seule façon de ne pas en semer.
 */
export const IMAGES_PAR_CHAMP = 20

/**
 * Les bornes d'un dépôt d'image.
 *
 * `places` est le nombre d'images **de ce format** déjà rattachées au groupe, relu chez
 * Google à l'instant. `format` est le nom lisible du format, uniquement pour que le refus
 * dise laquelle des trois limites est atteinte — sans quoi « vingt images sur vingt » sur un
 * groupe qui n'en montre que huit passerait pour une erreur d'Evoliia.
 */
export function autoriseImage(
  demande: Demande & { textesAujourdhui: number },
  places: number,
  format: string,
): Verdict {
  if (demande.mode !== 'assiste') {
    return {
      ok: false,
      raison:
        'Ce compte est en lecture seule. Passez-le en mode assisté pour qu’une image puisse être envoyée à Google.',
    }
  }
  if (demande.textesAujourdhui >= TEXTES_PAR_JOUR) {
    return {
      ok: false,
      raison: `Vous avez déposé ${TEXTES_PAR_JOUR} éléments aujourd’hui. Reprenez demain.`,
    }
  }
  if (places >= IMAGES_PAR_CHAMP) {
    return {
      ok: false,
      raison: `Ce groupe porte déjà ${places} images au format ${format} sur ${IMAGES_PAR_CHAMP} : Google compte cette limite format par format et n’en accepte pas davantage. Retirez-en une dans Google Ads avant d’en ajouter.`,
    }
  }
  return { ok: true }
}

/**
 * Les correspondances qu'Evoliia sait déposer.
 *
 * « Large » n'en fait pas partie, et c'est la décision la plus conséquente de ce fichier.
 * Une correspondance large laisse Google choisir les recherches voisines — sur un budget de
 * quelques francs par jour, il le dépense en un matin sur des requêtes que personne n'a
 * validées, et la personne découvre dans son rapport qu'elle a payé pour « bougie
 * anniversaire » en croyant acheter « bougie citrine ». Le jour où quelqu'un veut du large,
 * il le posera dans Google Ads, en connaissance de cause.
 */
export const CORRESPONDANCES = ['phrase', 'exact'] as const

export type Correspondance = (typeof CORRESPONDANCES)[number]

/**
 * Ce qu'un groupe d'annonces peut porter de mots-clés déposés depuis Evoliia.
 *
 * Google en accepte des milliers. La borne n'est donc pas technique : au-delà de quelques
 * dizaines, un groupe d'annonces cesse d'avoir un thème, et ses annonces ne peuvent plus
 * répondre à ce que les gens tapent. C'est un choix de produit, et il se discute.
 */
export const MOTS_CLES_PAR_GROUPE = 30

/** Ce que Google accepte : quatre-vingts caractères, dix mots. */
const LONGUEUR_MOT_CLE = 80
const MOTS_MAX = 10

/**
 * Les bornes d'un dépôt de mot-clé.
 *
 * Un mot-clé ne dépense rien par lui-même : il ouvre une porte. C'est pourquoi il partage le
 * compteur quotidien des textes plutôt que celui des gestes d'argent — mais c'est aussi
 * pourquoi la correspondance est bornée ici et nulle part ailleurs : c'est elle, et non le
 * mot, qui décide de ce que Google s'autorise à acheter.
 */
export function autoriseMotCle(
  demande: Demande & { textesAujourdhui: number },
  texte: string,
  correspondance: string,
  places: number,
): Verdict {
  if (demande.mode !== 'assiste') {
    return {
      ok: false,
      raison:
        'Ce compte est en lecture seule. Passez-le en mode assisté pour qu’un mot-clé puisse être envoyé à Google.',
    }
  }
  if (demande.textesAujourdhui >= TEXTES_PAR_JOUR) {
    return {
      ok: false,
      raison: `Vous avez déposé ${TEXTES_PAR_JOUR} éléments aujourd’hui. Reprenez demain.`,
    }
  }
  if (!(CORRESPONDANCES as readonly string[]).includes(correspondance)) {
    return {
      ok: false,
      raison:
        'Evoliia ne dépose qu’en correspondance exacte ou en expression exacte. La correspondance large laisse Google acheter des recherches voisines que personne n’a validées.',
    }
  }

  const propre = texte.trim().replace(/\s+/gu, ' ')
  if (propre === '' || propre.length > LONGUEUR_MOT_CLE) {
    return {
      ok: false,
      raison: `Google refuse ce mot-clé : ${propre.length} caractères pour ${LONGUEUR_MOT_CLE} au maximum.`,
    }
  }
  if (propre.split(' ').length > MOTS_MAX) {
    return {
      ok: false,
      raison: `Google refuse un mot-clé de plus de ${MOTS_MAX} mots.`,
    }
  }
  /*
   * Les signes de correspondance sont posés par le connecteur d'écriture, pas tapés dans le
   * texte. Les laisser passer ferait acheter le mot-clé « "bougie citrine" » guillemets
   * compris, qui ne correspond à aucune recherche.
   */
  if (/["'\[\]+]/u.test(propre)) {
    return {
      ok: false,
      raison:
        'Un mot-clé ne porte ni guillemets ni crochets : la correspondance se choisit à côté du texte, pas dedans.',
    }
  }
  if (places >= MOTS_CLES_PAR_GROUPE) {
    return {
      ok: false,
      raison: `Ce groupe porte déjà ${places} mots-clés sur ${MOTS_CLES_PAR_GROUPE}. Au-delà, un groupe d’annonces perd son thème et ses annonces ne répondent plus à ce que les gens tapent.`,
    }
  }
  return { ok: true }
}

/**
 * Les campagnes qu'Evoliia crée par jour et par compte.
 *
 * Une. Bien plus bas que tout le reste, et pour une raison qui n'a rien d'arbitraire : créer
 * une campagne est le seul geste du produit qui fabrique une dépense à partir de rien. Les
 * autres ajustent ce qui existe. Quelqu'un qui a besoin d'en créer trois dans la journée a
 * un projet particulier et le fera dans Google Ads ; une boucle qui en crée trois n'a aucun
 * projet du tout.
 */
export const CAMPAGNES_PAR_JOUR = 1

/** Ce qu'une campagne Recherche exige pour exister, et ce qu'elle accepte au maximum. */
export const PLACES_CAMPAGNE = {
  titresMin: 3,
  titresMax: 15,
  descriptionsMin: 2,
  descriptionsMax: 4,
  motsClesMin: 1,
}

/**
 * Le budget quotidien qu'Evoliia accepte de fabriquer, en unités de la devise.
 *
 * Le plancher est celui du bon sens : en dessous d'un franc par jour, Google ne diffuse
 * presque pas et la campagne n'apprend rien. Le plafond absolu existe pour qu'une erreur de
 * saisie — un zéro de trop — ne crée pas une campagne à mille francs par jour ; il ne
 * remplace pas la borne du profil, qui est la vraie, et qui est vérifiée juste après.
 */
export const BUDGET_MIN = 1
export const BUDGET_MAX = 500

/** Les jours d'un mois moyen. Le budget mensuel du profil se compare au quotidien par là. */
const JOURS_DU_MOIS = 30.4

/**
 * Les bornes d'une enchère au clic saisie à la main.
 *
 * Elle est saisie quand Google ne donne pas de prix indicatif — ce qui arrive sur les
 * recherches rares, et sur les comptes dont l'application n'a pas encore l'accès au
 * planificateur. Evoliia ne devine pas à la place de la personne : un chiffre inventé aurait
 * l'air calculé, et elle le prendrait pour une recommandation.
 *
 * Une seule borne dure, et elle n'est pas là où on l'attend. Ce n'est pas le rapport à la
 * marge — la personne connaît son marché mieux qu'un seuil, et un mot-clé très qualifié peut
 * convertir bien au-delà de ce qu'une moyenne prévoit. C'est le rapport au budget
 * quotidien : une enchère supérieure au budget du jour signifie qu'un seul clic peut épuiser
 * la journée entière, ce qui n'est pas une stratégie mais une erreur de saisie.
 */
export function autoriseEnchere(enchereMicros: number, budgetMicros: number): Verdict {
  if (!Number.isFinite(enchereMicros) || enchereMicros <= 0) {
    return { ok: false, raison: 'Indiquez un coût par clic.' }
  }
  /*
   * Google refuse un montant qui n'est pas un multiple de l'unité facturable — le centime.
   * L'appelant arrondit avant d'enregistrer ; ce contrôle existe pour que la règle soit
   * écrite là où vivent toutes les autres, et non seulement dans le chemin qui l'applique.
   */
  if (enchereMicros % PAS_FACTURABLE !== 0) {
    return { ok: false, raison: 'Le coût par clic se règle au centime.' }
  }
  if (enchereMicros > budgetMicros) {
    return {
      ok: false,
      raison:
        'Votre enchère dépasse le budget d’une journée : un seul clic épuiserait la journée entière. Baissez l’enchère, ou montez le budget.',
    }
  }
  return { ok: true }
}

/**
 * Les bornes de la création d'une campagne.
 *
 * C'est le garde-fou le plus sévère du produit, parce que c'est le seul geste qui parte de
 * zéro. Tous les autres modifient quelque chose que la personne a déjà décidé d'avoir ;
 * celui-ci fabrique la décision.
 *
 * `hotes` sont les domaines de la personne — son site, sa boutique. La page d'arrivée doit
 * s'y trouver, et ce n'est pas une politesse : sans cette vérification, Evoliia deviendrait
 * un moyen d'acheter du trafic Google vers n'importe quelle adresse, payé par le compte de
 * quelqu'un d'autre.
 */
export function autoriseCreation(
  demande: Demande & { campagnesAujourdhui: number },
  plan: {
    nom: string
    budgetMicros: number
    urlFinale: string
    motsCles: readonly unknown[]
    titres: readonly string[]
    descriptions: readonly string[]
  },
  hotes: readonly string[],
): Verdict {
  if (demande.mode !== 'assiste') {
    return {
      ok: false,
      raison:
        'Ce compte est en lecture seule. Passez-le en mode assisté pour qu’une campagne puisse être créée.',
    }
  }
  if (demande.campagnesAujourdhui >= CAMPAGNES_PAR_JOUR) {
    return {
      ok: false,
      raison: `Evoliia ne crée qu’une campagne par jour. C’est le seul geste qui fabrique une dépense à partir de rien, et il mérite une nuit de réflexion.`,
    }
  }
  if (plan.nom.trim() === '' || plan.nom.length > 120) {
    return { ok: false, raison: 'Le nom de la campagne doit tenir en 120 caractères.' }
  }

  const budget = plan.budgetMicros / 1_000_000
  if (budget < BUDGET_MIN || budget > BUDGET_MAX) {
    return {
      ok: false,
      raison: `Le budget quotidien doit être compris entre ${BUDGET_MIN} et ${BUDGET_MAX} ${demande.devise}. En dessous, Google ne diffuse presque pas ; au-dessus, Evoliia préfère que vous le régliez vous-même dans Google Ads.`,
    }
  }
  /*
   * La borne qui compte vraiment. Le budget mensuel du profil est ce que la personne a dit
   * pouvoir dépenser en tout : une campagne neuve qui le consomme entièrement priverait
   * celles qui tournent déjà, et personne ne l'aurait demandé.
   */
  if (demande.profil.budgetMensuel > 0) {
    const quotidienMax = demande.profil.budgetMensuel / JOURS_DU_MOIS
    if (budget > quotidienMax) {
      return {
        ok: false,
        raison: `Votre budget mensuel est de ${demande.profil.budgetMensuel} ${demande.devise}, soit ${quotidienMax.toFixed(2)} ${demande.devise} par jour pour l’ensemble de vos campagnes. Ce budget-ci les dépasserait à lui seul.`,
      }
    }
  }

  /*
   * L'adresse d'arrivée doit être chez la personne. Sans cette vérification, Evoliia serait
   * un moyen d'acheter du trafic Google vers n'importe quelle page, payé par le compte de
   * quelqu'un d'autre.
   */
  let hote = ''
  try {
    const adresse = new URL(plan.urlFinale)
    if (adresse.protocol !== 'https:') {
      return { ok: false, raison: 'La page d’arrivée doit être en HTTPS.' }
    }
    hote = adresse.hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return { ok: false, raison: 'La page d’arrivée n’est pas une adresse valide.' }
  }
  const permis = hotes.map((un) => un.toLowerCase().replace(/^www\./u, '')).filter((un) => un !== '')
  /*
   * Les sous-domaines passent : qui possède cap-nature.ch possède boutique.cap-nature.ch.
   * La comparaison porte sur le point qui précède, sans quoi « faux-cap-nature.ch » serait
   * accepté pour « cap-nature.ch » — c'est toute la différence entre un suffixe et un
   * sous-domaine.
   */
  const chezElle = permis.some((un) => hote === un || hote.endsWith(`.${un}`))
  if (!chezElle) {
    return {
      ok: false,
      raison: `La page d’arrivée doit être sur un de vos domaines${permis.length === 0 ? '' : ` (${permis.join(', ')})`}. Evoliia n’achète pas de trafic vers une adresse qui n’est pas la vôtre.`,
    }
  }

  if (plan.motsCles.length < PLACES_CAMPAGNE.motsClesMin) {
    return {
      ok: false,
      raison: 'Une campagne Recherche sans mot-clé ne diffuse sur rien.',
    }
  }
  if (plan.motsCles.length > MOTS_CLES_PAR_GROUPE) {
    return {
      ok: false,
      raison: `Un groupe d’annonces ne prend pas plus de ${MOTS_CLES_PAR_GROUPE} mots-clés : au-delà, il perd son thème.`,
    }
  }

  const textes = (
    liste: readonly string[],
    champ: 'titre' | 'description',
    minimum: number,
    maximum: number,
  ): Verdict => {
    if (liste.length < minimum) {
      return {
        ok: false,
        raison: `Google exige au moins ${minimum} ${champ}s pour une annonce responsive. En dessous, il la refuse et le groupe n’a rien à diffuser.`,
      }
    }
    if (liste.length > maximum) {
      return { ok: false, raison: `Google n’accepte pas plus de ${maximum} ${champ}s.` }
    }
    const longueur = LONGUEURS_ADS[champ] ?? 0
    for (const texte of liste) {
      if (texte.trim() === '' || texte.length > longueur) {
        return {
          ok: false,
          raison: `Google refuse ce ${champ} : ${texte.length} caractères pour ${longueur} au maximum.`,
        }
      }
    }
    return { ok: true }
  }

  const verdictTitres = textes(
    plan.titres,
    'titre',
    PLACES_CAMPAGNE.titresMin,
    PLACES_CAMPAGNE.titresMax,
  )
  if (!verdictTitres.ok) return verdictTitres
  return textes(
    plan.descriptions,
    'description',
    PLACES_CAMPAGNE.descriptionsMin,
    PLACES_CAMPAGNE.descriptionsMax,
  )
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
