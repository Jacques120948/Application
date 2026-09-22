import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { estimerCorrection } from '@/server/audit/corrections'
import { lireConversion } from '@/server/audit/conversion'
import { readDashboard } from '@/server/audit/service'
import { membre } from '@/lib/equipe'
import { Shell } from '@/components/studio/Shell'
import { PlanAction } from '@/components/studio/PlanAction'
import { AnneauConversion, CarteConstat, MotDeCleo } from '@/components/studio/Conversion'

/**
 * L'écran de Cleo : ce qui empêche vos visiteurs de devenir clients.
 *
 * Il répond à une question que les autres écrans ne posent pas. Léa dit si le site est
 * trouvable, Gia si une machine peut s'en servir ; Cleo demande ce qu'il advient de
 * quelqu'un une fois arrivé. Un site peut être irréprochable pour les deux premières et
 * perdre tout le monde à l'arrivée.
 *
 * **Rien ici ne mesure une vente.** Evoliia n'a aucune source reliée : ni panier, ni
 * chiffre d'affaires, ni abandon. Tout ce que cet écran montre est un constat de page —
 * ce qui manque, et ce que ça peut coûter en hésitation. La réserve sous la note le dit,
 * et elle n'est pas décorative : sans elle, un chiffre sur cent se lit comme un taux de
 * conversion.
 *
 * **Trois priorités puis ce qui se règle vite.** L'ordre n'est pas le même : les priorités
 * sont classées par points perdus, les corrections rapides par effort. Séparer les deux
 * évite la promesse tacite qu'un bouton renommé rapporte autant qu'une page de réassurance.
 */
export const maxDuration = 60

export default async function ConversionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const [credits, tableau] = await Promise.all([
    availableCredits(user.id),
    readDashboard(user.id, demande.siteId),
  ])
  /*
   * Pas encore d'audit terminé : il n'y a rien à montrer ici, et l'écran de la visibilité
   * est celui qui sait accueillir quelqu'un qui n'a pas encore de site analysé.
   */
  if (tableau === null) redirect(`/${locale}/visibilite`)

  const [vue, cout] = await Promise.all([
    lireConversion(user.id, tableau.site.id),
    estimerCorrection(),
  ])

  const cleo = membre('cro')
  const note = tableau.audit.croScore

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="conversion"
      siteId={tableau.site.id}
      sites={[tableau.site, ...tableau.autresSites]}
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/visibilite?siteId=${tableau.site.id}`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">Votre conversion</h1>
        <p className="mt-2 mb-8 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {cleo?.name ?? 'Cleo'} lit vos pages comme les lirait un visiteur qui hésite : ce
          qu’on comprend en arrivant, ce qui dit quoi faire, et ce qui répond aux questions
          qu’on se pose avant d’acheter.
        </p>

        <div className="grid gap-6">
          <MotDeCleo
            hote={tableau.site.host}
            pages={tableau.audit.pagesCrawled}
            aTraiter={vue === null ? 0 : vue.lignes.length}
            finishedAt={tableau.audit.finishedAt?.toISOString() ?? null}
            locale={locale}
            href={`/${locale}/visibilite/equipe?siteId=${tableau.site.id}&agent=cro`}
          />

          <AnneauConversion
            note={note}
            avant={tableau.precedent?.croScore ?? null}
            quand={tableau.precedent?.finishedAt?.toISOString() ?? null}
            locale={locale}
          />

          {/*
            Les trois priorités, avant le plan complet. Elles en font partie — ce sont les
            mêmes lignes — mais quelqu'un qui ouvre cet écran veut savoir par quoi
            commencer, pas parcourir une liste pour le déduire.
          */}
          {vue === null || vue.priorites.length === 0 ? null : (
            <section>
              <h2 className="m-0 text-lg font-semibold">Par quoi commencer</h2>
              <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
                Les trois points qui pèsent le plus sur la note, dans cet ordre.
              </p>
              <ol className="m-0 grid list-none gap-3 p-0">
                {vue.priorites.map((ligne, rang) => (
                  <li key={ligne.checkId}>
                    <CarteConstat
                      rang={rang + 1}
                      label={ligne.label}
                      why={ligne.why}
                      severity={ligne.severity}
                      affected={ligne.affected}
                      examined={ligne.examined}
                      scope={ligne.scope}
                      sample={ligne.sample}
                    />
                  </li>
                ))}
              </ol>
            </section>
          )}

          {vue === null || vue.rapides.length === 0 ? null : (
            <section>
              <h2 className="m-0 text-lg font-semibold">Ce qui se règle aujourd’hui</h2>
              <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
                Une balise, un libellé, des champs en trop : chacun se corrige sans rien
                produire de nouveau. Ce classement dit l’effort, pas le gain — personne ne
                sait ce qu’un bouton renommé rapporte.
              </p>
              <ul className="m-0 grid list-none gap-3 p-0">
                {vue.rapides.map((ligne) => (
                  <li key={ligne.checkId}>
                    <CarteConstat
                      label={ligne.label}
                      why={ligne.why}
                      severity={ligne.severity}
                      affected={ligne.affected}
                      examined={ligne.examined}
                      scope={ligne.scope}
                      sample={ligne.sample}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="mb-4">
              <h2 className="m-0 text-lg font-semibold">Tout ce que Cleo a relevé</h2>
              <p className="mt-1 mb-0 text-sm text-[var(--color-ink-soft)]">
                Marquez ce que vous avez corrigé : la prochaine analyse le vérifiera.
              </p>
            </div>
            {vue === null || vue.lignes.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                <h3 className="m-0 text-base font-semibold">Rien à corriger pour l’instant</h3>
                <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
                  Tous les contrôles de conversion applicables à ce site sont passés.
                  Relancez une analyse après votre prochaine mise à jour.
                </p>
              </div>
            ) : (
              <PlanAction
                siteId={tableau.site.id}
                lignes={vue.lignes}
                locale={locale}
                cout={cout}
              />
            )}

            {vue === null || vue.reglees.length === 0 ? null : (
              <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                <h3 className="m-0 text-base font-semibold">Réglé depuis</h3>
                <p className="mt-1 mb-3 text-sm text-[var(--color-ink-soft)]">
                  Ces points ne remontent plus dans la dernière analyse.
                </p>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {vue.reglees.map((reglee) => (
                    <li
                      key={reglee.checkId}
                      className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-3 py-1 text-sm text-[var(--color-ink-soft)]"
                    >
                      {reglee.state === 'ignored' ? '— ' : '✓ '}
                      {reglee.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </div>
    </Shell>
  )
}
