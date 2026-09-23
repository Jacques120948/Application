import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { listSites } from '@/server/audit/service'
import { lireSignaux } from '@/server/oria/signaux'
import { construirePlan, maSemaine } from '@/server/oria/plan-marketing'
import { Shell } from '@/components/studio/Shell'
import { OngletsOria, PlanOria, SemaineOria } from '@/components/studio/Oria'
import { ObjectifsOria } from '@/components/studio/ObjectifsOria'

/**
 * Les objectifs et le plan d'Oria.
 *
 * Les deux sur le même écran parce que l'un règle l'autre : changer d'objectif reclasse les
 * priorités, et le plan se recalcule sous les yeux. Séparés, on changerait un réglage sans
 * voir ce qu'il fait.
 *
 * Rien ici n'appelle un modèle : le plan est rangé par une règle écrite, et se recalcule à
 * chaque visite. Ce qui a été réglé chez un spécialiste disparaît, la suite remonte — il
 * n'y a pas de plan de lundi à tenir à jour à la main.
 */
export const maxDuration = 60

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const [credits, sites, vue] = await Promise.all([
    availableCredits(user.id),
    listSites(user.id),
    lireSignaux(user.id, locale, demande.siteId),
  ])

  /*
   * Les objectifs vivent sur le site : sans site analysé, il n'y a ni objectif à régler ni
   * plan à tirer. Le cockpit sait accueillir quelqu'un dans ce cas.
   */
  if (vue.site === null) redirect(`/${locale}/oria`)

  const plan = construirePlan(vue.signaux)
  const semaine = maSemaine(plan)

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="oria"
      siteId={vue.site.id}
      sites={sites.map((site) => ({ id: site.id, host: site.host }))}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-10">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Objectifs et plan</h1>
          <p className="mt-2 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Ce que vous cherchez, et ce qu’Oria en tire pour aujourd’hui, cette semaine et ce
            mois.
          </p>
          <OngletsOria courant="plan" locale={locale} siteId={vue.site.id} />
        </div>

        <ObjectifsOria
          siteId={vue.site.id}
          initiaux={vue.objectifs.objectifs}
          activite={vue.objectifs.activite}
          deduite={vue.objectifs.deduite}
        />

        <section>
          <h2 className="m-0 text-lg font-semibold">Plan marketing</h2>
          <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Ce qui brûle va aujourd’hui. Ce qui se règle en une modification va cette semaine.
            Ce qui demande de produire quelque chose va au mois. Chaque action mène au
            spécialiste qui l’a relevée : c’est chez lui qu’on la marque faite.
          </p>
          <PlanOria plan={plan} />
        </section>

        <SemaineOria jours={semaine} />
      </div>
    </Shell>
  )
}
