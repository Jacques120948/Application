import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FRAICHEUR_CREA_MS, JOURS_TERMES } from '@/server/ads/creatif'
import { messageErreur } from '@/server/ads/google-ads'

/**
 * La frugalité de la lecture du créatif.
 *
 * Le plafond d'appels appartient au projet Google Cloud d'Evoliia et se partage entre tous
 * les comptes reliés. Une lecture de plus par nuit ne coûte rien à celui qui la déclenche et
 * coûte à tous les autres — c'est exactement le genre de dépense qui ne se voit dans aucun
 * écran jusqu'au jour où le plafond tombe.
 */

describe('le rythme du créatif', () => {
  it('se relit à la semaine, pas à la nuit', () => {
    const jour = 24 * 60 * 60 * 1000
    expect(FRAICHEUR_CREA_MS).toBeGreaterThanOrEqual(5 * jour)
    // Au-delà du mois, on travaillerait sur des annonces qui ont pu changer entre-temps.
    expect(FRAICHEUR_CREA_MS).toBeLessThanOrEqual(31 * jour)
  })

  it('regarde assez loin pour que la traîne des termes compte', () => {
    expect(JOURS_TERMES).toBeGreaterThanOrEqual(14)
  })

  it('tient en quatre appels par compte, quoi qu’il arrive', () => {
    /*
     * Trois pour le contenu — les annonces responsives, les mots-clés qui disent de quoi
     * parle chaque groupe, et les groupes d'éléments : Google ne les rend pas par la même
     * requête — et un pour les termes. Une boucle par campagne coûterait à tout le monde ce
     * qu'elle ferait gagner à un seul, sur un plafond partagé.
     */
    const source = readFileSync('src/server/ads/creatif.ts', 'utf8')
    expect(source).toContain('bilan.appels += 3')
    expect(source).toContain('bilan.appels += 1')
    expect(source.match(/googleAds\.lireCreatif\(/gu) ?? []).toHaveLength(1)
    expect(source.match(/googleAds\.lireTermes\(/gu) ?? []).toHaveLength(1)
  })

  it('rend les contenants et leurs morceaux d’une seule lecture', () => {
    /*
     * Un morceau sans son contenant n'a nulle part où aller. Les demander séparément
     * doublerait la consommation du plafond partagé pour la même information.
     */
    const provider = readFileSync('src/server/ads/provider.ts', 'utf8')
    expect(provider).toContain('groupes: GroupeAds[]; elements: ElementAds[]')
  })
})

describe('la garantie de lecture seule', () => {
  it('tient encore après l’ajout du créatif', () => {
    /*
     * Trois requêtes de plus dans le connecteur de lecture : c'est le moment où une
     * mutation s'y glisse par commodité. Le test relit le fichier entier.
     */
    const source = readFileSync('src/server/ads/google-ads.ts', 'utf8')
    for (const ecriture of [':mutate', 'mutateCampaign', 'campaignBudgets:mutate']) {
      expect(source).not.toContain(ecriture)
    }
    expect(source).toContain('FROM search_term_view')
    expect(source).toContain('FROM asset_group_asset')
    expect(source).toContain('FROM ad_group_ad')
    expect(source).toContain('FROM ad_group_criterion')
  })

  it('ne demande pas un champ que l’API refuse', () => {
    /*
     * `asset_group_asset.performance_label` est documenté et n'existe pas en v22 : Google
     * répond « Unrecognized field in the query » et toute la lecture du créatif échoue. Un
     * champ facultatif ne doit jamais faire tomber une requête entière, et ce contrôle
     * empêche qu'il revienne par recopie depuis la documentation.
     */
    const source = readFileSync('src/server/ads/google-ads.ts', 'utf8')
    expect(source).not.toContain('asset_group_asset.performance_label,')
  })
})

describe('les erreurs de Google', () => {
  it('sont lues dans les deux formes de réponse', () => {
    /*
     * `searchStream` échoue par lots et rend un tableau ; les autres points d'entrée rendent
     * un objet. Ne lire que l'objet ferait perdre la phrase qui nomme le champ fautif — et
     * il ne resterait qu'un message générique, sur lequel personne ne peut agir.
     */
    expect(messageErreur([{ error: { message: 'Request contains an invalid argument.' } }])).toBe(
      'Request contains an invalid argument.',
    )
    expect(messageErreur({ error: { message: 'Requête invalide.' } })).toBe('Requête invalide.')
  })

  it('descendent jusqu’au détail qui nomme le champ', () => {
    const charge = [
      {
        error: {
          message: 'Request contains an invalid argument.',
          details: [
            {
              errors: [{ message: "Unrecognized field in the query: 'asset_group_asset.x'." }],
            },
          ],
        },
      },
    ]
    expect(messageErreur(charge)).toContain('Unrecognized field')
    expect(messageErreur(charge)).toContain('Request contains an invalid argument.')
  })

  it('ne rendent rien plutôt que d’inventer', () => {
    expect(messageErreur(null)).toBe('')
    expect(messageErreur([])).toBe('')
    expect(messageErreur({ resultats: [] })).toBe('')
  })
})
