import type { Metadata, Viewport } from 'next'
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
    const scope = `/a/${app.slug}/`
    return {
      title: app.spec.name,
      description: app.spec.tagline,
      // Rend l'application installable : icône sur l'écran d'accueil, ouverture sans barre
      // d'adresse, couleur de la marque jusque dans la barre d'état du téléphone.
      manifest: `${scope}manifest.webmanifest`,
      // iOS ignore le manifeste et lit ses propres balises.
      appleWebApp: {
        capable: true,
        title: app.spec.name.slice(0, 12),
        statusBarStyle: app.spec.theme.mode === 'dark' ? 'black-translucent' : 'default',
      },
      icons: {
        icon: [
          { url: `${scope}icone/192`, sizes: '192x192', type: 'image/png' },
          { url: `${scope}icone/512`, sizes: '512x512', type: 'image/png' },
        ],
        apple: [{ url: `${scope}icone/180`, sizes: '180x180', type: 'image/png' }],
      },
    }
  } catch {
    return { title: 'Application introuvable' }
  }
}

/**
 * Couleur de la barre d'état du téléphone.
 *
 * Elle vit ici et non dans les métadonnées : Next l'y refuse désormais, et sans elle une
 * application installée garde la barre grise du navigateur au lieu de sa propre couleur.
 * C'est un détail qui décide de l'impression d'ensemble.
 */
export async function generateViewport({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Viewport> {
  const { slug } = await params
  const app = await getPublishedApp(slug).catch(() => null)
  return {
    themeColor: app?.spec.theme.colors.primary ?? '#17062f',
    width: 'device-width',
    initialScale: 1,
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
