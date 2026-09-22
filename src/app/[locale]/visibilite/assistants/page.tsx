import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import {
  etatPassage,
  lireFrequences,
  plateformesSuivies,
  tableauIA,
} from '@/server/audit/visibilite-ia'
import { actionCosts, type ActionCost } from '@/server/billing/action-costs'
import { plateformesDisponibles } from '@/server/integrations/providers/assistants'
import { Shell } from '@/components/studio/Shell'
import { VisibiliteIA } from '@/components/studio/VisibiliteIA'
import { TableauIA } from '@/components/studio/TableauIA'

/**
 * Votre marque dans les assistants.
 *
 * Le seul écran du produit qui mesure ce qu'Evoliia s'est toujours interdit de promettre.
 * Il doit donc être le plus prudent de tous : une fréquence, écrite en deux parties, avec
 * le passage consultable et la liste de ce qui n'est pas mesuré.
 */
export const maxDuration = 60

/** La fenêtre de lecture. Assez longue pour accumuler, assez courte pour rester actuelle. */
const JOURS = 30

export default async function AssistantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; vue?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const [credits, tableau] = await Promise.all([
    availableCredits(user.id),
    readDashboard(user.id, demande.siteId),
  ])
  if (tableau === null) redirect(`/${locale}/visibilite`)

  /*
   * Deux vues sur la même donnée, et l'onglet voyage dans l'adresse : elle se met en favori
   * et survit au rafraîchissement, comme le filtre par pays et le rythme du calendrier.
   */
  const surLesQuestions = demande.vue === 'questions'
  const [frequences, couts, bord, passage, suivies] = await Promise.all([
    lireFrequences(user.id, tableau.site.id, JOURS),
    actionCosts(),
    tableauIA(user.id, tableau.site.id, JOURS),
    etatPassage(user.id, tableau.site.id),
    plateformesSuivies(user.id, tableau.site.id),
  ])
  /*
   * Le prix d'une question chez **un** assistant : le total se compte à l'écran, en
   * multipliant par les assistants réellement suivis. Le repli à 1 crédit reproduit
   * l'ancien forfait à trois assistants, pour qu'un catalogue muet ne renchérisse rien.
   */
  const cout = couts.find((ligne: ActionCost) => ligne.id === 'visibilite-ia-plateforme')?.max ?? 1
  const plateformes = plateformesDisponibles()

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="assistants"
      siteId={tableau.site.id}
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/visibilite?siteId=${tableau.site.id}`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">
          Votre marque dans les assistants
        </h1>
        <p className="mt-2 mb-8 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Sortez-vous quand un client pose sa question à une IA ? Personne ne peut le
          promettre — mais on peut le mesurer, en posant la question et en lisant la réponse.
        </p>

        <nav className="mb-6 flex flex-wrap gap-2" aria-label="Vue">
          {[
            { cle: '', label: 'Vue d’ensemble' },
            { cle: 'questions', label: 'Mes questions' },
          ].map((onglet) => {
            const actif = (onglet.cle === 'questions') === surLesQuestions
            return (
              <a
                key={onglet.label}
                href={`/${locale}/visibilite/assistants?siteId=${tableau.site.id}${onglet.cle === '' ? '' : `&vue=${onglet.cle}`}`}
                aria-current={actif ? 'true' : undefined}
                className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
                  actif
                    ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                    : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
                }`}
              >
                {onglet.label}
              </a>
            )
          })}
        </nav>

        {plateformes.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
            <p className="m-0 text-sm leading-relaxed">
              Aucun assistant n’est configuré sur cette installation. Cette mesure demande au
              moins une clé d’API côté serveur.
            </p>
          </div>
        ) : !surLesQuestions ? (
          <TableauIA tableau={bord} />
        ) : (
          <VisibiliteIA
            siteId={tableau.site.id}
            host={tableau.site.host}
            initiales={frequences}
            plateformes={plateformes}
            suivies={suivies}
            cout={cout}
            jours={JOURS}
            locale={locale}
            passage={passage}
          />
        )}
      </div>
    </Shell>
  )
}
