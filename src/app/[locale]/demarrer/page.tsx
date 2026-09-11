import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { getWallet } from '@/server/billing/credits'
import { Card, CardBody, LinkButton } from '@/components/ui'
import { Shell } from '@/components/studio/Shell'

/**
 * Point de départ : le créateur choisit son chemin.
 *
 * Le parcours guidé reste la promesse du produit, et il est présenté en premier. Mais
 * forcer quelqu'un qui arrive avec son idée à répondre à dix questions sur son objectif
 * de revenu, c'est le perdre. Les deux chemins mènent à la même application en ligne, et
 * l'un n'interdit pas l'autre.
 */
export default async function StartPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)
  const wallet = await getWallet(user.id)

  return (
    <Shell
      locale={locale}
      userName={user.name ?? user.email}
      credits={wallet.balance}
      isAdmin={user.role === 'ADMIN'}
      screen="demarrer"
    >
      <div className="mx-auto w-full max-w-4xl">
        <h1 className="mb-1 text-2xl font-semibold">Par où voulez-vous commencer ?</h1>
        <p className="mb-8 text-[var(--color-ink-soft)]">
          Les deux chemins mènent à une application en ligne. Vous pouvez changer d’avis à
          tout moment, rien n’est perdu.
        </p>

        <div className="grid gap-5 md:grid-cols-2">
          <Path
            eyebrow="Le plus courant"
            title="Je ne sais pas encore quoi créer"
            body="Nous partons de votre objectif de revenu, du temps dont vous disposez et de ce que vous savez déjà faire. Vous recevez plusieurs idées chiffrées, vous les comparez, vous choisissez."
            steps={[
              'Quelques questions sur votre situation',
              'Des idées chiffrées, avec prix conseillé et nombre de clients',
              'L’analyse de celle qui vous plaît',
              'Le cahier des charges, puis la construction',
            ]}
            note="Comptez une dizaine de minutes de questions. La réflexion, les idées et l’analyse ne coûtent rien."
            action="Être guidé"
            href={`/${locale}/objectif`}
            highlighted
          />

          <Path
            eyebrow="Le plus rapide"
            title="Je sais ce que je veux créer"
            body="Vous décrivez votre application en quelques phrases, comme vous l’expliqueriez à quelqu’un. Nous la construisons directement."
            steps={[
              'Vous décrivez votre idée',
              'Nous proposons un plan, vous le validez',
              'L’application est construite',
              'Vous la modifiez en écrivant vos demandes',
            ]}
            note="Vous sautez l’analyse du marché et le chiffrage. Vous pourrez définir votre objectif plus tard pour retrouver ces chiffres."
            action="Décrire mon idée"
            href={`/${locale}/creer`}
          />
        </div>
      </div>
    </Shell>
  )
}

function Path({
  eyebrow,
  title,
  body,
  steps,
  note,
  action,
  href,
  highlighted = false,
}: {
  eyebrow: string
  title: string
  body: string
  steps: string[]
  note: string
  action: string
  href: string
  highlighted?: boolean
}) {
  return (
    <Card
      className={
        highlighted ? 'flex flex-col border-2 border-[var(--color-brand)]' : 'flex flex-col'
      }
    >
      <CardBody className="flex flex-1 flex-col">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
          {eyebrow}
        </span>
        <h2 className="mt-2 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{body}</p>

        <ol className="mt-4 grid list-none gap-2 p-0 text-sm">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="text-[var(--color-brand)]">{index + 1}.</span>
              <span className="text-[var(--color-ink-soft)]">{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-4 mb-6 text-xs leading-relaxed text-[var(--color-ink-faint)]">{note}</p>

        <LinkButton
          href={href}
          size="large"
          variant={highlighted ? 'primary' : 'secondary'}
          className="mt-auto"
        >
          {action}
        </LinkButton>
      </CardBody>
    </Card>
  )
}
