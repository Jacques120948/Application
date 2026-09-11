'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button, Field, Input, Notice } from '@/components/ui'

/**
 * Formulaires de réinitialisation.
 *
 * Le premier ne dit jamais si l'adresse est connue : le message de confirmation est le
 * même dans tous les cas. Le second refuse un lien périmé avec une phrase compréhensible,
 * pas un code d'erreur.
 */

export function ResetRequestForm({ locale }: { locale: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('busy')
    setError(null)
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/mot-de-passe/demande', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email') }),
    })
    const body = (await response.json()) as { message?: string }
    if (!response.ok) {
      setError(body.message ?? "La demande n'a pas abouti.")
      setState('idle')
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <Notice tone="positive" title="Demande enregistrée">
        Si un compte existe à cette adresse, un message vient d’y être envoyé avec un lien
        valable une heure. Pensez à regarder dans les indésirables.
      </Notice>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field
        label="Votre adresse e-mail"
        hint="Celle utilisée pour créer votre compte."
      >
        <Input type="email" name="email" required autoComplete="email" maxLength={200} />
      </Field>
      {error !== null ? <Notice tone="critical">{error}</Notice> : null}
      <Button type="submit" size="large" disabled={state === 'busy'}>
        {state === 'busy' ? 'Envoi…' : 'Recevoir un lien'}
      </Button>
      <p className="m-0 text-center text-sm text-[var(--color-ink-soft)]">
        <a href={`/${locale}/connexion`} className="text-[var(--color-brand)]">
          Revenir à la connexion
        </a>
      </p>
    </form>
  )
}

export function NewPasswordForm({ locale, token }: { locale: string; token: string }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState('busy')
    setError(null)
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/mot-de-passe/nouveau', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: form.get('password') }),
    })
    const body = (await response.json()) as { message?: string }
    if (!response.ok) {
      setError(body.message ?? "Le changement n'a pas abouti.")
      setState('idle')
      return
    }
    setState('done')
    setTimeout(() => router.push(`/${locale}/connexion`), 2500)
  }

  if (state === 'done') {
    return (
      <Notice tone="positive" title="Mot de passe changé">
        Vous pouvez vous connecter avec votre nouveau mot de passe. Toutes vos autres
        sessions ont été fermées.
      </Notice>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field
        label="Nouveau mot de passe"
        hint="Au moins 10 caractères, avec un chiffre ou un symbole."
      >
        <Input
          type="password"
          name="password"
          required
          minLength={10}
          maxLength={200}
          autoComplete="new-password"
        />
      </Field>
      {error !== null ? <Notice tone="critical">{error}</Notice> : null}
      <Button type="submit" size="large" disabled={state === 'busy'}>
        {state === 'busy' ? 'Enregistrement…' : 'Choisir ce mot de passe'}
      </Button>
    </form>
  )
}
