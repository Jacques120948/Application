import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AppError } from '@/lib/errors'
import { getPublishedApp, recordVisit } from '@/server/runtime/published'
import { getEndUser } from '@/server/runtime/end-users'
import { HOME_PATH } from '@/server/spec/validate'
import { AppPageView } from '@/components/runtime/AppPageView'

/** Runtime public d'une application publiée. Sert la version figée, jamais le brouillon. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  try {
    const app = await getPublishedApp(slug)
    return { title: app.spec.name, description: app.spec.tagline }
  } catch {
    return { title: 'Application introuvable' }
  }
}

export default async function PublishedAppPage({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>
}) {
  const { slug, path } = await params

  let app
  try {
    app = await getPublishedApp(slug)
  } catch (error) {
    if (error instanceof AppError) notFound()
    throw error
  }

  const wanted = path?.[0] ?? HOME_PATH
  const page = app.spec.pages.find((candidate) => candidate.path === wanted)
  if (page === undefined) notFound()

  await recordVisit(app.projectId, wanted)
  const endUser = await getEndUser(app.projectId)

  return (
    <AppPageView
      spec={app.spec}
      page={page}
      context={{
        projectId: app.projectId,
        basePath: `/a/${app.slug}`,
        endUserEmail: endUser?.email ?? null,
        preview: false,
      }}
    />
  )
}
