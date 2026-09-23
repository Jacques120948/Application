# Nova — Analytics & Performance

Nova répond à une question : **qu'est-ce qui fonctionne réellement, qu'est-ce qui
rapporte, et où perd-on de l'argent ?** Elle mesure le travail des autres agents ; elle
ne modifie rien, nulle part.

Écran : `/[locale]/nova`. Conversation : l'écran d'équipe, `?agent=nova`. Fonction
d'offre : `nova_agent`.

## Architecture

```
Sources ─► Collecte ─► Normalisation ─► Moteur de métriques ─► Analyse ─► Nova ─► Oria
```

| Couche | Fichier | Ce qu'elle fait |
|---|---|---|
| Sources | `server/nova/service.ts` | Relit ce qui existe déjà : `AdsReleve` (Naya, MIRA), `ReleveRecherche` (Search Console), `CommerceJour` (Shopify). Aucun appel à une plateforme à l'ouverture. |
| Collecte | `server/nova/collecte.ts` | Seule source nouvelle : les commandes Shopify, lues par le connecteur existant (`lireCommandes`), réduites à des totaux par jour. |
| Normalisation | `server/nova/canaux.ts`, `agregat.ts` | Dernière visite → canal (Google Ads, Meta Ads, SEO, IA, social, e-mail, direct, référent, autres, non attribué). `facebook`, `fb`, `ig`, `meta` → Meta, sans perdre l'étiquette d'origine. Assistants IA reconnus : ChatGPT, Perplexity, Gemini, Copilot, Claude, Le Chat, DeepSeek. |
| Métriques | `server/nova/metriques.ts` | Fonctions pures : périodes, CA, dépenses, ROAS, MER, CPA, CAC, panier, canaux, campagnes, produits, attribution. |
| Analyse | `server/nova/analyse.ts` | Règles chiffrées avec seuils et volumes minimaux : 5 constats, 4 alertes, 3 opportunités au plus, et le rapport pour Oria. |
| Nova | `server/nova/contexte.ts`, `ai/prompts.ts` (`NOVA_SYSTEM`) | Les faits calculés, mis en phrases pour la conversation. Le modèle explique, il ne calcule rien. |
| Oria | `oria/signaux.ts` (`depuisNova`), `agents/visibility-context.ts` | Les alertes et opportunités de Nova deviennent des signaux d'Oria ; sa conversation reçoit « NOVA → ORIA ». Oria ne recalcule rien. |

## Règles de calcul

- **Le chiffre d'affaires vient de la boutique**, jamais des régies. Sans boutique reliée,
  CA, commandes, coût par commande, CAC et panier restent absents, avec la raison.
- **Les conversions des régies ne s'additionnent jamais.** Elles s'affichent par régie ;
  la section Attribution les compare au réel et explique le chevauchement.
- **ROAS** = revenu déclaré par les régies ÷ dépenses. **MER** = CA total ÷ dépenses.
  En pour cent entiers, comme chez Naya et MIRA.
- **CAC** = dépenses ÷ nouveaux clients, seulement si Shopify dit quelles commandes sont
  des premières commandes (`customerOrderIndex`, à défaut un client à une seule commande).
- **Taux de conversion** = commandes Shopify ÷ visites GA4, seulement quand les deux sources couvrent la période. Absent sans Google Analytics 4.
- **Devises** : celle de la boutique fait référence ; un compte tenu dans une autre est
  écarté des totaux et signalé.
- **Périodes** : 7, 30 et 90 jours s'arrêtent hier ; « aujourd'hui » se dit partiel ;
  période personnalisée bornée à 366 jours. Comparaison à la période de même durée juste
  avant. Une période qui commence avant les ventes connues ne se somme pas.
- **Modèle d'attribution affiché** : régies selon leur propre modèle ; canaux boutique au
  dernier clic.

## Collecte et cache

- Ouverture de l'écran : relecture Shopify seulement si la dernière a plus de 12 h, en
  arrière-plan (`POST /api/nova/synchro`, mode `auto`). Après un échec, 30 min de pause.
- Bouton « Actualiser » : relit toute la fenêtre de 180 jours (mode `manuel`), 2 min entre deux clics. 180 = la période de 90 jours finissant hier + les 90 jours qu’on lui compare.
- Relecture partielle : depuis la dernière réussite moins 3 jours (remboursements).
- Sans l'autorisation `read_all_orders`, Shopify ne rend que 60 jours : `couvertureDepuis`
  le dit, et une période plus ancienne n'est pas sommée.
- En panne, les jours déjà lus restent ; la santé des données dit de quand ils datent.
- Plafond : 1 500 commandes par lecture ; au-delà, « tronqué » est signalé.

## Données conservées et sécurité

- `CommerceJour` : totaux par jour, canaux, produits. **Aucune donnée personnelle de
  client** (ni nom, ni courriel, ni adresse, ni identifiant de commande).
- `CommerceSynchro` : état de la dernière lecture.
- Les deux tables sont sous Row Level Security forcée, par `userId`
  (`scripts/verify-isolation.ts` les vérifie).
- Le secret Shopify reste chiffré dans `IntegrationCredential` ; le jeton est frappé pour
  la lecture et jamais conservé ni journalisé.
- Nouvelle autorisation Shopify à déclarer : `read_orders` (lecture seule).

## Coûts

- Écran, calculs, comparaisons, alertes : **aucun crédit, aucun appel IA**.
- Conversation : le chat d'équipe existant (`visibilityAsk`, 2 crédits, modèle
  intermédiaire). Jamais le modèle le plus cher.
- Shopify Admin API : gratuite. Aucun coût pour Evoliia.

## V2 — ce qui est livré

Quatre onglets : **Tableau de bord**, **Bilan de la semaine**, **Objectifs et marge**,
**Clients et parcours**. Aucun ne consomme de crédit.

| Sujet | Fichier | Règle |
|---|---|---|
| Réglages | `server/nova/reglages.ts`, table `NovaReglages` (RLS) | Type d'activité, objectifs, coûts variables. Tout est facultatif ; un champ vide veut dire « non renseigné », jamais zéro. |
| Indicateurs par activité | `pilotage.ts` (`ordreIndicateurs`, `indicateursAVenir`) | Boutique : CA, ROAS, CAC d'abord. Services : dépenses et coût par conversion. SaaS : CA, CAC. Ce qui manque (MRR, churn, leads) est nommé avec la source qu'il faudrait. |
| Objectifs | `pilotage.ts` (`suivreObjectifs`) | CA et commandes du mois à date, avec projection au rythme actuel à partir du 7e jour (« pas une prévision »). ROAS minimum et CAC maximum sur 30 jours. Un objectif en retard devient un constat en tête et remonte à Oria. |
| Marge | `pilotage.ts` (`margeEstimee`) | CA − coût des produits − livraison − paiement − commissions − autres − publicité. Exige le coût des produits ; nomme les coûts non renseignés. Toujours « Estimation basée sur les coûts renseignés ». |
| Bilan | `bilan.ts` | Dernière semaine terminée (lundi → dimanche, fuseau de la boutique) contre la précédente : chiffres, top canal / campagne / produit, anomalie et opportunité principales, ce qui progresse / baisse / mérite l'attention (seuil 5 %). |
| Clients | `clients.ts`, `agregat.ts` (`instantaneClients`) | Nouveaux / revenus / non identifiés ; CA des premières commandes. Valeur moyenne d'un client sur la fenêtre lue (≥ 20 clients) — explicitement **pas une LTV**. |
| Attribution | `clients.ts` (`modelesAttribution`) | Dernier clic, premier clic, partagé 50/50 (exact : chaque commande donne une moitié à chacun). Linéaire, position et data-driven attendent GA4. |
| Parcours | `clients.ts` (`lectureParcours`) | « Semble intervenir en début de parcours / plus près de l'achat » quand le rapport premier/dernier dépasse 1,5 sur ≥ 5 commandes. Toujours marqué **Interprétation**. |

Collecte : la lecture Shopify demande aussi la première visite (`firstVisit`) et
l'identifiant client. L'identifiant ne sert qu'à compter les clients distincts pendant la
synchronisation ; seul le compte est écrit (`CommerceSynchro.clients`). Une lecture complète
des 90 jours a lieu au moins une fois par semaine pour tenir ce compte à jour.

Shopify range les commandes parmi les « données client protégées » : en plus de
`read_orders`, l'application doit en déclarer l'accès (Dev Dashboard → API access). Le refus
correspondant est reconnu et expliqué à l'écran.

## V3 — ce qui est livré

| Sujet | Fichier | Règle |
|---|---|---|
| Connecteur GA4 | `integrations/providers/google-analytics.ts`, `api/connexions/google-analytics`, `api/nova/ga4` | OAuth Google existant, portée `analytics.readonly` (lecture seule). Choix de la propriété dans Nova ; proposée d'office quand son site correspond. Aucun mot de passe demandé, le jeton reste chiffré côté serveur. |
| Collecte GA4 | `nova/collecte-ga4.ts`, `agregat-ga4.ts`, tables `AnalyticsJour` / `AnalyticsSynchro` (RLS) | Mêmes règles de cache que Shopify (12 h, 30 min après échec, 2 min entre deux clics, 180 jours). Totaux par jour, canal, appareil et page d'entrée — aucune donnée personnelle. |
| Canaux GA4 | `nova/canaux.ts` (`canalGa4`) | Le regroupement de canaux GA4 est ramené aux canaux de Nova ; les assistants IA reconnus par leur source. Sessions et conversion GA4 affichées à côté des ventes boutique, jamais additionnées. |
| Conversion et appareils | `metriques.ts`, `analyse.ts` | Taux de conversion global, par canal et par appareil. Écart mobile / ordinateur signalé à partir de volumes minimaux ; trafic sans ventes relevé. |
| Cohérence | `service.ts` (`coherenceVisites`) | Achats GA4 comparés aux commandes Shopify : écart important et part non attribuée signalés dans la santé des données. |
| Écarts inhabituels | `analyse.ts` (`detecterEcarts`) | Dernier jour de la période comparé aux 28 jours précédents (moyenne et écart-type) : alerte à partir de 2,5 écarts-types, avec un volume minimal, et seulement si les 28 jours sont couverts. Les baisses déjà signalées ailleurs ne sont pas répétées. |
| Transmission | `nova/transmission.ts`, `delegation.ts`, `api/nova/deleguer` | Trafic des assistants IA → Gia ; pages d'entrée SEO qui vendent → Néo ; alertes et opportunités transmissibles à Cleo, Naya, MIRA, Néo, Gia. Le serveur relit le point sur la période affichée ; une transmission est une question au spécialiste (prix sur le bouton), rien ne part sans clic. Le fil d'activité d'Oria l'affiche. |

GA4 est gratuit pour Evoliia : les quotas sont comptés par propriété du client, pas sur un
compte Evoliia. Prérequis Google Cloud : activer « Google Analytics Admin API » et
« Google Analytics Data API », ajouter la portée `analytics.readonly` à l'écran de
consentement OAuth.

## V4 — ce qui est livré

Trois chantiers, tous sur les connexions existantes : aucun coût nouveau, aucun crédit pour
l'écran.

| Sujet | Fichier | Règle |
|---|---|---|
| Coût réel des produits | `integrations/providers/shopify.ts` (`lireCouts`), `nova/agregat.ts`, `nova/collecte.ts` | « Coût par article » de chaque variante (`inventoryItem.unitCost`, portée `read_products`), lu **à part** des commandes : un refus ne bloque jamais les ventes. Coût actuel, pas celui du jour de la vente. Un coût à zéro compte comme non renseigné. Par jour : lignes vendues, lignes au coût connu, coût d'achat (`CommerceJour`). La première synchronisation V4 relit toute la fenêtre. |
| Marge réelle | `nova/pilotage.ts` (`margeEstimee`) | Coût Shopify d'abord, s'il couvre au moins 80 % des ventes de produits ; le reste est estimé au même taux, et c'est dit. Sinon le pourcentage saisi, sinon rien. Une période dont un jour n'a pas ses coûts ne donne pas de coût. |
| Marge par produit | `metriques.ts` (`performanceProduits`) | Seulement quand toutes les unités du produit ont un coût. Constat quand un produit pèse ≥ 10 % du CA avec < 35 % de marge brute. |
| Seuil de rentabilité publicitaire | `pilotage.ts`, `analyse.ts` (`marge.seuil`) | MER d'équilibre = CA ÷ (CA − coûts hors publicité). Alerte quand le MER réel passe dessous (rouge sous 80 % du seuil), transmise à la régie qui dépense le plus. |
| Qualité du suivi | `nova/suivi.ts`, `service.ts` | Publicités Meta sans UTM (ventes Facebook/Instagram rangées en réseaux sociaux) → MIRA. Google Ads qui convertit sans commande attribuée (gclid) → Naya. Étiquettes UTM non reconnues → Léa. Achats GA4 absents, écart GA4/boutique, trafic non attribué, conversions en double → Léa. Chaque ligne de la santé des données peut être transmise. |
| Contenus qui attirent | `nova/contenus.ts`, `agregat-ga4.ts` | Pages d'entrée de blog (`/blogs/…`, `/blog/…`), ≥ 30 visites, engagement GA4 par page comparé à celui du site. Opportunité pour Milo à ≥ 50 visites et + 10 points d'engagement. `AnalyticsSynchro.version` relit toute la fenêtre quand la forme des jours change. |
| Collègues | `nova/transmission.ts`, `agents/visibility-context.ts` | Milo reçoit les articles qui retiennent ; Cleo reçoit les taux de conversion par appareil mesurés — l'interdiction de citer un taux ne vaut plus que sans GA4. |

Prérequis : aucun. Le coût se saisit dans Shopify (fiche produit → « Coût par article ») ;
la santé des données dit combien de variantes l'ont.

## V5 — ce qui est livré

| Sujet | Fichier | Règle |
|---|---|---|
| Sources de ventes | `nova/sources.ts`, `nova/collecte.ts`, `nova/collecte-commerce.ts` | Une seule source fait le chiffre d'affaires, dans cet ordre : Shopify, WooCommerce, encaissements Stripe. Jamais additionnées (une boutique qui encaisse par Stripe serait comptée deux fois). Rythmes de lecture, état et écriture des journées partagés ; chaque chiffre dit sa source (« WooCommerce, remboursements déduits »). |
| WooCommerce | `integrations/providers/woocommerce.ts`, `nova/collecte-woo.ts` | Clé API REST en **lecture** (ck_/cs_), jamais de mot de passe WordPress. Appels par `requeteJson` (audit/net.ts) : adresse publique vérifiée après résolution, https seulement, aucune redirection suivie (l'en-tête d'autorisation ne part jamais ailleurs). Champs demandés limités (`_fields`) : ni nom, ni courriel, ni adresse. Remboursements déduits ; commandes en attente, échouées, annulées écartées. Origine : « Order Attribution » de WooCommerce 8.5+. Ni première commande, ni coût produit : CAC et marge réelle restent absents, et c'est dit. |
| Stripe (lecture) | `integrations/providers/stripe-lecture.ts`, `nova/collecte-stripe.ts` | Fournisseur `stripe-revenus`, distinct de la connexion Stripe des applications. **Clé restreinte uniquement** (rk_) ; une clé secrète (sk_) ou publiable (pk_) est refusée avant tout appel. Droits requis : Subscriptions et Charges en lecture. Encaissements : paiements réussis, remboursements déduits, fuseau de Zurich. |
| Abonnements | `nova/abonnements.ts`, table `AbonnementsSynchro` (RLS) | Calcul par du code : MRR (prix actuel des formules, remises non déduites, essais exclus, prix à paliers comptés en abonnés mais pas en MRR), ARR, série de 13 mois, nouveaux / départs, churn mensuel (moyenne des 3 derniers mois terminés, ≥ 20 abonnés), churn en revenu, ARPU, LTV = ARPU ÷ churn (refusée si churn nul ou non mesurable), cohortes par mois de départ (≥ 3 abonnés). Une autre devise est écartée et signalée. Seul l'instantané est gardé : aucun client, aucun identifiant. |
| Constats | `analyse.ts` | MRR et sa tendance sur trois mois ; churn ≥ 5 % par mois. |

Coût pour Evoliia : aucun. L'API REST de WooCommerce est servie par la boutique elle-même,
celle de Stripe est gratuite ; mêmes règles de cache (12 h, 30 min après échec).

## Encore à venir

CRM (leads, CPL, taux lead → client), cohortes et LTV des boutiques (elles exigent l'accès
aux données client protégées de Shopify), CAC par abonné (dépense ÷ nouveaux abonnés),
prévisions au-delà du mois, analyse des audiences.
