'use client'

import { useState, type FormEvent } from 'react'
import type { DataModel } from '@/server/spec/schema'

/**
 * Formulaire d'une application générée.
 *
 * Il n'effectue aucune validation faisant autorité : le serveur revalide tout contre le
 * modèle déclaré dans la spécification publiée. Les contrôles ci-dessous ne servent qu'à
 * éviter un aller-retour inutile.
 */

type Props = {
  projectId: string
  model: DataModel
  submitLabel: string
  successMessage: string
  onCreated: () => void
  disabledReason?: string
}

export function RecordForm({
  projectId,
  model,
  submitLabel,
  successMessage,
  onCreated,
  disabledReason,
}: Props) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === 'sending') return
    setState('sending')
    setError(null)

    const form = new FormData(event.currentTarget)
    const payload: Record<string, unknown> = {}
    for (const field of model.fields) {
      payload[field.id] =
        field.type === 'boolean' ? form.get(field.id) === 'on' : form.get(field.id) ?? ''
    }

    try {
      const response = await fetch(`/api/app/${projectId}/records`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: model.id, data: payload }),
      })
      const body = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(body.message ?? "L'enregistrement n'a pas abouti.")
        setState('idle')
        return
      }
      setState('done')
      event.currentTarget.reset()
      onCreated()
    } catch {
      setError('La connexion a échoué. Réessayez.')
      setState('idle')
    }
  }

  if (disabledReason !== undefined) {
    return (
      <p className="rounded-[var(--app-radius)] border border-dashed p-4 text-sm opacity-70">
        {disabledReason}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {model.fields.map((field) => (
        <label key={field.id} className="block text-sm">
          <span className="mb-1 block font-medium">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          <FieldControl field={field} />
          {field.help !== undefined ? (
            <span className="mt-1 block text-xs opacity-70">{field.help}</span>
          ) : null}
        </label>
      ))}

      {error !== null ? (
        <p role="alert" className="text-sm" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      ) : null}
      {state === 'done' ? <p className="text-sm font-medium">{successMessage}</p> : null}

      <div>
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-[var(--app-radius)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--app-primary)' }}
        >
          {state === 'sending' ? 'Envoi…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

function FieldControl({ field }: { field: DataModel['fields'][number] }) {
  const className =
    'w-full rounded-[var(--app-radius)] border px-3 py-2 text-sm'
  const style = { borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }

  switch (field.type) {
    case 'longText':
      return (
        <textarea
          name={field.id}
          required={field.required}
          rows={4}
          className={className}
          style={style}
        />
      )
    case 'boolean':
      return <input type="checkbox" name={field.id} className="mt-1 h-4 w-4" />
    case 'select':
      return (
        <select name={field.id} required={field.required} className={className} style={style}>
          <option value="">Choisir…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
    case 'number':
      return (
        <input type="number" name={field.id} required={field.required} className={className} style={style} />
      )
    case 'date':
      return (
        <input type="date" name={field.id} required={field.required} className={className} style={style} />
      )
    case 'email':
      return (
        <input type="email" name={field.id} required={field.required} className={className} style={style} />
      )
    case 'url':
      return (
        <input
          type="url"
          name={field.id}
          required={field.required}
          placeholder="https://"
          className={className}
          style={style}
        />
      )
    case 'text':
      return (
        <input type="text" name={field.id} required={field.required} className={className} style={style} />
      )
  }
}
