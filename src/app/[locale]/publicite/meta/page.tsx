import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { hasConnection } from '@/server/integrations/service'
import { listerComptesRelies } from '@/server/ads/comptes'
import { metaAds } from '@/server/ads/meta-ads'
import { findVisibilityAgent } from '@/server/agents/visibility'
import { Shell } from '@/components/studio/Shell'
import { AgentAvatar } from '@/components/marketing/visibility'
import { ComptesAds } from '@/components/studio/ComptesAds'
import { LinkButton } from '@/components/ui'

/**
 * Le compte Meta que MIRA suit.
 *
 * Un écran à part, et volontairement pauvre : il ne fait qu'une chose, désigner un compte.
 * Le tableau de bord viendra se poser dessus, pas l'inverse — c'est le choix du compte qui
 * conditionne tout le reste, et il devait exister avant qu'il y ait quoi que ce soit à
 * afficher.
 *
 * Il répond à une question que la connexion laisse ouverte, et qu'on ne se pose qu'une fois
 * qu'elle est faite : **lequel de mes comptes Evoliia regarde-t-elle ?** L'autorisation Meta
 * donne accès à tous ceux dont on a un rôle — souvent plusieurs portefeuilles, dont
 * certains qui ne nous appartiennent plus vraiment. Tant que personne n'en désigne un,
 * aucun n'est lu : c'est le bon défaut, mais il faut pouvoir en sortir.
 */
export default async function ComptesMetaPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const mira = findVisibilityAgent('meta')
  const [credits, entitlements] = await Promise.all([
    availableCredits(user.id),
    getEntitlements(user.id),
  ])

  /*
   * Le droit vérifié est celui de l'agent publicitaire, et non `visibility_meta_agent`.
   * C'est provisoire et assumé : la fiche de MIRA est encore « prévue » parce qu'elle ne
   * lit aucune campagne, et la verrouiller sur un droit que personne ne possède fermerait
   * l'écran à tout le monde — y compris à celui qui vient de relier son compte. Le verrou
   * se déplacera quand MIRA aura quelque chose à montrer.
   */
  const ouvert = entitlements.granted.includes('visibility_ads_agent')
  const [relie, comptes] = ouvert
    ? await Promise.all([
        hasConnection(user.id, metaAds.id),
        listerComptesRelies(user.id, metaAds.id),
      ])
    : [false, []]

  const actif = comptes.find((compte) => compte.actif) ?? null

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="publicite"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/publicite`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Publicité
        </a>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          {mira === undefined ? null : <AgentAvatar agent={mira} size="lg" />}
          <div className="min-w-0">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Vos comptes Meta</h1>
            <p className="mt-1 mb-0 text-sm text-[var(--color-ink-soft)]">
              Celui que MIRA regarde, et lui seul.
            </p>
          </div>
        </div>

        {!ouvert ? (
          <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm font-medium">Votre offre n’ouvre pas la publicité.</p>
            <LinkButton href={`/${locale}/abonnement`} variant="secondary" className="mt-3">
              Voir les offres
            </LinkButton>
          </div>
        ) : !relie ? (
          <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm font-medium">Meta Ads n’est pas connecté.</p>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              En reliant votre compte, Evoliia lit vos campagnes Facebook et Instagram. Aucune
              modification n’est faite sans votre accord explicite.
            </p>
            <LinkButton href={`/${locale}/connexions`} variant="secondary" className="mt-3">
              Connecter Meta Ads
            </LinkButton>
          </div>
        ) : (
          <>
            <div className="mt-8 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
              <p className="m-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {/*
                  Dit avant la liste, parce que c'est la question qu'on se pose en la voyant :
                  pourquoi des comptes que je n'ai pas demandés ? L'autorisation de Meta ne se
                  découpe pas par portefeuille — elle porte sur ce à quoi la personne a un
                  rôle. Ce qui limite la portée, c'est le compte qu'elle désigne ici.
                */}
                Meta donne à Evoliia la liste de tous les comptes publicitaires sur lesquels
                vous avez un rôle — y compris ceux d’autres portefeuilles, s’il y en a. C’est
                Meta qui en décide, pas Evoliia : son autorisation ne se découpe pas par
                portefeuille.
              </p>
              <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                Ce qui limite ce que MIRA voit, c’est le compte que vous désignez ci-dessous.
                <strong className="font-medium text-[var(--color-ink)]">
                  {' '}
                  Aucun autre n’est lu
                </strong>
                , et aucune modification n’est envoyée ailleurs.
              </p>
              {actif === null ? (
                <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-caution)]">
                  Aucun compte n’est suivi pour l’instant. C’est le bon défaut quand vous en
                  avez plusieurs : choisir à votre place vous donnerait des chiffres qui ne
                  sont pas les vôtres.
                </p>
              ) : null}
            </div>

            <div className="mt-6">
              <ComptesAds initiaux={comptes} agent="MIRA" plateforme="Meta" />
            </div>

            <p className="mt-6 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
              Deux comptes peuvent porter le même nom : c’est le numéro sous chaque nom qui
              les distingue, et c’est celui que Meta affiche dans son gestionnaire de
              publicités.
            </p>
          </>
        )}
      </div>
    </Shell>
  )
}
