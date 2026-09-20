import { describe, expect, it } from 'vitest'
import {
  chercherMention,
  classerSentiment,
  formesDuNom,
  REPETITIONS,
} from '@/server/audit/visibilite-ia'

/**
 * Savoir si une marque sort dans un assistant.
 *
 * L'erreur qui compte ici n'est pas symétrique. Annoncer une absence qui n'en est pas
 * envoie quelqu'un corriger ce qui marche déjà — c'est la plus chère des deux, et c'est
 * celle qu'on protège : un assistant écrit « Cap-Nature », « Cap Nature » ou
 * « cap-nature.ch » selon son humeur, et ne chercher qu'une seule forme raterait les autres.
 */

describe('les formes sous lesquelles une marque apparaît', () => {
  it('accepte le domaine, la racine, et la racine sans tiret', () => {
    const formes = formesDuNom('cap-nature.ch', 'Cap-Nature')
    expect(formes).toContain('cap-nature.ch')
    expect(formes).toContain('cap-nature')
    expect(formes).toContain('cap nature')
  })

  it('ignore « www. », que personne n’écrit dans une réponse', () => {
    expect(formesDuNom('www.cap-nature.ch', 'Cap-Nature')).toContain('cap-nature.ch')
  })

  it('écarte les formes trop courtes, qui sortiraient partout', () => {
    /*
     * Une racine de trois lettres se retrouve dans des dizaines de mots ordinaires. La
     * retenir ferait compter des mentions qui n'en sont pas — l'autre erreur, celle qui
     * fait croire qu'on est visible.
     */
    const formes = formesDuNom('abc.ch', 'ABC')
    expect(formes).not.toContain('abc')
  })
})

describe('trouver la marque dans une réponse d’assistant', () => {
  const FORMES = formesDuNom('cap-nature.ch', 'Cap-Nature')

  it('la trouve quelle que soit la façon dont l’assistant l’écrit', () => {
    expect(chercherMention('Je recommande Cap-Nature pour cela.', FORMES).mentionne).toBe(true)
    expect(chercherMention('Regardez Cap Nature, en Suisse.', FORMES).mentionne).toBe(true)
    expect(chercherMention('Voir cap-nature.ch pour la gamme.', FORMES).mentionne).toBe(true)
    expect(chercherMention('CAP-NATURE propose des bougies.', FORMES).mentionne).toBe(true)
  })

  it('rend le passage, pour que la personne vérifie elle-même', () => {
    const trouve = chercherMention(
      'Plusieurs marques existent. Cap-Nature travaille la cire végétale. D’autres aussi.',
      FORMES,
    )
    expect(trouve.extrait).toContain('Cap-Nature travaille la cire végétale')
    // L'extrait vient du texte d'origine : accents et majuscules compris.
    expect(trouve.extrait).not.toContain('cap nature')
  })

  it('ne trouve rien quand il n’y a rien', () => {
    const trouve = chercherMention('Je recommande une autre boutique suisse.', FORMES)
    expect(trouve.mentionne).toBe(false)
    expect(trouve.extrait).toBe('')
  })
})

describe('le ton de la mention', () => {
  it('reconnaît une citation favorable', () => {
    expect(classerSentiment('Cap-Nature est une référence pour la qualité artisanale.')).toBe('bon')
  })

  it('reconnaît une réserve', () => {
    expect(classerSentiment('Cap-Nature est cher par rapport aux autres.')).toBe('reserve')
  })

  it('reste neutre quand les deux se croisent ou qu’aucun ne parle', () => {
    expect(classerSentiment('Cap-Nature propose une qualité reconnue mais reste cher.')).toBe(
      'neutre',
    )
    expect(classerSentiment('Cap-Nature vend des bougies.')).toBe('neutre')
  })
})

describe('la méthode de mesure', () => {
  it('pose chaque question plus d’une fois', () => {
    /*
     * La règle qui rend le chiffre honnête. Une réponse d'assistant n'est pas
     * déterministe : la même question posée deux fois donne deux réponses, et une seule
     * lecture ne prouverait rien — ni la présence, ni l'absence.
     */
    expect(REPETITIONS).toBeGreaterThan(1)
  })
})
