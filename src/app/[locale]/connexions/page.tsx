import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { getEffectivePlan } from '@/server/billing/plans'
import { listConnections } from '@/server/integrations/service'
import { CATEGORY_LABEL, COST_LABEL } from '@/server/integrations/catalog'
import { Shell } from '@/components/studio/Shell'
import { ConnectionsBoard, type ProviderCard } from '@/components/studio/ConnectionsBoard'

/**
 * Connexions du créateur.
 *
 * La page ne lit que la table des connexions : les secrets ne sont jamais chargés pour être
 * affichés, et ne quittent donc jamais le serveur.
 */
const STRIPE_NOTICES: Record<string, { tone: 'positive' | 'caution' | 'critical'; text: string }> = {
  connecte: { tone: 'positive', text: 'Votre compte Stripe est relié. Vos applications peuvent encaisser.' },
  incomplet: {
    tone: 'caution',
    text: "L'inscription Stripe n'est pas terminée. Reprenez-la quand vous voulez depuis la carte Stripe.",
  },
  erreur: { tone: 'critical', text: "Le retour de Stripe n'a pas pu être vérifié. Réessayez." },
}

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ stripe?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const { stripe } = await searchParams
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const [entries, wallet, plan] = await Promise.all([
    listConnections(user.id),
    getWallet(user.id),
    getEffectivePlan(user.id),
  ])

  const cards: ProviderCard[] = entries.map(({ provider, connection }) => ({
    id: provider.id,
    name: provider.name,
    category: provider.category,
    summary: provider.summary,
    usage: provider.usage,
    status: provider.status,
    credential: provider.credential,
    costNotice: provider.costNotice,
    costLabel: COST_LABEL[provider.costToCreator],
    keyHelp: provider.keyHelp ?? null,
    guide: provider.guide ?? null,
    connection:
      connection === null
        ? null
        : {
            id: connection.id,
            status: connection.status,
            accountLabel: connection.accountLabel,
            connectedAt: connection.connectedAt,
            hint: connection.hint,
            lastError: connection.lastError,
          },
  }))

  const categories = Object.entries(CATEGORY_LABEL).map(([id, label]) => ({ id, label }))

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="autre"
    >
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">Connecter vos outils</h1>
        <p className="mb-8 text-[var(--color-ink-soft)]">
          Reliez vos comptes existants à Evoliia. Vos données restent chez eux, vous gardez
          la main, et vous pouvez retirer une autorisation à tout moment.
        </p>
        <ConnectionsBoard
          cards={cards}
          categories={categories}
          maxConnections={plan.maxConnections}
          locale={locale}
          notice={stripe === undefined ? null : (STRIPE_NOTICES[stripe] ?? null)}
        />
      </div>
    </Shell>
  )
}
