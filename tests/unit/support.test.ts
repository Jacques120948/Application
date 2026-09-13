import { describe, expect, it } from 'vitest'
import { classify, priorityFor } from '@/server/support/classify'
import { rankEntries, specDigest, tokens } from '@/server/support/knowledge'
import { builderRequestFor } from '@/lib/support'
import { DEMO_APPS } from '@/server/demos/catalog'
import { consume, clearAll, RULES } from '@/server/auth/rate-limit'

describe('base de connaissances de Lia — recherche lexicale', () => {
  const entries = [
    { id: 'a', question: 'Comment annuler un rendez-vous ?', answer: 'Depuis votre espace, ouvrez le rendez-vous et cliquez sur Annuler.', keywords: 'annulation, annuler, rendez-vous' },
    { id: 'b', question: 'Quels sont vos tarifs ?', answer: 'Le tarif dépend de la prestation choisie.', keywords: 'prix, tarif' },
    { id: 'c', question: 'Puis-je payer par carte ?', answer: 'Oui, la carte est acceptée sur place.', keywords: 'paiement, carte' },
  ]

  it('ignore les mots vides et rapproche les pluriels', () => {
    expect(tokens('Comment annuler mes rendez-vous ?')).toEqual(['annuler', 'rendez'])
    expect(tokens('Les tarifs des prestations')).toEqual(['tarif', 'prestation'])
  })

  it('place d’abord l’entrée dont les mots-clés correspondent', () => {
    const ranked = rankEntries('Je voudrais annuler mon rendez-vous de demain', entries)
    expect(ranked[0]?.id).toBe('a')
    expect(ranked.find((e) => e.id === 'c')).toBeUndefined()
  })

  it('ne renvoie rien pour une question sans mot porteur', () => {
    expect(rankEntries('Bonjour ?', entries)).toEqual([])
    expect(rankEntries('Comment déménager un piano ?', entries)).toEqual([])
  })

  it('résume une application sans données d’utilisateurs', () => {
    const digest = specDigest(DEMO_APPS[0]!.spec)
    expect(digest).toContain(`Nom : ${DEMO_APPS[0]!.spec.name}`)
    expect(digest).toContain('Page «')
    expect(digest.length).toBeLessThanOrEqual(6000)
  })
})

describe('classement des demandes', () => {
  it('reconnaît les mots d’un paiement, d’un compte, d’un problème', () => {
    expect(classify('Je n’arrive pas à payer ma facture')).toBe('billing')
    expect(classify('J’ai oublié mon mot de passe')).toBe('account')
    expect(classify("L'export ne fonctionne pas, j'ai une erreur")).toBe('bug')
    expect(classify('Pourriez-vous ajouter un export PDF ?')).toBe('feature')
    expect(classify('Comment créer une fiche ?')).toBe('usage')
    expect(classify('Merci beaucoup')).toBe('other')
  })

  it('donne la priorité aux problèmes et aux paiements', () => {
    expect(priorityFor('bug')).toBe('high')
    expect(priorityFor('billing')).toBe('high')
    expect(priorityFor('feature')).toBe('low')
    expect(priorityFor('usage')).toBe('normal')
  })
})

describe('de l’analyse au constructeur', () => {
  it('écrit une demande que la personne peut relire, sans rien appliquer', () => {
    const text = builderRequestFor({ kind: 'feature_request', title: 'un export PDF', examples: ['Peut-on exporter en PDF ?'] })
    expect(text).toContain('un export PDF')
    expect(text).toContain('Peux-tu ajouter')
    expect(builderRequestFor({ kind: 'potential_bug', title: 'la connexion échoue', examples: [] })).toContain('vérifier et corriger')
  })
})

describe('limite par visiteur', () => {
  it('coupe après douze messages en cinq minutes', () => {
    clearAll()
    for (let i = 0; i < RULES.liaMessage.limit; i += 1) consume('lia:test:1.2.3.4', RULES.liaMessage)
    expect(() => consume('lia:test:1.2.3.4', RULES.liaMessage)).toThrow()
    // Un autre visiteur n'est pas concerné.
    expect(() => consume('lia:test:5.6.7.8', RULES.liaMessage)).not.toThrow()
    clearAll()
  })
})
