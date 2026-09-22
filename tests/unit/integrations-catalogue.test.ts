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

  /**
   * Les rares services adossés à une ressource d'Evoliia, nommés un par un.
   *
   * `quota-partage` ne veut pas dire « facturé » : il veut dire qu'un utilisateur de plus
   * consomme un plafond commun. Aucune facture ne tombe, mais la capacité, elle, se divise
   * — et c'est une limite qui se découvre le jour où elle est atteinte, par tout le monde
   * en même temps.
   *
   * Cette liste existe pour que chacun soit une décision et non une dérive. Y ajouter une
   * ligne demande d'écrire le plafond en clair dans `freeQuota`, ce que le test suivant
   * vérifie.
   */
  const PARTAGE_ASSUME: readonly string[] = [
    'google-ads',
    /*
     * Meta, ajouté sciemment. Son plafond se compte par application ET par compte
     * publicitaire, avec un budget qui se reconstitue à l'heure : un utilisateur de plus
     * consomme bien une ressource commune. La discipline est la même que pour Google —
     * une synchronisation par nuit et par compte, les chiffres gardés en base, jamais un
     * appel par affichage d'écran.
     */
    'meta-ads',
  ]

  it('n’ouvre aucun service dont la facture retomberait sur Evoliia', () => {
    /*
     * La règle qui ne souffre aucune exception : un utilisateur de plus ne doit jamais
     * créer un coût de plus. `facture` est interdit à l'ouverture, quelle que soit la
     * bonne raison du moment.
     */
    for (const provider of open) {
      expect(provider.costToEvoliia, provider.id).not.toBe('facture')
    }
  })

  it('n’adosse un service ouvert à une ressource d’Evoliia que si c’est assumé', () => {
    const partages = open
      .filter((provider) => provider.costToEvoliia === 'quota-partage')
      .map((provider) => provider.id)
    expect(partages.sort()).toEqual([...PARTAGE_ASSUME].sort())
  })

  it('écrit le plafond en clair pour tout service adossé à Evoliia', () => {
    /*
     * Un plafond partagé qu'on n'a pas écrit est un plafond qu'on découvre en le
     * franchissant. La fiche doit dire ce qui se partage, et à quel rythme il se consomme.
     */
    for (const id of PARTAGE_ASSUME) {
      const provider = findProvider(id)
      expect(provider?.freeQuota, id).toMatch(/partage|plafond/iu)
    }
  })

  it('annonce le coût pour le créateur avant la connexion', () => {
    for (const provider of open) {
      expect(provider.costNotice.length, provider.id).toBeGreaterThan(20)
      expect(provider.freeQuota.length, provider.id).toBeGreaterThan(0)
    }
  })

  it('donne un mode d’emploi pas à pas à tout service ouvert', () => {
    for (const provider of open) {
      expect(provider.guide, provider.id).toBeDefined()
      expect(provider.guide?.steps.length, provider.id).toBeGreaterThanOrEqual(3)
      expect(provider.guide?.url, provider.id).toMatch(/^https:\/\//)
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
