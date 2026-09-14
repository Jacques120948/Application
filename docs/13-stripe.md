# Paiement : Stripe

Deux chantiers, un seul compte Stripe (celui d'Evoliia), et une règle qui tient tout :
**la base d'Evoliia ne change que sur ce que Stripe confirme par un événement signé.**
Un paiement lancé n'ouvre rien ; l'adresse de retour n'est jamais crue.

## 1. Les abonnements Evoliia

Le créateur paie son offre Evoliia en ligne.

| Étape | Ce qui se passe |
|---|---|
| Choisir une offre (`/abonnement`) | `POST /api/abonnement` crée une session Stripe Checkout (mode abonnement) et renvoie son adresse. Le tarif Stripe est créé à la demande depuis la table `Plan` ; changer un prix dans l'administration crée un nouveau tarif au prochain paiement, les abonnés en cours gardent l'ancien. |
| Retour de paiement | `?etat=succes&session_id=…` → `POST /api/abonnement/retour` relit la session **chez Stripe** et vérifie qu'elle appartient à la personne connectée. Commodité seulement : le webhook fait foi. |
| Webhook `/api/stripe/webhook` | Signature vérifiée (`STRIPE_WEBHOOK_SECRET`), événement enregistré dans `StripeEvent` (une seule fois, quel que soit le nombre de livraisons), puis reporté dans `Subscription`. Les crédits de l'offre sont dotés immédiatement par `getWallet`. |
| Changer d'offre | Un abonné Stripe change directement, au prorata (`stripe.subscriptions.update`). |
| Résilier | À la fin de la période payée ; l'offre reste ouverte jusque-là. Reprise possible. |
| Factures, carte | Portail client Stripe (`POST /api/abonnement/portail`). |

Statuts Stripe → Evoliia : `active` → ACTIVE, `trialing` → TRIALING, `past_due` / `unpaid`
→ PAST_DUE (l'offre se ferme : `getEffectivePlan` ne retient qu'ACTIVE et TRIALING),
`incomplete` → rien n'est ouvert, `canceled` → la ligne `Subscription` est supprimée.

Une offre attribuée à la main (sans `stripeSubscriptionId`) reste gérée à la main : la page
le dit, et ne propose ni portail ni résiliation.

## 2. Les créateurs encaissent leurs clients (Stripe Connect)

Le visiteur d'une application paie **le créateur**, sur le compte Stripe **du créateur**.
Evoliia est la plateforme Connect ; les comptes connectés sont des **comptes v2 à
tableau de bord complet** (l'équivalent des anciens comptes standard, que Stripe ne crée
plus pour les nouvelles intégrations) : frais et pertes à la charge du titulaire
(`fees_collector` et `losses_collector` à « stripe »), jamais de la plateforme. Le
créateur garde son tableau de bord Stripe, ses virements, ses obligations, ses frais.
L'argent ne passe jamais par le compte d'Evoliia. Le pays du compte est déduit du profil
du créateur (Suisse à défaut) ; Stripe ne le laisse pas changer ensuite.

| Étape | Ce qui se passe |
|---|---|
| Relier son compte (écran Connexions) | `POST /api/connexions/stripe` crée un compte v2 (une seule fois, l'inscription se reprend) et renvoie un lien d'inscription Stripe. L'identifiant `acct_…` est conservé comme n'importe quel secret de créateur : chiffré, jamais renvoyé au navigateur. |
| Retour de Stripe | `GET /api/connexions/stripe/retour` relit le compte chez Stripe : capacité `card_payments` active → CONNECTED, sinon la connexion reste « à terminer » avec un bouton pour reprendre. |
| Le visiteur choisit une offre | Bouton sur le bloc Tarifs, réservé aux personnes ayant un compte dans l'application. `POST /api/app/<projet>/paiement` crée la session Checkout **sur le compte connecté** (`stripeAccount`), en paiement unique ou abonnement selon le rythme de l'offre. L'aperçu du studio refuse. |
| Webhook `/api/stripe/webhook/connect` | Secret distinct (`STRIPE_CONNECT_WEBHOOK_SECRET`). Le compte émetteur de l'événement doit être celui du créateur désigné dans les métadonnées, sans quoi l'événement est ignoré : un compte connecté ne peut pas fabriquer une vente pour le projet d'un autre. La vente est écrite dans `AppPurchase`, sous Row Level Security par projet. |
| Le créateur voit ses ventes | Onglet Monétisation (`GET /api/projects/<id>/ventes`) : encaissé, nombre, abonnés actifs, dernières ventes. Montants confirmés par Stripe, avant ses frais. |

Commission d'Evoliia : `STRIPE_APPLICATION_FEE_PERCENT` (0 à 30, **zéro par défaut**).
La prendre est une décision commerciale, pas un réglage du code ; la fiche du catalogue
promet d'en informer le créateur avant.

### Remboursements

| Qui | Où | Ce qui se passe |
|---|---|---|
| Le créateur | Onglet Monétisation, bouton « Rembourser » | `POST /api/projects/<id>/ventes/<vente>/remboursement`. Paiement unique : remboursement total, ou partiel (`amountCents`). Abonnement : résiliation immédiate et remboursement de la dernière facture (relue chez Stripe). La commission d'Evoliia, s'il y en a eu une, est restituée (`refund_application_fee`) : on ne garde pas une commission sur une vente annulée. L'argent repart du compte Stripe du créateur. |
| Le créateur | Son tableau de bord Stripe | L'événement `charge.refunded` est rapatrié par le webhook Connect : la vente passe à « remboursé » (ou garde le montant partiel). Un paiement unique est retrouvé par ses métadonnées ; une facture d'abonnement est remontée jusqu'à l'abonnement, qui les porte. |
| L'administrateur d'Evoliia | Back-office, bouton « Rembourser » sur un abonné Stripe | `POST /api/admin/users/<id>/remboursement` : remboursement de la dernière facture et fermeture immédiate de l'offre. C'est l'argent d'Evoliia qui repart : administrateur seulement. Un remboursement fait depuis le tableau de bord Stripe d'Evoliia est seulement journalisé ; fermer l'offre reste une décision du back-office. |

Non couvert : les achats intégrés iPhone et Android restent hors périmètre.

## Ce que ça coûte à Evoliia

Rien de variable. Les frais Stripe des abonnements Evoliia sont ceux de tout marchand ;
les frais des ventes des créateurs sont facturés aux comptes connectés (« Stripe fixe les
prix »). Aucun compte connecté n'entraîne de frais de compte ni de versement pour la
plateforme. Mille créateurs reliés ne produisent aucune facture pour Evoliia.

## Mise en service

Variables d'environnement :

```
STRIPE_SECRET_KEY                 clé secrète du compte Evoliia
STRIPE_WEBHOOK_SECRET             secret du webhook « compte » → /api/stripe/webhook
STRIPE_CONNECT_WEBHOOK_SECRET     secret du webhook « comptes connectés » → /api/stripe/webhook/connect
STRIPE_APPLICATION_FEE_PERCENT    facultatif, 0 par défaut
```

Dans le tableau de bord Stripe :

1. Webhook « compte » sur `https://evoliia.com/api/stripe/webhook`, événements
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`, `charge.refunded`.
2. Webhook « comptes connectés » (option *Listen to events on connected accounts*) sur
   `https://evoliia.com/api/stripe/webhook/connect`, événements
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `charge.refunded`.
3. Portail client : activer et choisir ce que le client peut faire (moyen de paiement,
   factures, résiliation).
4. Connect : compléter le profil de plateforme et l'interface d'inscription (marque).
   Aucune option « Accounts v1 » à activer : Evoliia crée des comptes v2.

## Passage du mode test au mode production

Stripe sépare strictement les deux modes : un tarif, un client, un abonnement ou un compte
connecté créé en test **n'existe pas** en production. Le code le sait :

- l'empreinte d'un tarif (`Plan.stripePriceFingerprint`) commence par le mode ; à la
  première demande de paiement en production, produit et tarif sont recréés, sans chercher
  à désactiver ceux du mode test ;
- un `stripeCustomerId` est vérifié chez Stripe avant usage, et recréé s'il est inconnu ;
- un abonnement qui n'existe plus chez Stripe (abonnement d'essai du mode test) est retiré
  de la base au premier geste — changement d'offre ou résiliation — et la personne retombe
  sur l'offre gratuite ; l'exploitant peut aussi retirer l'offre depuis le back-office ;
- un compte connecté du mode test doit être **déconnecté puis reconnecté** par le créateur
  depuis Connexions : le message d'erreur de Stripe le dit en toutes lettres.

Marche à suivre : activer le compte Stripe, recréer en mode production les deux webhooks,
le portail client et l'interface d'inscription Connect, remplacer les trois secrets dans
l'hébergeur, redéployer, puis faire un vrai paiement de petit montant et le rembourser.

Sans `STRIPE_SECRET_KEY`, rien n'est proposé nulle part : la page des offres dit que le
paiement en ligne n'est pas activé, la carte Stripe des Connexions reste « à venir », et
toutes les routes de paiement répondent « introuvable ».

## Ce qui ne quitte jamais le serveur

La clé Stripe ne sort pas de `src/server/billing/stripe/client.ts`. Les services reçoivent
un client, pas une clé — c'est aussi ce qui permet de leur passer un faux client dans les
tests. L'identifiant de compte connecté est chiffré comme un secret. Les journaux ne
reçoivent que des identifiants de projet, de personne et d'événement.
