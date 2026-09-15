import { describe, expect, it } from 'vitest'
import { appSpecSchema } from '@/server/spec/schema'
import { DEMO_APPS } from '@/server/demos/catalog'
import { appScope, buildManifest, iconSvg, initials, isIconSize } from '@/server/runtime/pwa'

/**
 * Installation depuis le navigateur.
 *
 * Ce qui est vérifié : qu'une application installée reste la sienne — sa portée, son nom,
 * ses couleurs — et qu'aucune donnée fournie par l'assistant ne puisse ressortir en code
 * dans l'icône, qui est le seul endroit de la chaîne où du texte devient du balisage.
 */

const spec = appSpecSchema.parse(DEMO_APPS[0]!.spec)

describe('portée', () => {
  it('enferme chaque application sous son propre chemin', () => {
    expect(appScope('/a/devisflow')).toBe('/a/devisflow/')
    const manifest = buildManifest(spec, '/a/devisflow')
    expect(manifest.scope).toBe('/a/devisflow/')
    expect(manifest.start_url).toBe('/a/devisflow/')
    // Installer une application ne doit jamais en installer une autre, ni Evoliia.
    for (const icon of manifest.icons) expect(icon.src.startsWith('/a/devisflow/')).toBe(true)
  })

  /*
   * Sur son adresse propre, l'application occupe la racine du sous-domaine : c'est lui qui
   * l'isole, et une portée `/a/<nom-court>/` y désignerait des pages qui n'existent pas.
   */
  it('occupe la racine quand l’application a son propre sous-domaine', () => {
    expect(appScope('')).toBe('/')
    const manifest = buildManifest(spec, '')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBe('/')
    for (const icon of manifest.icons) expect(icon.src.startsWith('/icone/')).toBe(true)
  })

  it('reprend les couleurs et la langue de l’application', () => {
    const manifest = buildManifest(spec, '/a/devisflow')
    expect(manifest.theme_color).toBe(spec.theme.colors.primary)
    expect(manifest.background_color).toBe(spec.theme.colors.background)
    expect(manifest.lang).toBe(spec.locale)
    expect(manifest.display).toBe('standalone')
  })

  it('raccourcit le nom affiché sous l’icône', () => {
    const long = { ...spec, name: 'Une application au nom interminable' }
    expect(buildManifest(long, '/a/x').short_name.length).toBeLessThanOrEqual(12)
  })

  it('fournit une icône adaptative en plus des icônes ordinaires', () => {
    const purposes = buildManifest(spec, '/a/x').icons.map((icon) => icon.purpose)
    expect(purposes).toContain('maskable')
    expect(purposes).toContain('any')
  })
})

describe('initiales', () => {
  it('prend les premières lettres des mots qui portent le sens', () => {
    expect(initials('DevisFlow')).toBe('DE')
    expect(initials('Le Carnet du Boulanger')).toBe('CB')
    expect(initials('Fiches d’Artisan')).toBe('FA')
  })

  it('se débrouille avec un nom d’un seul mot ou très court', () => {
    expect(initials('Bookizy')).toBe('BO')
    expect(initials('A')).toBe('A')
  })
})

describe('icône', () => {
  it('n’insère jamais le nom tel quel dans le dessin', () => {
    // Le nom vient de l'assistant : il ne doit pas pouvoir devenir du balisage.
    const hostile = { ...spec, name: '</text><script>alert(1)</script>' }
    const svg = iconSvg(hostile, 512, false)
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('</text><script')
  })

  it('réserve la marge découpée par les icônes adaptatives', () => {
    const plain = iconSvg(spec, 512, false)
    const padded = iconSvg(spec, 512, true)
    expect(plain).toContain('x="0" y="0"')
    expect(padded).not.toContain('x="0" y="0"')
  })

  it('n’accepte que les tailles servies', () => {
    expect(isIconSize(192)).toBe(true)
    expect(isIconSize(512)).toBe(true)
    expect(isIconSize(4096)).toBe(false)
  })
})
