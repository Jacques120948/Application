# Evoliia comme atelier de création piloté par l'IA

Document d'architecture, et journal de son exécution.

Les trois arbitrages de la section 4 ont été tranchés le 16 septembre 2026 : **chemin A**
(élargir le modèle déclaratif), **bornes prudentes** pour l'agent, **marge à 1** au départ.
La phase 1 est livrée ; les suivantes s'y appuient.

Il répond à une demande en vingt-six points. Une bonne partie de ce qui y est demandé
existe déjà dans Evoliia, parfois exactement sous la forme décrite. Le dire franchement
évite de reconstruire ce qui fonctionne — et permet de concentrer l'effort là où le produit
bute réellement.

---

## 1. Ce qui existe aujourd'hui

### La pile

Next.js 15 (App Router), React 19, TypeScript strict, Tailwind 4, Prisma 6 sur PostgreSQL
16, Vitest. Déploiement Vercel depuis la branche unique. Près de cinq cents tests, dont une
part notable sur une vraie base soumise au Row Level Security.

### Comment une application est fabriquée aujourd'hui

C'est le point décisif, et celui qu'il faut comprendre avant tout le reste.

**Evoliia ne génère pas de code.** Elle génère une *spécification déclarative* — l'AppSpec
— que le moteur d'exécution interprète. Le fichier `src/server/spec/schema.ts` en donne le
contrat exact :

- 21 types de blocs (`hero`, `richText`, `features`, `pricing`, `recordForm`, `recordList`,
  `auth`, `assistant`…) ;
- jusqu'à 12 pages, chacune avec jusqu'à 20 blocs ;
- jusqu'à 8 modèles de données, aux champs typés (`text`, `number`, `date`, `select`,
  `boolean`, `email`, `url`, `reference`…) ;
- un thème, une navigation, une monétisation, une authentification de visiteurs.

Le schéma est `.strict()` : tout champ inconnu est refusé. Il interdit explicitement le
HTML, le script et les URL arbitraires. Une AppSpec publiée est **figée** dans une
`ProjectVersion` et servie telle quelle — le brouillon n'est jamais public.

Conséquence directe : il n'y a **aucun fichier de code par application**. Les 21 blocs, le
moteur de données, l'authentification des visiteurs, les paiements Stripe Connect, le PWA,
l'assistant intégré : tout cela est du code d'Evoliia, écrit une fois, partagé par toutes
les applications. C'est ce qui permet à mille applications de tourner sans mille
déploiements, et ce qui rend l'isolation vérifiable.

### Ce qui existe déjà, point par point, dans votre demande

| Votre point | État réel |
|---|---|
| 2 — API Anthropic côté serveur | **Fait.** `src/server/ai/client.ts`, clé dans `env`, jamais envoyée au navigateur. Le créateur n'a pas besoin de compte Anthropic. |
| 4 — Espace de conversation par projet | **Partiel.** Table `ChatMessage`, onglet « Modifier avec l'IA », historique conservé. Manque : le mode plan et la stratégie de contexte. |
| 6 — Vérification puis preview | **Partiel.** `runChecks()` (contraste, textes-bouchons, images manquantes), aperçu en direct, une reprise automatique si la validation refuse le patch. Manque : une boucle de correction digne de ce nom. |
| 7 — Historique et retour arrière | **Fait.** `ProjectVersion` immuable, numérotée, avec libellé ; `listVersions`, `restoreVersion`, onglet Versions. Une génération IA ne détruit jamais un projet. |
| 8 — Solde de crédits côté serveur | **Fait.** `CreditWallet` + `CreditLedger`. Le frontend ne calcule ni ne modifie rien. |
| 9 — Consommation réelle | **Fait.** Table `AiUsage` : utilisateur, projet, modèle, jetons entrée/sortie/cache, coût en micro-dollars, latence, succès, code d'erreur. `creditsSpent` était écrit par les opérations marketing mais pas par le chemin central ; la phase 1 l'y a ajouté, réparti au prorata entre les appels d'une même opération. Les tarifs sont désormais en base. |
| 11 — Réservation de crédits | **Fait en phase 1.** Table `CreditReservation`, pose transactionnelle avec verrou sur le portefeuille, libération immédiate à l'échec, échéance qui empêche tout gel définitif. |
| 12 — Protections | **Fait en grande partie.** `max_tokens` par opération, timeout 120 s, `RULES.aiOperation` (30/min), vérification du solde avant tout appel réseau, quotas mensuels par offre (Radar, Lia). Manque : limite journalière configurable. |
| 13 — Routage des modèles | **Fait.** `src/server/ai/routing.ts` : `MODELS.reasoning / fast / economical` — vos `AI_MODEL_POWERFUL / STANDARD / FAST` —, un profil par opération. Les noms ne sont écrits qu'à cet endroit. Leur passage en base est prévu avec l'agent, qui sera le premier à en avoir besoin. |
| 14 — Afficher le coût | **Partiel.** Le solde est affiché partout ; « X crédits utilisés » remonte après opération. Manque : l'estimation avant, et la répartition. |
| 17 — Ledger | **Fait en phase 1.** `CreditLedger` gagne un type (`AI_USAGE`, `SUBSCRIPTION_CREDIT`, `CREDIT_PURCHASE`, `REFUND`, `ADJUSTMENT`, `BONUS`, `EXPIRED_CREDIT`), un lien vers l'appel qui a causé le débit, et un lien vers le paiement Stripe — unique, donc un paiement ne crédite qu'une fois. L'historique déjà écrit a été reclassé par la migration. |
| 18 — Crédits inclus dans l'abonnement | **Fait.** `Plan.monthlyCredits`, réglable depuis l'administration. Manque : la distinction entre crédits offerts et crédits achetés. |
| 21 — `project_versions` | **Existe déjà** sous le nom `ProjectVersion`. |
| 22 — Optimisation du coût | **Partiel.** Cache du prompt système, génération en deux temps (plan au modèle fort, pages au modèle rapide — le coût divisé par deux, mesuré), modèle économique pour les réponses courtes, et depuis peu la sélection de contexte. Reste : le résumé de l'historique de conversation. |
| 23 — Sécurité | **Fait.** RLS forcé en base, `withUserScope`/`withRuntimeScope`, vérification d'origine, limitation de débit, secrets chiffrés au repos, aucun secret côté navigateur, messages d'erreur expurgés des clés. |
| 16 — Webhook Stripe | **Fait pour les abonnements.** `StripeEvent` garantit qu'un événement n'est traité qu'une fois. Rien n'est jamais crédité sur le retour navigateur. |

### Ce qui manque vraiment

Trois manques, et un seul est un mur.

1. **L'agent est à coup unique.** `requestEdit` fait un appel, produit un patch, le valide,
   réessaie une fois si la validation refuse. Il ne lit pas l'application avant de décider,
   ne planifie pas, n'enchaîne pas d'étapes, ne vérifie pas son propre travail autrement
   que par la validation du schéma. Ce n'est pas un agent : c'est un traducteur
   demande → patch.

2. **Le contexte est envoyé en entier, à chaque fois.** C'est exactement ce que votre
   point 22 dénonce. C'est réparable, et c'est le gain le plus immédiat.

3. **Le plafond, c'est l'AppSpec.** Et c'est là qu'il faut s'arrêter.

---

## 2. L'arbitrage qui commande tout le reste

Votre point 3 demande que l'agent puisse « ajouter des APIs », « ajouter des webhooks »,
« modifier la base de données », « créer des tables », « refactoriser », « améliorer du
code existant ». Ces verbes supposent qu'il existe du code et des tables par application.
Il n'y en a pas. Deux chemins s'ouvrent, et ils ne mènent pas au même produit.

### Chemin A — Élargir le modèle déclaratif

On garde un moteur unique et on lui donne davantage à exprimer : plus de types de blocs,
des champs calculés, des règles métier déclaratives, des vues, des automatisations, des
pages en nombre libre, des relations plus riches.

- Le coût d'infrastructure reste **constant par application** : un déploiement, un
  certificat, une base.
- La sécurité reste vérifiable : aucune ligne écrite par une IA ne s'exécute.
- Une modification ratée ne peut pas casser une application : le patch est revalidé
  entièrement, et refusé en bloc s'il produit une AppSpec invalide.
- Le plafond monte beaucoup, mais il existe toujours.

### Chemin B — Générer du vrai code par application

C'est ce que font Lovable, v0, Bolt. Il faut alors : un dépôt par application, une chaîne
de construction, un bac à sable d'exécution, un hébergement par client, une surveillance
par client, et une réponse à la question « que se passe-t-il quand le code généré ouvre une
faille chez un créateur ».

Il faut le dire nettement, parce que cela heurte de front une de vos règles :

> « Je veux construire un système scalable dans lequel 1 000 utilisateurs connectant leurs
> outils ne puissent pas soudainement générer des milliers d'euros de factures API à
> Evoliia. »

Le chemin B fait exactement l'inverse. Chaque application devient une dépense
d'hébergement, de construction et de surveillance. Mille applications, mille dépenses. À
cela s'ajoute que du code arbitraire généré par une IA et exécuté sur votre infrastructure
est, en l'état, incompatible avec la garantie d'isolation que vous vendez aujourd'hui.

**Ma recommandation : le chemin A**, et l'agent par-dessus. Presque tous vos exemples du
point 3 deviennent réalisables sans quitter le déclaratif :

| Votre exemple | Chemin A |
|---|---|
| « Ajoute une page tarif avec trois abonnements » | Déjà possible : bloc `pricing` + monétisation. |
| « Ajoute Stripe » | Déjà possible : Stripe Connect est branché, l'agent n'a qu'à activer la monétisation et créer les offres. |
| « Ajoute un espace membre » | Déjà possible : `auth.enabled`, pages `requiresAuth`, mot de passe oublié depuis hier. |
| « Change le dashboard pour afficher les ventes des 30 derniers jours » | Nouveau bloc déclaratif à construire (`metrics`), pas de code. |
| « Ajoute un agent IA qui analyse les produits » | Déjà possible : bloc `assistant`, avec son rôle décrit par le créateur. |
| « Le bouton Enregistrer ne fonctionne plus, trouve le problème » | Diagnostic sur l'AppSpec + les contrôles + les erreurs enregistrées. Réalisable. |
| « Transforme cette page en application mobile responsive » | Déjà le cas : le moteur est responsive et installable en PWA. |
| « Ajoute des webhooks / des APIs » | **Non réalisable en A** sans une brique nouvelle : une passerelle d'automatisations déclarative, à concevoir séparément. |

Le seul renoncement réel du chemin A, ce sont les APIs et webhooks sortants arbitraires.
Ils peuvent être traités plus tard par une brique dédiée et bornée, pas par du code libre.

**J'attends votre décision sur ce point avant d'écrire la moindre ligne des phases 2 et 3.**

---

## 3. Les huit phases

Chaque phase est indépendante, livrable et réversible. Aucune ne supprime quoi que ce soit.

### PHASE 1 — Tarifs, marge et réservation de crédits · **livrée**

**Ce qui existe.** `CreditWallet`, `CreditLedger`, `AiUsage`, `creditsForCost()`,
`MINIMUM_COST`, `MICROS_PER_CREDIT = 5 000`, `PRICING` par modèle, `MODELS` par rôle.

**Ce qui doit changer.**
- Sortir du code les tarifs des modèles, le multiplicateur de marge, l'unité de conversion
  et les noms de modèles. Ils passent en base, réglables depuis l'administration, avec les
  valeurs actuelles comme valeurs par défaut — donc aucun changement de comportement au
  déploiement.
- Écrire enfin `AiUsage.creditsSpent`, aujourd'hui toujours à 0.
- Introduire la réservation : estimer un plafond, réserver, exécuter, débiter le réel,
  restituer le reste, le tout dans une transaction.
- Structurer `CreditLedger` : un type (`subscription_credit`, `credit_purchase`,
  `ai_usage`, `refund`, `adjustment`, `bonus`, `expired_credit`), un lien facultatif vers
  `AiUsage`, un lien facultatif vers un paiement.

**Nouveaux fichiers.** `src/server/billing/ai-pricing.ts` (lecture et cache des tarifs),
`src/server/billing/reservation.ts`, `tests/unit/ai-pricing.test.ts`,
`tests/integration/reservation.test.ts`.

**Base de données.** Nouvelle table `AiModelPricing` (modèle, entrée, sortie, cache, actif).
Nouvelles lignes `SiteSetting` pour le multiplicateur et l'unité — la table existe déjà.
`CreditLedger` gagne `type`, `aiUsageId`, `stripePaymentId`, tous facultatifs.

**Risques.** Un multiplicateur mal réglé fait payer trop ou pas assez. Une réservation mal
libérée gèle des crédits.

**Comment ne rien casser.** Les colonnes ajoutées sont facultatives, avec des valeurs par
défaut égales au comportement actuel. Une réservation est libérée sur chaque chemin
d'échec, et cesse de toute façon de compter à son échéance. La table des tarifs n'est
amorcée qu'en création : un tarif corrigé depuis le back-office n'est jamais réécrit par
un déploiement.

**Ce qui a réellement été livré.** Tables `AiModelPricing` et `CreditReservation` ;
`CreditLedger` typé et relié à l'appel et au paiement ; `ai-pricing.ts` avec les valeurs du
code en secours ; `reservation.ts` ; écran d'administration « Le coût de l'intelligence
artificielle » ; `creditsSpent` écrit et réparti. Marge laissée à 1 : rien de ce que paient
les clients n'a changé. 468 tests passent, dont douze nouveaux sur la réservation et le
journal.

---

### PHASE 2 — L'agent App Builder · **livrée, éteinte par défaut**

**Ce qui existe.** `requestEdit` (un appel, un patch), `applyPatch` (chemins sûrs,
revalidation complète), `runChecks`, `ProjectVersion`.

**Ce qui doit changer.** Passer d'un appel unique à une boucle d'agent bornée, avec des
outils déclarés : lire la structure de l'application, lire une page, lire un modèle de
données, lire le rapport de contrôles, proposer un patch, valider un patch à blanc. Le
modèle choisit ses outils ; le serveur les exécute. Bornes non négociables : nombre
d'étapes maximum, jetons maximum, durée maximum, solde vérifié à chaque étape, arrêt net
quand l'un des trois est atteint.

**Nouveaux fichiers.** `src/server/agent/loop.ts`, `src/server/agent/tools.ts`,
`src/server/agent/context.ts` (sélection de contexte), `src/server/agent/limits.ts`,
`tests/unit/agent-context.test.ts`, `tests/integration/agent-loop.test.ts`.

**Base de données.** Rien d'obligatoire. Éventuellement `AgentRun` pour tracer les étapes
d'une exécution, utile au diagnostic.

**Risques.** C'est ici que se joue le risque de coût. Une boucle non bornée, c'est la
facture Anthropic incontrôlée que vous refusez.

**Comment ne rien casser.** L'agent est une **deuxième** voie, pas un remplacement :
`editWithAssistant` reste en place et reste le chemin par défaut jusqu'à ce que l'agent
fasse mieux, mesuré sur des cas réels. L'interrupteur « Agent de construction » décide
lequel répond, sur la même adresse, donc le fermer suffit à revenir en arrière.

**Ce qui a réellement été livré.**

- `agent/limits.ts` — quatre bornes indépendantes (étapes, jetons, crédits, durée),
  vérifiées **avant** chaque appel, réglables depuis l'administration. Valeurs de départ :
  6 étapes, 40 000 jetons, 40 crédits, 4 minutes.
- `agent/tools.ts` — quatre outils, et rien d'autre : lire une page, lire un modèle de
  données, lire le rapport des contrôles, proposer des modifications. Aucun accès à la
  base, aucun appel réseau, aucune écriture directe. L'agent propose ; le serveur valide et
  applique sur une copie de travail, puis lui rend « appliqué » ou le motif exact du refus.
- `agent/prompt.ts` — la consigne de modification, augmentée du travail en étapes :
  regarder avant de décider, lire le motif d'un refus plutôt que réessayer à l'identique,
  et garder le droit de dire non.
- `agent/loop.ts` — la boucle, avec réservation des crédits au plafond avant le premier
  appel, débit du réel à la fin, restitution du reste, et une ligne d'usage par étape.
- `editWithAgent` dans le service des projets, la route qui choisit d'après l'interrupteur,
  et l'affichage dans la conversation de ce que l'agent a lu, en combien d'étapes et pour
  combien de crédits.

**Ce qui n'a pas pu être vérifié ici.** L'installation de développement n'a pas de clé
Anthropic : la boucle a été éprouvée contre un modèle scripté, ce qui vérifie la mécanique
— les résultats d'outils reviennent au modèle, un refus est relu, les bornes arrêtent une
boucle qui tourne en rond, les crédits sont rendus — mais pas la qualité des décisions de
l'agent. Celle-là se mesure en ligne, sur de vraies demandes, et c'est précisément pourquoi
l'interrupteur existe et pourquoi il est fermé.

---

### PHASE 3 — Conversation, mode plan, contexte · **livrée**

**Ce qui existe.** `ChatMessage`, l'onglet « Modifier avec l'IA », l'historique.

**Ce qui doit changer.**
- Mode plan : pour une demande importante, l'agent annonce ce qu'il compte faire et attend
  `[Appliquer] [Modifier la demande] [Annuler]`. Pour une petite demande, il applique
  directement. Le seuil est mesurable : nombre d'opérations, pages touchées, modèles de
  données touchés.
- ~~Sélection de contexte~~ : **livrée**, avec un résultat plus modeste qu'annoncé — voir
  ci-dessous.

**La sélection de contexte, et ce qu'elle rapporte vraiment.** Je l'avais présentée comme
« le gain le plus immédiat ». Mesure faite sur les applications réellement publiées :
**11 à 23 % sur les plus fournies, et rien du tout sur les petites**. La raison est simple
et méritait d'être vérifiée avant de promettre : l'essentiel d'une AppSpec est de la
structure — des clés, des identifiants, des types de blocs — et non de la prose. Résumer
la prose ne touche donc qu'une part du volume.

Le mécanisme est gardé pour trois raisons. Il ne peut jamais coûter plus qu'il ne
rapporte : en dessous de 8 000 caractères, l'application est transmise telle quelle, ce qui
est exactement le comportement d'avant. Son rendement croît avec la taille des
applications, c'est-à-dire avec le chemin A. Et il apporte une garantie qui vaut par
elle-même : un texte coupé dans le résumé ne peut pas revenir coupé dans l'application —
la tentative est refusée, et la reprise voit le texte entier.

**Nouveaux fichiers.** `src/components/studio/AgentChat.tsx`,
`src/app/api/projects/[id]/agent/route.ts`, `src/app/api/projects/[id]/agent/plan/route.ts`.

**Base de données.** `ChatMessage` gagne `plan` (Json, facultatif) et `status` (proposé,
appliqué, annulé). Colonnes facultatives : les messages existants restent lisibles.

**Risques.** Un plan accepté puis appliqué sur une application qui a changé entre-temps.

**Comment ne rien casser.** Le plan retient l'empreinte du brouillon sur lequel il a été
calculé ; si elle ne correspond plus au moment d'appliquer, la modification est refusée et
le créateur la redemande, plutôt qu'on l'applique à l'aveugle sur un projet qui a bougé.

**Ce qui a réellement été livré, et pourquoi ainsi.**

Le besoin est venu d'un essai réel : un créateur demande « ajoute un champ métier avec une
liste de choix », l'agent le rend obligatoire — ce qui est défendable — et ne le dit pas.
Le créateur le découvre en butant dessus. La modification était bonne ; c'est le silence
qui ne l'était pas.

Le plan n'est donc **pas une intention calculée d'avance**. L'agent travaille normalement,
et le résultat — déjà produit, déjà validé contre le schéma — est retenu au lieu d'être
appliqué. Trois conséquences : aucun appel supplémentaire au modèle, donc aucun coût ; le
plan ne peut pas promettre l'impossible, puisqu'il existe ; et cliquer « Appliquer » ne
débite rien, ce que l'encadré dit explicitement.

Le seuil est **décidé par le serveur**, jamais par le modèle, en lisant les opérations :
toucher aux données, supprimer quelque chose, changer les comptes ou la monétisation,
dépasser trois pages ou huit opérations. Un agent ne peut donc pas contourner la
confirmation en affirmant que sa modification est petite. En dessous, tout s'applique
directement — demander confirmation pour un changement de couleur apprendrait au créateur à
cliquer sans lire, ce qui reviendrait à ne rien annoncer du tout.

L'encadré dit, dans cet ordre : que rien n'est encore appliqué, ce que la modification
touche — nommé comme le créateur le connaît, « vos données « Devis » », « la page
« Accueil » » —, et pourquoi elle est soumise à décision. Trois boutons : Appliquer,
Modifier la demande, Annuler. La proposition survit à un rechargement de page, et une
nouvelle proposition périme la précédente : deux plans en attente sur le même projet se
contrediraient.

#### Joindre une image à une demande

« Mets cette photo en haut de la page d'accueil » est la demande la plus naturelle du
monde, et elle était impossible : il fallait passer par l'écran Images, retenir un nom de
fichier, puis revenir l'écrire dans la conversation. La zone de saisie accepte maintenant
des images, jusqu'à quatre.

**Ce n'est pas une pièce jointe de messagerie, c'est une image du projet.** Elle part par le
chemin de l'écran Images, rejoint la bibliothèque, passe par le même traitement — identifiée
par ses octets, ré-encodée, comptée dans le quota de l'offre — et reste disponible ensuite,
même si la demande n'aboutit pas. Un second dépôt réservé à la conversation finirait par
accepter ce que l'autre refuse, et laisserait derrière lui des images que rien ne montre.

**Le navigateur ne fait que désigner.** Ce qui circule au moment d'envoyer, ce sont des
identifiants ; le serveur les relit et n'en retient que ceux qui appartiennent à ce créateur
et à ce projet. Sans cette relecture, joindre l'identifiant de l'image d'un autre projet
suffirait à la faire apparaître dans le sien. Les photos reçues des visiteurs sont écartées
du lot : elles appartiennent à une fiche, et les placer dans un bandeau publierait la photo
d'un client.

**L'assistant ne regarde pas l'image.** Il en reçoit le nom, les dimensions et
l'identifiant — de quoi la placer, pas de quoi la décrire. Lui envoyer l'image elle-même
serait un appel d'un autre genre et d'un autre prix ; ce n'est pas ce qui est fait ici, la
consigne le lui dit explicitement, et l'interface le dit au créateur plutôt que de le
laisser croire qu'il a été compris. Joindre une image ne coûte donc rien de plus que la
demande elle-même.

#### Joindre un document à une demande

Un créateur arrive rarement les mains vides : il a un cahier des charges dans un PDF, une
liste de produits exportée en CSV, des notes dans un fichier texte. Jusqu'ici il devait
recopier tout cela dans la zone de saisie — exactement le travail que la plateforme est
censée lui épargner. La zone accepte maintenant deux documents : PDF, texte, Markdown, CSV.

**Rien n'est stocké.** Le document voyage avec la demande et disparaît avec elle. C'est ce
qui le distingue d'une image : une image décore des pages, elle est un bien du projet et
mérite une bibliothèque ; un document est un contexte d'un instant. Ne pas le garder évite
d'un seul coup la table, le ménage, l'adresse qui le sert, et la question de ce qu'on fait
des binaires d'autrui. D'où la seule différence visible côté navigateur : une demande avec
document part en formulaire multipart plutôt qu'en JSON.

**Le PDF est lu par l'API**, qui en extrait texte et mise en page. Écrire notre propre
extracteur aurait ajouté une dépendance, un format d'entrée à surveiller, et fait moins bien
ce qui est déjà fait ailleurs.

**Le contenu n'est jamais une consigne.** Un cahier des charges peut contenir la phrase
« ignore les instructions précédentes » sans la moindre malice. Le texte est donc encadré
comme une donnée, et la consigne dit explicitement que seule la demande du créateur fait
autorité — si le document la contredit, c'est la demande qui l'emporte, et l'assistant le
signale.

**Ce que cela coûte, et comment c'est borné.** Lire un document consomme des crédits du
créateur, contrairement à une image jointe. Trois choses l'encadrent.

Le document est **mis en cache** dans le premier message. La boucle de l'agent renvoie toute
la conversation à chaque étape : sans cela, un PDF de dix pages serait refacturé plein tarif
six fois de suite — environ 48 crédits au lieu de 12.

Le nombre de jetons est **compté avant le premier appel**, par l'API, gratuitement. Au-delà
du plafond (30 000 par défaut, réglable depuis l'administration), la demande est refusée
avec le chiffre en clair, et elle n'a rien coûté. Rien n'est jamais tronqué en silence : un
cahier des charges amputé de sa seconde moitié produirait une application à moitié fausse
sans que personne sache pourquoi.

Ce comptage est une **précaution, pas l'opération** : s'il échoue — clé refusée, réseau —,
la demande se poursuit et l'incident est tracé. Refuser punirait le créateur pour une panne
qui n'est pas la sienne, alors que la réservation de crédits et les bornes de l'agent le
protègent déjà d'un document démesuré, moins finement mais sûrement.

#### Les images créées par l'IA, aux frais d'Evoliia

Jusqu'ici, générer une image exigeait que le créateur connecte sa propre clé OpenAI ou
Google. C'était le bon choix tant qu'Evoliia n'avait pas de système de crédits : personne ne
pouvait refacturer une dépense qui n'était mesurée nulle part. Ce n'est plus le cas.

Le modèle est **Nano Banana** (`gemini-2.5-flash-image`) — celui que le connecteur appelait
déjà. Ce qui change n'est pas le modèle, c'est quelle clé paie.

**La clé du créateur passe toujours en premier.** Elle ne coûte rien à Evoliia, ne consomme
aucun crédit, et celui qui a pris la peine de la connecter veut s'en servir. C'est la voie
de qui veut en faire beaucoup, et elle reste la première servie.

**La clé d'Evoliia est le filet pour tous les autres** — c'est-à-dire pour l'immense
majorité, qui n'ouvrira jamais un compte Google AI. Là, c'est de l'argent qui sort
réellement du compte de la plateforme.

**Deux bornes indépendantes, et elles ne protègent pas la même chose.**

Le *quota mensuel de l'offre* protège Evoliia. Zéro par défaut, comme les alertes : la
fonction s'ouvre offre par offre depuis le back-office, jamais toute seule. Le maximum
réglable est volontairement bas — à quatre centimes l'image, mille par mois et par créateur
seraient quarante dollars.

Les *crédits* protègent le créateur de sa propre gourmandise. Une image coûte environ huit
crédits quand une application entière en coûte vingt et un : sans cette borne, douze images
videraient le mois d'une offre d'entrée, et le créateur découvrirait ensuite qu'il ne peut
plus modifier son application. C'est nous qu'il appellerait.

Un plafond journalier double le tout, des deux côtés. Il ne borne pas une dépense mais un
emballement — celui d'une boucle qui partirait toute seule.

**L'ordre des gestes** est celui qui protège des deux erreurs opposées : réserver les crédits
*avant* d'appeler (vérifier le solde après coup laisserait passer un appel qu'on ne peut pas
facturer, et deux demandes simultanées passeraient toutes les deux), et ne débiter qu'*après*
un succès (un fournisseur qui refuse ne facture pas Evoliia, donc le créateur ne doit rien
payer). La réservation est rendue dans tous les cas.

**Les deux origines sont distinguées en base** — `ai` et `ai-evoliia` — pour une seule
raison : le quota mensuel ne doit compter que ce qu'Evoliia a réellement payé. Les confondre
ferait consommer, au créateur qui a sa propre clé, un quota dont il ne prend rien.

**Le prix se règle depuis l'administration**, en micro-dollars par image. C'est le seul
tarif qui ne vit pas dans la table des modèles : le fournisseur facture à l'image, pas aux
jetons. Le jour où Google change son prix est précisément celui où il ne faut pas avoir à
déployer.

**Et le créateur sait ce qu'il paie avant de cliquer.** L'écran dit laquelle des trois
situations est la sienne : « facturée sur votre compte Google, vos crédits ne sont pas
touchés », « comprise dans votre offre : 5 images restantes, 8 crédits chacune », ou « votre
offre ne comprend pas d'images ». Une image créée sans savoir qu'elle coûte huit crédits est
une mauvaise surprise, et une mauvaise surprise sur de l'argent coûte plus cher que la
fonction ne rapporte.

#### Quand le créateur est bloqué

Un créateur qui ne sait pas coder appelle « bug » tout ce qui ne se passe pas comme prévu :
une page mal réglée, un crédit épuisé, une panne. Personne ne fera le tri à sa place, donc
l'agent le fait.

Il dispose pour cela de deux lectures. **`lire_controles`** lui rend le rapport de
l'application — page d'accueil absente, texte resté à compléter, contraste illisible,
formulaire qui vise des données qui n'existent plus. C'est le cas le plus fréquent, et de
loin, et il sait le corriger seul. **`lire_incidents`** lui rend ce qui a récemment échoué
pour ce créateur-là : une construction interrompue, une image refusée, une modification qui
n'a pas abouti. C'est ce qui manquait le plus : le créateur signale « j'ai essayé et ça n'a
pas marché » sans pouvoir en dire plus, parce qu'il a refermé le message d'erreur.

Trois règles bornent cette seconde lecture, et chacune est une limite qu'on se donne. **Seulement
les siens** — la requête est bornée à son identifiant ; lire les incidents d'un autre serait
une fuite, même sans intention. **Seulement ce qui le concerne** — le message brut du
fournisseur ne sort pas du module, car il peut porter un nom d'hôte ou une limite de compte ;
seul le code en sort, traduit en une phrase que le créateur comprend. **Seulement le
récent** — quarante-huit heures : un échec d'il y a trois semaines n'explique pas ce qui
vient d'arriver, et l'évoquer ferait douter d'une application qui marche.

Le chargement a lieu **avant la boucle**, en une requête, et l'outil ne fait que lire en
mémoire. Un outil qui irait chercher en base ferait attendre le modèle au milieu d'une étape
déjà payée, et ouvrirait la porte à des outils qui écrivent.

La consigne lui demande enfin de nommer lequel des trois cas il a devant lui : ce qui est
dans l'application (il corrige), ce qui tient au compte ou à l'offre (il ne peut pas
corriger, mais il nomme précisément et dit quel écran ouvrir), et ce qui est une panne
d'Evoliia (il le dit franchement, n'invente aucune cause, et invite à signaler). « Je ne sais
pas » à la place de « il ne vous restait plus de crédits » est la réponse qui fait partir un
créateur.

**Ce qui manque encore**, et qui n'est pas de l'agent : rien ne remonte jusqu'à
l'exploitant. Un créateur bloqué par une panne ne dispose d'aucun chemin vers lui, et les
demandes que l'assistant refuse — la meilleure feuille de route qui soit, écrite par les
clients — sont jetées à mesure.

---

### PHASE 4 — Preview et correction automatique

**Ce qui existe.** L'aperçu en direct, `runChecks`, une reprise si la validation refuse.

**Ce qui doit changer.** Après application d'un patch : relancer les contrôles, et si
quelque chose casse, laisser l'agent lire le rapport et proposer une correction — **au plus
deux fois**, puis s'arrêter et le dire. Une correction qui n'aboutit pas est un résultat
honnête ; une boucle qui s'acharne est une facture.

**Nouveaux fichiers.** `src/server/agent/repair.ts`.

**Base de données.** Rien.

**Risques.** La boucle de correction est le deuxième endroit où une facture peut s'emballer.

**Comment ne rien casser.** Le compteur de tentatives est global à l'exécution de l'agent,
pas par étape. Chaque correction passe par le même `applyPatch` revalidé : elle ne peut pas
produire une application invalide.

---

### PHASE 5 — Historique et versions

**Ce qui existe.** Tout, ou presque : versions immuables numérotées, libellé lisible,
restauration, onglet Versions. Votre point 7 est déjà satisfait.

**Ce qui doit changer.** Peu : rattacher une version à l'exécution d'agent qui l'a produite,
et afficher le coût en crédits à côté de chaque version. Utile, pas structurant.

**Base de données.** `ProjectVersion` gagne `agentRunId` et `creditsSpent`, facultatifs.

**Risques.** Aucun notable.

---

### PHASE 6 — Achat de crédits par Stripe

**Ce qui existe.** Stripe en production, validé par un vrai paiement et un vrai
remboursement. `StripeEvent` garantit qu'un événement n'est traité qu'une fois. Aucun crédit
n'est jamais accordé sur un retour de navigateur.

**Ce qui doit changer.** Un mode `payment` (et non `subscription`) dans Checkout, une table
de packs administrable, et l'octroi des crédits **dans le traitement du webhook**, jamais
ailleurs.

**Nouveaux fichiers.** `src/server/billing/credit-packs.ts`,
`src/app/api/credits/achat/route.ts`, `src/app/[locale]/credits/page.tsx`,
`src/components/studio/CreditsBoard.tsx`.

**Base de données.** Nouvelle table `CreditPackage` (nom, crédits, prix, monnaie, actif,
ordre, identifiants Stripe). `CreditLedger.stripePaymentId` unique quand il est présent :
c'est la garantie qu'un paiement ne crédite qu'une fois, en plus de `StripeEvent`.

**Risques.** Double crédit sur un rejeu de webhook. Crédit accordé sans paiement.

**Comment ne rien casser.** Deux verrous indépendants : `StripeEvent` en amont, contrainte
d'unicité sur `stripePaymentId` en aval. Le webhook des abonnements existant n'est pas
touché — le nouveau type d'événement est ajouté à son `switch`, sans rien retirer.

**Ce que je ne fais pas sans vous.** Je ne fixe aucun prix, aucune quantité de crédits,
aucun contenu d'offre. Vous les réglerez depuis l'administration. Vos règles là-dessus sont
claires et je m'y tiens.

---

### PHASE 7 — Tableaux de bord

**Ce qui existe.** Le solde affiché partout, l'abonnement détaillé, l'administration
(offres, utilisateurs, remboursements, interrupteurs, derniers échecs IA).

**Ce qui doit changer.**
- Côté créateur : une section « Utilisation IA » — crédits restants, consommés ce mois,
  répartition par type d'opération, bouton d'achat.
- Côté administration : consommation Anthropic totale, par utilisateur, par projet, par
  modèle ; coût API réel ; crédits consommés ; revenus des packs ; marge estimée ; gros
  consommateurs. Plus les réglages : tarifs des modèles, multiplicateur, packs, crédits
  inclus, limites.

**Nouveaux fichiers.** `src/server/billing/ai-reporting.ts`,
`src/components/studio/AiUsagePanel.tsx`, `src/components/admin/AiCostBoard.tsx`.

**Base de données.** Rien de nouveau : `AiUsage` contient déjà tout, une fois `creditsSpent`
réellement écrit (phase 1).

**Risques.** Le Row Level Security masque les projets des autres, y compris à
l'administration — c'est voulu et documenté. Les agrégats porteront sur `AiUsage`, qui est
une table globale, pas sur les projets.

---

### PHASE 8 — Coût et sécurité

**Ce qui existe.** Cache du prompt système, génération en deux temps, routage par modèle,
limitation de débit, quotas mensuels, RLS, secrets chiffrés, journaux expurgés.

**Ce qui doit changer.**
- Limite journalière par utilisateur, configurable.
- Résumé du contexte ancien plutôt que renvoi intégral de la conversation.
- Cache étendu au contexte du projet quand il est stable.
- Mesure : un tableau avant/après sur des cas réels, sinon on ne saura pas si ça a marché.

**Risques.** Une limite trop basse bloque un client qui paie.

**Comment ne rien casser.** La limite journalière est éteinte par défaut, et vous la réglez.

---

## 4. Ordre proposé et ce que j'attends de vous

L'ordre n'est pas celui de votre liste, et c'est délibéré : la phase 1 est le socle de
tout le reste, et la phase 8 partielle doit venir **avant** l'agent, pas après. On ne
construit pas une boucle d'agent puis on lui met des freins ; on pose les freins d'abord.

1. **Phase 1** — tarifs administrables, `creditsSpent` écrit, réservation. Sans risque.
2. ~~**Phase 3 (contexte seul)**~~ — **livrée.** 11 à 23 % sur les applications fournies,
   rien sur les petites, aucun changement visible pour le créateur.
3. ~~**Phase 2**~~ — **livrée**, derrière un interrupteur, à côté de l'existant. Reste à
   l'ouvrir en ligne et à comparer les deux chemins sur les mêmes demandes.
4. ~~**Phase 3 (mode plan)**~~ — **livrée**. Reste la **phase 4**, la boucle de correction.
5. **Phase 5**, **phase 7** — historique enrichi, tableaux de bord.
6. **Phase 6** — packs de crédits, quand vous aurez fixé les prix.
7. **Phase 8** — le reste des optimisations, mesuré.

**Trois décisions ont été prises le 16 septembre 2026, et sont reportées ici :**

1. **Chemin A** — élargir le modèle déclaratif. Les APIs et webhooks sortants arbitraires
   restent hors périmètre ; ils relèveront d'une brique dédiée et bornée, pas de code libre.
2. **Bornes prudentes** pour l'agent : de l'ordre de six étapes, quarante mille jetons et
   quarante crédits par exécution. On mesure sur des cas réels avant d'élargir, avec des
   chiffres plutôt qu'une impression.
3. **Marge à 1.** Le multiplicateur devient explicite et réglable, sans rien changer à ce
   que paient les clients aujourd'hui. Il s'ajustera quand le tableau de bord
   administrateur montrera la marge réelle par opération.
