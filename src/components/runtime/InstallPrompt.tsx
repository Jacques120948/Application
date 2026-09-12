'use client'

import { useEffect, useState } from 'react'

/**
 * Installation de l'application sur l'écran d'accueil.
 *
 * Trois comportements, parce que les navigateurs ne se ressemblent pas :
 *
 *   - **Android et ordinateurs de bureau** proposent eux-mêmes l'installation, par un
 *     événement que le navigateur envoie quand il juge l'application éligible. On le met de
 *     côté pour le rejouer au moment où la personne clique, plutôt que de lui imposer une
 *     fenêtre dès l'arrivée ;
 *   - **iOS** n'expose aucun moyen de déclencher l'installation. Il faut donc expliquer le
 *     geste, en une phrase, et seulement à qui est sur iOS ;
 *   - **déjà installée** : rien n'est proposé. Une invitation à installer ce qui l'est
 *     déjà est le meilleur moyen de passer pour une publicité.
 *
 * Rien n'est affiché tant que le navigateur n'a pas confirmé l'éligibilité : mieux vaut pas
 * de bouton qu'un bouton qui ne marche pas.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt({ appName, scope }: { appName: string; scope: string }) {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    /*
     * L'agent de service est enregistré même si l'installation n'est pas proposée : il sert
     * aussi à ce que l'application s'ouvre hors connexion, ce qui vaut pour tout le monde.
     */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${scope}sw.js`, { scope }).catch(() => {
        // Un agent refusé (navigation privée, réglage strict) ne doit rien casser :
        // l'application continue de fonctionner en ligne, simplement sans cache.
      })
    }

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true
    if (standalone) return

    const onPrompt = (event: Event) => {
      event.preventDefault()
      setDeferred(event as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', () => setDeferred(null))

    // iOS ne signale rien : on le reconnaît au navigateur, faute de mieux.
    const ua = window.navigator.userAgent
    const isIos = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS/.test(ua)
    if (isIos) setIosHint(true)

    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [scope])

  if (dismissed) return null
  if (deferred === null && !iosHint) return null

  return (
    <div className="fixed inset-x-3 bottom-3 z-30 mx-auto max-w-md sm:left-auto sm:right-4 sm:mx-0">
      <div
        className="flex items-start gap-3 rounded-[var(--app-radius)] border p-4"
        style={{
          borderColor: 'var(--app-border)',
          background: 'var(--app-surface)',
          boxShadow: 'var(--app-shadow-lg)',
        }}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--app-radius)] text-sm font-bold"
          style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)' }}
        >
          ↓
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold">Installer {appName}</p>
          {deferred !== null ? (
            <p className="m-0 mt-1 text-sm opacity-75">
              Pour l’ouvrir depuis votre écran d’accueil, sans passer par le navigateur.
            </p>
          ) : (
            <p className="m-0 mt-1 text-sm opacity-75">
              Touchez le bouton de partage, puis « Sur l’écran d’accueil ».
            </p>
          )}
          {deferred !== null ? (
            <button
              type="button"
              className="mt-3 rounded-full px-4 py-2 text-sm font-semibold"
              style={{ background: 'var(--app-gradient)', color: 'var(--app-on-gradient)' }}
              onClick={() => {
                void deferred.prompt().then(() => setDeferred(null))
              }}
            >
              Installer
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Ne plus proposer"
          className="shrink-0 text-lg leading-none opacity-50"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </div>
    </div>
  )
}
