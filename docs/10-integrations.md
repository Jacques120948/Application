# Connexions aux services externes

## Le principe qui commande tout le reste

Evoliia vend la création, l'accompagnement et l'orchestration. Elle ne paie pas les
services que les applications de ses clients consomment.

Concrètement, mille créateurs qui connectent leurs outils ne doivent pas produire une
facture de mille fois quelque chose. Chaque fiche ci-dessous répond donc d'abord à une
question : **qui est facturé ?**

Trois réponses possibles, et une seule est acceptable sans décision explicite.

| Coût pour Evoliia | Signification | Décision |
|---|---|---|
| `aucun` | Le créateur consomme son propre compte. | Implémentable. |
| `quota-partage` | Gratuit, mais adossé à une ressource dont Evoliia est titulaire. | À arbitrer. |
| `facture` | Evoliia serait facturée à l'usage. | Interdit sans accord écrit. |

## Ce qui est construit

Le gestionnaire, pas les connecteurs. Il sait enregistrer une connexion, la lire, la
révoquer, et compter combien une offre en autorise. Ajouter un fournisseur consistera à
écrire son aller-retour d'autorisation, pas à revenir sur cette base.

Trois tables, une intention par table :

- `IntegrationConnection` — ce que le créateur voit. **Aucun secret.**
- `IntegrationCredential` — les secrets, chiffrés en AES-256-GCM. Lue seulement au moment
  d'appeler le fournisseur, jamais pour afficher une liste.
- `IntegrationEvent` — le journal. Un identifiant de fournisseur, un type d'événement,
  jamais un jeton ni un fragment de clé.

Les trois sont soumises au Row Level Security et vérifiées à chaque mise en ligne par
`scripts/verify-isolation.ts`.

Deux usages sont séparés dès le modèle, par la colonne `target` :

- `EVOLIIA` — le créateur connecte son compte pour que la plateforme l'aide à construire.
- `APP` — l'application publiée utilisera la connexion une fois en ligne.

Ils ne vivent pas la même vie et ne se révoquent pas ensemble.

## Ce qui n'est pas construit

Aucun connecteur. Aucun aller-retour OAuth, aucune application déclarée chez un
fournisseur, aucun appel sortant. Toutes les cartes de l'écran « Connexions » affichent ce
qui leur manque, jamais un bouton inerte.

La limite par offre est à zéro partout, donc rien n'est connectable tant qu'une décision
n'a pas été prise.

## Fiches par fournisseur

Relevé du 12 septembre 2026. Ces conditions changent : la date compte autant que le
contenu.

### Google Drive

| | |
|---|---|
| Autorisation | OAuth officiel |
| Périmètre envisagé | `drive.file` uniquement — les fichiers que la personne choisit elle-même |
| API gratuite | Oui |
| Quota gratuit | Compté en unités partagées par projet Google Cloud. Lister des fichiers coûte 100 unités, un téléchargement 200 |
| Coût pour Evoliia | **Quota partagé.** Le projet Google appartient à Evoliia : tous les créateurs puisent dans le même pool |
| Coût pour le créateur | Un compte Google gratuit suffit |
| Stockage nécessaire | Aucun. Les fichiers restent chez Google |
| Webhooks | Oui |
| Validation fournisseur | Écran de consentement à faire vérifier. `drive.file` évite l'audit de sécurité annuel qu'un périmètre large déclencherait |
| Risque | Google a annoncé une facturation des dépassements de quota courant 2026. Aujourd'hui sans frais, demain à surveiller |

### Google Sheets

Mêmes conditions que Drive, même périmètre restreint, mêmes quotas partagés. Pas de
notification de changement : la donnée doit être lue à la demande, jamais interrogée en
boucle.

### Google Calendar

Mêmes quotas. Différence importante : les périmètres Calendar sont classés sensibles par
Google et exigent une vérification avant ouverture au public.

### Stripe

| | |
|---|---|
| Autorisation | OAuth, comptes de type standard |
| Coût pour Evoliia | **Aucun.** En mode « Stripe fixe les prix », les frais sont facturés au compte connecté ; la plateforme ne supporte ni frais de compte, ni frais de versement |
| Coût pour le créateur | La commission Stripe habituelle, sur son propre compte |
| Webhooks | Oui |
| Validation fournisseur | Compte de plateforme Connect à créer |
| Risque | Juridique plutôt que technique : encaisser pour le compte d'autrui ferait d'Evoliia un intermédiaire financier. Le mode standard, où le créateur reste titulaire des paiements, l'évite |

**Séparation stricte.** Le Stripe d'Evoliia facture les abonnements Evoliia. Le Stripe du
créateur encaisse les clients du créateur. Les deux ne se rencontrent jamais.

### Clé Anthropic du créateur

| | |
|---|---|
| Autorisation | Clé fournie par le créateur |
| Coût pour Evoliia | **Aucun** |
| Coût pour le créateur | Ses propres jetons, sur son propre compte, avec le plafond mensuel qu'il fixe |
| Stockage nécessaire | La clé, chiffrée |
| Webhooks | Sans objet |
| Validation fournisseur | Aucune |
| Risque | Une clé confiée est une clé à protéger : chiffrée au repos, jamais renvoyée au navigateur, jamais journalisée |

C'est la contrepartie directe de l'assistant intégré aux applications créées : aujourd'hui
il consomme les crédits Evoliia du créateur, demain il pourra consommer son propre compte.

### Notion, Dropbox

Fiches incomplètes. Ne pas implémenter en l'état.

## Règles permanentes

1. Jamais de mot de passe. OAuth partout où le fournisseur le propose.
2. Le périmètre le plus étroit qui fait le travail. Jamais « tout le Drive » si les fichiers
   choisis suffisent.
3. Les données restent chez le fournisseur. Evoliia lit ce dont elle a besoin, quand elle en
   a besoin, et ne recopie rien.
4. Les notifications du fournisseur plutôt que l'interrogation en boucle.
5. Le coût externe est annoncé sur la carte, avant la connexion.
6. À la déconnexion, le secret est supprimé, pas seulement marqué inutilisable.
7. La suppression d'un compte Evoliia emporte ses connexions, par cascade en base.
