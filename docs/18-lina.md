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

## V2 — ce qui est livré

| Sujet | Fichier | Règle |
|---|---|---|
| Export des commandes | `shopify-clients.ts` (`lancerExportCommandes`, `telechargerCommandes`, lecture en flux) | Seconde phase, lancée dès que les clients sont lus : l'écran reste utilisable pendant. Trois ans avec `read_all_orders`, soixante jours sinon ; 150 000 commandes au plus. De chaque commande : date, identifiant client, total, et par article le produit, sa famille, sa quantité, son prix. Annulées et commandes de test écartées. Une panne de cette phase n'abîme pas l'index des clients. |
| Agrégation | `lina/commandes.ts` (pur) | **Les commandes ne sont jamais écrites.** Il reste par client : vraie première commande (seulement si toute son histoire est dans l'export), rythme médian, produit principal ; par produit (`LinaProduit`) : acheteurs, réacheteurs, prix moyen, intervalle entre deux achats (médiane, quartiles, dès 5 intervalles) ; pour la boutique (`LinaSynchro.analyse`) : cohortes (le calcul de Nova, 12 dernières), paires « acheté ensuite » et « acheté ensemble » (dès 5 clients), montées en gamme, délai de la deuxième commande. |
| Réachat | `lina/valeur.ts` (`reachatParProduit`) | « Les clients ayant acheté X le rachètent souvent entre p25 et p75 jours » — dès 5 réacheteurs. Campagne de réachat avec la requête `products_purchased MATCHES (id = X, date BETWEEN -p75d AND -p25d)`. |
| Cross-sell / upsell | `suggestions`, `campagnesProduits` | « n % des acheteurs de A ont ensuite acheté B » (observé, une corrélation). Montée en gamme : même famille, prix moyen ≥ +30 %, jamais répétée parmi les compléments. Offre groupée suggérée quand les deux s'achètent aussi ensemble. Audience = acheteurs de A qui n'ont pas B ; requête Shopify fournie. |
| Valeur client | `valeurClient` | **Observée** : dépense moyenne d'un acheteur. **Estimée** : panier moyen × commandes par an × durée de vie, la durée venant de l'attrition annuelle observée (clients arrivés il y a plus d'un an sans commande depuis un an), plafonnée à 5 ans ; dès 50 clients anciens ; méthode affichée. |
| Risque de départ | `risquesDepart`, `segments.ts` | Silence rapporté au rythme propre du client (lu dans les commandes) : > 3× élevé, 2–3× moyen. « Risque estimé ». |
| Fidélité | `programmeFidelite` | Paliers Découverte / Habitué / Fidèle / VIP tirés de la base, avantages non monétaires. |
| Audiences publicitaires | `audiencesPub`, `delegation.ts` | VIP et fidèles (audiences similaires), acheteurs récents (exclusion), dormants (reconquête), dès 100 clients. **Aucune liste ne sort d'Evoliia** : Shopify synchronise ses segments par ses canaux, avec l'accord de la personne ; MIRA ou Naya reçoivent la taille et l'usage (délégation payée en crédits, sur clic). |
| Scénarios | `scenarios` | SI / ALORS préparés et comptés (panier, deuxième commande, reconquête, fidèle, VIP, réachat), avec l'endroit où les activer dans Shopify. Lina ne déclenche rien. |
| Résultats et A/B | `lina/resultats.ts`, table `LinaResultat` (RLS), `/api/lina/resultats` | Saisie des résultats d'un envoi ; taux, revenu par destinataire, désinscriptions. Test A/B : même groupe, variantes A et B ; gagnant seulement avec ≥ 100 envois par variante, ≥ 20 actions et un test de deux proportions à 95 % (conversions, à défaut clics). |
| Écrans | `/lina/produits`, `/lina/valeur`, `/lina/resultats` | Onglets ajoutés ; produit principal affiché dans « Clients à réactiver ». |

Coût pour Evoliia : aucun — un export en masse de plus par analyse, sur l'API Shopify de la
personne. Aucun envoi d'email, aucune écriture dans Shopify.

## V3 — ce qui est livré

| Sujet | Fichier | Règle |
|---|---|---|
| Outils d'envoi | `integrations/providers/emailing.ts`, `lina/emailing.ts` | Klaviyo (clé privée `pk_…`, lecture des campagnes et des métriques), Brevo (clé `xkeysib-…`), Mailchimp (clé `…-usNN`). **Lecture seule, statistiques agrégées des 50 dernières campagnes envoyées** : envois, ouvertures et clics uniques, désinscriptions, commandes et CA quand l'outil les attribue (Klaviyo « Placed Order », Mailchimp e-commerce). Brevo ne mesure pas les commandes : « non mesuré », jamais zéro. Aucun destinataire, aucune liste, aucun profil. Un seul outil lu (le premier relié). Même rythme que le reste de Lina : 12 h à l'ouverture, 2 min entre deux clics. Une clé refusée met la connexion en erreur ; l'écran le dit et garde les résultats déjà relus. |
| Import | `lina/resultats.ts` (`importerCampagnes`, `classerResultat`) | `LinaResultat.source` + `refExterne` (unique par personne) : une campagne relue deux fois est mise à jour, pas dédoublée. Le nom de test et la variante, que l'outil ne connaît pas, se donnent à la main (« Classer »). Un résultat relu ne se supprime pas (il reviendrait) ; un résultat saisi, si. |
| Relevés hebdomadaires | `lina/releves.ts`, table `LinaReleve` (RLS forcée) | Un relevé par semaine (clé : le lundi), réécrit à chaque ouverture de la semaine. Des totaux seulement : acheteurs, actifs, récurrents, fidèles, taux de réachat, dormants, à risque, VIP et VIP inactifs, paniers, réactivations et CA des clients existants sur 30 jours (depuis les commandes), score. |
| Commandes récentes | `lina/commandes.ts` (`recents`) | Réactivés sur 7 et 30 jours (retour après un silence > seuil « actif »), CA des 30 derniers jours venant de clients existants ou nouveaux. Rien de plus n'est écrit. |
| Bilan de la semaine | `bilanSemaine` | Nouveaux clients (7 j contre les 7 j d'avant), récurrents, taux de réachat, CA des clients existants, paniers récupérés, réactivés, à risque, dormants, score — comparés au relevé de la semaine précédente. « Stable » sous 1 point ou 5 %. Ce qui progresse, ce qui baisse, segment prioritaire, opportunité principale (hypothèse de calcul), trois actions de la semaine. Une évolution est observée, jamais expliquée. |
| Alertes | `alertesLina` | **Trois au plus**, baisses d'abord : réachat en baisse d'au moins 1 point sur 4 semaines ; VIP inactifs ≥ 5 et en hausse ; paniers abandonnés ≥ 20 et +25 % ; clients à risque ≥ 10 et +20 %. Bonnes nouvelles : réachat en hausse, VIP qui reviennent. Oria reçoit les baisses en signaux « important ». |
| Score de fidélité | `scoreFidelite` | 0–100, dès 20 acheteurs. Réachat (repère 40 %, 25 pts), actifs (40 %, 20), fidèles (15 %, 15), part du CA récurrent (60 %, 15), non dormants (15), paniers récupérés (15 %, 10 — répartis ailleurs sous 10 paniers). **Indicateur interne**, repères fixes, pas une norme du marché ni une comparaison avec d'autres boutiques. |
| Objectifs CRM | `lina/objectifs.ts`, `LinaReglages.objectifs`, `/api/lina/objectifs` | Taux de réachat, CA des clients existants sur 30 jours, réactivations sur 30 jours, score. Aucun par défaut : Lina n'en propose pas. Avancement affiché, « non mesuré » quand la mesure manque. |
| Services et SaaS | `lina/services.ts` | Depuis Nova, déjà calculé : prospects des mois terminés qui n'ont pas signé (HubSpot, dès 20 prospects), demande d'avis aux clients signés (services), churn des abonnés (Stripe, dès 20 abonnés ; « prévenir les départs » dès 3 % par mois). Totaux seulement. Affiché même sans boutique Shopify. |
| Écrans | `/lina/bilan` (nouvel onglet « Bilan et objectifs »), `/lina/resultats`, `/lina` | Alertes en tête du tableau de bord ; bilan, score semaine après semaine, objectifs ; carte « Outil d'envoi » sur les résultats. |
| Conversation | `lina/contexte.ts`, `LINA_SYSTEM` | Bilan, alertes, score, objectifs et pistes services dans les faits ; règles ajoutées : évolution observée ≠ cause, score interne, « non mesuré », objectifs sans promesse. |

Coût pour Evoliia : aucun. Les outils d'envoi sont lus avec la clé de la personne, sur son
compte ; les relevés, le bilan, les alertes et le score sont du code. Seule la conversation
coûte des crédits, sur un clic.

## Encore à venir

WooCommerce et Stripe comme sources de clients, SMS et WhatsApp (le consentement SMS n'est
pas exposé par Shopify dans cette version de l'API), niveau d'autonomie « automatique »,
envoi du bilan par courriel.
