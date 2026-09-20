import { describe, expect, it, vi } from 'vitest'
import { creerEtat, lireEtat } from '@/server/integrations/oauth'
import { choisirPropriete, occasions, retenirPourArticle } from '@/server/audit/recherches'
import type { Ligne, Propriete } from '@/server/integrations/providers/google-search-console'
import { nomDuPays } from '@/lib/pays'
import { ARTICLE_FORME, articleSchema } from '@/server/ai/schemas'
import { SEUILS_REDACTION } from '@/server/audit/checks/geo'

/**
 * L'aller-retour OAuth et la lecture des chiffres de recherche.
 *
 * Deux sujets, et le premier porte toute la sécurité de l'étape. Une autorisation se déroule
 * en deux temps : Evoliia envoie la personne chez Google, Google la renvoie avec un code.
 * Entre les deux, rien d'autre que le paramètre `state` ne garantit que celui qui revient
 * est celui qui est parti — et un `state` qui ne prouve rien vaut exactement l'absence de
 * `state`. C'est ce qui est vérifié ici, pas la mise en forme d'un tableau.
 */

const UTILISATEUR = '11111111-1111-4111-8111-111111111111'
const AUTRE = '22222222-2222-4222-8222-222222222222'

describe("l'état d'une autorisation", () => {
  it('rend ce qui y a été mis', () => {
    const etat = lireEtat(creerEtat(UTILISATEUR, 'google-search-console'))
    expect(etat?.userId).toBe(UTILISATEUR)
    expect(etat?.providerId).toBe('google-search-console')
  })

  it('distingue deux demandes identiques', () => {
    expect(creerEtat(UTILISATEUR, 'google-search-console')).not.toBe(
      creerEtat(UTILISATEUR, 'google-search-console'),
    )
  })

  it("refuse un état dont la charge a été modifiée", () => {
    const jeton = creerEtat(UTILISATEUR, 'google-search-console')
    const [charge, signature] = jeton.split('.')
    // On remplace l'identifiant par un autre et on garde la signature d'origine.
    const forge = Buffer.from(
      JSON.stringify({
        userId: AUTRE,
        providerId: 'google-search-console',
        nonce: 'x',
        expire: Date.now() + 60_000,
      }),
      'utf8',
    ).toString('base64url')
    expect(charge).not.toBe(forge)
    expect(lireEtat(`${forge}.${signature ?? ''}`)).toBeNull()
  })

  it('refuse une signature absente ou fantaisiste', () => {
    const jeton = creerEtat(UTILISATEUR, 'google-search-console')
    const charge = jeton.slice(0, jeton.lastIndexOf('.'))
    expect(lireEtat(charge)).toBeNull()
    expect(lireEtat(`${charge}.pas-une-signature`)).toBeNull()
    expect(lireEtat('')).toBeNull()
  })

  it('refuse un état périmé', () => {
    const jeton = creerEtat(UTILISATEUR, 'google-search-console')
    vi.useFakeTimers()
    try {
      // Onze minutes plus tard : la validité est de dix.
      vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000))
      expect(lireEtat(jeton)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('le rapprochement avec une propriété Search Console', () => {
  const propriete = (siteUrl: string, permission = 'siteOwner'): Propriete => ({
    siteUrl,
    permission,
  })

  it('préfère la propriété de domaine au préfixe', () => {
    const choisie = choisirPropriete('https://exemple.ch', [
      propriete('https://exemple.ch/'),
      propriete('sc-domain:exemple.ch'),
    ])
    expect(choisie).toBe('sc-domain:exemple.ch')
  })

  it('ignore le « www. » des deux côtés', () => {
    expect(choisirPropriete('https://www.exemple.ch', [propriete('sc-domain:exemple.ch')])).toBe(
      'sc-domain:exemple.ch',
    )
    expect(choisirPropriete('https://exemple.ch', [propriete('https://www.exemple.ch/')])).toBe(
      'https://www.exemple.ch/',
    )
  })

  it('ne rapproche pas un autre domaine', () => {
    expect(
      choisirPropriete('https://exemple.ch', [
        propriete('sc-domain:autre.ch'),
        propriete('https://exemple.com/'),
      ]),
    ).toBeNull()
  })

  it('ne rapproche rien quand le compte ne suit aucun site', () => {
    expect(choisirPropriete('https://exemple.ch', [])).toBeNull()
  })
})

describe('les pages à portée de la première page', () => {
  const ligne = (cle: string, position: number, impressions: number, clics = 0): Ligne => ({
    cle,
    position,
    impressions,
    clics,
  })

  it('ne retient que la deuxième page', () => {
    const retenues = occasions([
      ligne('https://exemple.ch/haut', 4.2, 500),
      ligne('https://exemple.ch/page-deux', 12.4, 300),
      ligne('https://exemple.ch/loin', 34.1, 800),
    ])
    expect(retenues.map((occasion) => occasion.cle)).toEqual(['https://exemple.ch/page-deux'])
  })

  it('écarte ce qui est trop peu vu pour vouloir dire quelque chose', () => {
    expect(occasions([ligne('https://exemple.ch/rare', 14, 3)])).toEqual([])
  })

  it('classe par affichages, et non par clics', () => {
    const retenues = occasions([
      ligne('https://exemple.ch/a', 11.2, 100, 9),
      ligne('https://exemple.ch/b', 19.8, 900, 1),
    ])
    expect(retenues.map((occasion) => occasion.cle)).toEqual([
      'https://exemple.ch/b',
      'https://exemple.ch/a',
    ])
  })

  it('laisse la dixième place tranquille : elle est en première page', () => {
    expect(occasions([ligne('https://exemple.ch/dixieme', 10.4, 400)])).toEqual([])
  })
})

describe('ce que le rédacteur reçoit', () => {
  const ligne = (cle: string, position: number, impressions: number, clics = 0) => ({
    cle,
    position,
    impressions,
    clics,
  })

  it('met la deuxième page devant les plus cliquées', () => {
    /*
     * Une recherche où le site sort en page 2 vaut mieux qu'une où il est premier : sur la
     * première, un article peut gagner des places ; sur la seconde, il n'y a rien à gagner.
     */
    const retenues = retenirPourArticle({
      occasionsDeRequetes: [ligne('bougie pierre', 13.1, 400)],
      requetes: [ligne('cap nature', 1.2, 900, 700)],
    })
    expect(retenues.map((r) => r.requete)).toEqual(['bougie pierre', 'cap nature'])
  })

  it('ne donne pas deux fois la même recherche', () => {
    // Une requête de page 2 figure aussi dans la liste générale : elle ne compte qu'une fois.
    const retenues = retenirPourArticle({
      occasionsDeRequetes: [ligne('bougie pierre', 13.1, 400)],
      requetes: [ligne('bougie pierre', 13.1, 400), ligne('autre', 2, 10)],
    })
    expect(retenues.map((r) => r.requete)).toEqual(['bougie pierre', 'autre'])
  })

  it('reprend les chiffres tels quels, sans en fabriquer', () => {
    const [premiere] = retenirPourArticle({
      occasionsDeRequetes: [ligne('bougie pierre', 13.1, 400, 7)],
      requetes: [],
    })
    expect(premiere).toEqual({ requete: 'bougie pierre', position: 13.1, impressions: 400, clics: 7 })
  })

  it('borne ce qui part chez le rédacteur', () => {
    const beaucoup = Array.from({ length: 40 }, (_, rang) => ligne(`requete ${rang}`, 12, 100))
    expect(retenirPourArticle({ occasionsDeRequetes: beaucoup, requetes: beaucoup })).toHaveLength(12)
  })

  it('ne rend rien quand il n’y a rien : l’article s’écrira sans', () => {
    expect(retenirPourArticle({ occasionsDeRequetes: [], requetes: [] })).toEqual([])
  })
})

describe('les noms de pays', () => {
  it('traduit les codes à trois lettres de Google', () => {
    expect(nomDuPays('che', 'fr')).toBe('Suisse')
    expect(nomDuPays('ita', 'fr')).toBe('Italie')
    expect(nomDuPays('deu', 'fr')).toBe('Allemagne')
    expect(nomDuPays('usa', 'fr')).toBe('États-Unis')
  })

  it('suit la langue demandée', () => {
    expect(nomDuPays('che', 'en')).toBe('Switzerland')
  })

  it('accepte la casse et les espaces, puisque le code vient d’une adresse', () => {
    expect(nomDuPays('  ITA  ', 'fr')).toBe('Italie')
  })

  it('nomme l’origine inconnue plutôt que de la taire', () => {
    // Google rend « zzz » quand il n'a pas su déterminer d'où venait l'affichage.
    expect(nomDuPays('zzz', 'fr')).toBe('Origine inconnue')
    expect(nomDuPays('', 'fr')).toBe('Origine inconnue')
  })

  it('montre le code plutôt que rien quand il ne le connaît pas', () => {
    // Une ligne manquante fausserait un total sans que personne ne le voie.
    expect(nomDuPays('xyz', 'fr')).toBe('XYZ')
  })

  it('couvre les pays que Google peut rendre', () => {
    // La table vient d'une liste vérifiée : chaque code doit donner un nom, pas un code.
    for (const code of ['fra', 'bel', 'lux', 'gbr', 'esp', 'prt', 'aut', 'nld', 'can', 'jpn']) {
      expect(nomDuPays(code, 'fr')).not.toBe(code.toUpperCase())
    }
  })
})

describe('la longueur d’un article', () => {
  /** Une réponse plausible du modèle : cinq sections, de la longueur qu'il rend vraiment. */
  function reponse(signesParSection: number) {
    return {
      sujet: 'Obsidienne noire',
      fondement: 'La requête « obsidienne noire » sort en seizième place.',
      titre: 'Obsidienne noire : origine et vertus',
      chapo: 'x'.repeat(264),
      sections: Array.from({ length: 5 }, (_, rang) => ({
        titre: `Section ${rang + 1}`,
        corps: 'x'.repeat(signesParSection),
      })),
      questions: [
        { question: 'Qu’est-ce que l’obsidienne ?', reponse: 'Un verre volcanique.' },
        { question: 'D’où vient-elle ?', reponse: 'De coulées de lave refroidies vite.' },
      ],
      metaTitle: 'Obsidienne noire : origine et vertus',
      metaDescription:
        'Ce qu’est l’obsidienne noire, d’où elle vient, et pourquoi on la trouve dans les bougies artisanales.',
    }
  }

  it('n’est jamais exigée par le schéma : la sortie structurée ne le permet pas', () => {
    /*
     * La garde qui a coûté une panne. L'API retire les contraintes de longueur de chaîne du
     * schéma qu'elle envoie au modèle, puis le SDK les applique à sa réponse côté client :
     * un minimum écrit dans le schéma ne rallonge rien et rejette tout. La rédaction a cessé
     * de fonctionner en production le jour où on en a mis un.
     *
     * Ce test le rappelle en acceptant ce que le modèle rend réellement — ses deux premiers
     * articles avaient des sections de 462 et 613 signes.
     */
    expect(articleSchema.safeParse(reponse(462)).success).toBe(true)
    expect(articleSchema.safeParse(reponse(613)).success).toBe(true)
  })

  it('reste une consigne, cohérente avec le seuil que l’analyse applique', () => {
    const vise =
      ARTICLE_FORME.chapoSignesMin + ARTICLE_FORME.sectionsMin * ARTICLE_FORME.sectionSignesMin
    // 6,5 signes par mot : la valeur la plus défavorable mesurée sur les articles réels.
    expect(Math.floor(vise / 6.5)).toBeGreaterThanOrEqual(SEUILS_REDACTION.motsMinimum)
  })

  it('demande assez de sections pour que la longueur ne donne pas des pavés', () => {
    expect(ARTICLE_FORME.sectionsMin).toBeGreaterThanOrEqual(4)
  })

  it('demande un chapô qui réponde, au-delà du minimum de l’analyse', () => {
    expect(ARTICLE_FORME.chapoSignesMin).toBeGreaterThanOrEqual(
      SEUILS_REDACTION.introSignesMinimum,
    )
  })
})
