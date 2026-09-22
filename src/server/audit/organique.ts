import { AppError } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { getEntitlements } from '@/server/billing/entitlements'
import { requireFeature } from '@/server/billing/features'
import { useOAuthAccess } from '@/server/integrations/service'
import {
  listerProprietes,
  parJour,
  rafraichir,
  type JourRecherche,
} from '@/server/integrations/providers/google-search-console'
import { choisirPropriete, SEARCH_CONSOLE_FEATURE } from './recherches'

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

export type VueOrganique = {
  jours: number
  serie: JourRecherche[]
  gagnees: Mouvement[]
  perdues: Mouvement[]
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

  const serie = await parJour(acces.accessToken, propriete, jours, pays)
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

  return {
    ok: true,
    vue: {
      jours,
      serie: serie.lignes,
      gagnees: bouge.gagnees,
      perdues: bouge.perdues,
      ecartJours:
        comparable && premier !== undefined && dernier !== undefined
          ? Math.round((+dernier.jour - +premier.jour) / (24 * 60 * 60 * 1000))
          : 0,
      mouvementsTousPays: pays !== undefined && /^[a-z]{3}$/i.test(pays),
    },
  }
}
