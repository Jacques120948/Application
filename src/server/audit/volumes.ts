import { withUserScope } from '@/server/db/scope'
import { logger } from '@/server/observability/logger'
import { accesCompteActif } from '@/server/ads/comptes'
import { lireProfil } from '@/server/ads/profil'
import { googleAds } from '@/server/ads/google-ads'
import { LANGUES, marcheDominant, marcheDuProfil } from '@/server/ads/mots-cles'
import { lireRecherches } from './recherches'

/**
 * Combien de fois un mot est tapé, et non combien de fois on vous a montré.
 *
 * C'est la moitié manquante du classement, et la confusion entre les deux est la plus
 * coûteuse de tout le référencement. Search Console compte vos **affichages** : le nombre de
 * fois où Google vous a présenté sur une recherche. Il ne compte jamais la **demande** : le
 * nombre de fois où cette recherche a été tapée, par qui que ce soit.
 *
 * Sortir trentième sur un mot cherché cinq mille fois par mois donne moins d'affichages que
 * sortir troisième sur un mot cherché vingt fois. La première ligne est une occasion, la
 * seconde un cul-de-sac — et un classement trié sur les seuls chiffres de Search Console les
 * montre dans cet ordre-là, c'est-à-dire à l'envers.
 *
 * Trois décisions gouvernent ce module.
 *
 * **Le volume est gardé, jamais relu à l'affichage.** C'est une moyenne mensuelle : elle n'a
 * pas bougé depuis hier. Le redemander à chaque ouverture d'écran ajouterait un aller-retour
 * à chaque page et userait le quota d'appels d'Evoliia — un quota partagé par tous ses
 * utilisateurs, dont l'épuisement casserait la création de campagnes de tout le monde. Un
 * site coûte ici un appel par mois, pas un par visite.
 *
 * **Il vient du planificateur de Google Ads, donc il suppose un compte publicitaire relié.**
 * Sans lui, l'écran le dit et n'affiche pas de colonne vide : Search Console seul ne connaît
 * pas cette donnée, et aucune estimation ne la remplacera honnêtement.
 *
 * **Chaque langue est chiffrée dans la sienne.** Demander le volume de « diaspro rosso » en
 * français rend un nombre vrai qui ne décrit rien. Les recherches sont donc groupées par la
 * langue que Google leur associe, et chaque groupe part dans un appel séparé.
 */

/**
 * L'âge au-delà duquel un volume est redemandé.
 *
 * Trente jours parce que Google publie une moyenne sur douze mois : la valeur d'aujourd'hui
 * et celle d'il y a trois semaines sont la même à un arrondi près. Rafraîchir plus souvent
 * consommerait du quota pour réécrire le même nombre.
 */
export const VOLUME_FRAIS_JOURS = 30

/** Ce qu'on chiffre en une fois. Au-delà, Google coupe la liste sans le dire. */
const MOTS_PAR_APPEL = 60

/** Ce qu'on garde par site. Une borne, pour qu'une table de cache reste un cache. */
const MOTS_GARDES = 300

export type VolumeConnu = {
  volume: number
  concurrence: string
  coutBasMicros: number
  coutHautMicros: number
  releveAt: Date
}

/**
 * La forme sous laquelle un mot est rangé et relu.
 *
 * Une seule, et c'est ce qui fait qu'un cache trouve quelque chose. Google rend « Bougie
 * Citrine » là où Search Console rend « bougie citrine » : rangés tels quels, ce sont deux
 * lignes, et la seconde ouverture de l'écran redemanderait tout.
 */
export function normaliser(mot: string): string {
  return mot.toLowerCase().replace(/\s+/gu, ' ').trim()
}

/** Les volumes déjà connus pour ce site. Aucune lecture chez Google : c'est le but. */
export async function lireVolumes(
  userId: string,
  siteId: string,
): Promise<Map<string, VolumeConnu>> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.volumeRecherche.findMany({
      where: { userId, siteId },
      orderBy: { releveAt: 'desc' },
      take: MOTS_GARDES,
    }),
  )

  const connus = new Map<string, VolumeConnu>()
  for (const ligne of lignes) {
    /*
     * Le premier gagne, et les lignes sont triées du plus récent au plus ancien. Un même mot
     * peut exister sous deux marchés ou deux langues ; montrer le plus récent vaut mieux que
     * montrer celui que la base a rendu en premier.
     */
    if (connus.has(ligne.motCle)) continue
    connus.set(ligne.motCle, {
      volume: ligne.volume,
      concurrence: ligne.concurrence,
      coutBasMicros: Number(ligne.coutBasMicros),
      coutHautMicros: Number(ligne.coutHautMicros),
      releveAt: ligne.releveAt,
    })
  }
  return connus
}

/** Vrai quand plus rien n'est assez frais pour être montré sans être redemandé. */
export function aRafraichir(connus: Map<string, VolumeConnu>, maintenant = new Date()): boolean {
  if (connus.size === 0) return true
  const limite = maintenant.getTime() - VOLUME_FRAIS_JOURS * 24 * 60 * 60 * 1000
  for (const connu of connus.values()) if (+connu.releveAt >= limite) return false
  return true
}

/**
 * Groupe les recherches par la langue que Google leur associe.
 *
 * Pure et séparée parce que c'est la partie qui décide de la justesse des nombres : une
 * requête italienne partie dans l'appel français revient avec un volume qui décrit la
 * demande française pour des mots italiens, c'est-à-dire rien. Sans langue connue, la
 * requête rejoint celle du site plutôt que d'être écartée — un état ordinaire, le croisement
 * requête/page ne couvrant pas toutes les lignes.
 */
export function parLangue(
  mots: readonly string[],
  langues: Record<string, string>,
  defaut: string,
): Map<string, string[]> {
  const groupes = new Map<string, string[]>()
  for (const mot of mots) {
    const trouvee = langues[mot]
    const cle = trouvee !== undefined && LANGUES[trouvee] !== undefined ? trouvee : defaut
    const liste = groupes.get(cle) ?? []
    liste.push(mot)
    groupes.set(cle, liste)
  }
  return groupes
}

/**
 * Redemande les volumes chez Google et les range.
 *
 * Déclenchée par un geste ou par le travail de nuit, jamais par l'affichage d'un écran. Une
 * lecture qui écrit à chaque rendu de page ferait du quota d'Evoliia une fonction du nombre
 * d'onglets ouverts.
 */
export async function rafraichirVolumes(
  userId: string,
  siteId: string,
  origin: string,
  locale: string,
): Promise<{ ok: true; chiffres: number } | { ok: false; raison: string }> {
  const acces = await accesCompteActif(userId)
  if (!acces.ok) {
    return {
      ok: false,
      raison:
        'Le volume de recherche vient du planificateur de Google Ads : il faut y relier un compte publicitaire. Search Console ne connaît pas cette donnée, et Evoliia préfère ne rien afficher plutôt que de l’estimer.',
    }
  }

  const lecture = await lireRecherches(userId, origin)
  if (!lecture.ok) {
    return {
      ok: false,
      raison:
        'Les chiffres de Search Console ne sont pas lisibles pour l’instant. Ce sont eux qui disent quels mots chiffrer.',
    }
  }

  /*
   * Le profil prime, les chiffres ne sont qu'un repli — même règle qu'à la création de
   * campagne, et pour la même raison : le pays d'où viennent les curieux n'est pas celui où
   * l'on vend. Chiffrer un marché où l'on ne livre pas donne des nombres vrais et sans emploi.
   */
  const profil = await lireProfil(userId, acces.compte.id)
  const marche = marcheDuProfil(profil.pays) ?? marcheDominant(lecture.vue.pays)
  if (marche === null) {
    return {
      ok: false,
      raison:
        'Evoliia ne sait pas quel pays chiffrer. Indiquez-le dans votre profil publicitaire : un volume de recherche sans pays ne veut rien dire, et le pays d’où viennent vos visiteurs n’est pas forcément celui où vous vendez.',
    }
  }

  const defaut = LANGUES[locale] === undefined ? 'fr' : locale
  const mots = [...lecture.vue.requetes, ...lecture.vue.occasionsDeRequetes]
    .map((ligne) => normaliser(ligne.cle))
    .filter((mot) => mot !== '')
  const uniques = [...new Set(mots)].slice(0, MOTS_PAR_APPEL)
  if (uniques.length === 0) return { ok: true, chiffres: 0 }

  const groupes = parLangue(uniques, lecture.vue.langues, defaut)

  const lectures = await Promise.all(
    [...groupes.entries()].map(async ([code, liste]) => {
      const cible = LANGUES[code]
      if (cible === undefined) return null
      const mesures = await googleAds.metriquesDeMotsCles(
        acces.acces,
        liste,
        marche.geo,
        cible.code,
      )
      return mesures.ok
        ? ({ ok: true, code, mesures: mesures.valeur } as const)
        : ({ ok: false, code, raison: mesures.raison } as const)
    }),
  )

  let refus = ''
  let chiffres = 0
  for (const resultat of lectures) {
    if (resultat === null) continue
    if (!resultat.ok) {
      if (refus === '') refus = resultat.raison
      continue
    }
    for (const mesure of resultat.mesures) {
      const motCle = normaliser(mesure.texte)
      if (motCle === '') continue
      await withUserScope(userId, (tx) =>
        tx.volumeRecherche.upsert({
          where: {
            siteId_marche_langue_motCle: {
              siteId,
              marche: marche.geo,
              langue: resultat.code,
              motCle,
            },
          },
          create: {
            userId,
            siteId,
            motCle,
            marche: marche.geo,
            langue: resultat.code,
            volume: mesure.volume,
            concurrence: mesure.concurrence,
            coutBasMicros: BigInt(Math.round(mesure.coutBasMicros)),
            coutHautMicros: BigInt(Math.round(mesure.coutHautMicros)),
            releveAt: new Date(),
          },
          update: {
            volume: mesure.volume,
            concurrence: mesure.concurrence,
            coutBasMicros: BigInt(Math.round(mesure.coutBasMicros)),
            coutHautMicros: BigInt(Math.round(mesure.coutHautMicros)),
            releveAt: new Date(),
          },
        }),
      )
      chiffres += 1
    }
  }

  if (chiffres === 0 && refus !== '') return { ok: false, raison: refus }

  /* Ni les mots ni les volumes ne sont journalisés : ce sont les affaires de la personne. */
  logger.info('volumes de recherche relevés', { chiffres, langues: groupes.size })
  return { ok: true, chiffres }
}
