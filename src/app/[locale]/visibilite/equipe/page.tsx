import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import {
  getVisibilityDesk,
  VISIBILITY_ASK_ESTIMATED_CREDITS,
} from '@/server/agents/visibility-service'
import { readDashboard } from '@/server/audit/service'
import { availableCredits } from '@/server/billing/credits'
import { LinkButton } from '@/components/ui'
import { Shell } from '@/components/studio/Shell'
import { EquipeVisibilite } from '@/components/studio/EquipeVisibilite'

/**
 * Parler à l'équipe.
 *
 * L'écran d'à côté montre ce que l'équipe a trouvé ; celui-ci sert à lui demander. C'est la
 * différence entre un rapport et quelqu'un à qui l'on parle, et c'est ce qui justifie quatre
 * prénoms plutôt qu'un menu de fonctions.
 *
 * Le site est choisi comme partout ailleurs : par le tableau de bord, qui ne cherche
 * l'identifiant demandé que parmi les sites de la personne. Sans site analysé, il n'y a rien
 * à demander — l'équipe ne parle que de faits mesurés — et on renvoie vers l'analyse.
 */
export default async function EquipePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; agent?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const tableau = await readDashboard(user.id, demande.siteId)
  if (tableau === null) redirect(`/${locale}/visibilite`)

  const [desk, credits] = await Promise.all([
    getVisibilityDesk(user.id, tableau.site.id),
    availableCredits(user.id),
  ])

  return (
    <Shell locale={locale} userName={user.name} credits={credits} isAdmin={user.role === 'ADMIN'} screen="visibilite"
      menu="equipe"
      siteId={tableau.site.id}
      sites={[tableau.site, ...tableau.autresSites]}>
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Votre équipe</h1>
            <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
              Quatre spécialistes qui ont lu {desk.siteHost}. Écrivez à celui qui concerne
              votre question ; il ne répond que sur ce qu’il a mesuré.
            </p>
          </div>
          <LinkButton href={`/${locale}/visibilite`} variant="secondary">
            Retour au tableau de bord
          </LinkButton>
        </div>

        <EquipeVisibilite
          siteId={tableau.site.id}
          siteHost={desk.siteHost}
          locale={locale}
          agents={desk.agents}
          /*
            Le membre demandé par le menu, quand il y en a un. Sans cela, cliquer « Néo »
            dans la colonne de gauche ouvrait la conversation de Léa : on croyait s'être
            trompé de lien, et on cherchait ailleurs ce qui était déjà là.
          */
          demande={demande.agent ?? ''}
          echanges={desk.notes}
          cout={VISIBILITY_ASK_ESTIMATED_CREDITS}
        />

        <p className="mt-8 mb-0 text-sm text-[var(--color-ink-faint)]">
          Les notes et les constats sont calculés par Evoliia, jamais devinés par un modèle.
          L’équipe les explique et rédige à partir d’eux — elle ne modifie jamais votre site.
        </p>
      </div>
    </Shell>
  )
}
