import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { appBasePath, appHost, publicAppUrl } from '@/lib/apps-domain'
import { AppError } from '@/lib/errors'
import { getPublishedApp, recordVisit } from '@/server/runtime/published'
import { getEndUser } from '@/server/runtime/end-users'
import { paymentContext } from '@/server/runtime/payments'
import { computePageMetrics } from '@/server/runtime/metrics'
import { HOME_PATH } from '@/server/spec/validate'
import { isIndexable, jsonLd, pageDescription, pageTitle, structuredData } from '@/server/seo/visibility'
import { AppPageView } from '@/components/runtime/AppPageView'
import { LiaWidget } from '@/components/runtime/LiaWidget'
import { readPublicSupportSettings } from '@/server/support/settings'

/** Runtime public d'une application publiée. Sert la version figée, jamais le brouillon. */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; path?: string[] }>
}): Promise<Metadata> {
  const { slug, path } = await params
  try {
    const app = await getPublishedApp(slug)
    const scope = `${appBasePath((await headers()).get('host'), app.slug)}/`
    const page = app.spec.pages.find((candidate) => candidate.path === (path?.[0] ?? HOME_PATH))
    return {
      /*
        Le titre et la description viennent de la page, pas de l'application. Douze pages
        qui se présentent de la même façon, ce sont onze pages qui ne seront trouvées sur
        rien : un moteur ne garde qu'un représentant par contenu identique.
      */
      title: page === undefined ? app.spec.name : pageTitle(app.spec, page),
      description: page === undefined ? app.spec.tagline : pageDescription(app.spec, page),
      /*
        Une page réservée aux personnes connectées ne montre à un robot qu'un formulaire de
        connexion : la laisser indexer classerait l'application sur ce formulaire plutôt
        que sur ce qu'elle fait. Une page publique marquée « hors index » est écartée pour
        une autre raison — son créateur sait qu'elle n'a rien à répondre à une recherche.
      */
      robots: page !== undefined && !isIndexable(page) ? { index: false, follow: true } : undefined,
      /*
        Les deux adresses servent la même application : l'ancienne, déjà partagée, et
        l'adresse propre. Le lien canonique désigne la seconde pour qu'un moteur de
        recherche n'y voie pas deux pages concurrentes.
      */
      alternates: appHost(app.slug) === null ? undefined : { canonical: publicAppUrl(app.slug) },
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
  searchParams,
}: {
  params: Promise<{ slug: string; path?: string[] }>
  searchParams: Promise<{ paiement?: string }>
}) {
  const { slug, path } = await params
  const { paiement } = await searchParams
  const host = (await headers()).get('host')

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
  const [endUser, lia] = await Promise.all([getEndUser(app.projectId), readPublicSupportSettings(app.projectId)])
  const [payments, metrics] = await Promise.all([
    paymentContext({ projectId: app.projectId, ownerId: app.ownerId }, endUser?.id ?? null),
    computePageMetrics({
      projectId: app.projectId,
      spec: app.spec,
      page,
      endUserId: endUser?.id ?? null,
    }),
  ])

  return (
    <>
    {/*
      Ce que les moteurs lisent sans l'afficher : qui est derrière ce site, et les questions
      déjà écrites sur cette page. Sérialisé et échappé par `jsonLd`, jamais interpolé tel
      quel — une spécification ne doit pas pouvoir refermer la balise qui la porte.
    */}
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLd(structuredData(app.spec, app.slug, page)) }}
    />
    <AppPageView
      spec={app.spec}
      page={page}
      context={{
        projectId: app.projectId,
        basePath: appBasePath(host, app.slug),
        endUserEmail: endUser?.email ?? null,
        preview: false,
        metrics,
        payments: {
          enabled: payments.enabled,
          purchase: payments.purchase,
          returned: paiement === 'succes' ? 'succes' : paiement === 'annule' ? 'annule' : null,
        },
      }}
    />
    {lia !== null ? (
      <LiaWidget
        projectId={app.projectId}
        locale={app.spec.locale}
        displayName={lia.displayName}
        greeting={lia.greeting}
        position={lia.position}
        accentColor={lia.accentColor}
        hasAccount={endUser !== null}
        theme={app.spec.theme}
      />
    ) : null}
    </>
  )
}
