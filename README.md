# Evoliia

Plateforme SaaS permettant à une personne qui ne sait pas coder de passer d'une idée à une
application web fonctionnelle, monétisable et publiée.

> Décrivez votre idée. L'assistant construit votre application et vous accompagne
> jusqu'à sa mise en ligne.

## Où en est le produit

Ce dépôt contient la **phase 1 (MVP)** décrite dans `docs/08-perimetre-mvp.md`.

Fonctionne réellement aujourd'hui :

- inscription, connexion, sessions sécurisées ;
- tableau de bord des applications ;
- parcours de création : idée → plan proposé → construction → version 1 ;
- assistant conversationnel qui modifie l'application en langage naturel ;
- éditeur visuel sans IA (identité, couleurs, style, ordre des sections, tarifs) ;
- aperçu en direct de l'application réelle, en format téléphone, tablette et ordinateur ;
- historique des versions et restauration ;
- contrôles de publication chiffrés et bouton « Tester mon application » ;
- publication web sur `/a/<adresse>` ;
- comptes et données des utilisateurs finaux des applications créées ;
- crédits IA avec coût réel mesuré par appel.

Pas encore disponible, et signalé comme tel dans l'interface (jamais un bouton inerte) :
paiements Stripe réels, achats intégrés iOS et Android, domaine personnalisé, export du
code, préparation App Store et Google Play, génération d'images.

## Démarrage

Prérequis : Node.js 20.11+ et PostgreSQL 16.

```bash
npm install
cp .env.example .env          # puis renseigner les valeurs

# Rôles PostgreSQL (une fois par environnement, avec un rôle ayant CREATEROLE)
psql -d appforge_dev -f scripts/setup-db.sql

npm run db:deploy             # migrations, dont le Row Level Security
npm run db:seed               # offres par défaut
npm run dev
```

### Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Rôle applicatif (`appforge_app`), **soumis au Row Level Security** |
| `DIRECT_DATABASE_URL` | Rôle propriétaire, utilisé uniquement par les migrations |
| `SESSION_SECRET` | Clé HMAC des jetons de session (32 caractères minimum) |
| `ENCRYPTION_KEY` | Clé de chiffrement des secrets des créateurs |
| `ANTHROPIC_API_KEY` | Accès à l'assistant. **Facultative** — voir ci-dessous |
| `APP_URL` | Adresse publique de la plateforme |
| `SIGNUP_CODE` | Code exigé à l'inscription. **Facultative** — sans elle, l'inscription est ouverte |
| `ADMIN_EMAIL` | Compte promu administrateur à chaque mise en ligne. **Facultative** |
| `RESEND_API_KEY` | Envoi des e-mails transactionnels. **Facultative** — sans elle, aucun message n'est envoyé |
| `EMAIL_FROM` | Expéditeur des e-mails, par exemple `Evoliia <bonjour@evoliia.com>` |

### Coûts observés

Mesurés sur des générations réelles, aux tarifs publics de l'API Claude :

| Opération | Coût |
|---|---|
| Analyse d'une idée | 0,011 USD |
| Construction d'une application de six pages | 0,105 USD |
| Une modification demandée à l'assistant | 0,008 à 0,012 USD |

Un crédit correspond à un millième de dollar de coût API. Les dotations mensuelles par
offre sont calées là-dessus et se modifient depuis le back-office, à `/fr/administration`,
sans redéploiement.

### Sans clé d'accès au modèle

La plateforme reste utilisable de bout en bout : le parcours de création retombe sur des
modèles de départ déterministes, et l'interface indique explicitement que la structure ne
vient pas de l'assistant. Aucun écran ne laisse croire qu'une IA a travaillé alors que non.

## Mettre en ligne

Voir **[DEPLOIEMENT.md](DEPLOIEMENT.md)** : guide pas à pas, sans terminal, pour Railway ou
pour Vercel et Neon.

Une seule commande suffit sur l'hébergeur. `npm run build` applique les migrations, insère
les offres par défaut, puis construit l'application. Vérifié sur une base vierge.

La sécurité ne dépend pas d'une configuration particulière de la base : les politiques Row
Level Security sont posées en `FORCE`, donc elles s'appliquent même au rôle propriétaire.
Une installation avec une seule adresse de connexion, comme en fournissent les hébergeurs
gérés, reste protégée. Les tests d'isolation ont été rejoués dans cette configuration.

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Construction de production |
| `npm run typecheck` | TypeScript strict, sans émission |
| `npm test` | Tests unitaires et d'intégration |
| `npm run db:migrate` | Nouvelle migration en développement |
| `npm run db:deploy` | Application des migrations |
| `npm run db:seed` | Offres par défaut |

Les tests d'intégration tournent sur une vraie base PostgreSQL, avec le rôle applicatif
soumis au Row Level Security : c'est la seule façon de vérifier réellement l'isolation
entre clients. Base attendue : `appforge_test`.

La suite de tests ne passe **jamais** d'appel au modèle : `vitest.config.ts` neutralise la
clé d'accès. Des tests qui dépenseraient de l'argent à chaque exécution ne seraient ni
reproductibles ni exécutables en intégration continue. Le chemin assistant se vérifie
manuellement, avec une clé, sur une installation de développement.

## Architecture en une phrase

L'assistant ne produit jamais de code : il produit une **AppSpec**, description
déclarative strictement validée, que des compilateurs déterministes transforment en
application réelle. Conséquence directe : aucune instruction utilisateur, même
malveillante, ne devient du code exécuté sur nos serveurs.

## Documentation

| Document | Contenu |
|---|---|
| `docs/01-analyse-et-stack.md` | Analyse du cahier des charges et choix de la stack |
| `docs/02-architecture.md` | Vue d'ensemble, surfaces HTTP, compilateurs |
| `docs/03-modele-de-donnees.md` | Tables et justifications |
| `docs/04-isolation-multi-tenant.md` | Modèle de menace et quatre barrières |
| `docs/05-moteur-ia.md` | Contrats de sortie, routage de modèles, coûts |
| `docs/06-risques.md` | Risques techniques, de sécurité et produit |
| `docs/07-arborescence.md` | Organisation du code et règles de dépendance |
| `docs/08-perimetre-mvp.md` | Périmètre du MVP et phases suivantes |
