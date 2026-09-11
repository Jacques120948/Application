# 1. Analyse du cahier des charges et choix de la stack

## 1.1 Ce que le produit doit vraiment être

Le cahier des charges décrit trois produits imbriqués :

1. **Un studio de création assisté par IA** (chat + aperçu + éditeur visuel) ;
2. **Un runtime d'applications multi-locataires** qui exécute réellement les applications créées ;
3. **Un SaaS commercial** (comptes, abonnements, crédits IA, back-office, coûts).

La contrainte dominante n'est pas l'IA : c'est **l'exécution sécurisée de milliers
d'applications créées par des inconnus, sur notre infrastructure**. Toute décision
d'architecture découle de là.

## 1.2 La décision centrale : spécification déclarative plutôt que code libre

Deux approches existent pour « l'IA crée une application » :

| | A. L'IA écrit du code libre | B. L'IA écrit une spécification déclarative |
|---|---|---|
| Sécurité | Exécution de code arbitraire, sandbox obligatoire | Aucune exécution de code généré |
| Fiabilité | Code cassé fréquent, build rouge | Impossible de produire une app qui ne démarre pas |
| Coût IA | Élevé (milliers de tokens par écran) | Faible (JSON compact) |
| Modification en langage naturel | Difficile (diff de code) | Facile (patch structuré) |
| Retour arrière | Complexe | Trivial (une version = un JSON) |
| Plafond de puissance | Illimité | Limité au vocabulaire du schéma |

Nous retenons **B comme source de vérité, avec A comme sortie** :

> L'IA produit et modifie une **AppSpec** (JSON strictement validé). Un **compilateur
> déterministe** transforme cette AppSpec en application réellement exécutable
> (aujourd'hui : rendu web + PWA ; demain : projet React exportable, puis binaire
> mobile via Capacitor).

Conséquences directes :

- **Point 30 (architecture IA)** est satisfait par construction : aucune instruction
  utilisateur, même malveillante, ne devient du code exécuté. Le pire cas est une
  AppSpec invalide, rejetée par le validateur.
- **Point 19 (versions)** devient trivial : une version = un document JSON immuable.
- **Point 8 (web / iOS / Android)** devient réaliste : une seule spécification, plusieurs
  compilateurs de sortie. C'est le seul moyen de « réutiliser le maximum de code ».
- **Point 37 (coûts IA)** est maîtrisable : une modification coûte quelques centaines de
  tokens au lieu de plusieurs milliers.
- **Point 29 (export)** reste tenu : le compilateur émet un vrai projet, pas un format
  propriétaire fermé.

Le prix à payer est assumé : la plateforme ne peut construire que ce que son vocabulaire
sait décrire. C'est acceptable pour la cible (débutants, applications de contenu, de
réservation, de catalogue, d'abonnement) et le vocabulaire s'étend version après version
sans rien casser.

## 1.3 Stack retenue

| Couche | Choix | Raison |
|---|---|---|
| Langage | TypeScript 5, `strict: true` | Exigence 41, schéma partagé front/back |
| Framework | Next.js 15 (App Router), React 19 | Un seul déploiement pour le studio, l'API et le runtime des apps publiées ; SSR pour le SEO des apps créées |
| Style | Tailwind CSS 4 + design system maison (tokens CSS) | Exigence 39, cohérence, poids minimal |
| Base de données | PostgreSQL 16 | JSONB pour les AppSpec, RLS natif pour le multi-tenant, standard et peu coûteux |
| Accès données | Prisma 6 + couche `repositories` à portée de locataire | Migrations versionnées, typage, point de passage unique pour l'isolation |
| Validation | Zod 4 | Un schéma = validation runtime + type TypeScript, réutilisé comme contrat de sortie IA |
| Authentification | Session serveur maison (cookie `HttpOnly`, `SameSite=Lax`, jeton haché en base) + scrypt | Pas de dépendance opaque, rotation et révocation explicites, testable hors ligne |
| IA | SDK Anthropic officiel, routage Opus/Sonnet selon la complexité | Exigence 37 (modèles différents selon la complexité) |
| Paiement plateforme | Stripe (Checkout + portail client + webhooks) | Exigence 11 |
| Tests | Vitest (unitaire + intégration base) | Exigence 41 |
| i18n | Catalogues JSON + résolution serveur, aucune chaîne en dur | Exigence 26 |

### Pourquoi pas d'autres options fréquentes

- **Supabase / Firebase comme socle** : pratique au départ, mais l'isolation des
  applications générées deviendrait dépendante d'un tiers, et l'exigence 18 est
  contractuelle. Nous gardons Postgres sous notre contrôle.
- **Micro-services dès la V1** : coût opérationnel injustifié. Un monolithe modulaire
  Next.js avec des frontières internes nettes (`src/server/<domaine>`) se découpe plus
  tard sans réécriture.
- **Conteneur par application générée** : c'est l'approche coûteuse (un conteneur par
  client). Le modèle déclaratif permet de servir des milliers d'applications depuis un
  runtime unique et mutualisé, avec les données isolées en base.

## 1.4 Périmètre volontairement exclu de la V1

Signalé ici pour éviter toute ambiguïté (exigence 41 : pas de fausses fonctions) :

- Achats intégrés iOS/Android : l'architecture les prévoit (couche `billing/provider`),
  aucune intégration réelle n'est livrée en V1.
- Build binaire `.ipa` / `.aab` : phase 3.
- Domaine personnalisé : phase 2.
- Génération d'images (icônes, captures) : phase 3.

Ces éléments sont visibles dans le produit uniquement sous forme d'états explicitement
marqués « à venir », jamais comme des boutons inertes.
