'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button, Field, Input, Notice } from '@/components/ui'

/** Formulaire d'inscription et de connexion au studio. */
export function AuthForm({
  mode,
  locale,
  labels,
  requiresCode = false,
  nextPath,
}: {
  mode: 'register' | 'login'
  locale: string
  labels: { email: string; password: string; name: string; passwordHint: string; submit: string }
  /** Vrai lorsque l'installation est réservée aux personnes disposant d'un code. */
  requiresCode?: boolean
  /**
   * Où conduire la personne après son inscription. Choisi par la page, jamais par
   * l'utilisateur : un chemin arbitraire venant de l'URL serait une redirection ouverte.
   */
  nextPath?: string
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const payload =
      mode === 'register'
        ? {
            email: form.get('email'),
            password: form.get('password'),
            name: form.get('name') || undefined,
            locale,
            ...(requiresCode ? { invitationCode: form.get('invitationCode') } : {}),
          }
        : { email: form.get('email'), password: form.get('password') }

    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = (await response.json()) as { message?: string }

    if (!response.ok) {
      setError(body.message ?? "L'opération n'a pas abouti.")
      setBusy(false)
      return
    }
    /*
     * Une inscription suit le chemin choisi par la page qui l'a ouverte ; une connexion
     * revient à la visibilité. C'est l'écran de retour du produit — on se reconnecte pour
     * savoir si ce qu'on a corrigé a servi —, et il accueille aussi bien quelqu'un qui n'a
     * encore aucun site : il lui montre alors le formulaire, pas une page vide.
     */
    const afterRegister = nextPath ?? `/${locale}/objectif`
    router.push(mode === 'register' ? afterRegister : `/${locale}/visibilite`)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {mode === 'register' && requiresCode ? (
        <Field
          label="Code d'accès"
          hint="Cette version est réservée aux personnes invitées."
        >
          <Input name="invitationCode" required maxLength={120} autoComplete="off" />
        </Field>
      ) : null}

      {mode === 'register' ? (
        <Field label={labels.name}>
          <Input name="name" autoComplete="given-name" maxLength={80} />
        </Field>
      ) : null}

      <Field label={labels.email}>
        <Input type="email" name="email" required autoComplete="email" maxLength={200} />
      </Field>

      <Field label={labels.password} hint={mode === 'register' ? labels.passwordHint : undefined}>
        <Input
          type="password"
          name="password"
          required
          minLength={mode === 'register' ? 10 : 1}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          maxLength={200}
        />
      </Field>

      {error !== null ? <Notice tone="critical">{error}</Notice> : null}

      <Button type="submit" size="large" disabled={busy}>
        {busy ? '…' : labels.submit}
      </Button>
    </form>
  )
}
