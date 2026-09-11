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
de l'API Claude (`output_config.format` avec `zodOutputFormat`). Une réponse qui ne
respecte pas le schéma est rejetée avant d'atteindre la base de données.

## 5.2 Pourquoi un patch et pas une régénération

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

## 5.3 Routage des modèles (exigence 37)

| Opération | Modèle | Effort | Justification |
|---|---|---|---|
| `generate` | `claude-opus-5` | `high` | Tâche structurante, une seule fois par projet |
| `edit`, `blueprint`, `ideas` | `claude-sonnet-5` | `medium` | Volume élevé, tâche cadrée par le schéma |

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

## 5.4 Maîtrise des coûts

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

## 5.5 Défense contre l'injection de prompt

Le texte de l'utilisateur est une **donnée**, pas une instruction :

- Le message est encadré dans un bloc explicitement étiqueté comme contenu non fiable.
- Le prompt système rappelle que seules les instructions du système font autorité.
- Surtout, la surface d'attaque est nulle par construction : la seule chose que l'IA peut
  produire est une AppSpec ou un patch validés. Il n'existe aucun outil donnant accès au
  système de fichiers, au réseau, à la base de données ou aux données d'un autre client.

C'est la différence essentielle avec une plateforme qui exécuterait du code généré : ici,
réussir une injection de prompt ne donne accès à rien.

## 5.6 Refus et pannes

`stop_reason: "refusal"` est traité explicitement et présenté à l'utilisateur en langage
simple (« Je ne peux pas créer cette application »), sans jargon ni trace technique. Les
erreurs réseau et de limite de débit sont retentées avec temporisation exponentielle par
le SDK ; au-delà, l'opération échoue proprement, aucun crédit n'est débité, et le projet
reste dans son état antérieur.
