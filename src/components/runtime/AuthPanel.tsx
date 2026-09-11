'use client'

import { useState, type FormEvent } from 'react'

/** Connexion et inscription des utilisateurs finaux d'une application générée. */
export function AuthPanel({
  projectId,
  currentEmail,
  allowSignup,
}: {
  projectId: string
  currentEmail: string | null
  allowSignup: boolean
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const form = new FormData(event.currentTarget)
    const response = await fetch(`/api/app/${projectId}/auth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: mode,
        email: form.get('email'),
        password: form.get('password'),
      }),
    })
    const body = (await response.json()) as { message?: string }
    if (!response.ok) {
      setError(body.message ?? "La connexion n'a pas abouti.")
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

  if (currentEmail !== null) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <p className="m-0 text-sm">Connecté en tant que {currentEmail}.</p>
        <button type="button" onClick={() => void logout()} className="text-sm underline">
          Se déconnecter
        </button>
      </div>
    )
  }

  const controlStyle = { borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }

  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
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
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Mot de passe</span>
        <input
          type="password"
          name="password"
          required
          minLength={10}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          className="w-full rounded-[var(--app-radius)] border px-3 py-2 text-sm"
          style={controlStyle}
        />
        {mode === 'signup' ? (
          <span className="mt-1 block text-xs opacity-70">
            Au moins 10 caractères, avec un chiffre ou un symbole.
          </span>
        ) : null}
      </label>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded-[var(--app-radius)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: 'var(--app-primary)' }}
      >
        {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
      </button>

      {allowSignup ? (
        <button
          type="button"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          className="justify-self-start text-sm underline"
        >
          {mode === 'login' ? "Créer un compte" : "J'ai déjà un compte"}
        </button>
      ) : null}
    </form>
  )
}
