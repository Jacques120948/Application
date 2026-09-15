import { appBasePath } from '@/lib/apps-domain'
import { appScope } from '@/server/runtime/pwa'
import { getPublishedApp } from '@/server/runtime/published'

/**
 * Agent de service d'une application publiée.
 *
 * Sa portée est `/a/<slug>/` sur le domaine partagé : il ne voit que les pages de cette
 * application, jamais celles d'une autre ni celles d'Evoliia. C'est ce qui rend le procédé
 * utilisable par tous les créateurs sur une même adresse. Sur l'adresse propre d'une
 * application, la portée est la racine, que le sous-domaine isole déjà.
 *
 * Ce qu'il fait, et surtout ce qu'il ne fait pas :
 *
 *   - les pages sont demandées au réseau d'abord, et seulement si le réseau manque, reprises
 *     du cache. L'inverse figerait une application républiée sur son ancienne version ;
 *   - les images, dont l'adresse contient déjà leur identifiant, sont prises du cache en
 *     priorité : leur contenu ne change jamais ;
 *   - **les données ne sont jamais mises en cache.** Fiches, comptes, réponses de
 *     l'assistant : ce sont des données de visiteurs, parfois d'un visiteur connecté sur un
 *     téléphone partagé. Les garder sur l'appareil serait une fuite, pas une optimisation.
 *
 * Le script est généré ici plutôt que posé en fichier statique parce qu'il porte la portée
 * et le nom de cache de l'application, donc son slug.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params
  const app = await getPublishedApp(slug).catch(() => null)
  if (app === null) return new Response('// application introuvable', { status: 404 })

  const scope = appScope(appBasePath(request.headers.get('host'), app.slug))
  // Le nom du cache change à chaque publication : l'ancien est alors supprimé à
  // l'activation, ce qui évite qu'une version corrigée reste masquée par la précédente.
  const cacheName = `evoliia-${app.slug}-${app.versionId}`

  const script = `/* Agent de service de « ${app.spec.name} ». Généré par Evoliia. */
const CACHE = ${JSON.stringify(cacheName)}
const SCOPE = ${JSON.stringify(scope)}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

function isImage(url) {
  return url.pathname.includes('/medias/')
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Images : leur adresse porte leur identifiant, leur contenu ne change jamais.
  if (isImage(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }
            return response
          }),
      ),
    )
    return
  }

  // Pages de cette application : réseau d'abord, cache en secours.
  const isPage = request.mode === 'navigate' && url.pathname.startsWith(SCOPE)
  if (!isPage) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() =>
        caches.match(request).then(
          (hit) =>
            hit ||
            caches.match(SCOPE).then(
              (home) =>
                home ||
                new Response(
                  '<!doctype html><meta charset="utf-8"><title>Hors connexion</title>' +
                    '<body style="font-family:system-ui;padding:2rem;line-height:1.6">' +
                    '<h1>Vous êtes hors connexion</h1>' +
                    '<p>Cette page n\\'a pas encore été consultée. Reconnectez-vous pour la charger.</p>',
                  { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
                ),
            ),
        ),
      ),
  )
})
`

  return new Response(script, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      // Un agent de service périmé est un bogue difficile à diagnostiquer : le navigateur
      // le revérifie à chaque chargement.
      'cache-control': 'no-cache',
      'service-worker-allowed': scope,
    },
  })
}
