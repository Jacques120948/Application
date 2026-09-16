# 15. L'adresse d'une application publiée

Une application publiée vit par défaut sous `https://evoliia.com/a/<nom-court>`. C'est
gratuit, immédiat, et cela marche depuis toujours. Mais l'adresse annonce l'atelier avant
d'annoncer l'application, et un créateur qui la partage partage d'abord notre marque.

Quand la variable `APPS_DOMAIN` est renseignée, chaque application reçoit **en plus** son
propre sous-domaine, tiré de son nom court :

```
APPS_DOMAIN=evoliia.app   →   https://mon-appli-a1b2c3.evoliia.app
```

Sans cette variable, rien ne change. La fonction est éteinte, pas à moitié branchée.

## Ce que cela coûte, et pourquoi ce choix

Un seul domaine générique est déclaré chez l'hébergeur, avec un seul certificat, quel que
soit le nombre d'applications. Mille créateurs ne coûtent donc pas mille fois plus.

C'est la différence essentielle avec le domaine propre d'un créateur —
`lueur-evenement.ch` — qui demanderait une ressource facturable par application chez
l'hébergeur, une configuration DNS par créateur et le support qui va avec. Cette
seconde fonction n'existe pas ici, et elle ne doit pas être ajoutée sans avoir chiffré
son coût.

## Comment cela marche

| Pièce | Rôle |
| --- | --- |
| `src/lib/apps-domain.ts` | Seule source de vérité : l'hôte d'une application, son préfixe de liens, son adresse publique. Sans dépendance, lisible aussi par le routage de bordure. |
| `src/middleware.ts` | Réécrit `mon-appli.evoliia.app/reserver` vers `/a/mon-appli/reserver`. Le navigateur garde le sous-domaine, Next sert la route existante. |
| `appBasePath(host, slug)` | Vide sur l'adresse propre, `/a/<nom-court>` sur le domaine partagé. C'est lui qui décide de la forme de tous les liens internes, de la portée PWA et du manifeste. |
| `publicAppUrl(slug)` | L'adresse à afficher, à copier, à donner à Stripe pour le retour d'un paiement. Plus aucun appelant ne fabrique cette adresse à la main. |

Ne sont jamais réécrits : les routes d'interface (`/api/`, dont les images des
applications), les fichiers bâtis par Next et l'icône du site.

## Ce qui rend la chose sûre

**Aucun champ, aucune migration.** Le nom court est déjà unique en base, déjà limité aux
minuscules, chiffres et traits d'union, et il se termine toujours par un suffixe
aléatoire. Un nom court ne peut donc jamais valoir `www`, `api` ou `admin`. Un test
vérifie cet invariant sur ce que `slugify` sait produire : s'il changeait, le test
tomberait avant que des adresses cassées n'atteignent la production.

**La vérification d'origine continue de protéger.** Elle compare l'origine de la requête à
l'hôte de la requête, jamais à celui d'Evoliia : une application sur son sous-domaine se
valide elle-même, et une requête venue d'ailleurs reste refusée.

**Les cookies restent cloisonnés.** Le cookie de session d'Evoliia est posé sans domaine,
donc jamais envoyé à un sous-domaine. Les cookies des visiteurs d'une application sont déjà
nommés par projet, et le sous-domaine ajoute une séparation de plus. Enfin, une AppSpec
n'autorise ni HTML ni script : un créateur ne peut pas exécuter de code sur son
sous-domaine.

**L'ancienne adresse ne casse pas.** Les liens déjà partagés continuent de fonctionner. La
nouvelle adresse devient simplement l'adresse canonique, déclarée comme telle dans les
métadonnées pour qu'un moteur de recherche n'y voie pas deux pages concurrentes.

## Mise en service

1. Acheter ou désigner un domaine distinct de celui d'Evoliia, par exemple `evoliia.app`.
   Un domaine distinct plutôt qu'un sous-domaine de `evoliia.com` : c'est la séparation la
   plus nette entre l'atelier et ce qu'il produit.
2. Chez l'hébergeur, ajouter `*.<domaine>` au projet, et faire pointer les serveurs de noms
   du domaine vers lui pour que le certificat générique soit délivré.
3. Ajouter `APPS_DOMAIN=<domaine>` aux variables d'environnement de production, puis
   redéployer : les variables ne sont lues qu'au démarrage.
4. Ouvrir une application publiée depuis le tableau de bord. Son adresse doit être le
   sous-domaine, et l'ancienne adresse doit continuer de répondre.

## Ce que les moteurs de recherche lisent

Une adresse propre ne sert à rien si rien n'indique quoi explorer. Deux sites cohabitent
sur le même code, et ils n'ont pas les mêmes règles.

**Evoliia** (`/robots.txt`, `/sitemap.xml`) annonce ses pages publiques dans les cinq
langues, chacune renvoyant vers ses traductions — sans quoi cinq adresses proches se
feraient concurrence au lieu de se compléter. L'atelier, le tableau de bord et surtout
l'aperçu restent hors index : un aperçu indexé, c'est le brouillon d'un créateur qui sort
dans un moteur avant même qu'il ait publié. Les pages d'aperçu portent en plus une balise
`noindex`, parce qu'un `robots.txt` se contourne et qu'une balise, non.

**Chaque application publiée** a son propre plan de site et son propre `robots.txt`, servis
sous son adresse. Sur le sous-domaine, le routage de bordure amène `/robots.txt` et
`/sitemap.xml` vers ceux de l'application : elle répond avec ses règles, jamais celles
d'Evoliia. Le plan ne liste que les pages publiques, et les pages réservées aux personnes
connectées sont refusées en plus par une balise `noindex` — un robot n'y verrait qu'un
formulaire de connexion, et classerait l'application sur ce formulaire.

Le plan d'Evoliia ne contient **aucune** application : les créations des clients ne sont
pas des pages d'Evoliia, et les y lister reviendrait à publier la liste des créations de
tout le monde sans le leur demander.
