import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readPlan } from '@/server/audit/plan'
import { listSites, readDashboard } from '@/server/audit/service'
import { parseTargetUrl } from '@/server/audit/net'
import { Shell } from '@/components/studio/Shell'
import { SiteBoard } from '@/components/studio/SiteBoard'
import { TableauVisibilite } from '@/components/studio/TableauVisibilite'

/**
 * L'écran de la visibilité : le tableau de bord, puis l'ajout d'un site.
 *
 * Il sert deux visites qui n'ont rien à voir, et l'ordre des blocs le dit. Quelqu'un qui
 * arrive de la page d'accueil n'a rien à regarder : il veut coller son adresse, et celle
 * qu'il avait déjà saisie l'accompagne jusqu'ici — la retaper serait la première chose qu'on
 * lui demande, juste après lui avoir promis qu'on ne lui demanderait rien. Quelqu'un qui
 * revient une semaine plus tard veut savoir si ce qu'il a corrigé a servi : il trouve ses
 * deux notes et leur écart en haut, et le formulaire attend plus bas.
 *
 * Les priorités sont limitées à huit. Un audit qui rend trente remarques se referme, et
 * « par quoi je commence » est la seule question que se pose quelqu'un devant cet écran.
 */

/** Au-delà, ce n'est plus un plan d'action, c'est une liste. */
const PRIORITES_MAX = 8

export default async function VisibilitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ site?: string; siteId?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  /*
   * L'adresse vient du navigateur : elle passe par le contrôle du robot avant d'être
   * réaffichée. Ce qui ne passe pas est oublié, sans mettre l'écran en échec.
   */
  const prefill = (() => {
    if (demande.site === undefined || demande.site === '') return ''
    try {
      return parseTargetUrl(demande.site).origin
    } catch {
      return ''
    }
  })()

  /*
   * L'identifiant de site demandé n'ouvre aucun droit : `readDashboard` ne le cherche que
   * parmi les sites déjà filtrés par la portée de l'utilisateur, et retombe sur le plus
   * récent quand il n'y correspond rien.
   */
  const [sites, credits, tableau] = await Promise.all([
    listSites(user.id),
    availableCredits(user.id),
    readDashboard(user.id, demande.siteId),
  ])

  /*
   * Le plan reprend les constats du dernier audit avec leur état. Il est borné : un audit qui
   * rend trente lignes se referme, et « par quoi je commence » est la seule question que se
   * pose quelqu'un devant cet écran. L'historique montre le reste.
   */
  const plan = tableau === null ? null : await readPlan(user.id, tableau.site.id)
  const lignes = (plan?.lignes ?? []).slice(0, PRIORITES_MAX)

  return (
    <Shell locale={locale} userName={user.name} credits={credits} screen="visibilite">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Votre visibilité</h1>
        <p className="mt-2 mb-8 text-sm text-[var(--color-ink-soft)]">
          {tableau === null
            ? 'Ajoutez un site, lancez son analyse, et suivez ce qu’il faut corriger.'
            : 'Deux notes, ce qu’il faut corriger en premier, et ce que ça a donné depuis la dernière fois.'}
        </p>

        {tableau === null ? null : (
          <div className="mb-10">
            <TableauVisibilite
              locale={locale}
              site={tableau.site}
              audit={tableau.audit}
              precedent={tableau.precedent}
              historique={tableau.historique}
              autresSites={tableau.autresSites}
              lignes={lignes}
              reglees={plan?.reglees ?? []}
            />
          </div>
        )}

        <SiteBoard
          sites={sites.map((site) => ({
            id: site.id,
            host: site.host,
            label: site.label,
            dernierAudit: site.dernierAudit,
          }))}
          prefill={prefill}
          locale={locale}
        />
      </div>
    </Shell>
  )
}
