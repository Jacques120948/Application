import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { detectFormat, humanSize, MAX_UPLOAD_BYTES, MAX_WIDTH } from '@/server/media/rules'

/**
 * Traitement des images téléversées.
 *
 * Ce qui est vérifié ici est une frontière de sécurité, pas un confort : un fichier est
 * accepté d'après ses octets et non d'après ce que le navigateur en dit, et ce qui ressort
 * du traitement ne transporte plus rien de ce que le fichier d'origine cachait.
 */

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 60, b: 90 } },
  })
    .png()
    .toBuffer()
}

describe('reconnaissance des formats', () => {
  it('reconnaît une vraie image à ses octets', async () => {
    expect(detectFormat(await png(20, 20))).toBe('png')
    expect(detectFormat(await sharp(await png(20, 20)).jpeg().toBuffer())).toBe('jpeg')
    expect(detectFormat(await sharp(await png(20, 20)).webp().toBuffer())).toBe('webp')
  })

  it('refuse un fichier qui se prétend image sans l’être', () => {
    const script = new TextEncoder().encode('<?php system($_GET["c"]); ?>')
    expect(detectFormat(script)).toBeNull()
  })

  it('ne se laisse pas prendre par un conteneur RIFF qui n’est pas une image', () => {
    // « RIFF » sert aussi pour l'audio WAVE : la seule signature de tête ne suffit pas.
    const wave = new Uint8Array(16)
    wave.set([0x52, 0x49, 0x46, 0x46], 0)
    wave.set([0x57, 0x41, 0x56, 0x45], 8)
    expect(detectFormat(wave)).toBeNull()
  })

  it('refuse un fichier vide ou trop court', () => {
    expect(detectFormat(new Uint8Array(0))).toBeNull()
    expect(detectFormat(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe('ce qui est stocké', () => {
  it('ne conserve rien des métadonnées du fichier d’origine', async () => {
    // Une photo de téléphone transporte la position GPS de l'endroit où elle a été prise.
    // La republier telle quelle révélerait l'adresse du créateur.
    const withExif = await sharp(await png(40, 40))
      .withExif({ IFD0: { Copyright: 'Jacques', Software: 'Appareil photo' } })
      .jpeg()
      .toBuffer()
    expect((await sharp(withExif).metadata()).exif).toBeDefined()

    const stored = await sharp(withExif).rotate().webp({ quality: 78 }).toBuffer()
    expect((await sharp(stored).metadata()).exif).toBeUndefined()
  })

  it('ramène une image trop large à la largeur maximale', async () => {
    const huge = await png(4000, 1000)
    const stored = await sharp(huge)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp()
      .toBuffer()
    expect((await sharp(stored).metadata()).width).toBe(MAX_WIDTH)
  })

  it('n’agrandit jamais une petite image', async () => {
    const small = await png(200, 150)
    const stored = await sharp(small)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp()
      .toBuffer()
    expect((await sharp(stored).metadata()).width).toBe(200)
  })

  it('produit un fichier nettement plus léger que l’original', async () => {
    const original = await png(1600, 1200)
    const stored = await sharp(original).resize({ width: MAX_WIDTH }).webp({ quality: 78 }).toBuffer()
    expect(stored.length).toBeLessThan(original.length)
  })

  it('refuse une image tronquée au lieu d’en deviner la fin', async () => {
    const complete = await sharp(await png(100, 100)).jpeg().toBuffer()
    const truncated = complete.subarray(0, Math.floor(complete.length / 2))
    await expect(
      sharp(truncated, { failOn: 'truncated' }).webp().toBuffer(),
    ).rejects.toThrow()
  })
})

describe('bornes annoncées', () => {
  it('plafonne le téléversement à une taille raisonnable pour un téléphone', () => {
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024)
  })

  it('écrit les tailles pour un lecteur, pas pour une machine', () => {
    expect(humanSize(512)).toBe('512 o')
    expect(humanSize(2048)).toBe('2 Ko')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 Mo')
  })
})
