import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { compareAudits, listAudits, type Comparaison } from '@/server/audit/plan'
import { readDashboard } from '@/server/audit/service'
import { Card, CardBody, LinkButton } from '@/components/ui'
import { Shell } from '@/components/studio/Shell'

/**
 * L'historique des analyses d'un site.
 *
 * Deux choses à y voir, et elles ne se remplacent pas.
 *
 * **Toutes les analyses, avec leur écart.** Une ligne par analyse, les deux notes, et ce
 * qu'elles ont gagné ou perdu depuis la précédente. C'est la trace du travail, et la seule
 * réponse possible à « est-ce que ça sert à quelque chose ».
 *
 * **Ce qui a bougé entre les deux dernières.** « +4 points » ne s'agit pas ; « trois pages
 * ont retrouvé une description, une nouvelle page est apparue sans titre » s'agit. Les
 * contrôles qui n'ont pas bougé n'y figurent pas : une comparaison qui liste trente lignes
 * dont vingt-huit identiques cache les deux qui comptent.
 */

/** Une date écrite comme on la dit. */
function enClair(date: Date | null, locale: string): string {
  if (date === null) return '—'
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** L'écart, dit et coloré. Zéro se dit « inchangé », pas « +0 ». */
function Delta({ valeur }: { valeur: number | null }) {
  if (valeur === null) return <span className="text-[var(--color-ink-faint)]">—</span>
  if (valeur === 0) return <span className="text-[var(--color-ink-faint)]">inchangé</span>
  const monte = valeur > 0
  return (
    <span
      className="font-medium"
      style={{ color: monte ? 'var(--color-brand-strong)' : 'var(--color-critical)' }}
    >
      {monte ? '+' : '−'}
      {Math.abs(valeur)}
    </span>
  )
}

const SENS: Record<string, { label: string; fond: string; texte: string }> = {
  resolu: { label: 'Réglé', fond: 'var(--color-brand-soft)', texte: 'var(--color-brand-strong)' },
  ameliore: { label: 'En baisse', fond: 'var(--color-brand-soft)', texte: 'var(--color-brand-strong)' },
  aggrave: { label: 'En hausse', fond: 'var(--color-critical-soft)', texte: 'var(--color-critical)' },
  apparu: { label: 'Nouveau', fond: 'var(--color-critical-soft)', texte: 'var(--color-critical)' },
}

const MOTEURS: Record<string, string> = { seo: 'Référencement', geo: 'Moteurs IA' }

function Mouvements({ comparaison, locale }: { comparaison: Comparaison; locale: string }) {
  if (!comparaison.mesurable) {
    return (
      <Card>
        <CardBody>
          <h2 className="m-0 text-lg font-semibold">Comparaison impossible</h2>
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
            L’analyse du {enClair(comparaison.avant.finishedAt, locale)} a été menée avant que
            les contrôles n’existent : elle a relevé vos pages mais n’a rien noté. La
            comparaison reprendra à votre prochaine analyse.
          </p>
        </CardBody>
      </Card>
    )
  }
  if (comparaison.mouvements.length === 0) {
    return (
      <Card>
        <CardBody>
          <h2 className="m-0 text-lg font-semibold">Rien n’a bougé</h2>
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
            Les deux dernières analyses relèvent exactement les mêmes points.
          </p>
        </CardBody>
      </Card>
    )
  }
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-lg font-semibold">Ce qui a bougé</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
          Entre l’analyse du {enClair(comparaison.avant.finishedAt, locale)} et celle du{' '}
          {enClair(comparaison.apres.finishedAt, locale)}. Les contrôles inchangés n’y figurent
          pas.
        </p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {comparaison.mouvements.map((mouvement) => {
            const sens = SENS[mouvement.sens] ?? SENS['ameliore']
            return (
              <li
                key={mouvement.checkId}
                className="flex flex-wrap items-baseline gap-3 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3"
              >
                <span
                  className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold"
                  style={{ background: sens?.fond, color: sens?.texte }}
                >
                  {sens?.label}
                </span>
                <span className="text-sm font-medium">{mouvement.label}</span>
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {MOTEURS[mouvement.engine] ?? mouvement.engine}
                </span>
                <span className="ml-auto text-sm text-[var(--color-ink-soft)]">
                  {mouvement.avant} → {mouvement.apres} page
                  {Math.max(mouvement.avant, mouvement.apres) > 1 ? 's' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

export default async function HistoriquePage({
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
  /*
   * On repasse par le tableau de bord pour choisir le site : il ne cherche l'identifiant
   * demandé que parmi les sites de la personne, et retombe sur le plus récent sinon. Un
   * identifiant venu de l'adresse n'ouvre donc rien.
   */
  const tableau = await readDashboard(user.id, demande.siteId)
  if (tableau === null) redirect(`/${locale}/visibilite`)

  const [analyses, credits] = await Promise.all([
    listAudits(user.id, tableau.site.id),
    availableCredits(user.id),
  ])

  // Deux analyses au moins pour comparer : la première n'a rien derrière elle.
  const comparaison =
    analyses.length < 2
      ? null
      : await compareAudits(
          user.id,
          analyses[1]?.id as string,
          analyses[0]?.id as string,
        )

  return (
    <Shell locale={locale} userName={user.name} credits={credits} screen="visibilite">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Historique</h1>
            <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
              {tableau.site.host} — {analyses.length} analyse{analyses.length > 1 ? 's' : ''}{' '}
              terminée{analyses.length > 1 ? 's' : ''}.
            </p>
          </div>
          <LinkButton href={`/${locale}/visibilite`} variant="secondary">
            Retour au tableau de bord
          </LinkButton>
        </div>

        {comparaison === null ? null : (
          <div className="mb-6">
            <Mouvements comparaison={comparaison} locale={locale} />
          </div>
        )}

        <Card>
          <CardBody>
            <h2 className="m-0 mb-4 text-lg font-semibold">Toutes vos analyses</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                    <th className="pb-2 font-semibold">Date</th>
                    <th className="pb-2 font-semibold">Pages</th>
                    <th className="pb-2 font-semibold">Référencement</th>
                    <th className="pb-2 font-semibold">Moteurs IA</th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((analyse) => (
                    <tr key={analyse.id} className="border-t border-[var(--color-line)]">
                      <td className="py-3 pr-4">{enClair(analyse.finishedAt, locale)}</td>
                      <td className="py-3 pr-4 text-[var(--color-ink-soft)]">
                        {analyse.pagesCrawled}
                      </td>
                      <td className="py-3 pr-4">
                        <strong>{analyse.seoScore ?? '—'}</strong>{' '}
                        <Delta valeur={analyse.seoDelta} />
                      </td>
                      <td className="py-3">
                        <strong>{analyse.geoScore ?? '—'}</strong>{' '}
                        <Delta valeur={analyse.geoDelta} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/*
              Les notes ne se comparent qu'à elles-mêmes : les seuils et les poids peuvent
              changer d'une version à l'autre du produit, et le dire vaut mieux que de
              laisser quelqu'un conclure d'une baisse qu'il a cassé quelque chose.
            */}
            <p className="mt-4 mb-0 text-xs text-[var(--color-ink-faint)]">
              Les notes sont calculées avec les contrôles en vigueur au moment de l’analyse. Un
              contrôle ajouté depuis peut expliquer une baisse sans que rien n’ait changé sur
              votre site.
            </p>
          </CardBody>
        </Card>
      </div>
    </Shell>
  )
}
