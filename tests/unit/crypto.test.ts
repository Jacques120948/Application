import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, secretHint } from '@/lib/crypto'

/**
 * Ces secrets appartiennent aux créateurs, pas à la plateforme. Une régression ici
 * donnerait accès au compte Google ou Stripe de quelqu'un d'autre.
 */
describe('chiffrement des secrets', () => {
  const secret = 'ya29.un-jeton-oauth-de-demonstration-0123456789'

  it('rend le secret d’origine', () => {
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('ne stocke jamais le secret en clair', () => {
    expect(encryptSecret(secret)).not.toContain('ya29')
  })

  it('produit un résultat différent à chaque chiffrement', () => {
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret))
  })

  it('refuse un texte modifié plutôt que de rendre une valeur fausse', () => {
    const stored = encryptSecret(secret)
    const parts = stored.split('.')
    const altered = [parts[0], parts[1], parts[2], `${parts[3]}AA`].join('.')
    expect(() => decryptSecret(altered)).toThrow()
  })

  it('refuse un format inconnu', () => {
    expect(() => decryptSecret('pas-un-secret')).toThrow()
    expect(() => decryptSecret('v2.a.b.c')).toThrow()
  })

  it('montre assez de la clé pour la reconnaître, pas assez pour la réutiliser', () => {
    expect(secretHint('sk_live_abcdefghijklmnop')).toBe('••••mnop')
    expect(secretHint('abc')).toBe('••••')
  })
})
