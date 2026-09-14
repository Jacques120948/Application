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

## Ce qui reste hors périmètre

Pas de génération d'images par l'IA : elle aurait un coût par image à la charge
d'Evoliia ou des crédits, et c'est une décision commerciale à prendre avant d'écrire une
ligne. Les images viennent du créateur.
