import type { AppSpec, Block, Page } from '@/server/spec/schema'
import { fontFiles, fontPairing, fontStack } from '@/lib/fonts'
import { iconSvg } from '@/lib/icons'

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

/** Une image du dossier exporté, ou un cadre vide qui garde la place. */
function image(images: Map<string, string>, imageId: string | undefined, alt: string, classe = ''): string {
  const chemin = imageId === undefined ? undefined : images.get(imageId)
  if (chemin === undefined) return `<div class="image-vide ${classe}" aria-hidden="true"></div>`
  return `<img class="${classe}" src="${chemin}" alt="${esc(alt)}" loading="lazy">`
}

function initiales(nom: string): string {
  return nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function avatar(images: Map<string, string>, imageId: string | undefined, nom: string): string {
  const chemin = imageId === undefined ? undefined : images.get(imageId)
  if (chemin === undefined) return `<span class="avatar avatar-initiales" aria-hidden="true">${esc(initiales(nom))}</span>`
  return `<img class="avatar" src="${chemin}" alt="${esc(nom)}" loading="lazy">`
}

/** Adresse d'intégration d'une vidéo, sans cookie de suivi. */
function videoEmbed(url: string): string | null {
  const youtube = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/i)
  if (youtube?.[1]) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`
  const vimeo = url.match(/vimeo\.com\/(\d{6,})/i)
  if (vimeo?.[1]) return `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`
  return null
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
        block.eyebrow === undefined ? '' : `<p class="surtitre">${esc(block.eyebrow)}</p>`,
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
        block.intro === undefined ? '' : `<p class="intro">${esc(block.intro)}</p>`,
        `<ul class="grille${block.layout === 'list' ? ' grille-liste' : ''}">`,
        ...block.items.map(
          (item, index) =>
            `<li><span class="pastille">${item.icon === undefined ? index + 1 : iconSvg(item.icon, 20)}</span><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></li>`,
        ),
        '</ul>',
        '</section>',
      ].join('')
    case 'imageText':
      return [
        `<section class="bloc image-texte${block.imagePosition === 'right' ? ' image-droite' : ''}">`,
        image(images, block.imageId, block.title, 'image-texte-visuel'),
        '<div>',
        `<h2>${esc(block.title)}</h2>`,
        `<div class="texte">${block.body
          .split('\n')
          .filter((ligne) => ligne.trim() !== '')
          .map((ligne) => `<p>${esc(ligne)}</p>`)
          .join('')}</div>`,
        block.ctaLabel === undefined || block.ctaPageId === undefined
          ? ''
          : `<p><a class="bouton" href="${block.ctaPageId}.html">${esc(block.ctaLabel)}</a></p>`,
        '</div>',
        '</section>',
      ].join('')
    case 'gallery':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        '<ul class="galerie">',
        ...block.items.map(
          (item) =>
            `<li>${image(images, item.imageId, item.caption ?? '')}${item.caption === undefined ? '' : `<p class="legende">${esc(item.caption)}</p>`}</li>`,
        ),
        '</ul>',
        '</section>',
      ].join('')
    case 'testimonials':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        '<ul class="grille temoignages">',
        ...block.items.map(
          (item) =>
            `<li><blockquote>${esc(item.quote)}</blockquote><p class="auteur">${avatar(images, item.imageId, item.author)}<span><strong>${esc(item.author)}</strong>${item.role === undefined ? '' : `<br><small>${esc(item.role)}</small>`}</span></p></li>`,
        ),
        '</ul>',
        '</section>',
      ].join('')
    case 'steps':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        '<ol class="etapes">',
        ...block.items.map(
          (item, index) =>
            `<li><span class="pastille">${item.icon === undefined ? index + 1 : iconSvg(item.icon, 20)}</span><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p></li>`,
        ),
        '</ol>',
        '</section>',
      ].join('')
    case 'team':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        '<ul class="grille equipe">',
        ...block.members.map(
          (member) =>
            `<li>${avatar(images, member.imageId, member.name)}<h3>${esc(member.name)}</h3><p class="role">${esc(member.role)}</p>${member.bio === undefined ? '' : `<p>${esc(member.bio)}</p>`}</li>`,
        ),
        '</ul>',
        '</section>',
      ].join('')
    case 'logos':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<p class="surtitre-centre">${esc(block.title)}</p>`,
        '<ul class="logos">',
        ...block.items.map((item) => {
          const chemin = item.imageId === undefined ? undefined : images.get(item.imageId)
          return `<li>${chemin === undefined ? `<span class="etiquette">${esc(item.name)}</span>` : `<img src="${chemin}" alt="${esc(item.name)}" loading="lazy">`}</li>`
        }),
        '</ul>',
        '</section>',
      ].join('')
    case 'contact': {
      const lignes: string[] = []
      if (block.email !== undefined) lignes.push(`<li>${iconSvg('mail', 18)}<a href="mailto:${esc(block.email)}">${esc(block.email)}</a></li>`)
      if (block.phone !== undefined) lignes.push(`<li>${iconSvg('phone', 18)}<a href="tel:${esc(block.phone.replace(/[^\d+]/g, ''))}">${esc(block.phone)}</a></li>`)
      if (block.address !== undefined) lignes.push(`<li>${iconSvg('pin', 18)}<span>${esc(block.address)}</span></li>`)
      if (block.hours !== undefined) lignes.push(`<li>${iconSvg('clock', 18)}<span>${esc(block.hours)}</span></li>`)
      return [
        '<section class="bloc contact">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        block.body === undefined ? '' : `<p>${esc(block.body)}</p>`,
        `<ul class="coordonnees">${lignes.join('')}</ul>`,
        '</section>',
      ].join('')
    }
    case 'video': {
      const src = videoEmbed(block.url)
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        src === null
          ? ''
          : `<div class="video"><iframe src="${src}" title="${esc(block.title ?? 'Vidéo')}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`,
        block.caption === undefined ? '' : `<p class="legende">${esc(block.caption)}</p>`,
        '</section>',
      ].join('')
    }
    case 'comparison':
      return [
        '<section class="bloc">',
        block.title === undefined ? '' : `<h2>${esc(block.title)}</h2>`,
        '<div class="tableau"><table>',
        `<thead><tr><th></th>${block.columns.map((column) => `<th>${esc(column)}</th>`).join('')}</tr></thead>`,
        `<tbody>${block.rows
          .map(
            (row) =>
              `<tr><th scope="row">${esc(row.label)}</th>${row.values
                .map((value) => {
                  const v = value.trim()
                  if (v === '✓' || v.toLowerCase() === 'oui') return `<td class="oui">${iconSvg('check', 18)}</td>`
                  if (v === '' || v === '—' || v === '-' || v.toLowerCase() === 'non') return '<td class="non">—</td>'
                  return `<td>${esc(value)}</td>`
                })
                .join('')}</tr>`,
          )
          .join('')}</tbody>`,
        '</table></div>',
        '</section>',
      ].join('')
    case 'banner':
      return [
        '<div class="bandeau">',
        `<span>${esc(block.text)}</span>`,
        block.label === undefined || (block.pageId === undefined && block.href === undefined)
          ? ''
          : `<a href="${block.pageId === undefined ? esc(block.href ?? '#') : `${block.pageId}.html`}">${esc(block.label)}</a>`,
        '</div>',
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
  const pairing = fontPairing(spec.theme.font)
  const police = fontStack(pairing.body)
  const policeTitres = fontStack(pairing.heading)
  /*
   * Les polices voyagent dans le dossier exporté, à côté des images : le site s'ouvre hors
   * ligne avec la même typographie qu'en ligne, sans rien demander à un tiers.
   */
  const declarations = fontFiles(spec.theme.font)
    .map(
      (font) => `@font-face {
  font-family: '${font.family}';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(fonts/${font.file}) format('woff2-variations');
}`,
    )
    .join('\n')

  return `/* Feuille de style de ${spec.name}, exportée par Evoliia.
   Les couleurs sont celles du thème choisi dans l'atelier. Tout est modifiable ici. */

${declarations}

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
h1, h2, h3 { font-family: ${policeTitres}; font-weight: ${pairing.headingWeight}; letter-spacing: ${pairing.headingTracking}; }
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
.intro { color: var(--discret); margin: -4px 0 16px; }
.surtitre { display: inline-block; margin: 0 0 12px; padding: 4px 12px; border: 1px solid currentColor; border-radius: 999px; font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; opacity: .85; }
.surtitre-centre { text-align: center; color: var(--discret); font-size: .8rem; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 16px; }
.pastille { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 999px; background: var(--primaire); color: #fff; font-weight: 600; font-size: .9rem; margin-bottom: 10px; }
.grille-liste { grid-template-columns: 1fr !important; }
.grille-liste li { display: grid; grid-template-columns: 36px 1fr; column-gap: 14px; }
.grille-liste li h3 { grid-column: 2; margin: 0; }
.grille-liste li p { grid-column: 2; }
.grille-liste .pastille { grid-row: 1 / span 2; }

.image-vide { aspect-ratio: 4 / 3; border-radius: var(--rayon); background: color-mix(in srgb, var(--primaire) 12%, var(--surface)); }
img.image-texte-visuel { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--rayon); }
.image-texte { display: grid; gap: 24px; align-items: center; }
@media (min-width: 700px) { .image-texte { grid-template-columns: 1fr 1fr; } .image-droite > :first-child { order: 2; } }

.galerie { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; grid-template-columns: repeat(2, 1fr); }
@media (min-width: 700px) { .galerie { grid-template-columns: repeat(3, 1fr); } }
.galerie img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--rayon); }
.legende { color: var(--discret); font-size: .9rem; margin: 6px 0 0; }

.temoignages blockquote { margin: 0; font-size: 1.05rem; line-height: 1.6; }
.temoignages blockquote::before { content: '“'; display: block; font-size: 2.4rem; line-height: 1; color: var(--primaire); }
.auteur { display: flex; align-items: center; gap: 10px; margin: 16px 0 0; }
.avatar { width: 44px; height: 44px; border-radius: 999px; object-fit: cover; flex: none; }
.avatar-initiales { display: inline-flex; align-items: center; justify-content: center; background: var(--primaire); color: #fff; font-weight: 600; font-size: .85rem; }
.equipe { text-align: center; }
.equipe .avatar { width: 72px; height: 72px; margin: 0 auto 8px; font-size: 1.2rem; }
.equipe .role { color: var(--primaire); font-weight: 600; font-size: .9rem; margin: 4px 0 8px; }

.etapes { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px; }
@media (min-width: 700px) { .etapes { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); } }
.etapes h3 { margin: 0 0 6px; font-size: 1.05rem; }
.etapes p { margin: 0; }

.logos { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 16px 32px; align-items: center; justify-content: center; }
.logos img { height: 36px; width: auto; opacity: .8; }
.etiquette { display: inline-block; padding: 8px 16px; border: 1px solid var(--discret); border-radius: 999px; font-weight: 600; font-size: .9rem; }

.coordonnees { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 10px; }
.coordonnees li { display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: var(--rayon); padding: 12px 16px; }
.coordonnees svg { color: var(--primaire); flex: none; }

.video { aspect-ratio: 16 / 9; border-radius: var(--rayon); overflow: hidden; background: #000; }
.video iframe { width: 100%; height: 100%; border: 0; }

.tableau { overflow-x: auto; background: var(--surface); border-radius: var(--rayon); }
.tableau table { width: 100%; min-width: 480px; border-collapse: collapse; }
.tableau th, .tableau td { padding: 12px 14px; text-align: center; border-top: 1px solid color-mix(in srgb, var(--texte) 10%, transparent); }
.tableau thead th { border-top: 0; }
.tableau th[scope=row] { text-align: left; font-weight: 500; }
.tableau .oui { color: var(--primaire); }
.tableau .non { color: var(--discret); }

.bandeau { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: center; background: var(--primaire); color: #fff; padding: 10px 20px; font-size: .9rem; margin: 0 0 24px; border-radius: var(--rayon); }
.bandeau a { color: var(--primaire); background: #fff; text-decoration: none; padding: 3px 10px; border-radius: 999px; font-weight: 600; font-size: .8rem; }

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
