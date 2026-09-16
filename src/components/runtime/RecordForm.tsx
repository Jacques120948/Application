'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { recordLabel } from '@/lib/record-label'
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
  /** Tous les modèles de l'application : un renvoi doit pouvoir nommer sa cible. */
  models: readonly DataModel[]
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
  models,
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
          <FieldControl
            field={field}
            initial={record?.data[field.id]}
            projectId={projectId}
            models={models}
          />
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
  projectId,
  models,
}: {
  field: DataModel['fields'][number]
  initial?: unknown
  projectId: string
  models: readonly DataModel[]
}) {
  const className = 'w-full rounded-[var(--app-radius)] border px-3 py-2 text-sm'
  const style = { borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }
  const value = textValue(initial)

  if (field.type === 'reference') {
    return (
      <ReferencePicker
        field={field}
        initial={value}
        projectId={projectId}
        model={models.find((candidate) => candidate.id === field.referenceModelId)}
        className={className}
        style={style}
      />
    )
  }

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

/**
 * Choix d'une fiche d'un autre modèle.
 *
 * Les candidats sont lus au serveur, qui n'en renvoie que ce que le visiteur a le droit de
 * voir : sur un modèle privé, ses propres fiches ; sur un modèle partagé, toutes. Le nom
 * affiché suit la même règle que la liste, parce que la règle vit dans un seul endroit.
 */
function ReferencePicker({
  field,
  initial,
  projectId,
  model,
  className,
  style,
}: {
  field: DataModel['fields'][number]
  initial?: string
  projectId: string
  model?: DataModel
  className: string
  style: Record<string, string>
}) {
  const [choix, setChoix] = useState<Array<{ id: string; label: string }> | null>(null)

  useEffect(() => {
    if (model === undefined) return
    let annule = false
    void (async () => {
      try {
        const response = await fetch(
          `/api/app/${projectId}/records?modelId=${encodeURIComponent(model.id)}&limite=100`,
          { cache: 'no-store' },
        )
        const body = (await response.json().catch(() => null)) as {
          items?: Array<{ id: string; data: Record<string, unknown> }>
        } | null
        if (annule) return
        setChoix((body?.items ?? []).map((item) => ({ id: item.id, label: recordLabel(model, item.data) })))
      } catch {
        if (!annule) setChoix([])
      }
    })()
    return () => {
      annule = true
    }
  }, [projectId, model])

  if (model === undefined) return <p className="text-sm opacity-70">Ce renvoi n’est pas configuré.</p>
  if (choix === null) return <p className="text-sm opacity-70">Chargement…</p>
  if (choix.length === 0) {
    return (
      <p className="text-sm opacity-70">
        Aucun élément à choisir pour le moment. Créez d’abord {model.labelPlural.toLowerCase()}.
      </p>
    )
  }

  return (
    <select
      name={field.id}
      required={field.required}
      defaultValue={initial ?? ''}
      className={className}
      style={style}
    >
      <option value="">Choisir…</option>
      {choix.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
