import { describe, expect, it } from 'vitest'
import { DEFAULT_ACTION_COSTS } from '@/server/billing/action-costs'
import { phraseVolumes, volumes } from '@/server/billing/volumes-offre'

/**
 * Traduire une réserve de crédits en choses reconnaissables.
 *
 * Tout l'intérêt de cette traduction est qu'on puisse s'y fier, et toute sa dangerosité
 * aussi : « 30 articles » se lit comme un engagement là où « 600 crédits » ne se lit comme
 * rien. Les règles protégées ici ne sont donc pas des préférences d'affichage.
 */
describe('les volumes d’une offre', () => {
  it('divise par le haut de la fourchette, jamais par le bas', () => {
    /*
     * Un article coûte 8 à 20 crédits. 600 / 8 = 75 serait vrai dans le meilleur cas et
     * faux dans tous les autres ; 600 / 20 = 30 est le nombre qu'on tient toujours. Ce
     * test est le seul rempart contre la tentation d'annoncer le nombre flatteur.
     */
    const article = volumes(600, DEFAULT_ACTION_COSTS).find((ligne) => ligne.id === 'article')
    expect(article?.combien).toBe(30)
  })

  it('ne montre jamais plus de trois repères', () => {
    expect(volumes(100_000, DEFAULT_ACTION_COSTS).length).toBeLessThanOrEqual(3)
  })

  it('tait ce que la réserve ne couvre pas entièrement', () => {
    // Cinq crédits n'écrivent pas un article à vingt. Annoncer « 0 article » serait pire
    // que le silence.
    expect(volumes(5, DEFAULT_ACTION_COSTS).map((ligne) => ligne.id)).not.toContain('article')
  })

  it('ne rend rien pour une réserve vide', () => {
    expect(volumes(0, DEFAULT_ACTION_COSTS)).toEqual([])
    expect(phraseVolumes(0, DEFAULT_ACTION_COSTS)).toBe('')
  })

  it('se tait quand le catalogue des coûts est illisible', () => {
    // La page de tarifs perd une ligne, pas son prix.
    expect(phraseVolumes(600, [])).toBe('')
  })

  it('accorde le nom au nombre', () => {
    const un = volumes(20, DEFAULT_ACTION_COSTS).find((ligne) => ligne.id === 'article')
    expect(un?.combien).toBe(1)
    expect(un?.label).toBe('article')
    const plusieurs = volumes(600, DEFAULT_ACTION_COSTS).find((ligne) => ligne.id === 'article')
    expect(plusieurs?.label).toBe('articles')
  })

  /**
   * Le « ou » est la moitié de l'honnêteté de cette phrase : c'est la même réserve qui se
   * dépense, et une liste sans conjonction se lit comme un cumul.
   */
  it('dit que les volumes ne se cumulent pas', () => {
    const phrase = phraseVolumes(600, DEFAULT_ACTION_COSTS)
    expect(phrase).toContain(' ou ')
    expect(phrase).toContain('au choix')
  })

  it('annonce « environ », jamais un compte exact', () => {
    expect(phraseVolumes(600, DEFAULT_ACTION_COSTS)).toContain('environ')
  })

  /**
   * Les fourchettes viennent du back-office. Doubler un prix doit diviser le volume
   * annoncé, sinon un écran promettrait ce qu'un autre facture au double.
   */
  it('suit les fourchettes réglées, sans rien écrire en dur', () => {
    const chers = DEFAULT_ACTION_COSTS.map((cout) =>
      cout.id === 'article' ? { ...cout, max: cout.max * 2 } : cout,
    )
    const article = volumes(600, chers).find((ligne) => ligne.id === 'article')
    expect(article?.combien).toBe(15)
  })
})
