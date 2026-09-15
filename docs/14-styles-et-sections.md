# Styles et sections des applications créées

Ce que change ce chantier tient en une phrase : une application créée par Evoliia doit
avoir l'air décidée, pas générée. Deux leviers, dans cet ordre : la finition visuelle,
puis la richesse des sections.

## Styles complets

Un style n'est pas une palette. C'est une palette, une paire de polices, une forme, un
motif de fond et une respiration qui vont ensemble (`src/lib/style-presets.ts`). Huit
styles : Confiance, Nature, Chaleur, Élégance, Minimal, Nuit, Audace, Douceur. Le
panneau Design les propose en vignettes ; en appliquer un règle tout le thème d'un coup,
puis chaque réglage se retouche à la main. Le plan de l'IA en choisit un selon l'activité
(`themePreset`), avec les descriptions données dans les prompts.

Le thème (`theme` dans l'AppSpec) gagne deux champs facultatifs, pour que les
applications d'avant restent valides :

| Champ | Valeurs | Effet |
|---|---|---|
| `pattern` | blobs, dots, grid, lines, none | Motif de fond des bandeaux, dessiné en CSS. Halos par défaut. |
| `density` | airy, balanced, compact | Espace vertical entre les sections. |

## Polices

Huit paires (`src/lib/fonts.ts`), chacune avec une police de titres et une police de texte
courant, une graisse et un interlettrage propres :

| id | Titres | Texte | Pour |
|---|---|---|---|
| system | police de l'appareil | idem | neutre, rapide |
| serif | Lora | Lora | ton sérieux, durable |
| rounded | Nunito | Nunito | amical |
| elegant | Playfair Display | DM Sans | mode, beauté, hôtellerie |
| geometric | Outfit | Manrope | technologie, services |
| editorial | Fraunces | Inter | contenu, culture, artisanat |
| playful | Fredoka | Nunito | enfants, loisirs, alimentation |
| bold | Space Grotesk | Inter | sport, musique, lancement |

Les polices sont **auto-hébergées** (paquets Fontsource importés dans la mise en page
racine). Aucun appel à Google Fonts : aucune adresse de visiteur envoyée à un tiers, aucune
dépendance réseau au rendu. Le navigateur ne télécharge que les fichiers des polices
réellement utilisées par la page. L'export statique glisse les fichiers `woff2` de la paire
choisie dans l'archive, sous `fonts/`, et la feuille de style les déclare.

## Sections

Onze types existaient. Dix s'ajoutent, tous rendus en ligne, en aperçu et à l'export :

| Type | Ce que c'est | Images |
|---|---|---|
| `imageText` | Image et texte côte à côte, bouton facultatif | 1 |
| `gallery` | 2 à 12 photos légendées | n |
| `testimonials` | Témoignages avec auteur, rôle, photo | n |
| `steps` | Étapes numérotées, icône facultative | — |
| `team` | Les personnes, avec photo ou initiales | n |
| `logos` | Partenaires, clients, labels : noms ou logos | n |
| `contact` | E-mail, téléphone, adresse (lien vers la carte), horaires | — |
| `video` | YouTube ou Vimeo, intégration sans cookie | — |
| `comparison` | Tableau : 2 à 4 colonnes, une valeur par case | — |
| `banner` | Fin bandeau d'annonce | — |

Et deux sections existantes s'enrichissent : le héros gagne un surtitre (`eyebrow`) et
une mise en page `split` (texte à gauche, image encadrée à droite) ; les atouts gagnent
une icône par élément et une mise en page `list`.

Les icônes forment un jeu fermé de quarante dessins au trait (`src/lib/icons.ts`). Seul
le nom voyage dans l'AppSpec ; un nom inconnu tombe sur l'étincelle. Le même dessin sert
au rendu React et à l'export HTML.

### Ce qui ne s'invente pas

Les prompts l'interdisent en toutes lettres et les tests d'assemblage le vérifient :

- **Aucun identifiant d'image** n'est produit par le modèle. L'assemblage retire tout
  `imageId` absent de la bibliothèque du projet (vide à la première génération). Les
  emplacements sont prévus, le créateur les remplit depuis l'onglet Images, qui liste
  désormais chaque emplacement de chaque section.
- **Aucun témoignage, aucun nom d'équipe, aucun logo, aucun chiffre** qui n'ait été
  fourni par le créateur. Une section vide de vraie matière n'est pas générée.
- Une image absente n'est jamais un trou : un cadre aux couleurs de l'application garde
  la place et, en aperçu seulement, dit où l'ajouter.

### Génération

Vingt et un types de section font une grammaire trop large pour la sortie structurée de
l'API. Le plan nomme les types attendus sur chaque page ; le contrat de chaque page est
alors restreint à ces types (`pageContentSchemaFor`). L'appel reste sous la limite et le
modèle ne peut pas produire une section non prévue.

### Contrôles

Un contrôle « images » avertit quand une galerie est vide ou qu'aucune section illustrée
n'a d'image. Un héros sans photo n'avertit pas : son dégradé est un fond à part entière.

## Données : consulter et corriger

Une liste (`recordList`) ne montre qu'un titre et un sous-titre. C'est ce qu'il faut pour
parcourir, et bien trop peu pour consulter : les autres champs saisis par le visiteur
n'étaient visibles nulle part. Une ligne s'ouvre donc, et montre alors **tous** les champs
du modèle, chacun sous son intitulé.

Ouverte, une fiche qu'on a soi-même saisie se **corrige sur place**, dans le même
formulaire que celui de la saisie. Avant cela, une application ne savait que créer et
détruire : changer une virgule imposait de supprimer puis de ressaisir, et tout ce qui a un
état — une réservation qu'on déplace, une tâche qu'on coche — était hors de portée.

Le drapeau `allowEdit` du bloc décide de l'affichage du bouton. Il vaut `true` par défaut,
y compris pour les applications publiées **avant** cette fonction, dont la spécification
figée ne le contient pas : sans cette valeur par défaut, leur relecture échouerait et elles
cesseraient d'être servies.

### Chercher, filtrer, trier

Une liste de deux cents fiches sans outil est inutilisable. Trois réglages du bloc y
répondent, et l'écran ne les montre qu'à partir de six fiches : chercher parmi trois
éléments est une question qu'on ne se pose pas.

| Réglage | Effet |
| --- | --- |
| `searchable` | Une recherche sur tous les champs lisibles du modèle. Vrai par défaut. |
| `filterField` | Un filtre sur un champ `select`. Sur du texte libre, aucune valeur ne se répéterait assez pour faire un filtre utile, et l'intégrité de la spécification le refuse. |
| `sort` | L'ordre d'ouverture : `recent`, `ancien`, `az`, `za`. Le visiteur peut en changer. |

**Tout se passe dans la base, jamais dans le navigateur.** Chercher parmi les vingt fiches
déjà chargées ne serait pas chercher, ce serait en donner l'illusion. La liste se charge
par pages de vingt, avec un bouton « Voir plus » et un nombre de résultats.

**L'ordre alphabétique porte sur le champ affiché en titre**, pas sur un champ choisi par
le code : trier sur une valeur invisible donnerait un ordre que personne ne peut lire.

La requête est écrite à la main, parce que l'ordre et la recherche portent sur des clés
d'un document JSON que l'interface de Prisma ne sait pas ordonner. Trois précautions la
tiennent : aucun nom de champ n'y entre sans avoir été retrouvé dans le modèle publié, il y
entre comme paramètre et jamais par concaténation, et les jokers de SQL sont neutralisés
dans le texte cherché — sans quoi chercher « 100 % » ramènerait tout. Elle s'exécute dans
la portée du projet, donc sous la même protection de la base que le reste.

### Qui a le droit

Le droit n'est jamais décidé par le navigateur. À chaque requête, le serveur revérifie que
celui qui modifie est bien celui qui a saisi — la même règle que pour la suppression, et
désormais le même code pour les deux.

| Situation | Réponse |
| --- | --- |
| Sa propre fiche | Corrigée, après revalidation complète contre le modèle publié |
| La fiche d'un autre, modèle privé | « Introuvable » : dire « interdit » révélerait son existence |
| La fiche d'un autre, modèle partagé | Refus motivé : tout le monde la voit déjà |
| Une fiche déposée sans compte | Personne ne peut la corriger, faute de pouvoir identifier son auteur |

Une correction repasse par la validation de la création : un champ inconnu glissé dans la
requête est écarté, une valeur hors bornes est refusée. Et la suppression compte désormais
dans le même quota d'écriture que la création, sans quoi une boucle pourrait vider une
application sans frein.

## Images générées par l'IA, avec la clé du créateur

Evoliia ne possède aucune clé d'images. Le créateur connecte son compte **OpenAI** ou
**Google Gemini** depuis l'écran Connexions (clé vérifiée par un appel gratuit, chiffrée,
jamais renvoyée au navigateur). L'onglet Images propose alors « Créer une image avec
l'IA » : une description, un bouton, et chaque emplacement d'image a son propre
« Créer avec l'IA » qui préremplit la description et pose l'image dès qu'elle arrive.

| | |
|---|---|
| Coût pour Evoliia | **Aucun.** L'image est facturée sur le compte du créateur. |
| Plafond | 20 images par créateur et par 24 heures (`IMAGE_DAILY_LIMIT`), pour qu'une boucle ou un abus ne vide pas son compte. |
| Description envoyée | Celle du créateur, plus le style de l'application (ambiance, teintes). Sans texte, sans logo, sans personne réelle. Aucune donnée personnelle, aucun prompt système. |
| Rangement | Par `addMedia`, comme un téléversement : ré-encodée, sans métadonnées, comptée dans le quota de stockage de l'offre. `origin = ai`, description conservée. |
| Refus du fournisseur | Traduits : clé refusée (la connexion passe en erreur), quota atteint, description refusée, service indisponible. |
| Modèles | `gpt-image-1` (OpenAI), `gemini-2.5-flash-image` (Google). Des constantes dans `providers/openai.ts` et `providers/gemini.ts` : les changer est une décision. |

Sans clé connectée, le bouton explique où en obtenir une. Il n'existe pas de clé Evoliia
de secours : ce serait une dépense par image à la charge de la plateforme, décision
volontairement laissée pour plus tard, avec de vrais chiffres d'usage.

Une offre n'autorise qu'un certain nombre de connexions (`maxConnections`) : sur Launch,
une seule, ce qui oblige à choisir entre Stripe, Anthropic et une clé d'images. C'est un
réglage d'offre, dans le back-office.
