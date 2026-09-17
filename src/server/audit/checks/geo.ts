import type { Signaux } from '../extract'
import type { Check, Contexte, PageVue } from './types'

/**
 * Les contrôles de visibilité dans les assistants.
 *
 * Dix-huit constats, tous calculés, tous distincts de ceux du référencement. La question
 * n'est plus « est-ce que ce site se classe » mais « est-ce qu'une machine qui doit répondre
 * à quelqu'un peut se servir de cette page ». Ce n'est pas le même travail : un site peut
 * être irréprochable pour Google et rester inexploitable pour un assistant, parce qu'il ne
 * dit jamais qui le publie, ne répond à aucune question formulée, et se présente en blocs de
 * texte sans prise.
 *
 * **Une précision qui n'est pas une prudence de façade.** Aucun de ces contrôles ne promet
 * une apparition dans ChatGPT, Gemini ou Perplexity. Personne ne connaît leurs critères,
 * personne ne les contrôle, et ils changent. Ce que mesure cette note, c'est une aptitude :
 * un site bien noté est exploitable, un site mal noté ne l'est pas. Les formulations de
 * `why` s'y tiennent — aucune ne doit être réécrite en garantie.
 *
 * Les seuils sont ici, en un seul endroit, chacun avec sa raison.
 */

/** En deçà, la page n'a pas de quoi alimenter une réponse, même bien écrite. */
const CITABLE_MIN = 300

/** Une page substantielle. En deçà, on ne lui reproche ni son auteur ni sa date. */
const SUBSTANTIELLE = 500

/** Un contenu de fond. À cette longueur, ne pas le déclarer comme tel devient un manque. */
const ARTICLE_MIN = 700

/** Au-delà, un texte sans liste ni tableau n'offre plus aucune prise. */
const PAVE_MIN = 400

/** Au-delà, le paragraphe ne peut plus être repris tel quel dans une réponse. */
const PARAGRAPHE_MAX_MOTS = 120

/** En deçà, la première phrase n'annonce rien : elle accueille. */
const INTRO_MIN_SIGNES = 120

/** Le minimum de titres-questions pour qu'une page mérite d'être déclarée en FAQ. */
const QUESTIONS_POUR_FAQ = 2

/** En deçà, la page n'avance aucun fait vérifiable — un numéro de téléphone ne compte pas. */
const CHIFFRES_MIN = 3

/** Ce qu'un titre ne dit pas. Hors de son site, aucun de ces mots n'apprend quoi que ce soit. */
const TITRES_MUETS = new Set([
  'accueil',
  'home',
  'bienvenue',
  'welcome',
  'index',
  'sans titre',
  'page sans titre',
  'untitled',
  'nouvelle page',
  'new page',
  'blog',
  'articles',
  'actualités',
  'actualites',
  'news',
])

/** Une page qui répond correctement : les autres ne se jugent pas sur leur contenu. */
function lisible(page: PageVue): boolean {
  return page.statusCode >= 200 && page.statusCode < 300
}

/** Les types de données structurées présents sur une page, en minuscules. */
function types(page: PageVue): Set<string> {
  return new Set(page.signals.schemaTypes.map((type) => type.toLowerCase()))
}

/**
 * Un relevé peut venir d'un audit antérieur à un champ.
 *
 * Les signaux sont conservés tels qu'ils ont été relevés, et un audit de la semaine dernière
 * ne connaît pas les champs ajoutés depuis. Lire `undefined` comme un zéro reprocherait à ces
 * audits des défauts qu'ils n'ont jamais pu avoir ; on préfère s'abstenir.
 */
function releve(
  signaux: Signaux,
  champ: 'paragraphs' | 'longestParagraphWords' | 'definitions',
): number | null {
  const valeur = signaux[champ] as number | undefined
  return typeof valeur === 'number' ? valeur : null
}

/** Ce qui ressemble à une question, en français comme en anglais. */
const INTERROGATIFS =
  /^(comment|pourquoi|quand|où|quel|quelle|quels|quelles|qui|qu[’']est-ce|c[’']est quoi|combien|faut-il|peut-on|puis-je|doit-on|est-ce|what|how|why|when|where|which|who|can|should|do|does|is|are)\b/i

function estUneQuestion(texte: string): boolean {
  const propre = texte.trim()
  if (propre === '') return false
  return propre.endsWith('?') || INTERROGATIFS.test(propre)
}

/** Les titres d'une page formulés comme une question. */
function questionsDe(page: PageVue): number {
  return page.signals.headings.filter((titre) => titre.level >= 2 && estUneQuestion(titre.text))
    .length
}

/** Toutes les entités déclarées sur le site, à plat. */
function entites(contexte: Contexte): Record<string, unknown>[] {
  return contexte.pages.flatMap((page) => page.signals.jsonLd)
}

/** L'entité qui identifie l'entreprise, si elle est déclarée quelque part. */
const TYPES_IDENTITE = [
  'organization',
  'localbusiness',
  'professionalservice',
  'store',
  'restaurant',
  'person',
]

function identite(contexte: Contexte): Record<string, unknown> | null {
  for (const entite of entites(contexte)) {
    const trouvee = chercherIdentite(entite)
    if (trouvee !== null) return trouvee
  }
  return null
}

function chercherIdentite(valeur: unknown, profondeur = 0): Record<string, unknown> | null {
  if (profondeur > 6 || valeur === null || typeof valeur !== 'object') return null
  if (Array.isArray(valeur)) {
    for (const entree of valeur) {
      const trouvee = chercherIdentite(entree, profondeur + 1)
      if (trouvee !== null) return trouvee
    }
    return null
  }
  const objet = valeur as Record<string, unknown>
  const type = objet['@type']
  const declares = typeof type === 'string' ? [type] : Array.isArray(type) ? type : []
  for (const declare of declares) {
    if (typeof declare === 'string' && TYPES_IDENTITE.includes(declare.toLowerCase())) return objet
  }
  for (const [cle, sous] of Object.entries(objet)) {
    if (cle === '@context') continue
    const trouvee = chercherIdentite(sous, profondeur + 1)
    if (trouvee !== null) return trouvee
  }
  return null
}

/** Vrai si la propriété existe et porte quelque chose. */
function renseignee(entite: Record<string, unknown>, propriete: string): boolean {
  const valeur = entite[propriete]
  if (valeur === null || valeur === undefined) return false
  if (typeof valeur === 'string') return valeur.trim() !== ''
  if (Array.isArray(valeur)) return valeur.length > 0
  return typeof valeur === 'object'
}

export const GEO_CHECKS: readonly Check[] = [
  // ── Une machine a-t-elle seulement le droit de lire ? ──────────────────────
  {
    id: 'geo.ai_blocked',
    engine: 'geo',
    scope: 'site',
    label: 'Votre fichier robots.txt écarte les robots des assistants',
    why: "Votre site leur interdit nommément l'accès : quoi que vous publiiez, ils ne le liront pas. Ces lignes sont très souvent posées sans le savoir, par un thème ou une extension, et les retirer est l'action la plus rentable de tout cet audit.",
    severity: 'critical',
    weight: 10,
    run: (site) => {
      // Un audit mené avant que ce relevé n'existe ne permet pas de conclure.
      if (site.aiBlocked === undefined) return null
      return site.aiBlocked.length > 0
    },
  },
  {
    id: 'geo.noai_meta',
    engine: 'geo',
    scope: 'page',
    label: 'Pages marquées comme à ne pas réutiliser par une IA',
    why: "Une balise demande explicitement aux assistants de ne pas se servir de cette page. Si c'est un choix, il est respecté ; si c'est un réglage hérité de votre thème, il vous prive de réponses sans rien vous apporter.",
    severity: 'important',
    weight: 4,
    run: (page) => (lisible(page) ? /\bno(image)?ai\b/i.test(page.signals.robotsMeta) : null),
  },

  // ── Sait-on qui parle ? ───────────────────────────────────────────────────
  {
    id: 'geo.entity_incomplete',
    engine: 'geo',
    scope: 'site',
    label: 'Votre identité est déclarée mais incomplète',
    why: "Votre nom est là, mais ni adresse, ni téléphone, ni lien vers vos profils. Un assistant qui cite une entreprise vérifie d'abord qu'elle existe ailleurs que sur son propre site : sans ces points d'ancrage, il préfère en citer une autre.",
    severity: 'important',
    weight: 6,
    run: (_site, contexte) => {
      const entite = identite(contexte)
      // Aucune entité du tout : le constat appartient au référencement, pas ici.
      if (entite === null) return null
      const ancres = ['address', 'telephone', 'sameAs', 'email', 'url'].filter((propriete) =>
        renseignee(entite, propriete),
      )
      return ancres.length < 2
    },
  },
  {
    id: 'geo.no_contact',
    engine: 'geo',
    scope: 'site',
    label: 'Aucun moyen de vous joindre n’est repérable',
    why: "Ni adresse e-mail, ni téléphone, ni page de contact trouvés dans les pages explorées. Une machine en conclut qu'elle ne peut pas orienter quelqu'un vers vous, et vos visiteurs en tirent la même conclusion.",
    severity: 'important',
    weight: 6,
    run: (_site, contexte) =>
      !contexte.pages.some((page) => {
        if (/\/(contact|nous-contacter|contactez)/i.test(page.path)) return true
        return page.signals.links.some((lien) => /^(mailto:|tel:)/i.test(lien.href))
      }),
  },
  {
    id: 'geo.no_about',
    engine: 'geo',
    scope: 'site',
    label: 'Aucune page ne raconte qui vous êtes',
    why: "Une page « à propos » est ce qu'une machine lit pour savoir de quoi vous êtes légitime à parler. Sans elle, elle ne dispose que de vos pages commerciales, et vous traite comme un catalogue plutôt que comme une source.",
    severity: 'improvement',
    weight: 3,
    run: (_site, contexte) =>
      !contexte.pages.some((page) =>
        /\/(a-propos|à-propos|apropos|about|qui-sommes-nous|notre-histoire|equipe|équipe)/i.test(
          page.path,
        ),
      ),
  },

  // ── La page répond-elle à quelque chose ? ─────────────────────────────────
  {
    id: 'geo.no_questions',
    engine: 'geo',
    scope: 'site',
    label: 'Aucune page ne répond à une question posée',
    why: "Les assistants sont interrogés en phrases : « comment choisir », « combien coûte », « quelle différence entre ». Un site dont aucun intertitre ne reprend une de ces formulations n'offre rien à rapprocher de ce qu'on leur demande.",
    severity: 'important',
    weight: 7,
    run: (_site, contexte) => !contexte.pages.some((page) => questionsDe(page) > 0),
  },
  {
    id: 'geo.faq_not_declared',
    engine: 'geo',
    scope: 'page',
    label: 'Questions présentes mais non déclarées comme telles',
    why: "Vos intertitres posent des questions, et c'est bien — mais rien ne dit à une machine que ce sont des questions et que ce qui suit est la réponse. Le déclarer transforme une page de texte en réponses identifiables une par une.",
    severity: 'important',
    weight: 5,
    run: (page) => {
      if (!lisible(page) || questionsDe(page) < QUESTIONS_POUR_FAQ) return null
      const presents = types(page)
      return !['faqpage', 'qapage', 'question', 'howto'].some((type) => presents.has(type))
    },
  },
  {
    id: 'geo.no_intro',
    engine: 'geo',
    scope: 'page',
    label: 'Pages qui n’annoncent pas leur réponse',
    why: "Les premières lignes n'apprennent rien : une phrase d'accueil, un slogan, puis le sujet arrive plus bas. C'est précisément ce début qu'une machine lit pour décider si la page répond à la question posée — et elle décide vite.",
    severity: 'important',
    weight: 8,
    run: (page) => {
      if (!lisible(page) || page.signals.wordCount < CITABLE_MIN) return null
      const intro = page.signals.intro as string | undefined
      // Relevé absent : audit antérieur à ce champ, rien à reprocher.
      if (intro === undefined) return null
      return intro.trim().length < INTRO_MIN_SIGNES
    },
  },
  {
    id: 'geo.duplicate_intro',
    engine: 'geo',
    scope: 'page',
    label: 'Pages qui commencent toutes pareil',
    why: "Plusieurs pages ouvrent sur le même paragraphe. Une machine qui doit en choisir une pour répondre ne voit aucune différence entre elles, et les écarte toutes plutôt que d'en citer une au hasard.",
    severity: 'improvement',
    weight: 4,
    run: (page, contexte) => {
      const intro = page.signals.intro as string | undefined
      if (!lisible(page) || intro === undefined || intro.trim().length < INTRO_MIN_SIGNES) {
        return null
      }
      const empreinte = intro.trim().toLowerCase()
      const jumelles = contexte.pages.filter((autre) => {
        const autreIntro = (autre.signals.intro as string | undefined)?.trim().toLowerCase()
        return autreIntro === empreinte
      })
      return jumelles.length > 1
    },
  },

  // ── Le texte est-il exploitable ? ─────────────────────────────────────────
  {
    id: 'geo.wall_of_text',
    engine: 'geo',
    scope: 'page',
    label: 'Pages longues sans liste ni tableau',
    why: "Un texte continu se cite mal : une machine doit en extraire elle-même les étapes, les critères ou les tarifs, et elle se trompe. Une liste ou un tableau lui donne exactement ce qu'elle reprendra.",
    severity: 'important',
    weight: 7,
    run: (page) => {
      if (!lisible(page) || page.signals.wordCount < PAVE_MIN) return null
      return page.signals.lists === 0 && page.signals.tables === 0
    },
  },
  {
    id: 'geo.long_paragraphs',
    engine: 'geo',
    scope: 'page',
    label: 'Paragraphes trop longs pour être repris',
    why: `Un paragraphe de plus de ${PARAGRAPHE_MAX_MOTS} mots ne peut plus être cité tel quel : il faut le résumer, donc l'interpréter, donc risquer de vous faire dire autre chose. Des paragraphes courts se recopient sans déformation.`,
    severity: 'improvement',
    weight: 4,
    run: (page) => {
      if (!lisible(page)) return null
      const plusLong = releve(page.signals, 'longestParagraphWords')
      if (plusLong === null) return null
      return plusLong > PARAGRAPHE_MAX_MOTS
    },
  },
  {
    id: 'geo.not_quotable',
    engine: 'geo',
    scope: 'page',
    label: 'Pages trop courtes pour alimenter une réponse',
    why: `En deçà de ${CITABLE_MIN} mots, une page peut très bien se classer dans les résultats et rester inutilisable pour un assistant : il n'y trouve pas de quoi construire un paragraphe de réponse.`,
    severity: 'improvement',
    weight: 4,
    run: (page) => (lisible(page) ? page.signals.wordCount < CITABLE_MIN : null),
  },
  {
    id: 'geo.no_figures',
    engine: 'geo',
    scope: 'page',
    label: 'Pages sans aucune donnée chiffrée',
    why: "Prix, durées, quantités, années : les assistants privilégient ce qui se vérifie. Une page qui n'avance que des qualificatifs — « rapide », « sur mesure », « de qualité » — n'offre rien à reprendre et rien à recouper.",
    severity: 'improvement',
    weight: 3,
    run: (page) => {
      if (!lisible(page) || page.signals.wordCount < CITABLE_MIN) return null
      return (page.signals.text.match(/\d+/g) ?? []).length < CHIFFRES_MIN
    },
  },
  {
    id: 'geo.no_definitions',
    engine: 'geo',
    scope: 'site',
    label: 'Aucun terme de votre métier n’est expliqué',
    why: "Ni liste de définitions, ni intertitre du type « qu'est-ce que ». Expliquer le vocabulaire de votre métier est la matière que les assistants reprennent le plus volontiers, parce qu'elle est courte, autonome et attribuable.",
    severity: 'improvement',
    weight: 3,
    run: (_site, contexte) =>
      !contexte.pages.some((page) => {
        if ((releve(page.signals, 'definitions') ?? 0) > 0) return true
        return page.signals.headings.some((titre) =>
          /(qu[’']est-ce|c[’']est quoi|définition|definition|que signifie)/i.test(titre.text),
        )
      }),
  },

  // ── La page se comprend-elle hors de son site ? ───────────────────────────
  {
    id: 'geo.title_generic',
    engine: 'geo',
    scope: 'page',
    label: 'Titres qui ne disent rien hors du site',
    why: "« Accueil », « Bienvenue », « Blog » : sortis de votre menu, ces titres n'apprennent rien. Une machine s'en sert pour savoir de quoi traite la page — et conclut qu'elle ne traite de rien.",
    severity: 'improvement',
    weight: 4,
    run: (page) => {
      if (!lisible(page)) return null
      const premier = page.signals.h1[0] ?? page.signals.title
      const propre = premier
        .toLowerCase()
        .replace(/[!.…]+$/g, '')
        .trim()
      if (propre === '') return null
      return TITRES_MUETS.has(propre)
    },
  },
  {
    id: 'geo.author_missing',
    engine: 'geo',
    scope: 'page',
    label: 'Contenus de fond sans auteur identifié',
    why: "Un texte long sans signature n'est rattaché à personne. Les assistants pondèrent lourdement l'origine de ce qu'ils reprennent : à contenu égal, une page signée passe avant une page anonyme.",
    severity: 'important',
    weight: 6,
    run: (page) => {
      if (!lisible(page) || page.signals.wordCount < SUBSTANTIELLE) return null
      return page.signals.author.trim() === ''
    },
  },
  {
    id: 'geo.date_missing',
    engine: 'geo',
    scope: 'page',
    label: 'Contenus de fond sans date',
    why: "Sans date, impossible de savoir si l'information vaut encore. Une machine qui hésite entre deux sources prend celle qui est datée, même quand l'autre est meilleure — et une page de 2019 bien datée est préférée à une page indatable.",
    severity: 'important',
    weight: 5,
    run: (page) => {
      if (!lisible(page) || page.signals.wordCount < SUBSTANTIELLE) return null
      return page.signals.publishedTime.trim() === ''
    },
  },
  {
    id: 'geo.article_not_marked',
    engine: 'geo',
    scope: 'page',
    label: 'Contenus longs non déclarés comme tels',
    why: "Rien ne distingue cette page d'une page de catalogue : ni article, ni guide, ni recette. Le déclarer indique à une machine qu'il y a là un contenu à lire, et lui rattache d'un coup l'auteur, la date et le sujet.",
    severity: 'improvement',
    weight: 4,
    run: (page) => {
      if (!lisible(page) || page.signals.wordCount < ARTICLE_MIN) return null
      const presents = types(page)
      return ![
        'article',
        'blogposting',
        'newsarticle',
        'techarticle',
        'howto',
        'recipe',
        'faqpage',
        'qapage',
      ].some((type) => presents.has(type))
    },
  },
]
