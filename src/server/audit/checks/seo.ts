import type { Check, PageVue } from './types'

/**
 * Les contrôles de référencement.
 *
 * Vingt-huit constats, tous calculés. Ils sont rangés dans l'ordre où quelqu'un les
 * découvrirait en regardant son site : est-ce que ça répond, est-ce que ça s'affiche
 * correctement dans les résultats, est-ce que c'est structuré, est-ce qu'il y a du contenu,
 * est-ce que les pages se tiennent entre elles, est-ce qu'une machine comprend.
 *
 * Les seuils sont écrits ici, en un seul endroit, et chacun est justifié. Un seuil sans
 * raison est un seuil que personne n'ose changer.
 */

/** Au-delà, un moteur tronque le titre au milieu d'un mot. */
const TITRE_MAX = 60
/** En deçà, le titre ne dit rien de plus que le nom du site. */
const TITRE_MIN = 25

/** Les bornes de la description, mêmes raisons. */
const DESCRIPTION_MAX = 160
const DESCRIPTION_MIN = 70

/**
 * Les bornes des balises, exposées.
 *
 * Elles servent ailleurs qu'à l'analyse du site public : une fiche produit lue directement
 * chez un marchand se juge sur les mêmes longueurs. Exposées plutôt que recopiées — deux
 * jeux de chiffres qui divergent, ce serait un produit qui dit deux choses du même texte
 * selon l'écran où on le regarde.
 */
export const BORNES_BALISES = {
  titreMin: TITRE_MIN,
  titreMax: TITRE_MAX,
  descriptionMin: DESCRIPTION_MIN,
  descriptionMax: DESCRIPTION_MAX,
} as const

/** En deçà, la page n'a rien à répondre à personne. */
const MOTS_MIN = 150

/** Au-delà, la page est lente pour une connexion mobile ordinaire. */
const LENTE_MS = 2_500

/** Au-delà, la page pèse plus qu'une page web n'a de raison de peser. */
const LOURDE_OCTETS = 1_500_000

/** Au-delà, la chaîne de redirections coûte plus qu'elle ne répare. */
const REDIRECTIONS_MAX = 1

/** Une page qui répond correctement : les autres ne se jugent pas sur leur contenu. */
function lisible(page: PageVue): boolean {
  return page.statusCode >= 200 && page.statusCode < 300
}

/** Les types de données structurées présents sur une page, en minuscules. */
function types(page: PageVue): Set<string> {
  return new Set(page.signals.schemaTypes.map((type) => type.toLowerCase()))
}

export const SEO_CHECKS: readonly Check[] = [
  // ── Est-ce que ça répond ? ────────────────────────────────────────────────
  {
    id: 'seo.https',
    engine: 'seo',
    scope: 'site',
    label: 'Le site n’est pas servi en HTTPS',
    why: "Les navigateurs affichent « non sécurisé » à côté de votre adresse, et les moteurs préfèrent systématiquement une page chiffrée à la même page en clair. C'est le premier obstacle, et le plus visible pour vos visiteurs.",
    severity: 'critical',
    weight: 10,
    run: (site) => !site.origin.startsWith('https://'),
  },
  {
    id: 'seo.http_error',
    engine: 'seo',
    scope: 'page',
    label: 'Pages qui répondent par une erreur',
    why: "Un visiteur arrive sur une page vide, et un moteur finit par la retirer de son index. Chaque lien qui y mène gaspille ce que vous avez construit.",
    severity: 'critical',
    weight: 9,
    run: (page) => page.statusCode >= 400,
  },
  {
    id: 'seo.redirects',
    engine: 'seo',
    scope: 'page',
    label: 'Pages atteintes après plusieurs redirections',
    why: "Chaque saut coûte un aller-retour au visiteur, et dilue ce que le moteur attribue à l'adresse finale. Mieux vaut faire pointer vos liens directement sur la bonne adresse.",
    severity: 'improvement',
    weight: 3,
    run: (page) => page.redirects > REDIRECTIONS_MAX,
  },
  {
    id: 'seo.slow',
    engine: 'seo',
    scope: 'page',
    label: 'Pages lentes à répondre',
    why: `Au-delà de ${LENTE_MS / 1000} secondes, une partie de vos visiteurs repart avant d'avoir vu la page. La vitesse compte pour le classement, et bien davantage pour la vente.`,
    severity: 'important',
    weight: 5,
    run: (page) => (lisible(page) ? page.fetchMs > LENTE_MS : null),
  },
  {
    id: 'seo.heavy',
    engine: 'seo',
    scope: 'page',
    label: 'Pages trop lourdes',
    why: "Une page qui pèse plus d'un mégaoctet et demi met plusieurs secondes à s'afficher sur un téléphone en 4G. C'est souvent une image non redimensionnée.",
    severity: 'improvement',
    weight: 3,
    run: (page) => (lisible(page) ? page.bytes > LOURDE_OCTETS : null),
  },
  {
    id: 'seo.robots_missing',
    engine: 'seo',
    scope: 'site',
    label: 'Aucun fichier robots.txt',
    why: "Ce fichier dit aux moteurs ce qu'ils peuvent explorer et où trouver votre plan de site. Sans lui, ils devinent — et ils devinent parfois mal, en passant du temps sur vos pages de panier plutôt que sur vos produits.",
    severity: 'improvement',
    weight: 3,
    run: (site) => !site.robotsFound,
  },
  {
    id: 'seo.sitemap_missing',
    engine: 'seo',
    scope: 'site',
    label: 'Aucun plan de site',
    why: "Le plan de site est la liste que vous faites vous-même de ce qui compte. Sans lui, un moteur ne trouve que ce qui est lié depuis vos autres pages : tout le reste peut rester invisible des années.",
    severity: 'important',
    weight: 6,
    run: (site) => !site.sitemapFound,
  },

  // ── Ce qui s'affiche dans les résultats ───────────────────────────────────
  {
    id: 'seo.title_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Pages sans titre',
    why: "Le titre est la ligne bleue sur laquelle on clique. Sans lui, le moteur en fabrique un à partir de votre code, et c'est rarement flatteur.",
    severity: 'critical',
    weight: 10,
    run: (page) => (lisible(page) ? page.signals.title.trim() === '' : null),
  },
  {
    id: 'seo.title_short',
    engine: 'seo',
    scope: 'page',
    label: 'Titres trop courts',
    why: `En dessous de ${TITRE_MIN} signes, le titre ne dit guère plus que le nom de votre site. C'est une place gratuite dans les résultats, et elle reste vide.`,
    severity: 'improvement',
    weight: 4,
    run: (page) => {
      if (!lisible(page)) return null
      const titre = page.signals.title.trim()
      return titre === '' ? null : titre.length < TITRE_MIN
    },
  },
  {
    id: 'seo.title_long',
    engine: 'seo',
    scope: 'page',
    label: 'Titres trop longs',
    why: `Au-delà d'environ ${TITRE_MAX} signes, le moteur coupe — souvent au milieu du mot qui comptait. Placez l'essentiel au début.`,
    severity: 'improvement',
    weight: 4,
    run: (page) => (lisible(page) ? page.signals.title.trim().length > TITRE_MAX : null),
  },
  {
    id: 'seo.title_duplicate',
    engine: 'seo',
    scope: 'page',
    label: 'Titres identiques sur plusieurs pages',
    why: "Deux pages qui se présentent de la même façon se font concurrence, et le moteur n'en garde généralement qu'une. L'autre disparaît sans que rien ne le signale.",
    severity: 'important',
    weight: 7,
    run: (page, contexte) => {
      if (!lisible(page)) return null
      const titre = page.signals.title.trim().toLowerCase()
      if (titre === '') return null
      return (contexte.titres.get(titre) ?? 0) > 1
    },
  },
  {
    id: 'seo.description_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Pages sans description',
    why: "Google n'a rien à afficher sous votre titre : il prend alors un bout de texte au hasard dans la page, souvent votre menu. C'est la phrase qui décide si l'on clique ou non.",
    severity: 'critical',
    weight: 9,
    run: (page) => (lisible(page) ? page.signals.description.trim() === '' : null),
  },
  {
    id: 'seo.description_short',
    engine: 'seo',
    scope: 'page',
    label: 'Descriptions trop courtes',
    why: `En dessous de ${DESCRIPTION_MIN} signes, vous laissez de la place inutilisée juste sous votre titre, là où se décide le clic.`,
    severity: 'improvement',
    weight: 3,
    run: (page) => {
      if (!lisible(page)) return null
      const description = page.signals.description.trim()
      return description === '' ? null : description.length < DESCRIPTION_MIN
    },
  },
  {
    id: 'seo.description_long',
    engine: 'seo',
    scope: 'page',
    label: 'Descriptions trop longues',
    why: `Au-delà d'environ ${DESCRIPTION_MAX} signes, la fin est coupée. Ce qui compte doit tenir dans la première phrase.`,
    severity: 'improvement',
    weight: 3,
    run: (page) => (lisible(page) ? page.signals.description.trim().length > DESCRIPTION_MAX : null),
  },
  {
    id: 'seo.description_duplicate',
    engine: 'seo',
    scope: 'page',
    label: 'Descriptions identiques sur plusieurs pages',
    why: "La même phrase sous plusieurs résultats ne distingue rien. Chaque page a une raison d'exister : la description est l'endroit où la dire.",
    severity: 'important',
    weight: 5,
    run: (page, contexte) => {
      if (!lisible(page)) return null
      const description = page.signals.description.trim().toLowerCase()
      if (description === '') return null
      return (contexte.descriptions.get(description) ?? 0) > 1
    },
  },

  // ── La structure ──────────────────────────────────────────────────────────
  {
    id: 'seo.h1_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Pages sans titre principal',
    why: "Le titre principal est la première chose qu'un moteur lit pour comprendre de quoi parle la page. Sans lui, il se rabat sur ce qu'il trouve, et se trompe souvent.",
    severity: 'important',
    weight: 7,
    run: (page) => (lisible(page) ? page.signals.h1.length === 0 : null),
  },
  {
    id: 'seo.h1_multiple',
    engine: 'seo',
    scope: 'page',
    label: 'Pages avec plusieurs titres principaux',
    why: "Plusieurs titres principaux, c'est plusieurs sujets annoncés : le moteur ne sait plus lequel est le vôtre. Un seul, puis des sous-titres.",
    severity: 'improvement',
    weight: 3,
    run: (page) => (lisible(page) ? page.signals.h1.length > 1 : null),
  },
  {
    id: 'seo.heading_gap',
    engine: 'seo',
    scope: 'page',
    label: 'Niveaux de titres sautés',
    why: "Passer d'un titre principal à un sous-sous-titre casse le plan de la page. Les moteurs — et les lecteurs d'écran — s'y perdent.",
    severity: 'improvement',
    weight: 2,
    run: (page) => {
      if (!lisible(page)) return null
      const niveaux = page.signals.headings.map((titre) => titre.level)
      if (niveaux.length === 0) return null
      let precedent = niveaux[0] as number
      for (const niveau of niveaux.slice(1)) {
        if (niveau > precedent + 1) return true
        precedent = niveau
      }
      return false
    },
  },
  {
    id: 'seo.no_subheadings',
    engine: 'seo',
    scope: 'page',
    label: 'Pages longues sans sous-titres',
    why: "Un texte long d'un seul bloc se lit mal et se survole encore plus mal. Des sous-titres donnent des prises, au lecteur comme au moteur.",
    severity: 'improvement',
    weight: 2,
    run: (page) => {
      if (!lisible(page) || page.signals.wordCount < 400) return null
      return page.signals.headings.filter((titre) => titre.level === 2).length === 0
    },
  },
  {
    id: 'seo.lang_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Langue de la page non déclarée',
    why: "Sans cette indication, un moteur devine la langue — et peut proposer votre page à des gens qui ne la parlent pas, ou l'écarter de ceux qui la parlent.",
    severity: 'improvement',
    weight: 3,
    run: (page) => (lisible(page) ? page.signals.lang.trim() === '' : null),
  },
  {
    id: 'seo.viewport_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Pages non adaptées au téléphone',
    why: "Sans cette déclaration, un téléphone affiche la page comme sur un écran d'ordinateur, en tout petit. La majorité de vos visiteurs sont sur mobile, et les moteurs classent d'après cette version.",
    severity: 'critical',
    weight: 8,
    run: (page) => (lisible(page) ? !page.signals.hasViewport : null),
  },

  // ── Le contenu ────────────────────────────────────────────────────────────
  {
    id: 'seo.thin_content',
    engine: 'seo',
    scope: 'page',
    label: 'Pages presque vides',
    why: `Moins de ${MOTS_MIN} mots, c'est une page qui ne répond à aucune question. Un moteur n'a aucune raison de la proposer plutôt qu'une autre.`,
    severity: 'important',
    weight: 6,
    run: (page) => (lisible(page) ? page.signals.wordCount < MOTS_MIN : null),
  },
  {
    id: 'seo.image_alt_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Images sans texte alternatif',
    why: "Le texte alternatif dit ce que montre l'image. Il sert aux personnes qui n'y voient pas, à la recherche d'images, et à tout visiteur dont la photo ne charge pas.",
    severity: 'improvement',
    weight: 4,
    run: (page) => {
      if (!lisible(page) || page.signals.images.length === 0) return null
      // Un ALT vide est une décision — image décorative — et non un oubli.
      return page.signals.images.some((image) => image.alt === null)
    },
  },

  // ── Les liens ─────────────────────────────────────────────────────────────
  {
    id: 'seo.no_internal_links',
    engine: 'seo',
    scope: 'page',
    label: 'Pages qui ne mènent nulle part',
    why: "Une page sans lien vers le reste du site est une impasse : le visiteur repart, et le moteur n'a rien à explorer plus loin.",
    severity: 'improvement',
    weight: 3,
    run: (page) =>
      lisible(page) ? page.signals.links.filter((lien) => lien.interne).length === 0 : null,
  },
  {
    id: 'seo.orphan',
    engine: 'seo',
    scope: 'page',
    label: 'Pages vers lesquelles rien ne pointe',
    why: "Aucune autre page ne mène à celle-ci. Un visiteur ne peut y arriver qu'en connaissant son adresse, et un moteur ne la trouve que par le plan de site — quand il y en a un.",
    severity: 'important',
    weight: 5,
    run: (page, contexte) => {
      // L'accueil n'est orphelin de personne : c'est le point d'entrée.
      if (page.depth === 0) return null
      return (contexte.entrants.get(page.url) ?? 0) === 0
    },
  },
  {
    id: 'seo.broken_internal_link',
    engine: 'seo',
    scope: 'page',
    label: 'Pages contenant un lien interne cassé',
    why: "Un lien qui mène à une erreur fait perdre le visiteur et gaspille l'exploration du moteur. C'est le défaut le plus facile à corriger, et le plus désagréable à rencontrer.",
    severity: 'important',
    weight: 6,
    run: (page, contexte) => {
      if (!lisible(page)) return null
      return page.signals.links.some((lien) => {
        if (!lien.interne || lien.url === '') return false
        const statut = contexte.connues.get(lien.url)
        // Une adresse non explorée n'est pas cassée : on ne juge que ce qu'on a vu.
        return statut !== undefined && statut >= 400
      })
    },
  },

  // ── Ce qu'une machine comprend ────────────────────────────────────────────
  {
    id: 'seo.canonical_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Pages sans adresse canonique',
    why: "La même page est souvent accessible par plusieurs adresses — avec ou sans barre finale, avec des paramètres de suivi. L'adresse canonique dit laquelle compte, et évite qu'elles se fassent concurrence.",
    severity: 'improvement',
    weight: 4,
    run: (page) => (lisible(page) ? page.signals.canonical.trim() === '' : null),
  },
  {
    id: 'seo.jsonld_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Pages sans données structurées',
    why: "Les données structurées disent en clair à une machine ce que la page contient : un produit, un article, une entreprise. C'est ce qui permet les résultats enrichis — prix, avis, questions — qui prennent plus de place dans les résultats.",
    severity: 'important',
    weight: 6,
    run: (page) => (lisible(page) ? page.signals.schemaTypes.length === 0 : null),
  },
  {
    id: 'seo.jsonld_broken',
    engine: 'seo',
    scope: 'page',
    label: 'Données structurées illisibles',
    why: "Le bloc existe mais ne se lit pas : un moteur l'ignore purement et simplement. Tout le travail fait pour le poser ne sert à rien.",
    severity: 'important',
    weight: 5,
    run: (page) => (lisible(page) ? page.signals.jsonLdBroken > 0 : null),
  },
  {
    id: 'seo.organization_missing',
    engine: 'seo',
    scope: 'page',
    label: 'L’entreprise n’est pas identifiée sur l’accueil',
    why: "Sans une entité Organization ou LocalBusiness, une machine ne sait pas qui vous êtes, où vous êtes ni comment vous joindre. C'est ce qui alimente la fiche à droite des résultats.",
    severity: 'important',
    weight: 6,
    run: (page) => {
      // Ce contrôle ne concerne que l'accueil : c'est là que l'identité se déclare.
      if (page.depth !== 0 || !lisible(page)) return null
      const presents = types(page)
      return !['organization', 'localbusiness', 'professionalservice', 'store', 'restaurant'].some(
        (type) => presents.has(type),
      )
    },
  },
  {
    id: 'seo.breadcrumb_missing',
    engine: 'seo',
    scope: 'page',
    label: 'Pages profondes sans fil d’Ariane',
    why: "Le fil d'Ariane montre où l'on se trouve dans le site. Déclaré en données structurées, il remplace l'adresse dans les résultats de recherche par un chemin lisible.",
    severity: 'improvement',
    weight: 2,
    run: (page) => {
      if (page.depth < 2 || !lisible(page)) return null
      return !types(page).has('breadcrumblist')
    },
  },
]
