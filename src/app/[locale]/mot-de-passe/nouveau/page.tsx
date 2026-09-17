import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { Card, CardBody, Notice } from '@/components/ui'
import { Logo } from '@/components/marketing/Logo'
import { NewPasswordForm } from '@/components/studio/PasswordResetForms'

/**
 * Choix du nouveau mot de passe.
 *
 * Le jeton arrive par l'adresse. Il n'est pas vérifié ici : c'est le serveur qui tranche
 * au moment de l'enregistrement, pour qu'un jeton invalide ne puisse pas être distingué
 * d'un jeton expiré avant même la saisie.
 */
export default async function NewPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ jeton?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  if ((await getCurrentUser()) !== null) redirect(`/${locale}/visibilite`)
  const token = (await searchParams).jeton ?? ''

  return (
    <div className="mx-auto w-full max-w-md px-5 py-16">
      <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
        <Logo id="mark-new-password" size={30} wordmark="Evoliia" />
      </a>
      <h1 className="mt-6 mb-6 text-2xl font-semibold">Choisir un nouveau mot de passe</h1>
      <Card>
        <CardBody>
          {token === '' ? (
            <Notice tone="critical" title="Lien incomplet">
              Ce lien ne contient pas de jeton. Ouvrez celui reçu par e-mail, ou{' '}
              <a href={`/${locale}/mot-de-passe-oublie`} className="text-[var(--color-brand)]">
                demandez-en un nouveau
              </a>
              .
            </Notice>
          ) : (
            <NewPasswordForm locale={locale} token={token} />
          )}
        </CardBody>
      </Card>
    </div>
  )
}
