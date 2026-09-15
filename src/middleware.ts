import { NextResponse, type NextRequest } from 'next/server'
import { slugFromHost } from '@/lib/apps-domain'

/**
 * Routage des adresses propres.
 *
 * Une application publiée sur son sous-domaine — `mon-appli-a1b2c3.evoliia.app` — est
 * servie par les mêmes pages que sous `/a/mon-appli-a1b2c3`. Plutôt que de dupliquer le
 * runtime, on réécrit l'adresse ici : le navigateur garde le sous-domaine, Next sert la
 * route existante.
 *
 * Ce qui n'est jamais réécrit : les routes d'interface (`/api/`), les fichiers de Next
 * (`/_next/`) et les fichiers statiques. Les premières sont appelées telles quelles par
 * les applications, et la vérification d'origine les accepte puisqu'elle compare l'origine
 * à l'hôte de la requête, non à celui d'Evoliia.
 *
 * Sans domaine d'applications configuré, `slugFromHost` répond toujours `null` et la
 * requête passe sans être touchée.
 */
export function middleware(request: NextRequest) {
  const slug = slugFromHost(request.headers.get('host'))
  if (slug === null) return NextResponse.next()

  const url = request.nextUrl.clone()
  const path = url.pathname === '/' ? '' : url.pathname
  url.pathname = `/a/${slug}${path}`
  return NextResponse.rewrite(url)
}

/*
 * Tout est réécrit sauf trois familles : les routes d'interface, que les applications
 * appellent telles quelles — images comprises, servies sous `/api/app/…` — les fichiers
 * bâtis par Next, et l'icône du site. Le manifeste et l'agent de service, eux, doivent
 * bien être réécrits : ils portent une extension mais appartiennent à l'application.
 */
export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico).*)'],
}
