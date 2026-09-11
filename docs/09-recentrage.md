# 9. Recentrage : du générateur d'applications au copilote d'entrepreneur

## 9.1 Ce qui existe et qu'il faut garder

Le socle est sain et sert directement la nouvelle vision. Rien n'est jeté.

| Acquis | Pourquoi il sert la vision |
|---|---|
| AppSpec déclarative + compilateurs | L'utilisateur ne voit jamais de code, ce qui est exactement la promesse |
| Isolation multi-tenant (4 barrières, RLS vérifié) | Non négociable dès qu'on encaisse de l'argent |
| Crédits + coût IA réel mesuré par appel | Condition de rentabilité, exigences 17 et 18 |
| Offres en base et non en dur | Condition des promotions et de l'offre fondateur |
| Génération en deux temps, assemblage réparateur | Fiabilité de la création du MVP |
| Versions immuables, aperçu réel, publication web | Étapes « Créer » et « Publier » du parcours |
| Vocabulaire non technique dans l'interface | Exigence 28, déjà tenue |

## 9.2 Les dérives constatées

Six écarts entre l'existant et la vision. Le premier est le plus grave : c'est celui qui
fait ressembler le produit à un générateur d'applications de plus.

### D1 — L'entonnoir commence au mauvais endroit

Aujourd'hui, le parcours démarre par « Décrivez votre idée », avec « Je n'ai pas encore
d'idée » relégué au rang de bouton secondaire. C'est exactement la porte d'entrée de
Lovable, Bolt ou Base44.

La vision dit l'inverse : le point de départ normal est **« je ne sais pas quoi
construire, je voudrais un revenu complémentaire »**. L'utilisateur qui arrive avec une
idée est le cas particulier, pas le cas général.

### D2 — L'objectif financier n'existe pas

Rien dans le produit ne demande combien l'utilisateur aimerait gagner. Or cet objectif est
le fil conducteur de toute la vision : il oriente le choix d'idée, le modèle économique,
le prix, et il donne son sens au tableau de bord (« 53 clients pour atteindre 1 000 € »).

### D3 — Le profil entrepreneurial n'est pas conservé

Les questions sur les compétences, le temps et le budget sont posées dans un formulaire
jetable au sein de l'assistant d'idées, puis perdues. L'assistant central ne peut donc pas
s'en souvenir, alors que la vision exige qu'il connaisse le projet et son porteur.

### D4 — Les idées ne sont ni chiffrées ni conservées

L'assistant propose des idées en texte libre : difficulté et potentiel sont des phrases,
pas des grandeurs. Manquent le score d'opportunité, le prix conseillé, le coût de
fonctionnement, le délai de mise sur le marché et surtout **le nombre de clients
nécessaires pour atteindre l'objectif**. Les idées ne sont pas enregistrées, donc pas
comparables, pas sélectionnables, pas reprenables plus tard.

### D5 — L'étape de validation n'existe pas

On passe directement de l'idée à la construction. La vision demande une étape
intermédiaire qui évite de construire à l'aveugle : demande, concurrence, complexité,
coûts, risques, avantages différenciants, score d'opportunité.

### D6 — Le tableau de bord ne dit pas où on en est

Il liste des applications avec un statut technique. Il ne répond pas aux trois questions
de la vision : où j'en suis, ce que je dois faire ensuite, et pourquoi.

## 9.3 Incohérence chiffrée à corriger

Le modèle tarifaire de référence et le système de crédits actuel sont incompatibles.

Aujourd'hui, un crédit vaut un millième de dollar de coût API. Construire une application
coûte donc environ 110 crédits. Or l'offre Launch prévoit **100 crédits par mois** : son
abonné ne pourrait pas créer une seule application.

La correction est un changement d'unité, pas de mécanique : **un crédit vaut cinq
millièmes de dollar**. Les ordres de grandeur deviennent cohérents.

| Opération | Coût API mesuré | Crédits |
|---|---|---|
| Trouver des idées | 0,06 USD | 12 |
| Analyser une idée | 0,035 USD | 7 |
| Construire l'application | 0,105 USD | 21 |
| Une modification | 0,01 USD | 2 |

| Offre | Prix | Crédits | Coût API maximal | Marge brute minimale |
|---|---|---|---|---|
| Gratuit | 0 € | 30 | 0,15 USD | — (acquisition) |
| Launch | 29 € | 100 | 0,50 USD | > 98 % |
| Builder | 59 € | 350 | 1,75 USD | > 97 % |
| Business | 99 € | 800 | 4,00 USD | > 96 % |

Ces valeurs restent en base et modifiables depuis l'administration.

La dotation gratuite a été relevée de 15 à 30 crédits après une première utilisation
réelle : à 15, l'utilisateur pouvait recevoir des idées mais plus les faire analyser. Une
offre d'essai qui s'arrête avant d'avoir montré sa valeur ne convertit pas.

## 9.4 Ce qui est fait maintenant, et ce qui attend

Priorité donnée aux six dérives, dans l'ordre où elles bloquent le parcours.

| Chantier | État |
|---|---|
| Objectif financier et profil entrepreneurial conservés | livré |
| Idées chiffrées, comparables, enregistrées, sélectionnables | livré |
| Nombre de clients nécessaires calculé depuis l'objectif | livré |
| Validation d'idée avec score d'opportunité | livré |
| Parcours visible : étape actuelle, avancement, prochaine action | livré |
| Entonnoir inversé : on part de l'objectif, pas de l'idée | livré |
| Offres et unité de crédit recalibrées | livré |
| Stripe réel, promotions, offre fondateur | à venir |
| Coach business après lancement, marketing, analytics | à venir |
| Administration | à venir |

Rien de ce qui fonctionnait n'a été supprimé : la création d'application, l'aperçu, les
versions, les tests et la publication sont inchangés. Ils deviennent les dernières étapes
d'un parcours qui commence beaucoup plus tôt.
