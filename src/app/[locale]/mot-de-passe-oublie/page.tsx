import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { isEmailAvailable } from '@/server/auth/password-reset'
import { Card, CardBody, Notice } from '@/components/ui'
import { Logo } from '@/components/marketing/Logo'
import { ResetRequestForm } from '@/components/studio/PasswordResetForms'

/**
 * Demande de réinitialisation.
 *
 * Quand aucun fournisseur d'e-mails n'est configuré, la page le dit franchement au lieu
 * d'afficher un formulaire qui ne peut rien envoyer (exigence 41 : aucun bouton inerte).
 */
export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = resolveLocale((await params).locale)
  if ((await getCurrentUser()) !== null) redirect(`/${locale}/visibilite`)

  return (
    <div className="mx-auto w-full max-w-md px-5 py-16">
      <a href={`/${locale}`} className="text-[var(--color-ink)] no-underline">
        <Logo id="mark-forgot" size={30} wordmark="Evoliia" />
      </a>
      <h1 className="mt-6 mb-2 text-2xl font-semibold">Mot de passe oublié</h1>
      <p className="mb-6 text-sm text-[var(--color-ink-soft)]">
        Indiquez votre adresse, nous vous envoyons un lien pour en choisir un nouveau.
      </p>
      <Card>
        <CardBody>
          {isEmailAvailable() ? (
            <ResetRequestForm locale={locale} />
          ) : (
            <Notice tone="caution" title="Envoi d’e-mails pas encore configuré">
              Cette installation ne peut pas encore envoyer de messages. Écrivez à la
              personne qui l’administre pour faire réinitialiser votre mot de passe.
            </Notice>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
