'use client'

import { useEffect, useState, type FormEvent } from 'react'

/**
 * Connexion, inscription et mot de passe oublié des utilisateurs finaux d'une application
 * générée.
 *
 * Un compte qui ne peut pas être récupéré n'est pas un compte : le jour où un visiteur
 * oublie son mot de passe, il perd tout ce qu'il a saisi dans l'application, et le créateur
 * n'a aucun moyen de le lui rendre. Le parcours tient donc ici, dans le même encadré que la
 * connexion, sans page supplémentaire à publier.
 *
 * Le formulaire de demande répond toujours la même chose : c'est le serveur qui décide, et
 * il ne dit jamais si l'adresse est inscrite. Afficher « aucun compte à cette adresse »
 * transformerait ce champ en annuaire des visiteurs de l'application.
 */

type Mode = 'login' | 'signup' | 'forgot' | 'renew'

/** Le jeton porté par l'adresse, quand on arrive depuis un lien de réinitialisation. */
function tokenFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('jeton')
  return value !== null && value.length >= 10 ? value : null
}

/** Retire le jeton de la barre d'adresse : il est consommé, il n'a plus à traîner. */
function forgetToken() {
  const url = new URL(window.location.href)
  url.searchParams.delete('jeton')
  window.history.replaceState(null, '', url.toString())
}

export function AuthPanel({
  projectId,
  currentEmail,
  allowSignup,
}: {
  projectId: string
  currentEmail: string | null
  allowSignup: boolean
}) {
  const [mode, setMode] = useState<Mode>('login')
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Lu après le rendu : le serveur ne connaît pas l'adresse du navigateur, et le jeton n'a
  // aucune raison de voyager dans le HTML de la page.
  useEffect(() => {
    const found = tokenFromUrl()
    if (found === null) return
    setToken(found)
    setMode('renew')
  }, [])

  async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    const response = await fetch(`/api/app/${projectId}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    // Une réponse qui n'est pas du JSON vient de l'hébergeur : elle ne doit pas laisser le
    // bouton en attente pour toujours.
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    if (body === null) return { ok: false, message: 'La connexion a échoué. Réessayez.' }
    return response.ok ? { ok: true } : { ok: false, ...(body.message !== undefined ? { message: body.message } : {}) }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    // L'élément est retenu avant toute attente : après un `await`, React a pu vider
    // `currentTarget`, et la remise à zéro tomberait alors sur `null`.
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setError(null)
    setNotice(null)

    if (mode === 'forgot') {
      const result = await post({ action: 'reset', email: form.get('email') })
      setBusy(false)
      if (!result.ok) {
        setError(result.message ?? "La demande n'a pas abouti.")
        return
      }
      formElement.reset()
      // Message volontairement identique, que l'adresse soit inscrite ou non.
      setNotice(
        'Si un compte existe à cette adresse, un lien vient de partir. Il est valable une heure.',
      )
      return
    }

    if (mode === 'renew') {
      const result = await post({
        action: 'reset-confirm',
        token,
        password: form.get('password'),
      })
      setBusy(false)
      if (!result.ok) {
        setError(result.message ?? "Le changement n'a pas abouti.")
        return
      }
      forgetToken()
      setToken(null)
      setMode('login')
      setNotice('Mot de passe changé. Connectez-vous avec le nouveau.')
      return
    }

    const result = await post({
      action: mode,
      email: form.get('email'),
      password: form.get('password'),
    })
    if (!result.ok) {
      setError(result.message ?? "La connexion n'a pas abouti.")
      setBusy(false)
      return
    }
    window.location.reload()
  }

  async function logout() {
    await fetch(`/api/app/${projectId}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    })
    window.location.reload()
  }

  const controlStyle = { borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }

  // Le lien de réinitialisation prime sur la session en cours : changer le mot de passe
  // ferme de toute façon toutes les sessions ouvertes, celle-ci comprise.
  if (currentEmail !== null && mode !== 'renew') {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <p className="m-0 text-sm">Connecté en tant que {currentEmail}.</p>
        <button type="button" onClick={() => void logout()} className="text-sm underline">
          Se déconnecter
        </button>
      </div>
    )
  }

  const titles: Record<Mode, string> = {
    login: 'Se connecter',
    signup: 'Créer mon compte',
    forgot: 'Recevoir un lien',
    renew: 'Choisir ce mot de passe',
  }

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
      {mode === 'renew' ? (
        <p className="m-0 text-sm opacity-80">Choisissez votre nouveau mot de passe.</p>
      ) : null}
      {mode === 'forgot' ? (
        <p className="m-0 text-sm opacity-80">
          Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.
        </p>
      ) : null}

      {mode !== 'renew' ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Adresse e-mail</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="w-full rounded-[var(--app-radius)] border px-3 py-2 text-sm"
            style={controlStyle}
          />
        </label>
      ) : null}

      {mode !== 'forgot' ? (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">
            {mode === 'renew' ? 'Nouveau mot de passe' : 'Mot de passe'}
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={10}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full rounded-[var(--app-radius)] border px-3 py-2 text-sm"
            style={controlStyle}
          />
          {mode === 'login' ? null : (
            <span className="mt-1 block text-xs opacity-70">
              Au moins 10 caractères, avec un chiffre ou un symbole.
            </span>
          )}
        </label>
      ) : null}

      {error !== null ? (
        <p role="alert" className="m-0 text-sm" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p role="status" className="m-0 text-sm font-medium">
          {notice}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-[var(--app-radius)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: 'var(--app-primary)' }}
      >
        {busy ? 'Envoi…' : titles[mode]}
      </button>

      <div className="flex flex-wrap items-center gap-4">
        {allowSignup && (mode === 'login' || mode === 'signup') ? (
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError(null)
              setNotice(null)
            }}
            className="text-sm underline"
          >
            {mode === 'login' ? 'Créer un compte' : "J'ai déjà un compte"}
          </button>
        ) : null}
        {mode === 'login' ? (
          <button
            type="button"
            onClick={() => {
              setMode('forgot')
              setError(null)
              setNotice(null)
            }}
            className="text-sm underline"
          >
            Mot de passe oublié
          </button>
        ) : null}
        {mode === 'forgot' || mode === 'renew' ? (
          <button
            type="button"
            onClick={() => {
              if (mode === 'renew') forgetToken()
              setToken(null)
              setMode('login')
              setError(null)
              setNotice(null)
            }}
            className="text-sm underline"
          >
            Revenir à la connexion
          </button>
        ) : null}
      </div>
    </form>
  )
}
