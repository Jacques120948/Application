import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { autoriseTexte, TEXTES_PAR_JOUR } from '@/server/ads/garde-fous'
import { PROFIL_VIDE } from '@/server/ads/profil'

/**
 * Le dépôt d'un texte dans une annonce.
 *
 * Ce qui le rend délicat ne se devine pas : Google ne sait pas « ajouter un titre », il
 * remplace la liste entière. Une erreur ici n'ajoute pas un mauvais titre — elle efface les
 * quinze autres. Tout ce qui est vérifié ici l'est pour cette raison.
 */

function demande(champs: Partial<Parameters<typeof autoriseTexte>[0]> = {}) {
  return {
    mode: 'assiste',
    devise: 'CHF',
    profil: { ...PROFIL_VIDE },
    faitesAujourdhui: 0,
    textesAujourdhui: 0,
    ...champs,
  }
}

describe('les bornes d’un dépôt', () => {
  it('refusent un compte en lecture seule', () => {
    expect(autoriseTexte(demande({ mode: 'lecture' }), 'titre', 'Bougie citrine', 9).ok).toBe(false)
  })

  it('refusent un texte trop long, avec son compte exact', () => {
    const trop = 'a'.repeat(31)
    const verdict = autoriseTexte(demande(), 'titre', trop, 9)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('31')
  })

  it('refusent quand l’annonce est déjà pleine', () => {
    /*
     * Google refuserait l'écriture entière, et l'écriture entière porte les quinze titres
     * existants : un refus emporterait le dépôt et rien d'autre, mais l'erreur serait
     * incompréhensible. Mieux vaut le dire avant.
     */
    const verdict = autoriseTexte(demande(), 'titre', 'Bougie citrine', 15)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('15')
    expect(autoriseTexte(demande(), 'description', 'Une description.', 4).ok).toBe(false)
  })

  it('acceptent un texte correct dans une annonce qui a de la place', () => {
    expect(autoriseTexte(demande(), 'titre', 'Bougie Citrine Suisse', 9).ok).toBe(true)
    expect(autoriseTexte(demande(), 'description', 'Une description courte.', 2).ok).toBe(true)
  })

  it('bornent le nombre de dépôts par jour, mais largement', () => {
    /*
     * Bien plus haut que les gestes d'argent : ajouter un titre ne dépense rien. Cette
     * limite n'existe que pour arrêter une boucle, pas pour freiner quelqu'un qui remplit
     * ses annonces un samedi matin.
     */
    expect(TEXTES_PAR_JOUR).toBeGreaterThan(15)
    expect(autoriseTexte(demande({ textesAujourdhui: TEXTES_PAR_JOUR }), 'titre', 'x', 1).ok).toBe(
      false,
    )
  })

  it('ne connaissent que les titres et les descriptions', () => {
    expect(autoriseTexte(demande(), 'image', 'https://exemple.test/x.jpg', 1).ok).toBe(false)
    expect(autoriseTexte(demande(), 'mot-cle', 'bougie citrine', 1).ok).toBe(false)
  })
})

describe('la mécanique du dépôt', () => {
  it('relit l’annonce chez Google avant d’écrire', () => {
    /*
     * La propriété qui empêche d'effacer le travail de quelqu'un. Renvoyer la liste lue la
     * semaine dernière supprimerait tout ce qui a été ajouté dans Google Ads depuis.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    // Dans le corps de la fonction, et non dans le fichier : l'import du connecteur
    // d'écriture figure en tête, ce qui rendrait la comparaison sans objet.
    const corps = source.slice(source.indexOf('export async function deposerTexte'))
    const lecture = corps.indexOf('googleAds.lireAnnoncesDuGroupe')
    const ecriture = corps.indexOf('ecrireTextesAnnonce(')
    expect(lecture).toBeGreaterThan(0)
    expect(ecriture).toBeGreaterThan(lecture)
  })

  it('conserve la liste entière comme valeur d’avant', () => {
    /*
     * Plus verbeux qu'un seul texte, et c'est la condition du retour arrière : remettre la
     * liste d'avant remet aussi les épinglages, qu'un retrait naïf du dernier élément
     * aurait perdus.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('avant: { champ, textes: liste }')
  })

  it('refuse un contenant qui porte plusieurs annonces', () => {
    // Choisir à la place de la personne serait deviner ; les modifier toutes serait changer
    // plus qu'elle ne demande.
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('annonces.valeur.length > 1')
  })

  it('renvoie les épinglages plutôt que de les perdre', () => {
    const source = readFileSync('src/server/ads/google-ads-ecriture.ts', 'utf8')
    expect(source).toContain('pinnedField')
  })

  it('n’écrase pas une annonce modifiée depuis le dépôt', () => {
    /*
     * Le retour arrière remet la liste d'avant. Si quelqu'un a ajouté un texte entre-temps,
     * cette liste ne le contient pas : le remettre le supprimerait. On refuse.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('Cette annonce a changé depuis le dépôt')
  })
})
