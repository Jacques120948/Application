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

/**
 * Ce que dit le retour de Google.
 *
 * Un refus de la personne n'est pas une panne, et une propriété absente n'en est pas une non
 * plus : ce sont deux phrases différentes qui appellent deux gestes différents. Les
 * confondre dans « une erreur est survenue » ferait recommencer une autorisation qui
 * n'aurait aucune raison de mieux se passer la deuxième fois.
 */
const GOOGLE_NOTICES: Record<string, { tone: 'positive' | 'caution' | 'critical'; text: string }> = {
  ok: {
    tone: 'positive',
    text: 'Search Console est relié. Vos chiffres de recherche apparaissent dans Visibilité.',
  },
  refuse: {
    tone: 'caution',
    text: "Vous avez refusé l'autorisation chez Google. Rien n'a été enregistré.",
  },
  'sans-propriete': {
    tone: 'caution',
    text: "Ce compte Google ne suit aucun site dans Search Console. Déclarez-y votre site, puis recommencez.",
  },
  'ga4-sans-propriete': {
    tone: 'caution',
    text: "Ce compte Google n'a accès à aucune propriété Google Analytics 4. Vérifiez que votre site envoie ses visites à GA4, puis recommencez.",
  },
  etat: {
    tone: 'critical',
    text: "Le retour de Google n'a pas pu être vérifié. Recommencez la connexion depuis cette page.",
  },
  echec: {
    tone: 'critical',
    text: "Google n'a pas terminé l'autorisation. Réessayez dans un instant.",
  },
}

export default async function ConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ stripe?: string; google?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const { stripe, google } = await searchParams
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
    extraFields: provider.extraFields ?? null,
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
      menu="connexions"
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
          notice={
            stripe !== undefined
              ? (STRIPE_NOTICES[stripe] ?? null)
              : google !== undefined
                ? (GOOGLE_NOTICES[google] ?? null)
                : null
          }
        />
      </div>
    </Shell>
  )
}
