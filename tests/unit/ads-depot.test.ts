import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  autoriseImage,
  autoriseTexte,
  IMAGES_PAR_CHAMP,
  TEXTES_PAR_JOUR,
} from '@/server/ads/garde-fous'
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
    expect(autoriseTexte(demande({ mode: 'lecture' }), 'annonces', 'titre', 'Bougie citrine', 9).ok).toBe(false)
  })

  it('refusent un texte trop long, avec son compte exact', () => {
    const trop = 'a'.repeat(31)
    const verdict = autoriseTexte(demande(), 'annonces', 'titre', trop, 9)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('31')
  })

  it('refusent quand l’annonce est déjà pleine', () => {
    /*
     * Google refuserait l'écriture entière, et l'écriture entière porte les quinze titres
     * existants : un refus emporterait le dépôt et rien d'autre, mais l'erreur serait
     * incompréhensible. Mieux vaut le dire avant.
     */
    const verdict = autoriseTexte(demande(), 'annonces', 'titre', 'Bougie citrine', 15)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('15')
    expect(autoriseTexte(demande(), 'annonces', 'description', 'Une description.', 4).ok).toBe(false)
  })

  it('acceptent un texte correct dans une annonce qui a de la place', () => {
    expect(autoriseTexte(demande(), 'annonces', 'titre', 'Bougie Citrine Suisse', 9).ok).toBe(true)
    expect(autoriseTexte(demande(), 'annonces', 'description', 'Une description courte.', 2).ok).toBe(true)
  })

  it('bornent le nombre de dépôts par jour, mais largement', () => {
    /*
     * Bien plus haut que les gestes d'argent : ajouter un titre ne dépense rien. Cette
     * limite n'existe que pour arrêter une boucle, pas pour freiner quelqu'un qui remplit
     * ses annonces un samedi matin.
     */
    expect(TEXTES_PAR_JOUR).toBeGreaterThan(15)
    expect(autoriseTexte(demande({ textesAujourdhui: TEXTES_PAR_JOUR }), 'annonces', 'titre', 'x', 1).ok).toBe(
      false,
    )
  })

  it('ne connaissent que les titres et les descriptions', () => {
    expect(autoriseTexte(demande(), 'annonces', 'image', 'https://exemple.test/x.jpg', 1).ok).toBe(false)
    expect(autoriseTexte(demande(), 'annonces', 'mot-cle', 'bougie citrine', 1).ok).toBe(false)
  })
})

describe('les deux genres de contenant', () => {
  it('n’ont pas les mêmes places', () => {
    /*
     * Une annonce responsive accepte quatre descriptions, un groupe d'éléments cinq. Prendre
     * les bornes de l'un pour l'autre ferait refuser un dépôt légitime — ou pire, en
     * laisserait partir un que Google rejetterait.
     */
    expect(autoriseTexte(demande(), 'annonces', 'description', 'Une description.', 4).ok).toBe(false)
    expect(autoriseTexte(demande(), 'elements', 'description', 'Une description.', 4).ok).toBe(true)
  })

  it('n’acceptent pas les mêmes champs', () => {
    // Le titre long n'existe pas dans une annonce responsive.
    expect(autoriseTexte(demande(), 'annonces', 'titre-long', 'Un titre long.', 0).ok).toBe(false)
    expect(autoriseTexte(demande(), 'elements', 'titre-long', 'Un titre long.', 0).ok).toBe(true)
  })
})

describe('les bornes d’un dépôt d’image', () => {
  it('refusent un compte en lecture seule', () => {
    /*
     * Ce verrou-là manquait : `deposerPhoto` comptait les places et les dépôts du jour, mais
     * ne regardait jamais le mode du compte. Relier un compte n'est pas consentir à ce qu'on
     * y dépose des images.
     */
    expect(autoriseImage(demande({ mode: 'lecture' }), 0, 'paysage').ok).toBe(false)
  })

  it('comptent les places format par format', () => {
    /*
     * Vingt images ne veut pas dire vingt en tout. Google tient une limite par format, et il
     * la vérifie au rattachement — donc après avoir créé l'image. Compter tous les formats
     * ensemble laissait partir une création que le rattachement refusait ensuite, et l'image
     * restait dans le compte sans rien à quoi être rattachée.
     */
    expect(IMAGES_PAR_CHAMP).toBe(20)
    const verdict = autoriseImage(demande(), IMAGES_PAR_CHAMP, 'paysage')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.raison).toContain('paysage')
    expect(autoriseImage(demande(), IMAGES_PAR_CHAMP - 1, 'paysage').ok).toBe(true)
  })

  it('bornent les dépôts du jour comme les textes', () => {
    expect(autoriseImage(demande({ textesAujourdhui: TEXTES_PAR_JOUR }), 0, 'carré').ok).toBe(false)
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

  it('rattache au lieu de remplacer dans un groupe d’éléments', () => {
    /*
     * Le chemin le plus sûr des deux : l'élément est créé seul puis rattaché. Rien n'est
     * remplacé, donc rien ne peut être effacé par mégarde — et le retour arrière détache au
     * lieu de réécrire une liste.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('creerTexteElement')
    expect(source).toContain('rattacherElement')
    expect(source).toContain('detacherElement')
  })

  it('garde la poignée du rattachement, sans laquelle on ne peut rien détacher', () => {
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('rattache: true, rattachement')
  })

  it('refuse un contenant qui porte plusieurs annonces', () => {
    // Choisir à la place de la personne serait deviner ; les modifier toutes serait changer
    // plus qu'elle ne demande.
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).toContain('annonces.valeur.length > 1')
  })

  it('compte la place chez Google avant de créer un élément', () => {
    /*
     * La leçon d'un vrai refus. Google vérifie ses limites au rattachement, c'est-à-dire
     * après la création de l'élément : un rattachement refusé laisse un orphelin dans le
     * compte, que l'API ne sait pas supprimer. Compter d'abord est la seule prévention.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    for (const depart of ['async function deposerDansElements', 'export async function deposerPhoto']) {
      const corps = source.slice(source.indexOf(depart))
      const compte = corps.indexOf('placesChezGoogle(')
      const creation = corps.search(/creer(Texte|Image)Element\(/u)
      expect(compte).toBeGreaterThan(0)
      expect(creation).toBeGreaterThan(compte)
    }
  })

  it('ne compte pas les images dans notre base', () => {
    /*
     * Notre base est relue une fois par semaine : entre-temps, quelqu'un a pu ajouter des
     * images depuis Google Ads. Un comptage local dirait « il reste de la place » et Google
     * refuserait — après avoir créé l'image.
     */
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    expect(source).not.toContain("champ: 'image' }")
  })

  it('n’envoie rien quand la place n’a pas pu être vérifiée', () => {
    // Écrire à l'aveugle faute d'avoir pu compter serait exactement le geste que ce
    // comptage existe pour empêcher.
    const source = readFileSync('src/server/ads/actions.ts', 'utf8')
    const corps = source.slice(source.indexOf('async function placesChezGoogle'))
    expect(corps).toContain('if (!comptes.ok)')
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
