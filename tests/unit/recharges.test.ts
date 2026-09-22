import { describe, expect, it } from 'vitest'
import { DEFAULT_CREDIT_PACKS } from '@/server/billing/packs'
import { DEFAULT_PLANS } from '@/server/billing/plans'

/**
 * Le rapport entre une recharge et un abonnement.
 *
 * C'est une règle commerciale, et elle a sa place dans les tests pour une seule raison :
 * elle se rompt sans rien casser. Un jour on augmente les offres, on oublie les recharges,
 * et rien ne tombe en panne — on perd simplement, en silence, les changements d'offre qu'on
 * aurait dû gagner. C'est exactement ce qui est arrivé : la plus grosse recharge revenait à
 * trois centimes le crédit quand l'abonnement d'entrée le vendait dix-neuf, si bien qu'un
 * abonné Starter pouvait acheter dix fois sa dotation pour moins du double de son
 * abonnement, et n'avait plus aucune raison de monter.
 */

/** Le prix du crédit dans une recharge, en francs. */
function parCredit(pack: { credits: number; priceCents: number }): number {
  return pack.priceCents / 100 / pack.credits
}

describe('les recharges de crédits', () => {
  const payantes = DEFAULT_PLANS.filter((plan) => plan.priceCents > 0 && plan.monthlyCredits > 0)

  it('vend toujours le crédit plus cher qu’en abonnement', () => {
    /*
     * La comparaison se fait avec l'abonnement le **plus cher** au crédit, et non avec le
     * moins cher : il suffit qu'une seule offre vende le crédit au-dessus d'une recharge
     * pour que ses abonnés aient intérêt à recharger plutôt qu'à monter.
     */
    const abonnementLePlusCher = Math.max(
      ...payantes.map((plan) => plan.priceCents / 100 / plan.monthlyCredits),
    )
    const offenders = DEFAULT_CREDIT_PACKS.filter(
      (pack) => parCredit(pack) <= abonnementLePlusCher,
    ).map((pack) => `${pack.id} à ${parCredit(pack).toFixed(3)} CHF/crédit`)
    expect(offenders).toEqual([])
  })

  it('ne vend jamais une recharge moins cher que l’abonnement qui donne autant de crédits', () => {
    /*
     * Le même piège, vu de l'autre bout : une recharge de 1 500 crédits moins chère que
     * l'offre qui en donne 1 500 par mois ferait de l'abonnement le mauvais choix pour
     * quelqu'un qui a déjà payé une fois.
     */
    const offenders = DEFAULT_CREDIT_PACKS.flatMap((pack) =>
      payantes
        .filter((plan) => plan.monthlyCredits <= pack.credits && plan.priceCents >= pack.priceCents)
        .map((plan) => `${pack.id} concurrence ${plan.id}`),
    )
    expect(offenders).toEqual([])
  })

  it('fait baisser le prix du crédit à mesure que la recharge grossit', () => {
    const regressions = DEFAULT_CREDIT_PACKS.flatMap((pack, index) => {
      if (index === 0) return []
      const precedent = DEFAULT_CREDIT_PACKS[index - 1]!
      if (pack.credits <= precedent.credits) return [`${pack.id} n'est pas plus gros que ${precedent.id}`]
      return parCredit(pack) >= parCredit(precedent)
        ? [`${pack.id} vend le crédit plus cher que ${precedent.id}`]
        : []
    })
    expect(regressions).toEqual([])
  })

  it('ne recommande qu’une seule recharge, et n’en offre aucune', () => {
    expect(DEFAULT_CREDIT_PACKS.filter((pack) => pack.isRecommended)).toHaveLength(1)
    expect(DEFAULT_CREDIT_PACKS.filter((pack) => pack.priceCents <= 0)).toEqual([])
  })
})
