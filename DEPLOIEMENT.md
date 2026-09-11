# Mettre Evoliia en ligne

Ce guide s'adresse à quelqu'un qui n'a jamais mis un site en ligne. Aucune commande à
taper dans un terminal. Comptez vingt minutes.

À la fin, vous aurez une adresse internet à vous, du type `appforge-xxxx.up.railway.app`,
sur laquelle vous pourrez créer votre compte et utiliser la plateforme.

---

## Ce qu'il vous faut

Trois choses, chacune avec son coût réel. Rien n'est caché.

| Élément | À quoi ça sert | Coût |
|---|---|---|
| Un hébergeur | Faire tourner la plateforme sur internet | gratuit avec Vercel |
| Une base de données | Conserver les comptes, les idées, les applications | gratuite avec Supabase |
| Une clé d'accès au copilote | Faire fonctionner l'IA | à l'usage, environ 0,37 $ par parcours complet |

**Créez une nouvelle clé Anthropic.** Celle utilisée pendant le développement a circulé
dans une conversation : supprimez-la sur `console.anthropic.com` et créez-en une neuve,
avec une limite de dépense mensuelle basse (10 $ suffisent pour tester).

---

## Vous avez déjà Vercel, GitHub et Supabase

C'est la meilleure combinaison, et elle est gratuite. Aucun compte à créer.

### 1. La base de données, dans Supabase

1. Ouvrez **supabase.com**, puis votre projet. Si vous n'en avez pas encore, cliquez sur
   **New project**. Choisissez un mot de passe pour la base et **notez-le** : il apparaît
   une seule fois.
2. En haut de la page, cliquez sur le bouton **Connect**.
3. Vous voyez plusieurs adresses de connexion. Il vous en faut deux, que vous
   reconnaîtrez à leur numéro :
   - celle qui contient **`:6543`** — c'est le « Transaction pooler » ;
   - celle qui contient **`:5432`** et `pooler.supabase.com` — c'est le « Session pooler ».
4. Dans les deux, remplacez `[YOUR-PASSWORD]` par le mot de passe que vous avez noté.
5. À la fin de la première seulement, celle en `:6543`, ajoutez `?pgbouncer=true`.

Gardez ces deux adresses sous la main. Ce sont des mots de passe : ne les envoyez à
personne, y compris dans une conversation.

### 2. L'hébergement, dans Vercel

1. Ouvrez **vercel.com**, cliquez sur **Add New**, puis **Project**.
2. Dans la liste de vos dépôts GitHub, choisissez **Application**.
3. Dépliez **Git Branch** et choisissez `claude/ai-nocode-app-platform-d5g0br`.
4. Dépliez **Environment Variables** et ajoutez les réglages du tableau ci-dessous.
5. Cliquez sur **Deploy**.

### 3. Les réglages à recopier

| Nom | Valeur à mettre |
|---|---|
| `DATABASE_URL` | L'adresse Supabase en **`:6543`**, terminée par `?pgbouncer=true` |
| `DIRECT_DATABASE_URL` | L'adresse Supabase en **`:5432`** |
| `SESSION_SECRET` | Quarante caractères au hasard, tapés sur votre clavier |
| `ENCRYPTION_KEY` | Quarante autres caractères au hasard, différents |
| `ANTHROPIC_API_KEY` | Votre nouvelle clé, celle qui commence par `sk-ant-` |
| `SIGNUP_CODE` | Un mot de passe de votre choix, sans lui n'importe qui pourrait créer un compte |
| `APP_URL` | À remplir après le premier déploiement, voir juste en dessous |

`APP_URL` ne peut être connue qu'une fois le site déployé. Laissez-la vide au premier
essai. Vercel vous donnera une adresse du type `application-xxxx.vercel.app` : revenez
alors dans **Settings**, puis **Environment Variables**, ajoutez `APP_URL` avec cette
adresse complète, précédée de `https://`, et relancez le déploiement avec **Redeploy**.

### 4. Ce que la mise en ligne fait toute seule

Vous n'avez aucune commande à taper. La construction prépare la base de données, insère
vos quatre formules, puis **vérifie que le cloisonnement des données fonctionne
réellement**. Si la base ne protège pas correctement les comptes les uns des autres, la
mise en ligne s'interrompt avec un message clair au lieu de mettre un site vulnérable sur
Internet.

---

## Autre possibilité : Railway

Si vous préférez ne gérer qu'un seul service, Railway fournit l'hébergement et la base
ensemble, pour environ 5 € par mois.

1. Sur **railway.com**, **New Project**, puis **Deploy from GitHub repo**, choisissez
   **Application** et la branche `claude/ai-nocode-app-platform-d5g0br`.
2. **New**, **Database**, **Add PostgreSQL**. Railway relie tout seul.
3. Dans **Variables**, mettez `${{Postgres.DATABASE_URL}}` pour `DATABASE_URL` **et** pour
   `DIRECT_DATABASE_URL`, puis les cinq autres réglages du tableau ci-dessus.
4. Dans **Settings**, **Networking**, cliquez sur **Generate Domain** pour obtenir votre
   adresse, recopiez-la dans `APP_URL`, et relancez.

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

L'erreur la plus fréquente est une adresse de base de données mal recopiée : mot de passe
non remplacé, ou les deux adresses interverties.

Sur Vercel, ouvrez le déploiement raté et regardez **Building**. Sur Railway, regardez
l'onglet **Deployments**. Le message y est écrit en clair.

Deux messages ont un sens précis :

- **« MISE EN LIGNE INTERROMPUE : le cloisonnement des données n'est pas garanti »** — la
  base ne protège pas les comptes les uns des autres. C'est volontaire : mieux vaut pas de
  site qu'un site qui laisse fuiter les données de vos clients. Envoyez-moi le détail.
- **« Can't reach database server »** — l'adresse de connexion est mauvaise, ou le mot de
  passe n'a pas été remplacé dans l'adresse.

Dans tous les cas, copiez-moi le message et je vous dirai quoi corriger.
