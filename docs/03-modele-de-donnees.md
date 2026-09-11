# 3. Modèle de données

PostgreSQL 16. Trois domaines nettement séparés : **plateforme**, **projets**,
**runtime des applications générées**.

## 3.1 Domaine plateforme

| Table | Rôle | Colonnes structurantes |
|---|---|---|
| `User` | Créateur (notre client) | `email` unique, `passwordHash` (scrypt), `role`, `locale`, `emailVerifiedAt` |
| `Session` | Session studio | `tokenHash` (jamais le jeton en clair), `expiresAt`, `revokedAt`, `ip`, `userAgent` |
| `VerificationToken` | Vérification e-mail et réinitialisation | `tokenHash`, `purpose`, `expiresAt`, `consumedAt` |
| `Plan` | Offre commerciale **configurable** | `maxProjects`, `monthlyCredits`, `allowExport`, `allowCustomDomain`, `allowMobilePrep`, `priceCents` |
| `Subscription` | Abonnement d'un créateur | `status`, `stripeCustomerId`, `stripeSubscriptionId`, `currentPeriodEnd` |
| `CreditWallet` | Solde de crédits IA | `balance`, `monthlyGrant`, `resetsAt` |
| `CreditLedger` | Journal immuable des mouvements | `delta`, `reason`, `projectId`, `balanceAfter` |
| `AiUsage` | Comptabilité IA fine | `model`, `inputTokens`, `outputTokens`, `costMicros`, `latencyMs`, `operation`, `success` |

`CreditLedger` est en écriture seule : le solde de `CreditWallet` est un cache, la vérité
est la somme du journal. Cela rend tout écart auditable (exigence 37).

`Plan` est en base et non en dur : les limites et tarifs sont modifiables depuis
l'administration sans redéploiement (exigence 34).

## 3.2 Domaine projets

| Table | Rôle |
|---|---|
| `Project` | Une application en cours de création. Porte `draftSpec` (JSONB), `status`, `slug` public |
| `ProjectVersion` | Version immuable : `number`, `label` lisible, `spec` (JSONB), `source` (`AI`/`USER`/`RESTORE`) |
| `ChatMessage` | Conversation avec l'assistant, rattachée au projet et éventuellement à la version produite |
| `ProjectCheck` | Résultat d'une analyse de préparation à la publication (exigences 15 et 16) |

`Project.draftSpec` est la spécification de travail. `publishedVersionId` pointe vers la
version réellement servie au public : **publier ne consiste jamais à servir le brouillon**.

## 3.3 Domaine runtime des applications générées

C'est le point le plus sensible. Les applications créées n'ont **pas** de tables SQL
dédiées (exigence 9 : l'utilisateur ne crée pas de tables).

| Table | Rôle | Clé d'isolation |
|---|---|---|
| `AppEndUser` | Utilisateur final d'une application créée | `projectId` + `email` unique ensemble |
| `AppRecord` | Enregistrement de données (recette, réservation, favori…) | `projectId`, `modelId`, `ownerEndUserId` |
| `AppEvent` | Événement d'usage pour les statistiques (exigence 33) | `projectId` |

Un `AppRecord` stocke ses champs en `JSONB`, validés **côté serveur** contre le modèle de
données déclaré dans l'AppSpec publiée. Le client ne choisit jamais la forme des données :
le serveur relit la spécification publiée et rejette tout champ inconnu, tout type
incorrect, toute valeur hors bornes.

Index : `(projectId, modelId, createdAt DESC)` et `(projectId, modelId, ownerEndUserId)`.
Contrainte de volume par projet appliquée au niveau applicatif selon le plan.

## 3.4 Migrations

Migrations Prisma versionnées dans `prisma/migrations`, appliquées par
`prisma migrate deploy`. Les politiques RLS et les index spécialisés sont ajoutés par une
migration SQL dédiée, versionnée au même titre que le reste — jamais appliqués à la main.
