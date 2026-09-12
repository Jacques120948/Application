# Moteur social : intégration de Postelya

## Ce qui a été décidé

Postelya reste un produit indépendant, commercialisable seul, déployé seul, avec ses propres
utilisateurs et ses propres abonnements. Il devient **aussi** un moteur : une capacité que
d'autres services peuvent appeler. Evoliia est le premier à le faire.

Rien n'a été fusionné. Rien n'a été recopié. Les prompts, les règles d'écriture, la
taxonomie des angles et la mécanique de génération n'existent qu'à un seul endroit, chez
Postelya.

## Architecture retenue : appel HTTP signé

Trois possibilités avaient été envisagées.

| | Ce qu'elle demande | Pourquoi retenue ou non |
|---|---|---|
| **A — API Postelya** | Un point d'entrée signé chez Postelya, un client chez Evoliia | **Retenue.** Une seule copie du moteur, déployée une fois. Rien à publier, rien à versionner entre deux dépôts. |
| B — Paquet partagé | Un troisième dépôt, un registre, une version épinglée des deux côtés | Écartée : chaque correction de prompt imposerait une publication puis deux mises à jour. Les deux dépôts n'ont ni registre commun ni gestionnaire commun (pnpm d'un côté, npm de l'autre). |
| C — Service commun | Fusionner les deux socles | Écartée d'emblée : elle tuerait l'indépendance de Postelya. |

L'audit a montré ce qui rendait A praticable : **les fonctions de génération de Postelya sont
déjà indépendantes de sa base**. `generateIdeas`, `generateWeekPlan` reçoivent un texte
décrivant la marque et renvoient une structure. L'attache à Supabase vit un cran au-dessus,
dans les actions serveur. Le moteur exposé n'a donc eu ni base à traverser ni couche à
inventer.

### Ce que ça donne

```
Evoliia                                   Postelya
────────                                  ────────
Projet + Idée
   │
   │ toBrandContext()           (src/server/marketing/context.ts, pure, testée)
   ▼
BrandContext ──── HTTP signé ────▶  /api/engine/launch-kit
                  HMAC-SHA256           │ vérifie la signature
                                        │ rend le contexte en texte
                                        │ réutilise WRITING_RULES, ANGLES, OBJECTIVES
                                        ▼
                                   un appel au modèle
   ◀──────── kit + jetons consommés ─────┘
   │
   │ validation du contrat, coût, crédits, enregistrement
   ▼
MarketingKit (base Evoliia, RLS)
```

## Les trois propriétés qui tiennent l'ensemble

**Sans état.** Le moteur ne lit ni n'écrit aucune donnée de l'appelant. Aucune donnée d'un
client d'Evoliia ne séjourne chez Postelya. La question du cloisonnement entre les deux
produits ne se pose donc pas : il n'y a rien à cloisonner. Côté Evoliia, le kit est une
table de plus soumise au même Row Level Security que le reste.

**Vocabulaire commun.** Les angles et les objectifs sont ceux de Postelya, par clé. Un angle
propre au produit (« Gain de temps ») porte la clé de sa famille (`PROBLEM_SOLUTION`). C'est
ce qui permettra plus tard de comparer les performances d'un angle avec les mesures que
Postelya sait déjà faire, sans avoir inventé un second vocabulaire.

**Consommation rendue.** Le moteur renvoie les jetons réellement consommés. Evoliia les
inscrit dans son propre journal `AiUsage` et débite ses propres crédits. Le moteur ne facture
rien et n'a pas à connaître les offres de qui l'appelle.

## Authentification entre services

Signature HMAC-SHA256 sur `v1.<horodatage>.<corps exact>`, en-têtes `x-engine-signature` et
`x-engine-timestamp`, fenêtre de cinq minutes, comparaison à temps constant.

Signer le corps exact empêche qu'une demande interceptée soit rejouée avec un autre projet
ou un autre plan. Signer l'horodatage empêche qu'elle soit rejouée tout court. Le secret ne
circule jamais.

Chaque demande porte qui appelle : service, référence d'utilisateur, référence de projet,
offre, action. Ces références sont **opaques** : le moteur ne reçoit ni adresse e-mail, ni
nom, ni rien qui identifie une personne.

## Droits par abonnement

`src/server/billing/features.ts` est la seule couche qui décide de ce qu'une offre ouvre.
Ailleurs dans le code, on ne demande jamais « quel est le plan de cette personne » mais
« cette fonction lui est-elle ouverte ». La répartition vit dans `Plan.features`, modifiable
depuis le back-office : déplacer une fonction d'une offre à l'autre est une décision
commerciale, pas une modification de code.

Une distinction est maintenue entre deux états :

- `live` — la fonction existe. Elle peut être ouverte, ou verrouillée avec la promesse
  tenable « disponible avec telle offre » ;
- `prevu` — la fonction n'existe pas encore. Elle figure au catalogue pour la feuille de
  route et le back-office, mais **aucune grille tarifaire, aucun message d'incitation ne la
  présente comme achetable**, et cocher sa case n'ouvre rien.

C'est ce qui permet de préparer la répartition commerciale de Builder et Business dès
maintenant sans vendre ce qui n'est pas construit.

## Coût mesuré

Prompt système réel, mesuré sur un projet complet : 4 222 caractères, soit environ
1 170 jetons. Sortie attendue pour trois angles, sept idées et sept publications : environ
2 500 jetons.

| | Jetons | Prix unitaire | Coût |
|---|---|---|---|
| Entrée | 1 170 | 2 $/M | 0,0023 $ |
| Sortie | 2 500 | 10 $/M | 0,0250 $ |
| **Total par kit** | | | **≈ 0,027 $** |

Soit 6 crédits au barème d'Evoliia (1 crédit = 5 000 micro-dollars). Le modèle retenu est
`claude-sonnet-5` et non le haut de gamme : rédiger du texte marketing ne demande pas le
modèle de raisonnement, et la sortie y coûte deux fois et demie moins cher.

**Plafond de dépense par client**, qui est la vraie garantie : le coût est borné par les
crédits de l'offre, pas par l'usage.

| Offre | Crédits/mois | Dépense IA maximale | Recette |
|---|---|---|---|
| Launch | 100 | 0,50 $ | 29 € |
| Builder | 350 | 1,75 $ | 59 € |
| Business | 800 | 4,00 $ | 99 € |

Aucune offre ne propose d'IA illimitée. Un client qui consomme énormément atteint son
plafond de crédits ; il ne creuse pas une facture chez Evoliia.

## Repli

Si le moteur est injoignable ou en erreur, Evoliia continue de fonctionner : l'écran dit que
le module marketing est momentanément indisponible et que le projet reste accessible. Un
seul réessai, et uniquement sur une panne de transport — un appel qui a peut-être abouti
n'est jamais relancé, il aurait été payé deux fois. **Aucun crédit n'est débité quand le
moteur n'a pas répondu.**

## Ce qui est construit aujourd'hui

Le kit de lancement, et rien d'autre : bénéfices, proposition de valeur, trois angles
marketing propres au produit, sept idées de publications, calendrier de la première semaine,
appels à l'action. Le créateur relit, corrige chaque texte, écarte les angles qui ne lui
ressemblent pas, approuve.

Rien n'est publié ni programmé : aucun réseau social n'est relié, et l'approbation ne
déclenche aucun envoi. Elle prépare le point de passage obligatoire du jour où une
publication partira réellement.

## Ce qui n'est pas construit

Tom et l'équipe marketing, le calendrier mensuel, la génération récurrente, les connexions
Instagram, Facebook et LinkedIn, la programmation, la publication, l'analyse des
performances et la comparaison d'angles. Ces fonctions figurent au catalogue avec le statut
`prevu` : elles orientent la feuille de route, elles ne sont vendues nulle part.

## Configuration

| Variable | Où | Rôle |
|---|---|---|
| `SOCIAL_ENGINE_URL` | Evoliia | Adresse du moteur. Absente, la fonction se présente comme non activée. |
| `SOCIAL_ENGINE_SECRET` | Evoliia **et** Postelya | Secret partagé, 32 caractères minimum, identique des deux côtés. |
| `SOCIAL_ENGINE_MODEL` | Postelya | Modèle du moteur. Par défaut `claude-sonnet-5`. |
| `AI_API_KEY` | Postelya | Clé Anthropic qui exécute l'appel. |

**Point à trancher.** L'appel part aujourd'hui sur le compte Anthropic de Postelya, alors
que la consommation est inscrite et facturée en crédits chez Evoliia. Les deux services
appartiennent à la même personne, donc l'argent ne se perd pas — mais il sort d'un compte et
rentre dans l'autre. Si Postelya devait un jour être vendu ou opéré séparément, il faudrait
soit qu'Evoliia expose sa propre clé au moteur, soit que Postelya facture ses appels.
