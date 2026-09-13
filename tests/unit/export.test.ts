import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createZip } from '@/server/export/zip'
import { fileNameFor, renderPage, renderStylesheet } from '@/server/export/site'
import { DEMO_APPS } from '@/server/demos/catalog'
import { appSpecSchema } from '@/server/spec/schema'

/**
 * Export d'un projet.
 *
 * Le point qui décide de tout : l'archive produite doit s'ouvrir avec les outils du
 * système, pas seulement avec le code qui l'a écrite. Un écrivain de ZIP qui se relit
 * lui-même passerait tous les tests du monde en produisant un fichier que personne ne peut
 * décompresser. Les tests ci-dessous passent donc par `unzip`, qui ne connaît rien de notre
 * implémentation.
 *
 * Le second point : ce qui a besoin d'un serveur doit être signalé et non simulé. Un
 * formulaire exporté qui ressemblerait à un formulaire, sans rien enregistrer, tromperait
 * le créateur et ses visiteurs.
 */

const spec = appSpecSchema.parse(DEMO_APPS.find((demo) => demo.slug === 'devisflow')!.spec)

function unzipDisponible(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('archive', () => {
  it('produit une archive que le système sait ouvrir', () => {
    if (!unzipDisponible()) return

    const contenu = 'Bonjour, ceci est un fichier d’essai avec des accents : éàü.'
    const binaire = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))
    const archive = createZip([
      { path: 'LISEZMOI.md', content: contenu },
      { path: 'donnees/réponses.csv', content: '"a","b"\n"1","2"' },
      { path: 'images/photo.bin', content: binaire },
    ])

    const dossier = mkdtempSync(join(tmpdir(), 'export-'))
    const chemin = join(dossier, 'essai.zip')
    writeFileSync(chemin, archive)

    // -t vérifie les sommes de contrôle de chaque entrée : une archive mal écrite échoue ici.
    execFileSync('unzip', ['-t', chemin], { stdio: 'ignore' })
    execFileSync('unzip', ['-q', chemin, '-d', join(dossier, 'sortie')])

    expect(readFileSync(join(dossier, 'sortie', 'LISEZMOI.md'), 'utf8')).toBe(contenu)
    expect(readFileSync(join(dossier, 'sortie', 'images', 'photo.bin'))).toEqual(binaire)
    // Le nom accentué survit : c'est ce que garantit le drapeau UTF-8 du format.
    expect(readdirSync(join(dossier, 'sortie', 'donnees'))).toEqual(['réponses.csv'])
  })

  it('accepte une archive vide sans produire un fichier invalide', () => {
    const archive = createZip([])
    // Signature de fin de répertoire central : une archive vide reste une archive.
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50)
  })
})

describe('rendu statique', () => {
  it('nomme la page d’accueil index.html et les autres par leur chemin', () => {
    const accueil = spec.pages.find((page) => page.path === 'accueil')
    expect(accueil).toBeDefined()
    expect(fileNameFor(accueil!)).toBe('index.html')
    for (const page of spec.pages.filter((candidate) => candidate.path !== 'accueil')) {
      expect(fileNameFor(page)).toBe(`${page.path}.html`)
    }
  })

  it('produit une page complète, sans script', () => {
    const page = spec.pages[0]!
    const html = renderPage(spec, page, new Map())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<link rel="stylesheet" href="styles.css">')
    expect(html).toContain(`<title>${page.title}`)
    // Aucun script : une page exportée doit rester lisible et modifiable sans outil.
    expect(html).not.toContain('<script')
  })

  /*
   * La règle centrale de l'export. Un formulaire qui n'enregistre rien ne doit pas
   * ressembler à un formulaire : il doit dire ce qu'il faisait et ce qui lui manque.
   */
  it('signale les blocs qui avaient besoin d’un serveur, sans les simuler', () => {
    const dynamiques = ['recordForm', 'recordList', 'auth', 'assistant']
    for (const page of spec.pages) {
      const html = renderPage(spec, page, new Map())
      const aDesBlocsDynamiques = page.blocks.some((block) => dynamiques.includes(block.type))
      if (aDesBlocsDynamiques) {
        expect(html, page.title).toContain('bloc-serveur')
      }
      // Aucun champ de saisie nulle part : ce serait promettre une saisie sans destination.
      expect(html, page.title).not.toContain('<input')
      expect(html, page.title).not.toContain('<form')
    }
  })

  it('échappe le texte du créateur plutôt que de l’interpréter', () => {
    const piege = appSpecSchema.parse({
      ...spec,
      pages: [
        {
          ...spec.pages[0]!,
          blocks: [
            {
              id: 'essai',
              type: 'richText',
              title: '<script>alert(1)</script>',
              body: 'Un « et » commercial & un guillemet "',
            },
          ],
        },
      ],
      navigation: { style: 'topbar', items: [{ pageId: spec.pages[0]!.id, label: 'Accueil' }] },
    })
    const html = renderPage(piege, piege.pages[0]!, new Map())
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })

  it('reprend les couleurs du thème dans la feuille de style', () => {
    const css = renderStylesheet(spec)
    expect(css).toContain(spec.theme.colors.primary)
    expect(css).toContain(spec.theme.colors.background)
    expect(css).toContain('--rayon:')
  })
})
