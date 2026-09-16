import { redirect } from 'next/navigation'
import { getTranslator, resolveLocale } from '@/i18n'
import { env } from '@/lib/env'
import { getCurrentUser } from '@/server/auth/session'
import { Card, CardBody } from '@/components/ui'
import { Logo } from '@/components/marketing/Logo'
import { AuthForm } from '@/components/studio/AuthForm'
import { parseTargetUrl } from '@/server/audit/net'

/**
 * Destinations autorisées après inscription.
 *
 * La valeur vient de l'URL : elle est donc traduite par une liste fermée plutôt que
 * reprise telle quelle, sinon n'importe qui pourrait fabriquer un lien d'inscription
 * redirigeant vers un site tiers.
 */
const AFTER_REGISTER: Record<string, string> = { idee: 'creer', objectif: 'objectif' }

/** Sans indication, on laisse la personne choisir son chemin plutôt que de le décider. */
const DEFAULT_AFTER_REGISTER = 'demarrer'

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ suite?: string; site?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const demande = await searchParams
  const suite = demande.suite ?? ''
  const nextPath = `/${locale}/${AFTER_REGISTER[suite] ?? DEFAULT_AFTER_REGISTER}`
  if ((await getCurrentUser()) !== null) redirect(`/${locale}/dashboard`)
  const t = getTranslator(locale)

  /*
   * L'adresse saisie sur la page d'accueil, rappelée ici.
   *
   * Elle passe par le même contrôle que celui du robot : l'URL vient du navigateur, et une
   * valeur affichée sans être validée est une valeur qu'on affiche à la place de quelqu'un
   * d'autre. Ce qui ne passe pas est simplement oublié — on ne met pas en échec une
   * inscription à cause d'une adresse mal tapée.
   */
  const site = (() => {
    if (demande.site === undefined || demande.site === '') return null
    try {
      return parseTargetUrl(demande.site).hostname
    } catch {
      return null
    }
  })()

  return (
    <div className="mx-auto w-full max-w-md px-5 py-16">
      <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
        <Logo id="mark-register" size={30} wordmark={t('common.appName')} />
      </a>
      <h1 className="mt-6 mb-6 text-2xl font-semibold">{t('auth.registerTitle')}</h1>
      {site === null ? null : (
        <p className="mb-6 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-brand-soft)] px-4 py-3 text-sm text-[var(--color-ink-soft)]">
          {t('vis.signupSite', { site })}
        </p>
      )}
      <Card>
        <CardBody>
          <AuthForm
            mode="register"
            locale={locale}
            requiresCode={env.signupCode !== undefined}
            nextPath={nextPath}
            labels={{
              email: t('auth.email'),
              password: t('auth.password'),
              name: t('auth.name'),
              passwordHint: t('auth.passwordHint'),
              submit: t('nav.register'),
            }}
          />
        </CardBody>
      </Card>
      <p className="mt-5 text-center text-sm text-[var(--color-ink-soft)]">
        {t('auth.hasAccount')}{' '}
        <a href={`/${locale}/connexion`} className="text-[var(--color-brand)]">
          {t('nav.login')}
        </a>
      </p>
    </div>
  )
}
