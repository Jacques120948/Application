import type { Signaux } from '../extract'
import type { Check, PageVue } from './types'

/**
 * Les contrôles de conversion — ce que Cleo regarde.
 *
 * La question n'est plus « est-ce que ce site se trouve » (Néo) ni « est-ce qu'une machine
 * peut s'en servir » (Gia), mais celle-ci : **un visiteur arrivé sur cette page a-t-il de
 * quoi décider ?** Ce n'est pas le même travail. Un site irréprochable pour Google peut
 * perdre neuf visiteurs sur dix parce qu'on ne comprend pas ce qu'il vend, qu'aucun bouton
 * ne dit quoi faire, et que rien ne répond aux questions qu'on se pose avant de payer.
 *
 * **Ce que ces contrôles mesurent, et ce qu'ils ne mesurent pas.** Ils constatent ce qui
 * manque sur la page : c'est du calcul, c'est exact. Ils ne mesurent aucune vente, aucun
 * taux de conversion, aucun abandon — Evoliia n'a aujourd'hui aucune source de mesure
 * reliée. Un constat dit donc « voilà ce qui peut faire hésiter », jamais « voilà ce que
 * vous perdez ». Les formulations de `why` s'y tiennent, et aucune ne doit être réécrite en
 * promesse chiffrée : personne ne sait ce qu'un bouton déplacé rapporte.
 *
 * **Ce qui n'est pas relevé ne vaut pas zéro.** Les audits enregistrés avant que ces
 * signaux n'existent ne les portent pas. Un contrôle qui s'en sert rend alors `null` — hors
 * sujet — plutôt que d'annoncer « aucun bouton » sur une page qui en a peut-être dix. La
 * note d'un ancien audit ne bouge donc pas, et celle du prochain sera juste.
 *
 * **Les pages qui ne se jugent pas.** Une page en erreur, une page sans contenu : on ne
 * reproche pas à une page 404 de manquer de réassurance.
 *
 * Les seuils sont ici, en un seul endroit, chacun avec sa raison.
 */

/** En deçà, la page n'a pas assez de contenu pour qu'on juge ce qu'elle propose. */
const JUGEABLE_MIN = 120

/**
 * Au-delà, un formulaire décourage.
 *
 * Chaque champ est une occasion d'abandonner, et la plupart ne servent à personne sur le
 * moment : on peut demander la raison sociale après le premier échange. Six est large —
 * nom, prénom, courriel, téléphone, sujet, message — et laisse passer un formulaire de
 * contact complet sans rien reprocher.
 */
const CHAMPS_MAX = 6

/** Le nombre de gages de confiance attendu sur une page qui vend. */
const GAGES_MIN = 2

/** Libellés qui ne disent pas ce qui va se passer. Comparés en minuscules, sans accent. */
const BOUTONS_MUETS = [
  'envoyer',
  'valider',
  'ok',
  'soumettre',
  'cliquez ici',
  'cliquer ici',
  'en savoir plus',
  'continuer',
  'suivant',
  'go',
]

function sansAccent(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .trim()
}

/** La page se juge-t-elle ? Une erreur ou une page vide ne se reproche rien. */
function jugeable(page: PageVue): boolean {
  return page.statusCode < 400 && page.signals.wordCount >= JUGEABLE_MIN
}

/** Le relevé existe-t-il sur cet audit ? Voir le commentaire d'en-tête. */
function releve<T>(valeur: T | undefined): valeur is T {
  return valeur !== undefined
}

/**
 * Cette page cherche-t-elle à vendre ou à obtenir un contact ?
 *
 * Toutes les pages d'un site n'ont pas à convertir : une page « mentions légales » n'a ni
 * prix, ni bouton d'achat, et le lui reprocher gonflerait le constat d'un défaut qu'elle
 * n'a pas. On s'en tient donc à un signe objectif — un prix, ou un formulaire — plutôt qu'à
 * une devinette sur l'intention de la page.
 */
function pageQuiVend(signaux: Signaux): boolean {
  return signaux.prix === true || (signaux.formulaires ?? 0) > 0
}

export const CRO_CHECKS: readonly Check[] = [
  {
    id: 'cro.cta.absent',
    rapide: true,
    engine: 'cro',
    scope: 'page',
    label: 'Aucun bouton d’action',
    why: 'Rien sur cette page ne dit au visiteur quoi faire ensuite. Il a lu, il est peut-être convaincu, et il n’a nulle part où cliquer : il repart.',
    severity: 'critical',
    weight: 10,
    run: (page) => {
      if (!jugeable(page)) return null
      if (!releve(page.signals.boutons)) return null
      return page.signals.boutons === 0
    },
  },
  {
    id: 'cro.cta.muet',
    rapide: true,
    engine: 'cro',
    scope: 'page',
    label: 'Le bouton ne dit pas ce qui va se passer',
    why: '« Envoyer » ou « En savoir plus » ne promettent rien. Un visiteur qui ne sait pas où le clic le mène clique moins : « Demander un devis » ou « Voir les tarifs » lèvent ce doute.',
    severity: 'improvement',
    weight: 4,
    run: (page) => {
      if (!jugeable(page)) return null
      const libelle = page.signals.premierBouton
      if (!releve(libelle) || libelle === '') return null
      return BOUTONS_MUETS.includes(sansAccent(libelle))
    },
  },
  {
    id: 'cro.promesse.absente',
    rapide: true,
    engine: 'cro',
    scope: 'page',
    label: 'Aucune phrase n’explique ce que propose la page',
    why: 'Tout y est en titres, en listes ou en images : aucune phrase suivie ne dit ce qui est proposé ni à qui. Un visiteur décide en quelques secondes s’il est au bon endroit, et il décide avec ce qu’il lit.',
    severity: 'important',
    weight: 8,
    /*
     * Ce que ce contrôle peut dire, et rien de plus. `intro` est le premier paragraphe
     * lisible de la page, où qu'il se trouve : on ne sait pas s'il est en haut. Juger sa
     * longueur serait donc un faux constat déguisé en mesure — une première version le
     * faisait, avec un seuil que la définition d'`intro` rendait inatteignable. Reste ce
     * qui est vrai et qui se voit souvent sur les pages montées à partir d'un thème :
     * aucune phrase suivie du tout.
     */
    run: (page) => (jugeable(page) ? page.signals.intro.trim() === '' : null),
  },
  {
    id: 'cro.h1.absent',
    rapide: true,
    engine: 'cro',
    scope: 'page',
    label: 'Aucun titre visible en haut de page',
    why: 'Sans titre, rien ne résume la page à celui qui arrive. Il doit lire pour comprendre où il est, et la plupart n’en prennent pas la peine.',
    severity: 'important',
    weight: 6,
    run: (page) => (jugeable(page) ? page.signals.h1.length === 0 : null),
  },
  {
    id: 'cro.reassurance.absente',
    engine: 'cro',
    scope: 'page',
    label: 'Rien ne rassure avant d’acheter',
    why: 'Livraison, retours, garantie, paiement, qui est derrière ce site : cette page n’en dit presque rien. Ce sont les questions qu’on se pose avant de payer — et qu’on ne pose jamais, on s’en va.',
    severity: 'critical',
    weight: 10,
    run: (page) => {
      if (!jugeable(page)) return null
      const gages = page.signals.reassurance
      if (!releve(gages)) return null
      if (!pageQuiVend(page.signals)) return null
      return gages.length < GAGES_MIN
    },
  },
  {
    id: 'cro.livraison.absente',
    engine: 'cro',
    scope: 'page',
    label: 'Le prix est là, la livraison n’y est pas',
    why: 'Un prix sans un mot sur la livraison ou les délais laisse la question la plus coûteuse sans réponse. Des frais découverts plus tard sont l’une des raisons les plus fréquentes d’abandonner un panier.',
    severity: 'important',
    weight: 8,
    run: (page) => {
      if (!jugeable(page)) return null
      const gages = page.signals.reassurance
      if (!releve(gages) || page.signals.prix !== true) return null
      return !gages.includes('livraison')
    },
  },
  {
    id: 'cro.avis.absents',
    engine: 'cro',
    scope: 'page',
    label: 'Aucun avis, aucun témoignage',
    why: 'Rien sur cette page ne montre que d’autres ont acheté et en sont contents. C’est ce qui rassure le plus quelqu’un qui ne vous connaît pas, et son absence se remarque plus que sa présence.',
    severity: 'important',
    weight: 7,
    run: (page) => {
      if (!jugeable(page)) return null
      const gages = page.signals.reassurance
      if (!releve(gages)) return null
      if (!pageQuiVend(page.signals)) return null
      return page.signals.avisDeclares !== true && !gages.includes('avis')
    },
  },
  {
    id: 'cro.formulaire.long',
    rapide: true,
    engine: 'cro',
    scope: 'page',
    label: 'Le formulaire demande trop de choses',
    why: `Au-delà de ${CHAMPS_MAX} champs, chacun devient une occasion de renoncer. Tout ce qui peut se demander après le premier échange n’a pas à être demandé avant.`,
    severity: 'important',
    weight: 6,
    run: (page) => {
      if (!jugeable(page)) return null
      const champs = page.signals.champsMax
      if (!releve(champs) || champs === 0) return null
      return champs > CHAMPS_MAX
    },
  },
  {
    id: 'cro.mobile.viewport',
    rapide: true,
    engine: 'cro',
    scope: 'page',
    label: 'La page n’est pas prévue pour le téléphone',
    why: 'Sans déclaration d’affichage mobile, le téléphone montre la page de bureau réduite : texte minuscule, boutons impossibles à viser. C’est pourtant là que regarde la majorité des visiteurs.',
    severity: 'critical',
    weight: 9,
    run: (page) => (jugeable(page) ? !page.signals.hasViewport : null),
  },
  {
    id: 'cro.prix.absent',
    engine: 'cro',
    scope: 'page',
    label: 'Aucun prix visible sur une page qui vend',
    why: 'Un visiteur qui ne trouve pas le prix suppose le pire, ou va le chercher ailleurs. Même une fourchette vaut mieux que le silence.',
    severity: 'important',
    weight: 7,
    run: (page) => {
      if (!jugeable(page)) return null
      if (!releve(page.signals.prix)) return null
      /*
       * Jugé sur les seules pages qui ont visiblement quelque chose à vendre : une fiche
       * produit déclarée en données structurées. Étendre ce contrôle à toutes les pages
       * reprocherait l'absence de prix à un article de blog.
       */
      const fiche = page.signals.schemaTypes.includes('Product')
      if (!fiche) return null
      return page.signals.prix === false
    },
  },
]
