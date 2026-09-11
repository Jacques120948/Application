'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DataModel } from '@/server/spec/schema'

type Item = { id: string; data: Record<string, unknown>; createdAt: string; isMine: boolean }

/** Liste alimentée par les données réellement enregistrées côté serveur. */
export function RecordList({
  projectId,
  model,
  titleField,
  subtitleField,
  emptyText,
  allowDelete,
  refreshToken,
}: {
  projectId: string
  model: DataModel
  titleField: string
  subtitleField?: string
  emptyText: string
  allowDelete: boolean
  refreshToken: number
}) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/app/${projectId}/records?modelId=${encodeURIComponent(model.id)}`,
        { cache: 'no-store' },
      )
      const body = (await response.json()) as { items?: Item[]; message?: string }
      if (!response.ok) {
        setError(body.message ?? 'Impossible de charger les éléments.')
        setItems([])
        return
      }
      setItems(body.items ?? [])
      setError(null)
    } catch {
      setError('La connexion a échoué.')
      setItems([])
    }
  }, [projectId, model.id])

  useEffect(() => {
    void load()
  }, [load, refreshToken])

  async function remove(id: string) {
    const response = await fetch(`/api/app/${projectId}/records/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: model.id }),
    })
    if (response.ok) setItems((current) => (current ?? []).filter((item) => item.id !== id))
  }

  if (items === null) return <p className="text-sm opacity-70">Chargement…</p>
  if (error !== null) return <p className="text-sm opacity-70">{error}</p>
  if (items.length === 0) return <p className="text-sm opacity-70">{emptyText}</p>

  return (
    <ul className="grid gap-3 list-none p-0 m-0">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-start justify-between gap-4 rounded-[var(--app-radius)] border p-4"
          style={{ borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }}
        >
          <div className="min-w-0">
            <p className="m-0 font-medium">{display(item.data[titleField])}</p>
            {subtitleField !== undefined ? (
              <p className="m-0 mt-1 text-sm opacity-70">{display(item.data[subtitleField])}</p>
            ) : null}
          </div>
          {allowDelete && item.isMine ? (
            <button
              type="button"
              onClick={() => void remove(item.id)}
              className="shrink-0 text-sm underline"
            >
              Supprimer
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  return String(value).slice(0, 300)
}
