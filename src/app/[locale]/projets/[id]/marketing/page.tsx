import { notFound, redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { AppError } from '@/lib/errors'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { getProject } from '@/server/projects/service'
import {
  getLatestKit,
  LAUNCH_KIT_ESTIMATED_CREDITS,
  LAUNCH_KIT_FEATURE,
} from '@/server/marketing/launch-kit'
import { isEngineAvailable } from '@/server/marketing/engine'
import { Shell } from '@/components/studio/Shell'
import { LaunchKitBoard } from '@/components/studio/LaunchKitBoard'
import { Card, CardBody, LinkButton, Notice } from '@/components/ui'

/**
 * Marketing d'un projet.
 *
 * L'écran ne demande jamais « quelle est votre offre » : il demande à la couche de droits
 * si la fonction est ouverte. Quand elle ne l'est pas, il dit avec quelle offre elle le
 * serait, sans insister et sans masquer le reste du produit.
 */
export default async function MarketingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale: rawLocale, id } = await params
  const locale = resolveLocale(rawLocale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  try {
    await getProject(user.id, id)
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound()
    throw error
  }

  const [wallet, entitlements] = await Promise.all([getWallet(user.id), getEntitlements(user.id)])
  const allowed = entitlements.granted.includes(LAUNCH_KIT_FEATURE)
  const kit = allowed ? await getLatestKit(user.id, id) : null
  const locked = entitlements.locked.find((entry) => entry.feature.id === LAUNCH_KIT_FEATURE)

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="projet"
    >
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">Préparer mon lancement</h1>
        <p className="mb-8 text-[var(--color-ink-soft)]">
          Faire connaître une application demande autre chose que de la construire. Voici de
          quoi commencer, à partir de ce que vous avez déjà décrit.
        </p>

        {allowed ? (
          <LaunchKitBoard
            projectId={id}
            initialKit={kit}
            engineReady={isEngineAvailable()}
            credits={wallet.balance}
            estimatedCredits={LAUNCH_KIT_ESTIMATED_CREDITS}
          />
        ) : (
          <Card>
            <CardBody className="grid gap-4">
              <h2 className="m-0 text-lg font-semibold">
                {locked?.feature.label ?? 'Kit de lancement'}
              </h2>
              <p className="m-0 text-[var(--color-ink-soft)]">
                {locked?.feature.summary ??
                  'La préparation du lancement n’est pas incluse dans votre offre.'}
              </p>
              <Notice tone="neutral">
                {locked?.availableWith == null
                  ? "Cette fonction n'est pas incluse dans votre offre actuelle."
                  : `Disponible avec l'offre ${locked.availableWith}.`}
              </Notice>
              <div>
                <LinkButton href={`/${locale}/dashboard`} variant="secondary">
                  Retour au tableau de bord
                </LinkButton>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </Shell>
  )
}
