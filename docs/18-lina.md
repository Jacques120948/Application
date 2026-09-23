# Lina — CRM & Fidélisation

Lina répond à une question : **quels clients contacter, pourquoi, quand et avec quelle
offre ?** Elle travaille sur les clients déjà acquis. Elle recommande et prépare ; elle
n'envoie rien.

Écran : `/[locale]/lina` (tableau de bord) et `/[locale]/lina/segments`. Conversation :
l'écran d'équipe, `?agent=lina`. Fonction d'offre : `lina_agent`.

## Place dans l'équipe

```
Naya / MIRA / Néo / Gia / Milo ─► acquisition
                       Cleo    ─► conversion
                       Nova    ─► performance
                       Lina    ─► réachat, fidélisation
                       Nova    ─► mesure
                       Oria    ─► priorités
```

## Architecture

| Couche | Fichier | Ce qu'elle fait |
|---|---|---|
| Connecteur | `integrations/providers/shopify-clients.ts` | Réutilise la connexion Shopify existante. Export en masse (`bulkOperationRunQuery`) des clients : identifiant, date de création, nombre de commandes, montant cumulé, date de la dernière commande, consentement marketing (`defaultEmailAddress.marketingState`). **Ni nom, ni courriel, ni téléphone, ni adresse ne sont demandés.** Paniers abandonnés (`abandonedCheckouts`) : date, montant, finalisé ou non. |
| Collecte | `lina/collecte.ts` | Lance l'export, le suit (`auto` / `manuel` / `suivre`), relit le fichier et remplace l'index. Consentement demandé d'abord ; si Shopify le refuse, relance sans lui (« inconnu »). Rythmes de Nova : 12 h, pause après échec, 2 min entre deux analyses manuelles. Export abandonné après 3 h. |
| Données | tables `LinaClient`, `LinaSynchro`, `LinaReglages` (RLS forcée) | `LinaClient` est un **index**, pas un CRM : une ligne par client, sans rien qui dise qui il est. Shopify reste la source ; `ref` sert à ouvrir la fiche dans Shopify. Paniers stockés en totaux. |
| Segments | `lina/segments.ts` | Fonctions pures : 11 segments, indicateurs, RFM. |
| Recommandations | `lina/recommandations.ts` | Campagnes, constats (5 au plus), quick wins (5 au plus), santé de la base. |
| Vue | `lina/service.ts` | Recalcule tout à l'ouverture sur l'index en base : changer un seuil ne relit pas la boutique. |
| Conversation | `lina/contexte.ts`, `ai/prompts.ts` (`LINA_SYSTEM`) | Le modèle reçoit des segments et des totaux, **jamais une fiche client**. |
| Collaboration | `lina/delegation.ts`, `oria/signaux.ts` (`depuisLina`) | Milo rédige les emails d'une campagne, Cleo analyse le tunnel quand des paniers se perdent, Oria reçoit les trois meilleures campagnes en signaux « information ». |

## Segments (critères réglables)

Réglages par défaut (`lina/criteres.ts`), modifiables sur l'écran des segments : actif ≤ 90 j,
dormant > 180 j, nouveau ≤ 30 j, fidèle ≥ 3 commandes, VIP = 5 % qui dépensent le plus.

| Segment | Règle |
|---|---|
| Nouveaux clients | fiche créée depuis ≤ nouveauJours, au moins une commande |
| Clients actifs | dernière commande ≤ actifJours |
| Clients récurrents | ≥ 2 commandes |
| Clients fidèles | ≥ fideleCommandes et actifs |
| VIP | les k plus gros clients (k = part × acheteurs, arrondi vers le bas), ≥ 2 commandes ; dès 20 acheteurs |
| Fort panier | panier moyen dans les 20 % les plus élevés ; dès 20 acheteurs |
| Une seule commande | exactement 1 |
| À risque | ≥ 2 commandes, silence > 2 × l'écart habituel estimé (et > 30 j), pas encore dormant — « risque estimé » |
| À réactiver | dernière commande entre actifJours et dormantJours |
| Dormants | dernière commande > dormantJours |
| Inscrits sans commande | fiche sans commande |

Un client est dans plusieurs segments : ils ne s'additionnent pas. Sous 20 clients, un
segment est signalé « trop petit ». Chaque segment exprimable a sa requête Shopify
(Clients → Segments), restreinte à `email_subscription_status = 'SUBSCRIBED'` quand le
consentement est lu.

**RFM** (indicateur interne, dès 50 acheteurs) : récence et montant notés par quintiles de
la boutique, fréquence par paliers fixes (1, 2, 3, 4–5, 6+). Classes : Champions, Clients
fidèles, Potentiel VIP, À réactiver, À risque, Dormants, Récents occasionnels.

## Campagnes

Réactivation, win-back, deuxième commande, post-achat (J+3, J+10, J+30, J+60), VIP, clients
au comportement inhabituel, inscrits sans commande, paniers abandonnés (1 h, 24 h, 72 h).
Chacune : audience, objectif, message, timing, canal, étapes, impact, effort, requête
Shopify. **Jamais de remise par défaut.** Audience = clients qui acceptent les emails quand
le consentement est lu ; sinon « à vérifier ». Une campagne sans audience n'est pas proposée.

**Le potentiel est une hypothèse de calcul, affichée avec son taux** : audience × taux de
retour supposé × panier moyen observé. Taux (`TAUX_HYPOTHESE`) : paniers 10 %, réactivation
5 %, win-back 2 %, deuxième commande 8 %, VIP 15 %, post-achat 10 %, à risque 8 %,
inscrits 3 %. Il sert à classer (potentiel ÷ effort), pas à prévoir. Impact : ≥ 50 % du
meilleur potentiel = élevé, ≥ 20 % = moyen.

## Confidentialité

- Aucune donnée personnelle lue : identifiant, dates, montants, consentement.
- Le modèle ne reçoit que des totaux ; la délégation à Milo aussi (testé).
- La liste des clients d'un segment affiche « Client n° … » et un lien vers la fiche
  Shopify : le nom ne se voit que dans Shopify.
- RLS forcée sur les trois tables ; aucun jeton écrit.

## Coûts

- Pour Evoliia : aucun. L'export en masse et les paniers passent par l'API Shopify de la
  personne, sans frais.
- Pour la personne : l'écran et les segments ne coûtent rien. La conversation et les
  transmissions à Milo ou à Cleo coûtent le prix d'une question (crédits), sur un clic.
- Aucun envoi d'email : rien n'est facturé par un service d'envoi.

## Prérequis Shopify

Portées `read_customers` (clients) et `read_orders` (paniers), et l'accès aux « Protected
customer data » demandé dans le Dev Dashboard. Sans cet accès, Lina le dit et explique quoi
faire.

## V2 (prévu, non livré)

Détail des commandes par client (produit principal, réachat par produit, cross-sell,
upsell), cohortes, LTV estimée, bilan hebdomadaire et alertes, objectifs, performance et
comparaison des campagnes, A/B tests, audiences publicitaires pour Naya et MIRA (avec
autorisation), WooCommerce, Stripe, HubSpot et outils d'emailing (Klaviyo, Mailchimp,
Brevo), SMS / WhatsApp, niveau d'autonomie « automatique ». Tout connecteur qui pourrait
coûter à Evoliia sera soumis avant d'être construit.
