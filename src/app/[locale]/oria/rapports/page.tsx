import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { actionCosts } from '@/server/billing/action-costs'
import { listSites } from '@/server/audit/service'
import { lireRapport } from '@/server/oria/rapport'
import { dernierResume } from '@/server/oria/resume'
import { Shell } from '@/components/studio/Shell'
import { OngletsOria, RapportOria } from '@/components/studio/Oria'
import { ResumeOria } from '@/components/studio/ResumeOria'

/**
 * Le rapport de la semaine d'Oria.
 *
 * Toujours à jour et toujours gratuit : il se calcule à l'ouverture, sur les sept derniers
 * jours, à partir de ce que l'équipe a déjà enregistré. Il n'y a donc rien à « préparer
 * chaque lundi » — ouvert un lundi, il couvre la semaine écoulée.
 *
 * Le résumé en quelques phrases, lui, est facultatif et payant : il se demande d'un clic,
 * et se relit ensuite gratuitement.
 */
export const maxDuration = 60

export default async function RapportsPage({
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
  const maintenant = new Date()
  const [credits, sites, rapport, couts] = await Promise.all([
    availableCredits(user.id),
    listSites(user.id),
    lireRapport(user.id, locale, demande.siteId, maintenant),
    actionCosts(),
  ])

  // Le rapport sait son site : c'est celui qu'Oria regarde, le même que le cockpit.
  const siteId = rapport.site?.id ?? ''
  const resume = await dernierResume(user.id, 'semaine', siteId === '' ? null : siteId).catch(() => null)
  const cout = couts.find((ligne) => ligne.id === 'oria-resume') ?? null

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="oria"
      siteId={siteId}
      sites={sites.map((site) => ({ id: site.id, host: site.host }))}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-10">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-tight">Rapport de la semaine</h1>
          <p className="mt-2 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Ce qui a progressé, ce qui a baissé, ce qu’il faut surveiller, ce qui a été fait, et
            la suite.
          </p>
          <OngletsOria courant="rapports" locale={locale} siteId={siteId} />
        </div>

        <ResumeOria
          titre="Résumé"
          genre="semaine"
          siteId={siteId}
          locale={locale}
          cout={cout === null ? null : { min: cout.min, max: cout.max }}
          initial={resume === null ? null : { ...resume, createdAt: resume.createdAt.toISOString() }}
        />

        <RapportOria rapport={rapport} maintenant={maintenant} />
      </div>
    </Shell>
  )
}
