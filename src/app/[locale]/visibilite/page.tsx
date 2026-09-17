import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { listSites } from '@/server/audit/service'
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

  return (
    <Shell locale={locale} userName={user.name} credits={credits} screen="visibilite">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Votre visibilité</h1>
        <p className="mt-2 mb-8 text-sm text-[var(--color-ink-soft)]">
          Ajoutez un site, lancez son analyse, et suivez ce qu’il faut corriger.
        </p>
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
