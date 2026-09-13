# Radar d'opportunités et Lia : deux modules, une boucle

## Ce qui a été décidé

Evoliia savait construire une application. Ces deux modules l'encadrent : le **Radar**
intervient avant ou entre les projets — trouver quoi créer — et **Lia** après la mise en
ligne — écouter ce que les utilisateurs demandent. La boucle visée : découvrir → créer →
écouter → améliorer.

Ni l'un ni l'autre n'est une seconde application. Le Radar est une évolution du système
d'idées existant ; Lia est une évolution de l'assistant intégré aux applications créées.
Les écrans d'étude, de construction, l'éditeur, les offres, les crédits, les drapeaux et le
cloisonnement sont ceux d'avant.

## Radar

### Ce qu'il réutilise

| Existant | Ce que le Radar en fait |
|---|---|
| `Idea` (parcours guidé) | Une opportunité **est** une `Idea`, avec `source = 'radar'` ou `'radar_projet'`. L'étude (`/idees/[id]`), l'analyse (`runValidation`) et la conversion en projet (`createProjectFromIdea`) sont celles du parcours. Aucun second validateur. |
| `CreatorProfile` | Le profil de base sert tel quel. Sept précisions facultatives s'y ajoutent (`experienceYears`, `knownSectors`, `technicalLevel`, `entrepreneurExperience`, `marketScope`, `productPreference`, `willingToProspect`). Rien n'est redemandé. |
| Crédits et `AiUsage` | Opérations `radar` (3 crédits estimés) et `radarCompare` (2), comptabilisées comme les autres. |
| Offres (`Plan`) | Fonction `radar` au catalogue, non ajoutée à aucune offre. Quota `radarRunsPerMonth` réglable depuis le back-office. |
| Drapeaux (`SiteSetting`) | `radar` (ouvert), `radarV2` (fermé). |

### Le score, documenté

Calculé par la plateforme, jamais par le modèle (`src/server/radar/score.ts`) :

    compatibilité profil  25 %   (calculée depuis le profil et l'idée)
    demande               25 %   (niveau qualifié par le modèle)
    monétisation          20 %
    concurrence, inversée 15 %
    complexité, inversée  15 %

Un niveau faible/moyen/fort vaut 2,5 / 5,5 / 8,5 sur dix. Le score est une **estimation
comparative**, présenté comme tel à côté de chaque carte ; il ne ressemble jamais à une
probabilité de réussite.

### Déduplication

Empreinte lexicale du titre et du problème (mots porteurs, sans mots vides, pluriels
rabotés). Deux empreintes qui partagent la moitié de leurs mots désignent la même idée : la
seconde est écartée avant d'être écrite. Les titres déjà vus sont aussi transmis au modèle.

### V2, derrière `radarV2`

- **Autour d'un projet** : `POST /api/radar` avec `projectId`, source `radar_projet`, le
  projet transmis au modèle sous étiquette de donnée.
- **Indices tirés des avis** : « pas pour moi » avec raison, « ça m'intéresse »,
  enregistrées, converties — résumés en quelques phrases (`preferences.ts`), jamais un profil.
- **Signaux extérieurs** : interface `SignalSource`, deux adaptateurs déclarés sans clé
  (`RADAR_TRENDS_API_*`, `RADAR_NEWS_API_*`). Sans clé, rien n'est appelé et l'écran dit
  « connexion externe requise ». Un signal stocké porte source, date, type, URL, résumé,
  confiance.
- **Recherche mensuelle** : `POST /api/cron/radar` avec `Authorization: Bearer $CRON_SECRET`.
  Sans `CRON_SECRET` (≥ 32 caractères), la route répond 404. Une fois par période, jamais
  sans quota ni solde, débitée à la personne comme une recherche manuelle. Notification
  `radar_new`, e-mail si Resend est configuré, désactivable (`User.radarAlerts`).

## Lia

### Ce qu'elle réutilise

| Existant | Ce que Lia en fait |
|---|---|
| Assistant intégré (`askAppAssistant`) | Même économie : le visiteur écrit, le créateur paie ; clé BYOK du créateur d'abord, crédits Evoliia sinon ; plafond journalier compté en base. |
| `resolveRuntimeSpec`, `getEndUser` | Identité de l'application servie et du compte visiteur, quand il y en a un. |
| `withRuntimeScope` / `withOwnerRuntimeScope` | Le visiteur ne voit que son projet ; le créateur, ses lignes. |
| `Notification` (nouvelle table, partagée avec le Radar) | Tickets et lacunes remontent au créateur. |
| Éditeur (`ChatPanel`) | Une analyse devient une demande préremplie dans « Modifier avec l'IA ». Rien n'est appliqué seul. |

### Trois couches, strictement séparées

Le modèle reçoit : les consignes (système, jamais variables), la base de connaissances
(`<base_de_connaissances note="seule source autorisée">`), et les messages du visiteur
(`asUserData`). La réponse est **structurée** : `canAnswer` à faux est un refus explicite,
pas une phrase à deviner, et l'écran propose alors « Transmettre ma demande ».

Un brouillon n'existe pas pour le visiteur : la politique de la base
(`supportknowledge_runtime`) ne laisse lire que `status = 'published'`.

### Garde-fous économiques, dans l'ordre

1. Lia allumée (réglage du créateur **et** drapeau `liaSupport`).
2. Conversation appartenant à ce visiteur (empreinte HMAC ou compte).
3. Plafond journalier de l'application (`DAILY_LIA_LIMIT = 300`).
4. Quota mensuel de l'offre (`liaAnswersPerMonth`, `liaConversationsPerMonth`).
5. Solde, dans l'opération.
6. Limites par visiteur (`RULES.liaMessage` 12 / 5 min, `RULES.liaTicket` 3 / h).

Le visiteur ne voit jamais la cause d'un refus économique.

### V2, derrière `liaV2`

Analyse par lot des conversations des trente derniers jours (`liaInsights`, 3 crédits) :
questions fréquentes, demandes de fonctions, problèmes possibles, lacunes. Exemples
reformulés, jamais cités. Statuts `new` / `roadmap` / `dismissed` ; « Préparer avec
Evoliia » remplit l'éditeur, la personne envoie.

## Ce qui reste fermé, et pourquoi

| Partie | État | Pour l'ouvrir |
|---|---|---|
| Radar V2 | drapeau `radarV2` fermé | Back-office → Interrupteurs |
| Recherche mensuelle | route 404 | `CRON_SECRET` + une tâche cron chez l'hébergeur |
| Signaux extérieurs | adaptateurs sans clé | choisir un fournisseur, poser ses variables, écrire `fetch` |
| Lia V2 | drapeau `liaV2` fermé | Back-office → Interrupteurs |
| E-mails (alertes, tickets, réponses) | selon Resend | `RESEND_API_KEY`, `EMAIL_FROM` |
| Fonctions `radar` et `lia_support` | dans aucune offre | Back-office → Offres, avec les quotas |
