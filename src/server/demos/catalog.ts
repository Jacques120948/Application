import type { AppSpec } from '@/server/spec/schema'

/**
 * Applications de démonstration d'Evoliia.
 *
 * Ce ne sont pas des maquettes : chaque entrée est une véritable AppSpec, validée par le
 * schéma de la plateforme et servie par le même moteur de rendu que les applications des
 * créateurs. Elles sont installées en base par `prisma/seed.ts` et consultables à
 * l'adresse `/a/<slug>`, exactement comme une application publiée.
 *
 * Règles :
 *   - ce sont des exemples, jamais des clients ; la page d'accueil doit le dire ;
 *   - aucune inscription n'est ouverte dessus (`allowSignup: false`) : une démonstration
 *     publique ne doit pas devenir une boîte à spam ;
 *   - les montants affichés illustrent un modèle économique possible, jamais un revenu.
 */

export type DemoApp = {
  slug: string
  /** Intitulé de catégorie affiché sur la carte. */
  category: string
  /** Une phrase, au présent, sur ce que fait l'application. */
  summary: string
  /** Modèle économique illustratif, déjà formaté. */
  priceLabel: string
  /** Ce que la capture met en avant, pour le texte alternatif. */
  shotAlt: string
  spec: AppSpec
}

const SHARED: { locale: AppSpec['locale']; specVersion: 1 } = { locale: 'fr', specVersion: 1 }

const RAW_DEMOS: readonly DemoApp[] = [
  {
    slug: 'devisflow',
    category: 'Outil métier · B2B',
    summary: 'Devis, suivi des clients et relances pour les artisans.',
    priceLabel: '19 € par mois',
    shotAlt: "Page d'accueil de DevisFlow, une application de devis pour artisans",
    spec: {
      ...SHARED,
      name: 'DevisFlow',
      tagline: 'Vos devis prêts en trois minutes, vos relances envoyées toutes seules.',
      description:
        "Application de démonstration créée avec Evoliia. DevisFlow aide un artisan à rédiger un devis, à suivre ses clients et à relancer ceux qui n'ont pas répondu.",
      theme: {
        colors: {
          primary: '#4338ca',
          accent: '#0ea5e9',
          background: '#f7f8fc',
          surface: '#ffffff',
          text: '#111827',
          muted: '#d8dcea',
        },
        radius: 'medium',
        font: 'system',
        mode: 'light',
      },
      auth: { enabled: true, allowSignup: false },
      dataModels: [
        {
          id: 'devis',
          label: 'Devis',
          labelPlural: 'Devis',
          scope: 'user',
          fields: [
            { id: 'client', label: 'Client', type: 'text', required: true },
            { id: 'montant', label: 'Montant (€)', type: 'number', required: true },
            {
              id: 'statut',
              label: 'Statut',
              type: 'select',
              required: true,
              options: ['Brouillon', 'Envoyé', 'Accepté', 'Refusé'],
            },
          ],
        },
      ],
      pages: [
        {
          id: 'accueil',
          title: 'Accueil',
          path: 'accueil',
          requiresAuth: false,
          blocks: [
            {
              id: 'hero',
              type: 'hero',
              title: 'Le devis qui part le soir même',
              subtitle:
                "Rédigez, envoyez, relancez. DevisFlow suit vos clients pendant que vous êtes sur le chantier.",
              ctaLabel: 'Voir les tarifs',
              ctaPageId: 'tarifs',
            },
            {
              id: 'atouts',
              type: 'features',
              title: 'Ce que fait DevisFlow',
              items: [
                {
                  title: 'Devis en trois minutes',
                  body: 'Vos prestations habituelles sont enregistrées : un devis se compose en quelques clics.',
                },
                {
                  title: 'Relances automatiques',
                  body: "Un client n'a pas répondu depuis huit jours ? Il reçoit un rappel, sans que vous y pensiez.",
                },
                {
                  title: 'Suivi clair',
                  body: 'Envoyés, acceptés, refusés : vous savez en un coup d’œil où vous en êtes.',
                },
              ],
            },
            {
              id: 'chiffres',
              type: 'stats',
              items: [
                { label: 'Temps par devis', value: '3 minutes' },
                { label: 'Relances à écrire', value: 'Aucune' },
                { label: 'Sur le chantier', value: 'Depuis le téléphone' },
              ],
            },
            {
              id: 'appel',
              type: 'cta',
              title: 'Essayez sur votre prochain chantier',
              body: 'Créez votre compte, saisissez vos prestations, et envoyez votre premier devis.',
              label: 'Voir les tarifs',
              pageId: 'tarifs',
            },
          ],
        },
        {
          id: 'tarifs',
          title: 'Tarifs',
          path: 'tarifs',
          requiresAuth: false,
          blocks: [
            { id: 'grille', type: 'pricing', title: 'Un seul tarif, tout compris' },
            {
              id: 'questions',
              type: 'faq',
              title: 'Questions fréquentes',
              items: [
                {
                  question: 'Mes devis sont-ils conformes ?',
                  answer:
                    'Les mentions obligatoires sont présentes. Vérifiez les règles de votre pays avant de les envoyer.',
                },
                {
                  question: 'Puis-je exporter mes devis ?',
                  answer: 'Chaque devis se télécharge et s’imprime depuis votre espace.',
                },
              ],
            },
          ],
        },
        {
          id: 'espace',
          title: 'Mes devis',
          path: 'mes-devis',
          requiresAuth: true,
          blocks: [
            {
              id: 'liste',
              type: 'recordList',
              title: 'Vos devis',
              modelId: 'devis',
              titleField: 'client',
              subtitleField: 'statut',
              emptyText: 'Aucun devis pour le moment.',
              allowDelete: true,
            },
          ],
        },
      ],
      navigation: {
        style: 'topbar',
        items: [
          { pageId: 'accueil', label: 'Accueil' },
          { pageId: 'tarifs', label: 'Tarifs' },
          { pageId: 'espace', label: 'Mes devis' },
        ],
      },
      monetization: {
        model: 'subscription',
        currency: 'EUR',
        plans: [
          {
            id: 'artisan',
            name: 'Artisan',
            priceCents: 1900,
            interval: 'month',
            features: ['Devis illimités', 'Relances automatiques', 'Export PDF'],
            highlighted: true,
          },
        ],
        note: "Tarif d'illustration d'une application de démonstration.",
      },
    },
  },
  {
    slug: 'bookizy',
    category: 'Réservation · Indépendants',
    summary: 'Prise de rendez-vous pour coachs, thérapeutes et indépendants.',
    priceLabel: '14 € par mois',
    shotAlt: 'Page de réservation de Bookizy, avec agenda et créneaux',
    spec: {
      ...SHARED,
      name: 'Bookizy',
      tagline: 'Vos clients réservent seuls, votre agenda se remplit pendant vos séances.',
      description:
        "Application de démonstration créée avec Evoliia. Bookizy laisse les clients d'un indépendant choisir un créneau, recevoir leur confirmation et être rappelés la veille.",
      theme: {
        colors: {
          primary: '#0f766e',
          accent: '#f59e0b',
          background: '#f2fbf9',
          surface: '#ffffff',
          text: '#0f2e2b',
          muted: '#c7e6e0',
        },
        radius: 'large',
        font: 'geometric',
        mode: 'light',
        pattern: 'grid',
        density: 'balanced',
      },
      auth: { enabled: true, allowSignup: false },
      dataModels: [
        {
          id: 'reservation',
          label: 'Réservation',
          labelPlural: 'Réservations',
          scope: 'user',
          fields: [
            { id: 'nom', label: 'Votre nom', type: 'text', required: true },
            { id: 'email', label: 'Votre e-mail', type: 'email', required: true },
            { id: 'date', label: 'Date souhaitée', type: 'date', required: true },
            {
              id: 'prestation',
              label: 'Prestation',
              type: 'select',
              required: true,
              options: ['Première séance', 'Suivi', 'Bilan complet'],
            },
          ],
        },
      ],
      pages: [
        {
          id: 'accueil',
          title: 'Accueil',
          path: 'accueil',
          requiresAuth: false,
          blocks: [
            {
              id: 'hero',
              type: 'hero',
              title: 'Réservez votre séance en trente secondes',
              subtitle:
                'Choisissez un créneau, recevez votre confirmation, et un rappel la veille. Rien à installer.',
              ctaLabel: 'Voir les formules',
              ctaPageId: 'formules',
            },
            {
              id: 'atouts',
              type: 'features',
              title: 'Pensé pour les indépendants',
              items: [
                {
                  title: 'Agenda toujours à jour',
                  body: 'Un créneau réservé disparaît immédiatement. Plus de double réservation.',
                  icon: 'calendar',
                },
                {
                  title: 'Rappels la veille',
                  body: 'Vos clients reçoivent un message de rappel. Les oublis deviennent rares.',
                  icon: 'bell',
                },
                {
                  title: 'Fiches clients',
                  body: 'Historique des séances, notes, coordonnées : tout est au même endroit.',
                  icon: 'user',
                },
                {
                  title: 'Depuis le téléphone',
                  body: 'Vos clients réservent depuis leur mobile, vous consultez depuis le vôtre.',
                  icon: 'phone',
                },
              ],
            },
            {
              id: 'etapes',
              type: 'steps',
              title: 'Comment ça marche',
              items: [
                { title: 'Vous indiquez vos disponibilités', body: 'Une fois, puis vous ajustez quand vous voulez.' },
                { title: 'Vos clients choisissent', body: 'Depuis votre lien, sur téléphone ou ordinateur.' },
                { title: 'Tout le monde est prévenu', body: 'Confirmation immédiate, rappel la veille.' },
              ],
            },
            {
              id: 'comparatif',
              type: 'comparison',
              title: 'Ce que change Bookizy',
              columns: ['Avec Bookizy', 'Par messages'],
              rows: [
                { label: 'Réservation à toute heure', values: ['✓', '—'] },
                { label: 'Rappel automatique la veille', values: ['✓', '—'] },
                { label: 'Double réservation impossible', values: ['✓', '—'] },
                { label: 'Temps passé à répondre', values: ['Aucun', 'Chaque jour'] },
              ],
            },
            {
              id: 'appel',
              type: 'cta',
              title: 'Ouvrez votre agenda à vos clients',
              body: 'Indiquez vos disponibilités, partagez votre lien, laissez-les réserver.',
              label: 'Voir les formules',
              pageId: 'formules',
            },
          ],
        },
        {
          id: 'formules',
          title: 'Formules',
          path: 'formules',
          requiresAuth: false,
          blocks: [
            { id: 'grille', type: 'pricing', title: 'Deux formules, sans engagement' },
            {
              id: 'questions',
              type: 'faq',
              title: 'Questions fréquentes',
              items: [
                {
                  question: 'Mes clients doivent-ils créer un compte ?',
                  answer: 'Non. Ils réservent avec leur nom et leur e-mail, rien de plus.',
                },
                {
                  question: 'Puis-je bloquer mes congés ?',
                  answer: 'Oui, les périodes fermées ne sont jamais proposées à la réservation.',
                },
              ],
            },
          ],
        },
        {
          id: 'agenda',
          title: 'Mon agenda',
          path: 'mon-agenda',
          requiresAuth: true,
          blocks: [
            {
              id: 'liste',
              type: 'recordList',
              title: 'Vos prochaines séances',
              modelId: 'reservation',
              titleField: 'nom',
              subtitleField: 'prestation',
              emptyText: 'Aucune réservation pour le moment.',
              allowDelete: true,
            },
          ],
        },
      ],
      navigation: {
        style: 'topbar',
        items: [
          { pageId: 'accueil', label: 'Accueil' },
          { pageId: 'formules', label: 'Formules' },
          { pageId: 'agenda', label: 'Mon agenda' },
        ],
      },
      monetization: {
        model: 'subscription',
        currency: 'EUR',
        plans: [
          {
            id: 'solo',
            name: 'Solo',
            priceCents: 1400,
            interval: 'month',
            features: ['Agenda en ligne', 'Rappels automatiques', 'Fiches clients'],
            highlighted: true,
          },
          {
            id: 'cabinet',
            name: 'Cabinet',
            priceCents: 2900,
            interval: 'month',
            features: ['Jusqu’à cinq praticiens', 'Agendas séparés', 'Statistiques'],
            highlighted: false,
          },
        ],
        note: "Tarifs d'illustration d'une application de démonstration.",
      },
    },
  },
  {
    slug: 'fitpilot',
    category: 'Sport · Grand public',
    summary: 'Programmes personnalisés et suivi de progression.',
    priceLabel: '9,90 € par mois',
    shotAlt: 'Interface sombre de FitPilot, application de suivi d’entraînement',
    spec: {
      ...SHARED,
      name: 'FitPilot',
      tagline: 'Votre programme, vos séances, votre progression. Rien d’autre à l’écran.',
      description:
        "Application de démonstration créée avec Evoliia. FitPilot propose un programme d'entraînement, enregistre chaque séance et montre la progression au fil des semaines.",
      theme: {
        colors: {
          primary: '#a3e635',
          accent: '#22d3ee',
          background: '#0b1120',
          surface: '#161f35',
          text: '#f1f5f9',
          muted: '#334155',
        },
        radius: 'large',
        font: 'rounded',
        mode: 'dark',
      },
      auth: { enabled: true, allowSignup: false },
      dataModels: [
        {
          id: 'seance',
          label: 'Séance',
          labelPlural: 'Séances',
          scope: 'user',
          fields: [
            { id: 'titre', label: 'Séance', type: 'text', required: true },
            { id: 'duree', label: 'Durée (minutes)', type: 'number', required: true },
            {
              id: 'ressenti',
              label: 'Ressenti',
              type: 'select',
              required: true,
              options: ['Facile', 'Correct', 'Difficile'],
            },
            { id: 'date', label: 'Date', type: 'date', required: true },
          ],
        },
      ],
      pages: [
        {
          id: 'accueil',
          title: 'Accueil',
          path: 'accueil',
          requiresAuth: false,
          blocks: [
            {
              id: 'hero',
              type: 'hero',
              title: 'Un programme qui tient compte de vos semaines chargées',
              subtitle:
                'Trois séances prévues, deux réalisées ? Le programme s’ajuste au lieu de vous culpabiliser.',
              ctaLabel: 'Voir les formules',
              ctaPageId: 'formules',
            },
            {
              id: 'chiffres',
              type: 'stats',
              items: [
                { label: 'Séances guidées', value: '120' },
                { label: 'Durée moyenne', value: '35 minutes' },
                { label: 'Matériel requis', value: 'Aucun' },
              ],
            },
            {
              id: 'atouts',
              type: 'features',
              title: 'Ce que vous suivez',
              items: [
                {
                  title: 'Séances guidées',
                  body: 'Chaque exercice est expliqué, avec le temps de repos et la charge conseillée.',
                },
                {
                  title: 'Progression visible',
                  body: 'Vos charges et vos durées se comparent d’une semaine à l’autre.',
                },
                {
                  title: 'Objectifs réalistes',
                  body: 'Vous indiquez votre temps disponible, le programme se cale dessus.',
                },
              ],
            },
            {
              id: 'appel',
              type: 'cta',
              title: 'Commencez par une séance',
              body: 'Quinze minutes suffisent pour la première.',
              label: 'Voir les formules',
              pageId: 'formules',
            },
          ],
        },
        {
          id: 'formules',
          title: 'Formules',
          path: 'formules',
          requiresAuth: false,
          blocks: [
            { id: 'grille', type: 'pricing', title: 'Gratuit pour essayer' },
            {
              id: 'prudence',
              type: 'richText',
              title: 'Avant de commencer',
              body: "FitPilot n'est pas un avis médical. En cas de douleur, de blessure ou de maladie chronique, parlez-en à un professionnel de santé avant de reprendre le sport.",
            },
          ],
        },
        {
          id: 'journal',
          title: 'Mon journal',
          path: 'mon-journal',
          requiresAuth: true,
          blocks: [
            {
              id: 'liste',
              type: 'recordList',
              title: 'Vos dernières séances',
              modelId: 'seance',
              titleField: 'titre',
              subtitleField: 'ressenti',
              emptyText: 'Aucune séance enregistrée.',
              allowDelete: true,
            },
          ],
        },
      ],
      navigation: {
        style: 'tabs',
        items: [
          { pageId: 'accueil', label: 'Accueil' },
          { pageId: 'formules', label: 'Formules' },
          { pageId: 'journal', label: 'Journal' },
        ],
      },
      monetization: {
        model: 'freemium',
        currency: 'EUR',
        plans: [
          {
            id: 'libre',
            name: 'Libre',
            priceCents: 0,
            interval: 'month',
            features: ['Trois séances par semaine', 'Suivi de base'],
            highlighted: false,
          },
          {
            id: 'complet',
            name: 'Complet',
            priceCents: 990,
            interval: 'month',
            features: ['Programme personnalisé', 'Progression détaillée', 'Séances illimitées'],
            highlighted: true,
          },
        ],
        note: "Tarifs d'illustration d'une application de démonstration.",
      },
    },
  },
  {
    slug: 'cooksy',
    category: 'Communauté · Grand public',
    summary: 'Chacun publie ses recettes, retrouve ses favorites et suit ses idées de repas.',
    priceLabel: 'Gratuit, puis 4,90 € par mois',
    shotAlt: 'Page recettes de Cooksy, avec la liste des recettes publiées',
    spec: {
      ...SHARED,
      name: 'Cooksy',
      tagline: 'Les recettes de tout le monde, et les vôtres en premier.',
      description:
        "Application de démonstration créée avec Evoliia. Cooksy réunit des recettes publiées par ses membres, chacun retrouvant ses favorites dans son espace.",
      theme: {
        colors: {
          primary: '#ea580c',
          accent: '#16a34a',
          background: '#fffaf4',
          surface: '#ffffff',
          text: '#2b1a10',
          muted: '#f0dfcd',
        },
        radius: 'large',
        font: 'editorial',
        mode: 'light',
        pattern: 'dots',
        density: 'airy',
      },
      auth: { enabled: true, allowSignup: false },
      dataModels: [
        {
          id: 'recette',
          label: 'Recette',
          labelPlural: 'Recettes',
          scope: 'shared',
          fields: [
            { id: 'titre', label: 'Titre', type: 'text', required: true },
            {
              id: 'categorie',
              label: 'Catégorie',
              type: 'select',
              required: true,
              options: ['Entrée', 'Plat', 'Dessert', 'Boisson'],
            },
            { id: 'temps', label: 'Temps de préparation (minutes)', type: 'number', required: true },
            { id: 'etapes', label: 'Préparation', type: 'longText', required: true },
          ],
        },
      ],
      pages: [
        {
          id: 'accueil',
          title: 'Accueil',
          path: 'accueil',
          requiresAuth: false,
          blocks: [
            {
              id: 'hero',
              type: 'hero',
              eyebrow: 'Recettes de vraies cuisines',
              title: 'Qu’est-ce qu’on mange ce soir ?',
              subtitle:
                'Des recettes publiées par des gens ordinaires, testées dans de vraies cuisines.',
              ctaLabel: 'Voir les recettes',
              ctaPageId: 'recettes',
            },
            {
              id: 'atouts',
              type: 'features',
              title: 'Ce que vous pouvez faire',
              items: [
                {
                  title: 'Publier vos recettes',
                  body: 'Titre, temps de préparation, étapes. Cinq minutes suffisent.',
                  icon: 'pen',
                },
                {
                  title: 'Garder vos favorites',
                  body: 'Un clic, et la recette vous attend dans votre espace.',
                  icon: 'heart',
                },
                {
                  title: 'Chercher par envie',
                  body: 'Entrée, plat, dessert, boisson, et par temps de préparation.',
                  icon: 'search',
                },
              ],
            },
            {
              id: 'etapes',
              type: 'steps',
              title: 'De la cuisine à la page',
              items: [
                { title: 'Cuisinez', body: 'Une recette que vous avez vraiment faite, pas une idée.', icon: 'cup' },
                { title: 'Écrivez-la', body: 'Les étapes dans l’ordre, le temps qu’il faut vraiment.', icon: 'pen' },
                { title: 'Partagez', body: 'Elle rejoint les recettes de tout le monde, et vos favorites.', icon: 'users' },
              ],
            },
          ],
        },
        {
          id: 'recettes',
          title: 'Recettes',
          path: 'recettes',
          requiresAuth: false,
          blocks: [
            {
              id: 'liste',
              type: 'recordList',
              title: 'Les dernières recettes',
              modelId: 'recette',
              titleField: 'titre',
              subtitleField: 'categorie',
              emptyText: 'Aucune recette publiée pour l’instant.',
              allowDelete: false,
            },
          ],
        },
        {
          id: 'favoris',
          title: 'Mes favoris',
          path: 'mes-favoris',
          requiresAuth: true,
          blocks: [
            {
              id: 'intro',
              type: 'richText',
              title: 'Votre carnet',
              body: 'Les recettes que vous enregistrez se retrouvent ici, même après avoir changé d’appareil.',
            },
          ],
        },
      ],
      navigation: {
        style: 'topbar',
        items: [
          { pageId: 'accueil', label: 'Accueil' },
          { pageId: 'recettes', label: 'Recettes' },
          { pageId: 'favoris', label: 'Mes favoris' },
        ],
      },
      monetization: {
        model: 'freemium',
        currency: 'EUR',
        plans: [
          {
            id: 'curieux',
            name: 'Curieux',
            priceCents: 0,
            interval: 'month',
            features: ['Lecture illimitée', 'Dix favoris'],
            highlighted: false,
          },
          {
            id: 'gourmand',
            name: 'Gourmand',
            priceCents: 490,
            interval: 'month',
            features: ['Favoris illimités', 'Listes de courses', 'Sans publicité'],
            highlighted: true,
          },
        ],
        note: "Tarifs d'illustration d'une application de démonstration.",
      },
    },
  },
  {
    slug: 'immotrack',
    category: 'Immobilier · B2B',
    summary: 'Gestion des biens, des prospects, des visites et du suivi commercial.',
    priceLabel: '39 € par mois',
    shotAlt: 'Tableau de bord sobre d’ImmoTrack, application de suivi immobilier',
    spec: {
      ...SHARED,
      name: 'ImmoTrack',
      tagline: 'Chaque bien, chaque visite, chaque relance. Au même endroit.',
      description:
        "Application de démonstration créée avec Evoliia. ImmoTrack suit un portefeuille de biens, les prospects rattachés et les visites planifiées.",
      theme: {
        colors: {
          primary: '#1e3a8a',
          accent: '#b45309',
          background: '#ffffff',
          surface: '#f8fafc',
          text: '#0f172a',
          muted: '#cbd5e1',
        },
        radius: 'small',
        font: 'system',
        mode: 'light',
      },
      auth: { enabled: true, allowSignup: false },
      dataModels: [
        {
          id: 'bien',
          label: 'Bien',
          labelPlural: 'Biens',
          scope: 'user',
          fields: [
            { id: 'adresse', label: 'Adresse', type: 'text', required: true },
            { id: 'prix', label: 'Prix demandé (€)', type: 'number', required: true },
            {
              id: 'etat',
              label: 'État',
              type: 'select',
              required: true,
              options: ['À visiter', 'En négociation', 'Sous compromis', 'Vendu'],
            },
          ],
        },
      ],
      pages: [
        {
          id: 'accueil',
          title: 'Accueil',
          path: 'accueil',
          requiresAuth: false,
          blocks: [
            {
              id: 'hero',
              type: 'hero',
              title: 'Votre portefeuille, lisible en un écran',
              subtitle:
                'Biens, prospects, visites et relances. Sans tableur, et sans rien oublier.',
              ctaLabel: 'Voir le tarif',
              ctaPageId: 'tarif',
            },
            {
              id: 'chiffres',
              type: 'stats',
              items: [
                { label: 'Biens suivis', value: 'Illimité' },
                { label: 'Relances oubliées', value: 'Zéro' },
                { label: 'Mise en route', value: 'Un après-midi' },
              ],
            },
            {
              id: 'atouts',
              type: 'features',
              title: 'Le suivi commercial, sans tableur',
              items: [
                {
                  title: 'Fiche par bien',
                  body: 'Prix, état d’avancement, historique des visites et notes internes.',
                },
                {
                  title: 'Prospects rattachés',
                  body: 'Qui a visité quoi, qui rappeler, et quand.',
                },
                {
                  title: 'Rappels de relance',
                  body: 'Une visite sans suite depuis dix jours remonte en haut de la liste.',
                },
              ],
            },
          ],
        },
        {
          id: 'tarif',
          title: 'Tarif',
          path: 'tarif',
          requiresAuth: false,
          blocks: [
            { id: 'grille', type: 'pricing', title: 'Par agent' },
            {
              id: 'questions',
              type: 'faq',
              title: 'Questions fréquentes',
              items: [
                {
                  question: 'Mes données sont-elles isolées ?',
                  answer: 'Chaque compte ne voit que son portefeuille, y compris au sein d’une agence.',
                },
                {
                  question: 'Puis-je importer mon tableur ?',
                  answer: 'Les biens se saisissent un par un dans cette version de démonstration.',
                },
              ],
            },
          ],
        },
        {
          id: 'portefeuille',
          title: 'Portefeuille',
          path: 'portefeuille',
          requiresAuth: true,
          blocks: [
            {
              id: 'liste',
              type: 'recordList',
              title: 'Vos biens',
              modelId: 'bien',
              titleField: 'adresse',
              subtitleField: 'etat',
              emptyText: 'Aucun bien enregistré.',
              allowDelete: true,
            },
          ],
        },
      ],
      navigation: {
        style: 'topbar',
        items: [
          { pageId: 'accueil', label: 'Accueil' },
          { pageId: 'tarif', label: 'Tarif' },
          { pageId: 'portefeuille', label: 'Portefeuille' },
        ],
      },
      monetization: {
        model: 'subscription',
        currency: 'EUR',
        plans: [
          {
            id: 'agent',
            name: 'Agent',
            priceCents: 3900,
            interval: 'month',
            features: ['Biens illimités', 'Prospects et visites', 'Rappels de relance'],
            highlighted: true,
          },
        ],
        note: "Tarif d'illustration d'une application de démonstration.",
      },
    },
  },
  {
    slug: 'studyflow',
    category: 'Éducation · Grand public',
    summary: 'Cours, fiches de révision et quiz pour réviser sans se disperser.',
    priceLabel: '12 € par mois',
    shotAlt: 'Page de StudyFlow, application de fiches de révision',
    spec: {
      ...SHARED,
      name: 'StudyFlow',
      tagline: 'Une fiche, un quiz, dix minutes. Répété jusqu’à ce que ce soit acquis.',
      description:
        "Application de démonstration créée avec Evoliia. StudyFlow regroupe des fiches de révision par matière et vérifie ce qui est acquis par de courts quiz.",
      theme: {
        colors: {
          primary: '#6d28d9',
          accent: '#0d9488',
          background: '#fbfaff',
          surface: '#ffffff',
          text: '#1c1533',
          muted: '#ded9f0',
        },
        radius: 'medium',
        font: 'serif',
        mode: 'light',
      },
      auth: { enabled: true, allowSignup: false },
      dataModels: [
        {
          id: 'fiche',
          label: 'Fiche',
          labelPlural: 'Fiches',
          scope: 'user',
          fields: [
            { id: 'titre', label: 'Titre', type: 'text', required: true },
            {
              id: 'matiere',
              label: 'Matière',
              type: 'select',
              required: true,
              options: ['Français', 'Mathématiques', 'Histoire', 'Sciences'],
            },
            { id: 'contenu', label: 'Contenu', type: 'longText', required: true },
          ],
        },
      ],
      pages: [
        {
          id: 'accueil',
          title: 'Accueil',
          path: 'accueil',
          requiresAuth: false,
          blocks: [
            {
              id: 'hero',
              type: 'hero',
              title: 'Réviser dix minutes vaut mieux que relire deux heures',
              subtitle:
                'Des fiches courtes, un quiz après chacune, et la liste de ce qui reste à revoir.',
              ctaLabel: 'Voir les formules',
              ctaPageId: 'formules',
            },
            {
              id: 'atouts',
              type: 'features',
              title: 'Comment ça se passe',
              items: [
                {
                  title: 'Une fiche par notion',
                  body: 'Assez courte pour être lue avant le bus, assez complète pour servir.',
                },
                {
                  title: 'Un quiz derrière',
                  body: 'Trois questions suffisent à savoir si la notion est acquise.',
                },
                {
                  title: 'Ce qui reste à revoir',
                  body: 'Les notions ratées reviennent, les autres s’espacent.',
                },
              ],
            },
            {
              id: 'appel',
              type: 'cta',
              title: 'Commencez par une matière',
              body: 'Choisissez une matière, lisez une fiche, faites le quiz.',
              label: 'Voir les formules',
              pageId: 'formules',
            },
          ],
        },
        {
          id: 'formules',
          title: 'Formules',
          path: 'formules',
          requiresAuth: false,
          blocks: [
            { id: 'grille', type: 'pricing', title: 'Par famille' },
            {
              id: 'questions',
              type: 'faq',
              title: 'Questions fréquentes',
              items: [
                {
                  question: 'Pour quel niveau ?',
                  answer: 'Les fiches sont écrites par les familles elles-mêmes, du primaire au lycée.',
                },
                {
                  question: 'Est-ce un soutien scolaire ?',
                  answer: 'Non. StudyFlow organise la révision, il ne remplace pas un enseignant.',
                },
              ],
            },
          ],
        },
        {
          id: 'fiches',
          title: 'Mes fiches',
          path: 'mes-fiches',
          requiresAuth: true,
          blocks: [
            {
              id: 'liste',
              type: 'recordList',
              title: 'Vos fiches',
              modelId: 'fiche',
              titleField: 'titre',
              subtitleField: 'matiere',
              emptyText: 'Aucune fiche enregistrée.',
              allowDelete: true,
            },
          ],
        },
      ],
      navigation: {
        style: 'topbar',
        items: [
          { pageId: 'accueil', label: 'Accueil' },
          { pageId: 'formules', label: 'Formules' },
          { pageId: 'fiches', label: 'Mes fiches' },
        ],
      },
      monetization: {
        model: 'subscription',
        currency: 'EUR',
        plans: [
          {
            id: 'famille',
            name: 'Famille',
            priceCents: 1200,
            interval: 'month',
            features: ['Jusqu’à trois enfants', 'Fiches illimitées', 'Quiz de révision'],
            highlighted: true,
          },
        ],
        note: "Tarif d'illustration d'une application de démonstration.",
      },
    },
  },
]

/**
 * Toute application dont une page est réservée doit offrir un endroit pour se connecter :
 * c'est un des contrôles de cohérence de la plateforme. On l'ajoute ici plutôt que de le
 * recopier six fois, et le texte dit franchement que la démonstration est en lecture seule.
 */
function withSignIn(demo: DemoApp): DemoApp {
  const hasAuthBlock = demo.spec.pages.some((page) =>
    page.blocks.some((block) => block.type === 'auth'),
  )
  if (hasAuthBlock) return demo
  return {
    ...demo,
    spec: {
      ...demo.spec,
      pages: [
        ...demo.spec.pages,
        {
          id: 'connexion',
          title: 'Connexion',
          path: 'connexion',
          requiresAuth: false,
          blocks: [
            {
              id: 'entree',
              type: 'auth',
              title: 'Se connecter',
              body: "Cette application est une démonstration d'Evoliia : les inscriptions y sont fermées.",
            },
          ],
        },
      ],
      navigation: {
        ...demo.spec.navigation,
        items: [...demo.spec.navigation.items, { pageId: 'connexion', label: 'Connexion' }],
      },
    },
  }
}

export const DEMO_APPS: readonly DemoApp[] = RAW_DEMOS.map(withSignIn)
