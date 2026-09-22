import { AppError } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { useOAuthAccess } from '@/server/integrations/service'
import {
  listerProprietes,
  parJour,
  rafraichir,
  requetes,
  type JourRecherche,
  type Ligne,
} from '@/server/integrations/providers/google-search-console'
import { choisirPropriete, JOURS_LUS, SEARCH_CONSOLE_FEATURE } from './recherches'

/**
 * Le trafic naturel dans le temps, et ce qui a bougé dedans.
 *
 * Evoliia mesurait déjà la publicité jour par jour et savait tout dire d'un franc dépensé.
 * Du trafic qu'on ne paie pas, elle ne montrait qu'une photographie : les chiffres du jour,
 * sans le chemin qui y mène. Or c'est le chemin qui répond à la seule question qu'on se pose
 * devant ces nombres — est-ce que ça monte ?
 *
 * Deux sources, et leur partage n'est pas arbitraire.
 *
 * **La courbe vient de Google.** Search Console garde seize mois ; les recopier pour les
 * afficher serait dupliquer une vérité qu'on peut demander. Surtout, une courbe bâtie sur nos
 * propres relevés commencerait son histoire aujourd'hui — un graphique vide qui se remplit
 * lentement, inutile pendant des mois.
 *
 * **Les mouvements de rang viennent de nos relevés.** Google ne conserve pas l'historique de
 * position par requête : il donne la position moyenne d'aujourd'hui, pas celle d'il y a six
 * semaines. C'est la seule chose qu'Evoliia sait et que Search Console ne sait pas, et c'est
 * ce qui permet de dire « cette recherche est passée de la page 3 à la page 1 ».
 */

/** Les fenêtres proposées. Au-delà de seize mois, Google ne garde plus rien. */
export const PERIODES_ORGANIQUE = [28, 90, 180, 480] as const

export function periodeValide(valeur: unknown): number {
  const jours = typeof valeur === 'number' ? valeur : Number(valeur)
  return (PERIODES_ORGANIQUE as readonly number[]).includes(jours) ? jours : 90
}

/** Une recherche qui a changé de rang, et de combien. */
export type Mouvement = {
  requete: string
  /** La position d'aujourd'hui. Plus petit est meilleur. */
  position: number
  /** Celle du relevé le plus ancien de la fenêtre. */
  positionAvant: number
  /** Positif quand on a gagné des places — l'inverse de la soustraction, donc. */
  gain: number
  impressions: number
}

/**
 * En deçà, un mouvement de rang est du bruit.
 *
 * Une requête vue trois fois peut passer de la position 40 à la 8 parce qu'une seule personne
 * a cherché depuis son téléphone. Ce n'est pas un progrès, c'est un échantillon d'une
 * personne — et l'afficher comme une victoire ferait croire à un travail qui n'a pas eu lieu.
 */
const IMPRESSIONS_MINIMALES = 20

/** En deçà, le rang n'a pas vraiment bougé : Google fait respirer ses classements. */
const GAIN_MINIMAL = 1.5

/** Ce qu'on montre de chaque côté. Au-delà, on ne lit plus, on parcourt. */
const MOUVEMENTS_MONTRES = 6

type LigneRelevee = { requete: string; position: number; impressions: number }

function lignes(valeur: unknown): LigneRelevee[] {
  if (!Array.isArray(valeur)) return []
  return valeur
    .map((brut) => {
      const ligne = (brut ?? {}) as Record<string, unknown>
      return {
        requete: typeof ligne.requete === 'string' ? ligne.requete : '',
        position: typeof ligne.position === 'number' ? ligne.position : 0,
        impressions: typeof ligne.impressions === 'number' ? ligne.impressions : 0,
      }
    })
    .filter((ligne) => ligne.requete !== '' && ligne.position > 0)
}

/**
 * Ce qui a gagné et ce qui a perdu des places, entre deux relevés.
 *
 * Pure et séparée de la lecture : c'est la partie qu'on peut se tromper en écrivant — le sens
 * de la soustraction, notamment. Chez Google, une position plus petite est meilleure ; un
 * gain est donc une diminution, et l'écrire à l'envers transformerait chaque progrès en
 * recul sur l'écran sans qu'aucun test de lecture ne s'en aperçoive.
 */
export function mouvements(
  avant: unknown,
  maintenant: unknown,
): { gagnees: Mouvement[]; perdues: Mouvement[] } {
  const anciennes = new Map(lignes(avant).map((ligne) => [ligne.requete, ligne]))
  const tous: Mouvement[] = []

  for (const ligne of lignes(maintenant)) {
    const ancienne = anciennes.get(ligne.requete)
    if (ancienne === undefined) continue
    if (ligne.impressions < IMPRESSIONS_MINIMALES) continue
    // Position plus petite = meilleure. Un gain est une diminution.
    const gain = Math.round((ancienne.position - ligne.position) * 10) / 10
    if (Math.abs(gain) < GAIN_MINIMAL) continue
    tous.push({
      requete: ligne.requete,
      position: ligne.position,
      positionAvant: ancienne.position,
      gain,
      impressions: ligne.impressions,
    })
  }

  return {
    gagnees: tous
      .filter((un) => un.gain > 0)
      .sort((une, autre) => autre.gain - une.gain)
      .slice(0, MOUVEMENTS_MONTRES),
    perdues: tous
      .filter((un) => un.gain < 0)
      .sort((une, autre) => une.gain - autre.gain)
      .slice(0, MOUVEMENTS_MONTRES),
  }
}

/**
 * Où une recherche tombe chez Google, en langage de personne et non en nombres.
 *
 * Les bornes portent un demi-point parce que la position rendue est une moyenne : une
 * recherche à 3,4 est sortie tantôt deuxième, tantôt quatrième, et l'arrondir vers le bas la
 * ferait passer pour un podium permanent. Le demi-point coupe là où la moyenne cesse d'être
 * défendable.
 */
export type Tranche = 'podium' | 'page-1' | 'page-2' | 'loin'

const BORNES = { podium: 3.5, page1: 10.5, page2: 20.5 }

export function trancheDe(position: number): Tranche {
  if (position <= BORNES.podium) return 'podium'
  if (position <= BORNES.page1) return 'page-1'
  if (position <= BORNES.page2) return 'page-2'
  return 'loin'
}

/** Une recherche dans le classement, avec sa place et son mouvement. */
export type Rang = {
  requete: string
  /** La position moyenne sur la fenêtre lue. Plus petit est meilleur. */
  position: number
  clics: number
  impressions: number
  /**
   * La place au relevé le plus ancien, ou `null` quand on ne l'a pas.
   *
   * `null` ne veut pas dire « nouvelle recherche » : nos relevés ne gardent que les
   * vingt-cinq requêtes les plus cliquées de chaque nuit, et une recherche peut très bien
   * exister depuis des mois sans y avoir jamais figuré. L'écran doit dire « on ne sait pas »,
   * jamais « c'est nouveau » — la seconde phrase serait une affirmation, et elle serait fausse.
   */
  positionAvant: number | null
  /** Positif quand des places ont été gagnées. `null` quand il n'y a rien à comparer. */
  gain: number | null
  tranche: Tranche
}

/**
 * Sous ce nombre d'affichages, une place n'est pas une place.
 *
 * Plus bas que le seuil des mouvements, et c'est volontaire : une recherche affichée huit
 * fois en première position est une information réelle, là où un **écart** de position sur
 * huit affichages n'en est pas une. Constater où l'on est demande moins de matière que
 * mesurer un déplacement.
 */
const IMPRESSIONS_CLASSEES = 5

/** Ce qu'on classe. Au-delà, ce n'est plus un classement, c'est un export. */
const RANGS_MONTRES = 50

/**
 * Le classement des recherches, de la meilleure place à la moins bonne.
 *
 * Le tri par place, et non par clics, est tout l'intérêt. La liste triée par clics répond à
 * « qu'est-ce qui marche » ; celle-ci répond à « où j'en suis », et ce n'est pas la même
 * question. Une recherche en deuxième position qui ne fait que trois clics par mois est un
 * mot que personne ne tape, pas un échec ; une recherche en quinzième position qui en fait
 * quarante est un travail qui reste à faire.
 */
export function classement(lignes: readonly Ligne[], reperes: Map<string, number>): Rang[] {
  return lignes
    .filter((ligne) => ligne.position > 0 && ligne.impressions >= IMPRESSIONS_CLASSEES)
    .map((ligne) => {
      const avant = reperes.get(ligne.cle)
      return {
        requete: ligne.cle,
        position: ligne.position,
        clics: ligne.clics,
        impressions: ligne.impressions,
        positionAvant: avant ?? null,
        // Position plus petite = meilleure. Un gain est une diminution.
        gain: avant === undefined ? null : Math.round((avant - ligne.position) * 10) / 10,
        tranche: trancheDe(ligne.position),
      }
    })
    .sort((une, autre) => une.position - autre.position || autre.clics - une.clics)
    .slice(0, RANGS_MONTRES)
}

/** Combien de recherches dans chaque tranche. Le classement d'un coup d'œil. */
export function compterTranches(rangs: readonly Rang[]): Record<Tranche, number> {
  const compte: Record<Tranche, number> = { podium: 0, 'page-1': 0, 'page-2': 0, loin: 0 }
  for (const rang of rangs) compte[rang.tranche] += 1
  return compte
}

export type VueOrganique = {
  jours: number
  serie: JourRecherche[]
  gagnees: Mouvement[]
  perdues: Mouvement[]
  /** Les recherches triées par place, la meilleure d'abord. */
  classement: Rang[]
  /** Le nombre de jours réellement couverts par les relevés comparés. 0 : pas encore deux. */
  ecartJours: number
  /**
   * Les mouvements de rang ignorent le filtre pays.
   *
   * Les relevés d'Evoliia sont pris tous pays confondus : les refiltrer après coup donnerait
   * un chiffre faux plutôt qu'un chiffre manquant. L'écran le dit au lieu de le taire.
   */
  mouvementsTousPays: boolean
}

/**
 * La courbe du trafic naturel et les mouvements de rang de la période.
 *
 * Un échec sur les mouvements n'emporte pas la courbe : ce sont deux informations distinctes,
 * et les relevés peuvent manquer — sur un site suivi depuis deux jours, il n'y a simplement
 * rien à comparer. La courbe, elle, existe dès le premier appel.
 */
export async function lireOrganique(
  userId: string,
  siteId: string,
  origin: string,
  jours: number,
  pays?: string,
): Promise<{ ok: true; vue: VueOrganique } | { ok: false; raison: string }> {
  const acces = await useOAuthAccess(userId, 'google-search-console', rafraichir)
  if (!acces.ok) return { ok: false, raison: acces.raison }

  /*
   * Le droit se vérifie ici aussi, et pas seulement sur l'écran qui appelle. Une fonction de
   * serveur qui laisse son appelant décider de son droit d'accès n'en a aucun : il suffit
   * qu'une seule page l'appelle sans vérifier pour que la porte soit ouverte partout.
   */
  try {
    requireFeature(await getEntitlements(userId), SEARCH_CONSOLE_FEATURE)
  } catch (error) {
    return {
      ok: false,
      raison:
        error instanceof AppError
          ? error.message
          : "Votre offre n'ouvre pas les chiffres de recherche.",
    }
  }

  const proprietes = await listerProprietes(acces.accessToken)
  if (!proprietes.ok) return { ok: false, raison: proprietes.raison }

  const propriete = choisirPropriete(origin, proprietes.proprietes)
  if (propriete === null) {
    return { ok: false, raison: 'Ce site n’est pas dans votre Search Console.' }
  }

  /*
   * Les deux lectures partent ensemble. La seconde relit les requêtes que l'écran affiche
   * déjà par ailleurs, et c'est assumé : lui faire traverser la page pour économiser un appel
   * gratuit ferait dépendre l'évolution de l'ordre d'exécution d'un composant. Le classement
   * se calcule ici, où se trouvent les relevés auxquels il se compare.
   */
  const [serie, actuelles] = await Promise.all([
    parJour(acces.accessToken, propriete, jours, pays),
    requetes(acces.accessToken, propriete, 'query', JOURS_LUS, pays),
  ])
  if (!serie.ok) return { ok: false, raison: serie.raison }

  /*
   * Les deux bornes de la fenêtre, prises parmi nos relevés : le plus récent, et le plus
   * ancien qui tombe encore dedans. Comparer au tout premier relevé disponible donnerait un
   * écart qui ne correspond pas à la période affichée — un « +12 places » sur un graphique de
   * 28 jours alors que le gain s'étale sur six mois.
   */
  const depuis = new Date(Date.now() - jours * 24 * 60 * 60 * 1000)
  const releves = await withUserScope(userId, (tx) =>
    tx.releveRecherche.findMany({
      where: { siteId, userId, jour: { gte: depuis } },
      orderBy: { jour: 'asc' },
      select: { jour: true, requetes: true },
    }),
  )

  const premier = releves[0]
  const dernier = releves[releves.length - 1]
  const comparable = premier !== undefined && dernier !== undefined && releves.length >= 2

  const bouge = comparable
    ? mouvements(premier.requetes, dernier.requetes)
    : { gagnees: [], perdues: [] }

  /*
   * Les repères viennent du même relevé ancien que les mouvements, pour que les deux blocs de
   * l'écran racontent la même histoire. Deux points de comparaison différents afficheraient
   * « +12 » ici et « +4 » là sur la même recherche, et on ne saurait lequel croire.
   */
  const reperes = new Map<string, number>()
  if (comparable && premier !== undefined) {
    for (const ligne of lignes(premier.requetes)) reperes.set(ligne.requete, ligne.position)
  }

  return {
    ok: true,
    vue: {
      jours,
      serie: serie.lignes,
      gagnees: bouge.gagnees,
      perdues: bouge.perdues,
      /*
       * Un refus sur cette lecture-là ne coûte que le classement. La courbe et les mouvements
       * sont deux réponses entières, et les perdre parce qu'un troisième appel a échoué
       * viderait l'écran pour rien.
       */
      classement: actuelles.ok ? classement(actuelles.lignes, reperes) : [],
      ecartJours:
        comparable && premier !== undefined && dernier !== undefined
          ? Math.round((+dernier.jour - +premier.jour) / (24 * 60 * 60 * 1000))
          : 0,
      mouvementsTousPays: pays !== undefined && /^[a-z]{3}$/i.test(pays),
    },
  }
}
