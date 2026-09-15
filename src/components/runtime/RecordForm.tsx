'use client'

import { useState, type FormEvent } from 'react'
import type { DataModel } from '@/server/spec/schema'

/**
 * Formulaire d'une application générée.
 *
 * Le même formulaire sert à saisir et à corriger : mêmes champs, mêmes contrôles, même
 * validation. Deux formulaires distincts finiraient par diverger, et c'est toujours celui
 * qu'on regarde le moins qui accepterait ce que l'autre refuse.
 *
 * Il n'effectue aucune validation faisant autorité : le serveur revalide tout contre le
 * modèle déclaré dans la spécification publiée. Les contrôles ci-dessous ne servent qu'à
 * éviter un aller-retour inutile.
 */

export type EditedRecord = { id: string; data: Record<string, unknown> }

type Props = {
  projectId: string
  model: DataModel
  submitLabel: string
  successMessage: string
  onCreated: () => void
  disabledReason?: string
  /** Présent en correction : la fiche à modifier. Absent en saisie. */
  record?: EditedRecord
  /** Correction réussie : la fiche telle que le serveur l'a enregistrée. */
  onSaved?: (record: EditedRecord) => void
  onCancel?: () => void
}

export function RecordForm({
  projectId,
  model,
  submitLabel,
  successMessage,
  onCreated,
  disabledReason,
  record,
  onSaved,
  onCancel,
}: Props) {
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const correction = record !== undefined

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state === 'sending') return
    // L'élément est retenu avant toute attente : après un `await`, React a pu vider
    // `currentTarget`, et la remise à zéro tomberait alors sur `null`.
    const formElement = event.currentTarget
    setState('sending')
    setError(null)

    const form = new FormData(formElement)
    const payload: Record<string, unknown> = {}
    for (const field of model.fields) {
      payload[field.id] =
        field.type === 'boolean' ? form.get(field.id) === 'on' : form.get(field.id) ?? ''
    }

    try {
      const response = await fetch(
        correction ? `/api/app/${projectId}/records/${record.id}` : `/api/app/${projectId}/records`,
        {
          method: correction ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ modelId: model.id, data: payload }),
        },
      )
      // Une réponse qui n'est pas du JSON vient de l'hébergeur, pas de l'application :
      // elle ne doit pas laisser le bouton en attente pour toujours.
      const body = (await response.json().catch(() => null)) as {
        message?: string
        record?: EditedRecord
      } | null
      if (body === null || !response.ok) {
        setError(body?.message ?? "L'enregistrement n'a pas abouti.")
        setState('idle')
        return
      }
      setState('done')
      if (correction) {
        onSaved?.(body.record ?? { id: record.id, data: payload })
        return
      }
      formElement.reset()
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
          <FieldControl field={field} initial={record?.data[field.id]} />
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
      {state === 'done' && !correction ? (
        <p className="text-sm font-medium">{successMessage}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={state === 'sending'}
          className="rounded-[var(--app-radius)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--app-primary)' }}
        >
          {state === 'sending' ? 'Envoi…' : submitLabel}
        </button>
        {onCancel !== undefined ? (
          <button type="button" onClick={onCancel} className="text-sm underline">
            Annuler
          </button>
        ) : null}
      </div>
    </form>
  )
}

/** Valeur de départ d'un champ, en correction. Vide à la saisie. */
function textValue(initial: unknown): string | undefined {
  if (initial === null || initial === undefined) return undefined
  return String(initial)
}

function FieldControl({
  field,
  initial,
}: {
  field: DataModel['fields'][number]
  initial?: unknown
}) {
  const className = 'w-full rounded-[var(--app-radius)] border px-3 py-2 text-sm'
  const style = { borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }
  const value = textValue(initial)

  switch (field.type) {
    case 'longText':
      return (
        <textarea
          name={field.id}
          required={field.required}
          rows={4}
          defaultValue={value}
          className={className}
          style={style}
        />
      )
    case 'boolean':
      return (
        <input
          type="checkbox"
          name={field.id}
          defaultChecked={initial === true}
          className="mt-1 h-4 w-4"
        />
      )
    case 'select':
      return (
        <select
          name={field.id}
          required={field.required}
          defaultValue={value ?? ''}
          className={className}
          style={style}
        >
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
        <input
          type="number"
          name={field.id}
          required={field.required}
          defaultValue={value}
          className={className}
          style={style}
        />
      )
    case 'date':
      return (
        <input
          type="date"
          name={field.id}
          required={field.required}
          defaultValue={value}
          className={className}
          style={style}
        />
      )
    case 'email':
      return (
        <input
          type="email"
          name={field.id}
          required={field.required}
          defaultValue={value}
          className={className}
          style={style}
        />
      )
    case 'url':
      return (
        <input
          type="url"
          name={field.id}
          required={field.required}
          defaultValue={value}
          placeholder="https://"
          className={className}
          style={style}
        />
      )
    case 'text':
      return (
        <input
          type="text"
          name={field.id}
          required={field.required}
          defaultValue={value}
          className={className}
          style={style}
        />
      )
  }
}
