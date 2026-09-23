import { z } from 'zod'
import { SEUILS_REDACTION } from '@/server/audit/checks/geo'
import { STYLE_PRESET_IDS, TEMPLATE_KINDS } from '@/server/spec/templates'
import {
  BLOCK_SCHEMAS,
  BLOCK_TYPES,
  blockSchema,
  type BlockType,
  dataModelSchema,
  monetizationSchema,
  navigationSchema,
  themeSchema,
} from '@/server/spec/schema'

/**
 * Contrats de sortie de l'assistant.
 *
 * Chaque schéma sert deux fois : il contraint la réponse du modèle (sorties structurées)
 * et il type le résultat côté TypeScript. Une réponse non conforme n'atteint jamais la
 * base de données.
 */

export const blueprintSchema = z
  .object({
    /** Faux si l'idée sort du champ de ce que la plateforme sait construire. */
    feasible: z.boolean(),
    appName: z.string().min(1).max(60),
    tagline: z.string().min(1).max(160),
    concept: z.string().min(1).max(600),
    description: z.string().min(1).max(1500),
    features: z
      .array(z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(300) }))
      .min(2)
      .max(8),
    monetization: z
      .array(
        z.object({
          model: z.enum(['free', 'one_time', 'subscription', 'freemium', 'credits']),
          label: z.string().min(1).max(80),
          rationale: z.string().min(1).max(300),
        }),
      )
      .min(1)
      .max(4),
    templateKind: z.enum(TEMPLATE_KINDS),
    themePreset: z.enum(STYLE_PRESET_IDS),
    /** Ce que la plateforme ne sait pas faire pour cette idée. Dit franchement. */
    limitations: z.array(z.string().min(1).max(200)).max(5),
  })
  .strict()

export type Blueprint = z.infer<typeof blueprintSchema>

/** Échelle commune à tous les indicateurs qualitatifs, pour rester comparable. */
export const LEVELS = ['faible', 'moyen', 'fort'] as const

export const BUSINESS_MODELS = ['one_time', 'subscription', 'freemium', 'credits'] as const
export const PRICE_INTERVALS = ['once', 'month', 'year'] as const

/**
 * Idée proposée au créateur.
 *
 * Les grandeurs commerciales sont des **nombres**, pas des phrases : c'est ce qui permet
 * de comparer deux idées et d'en déduire un nombre de clients. Le modèle ne calcule jamais
 * ce nombre lui-même — c'est la plateforme qui le fait, à partir du prix et de l'objectif
 * (voir server/business/economics.ts).
 */
export const ideaSuggestionSchema = z
  .object({
    title: z.string().min(1).max(80),
    problem: z.string().min(1).max(400),
    audience: z.string().min(1).max(200),
    valueProposition: z.string().min(1).max(300),
    features: z.array(z.string().min(1).max(120)).min(3).max(6),
    businessModel: z.enum(BUSINESS_MODELS),
    /** Prix conseillé, en centimes. */
    recommendedPriceCents: z.number().int().min(0).max(500_000),
    priceInterval: z.enum(PRICE_INTERVALS),
    /** Note d'opportunité globale, de 0 à 100. */
    opportunityScore: z.number().int().min(0).max(100),
    demandLevel: z.enum(LEVELS),
    competitionLevel: z.enum(LEVELS),
    complexityLevel: z.enum(LEVELS),
    operatingCostLevel: z.enum(LEVELS),
    /** Délai réaliste avant une première version présentable, en semaines. */
    timeToMarketWeeks: z.number().int().min(1).max(26),
    /**
     * Coût de fonctionnement mensuel estimé de l'application une fois lancée, en centimes
     * (hébergement, encaissement, e-mails, nom de domaine). Zéro est une réponse valable.
     */
    runningCostCents: z.number().int().min(0).max(100_000),
    risks: z.array(z.string().min(1).max(200)).min(1).max(3),
    differentiators: z.array(z.string().min(1).max(200)).min(1).max(3),
  })
  .strict()

export type IdeaSuggestion = z.infer<typeof ideaSuggestionSchema>

export const ideasSchema = z
  .object({ ideas: z.array(ideaSuggestionSchema).min(3).max(5) })
  .strict()

export type Ideas = z.infer<typeof ideasSchema>

/**
 * Des questions qu'un client poserait à un assistant.
 *
 * Aucune longueur minimale n'est imposée ici, et c'est une leçon payée : les sorties
 * structurées ne transmettent pas les contraintes de chaîne au modèle — elles sont
 * retirées du schéma envoyé et vérifiées après coup. Un minimum ne contraint donc rien et
 * ne fait que rejeter. Ce qu'on attend se dit dans la consigne, pas dans le schéma.
 */
export const questionSuggereeSchema = z
  .object({
    question: z.string().max(300),
    /** Le regroupement : « Conseils », « Produits », « Comparaisons », « Confiance »… */
    theme: z.string().max(60),
    /** Code de langue à deux lettres, celui dans lequel la question est écrite. */
    langue: z.string().max(5),
    /** Sur quoi elle s'appuie : une recherche réelle, une fiche, ou rien. */
    fondement: z.string().max(200),
  })
  .strict()

/**
 * Un morceau d'annonce proposé.
 *
 * Aucune longueur minimale ni maximale dans le schéma : les sorties structurées ne
 * transmettent pas les contraintes de chaîne au modèle, elles ne font que rejeter après
 * coup — et rejeter une réponse entière parce qu'un titre fait trente et un caractères
 * coûterait l'appel pour rien. La limite se dit dans la consigne et se vérifie ensuite,
 * morceau par morceau : ceux qui dépassent sont écartés, les autres restent.
 */
export const elementProposeSchema = z
  .object({
    /** titre | titre-long | description */
    champ: z.enum(['titre', 'titre-long', 'description']),
    texte: z.string().max(300),
    /**
     * Sur quoi il s'appuie : une recherche réelle, un produit, un angle absent des autres.
     *
     * C'est ce qui rend la proposition discutable. « Reprend la recherche "bougie quartz
     * rose", 340 affichages » se vérifie ; un titre seul ne se vérifie pas, il se subit.
     */
    motif: z.string().max(200),
  })
  .strict()

export const elementsProposesSchema = z
  .object({ elements: z.array(elementProposeSchema).max(30) })
  .strict()

export type ElementsProposes = z.infer<typeof elementsProposesSchema>

export const questionsSuggereesSchema = z
  .object({ questions: z.array(questionSuggereeSchema).max(24) })
  .strict()

export type QuestionsSuggerees = z.infer<typeof questionsSuggereesSchema>

/**
 * Le point hebdomadaire de Léa.
 *
 * Trois actions au plus, et c'est la contrainte qui fait la valeur : une liste de douze
 * choses à faire est une liste qu'on ne commence pas. Chaque action porte le fait mesuré
 * qui la justifie — sans lui, c'est un conseil de magazine, et la personne n'a aucun moyen
 * de juger s'il la concerne.
 *
 * Aucune longueur minimale dans le schéma : les sorties structurées ne transmettent pas les
 * contraintes de chaîne au modèle, elles ne font que rejeter après coup. Ce qu'on attend se
 * dit dans la consigne.
 */
export const actionPointSchema = z
  .object({
    quoi: z.string().max(200),
    /** Le fait mesuré qui la justifie, repris tel quel. */
    pourquoi: z.string().max(300),
    /** audit | seo | geo | content : le spécialiste qui la porte. */
    qui: z.enum(['audit', 'seo', 'geo', 'content']),
  })
  .strict()

export const pointHebdoSchema = z
  .object({
    etat: z.string().max(1200),
    actions: z.array(actionPointSchema).max(3),
    /** Une phrase par spécialiste concerné, versée dans la mémoire de l'équipe. */
    retenir: z.array(z.string().max(200)).max(4),
  })
  .strict()

export type PointHebdoIA = z.infer<typeof pointHebdoSchema>

/**
 * Le résumé d'Oria.
 *
 * Des phrases plutôt qu'un paragraphe : c'est ce qui rend « cinq au plus » vérifiable par
 * le schéma au lieu d'être une consigne qu'un modèle peut oublier. Une sixième phrase est
 * un refus de la réponse, pas une tolérance.
 */
export const oriaResumeSchema = z
  .object({
    phrases: z.array(z.string().min(3).max(320)).min(1).max(5),
  })
  .strict()

export type OriaResumeIA = z.infer<typeof oriaResumeSchema>

/**
 * Une opportunité du Radar.
 *
 * C'est une idée, avec ce qui la rend explicable : pourquoi elle convient à CETTE
 * personne, pourquoi maintenant, ce qu'il faudrait vérifier avant d'y croire. Le modèle
 * qualifie les composantes — demande, concurrence, complexité, monétisation — mais ne
 * pondère rien : le score est calculé par la plateforme (server/radar/score.ts).
 */
export const radarSuggestionSchema = ideaSuggestionSchema
  .omit({ opportunityScore: true })
  .extend({
    /** Le modèle ne note pas : il qualifie. La note vient de la plateforme. */
    monetizationLevel: z.enum(LEVELS),
    /**
     * Pourquoi cette personne. Des phrases qui citent des faits de son profil, pas des
     * généralités : « Vous avez douze ans dans le bâtiment », jamais « Ce secteur est
     * porteur ».
     */
    whyYou: z.array(z.string().min(10).max(220)).min(2).max(4),
    /**
     * Pourquoi maintenant. En V1 c'est une interprétation, et l'écran le dit ; la V2 y
     * accrochera des signaux observés, avec leur source et leur date.
     */
    whyNow: z.string().min(10).max(400),
    keyAdvantage: z.string().min(10).max(220),
    mainRisk: z.string().min(10).max(220),
    /** Ce qu'il faudrait vérifier avant d'y croire. Des questions, pas des affirmations. */
    validationQuestions: z.array(z.string().min(10).max(200)).min(2).max(4),
  })
  .strict()

export type RadarSuggestion = z.infer<typeof radarSuggestionSchema>

export const radarSchema = z
  .object({ opportunities: z.array(radarSuggestionSchema).min(3).max(6) })
  .strict()

export type RadarOutput = z.infer<typeof radarSchema>

/**
 * Synthèse d'une comparaison. Elle conclut au conditionnel et par priorité — « si votre
 * priorité est X, A semble la plus cohérente » — jamais par un classement absolu.
 */
export const radarComparisonSchema = z
  .object({
    /** Une phrase par priorité possible : rapidité, revenu, simplicité, secteur connu. */
    byPriority: z
      .array(
        z.object({
          priority: z.string().min(3).max(60),
          pick: z.string().min(1).max(120),
          because: z.string().min(10).max(300),
        }),
      )
      .min(2)
      .max(4),
    /** Ce que les opportunités ont en commun et qui mérite attention. */
    caution: z.string().min(10).max(300),
  })
  .strict()

export type RadarComparison = z.infer<typeof radarComparisonSchema>

/**
 * Rapport de validation d'une idée choisie.
 *
 * Objectif : éviter de construire à l'aveugle. Le rapport doit pouvoir conclure
 * « à éviter » — une validation qui valide toujours ne sert à rien.
 */
export const validationSchema = z
  .object({
    opportunityScore: z.number().int().min(0).max(100),
    demandLevel: z.enum(LEVELS),
    competitionLevel: z.enum(LEVELS),
    complexityLevel: z.enum(LEVELS),
    operatingCostLevel: z.enum(LEVELS),
    marketSize: z.string().min(1).max(300),
    problemAssessment: z.string().min(1).max(500),
    audienceAssessment: z.string().min(1).max(400),
    competitors: z
      .array(z.object({ name: z.string().min(1).max(80), note: z.string().min(1).max(240) }).strict())
      .max(4),
    essentialFeatures: z.array(z.string().min(1).max(120)).min(3).max(6),
    featuresToAvoid: z.array(z.string().min(1).max(120)).max(4),
    businessModel: z.enum(BUSINESS_MODELS),
    recommendedPriceCents: z.number().int().min(0).max(500_000),
    priceInterval: z.enum(PRICE_INTERVALS),
    pricingRationale: z.string().min(1).max(400),
    acquisitionDifficulty: z.enum(LEVELS),
    acquisitionChannels: z.array(z.string().min(1).max(160)).min(2).max(4),
    risks: z
      .array(
        z
          .object({
            risk: z.string().min(1).max(240),
            mitigation: z.string().min(1).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    differentiators: z.array(z.string().min(1).max(200)).min(1).max(3),
    /** Transparence (exigence 29) : ce qui dépendra d'un tiers, et si c'est payant. */
    externalServices: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            why: z.string().min(1).max(200),
            paid: z.boolean(),
          })
          .strict(),
      )
      .max(4),
    verdict: z.enum(['a-lancer', 'a-ajuster', 'a-eviter']),
    verdictReason: z.string().min(1).max(500),
  })
  .strict()

export type IdeaValidation = z.infer<typeof validationSchema>

/**
 * Cahier des charges du MVP.
 *
 * Étape charnière du parcours : c'est le document que le créateur lit et approuve avant
 * qu'une ligne ne soit construite. Il est rédigé pour être compris par quelqu'un qui ne
 * sait pas coder — pas de vocabulaire technique, et surtout ce qui est volontairement
 * laissé de côté pour la première version.
 *
 * Ce document n'est pas un second moteur : une fois approuvé, il est traduit en plan
 * d'entrée du moteur de génération existant (voir server/projects/blueprints.ts).
 */
export const specSheetSchema = z
  .object({
    appName: z.string().min(1).max(60),
    tagline: z.string().min(1).max(200),
    summary: z.string().min(1).max(1_200),
    forWho: z.string().min(1).max(400),
    problem: z.string().min(1).max(600),
    mvpFeatures: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            why: z.string().min(1).max(300),
          })
          .strict(),
      )
      .min(3)
      .max(8),
    /** Ce qui est délibérément reporté, et pourquoi. La simplicité est un choix explicite. */
    postponed: z
      .array(
        z
          .object({
            title: z.string().min(1).max(120),
            why: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(5),
    screens: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            purpose: z.string().min(1).max(240),
            requiresAccount: z.boolean(),
          })
          .strict(),
      )
      .min(2)
      .max(8),
    roles: z
      .array(
        z
          .object({
            name: z.string().min(1).max(60),
            canDo: z.string().min(1).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(3),
    storedData: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            description: z.string().min(1).max(240),
            /** Vrai si chaque utilisateur ne voit que ses propres enregistrements. */
            private: z.boolean(),
          })
          .strict(),
      )
      .max(6),
    accountsNeeded: z.boolean(),
    paymentModel: z.enum(BUSINESS_MODELS),
    priceCents: z.number().int().min(0).max(500_000),
    priceInterval: z.enum(PRICE_INTERVALS),
    whatIsPaid: z.string().min(1).max(300),
    externalServices: z
      .array(
        z
          .object({
            name: z.string().min(1).max(80),
            why: z.string().min(1).max(200),
            paid: z.boolean(),
          })
          .strict(),
      )
      .max(4),
    runningCostCents: z.number().int().min(0).max(100_000),
  })
  .strict()

export type SpecSheet = z.infer<typeof specSheetSchema>

/**
 * Réponse de l'assistant à une demande de modification.
 *
 * `valueJson` porte la nouvelle valeur **encodée en JSON dans une chaîne**, et non comme
 * une valeur libre. Raison mesurée contre l'API : un champ sans type déclaré (`unknown`)
 * est refusé par la compilation de grammaire des sorties structurées. Une chaîne est
 * typable, et la valeur qu'elle contient est de toute façon revalidée par le schéma
 * AppSpec après application du patch — la sécurité ne repose pas sur ce champ.
 *
 * Tous les champs sont obligatoires : `index`, `from` et `to` valent 0 quand l'opération
 * ne les utilise pas, `valueJson` vaut "null".
 */
export const editResponseSchema = z
  .object({
    /** Faux quand la demande sort du vocabulaire de la plateforme. */
    supported: z.boolean(),
    /** Message adressé à l'utilisateur, en langage courant, sans jargon. */
    reply: z.string().min(1).max(600),
    summary: z.string().min(1).max(120),
    operations: z
      .array(
        z
          .object({
            op: z.enum(['set', 'delete', 'append', 'insert', 'move']),
            path: z.string().min(1).max(300),
            valueJson: z.string().max(20_000),
            index: z.number().int().min(0).max(200),
            from: z.number().int().min(0).max(200),
            to: z.number().int().min(0).max(200),
          })
          .strict(),
      )
      .max(40),
  })
  .strict()

export type EditResponse = z.infer<typeof editResponseSchema>

/**
 * Génération en deux temps.
 *
 * L'API compile les sorties structurées en grammaire, et cette grammaire a une taille
 * maximale. Mesuré contre l'API réelle : l'union des dix types de section passe sans
 * problème dans `{ blocks: [...] }`, mais la même union imbriquée un niveau plus bas,
 * dans `{ pages: [ { blocks: [...] } ] }`, dépasse la limite et l'appel est refusé.
 *
 * D'où deux contrats :
 *   1. `appPlanSchema`   — tout sauf le contenu des pages (un seul appel) ;
 *   2. `pageContentSchema` — les sections d'UNE page (un appel par page, en parallèle).
 *
 * Effet de bord bienvenu : une page qui échoue ne fait pas perdre toute l'application,
 * et le prompt système commun reste identique d'un appel à l'autre, donc mis en cache.
 */
export const appPlanSchema = z
  .object({
    name: z.string().min(1).max(120),
    tagline: z.string().min(1).max(400),
    description: z.string().min(1).max(4000),
    locale: z.enum(['fr', 'en', 'de', 'it', 'es']),
    theme: themeSchema,
    auth: z.object({ enabled: z.boolean(), allowSignup: z.boolean() }).strict(),
    dataModels: z.array(dataModelSchema).max(8),
    pages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(48),
            title: z.string().min(1).max(120),
            path: z.string().min(1).max(48),
            requiresAuth: z.boolean(),
            /** Sections attendues sur cette page, dans l'ordre. */
            blockTypes: z.array(z.enum(BLOCK_TYPES)).min(1).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    navigation: navigationSchema,
    monetization: monetizationSchema,
  })
  .strict()

export type AppPlan = z.infer<typeof appPlanSchema>

export const pageContentSchema = z.object({ blocks: z.array(blockSchema).min(1).max(10) }).strict()

export type PageContent = z.infer<typeof pageContentSchema>

/**
 * Le contrat d'UNE page, restreint aux types de section que le plan a prévus pour elle.
 *
 * Vingt et un types de section font une grammaire trop large pour l'API de sortie
 * structurée ; une page n'en utilise que quelques-uns, et le plan les a déjà nommés.
 * Restreindre l'union au nécessaire garde chaque appel sous la limite, et empêche au
 * passage le modèle de produire une section qui n'était pas demandée.
 */
export function pageContentSchemaFor(types: readonly BlockType[]) {
  const wanted = [...new Set(types)]
  const schemas = wanted.map((type) => BLOCK_SCHEMAS[type])
  const first = schemas[0]
  if (first === undefined) return pageContentSchema
  const union =
    schemas.length === 1
      ? first
      : z.discriminatedUnion('type', [first, ...schemas.slice(1)] as [typeof first, ...(typeof schemas)])
  return z.object({ blocks: z.array(union).min(1).max(10) }).strict()
}

// ═══════════════════════════ Lia — support client ═══════════════════════════

/** Catégories d'une demande de support, partagées par Lia, les tickets et les analyses. */
export const SUPPORT_CATEGORIES = ['usage', 'account', 'billing', 'bug', 'feature', 'other'] as const
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

/**
 * Réponse de Lia. Structurée, parce que le refus doit être une décision explicite du
 * modèle et non une phrase à deviner : `canAnswer` à faux, et l'écran propose de
 * transmettre la demande au créateur.
 */
export const liaAnswerSchema = z
  .object({
    /** Quatre phrases au maximum, sans formatage. */
    answer: z.string().min(1).max(900),
    /** Vrai seulement si la réponse repose sur la base de connaissances fournie. */
    canAnswer: z.boolean(),
    /** Numéros (à partir de 1) des entrées de la base utilisées. Vide si aucune. */
    usedEntries: z.array(z.number().int().min(1).max(20)).max(6),
    category: z.enum(SUPPORT_CATEGORIES),
  })
  .strict()

export type LiaAnswer = z.infer<typeof liaAnswerSchema>

/** Questions-réponses proposées à partir du contenu d'une application. Naissent en brouillon. */
export const liaFaqSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            question: z.string().min(1).max(160),
            answer: z.string().min(1).max(600),
            keywords: z.array(z.string().min(1).max(30)).min(1).max(8),
          })
          .strict(),
      )
      .min(3)
      .max(15),
  })
  .strict()

export type LiaFaq = z.infer<typeof liaFaqSchema>

export const INSIGHT_KINDS = ['frequent_question', 'feature_request', 'potential_bug', 'unanswered'] as const

/** Ce qu'un lot de conversations révèle (V2). */
export const liaInsightsSchema = z
  .object({
    insights: z
      .array(
        z
          .object({
            kind: z.enum(INSIGHT_KINDS),
            title: z.string().min(1).max(140),
            /** Nombre de conversations concernées, tel que le modèle l'a compté. */
            count: z.number().int().min(1).max(500),
            /** Reformulations courtes, jamais de citation littérale ni de donnée personnelle. */
            examples: z.array(z.string().min(1).max(160)).max(3),
          })
          .strict(),
      )
      .max(12),
  })
  .strict()

export type LiaInsights = z.infer<typeof liaInsightsSchema>

/**
 * Les corrections rédigées pour un constat d'audit.
 *
 * Une entrée par page, et rien de plus qu'un texte à coller. Deux partis pris tiennent dans
 * la forme du schéma.
 *
 * **Le champ corrigé est nommé.** Sans lui, l'écran ne saurait pas où coller la phrase, et
 * la personne devrait deviner — ce qui est exactement le travail qu'on lui épargne.
 *
 * **L'ancien texte revient avec le nouveau.** Une correction se relit par comparaison : voir
 * « Accueil » en face de « Bougies artisanales coulées à la main en Gruyère » est ce qui
 * permet de juger en une seconde, et d'écarter la proposition quand elle est à côté.
 */
export const CORRECTION_FIELDS = ['title', 'description', 'h1', 'intro'] as const

export const correctionsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            /** Chemin de la page, repris tel qu'il a été fourni. */
            path: z.string().min(1).max(300),
            field: z.enum(CORRECTION_FIELDS),
            /** Ce qui est en place aujourd'hui. Vide quand rien n'y est. */
            before: z.string().max(400),
            /** Le texte à coller. */
            after: z.string().min(1).max(400),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()

export type Corrections = z.infer<typeof correctionsSchema>

/**
 * Un article rédigé par l'équipe.
 *
 * La forme du schéma est le cœur de la fonctionnalité, et elle n'est pas une question de
 * goût : **elle reprend les contrôles que le produit mesure lui-même.** Un article rendu en
 * un seul bloc de texte serait noté médiocrement par l'analyse d'Evoliia — pavé sans
 * intertitres, aucune question posée, pas d'introduction qui réponde. Vendre un texte qu'on
 * noterait mal soi-même serait la contradiction la plus coûteuse du produit.
 *
 * D'où quatre champs séparés plutôt qu'un seul.
 *
 * **Le chapô est à part.** C'est ce qu'un assistant reprend quand il cite une page : il doit
 * répondre avant qu'on fasse défiler, pas accueillir.
 *
 * **Les sections sont titrées.** Un intertitre est ce qui transforme un pavé en quelque
 * chose de parcourable, pour un humain comme pour une machine.
 *
 * **Les questions sont hors du corps.** Elles se déclarent en FAQ ; noyées dans le texte,
 * elles ne comptent pour personne.
 *
 * **Le titre de résultat et la description sont demandés d'emblée.** Sans eux, l'article
 * créerait le défaut suivant le jour de sa publication.
 */
/**
 * La longueur ne peut PAS être exigée par ce schéma. Ne la remettez pas ici.
 *
 * Elle l'a été, une journée, et la rédaction a cessé de fonctionner en production. Les
 * sorties structurées de l'API ne prennent pas les contraintes de longueur de chaîne : le
 * SDK les retire du schéma envoyé au modèle, puis les applique à sa réponse côté client.
 * Un minimum écrit ici ne contraint donc rien du tout — il ne fait que refuser après coup
 * un texte que le modèle n'avait aucune raison d'allonger, et transforme « trop court » en
 * « l'assistant n'a pas répondu correctement ».
 *
 * La longueur se demande donc dans la consigne, par section plutôt qu'en total, et se
 * constate ensuite. C'est moins sûr qu'une contrainte, et c'est tout ce que l'API permet.
 *
 * Les bornes hautes, elles, restent : une réponse trop longue est rattrapée plus bas
 * (`parseTolerantly`) au lieu de jeter un appel déjà payé.
 */

/**
 * Ce que la consigne demande. Des objectifs, pas des garanties — voir ci-dessus.
 *
 * Tirés du seuil que l'analyse applique, pour que les deux ne divergent pas. Le rapport
 * signes/mot vient des articles réellement écrits : 5,99 et 6,33, la plus défavorable
 * retenue.
 */
const SIGNES_PAR_MOT = 6.5
const SECTIONS_VOULUES = 5
const CHAPO_SIGNES_VOULUS = 400

export const ARTICLE_FORME = {
  sectionsMin: SECTIONS_VOULUES,
  sectionSignesMin: Math.ceil(
    (SEUILS_REDACTION.motsMinimum * SIGNES_PAR_MOT - CHAPO_SIGNES_VOULUS) / SECTIONS_VOULUES,
  ),
  chapoSignesMin: CHAPO_SIGNES_VOULUS,
} as const

export const articleSchema = z
  .object({
    /** Le sujet retenu, en une ligne. */
    sujet: z.string().min(3).max(200),
    /** Pourquoi ce sujet, tiré des constats fournis. Deux phrases au plus. */
    fondement: z.string().min(1).max(600),
    titre: z.string().min(5).max(160),
    /** Le premier paragraphe : il répond, il n'annonce pas. */
    chapo: z.string().min(80).max(900),
    sections: z
      .array(
        z
          .object({
            titre: z.string().min(3).max(160),
            /** Le corps de la section, en Markdown simple : paragraphes et listes. */
            corps: z.string().min(1).max(4000),
            /**
             * Ce que la section gagnerait à montrer, en quelques mots.
             *
             * Une description, jamais une adresse. Un modèle à qui l'on demande une URL en
             * invente une : elle a la bonne forme, elle ne mène nulle part, et l'article
             * part chez le client avec des images cassées. C'est le serveur qui cherche la
             * fiche correspondante et fournit l'adresse réelle — une photo inventée devient
             * impossible par construction, pas par vigilance.
             */
            illustration: z.string().max(120).optional(),
          })
          .strict(),
      )
      .min(2)
      .max(10),
    questions: z
      .array(
        z
          .object({
            question: z.string().min(5).max(300),
            reponse: z.string().min(1).max(1200),
          })
          .strict(),
      )
      .min(2)
      .max(8),
    metaTitle: z.string().min(5).max(70),
    metaDescription: z.string().min(40).max(170),
  })
  .strict()

export type ArticleRedige = z.infer<typeof articleSchema>
