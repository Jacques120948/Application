import { describe, expect, it } from 'vitest'
import {
  crediterAchat,
  debiter,
  partMensuelle,
  renouveler,
  reprendreAchat,
  surclasser,
} from '@/server/billing/credits'

/**
 * Le portefeuille à deux compartiments : la réserve mensuelle, qui se renouvelle, et les
 * crédits achetés, qui n'expirent pas. Tout ce qui est tenu ici est une promesse faite à
 * quelqu'un qui a payé.
 */
describe('Portefeuille — crédits mensuels et crédits achetés', () => {
  it('le renouvellement remplace la réserve mensuelle et garde les crédits achetés', () => {
    expect(renouveler({ balance: 130, purchased: 100 }, 200)).toEqual({ balance: 300, purchased: 100 })
    // Réserve épuisée, achats intacts.
    expect(renouveler({ balance: 100, purchased: 100 }, 200)).toEqual({ balance: 300, purchased: 100 })
    // Rien d'acheté : comportement d'avant, inchangé.
    expect(renouveler({ balance: 12, purchased: 0 }, 200)).toEqual({ balance: 200, purchased: 0 })
  })

  it('le passage à une offre supérieure complète la réserve sans toucher aux achats', () => {
    expect(surclasser({ balance: 150, purchased: 100 }, 400)).toEqual({ balance: 500, purchased: 100 })
    // Une réserve déjà plus haute que la nouvelle dotation n'est pas rabotée.
    expect(surclasser({ balance: 600, purchased: 100 }, 400)).toEqual({ balance: 600, purchased: 100 })
  })

  it('une dépense prend d’abord sur la réserve mensuelle', () => {
    const apres = debiter({ balance: 150, purchased: 100 }, 30)
    expect(apres).toEqual({ balance: 120, purchased: 100, debite: 30 })
    expect(partMensuelle(apres)).toBe(20)
  })

  it('puis sur les crédits achetés, et jamais au-delà du solde', () => {
    expect(debiter({ balance: 150, purchased: 100 }, 80)).toEqual({ balance: 70, purchased: 70, debite: 80 })
    expect(debiter({ balance: 20, purchased: 20 }, 50)).toEqual({ balance: 0, purchased: 0, debite: 20 })
    expect(debiter({ balance: 20, purchased: 20 }, -5)).toEqual({ balance: 20, purchased: 20, debite: 0 })
  })

  it('un achat s’ajoute aux deux compteurs', () => {
    expect(crediterAchat({ balance: 40, purchased: 0 }, 500)).toEqual({ balance: 540, purchased: 500 })
  })

  it('un remboursement ne reprend que les crédits achetés qui restent', () => {
    // Rien consommé : tout est repris, la réserve mensuelle est intacte.
    expect(reprendreAchat({ balance: 540, purchased: 500 }, 500)).toEqual({ balance: 40, purchased: 0, repris: 500 })
    // En partie consommé : on reprend le reste, jamais la réserve mensuelle.
    expect(reprendreAchat({ balance: 300, purchased: 300 }, 500)).toEqual({ balance: 0, purchased: 0, repris: 300 })
    expect(reprendreAchat({ balance: 350, purchased: 300 }, 500)).toEqual({ balance: 50, purchased: 0, repris: 300 })
  })

  it('des données incohérentes ne font jamais passer un compteur sous zéro', () => {
    // Plus d'achetés que de solde (état ancien) : la part achetée est ramenée au solde.
    expect(renouveler({ balance: 30, purchased: 100 }, 200)).toEqual({ balance: 230, purchased: 30 })
    expect(partMensuelle({ balance: 30, purchased: 100 })).toBe(0)
  })
})
