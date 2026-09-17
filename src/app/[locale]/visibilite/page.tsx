import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { listFindings, listSites } from '@/server/audit/service'
import { parseTargetUrl } from '@/server/audit/net'
import { Shell } from '@/components/studio/Shell'
import { SiteBoard } from '@/components/studio/SiteBoard'

/**
 * Le premier écran du produit : ajouter son site et le faire analyser.
 *
 * C'est là qu'arrive quelqu'un qui vient de s'inscrire depuis la page d'accueil, et l'adresse
 * qu'il y avait saisie l'accompagne jusqu'ici. La retaper serait la première chose qu'on lui
 * demande, juste après lui avoir promis qu'on ne lui demanderait rien.
 */
export default async function VisibilitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ site?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  /*
   * L'adresse vient du navigateur : elle passe par le contrôle du robot avant d'être
   * réaffichée. Ce qui ne passe pas est oublié, sans mettre l'écran en échec.
   */
  const prefill = (() => {
    if (demande.site === undefined || demande.site === '') return ''
    try {
      return parseTargetUrl(demande.site).origin
    } catch {
      return ''
    }
  })()

  const [sites, credits] = await Promise.all([listSites(user.id), availableCredits(user.id)])

  /*
   * Les constats du dernier audit terminé, s'il y en a un. On n'en montre que les cinq plus
   * coûteux : un audit qui rend trente remarques se referme, et « par quoi je commence » est
   * la seule question que se pose quelqu'un devant cet écran.
   */
  const dernier = sites.find((site) => site.dernierAudit?.status === 'done')?.dernierAudit ?? null
  const constats = dernier === null ? [] : (await listFindings(user.id, dernier.id)).filter((c) => c.affected > 0).slice(0, 5)

  return (
    <Shell locale={locale} userName={user.name} credits={credits} screen="visibilite">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Votre visibilité</h1>
        <p className="mt-2 mb-8 text-sm text-[var(--color-ink-soft)]">
          Ajoutez un site, lancez son analyse, et suivez ce qu’il faut corriger.
        </p>
        {constats.length === 0 ? null : (
          <section className="mb-8">
            <div className="flex flex-wrap items-baseline gap-4">
              <h2 className="m-0 text-lg font-semibold">Par quoi commencer</h2>
              {dernier?.seoScore === null || dernier === null ? null : (
                <span className="text-sm text-[var(--color-ink-soft)]">
                  Note de référencement : <strong>{dernier.seoScore}/100</strong>
                </span>
              )}
            </div>
            <ol className="m-0 mt-4 grid list-none gap-3 p-0">
              {constats.map((constat, rang) => (
                <li
                  key={constat.checkId}
                  className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
                >
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="rounded-[var(--radius-pill)] bg-[var(--color-critical-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-critical)]">
                      Priorité {rang + 1}
                    </span>
                    <h3 className="m-0 text-base font-semibold">{constat.label}</h3>
                    {constat.scope === 'site' ? null : (
                      <span className="text-sm text-[var(--color-ink-faint)]">
                        {constat.affected} page{constat.affected > 1 ? 's' : ''} sur{' '}
                        {constat.examined}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    {constat.why}
                  </p>
                  {constat.sample.length === 0 ? null : (
                    <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
                      {constat.sample.map((exemple) => (
                        <li
                          key={exemple.url}
                          className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-3 py-1 text-xs text-[var(--color-ink-soft)]"
                        >
                          {exemple.path}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            {/*
              Les corrections rédigées viendront de l'équipe ; tant qu'elles n'existent pas,
              on ne met pas de bouton qui ne ferait rien.
            */}
            <p className="mt-4 mb-0 text-sm text-[var(--color-ink-faint)]">
              Les corrections rédigées par l’équipe arrivent dans une prochaine version.
            </p>
          </section>
        )}

        <SiteBoard
          sites={sites.map((site) => ({
            id: site.id,
            host: site.host,
            label: site.label,
            dernierAudit: site.dernierAudit,
          }))}
          prefill={prefill}
          locale={locale}
        />
      </div>
    </Shell>
  )
}
