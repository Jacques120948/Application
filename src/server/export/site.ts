import type { AppSpec, Block, Page } from '@/server/spec/schema'

/**
 * Rendu statique d'une application, pour l'export.
 *
 * C'est un second rendu, et c'en est un à part entière : l'atelier dessine une application
 * vivante branchée sur une base, celui-ci dessine des pages qui s'ouvrent depuis un dossier,
 * sans serveur ni base. Vouloir partager le code des deux aurait produit un composant plein
 * de conditions « si l'on est en export », et deux rendus à moitié justes.
 *
 * La règle tenue de bout en bout : **ce qui ne peut pas fonctionner hors ligne est annoncé,
 * jamais simulé**. Un formulaire qui enregistre des données, un espace membre, un assistant :
 * chacun laisse à sa place un encadré qui dit ce qu'il faisait et ce qu'il faut pour le
 * rétablir. Un faux formulaire qui ne mène nulle part serait pire que son absence.
 *
 * Aucun script n'est produit. Une page exportée est du HTML et du CSS, lisibles et
 * modifiables par quelqu'un qui ne programme pas.
 */

const HOME_PATH = 'accueil'

/** Échappe le texte destiné au corps du document. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Nom de fichier d'une page. L'accueil devient `index.html`, le reste garde son chemin. */
export function fileNameFor(page: Page): string {
  return page.path === HOME_PATH ? 'index.html' : `${page.path}.html`
}

/**
 * Encadré posé à la place d'un bloc qui a besoin d'un serveur.
 *
 * Il nomme le bloc et dit ce qu'il faudrait pour le rétablir. C'est la seule honnêteté
 * possible : sans base de données, un formulaire d'inscription n'enregistre rien, et faire
 * semblable tromperait autant le créateur que ses visiteurs.
 */
function placeholder(titre: string, explication: string): string {
  return [
    '<aside class="bloc-serveur">',
    `<p class="bloc-serveur-titre">${esc(titre)}</p>`,
    `<p class="bloc-serveur-texte">${esc(explication)}</p>`,
    '</aside>',
  ].join('')
}

function renderBlock(block: Block, images: Map<string, string>): string {
  switch (block.type) {
    case 'hero': {
      const fond =
        block.imageId !== undefined && images.has(block.imageId)
          ? ` style="background-image:url('${images.get(block.imageId)}')"`
          : ''
      return [
        `<section class="hero${fond === '' ? '' : ' hero-image'}"${fond}>`,
        `<h1>${esc(block.title)}</h1>`,
        `<p class="hero-sous-titre">${esc(block.subtitle)}</p>`,
        block.ctaLabel === undefined
          ? ''
          : `<p><a class="bouton" href="${block.ctaPageId === undefined ? '#' : `${block.ctaPageId}.html`}">${esc(block.ctaLabel)}</a></p>`,
        '</section>',
      ].join('')
    }
    case 'richText':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        // Les sauts de ligne du créateur sont conservés : ils portent son découpage.
        `<div class="texte">${block.body
          .split('\n')
          .filter((ligne) => ligne.trim() !== '')
          .map((ligne) => `<p>${esc(ligne)}</p>`)
          .join('')}</div>`,
        '</section>',
      ].join('')
    case 'features':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        '<ul class="grille">',
        ...block.items.map(
          (item) =>
            `<li><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></li>`,
        ),
        '</ul>',
        '</section>',
      ].join('')
    case 'faq':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        '<dl class="faq">',
        ...block.items.flatMap((item) => [
          `<dt>${esc(item.question)}</dt>`,
          `<dd>${esc(item.answer)}</dd>`,
        ]),
        '</dl>',
        '</section>',
      ].join('')
    case 'stats':
      return [
        '<section class="bloc">',
        '<ul class="chiffres">',
        ...block.items.map(
          (item) =>
            `<li><span class="chiffre">${esc(item.value)}</span><span class="chiffre-label">${esc(item.label)}</span></li>`,
        ),
        '</ul>',
        '</section>',
      ].join('')
    case 'cta':
      return [
        '<section class="bloc appel">',
        `<h2>${esc(block.title)}</h2>`,
        block.body === undefined ? '' : `<p>${esc(block.body)}</p>`,
        `<p><a class="bouton" href="${block.pageId === undefined ? '#' : `${block.pageId}.html`}">${esc(block.label)}</a></p>`,
        '</section>',
      ].join('')
    case 'pricing':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        placeholder(
          'Offres et paiement',
          "Les offres et le paiement dépendent d'un service extérieur. Cette page exportée les affiche sans encaisser : rétablir le paiement demande de rebrancher votre prestataire.",
        ),
        block.note === undefined ? '' : `<p class="note">${esc(block.note)}</p>`,
        '</section>',
      ].join('')
    case 'recordForm':
      return placeholder(
        block.title ?? 'Formulaire',
        "Ce formulaire enregistrait les réponses de vos visiteurs dans une base de données. Hors ligne, il n'a nulle part où écrire : il faut un serveur pour le rétablir.",
      )
    case 'recordList':
      return placeholder(
        block.title ?? 'Liste de données',
        "Cette liste affichait des données enregistrées par vos visiteurs. Elle n'a pas de sens sans la base qui les contient.",
      )
    case 'auth':
      return placeholder(
        'Espace membre',
        "La création de compte et la connexion demandent un serveur, qui vérifie les mots de passe et garde les sessions. Rien de tout cela ne peut vivre dans un fichier.",
      )
    case 'assistant':
      return placeholder(
        'Assistant',
        "L'assistant répondait aux visiteurs en appelant un modèle d'intelligence artificielle, ce qui suppose une clé et un serveur pour la garder secrète.",
      )
    default:
      return ''
  }
}

function renderNav(spec: AppSpec, courante: Page): string {
  const items = spec.navigation.items
    .map((item) => {
      const page = spec.pages.find((candidate) => candidate.id === item.pageId)
      if (page === undefined) return ''
      const actif = page.id === courante.id ? ' class="actif"' : ''
      return `<a href="${fileNameFor(page)}"${actif}>${esc(item.label)}</a>`
    })
    .join('')
  return `<nav class="navigation">${items}</nav>`
}

/** Arrondis du thème, en pixels. Les noms viennent du schéma, pas de la feuille de style. */
const RAYON: Record<AppSpec['theme']['radius'], string> = {
  none: '0',
  small: '6px',
  medium: '14px',
  large: '24px',
}

/** Feuille de style unique, reprenant le thème choisi par le créateur. */
export function renderStylesheet(spec: AppSpec): string {
  const { primary, accent, background, surface, text, muted } = spec.theme.colors
  const police =
    spec.theme.font === 'serif'
      ? "Georgia, 'Times New Roman', serif"
      : spec.theme.font === 'rounded'
        ? "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif"
        : "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

  return `/* Feuille de style de ${spec.name}, exportée par Evoliia.
   Les couleurs sont celles du thème choisi dans l'atelier. Tout est modifiable ici. */

:root {
  --primaire: ${primary};
  --accent: ${accent};
  --fond: ${background};
  --surface: ${surface};
  --texte: ${text};
  --discret: ${muted};
  --rayon: ${RAYON[spec.theme.radius]};
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--fond);
  color: var(--texte);
  font-family: ${police};
  line-height: 1.6;
}
main { max-width: 900px; margin: 0 auto; padding: 0 20px 64px; }
a { color: var(--primaire); }

.navigation {
  display: flex; flex-wrap: wrap; gap: 20px;
  max-width: 900px; margin: 0 auto; padding: 18px 20px;
}
.navigation a { text-decoration: none; color: var(--discret); }
.navigation a.actif { color: var(--texte); font-weight: 600; }

.hero {
  background: var(--primaire); color: #fff;
  border-radius: var(--rayon); padding: 56px 28px; margin: 12px 0 28px;
  text-align: center;
}
.hero-image { background-size: cover; background-position: center; }
.hero h1 { margin: 0 0 12px; font-size: clamp(1.8rem, 5vw, 2.6rem); }
.hero-sous-titre { margin: 0 auto; max-width: 40rem; opacity: .9; }

.bloc { margin: 0 0 36px; }
.bloc h2 { font-size: 1.5rem; margin: 0 0 12px; }
.texte p { margin: 0 0 12px; }

.grille { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
@media (min-width: 700px) { .grille { grid-template-columns: repeat(3, 1fr); } }
.grille li { background: var(--surface); border-radius: var(--rayon); padding: 20px; }
.grille h3 { margin: 0 0 8px; font-size: 1.05rem; }
.grille p { margin: 0; }

.faq dt { font-weight: 600; margin-top: 16px; }
.faq dd { margin: 6px 0 0; }

.chiffres { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 28px; }
.chiffre { display: block; font-size: 1.8rem; font-weight: 700; color: var(--primaire); }
.chiffre-label { color: var(--discret); font-size: .9rem; }

.appel { background: var(--surface); border-radius: var(--rayon); padding: 28px; text-align: center; }
.bouton {
  display: inline-block; background: var(--primaire); color: #fff;
  padding: 12px 24px; border-radius: var(--rayon); text-decoration: none; font-weight: 600;
}
.note { color: var(--discret); font-size: .9rem; }

/* Bloc qui avait besoin d'un serveur. Signalé, jamais simulé. */
.bloc-serveur {
  border: 1px dashed var(--discret); border-radius: var(--rayon);
  padding: 20px; margin: 0 0 36px; background: var(--surface);
}
.bloc-serveur-titre { margin: 0 0 6px; font-weight: 600; }
.bloc-serveur-texte { margin: 0; color: var(--discret); font-size: .92rem; }

footer { max-width: 900px; margin: 0 auto; padding: 24px 20px 48px; color: var(--discret); font-size: .85rem; }
`
}

/** Une page complète, prête à ouvrir dans un navigateur. */
export function renderPage(
  spec: AppSpec,
  page: Page,
  images: Map<string, string>,
): string {
  return [
    '<!doctype html>',
    `<html lang="${esc(spec.locale)}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(page.title)} — ${esc(spec.name)}</title>`,
    `<meta name="description" content="${esc(spec.tagline)}">`,
    '<link rel="stylesheet" href="styles.css">',
    '</head>',
    '<body>',
    renderNav(spec, page),
    '<main>',
    page.requiresAuth
      ? placeholder(
          'Page réservée aux membres',
          "Cette page n'était visible que par les personnes connectées. Hors ligne, rien ne peut vérifier qui regarde : son contenu est affiché tel quel.",
        )
      : '',
    ...page.blocks.map((block) => renderBlock(block, images)),
    '</main>',
    `<footer>${esc(spec.name)} — page exportée depuis Evoliia.</footer>`,
    '</body>',
    '</html>',
  ].join('\n')
}
