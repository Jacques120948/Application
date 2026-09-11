# 8. Périmètre du MVP et phases

## 8.1 Définition du MVP

Le MVP est atteint quand **une personne sans aucune connaissance technique peut, seule,
partir d'une phrase et obtenir une application web réellement en ligne**.

### Dans le périmètre

| # | Fonction | Critère d'acceptation |
|---|---|---|
| 1 | Inscription / connexion | Compte créé, session persistante, mot de passe haché, déconnexion effective |
| 2 | Tableau de bord | Liste des projets avec nom, statut, dernière modification ; bouton « Créer une application » |
| 3 | Création de projet | Choix parmi des exemples ou saisie libre, plus « Je n'ai pas encore d'idée » |
| 4 | Assistant d'idées | Propose des idées à partir du profil, sans jamais promettre de revenus |
| 5 | Blueprint | Concept, fonctions, monétisation proposés avant toute génération |
| 6 | Génération | Une AppSpec valide, une version 1 enregistrée |
| 7 | Aperçu réel | Rendu dans un `iframe` cloisonné, formats téléphone / tablette / ordinateur |
| 8 | Modification conversationnelle | « Mets le bouton en bleu » produit un patch appliqué et visible |
| 9 | Versions | Liste des versions, restauration en un clic |
| 10 | Publication web | L'application est servie publiquement sur `/a/<slug>` |
| 11 | Données de l'application | Les blocs formulaire et liste enregistrent et relisent réellement des données |
| 12 | Crédits IA | Solde vérifié avant appel, débit après appel, journal consultable |
| 13 | Progression | Idée / Design / Fonctionnalités / Tests / Monétisation / Publication |
| 14 | Multilingue de la plateforme | fr et en complets, de/it/es structurés |

### Hors périmètre du MVP, et affiché comme tel

Stripe réel, authentification des utilisateurs finaux par Google/Apple, domaine
personnalisé, export de code, préparation iOS/Android, génération d'images, analytique
avancée, marketplace de templates.

Ces zones existent dans l'interface uniquement sous forme d'états « bientôt disponible »
explicites — jamais de bouton qui ne fait rien (exigence 41).

## 8.2 Phases

| Phase | Contenu | État |
|---|---|---|
| **1 — MVP** | Les 14 points ci-dessus | en cours |
| **2** | Templates, comptes utilisateurs finaux complets, Stripe (Checkout, webhooks, portail), domaine personnalisé, tests automatiques et correction assistée | prévu |
| **3** | Compilateur de projet exportable, Capacitor, checklists App Store et Google Play, assets de stores, achats intégrés | prévu |
| **4** | Assistant business, recherche d'idées avancée, analytique, marketing, optimisation des coûts IA, marketplace de templates | prévu |

Chaque phase est additive : aucune ne demande de réécrire la précédente, parce que
l'AppSpec reste le point de passage unique.
