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
- **Taux de conversion** : absent tant que Google Analytics 4 n'est pas relié.
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
- Bouton « Actualiser » : relit les 90 jours (mode `manuel`), 2 min entre deux clics.
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

## Prévu pour la V2

Google Analytics 4 (visites, taux de conversion, parcours), WooCommerce, Stripe, CRM ;
objectifs chiffrés et bilan hebdomadaire ; marge avec coûts renseignés ; LTV et cohortes ;
attribution multi-touch (premier clic, linéaire, position) ; nouveaux contre anciens
clients par canal ; routage des questions par complexité.
