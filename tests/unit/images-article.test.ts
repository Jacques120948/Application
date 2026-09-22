import { afterEach, describe, expect, it } from 'vitest'
import { adressePubliqueUtilisable, consigneImage, IMAGES_PAR_JOUR } from '@/server/audit/images-article'

/**
 * La consigne envoyée au modèle, et les bornes de l'emballement.
 *
 * C'est la seule fonction du produit derrière laquelle il y a de l'argent qui sort du
 * compte d'Evoliia à chaque usage, et non du calcul déjà payé. Ce qui se vérifie ici sans
 * réseau, ce sont les interdits de la consigne : ils décident de ce qui pourra être publié
 * sur le blog d'un commerçant, sous sa responsabilité et pas sous la nôtre.
 */
describe('la consigne d’une image d’article', () => {
  const consigne = consigneImage('un atelier de fabrication de bougies')

  it('reprend le souhait tel quel', () => {
    expect(consigne).toContain('un atelier de fabrication de bougies')
  })

  /*
   * Un modèle qui écrit se trompe de langue et d'orthographe, et le client ne peut pas
   * corriger un mot peint dans un pixel.
   */
  it('interdit tout texte dans l’image', () => {
    expect(consigne).toContain('Aucun texte')
  })

  /* Une personne inventée sur le blog d'un commerçant fait croire à une photo d'équipe. */
  it('interdit les visages reconnaissables', () => {
    expect(consigne).toContain('Aucun visage humain reconnaissable')
  })

  /* Un logo inventé serait celui de quelqu'un d'autre. */
  it('interdit les logos et les marques', () => {
    expect(consigne).toContain('Aucun logo')
  })

  /*
   * Rien du contexte ne sort : ni le sujet de l'article, ni le nom du site, ni ce que
   * l'analyse reproche au contenu. Ce qui n'a pas besoin de sortir ne sort pas.
   */
  it('n’emporte que le souhait, et rien du travail en cours', () => {
    expect(consigne.toLowerCase()).not.toContain('evoliia')
    expect(consigne.toLowerCase()).not.toContain('article sur')
    expect(consigne.length).toBeLessThan(500)
  })
})

describe('le plafond journalier', () => {
  /*
   * Il ne borne pas une dépense — le quota mensuel et les crédits s'en chargent — mais un
   * emballement : une boucle qui partirait seule. Un article compte trois à cinq sections,
   * et personne n'écrit dix articles par jour à la main.
   */
  it('laisse passer plusieurs articles par jour, jamais une boucle', () => {
    expect(IMAGES_PAR_JOUR).toBeGreaterThanOrEqual(6)
    expect(IMAGES_PAR_JOUR).toBeLessThanOrEqual(20)
  })
})

/**
 * L'adresse à laquelle l'image sera servie.
 *
 * Une image créée n'a de valeur que si deux tiers peuvent aller la chercher : le lecteur du
 * blog, et Shopify quand il la copie dans la boutique. Une variable d'environnement oubliée
 * au déploiement produirait des images bel et bien facturées et parfaitement inaccessibles,
 * sans que rien ne dise pourquoi — la pire forme de panne, celle qui coûte et se tait.
 */
describe('l’adresse publique', () => {
  const initial = process.env.APP_URL

  afterEach(() => {
    if (initial === undefined) delete process.env.APP_URL
    else process.env.APP_URL = initial
  })

  it('refuse localhost, qu’aucun tiers ne sait joindre', () => {
    process.env.APP_URL = 'http://localhost:3000'
    expect(adressePubliqueUtilisable()).toBe(false)
    process.env.APP_URL = 'https://127.0.0.1'
    expect(adressePubliqueUtilisable()).toBe(false)
  })

  it('refuse une adresse en clair : Shopify n’ira pas la chercher', () => {
    process.env.APP_URL = 'http://evoliia.com'
    expect(adressePubliqueUtilisable()).toBe(false)
  })

  it('refuse une variable absente ou illisible', () => {
    process.env.APP_URL = ''
    expect(adressePubliqueUtilisable()).toBe(false)
    process.env.APP_URL = 'pas-une-adresse'
    expect(adressePubliqueUtilisable()).toBe(false)
  })

  it('accepte l’adresse de production', () => {
    process.env.APP_URL = 'https://evoliia.com'
    expect(adressePubliqueUtilisable()).toBe(true)
  })
})
