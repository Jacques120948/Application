# 5. Moteur IA : comment l'application est générée puis modifiée

## 5.1 Principe

L'IA ne rédige jamais de code. Elle produit des **objets validés** :

| Opération | Entrée | Sortie | Coût typique |
|---|---|---|---|
| `ideas` | profil (compétences, temps, budget, pays) | liste d'idées d'applications | faible |
| `blueprint` | idée en français courant | concept + fonctions + monétisation | faible |
| `generate` | blueprint validé | **AppSpec complète** | élevé |
| `edit` | AppSpec + demande en langage naturel | **SpecPatch** (liste d'opérations) | faible |
| `diagnose` *(phase 4)* | AppSpec + journal d'erreurs | cause probable + SpecPatch correctif | moyen |
| `marketing` *(phase 4)* | AppSpec publiée | textes de lancement, fiches de stores | moyen |

Les deux dernières lignes ne sont **pas** implémentées aujourd'hui et ne figurent pas
dans le code : une opération n'est déclarée que lorsqu'elle existe.

Chaque sortie est contrainte par un schéma Zod et obtenue via les **sorties structurées**
de l'API Claude. Une réponse qui ne respecte pas le schéma est rejetée avant d'atteindre
la base de données.

Deux contraintes de l'API, découvertes en appelant réellement et non en lisant la
documentation, ont façonné cette partie :

1. **La grammaire compilée a une taille maximale.** L'union des dix types de section passe
   sans problème dans `{ blocks: [...] }`, mais la même union imbriquée un niveau plus bas,
   dans `{ pages: [ { blocks: [...] } ] }`, est refusée. Ce n'est pas une question de
   volume : un schéma plus gros mais moins profond passe. D'où la génération en deux temps
   décrite au paragraphe 5.2.
2. **Un champ sans type déclaré est refusé.** Un patch doit pouvoir porter n'importe quelle
   valeur, ce qui se traduirait naturellement par un type libre. L'API répond « JSON schema
   must have a type defined ». La valeur voyage donc encodée en JSON dans une chaîne, et
   elle est de toute façon revalidée après application : la sécurité ne repose pas dessus.

Troisième constat, sur le SDK cette fois : le champ `parsed_output` vaut `null` dès que la
réponse contient un bloc de réflexion avant le texte, ce qui est le comportement par défaut
des modèles actuels. La plateforme lit donc les blocs de texte et valide elle-même avec Zod,
qui fait de toute façon autorité.

## 5.2 Génération en deux temps

| Appel | Modèle | Contenu |
|---|---|---|
| 1 fois | `claude-opus-5`, effort élevé | Le plan : identité, thème, modèles de données, en-têtes de pages avec les sections attendues, menu, monétisation |
| 1 fois par page, en parallèle | `claude-sonnet-5`, effort moyen | Les sections d'une page, rédigées |

Décider la structure demande du raisonnement ; rédiger le contenu d'une page est une tâche
cadrée par le schéma. Mesuré sur une génération réelle de six pages, ce découpage fait
passer le coût de 0,26 à 0,11 dollar sans perte visible de qualité, et divise la latence
des pages par deux puisqu'elles sont produites en parallèle.

Les appels étant indépendants, leur cohérence n'est pas garantie : une liste peut viser un
modèle absent, un bouton pointer vers une page inexistante. `src/server/spec/assemble.ts`
répare ces incohérences de façon déterministe, puis soumet le résultat à la validation
stricte. Une page dont la génération échoue ne fait pas perdre l'application entière.

## 5.3 Pourquoi un patch et pas une régénération

Régénérer l'AppSpec entière à chaque « mets le bouton en bleu » serait coûteux et
destructeur (l'IA perdrait des détails ajoutés par l'utilisateur). L'opération `edit`
retourne donc une liste d'opérations ciblées :

```json
{
  "summary": "Bouton principal en bleu",
  "operations": [
    { "op": "set", "path": "theme.colors.primary", "value": "#2563EB" }
  ]
}
```

Le moteur de patch (`src/server/spec/patch.ts`) applique ces opérations sur une copie,
puis **revalide l'AppSpec complète**. Si le résultat est invalide, le patch est rejeté en
bloc : l'application de l'utilisateur ne peut pas se retrouver dans un état cassé.

Les chemins sont restreints : pas d'indice négatif, pas de `__proto__`, pas de
`constructor`, profondeur bornée. Cela ferme la pollution de prototype par patch.

## 5.4 Routage des modèles (exigence 37)

| Opération | Modèle | Effort | Justification |
|---|---|---|---|
| `generate` — plan | `claude-opus-5` | `high` | Tâche structurante, une seule fois par projet |
| `generate` — pages | `claude-sonnet-5` | `medium` | Rédaction cadrée par le schéma, un appel par page |
| `edit`, `blueprint`, `ideas` | `claude-sonnet-5` | `medium` | Volume élevé, tâche cadrée par le schéma |

Coûts observés sur des générations réelles :

| Opération | Coût |
|---|---|
| Analyse d'une idée | 0,011 USD |
| Construction complète, six pages | 0,105 USD |
| Une modification conversationnelle | 0,008 à 0,012 USD |

Le routage est une table de configuration, pas des `if` dispersés
(`src/server/ai/routing.ts`). Il est modifiable sans toucher aux appels.

Tarifs utilisés pour la comptabilité (USD par million de jetons) :

| Modèle | Entrée | Sortie |
|---|---|---|
| `claude-opus-5` | 5,00 | 25,00 |
| `claude-sonnet-5` | 2,00 | 10,00 |

Le coût réel de chaque appel est calculé à partir de `response.usage` et enregistré dans
`AiUsage` en micro-dollars. C'est cette donnée, et non une estimation, qui alimente
l'écran « Coût IA aujourd'hui / ce mois » de l'administration.

## 5.5 Maîtrise des coûts

1. **Mise en cache de préfixe** : le prompt système et le catalogue de blocs sont
   identiques d'un appel à l'autre et marqués `cache_control`. Seule la partie variable
   (AppSpec courante, message utilisateur) est placée après le point de cache.
2. **Contexte borné** : on n'envoie jamais tout l'historique de conversation, seulement
   les derniers échanges et l'AppSpec courante.
3. **Crédits vérifiés avant l'appel** : pas de crédits, pas d'appel réseau.
4. **Quotas** : limite d'appels par minute et par utilisateur, indépendante des crédits,
   pour absorber une boucle accidentelle.
5. **Débit après coup** : les crédits sont débités sur la base des jetons réellement
   consommés, avec un plancher par opération. Un échec IA n'est pas facturé.
6. **Une seule reprise** : si la validation refuse un patch, l'assistant est relancé une
   fois avec le motif exact du refus, jamais davantage.

## 5.6 Défense contre l'injection de prompt

Le texte de l'utilisateur est une **donnée**, pas une instruction :

- Le message est encadré dans un bloc explicitement étiqueté comme contenu non fiable.
- Le prompt système rappelle que seules les instructions du système font autorité.
- Surtout, la surface d'attaque est nulle par construction : la seule chose que l'IA peut
  produire est une AppSpec ou un patch validés. Il n'existe aucun outil donnant accès au
  système de fichiers, au réseau, à la base de données ou aux données d'un autre client.

C'est la différence essentielle avec une plateforme qui exécuterait du code généré : ici,
réussir une injection de prompt ne donne accès à rien.

## 5.7 Refus et pannes

`stop_reason: "refusal"` est traité explicitement et présenté à l'utilisateur en langage
simple (« Je ne peux pas créer cette application »), sans jargon ni trace technique. Les
erreurs réseau et de limite de débit sont retentées avec temporisation exponentielle par
le SDK ; au-delà, l'opération échoue proprement, aucun crédit n'est débité, et le projet
reste dans son état antérieur.
