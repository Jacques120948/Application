import { describe, expect, it } from 'vitest'
import { INTEGRATION_PROVIDERS, findProvider } from '@/server/integrations/catalog'
import { findVerifier } from '@/server/integrations/verify'
import { DEFAULT_PLANS } from '@/server/billing/plans'

/**
 * Règle économique du catalogue.
 *
 * Un utilisateur de plus ne doit pas créer un coût de plus pour Evoliia. Ce test la rend
 * opposable : ouvrir un fournisseur dont la facture retomberait sur la plateforme fait
 * échouer la suite, et la question se pose donc avant la mise en ligne, pas après la
 * première facture.
 */
describe('catalogue des intégrations', () => {
  const open = INTEGRATION_PROVIDERS.filter((provider) => provider.status === 'available')

  it('n’ouvre que des services dont le coût pour Evoliia est nul', () => {
    for (const provider of open) {
      expect(provider.costToEvoliia, provider.id).toBe('aucun')
    }
  })

  it('annonce le coût pour le créateur avant la connexion', () => {
    for (const provider of open) {
      expect(provider.costNotice.length, provider.id).toBeGreaterThan(20)
      expect(provider.freeQuota.length, provider.id).toBeGreaterThan(0)
    }
  })

  it('explique où trouver la clé pour tout service qui en demande une', () => {
    for (const provider of open.filter((entry) => entry.credential === 'API_KEY')) {
      expect(provider.keyHelp, provider.id).toBeDefined()
    }
  })

  it('relie un espace Postelya par code d’appairage, pas par clé durable', () => {
    const postelya = findProvider('postelya')
    expect(postelya?.status).toBe('available')
    expect(postelya?.credential).toBe('API_KEY')
    expect(findVerifier('postelya')).toBeDefined()
    // Evoliia dépose, elle ne publie pas : la fiche doit le dire, c'est ce qui distingue
    // cette connexion d'une autorisation de publier au nom du créateur.
    expect(postelya?.risk).toContain('ne publie pas')
  })

  it('sait vérifier la clé Anthropic avant de l’enregistrer', () => {
    expect(findProvider('anthropic')?.status).toBe('available')
    expect(findVerifier('anthropic')).toBeDefined()
  })

  it('range la clé du créateur du côté des applications publiées, pas de l’atelier', () => {
    // C'est ce qui fait que l'assistant d'une application publiée la trouve, et que le
    // coût part sur le compte du créateur au lieu de ses crédits Evoliia.
    expect(findProvider('anthropic')?.connectionTarget).toBe('APP')
  })

  it('laisse une offre payante connecter au moins un service', () => {
    const payantes = DEFAULT_PLANS.filter((plan) => plan.priceCents > 0)
    expect(payantes.length).toBeGreaterThan(0)
    for (const plan of payantes) {
      expect(plan.maxConnections, plan.id).toBeGreaterThan(0)
    }
  })
})
