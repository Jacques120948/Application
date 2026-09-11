# Mettre AppForge en ligne

Ce guide s'adresse à quelqu'un qui n'a jamais mis un site en ligne. Aucune commande à
taper dans un terminal. Comptez vingt minutes.

À la fin, vous aurez une adresse internet à vous, du type `appforge-xxxx.up.railway.app`,
sur laquelle vous pourrez créer votre compte et utiliser la plateforme.

---

## Ce qu'il vous faut

Trois choses, chacune avec son coût réel. Rien n'est caché.

| Élément | À quoi ça sert | Coût |
|---|---|---|
| Un hébergeur | Faire tourner la plateforme sur internet | 0 à 5 € par mois |
| Une base de données | Conserver les comptes, les idées, les applications | incluse ou gratuite |
| Une clé d'accès au copilote | Faire fonctionner l'IA | à l'usage, environ 0,37 $ par parcours complet |

**Créez une nouvelle clé Anthropic.** Celle utilisée pendant le développement a circulé
dans une conversation : supprimez-la sur `console.anthropic.com` et créez-en une neuve,
avec une limite de dépense mensuelle basse (10 $ suffisent pour tester).

---

## Solution recommandée : Railway

La plus simple. Un seul compte, la base de données est fournie, tout est branché
automatiquement. Environ 5 € par mois.

### 1. Créer le projet

1. Allez sur **railway.com** et créez un compte avec votre compte GitHub.
2. Cliquez sur **New Project**, puis **Deploy from GitHub repo**.
3. Choisissez le dépôt **Application** et la branche `claude/ai-nocode-app-platform-d5g0br`.

Railway commence à construire. Il va échouer une première fois : c'est normal, la base de
données n'existe pas encore.

### 2. Ajouter la base de données

1. Dans votre projet, cliquez sur **New**, puis **Database**, puis **Add PostgreSQL**.
2. Railway crée la base et la relie automatiquement à votre application.

### 3. Renseigner les cinq réglages

Cliquez sur votre application, puis sur l'onglet **Variables**, et ajoutez ceci :

| Nom | Valeur à mettre |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — copiez exactement, Railway remplace tout seul |
| `DIRECT_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — la même chose |
| `SESSION_SECRET` | Quarante caractères au hasard, tapés sur votre clavier |
| `ENCRYPTION_KEY` | Quarante autres caractères au hasard, différents |
| `ANTHROPIC_API_KEY` | Votre nouvelle clé, celle qui commence par `sk-ant-` |
| `APP_URL` | L'adresse que Railway vous donne, par exemple `https://appforge-xxxx.up.railway.app` |
| `SIGNUP_CODE` | Un mot de passe de votre choix. Sans lui, n'importe qui pourrait créer un compte |

Pour `APP_URL` : allez d'abord dans **Settings**, section **Networking**, et cliquez sur
**Generate Domain**. Railway vous donne l'adresse, que vous recopiez dans `APP_URL`.

### 4. Relancer

Cliquez sur **Deploy**. Cette fois la construction va au bout. Elle prépare la base de
données toute seule, sans que vous ayez rien à faire.

Ouvrez votre adresse. Vous êtes chez vous.

---

## Solution gratuite : Vercel et Neon

Gratuite, mais deux comptes à créer au lieu d'un, et un peu plus de copier-coller.

### 1. La base de données

1. Allez sur **neon.com**, créez un compte, puis un projet.
2. Dans **Connection string**, copiez deux adresses :
   - celle marquée **Pooled connection** — ce sera `DATABASE_URL` ;
   - celle marquée **Direct connection** — ce sera `DIRECT_DATABASE_URL`.
3. À la fin de la première adresse seulement, ajoutez `&pgbouncer=true`.

### 2. L'hébergement

1. Allez sur **vercel.com**, créez un compte avec GitHub.
2. **Add New**, puis **Project**, choisissez le dépôt **Application** et la branche
   `claude/ai-nocode-app-platform-d5g0br`.
3. Dans **Environment Variables**, ajoutez les mêmes sept réglages que dans le tableau
   ci-dessus, avec les deux adresses de Neon.
4. Cliquez sur **Deploy**.

---

## Une fois en ligne

**Créez votre compte.** Le premier compte créé n'a rien de spécial : c'est un compte comme
un autre. Vous arriverez sur la question de l'objectif.

**Vous serez sur l'offre de découverte**, avec 30 crédits. Elle permet de chercher et
d'analyser des idées, mais pas de construire. Pour construire sans attendre le paiement en
ligne, qui n'est pas encore développé, ouvrez la base de données de votre hébergeur et
passez-vous sur l'offre `builder` : c'est une ligne à ajouter dans la table
`Subscription`. Dites-le moi et je vous prépare la commande exacte.

**Surveillez la dépense.** Chaque recherche d'idées, analyse, cahier des charges ou
construction consomme des crédits, et les crédits correspondent à de l'argent réel chez
Anthropic. La limite de dépense mensuelle que vous avez posée sur votre clé est votre
protection.

---

## Ce qui reste à faire ensuite

Ces éléments ne sont pas développés, et leur absence ne vous empêche pas de tester :

- le paiement de l'abonnement par carte ;
- l'achat de crédits supplémentaires ;
- l'espace d'administration ;
- le nom de domaine à vous, du type `monapp.fr`.

---

## Si quelque chose ne marche pas

L'erreur la plus fréquente est une adresse de base de données mal recopiée. Sur Railway,
regardez l'onglet **Deployments**, puis le journal de la dernière construction : le message
d'erreur y est écrit en clair. Envoyez-le moi, je vous dirai quoi corriger.
