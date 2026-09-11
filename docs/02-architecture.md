# 2. Architecture

## 2.1 Vue d'ensemble

```
                        ┌──────────────────────────────────────────┐
                        │             NAVIGATEUR                    │
                        │  Studio (créateur)   │  App publiée       │
                        │  /fr/dashboard       │  /a/<slug>         │
                        └───────┬──────────────┴─────────┬──────────┘
                                │                        │
                ┌───────────────▼────────────────────────▼───────────────┐
                │                  NEXT.JS (App Router)                   │
                │                                                         │
                │  studio/      runtime/        api/                      │
                │  ─────────    ─────────       ─────────                 │
                │  dashboard    rendu SSR       /api/auth/*                │
                │  éditeur      de l'AppSpec    /api/projects/*            │
                │  chat IA      formulaires     /api/ai/*                  │
                │  versions     listes          /api/app/<id>/records/*    │
                └───────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┬─────────────────┐
        │                       │                       │                 │
┌───────▼────────┐   ┌──────────▼─────────┐   ┌─────────▼──────┐  ┌──────▼──────┐
│ server/ai      │   │ server/spec        │   │ server/repos   │  │ server/     │
│ Orchestrateur  │   │ Schéma + patch +   │   │ Accès données  │  │ billing     │
│ + crédits      │   │ compilateur        │   │ à portée de    │  │ (Stripe,    │
│ + coûts        │   │ (web / export)     │   │ locataire      │  │  plus tard  │
└───────┬────────┘   └────────────────────┘   └─────────┬──────┘  │  IAP)       │
        │                                               │         └─────────────┘
┌───────▼────────┐                            ┌─────────▼──────────────────┐
│ API Anthropic  │                            │ PostgreSQL 16              │
│ Opus / Sonnet  │                            │ + Row Level Security        │
└────────────────┘                            └────────────────────────────┘
```

Trois surfaces HTTP distinctes, avec des règles de sécurité différentes :

| Surface | Chemin | Qui | Session |
|---|---|---|---|
| Studio | `/<locale>/...` | Créateurs (nos clients) | Cookie `af_session` |
| Runtime app publiée | `/a/<slug>/...` | Utilisateurs finaux du client | Cookie `afu_<appId>`, cloisonné par application |
| Aperçu | `/preview/<projectId>` | Créateur propriétaire uniquement | Cookie `af_session`, rendu en `iframe` `sandbox` |

Cette séparation est structurelle : un utilisateur final d'une application créée n'obtient
**jamais** de session studio, et sa session n'est valide que pour l'application qui l'a émise.

## 2.2 Cycle de vie d'une création

```
1. Idée         L'utilisateur décrit son idée en français courant.
2. Analyse      L'IA produit un "Blueprint" (concept, fonctions, monétisation) — pas encore l'app.
3. Accord       L'utilisateur valide ou ajuste en langage naturel.
4. Génération   L'IA produit une AppSpec complète, validée par Zod.  → version 1
5. Aperçu       Le compilateur web rend l'AppSpec ; l'utilisateur teste vraiment.
6. Itération    Chaque demande produit un SpecPatch validé.          → versions 2..n
7. Publication  L'AppSpec est figée et servie sur /a/<slug>.
```

Chaque étape 4 et 6 crée une **version immuable** (exigence 19). Le retour arrière
consiste à créer une nouvelle version dont le contenu est celui d'une version antérieure :
l'historique n'est jamais réécrit.

## 2.3 Les trois compilateurs de l'AppSpec

Une seule spécification, plusieurs sorties — c'est ce qui rend l'exigence 8 réalisable.

| Compilateur | État | Sortie |
|---|---|---|
| `compileToWeb` | **livré (MVP)** | Arbre de rendu React SSR + runtime client léger |
| `compileToProject` | phase 2 | Projet Vite + React + TypeScript exportable / GitHub |
| `compileToMobile` | phase 3 | Même projet + Capacitor, cibles iOS et Android |

Les trois consomment le même schéma. Ajouter un type de bloc se fait à un endroit
(`spec/blocks`) et les compilateurs déjà écrits doivent le gérer explicitement — le
`switch` exhaustif de TypeScript rend l'oubli impossible à compiler.

## 2.4 Modularité serveur

```
src/server/
  auth/        sessions, mots de passe, garde d'accès
  ai/          client Anthropic, prompts, outils, routage de modèle, comptabilité
  spec/        schéma AppSpec, patch, validation, compilateurs
  projects/    cas d'usage projet (créer, générer, modifier, versionner, publier)
  runtime/     données des applications générées, utilisateurs finaux
  billing/     plans, crédits, fournisseurs de paiement (Stripe, IAP plus tard)
  db/          client Prisma, contexte de locataire
  observability/ journalisation structurée
```

Règle : une route HTTP ne contient jamais de logique métier. Elle valide l'entrée (Zod),
appelle un cas d'usage, traduit le résultat en réponse. Cela rend les cas d'usage testables
sans HTTP et permet de les réutiliser depuis un futur worker ou une CLI.
