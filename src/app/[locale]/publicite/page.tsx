import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { hasConnection } from '@/server/integrations/service'
import { listerComptesRelies } from '@/server/ads/comptes'
import { googleAds } from '@/server/ads/google-ads'
import { findVisibilityAgent } from '@/server/agents/visibility'
import { Shell } from '@/components/studio/Shell'
import { AgentAvatar } from '@/components/marketing/visibility'
import { ComptesAds } from '@/components/studio/ComptesAds'
import { TableauAds } from '@/components/studio/TableauAds'
import { LireCampagnes } from '@/components/studio/LireCampagnes'
import { lireTableauAds, periodeValide } from '@/server/ads/tableau'
import { LinkButton } from '@/components/ui'

/**
 * La page de Naya.
 *
 * Elle ouvre sur l'état de la connexion, et rien d'autre tant qu'il n'y a pas de chiffres.
 * C'est volontaire : un écran qui montrerait des cases de tableau de bord vides à quelqu'un
 * qui n'a pas encore relié son compte lui ferait croire à une panne, et il chercherait le
 * défaut partout sauf à l'endroit où il est — le bouton qu'il n'a pas encore cliqué.
 *
 * Les campagnes, les indicateurs et les recommandations viendront remplir cette page à
 * mesure qu'ils existeront. Ce qui est affiché est ce qui est construit.
 */
export default async function PublicitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ jours?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const [credits, entitlements] = await Promise.all([
    availableCredits(user.id),
    getEntitlements(user.id),
  ])

  const naya = findVisibilityAgent('ads')
  const ouvert = entitlements.granted.includes('visibility_ads_agent')
  const [relie, comptes] = ouvert
    ? await Promise.all([hasConnection(user.id, googleAds.id), listerComptesRelies(user.id)])
    : [false, []]
  const actif = comptes.find((compte) => compte.actif) ?? null

  /*
   * La période voyage dans l'adresse, comme le filtre par pays et le rythme du calendrier :
   * elle se met en favori et survit au rafraîchissement. Une valeur inattendue retombe sur
   * sept jours plutôt que de faire échouer un écran qu'on venait consulter.
   */
  const jours = periodeValide((await searchParams).jours)
  const tableau = actif === null ? null : await lireTableauAds(user.id, jours).catch(() => null)

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <div className="flex flex-wrap items-center gap-4">
          {naya === undefined ? null : <AgentAvatar agent={naya} size="lg" halo />}
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Naya — Publicité</h1>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Elle lit vos campagnes Google Ads, explique où part votre argent et ce qu’il
              rapporte, et propose des ajustements. Elle ne modifie rien sans votre accord.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-6">
          {!ouvert ? (
            <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
              <p className="m-0 text-sm leading-relaxed">
                Naya n’est pas incluse dans votre offre actuelle.
              </p>
              <LinkButton href={`/${locale}/abonnement`} variant="secondary" className="mt-3">
                Voir les offres
              </LinkButton>
            </section>
          ) : !relie ? (
            <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
              <p className="m-0 text-sm font-medium">Connexion Google Ads requise</p>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                Naya ne devine rien : sans vos chiffres, elle n’a ni dépense, ni ROAS, ni
                conversion à commenter. Reliez votre compte pour qu’elle puisse lire.
              </p>
              {/*
                Ce que Google affichera, dit avant qu'on y arrive. L'autorisation Google Ads
                n'existe qu'en version complète : demander à lire, c'est obtenir le droit de
                modifier. La personne doit pouvoir le savoir avant de cliquer, pas le
                découvrir sur l'écran de consentement.
              */}
              <p className="mt-3 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                Google vous demandera d’autoriser « voir, modifier, créer et supprimer vos
                données et comptes Google Ads » : c’est la seule autorisation qu’il propose
                pour cette API, il n’en existe pas de version en lecture seule.{' '}
                <strong>Evoliia ne s’en sert que pour lire.</strong> Toute modification
                demandera votre confirmation, et sa valeur d’avant sera conservée pour
                pouvoir revenir en arrière.
              </p>
              <LinkButton href={`/${locale}/connexions`} className="mt-4">
                Connecter Google Ads
              </LinkButton>
            </section>
          ) : (
            <>
              <section>
                <h2 className="m-0 mb-3 text-base font-semibold">
                  {actif === null ? 'Choisissez le compte à suivre' : 'Compte Google Ads'}
                </h2>
                {comptes.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                    <p className="m-0 text-sm leading-relaxed">
                      L’autorisation est en place, mais aucun compte publicitaire n’a été lu.
                      Vérifiez que le compte Google que vous avez autorisé a bien accès à un
                      compte Google Ads.
                    </p>
                  </div>
                ) : (
                  <ComptesAds initiaux={comptes} />
                )}
              </section>

              {actif === null || tableau === null ? null : (
                <>
                  <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                    <p className="m-0 mb-3 text-xs text-[var(--color-ink-faint)]">
                      {actif.synchroAt === null
                        ? 'Aucune lecture n’a encore eu lieu.'
                        : `Dernière lecture : ${actif.synchroAt.toLocaleString(locale)}.`}
                    </p>
                    <LireCampagnes premiere={actif.synchroAt === null} />
                  </section>
                  <TableauAds
                    base={`/${locale}/publicite`}
                    tableau={{
                      devise: tableau.compte.devise,
                      jours: tableau.jours,
                      depuis: tableau.depuis,
                      jusqua: tableau.jusqua,
                      total: tableau.total,
                      ecarts: tableau.ecarts,
                      campagnes: tableau.campagnes,
                      synchronise: tableau.synchronise,
                    }}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  )
}
