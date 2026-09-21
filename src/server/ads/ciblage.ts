import { notFound, validation } from '@/lib/errors'
import { withUserScope } from '@/server/db/scope'
import { lireRecherches } from '@/server/audit/recherches'
import { accesCompteActif, compteActif } from './comptes'
import { googleAds } from './google-ads'
import { MOTS_CLES_PAR_GROUPE } from './garde-fous'
import {
  cpaAcceptable,
  croiser,
  LANGUES,
  marcheDominant,
  type Candidat,
  type RequeteSite,
} from './mots-cles'
import { lireProfil } from './profil'

/**
 * Ce que Naya propose d'acheter, et pourquoi.
 *
 * L'orchestration seulement : les deux lectures, le croisement, l'écriture en base. La
 * décision elle-même vit dans `mots-cles.ts`, sans réseau ni base, où elle se vérifie
 * entièrement. Rien ici ne part chez Google — ce qui sort de ce fichier vit dans Evoliia
 * jusqu'à ce qu'une personne clique sur « déposer », et ce dépôt-là passe par `actions.ts`,
 * avec son journal et son retour arrière.
 *
 * Deux décisions valent d'être dites.
 *
 * **Le marché n'est pas choisi, il est constaté.** C'est le pays d'où viennent le plus
 * d'affichages dans Search Console. Demander à la personne de le saisir ajouterait un
 * formulaire à remplir pour retrouver un fait qu'on a déjà ; le deviner à partir de la
 * devise du compte ferait viser la France pour une boutique suisse qui facture en euros.
 *
 * **Les chiffres sont figés à la proposition.** Le planificateur consomme le quota d'API
 * partagé par tous les utilisateurs d'Evoliia : rouvrir l'écran ne doit pas le rappeler.
 * Une proposition vieille de trois semaines se redemande — elle ne se rafraîchit pas en
 * silence, ce qui laisserait croire à des chiffres du jour.
 */

/** Les mots-clés du groupe qui servent de point de départ au planificateur. */
const GRAINES_MAX = 20

export type MotCleVue = {
  id: string
  texte: string
  correspondance: string
  position: number
  impressions: number
  volume: number
  coutBasMicros: number
  coutHautMicros: number
  concurrence: string
  motif: string
  createdAt: Date
}

function vue(ligne: {
  id: string
  texte: string
  correspondance: string
  position: number
  impressions: number
  volume: number
  coutBasMicros: bigint
  coutHautMicros: bigint
  concurrence: string
  motif: string
  createdAt: Date
}): MotCleVue {
  return {
    id: ligne.id,
    texte: ligne.texte,
    correspondance: ligne.correspondance,
    position: ligne.position,
    impressions: ligne.impressions,
    volume: ligne.volume,
    coutBasMicros: Number(ligne.coutBasMicros),
    coutHautMicros: Number(ligne.coutHautMicros),
    concurrence: ligne.concurrence,
    motif: ligne.motif,
    createdAt: ligne.createdAt,
  }
}

const CHAMPS = {
  id: true,
  texte: true,
  correspondance: true,
  position: true,
  impressions: true,
  volume: true,
  coutBasMicros: true,
  coutHautMicros: true,
  concurrence: true,
  motif: true,
  createdAt: true,
} as const

/** Les mots-clés proposés pour un contenant. */
export async function lireMotsCles(userId: string, groupeId: string): Promise<MotCleVue[]> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsMotCle.findMany({
      where: { userId, groupeId, etat: 'proposee' },
      orderBy: { createdAt: 'desc' },
      select: CHAMPS,
    }),
  )
  return lignes.map(vue)
}

/** Tous les mots-clés proposés du compte, rangés par contenant, pour l'écran d'ensemble. */
export async function motsClesDuCompte(
  userId: string,
  accountId: string,
): Promise<Map<string, MotCleVue[]>> {
  const lignes = await withUserScope(userId, (tx) =>
    tx.adsMotCle.findMany({
      where: { userId, accountId, etat: 'proposee' },
      orderBy: { createdAt: 'desc' },
      select: { ...CHAMPS, groupeId: true },
    }),
  )
  const parGroupe = new Map<string, MotCleVue[]>()
  for (const ligne of lignes) {
    const liste = parGroupe.get(ligne.groupeId) ?? []
    liste.push(vue(ligne))
    parGroupe.set(ligne.groupeId, liste)
  }
  return parGroupe
}

export async function ecarterMotCle(userId: string, id: string): Promise<void> {
  const touchees = await withUserScope(userId, (tx) =>
    tx.adsMotCle.updateMany({
      where: { id, userId, etat: 'proposee' },
      data: { etat: 'ecartee', closedAt: new Date() },
    }),
  )
  if (touchees.count === 0) throw notFound('Ce mot-clé est introuvable.')
}

export type BilanCiblage = {
  proposes: number
  /** Écartées parce qu'on sort déjà en tête sans payer. Une bonne nouvelle, pas un filtre. */
  dejaGagnees: number
  /** Le marché et la langue sur lesquels les volumes ont été lus, pour que l'écran le dise. */
  marche: string
  langue: string
  /**
   * Vide quand le planificateur a répondu ; sinon, la raison de son refus.
   *
   * Affichée telle quelle : une liste sans volume ni prix n'est pas une liste ratée, c'est
   * une liste amputée, et la personne doit savoir de quoi — et comment y remédier.
   */
  sansPrix: string
}

/**
 * Cherche des mots-clés à acheter pour un contenant.
 *
 * Réservé aux groupes d'annonces : une Performance Max n'achète pas de mots-clés, elle
 * choisit elle-même où diffuser à partir de ses éléments. Proposer des mots-clés pour l'une
 * serait proposer un bouton qui ne peut qu'échouer.
 *
 * L'appel ne coûte aucun crédit — ni Search Console ni le planificateur ne font appel à un
 * modèle — mais il consomme le quota d'API Google partagé. D'où une seule lecture par
 * demande, et des chiffres conservés.
 */
export async function proposerMotsCles(
  userId: string,
  groupeId: string,
  origin: string | null,
  locale: string,
): Promise<BilanCiblage> {
  const compte = await compteActif(userId)
  if (compte === null) throw notFound('Aucun compte publicitaire n’est suivi.')

  const groupe = await withUserScope(userId, (tx) =>
    tx.adsGroupe.findFirst({
      where: { id: groupeId, userId, accountId: compte.id },
      select: {
        id: true,
        nom: true,
        genre: true,
        groupeId: true,
        elements: { where: { champ: 'mot-cle' }, select: { texte: true } },
        motsCles: { where: { etat: 'proposee' }, select: { texte: true } },
      },
    }),
  )
  if (groupe === null) throw notFound('Ce contenant est introuvable.')
  if (groupe.genre !== 'annonces') {
    throw validation(
      'Une campagne Performance Max n’achète pas de mots-clés : elle choisit elle-même où diffuser, à partir de ses éléments. Les mots-clés ne concernent que les campagnes Recherche.',
    )
  }

  const presents = [
    ...groupe.elements.map((element) => element.texte),
    ...groupe.motsCles.map((mot) => mot.texte),
  ]
  if (presents.length >= MOTS_CLES_PAR_GROUPE) {
    throw validation(
      `Ce contenant porte déjà ${presents.length} mots-clés, propositions comprises. Déposez-en ou écartez-en avant d’en chercher d’autres.`,
    )
  }

  if (origin === null) {
    throw validation(
      'Aucun site n’est suivi. Les mots-clés se choisissent sur ce que les gens tapent déjà pour trouver votre site : sans Search Console, il n’y aurait que des suppositions.',
    )
  }

  const lecture = await lireRecherches(userId, origin)
  if (!lecture.ok) {
    throw validation(
      'Les chiffres de Search Console ne sont pas lisibles pour l’instant. Ce sont eux qui disent ce que les gens tapent réellement : sans eux, Naya ne proposerait que des suppositions.',
    )
  }

  const marche = marcheDominant(lecture.vue.pays)
  if (marche === null) {
    throw validation(
      'Naya ne reconnaît pas le pays d’où viennent vos visiteurs, et un volume de recherche sans pays ne veut rien dire. Écrivez-moi : la liste des marchés s’élargit d’une ligne.',
    )
  }
  const langue = LANGUES[locale] ?? LANGUES.fr
  if (langue === undefined) throw validation('Langue inconnue.')

  const acces = await accesCompteActif(userId)
  if (!acces.ok) throw validation(acces.raison)

  /*
   * Les graines : d'abord les mots-clés déjà en place, qui disent le thème du groupe mieux
   * que son nom, puis les recherches les plus vues. Sans graine, le planificateur n'a rien
   * à quoi se rattacher et rendrait les idées du hasard.
   */
  const requetes: RequeteSite[] = [
    ...lecture.vue.occasionsDeRequetes,
    ...lecture.vue.requetes,
  ].map((ligne) => ({
    texte: ligne.cle,
    position: ligne.position,
    impressions: ligne.impressions,
    clics: ligne.clics,
  }))

  const graines = [...presents, ...requetes.map((requete) => requete.texte)].slice(0, GRAINES_MAX)
  const idees = await googleAds.ideesDeMotsCles(acces.acces, graines, marche.geo, langue.code)
  /*
   * Un planificateur muet n'arrête plus la recherche, et ce n'est pas un relâchement.
   * L'erreur que tout ce module existe pour empêcher — acheter une recherche qu'on gagne
   * déjà gratuitement — se prévient avec la position organique, que Search Console donne.
   * Le planificateur ajoute le volume du marché et le prix du clic : précieux pour juger,
   * pas nécessaire pour écarter. Sans lui, on propose moins et on le dit ; refuser
   * entièrement ferait perdre à quelqu'un une demande réelle et mesurée au motif que Google
   * n'ouvre pas son planificateur à son niveau d'accès.
   */
  if (!idees.ok && requetes.length === 0) throw validation(idees.raison)

  const profil = await lireProfil(userId, compte.id)
  const { candidats, dejaGagnees } = croiser(
    requetes,
    idees.ok ? idees.valeur : [],
    presents,
    cpaAcceptable(profil),
    compte.devise,
  )

  const place = MOTS_CLES_PAR_GROUPE - presents.length
  const retenus = candidats.slice(0, place)
  if (retenus.length > 0) {
    await withUserScope(userId, (tx) =>
      tx.adsMotCle.createMany({
        data: retenus.map((candidat: Candidat) => ({
          userId,
          accountId: compte.id,
          groupeId: groupe.id,
          texte: candidat.texte,
          /*
           * L'expression exacte par défaut, jamais le mot-clé exact seul : celui-ci ne
           * capte que la formulation à la virgule près, et sur un petit volume il ne
           * diffuse presque pas. La personne peut resserrer ensuite, dans Google Ads.
           */
          correspondance: 'phrase',
          position: candidat.position,
          impressions: candidat.impressions,
          clics: candidat.clics,
          volume: candidat.volume,
          coutBasMicros: BigInt(Math.round(candidat.coutBasMicros)),
          coutHautMicros: BigInt(Math.round(candidat.coutHautMicros)),
          concurrence: candidat.concurrence,
          motif: candidat.motif,
        })),
        skipDuplicates: true,
      }),
    )
  }

  return {
    proposes: retenus.length,
    dejaGagnees,
    marche: marche.nom,
    langue: langue.nom,
    sansPrix: idees.ok ? '' : idees.raison,
  }
}
