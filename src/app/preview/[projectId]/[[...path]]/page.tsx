import { notFound } from 'next/navigation'
import { AppError } from '@/lib/errors'
import { getCurrentUser } from '@/server/auth/session'
import { resolveRuntimeSpec } from '@/server/runtime/context'
import { getEndUser } from '@/server/runtime/end-users'
import { HOME_PATH } from '@/server/spec/validate'
import { AppPageView } from '@/components/runtime/AppPageView'

/**
 * Aperçu du brouillon, réservé au propriétaire.
 *
 * L'accès est refusé (« introuvable ») à toute autre personne, y compris connectée.
 * Le rendu utilise exactement le même moteur que l'application publiée : ce que le
 * créateur voit ici est ce que ses visiteurs verront.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ projectId: string; path?: string[] }>
}) {
  const { projectId, path } = await params
  const user = await getCurrentUser()
  if (user === null) notFound()

  let runtime
  try {
    runtime = await resolveRuntimeSpec(projectId)
  } catch (error) {
    if (error instanceof AppError) notFound()
    throw error
  }
  if (!runtime.isOwnerPreview) notFound()

  const wanted = path?.[0] ?? HOME_PATH
  const page =
    runtime.spec.pages.find((candidate) => candidate.path === wanted) ??
    runtime.spec.pages.find((candidate) => candidate.path === HOME_PATH)
  if (page === undefined) notFound()

  const endUser = await getEndUser(runtime.projectId)

  return (
    <AppPageView
      spec={runtime.spec}
      page={page}
      context={{
        projectId: runtime.projectId,
        basePath: `/preview/${runtime.projectId}`,
        endUserEmail: endUser?.email ?? null,
        preview: true,
      }}
    />
  )
}
