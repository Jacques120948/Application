import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LONGUEURS, manques, MAXIMUMS } from '@/server/ads/redaction'

/**
 * Ce qu'on demande à Naya, et ce qu'on accepte d'elle.
 *
 * Le modèle sait formuler ; il ne sait pas compter. Un titre de trente et un caractères est
 * refusé par Google sans explication utile, et la personne le découvre trois jours plus
 * tard, quand son annonce ne diffuse pas. Tout ce qui est vérifié ici l'est pour éviter ce
 * silence-là.
 */

describe('les longueurs', () => {
  it('sont celles de Google, pas des approximations', () => {
    expect(LONGUEURS.titre).toBe(30)
    expect(LONGUEURS.description).toBe(90)
    expect(LONGUEURS['titre-long']).toBe(90)
  })
})

describe('ce qu’il manque', () => {
  it('se déduit du maximum moins l’existant', () => {
    /*
     * Demander quinze titres à une annonce qui en a neuf donnerait six textes utiles et
     * neuf à jeter, payés au même prix.
     */
    const existants = Array.from({ length: 9 }, () => ({ champ: 'titre' }))
    const liste = manques('annonces', existants, [])
    expect(liste.find((une) => une.champ === 'titre')?.combien).toBe(6)
  })

  it('compte les propositions en attente dans le remplissage', () => {
    /*
     * Sans cela, relancer la rédaction trois fois donnerait trois fois le même nombre de
     * textes pour les mêmes places, et la personne paierait trois appels pour en garder un.
     */
    const existants = Array.from({ length: 9 }, () => ({ champ: 'titre' }))
    const deja = Array.from({ length: 4 }, () => ({ champ: 'titre' }))
    expect(manques('annonces', existants, deja).find((une) => une.champ === 'titre')?.combien).toBe(2)
  })

  it('ne demande rien pour un contenant plein', () => {
    const existants = [
      ...Array.from({ length: 15 }, () => ({ champ: 'titre' })),
      ...Array.from({ length: 4 }, () => ({ champ: 'description' })),
    ]
    expect(manques('annonces', existants, [])).toEqual([])
  })

  it('ne propose pas de titre long à une campagne Recherche', () => {
    // Le champ n'existe pas dans une annonce responsive : en demander serait payer pour
    // des textes qui n'ont nulle part où aller.
    const liste = manques('annonces', [], [])
    expect(liste.map((une) => une.champ)).not.toContain('titre-long')
    expect(manques('elements', [], []).map((une) => une.champ)).toContain('titre-long')
  })

  it('borne le total demandé, même sur un contenant vide', () => {
    /*
     * Un groupe d'éléments vide appelle vingt-cinq textes. Au-delà d'une douzaine, la liste
     * se parcourt au lieu de se lire, et les derniers ne sont jamais retenus.
     */
    const total = manques('elements', [], []).reduce((somme, une) => somme + une.combien, 0)
    expect(total).toBeLessThanOrEqual(12)
    expect(total).toBeGreaterThan(0)
  })

  it('répartit entre les champs au lieu de remplir le premier', () => {
    /*
     * Servir les titres d'abord donnerait douze titres et aucune description — or un groupe
     * d'éléments sans description est refusé par Google. Ce qu'il faut demander n'est pas ce
     * qui manque le plus, c'est de quoi faire une annonce complète.
     */
    const liste = manques('elements', [], [])
    for (const champ of ['titre', 'titre-long', 'description']) {
      expect(liste.find((une) => une.champ === champ)?.combien).toBeGreaterThan(0)
    }
  })
})

describe('les maximums', () => {
  it('distinguent les deux genres de contenant', () => {
    expect(MAXIMUMS.annonces?.['titre-long']).toBe(0)
    expect(MAXIMUMS.annonces?.description).toBe(4)
    expect(MAXIMUMS.elements?.description).toBe(5)
  })
})

describe('la langue de la rédaction', () => {
  it('vient du ciblage de la campagne, pas de l’interface', () => {
    /*
     * La rédaction écrivait en français quoi qu'il arrive. Pour une boutique suisse qui sert
     * trois langues, c'est une faute qui ne se voit pas tout de suite : les titres sont bons,
     * ils sont simplement dans la mauvaise langue — et une annonce que son public ne comprend
     * pas consomme ses impressions sans être cliquée.
     */
    const source = readFileSync('src/server/ads/redaction.ts', 'utf8')
    expect(source).toContain('groupe.campagne.langue')
    expect(source).toContain('langue,')
  })

  it('retombe sur le français quand la campagne n’en déclare qu’aucune ou plusieurs', () => {
    // Un repli assumé : mieux vaut la langue du site qu'un choix au hasard.
    const source = readFileSync('src/server/ads/redaction.ts', 'utf8')
    expect(source).toContain("?? 'français'")
  })

  it('ne devine jamais la langue sur les mots', () => {
    /*
     * Tentant et faux : « quartz rose » et « quarzo rosa » se ressemblent assez pour tromper
     * une heuristique, et une campagne mal étiquetée écrit tout de travers. Google connaît
     * la réponse — la personne l'a posée dans le ciblage.
     */
    const source = readFileSync('src/server/ads/creatif.ts', 'utf8')
    expect(source).toContain('lireLanguesDesCampagnes')

    const lecture = readFileSync('src/server/ads/google-ads.ts', 'utf8')
    const corps = lecture.slice(lecture.indexOf('async function lireLanguesDesCampagnes'))
    expect(corps).toContain("campaign_criterion.type = 'LANGUAGE'")
    // Plusieurs langues : on ne rend rien plutôt que d'en choisir une.
    expect(corps).toContain('vues.size === 1')
  })
})
