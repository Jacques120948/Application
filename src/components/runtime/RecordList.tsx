'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DataModel } from '@/server/spec/schema'
import { RecordForm, type EditedRecord } from './RecordForm'

type Item = { id: string; data: Record<string, unknown>; createdAt: string; isMine: boolean }

/**
 * Liste alimentée par les données réellement enregistrées côté serveur.
 *
 * Une ligne ne montre qu'un titre et un sous-titre : c'est ce qu'il faut pour parcourir,
 * et bien trop peu pour consulter. On l'ouvre donc, et elle montre alors tous les champs
 * du modèle, chacun sous son intitulé — y compris ceux que le visiteur a remplis sans
 * jamais pouvoir les relire ensuite.
 *
 * Ouverte, une fiche qu'on a soi-même saisie se corrige sur place. Le droit n'est pas
 * décidé ici : le serveur revérifie, à chaque requête, que celui qui modifie est bien
 * celui qui a saisi. Ce qui est décidé ici n'est que l'affichage du bouton.
 */
export function RecordList({
  projectId,
  model,
  titleField,
  subtitleField,
  emptyText,
  allowDelete,
  allowEdit,
  refreshToken,
}: {
  projectId: string
  model: DataModel
  titleField: string
  subtitleField?: string
  emptyText: string
  allowDelete: boolean
  allowEdit: boolean
  refreshToken: number
}) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

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
    if (response.ok) {
      setItems((current) => (current ?? []).filter((item) => item.id !== id))
      setOpenId((current) => (current === id ? null : current))
    }
  }

  /** La fiche corrigée remplace l'ancienne sans recharger toute la liste. */
  function replace(saved: EditedRecord) {
    setItems((current) =>
      (current ?? []).map((item) => (item.id === saved.id ? { ...item, data: saved.data } : item)),
    )
    setEditingId(null)
  }

  if (items === null) return <p className="text-sm opacity-70">Chargement…</p>
  if (error !== null) return <p className="text-sm opacity-70">{error}</p>
  if (items.length === 0) return <p className="text-sm opacity-70">{emptyText}</p>

  return (
    <ul className="grid gap-3 list-none p-0 m-0">
      {items.map((item) => {
        const open = openId === item.id
        const editing = editingId === item.id
        return (
          <li
            key={item.id}
            className="rounded-[var(--app-radius)] border"
            style={{ borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => {
                setOpenId(open ? null : item.id)
                setEditingId(null)
              }}
              className="flex w-full items-start justify-between gap-4 p-4 text-left"
            >
              <span className="min-w-0">
                <span className="block font-medium">{display(item.data[titleField])}</span>
                {subtitleField !== undefined ? (
                  <span className="mt-1 block text-sm opacity-70">
                    {display(item.data[subtitleField])}
                  </span>
                ) : null}
              </span>
              <span aria-hidden="true" className="shrink-0 text-sm opacity-60">
                {open ? '▲' : '▼'}
              </span>
            </button>

            {open ? (
              <div className="border-t px-4 pb-4 pt-4" style={{ borderColor: 'var(--app-muted)' }}>
                {editing ? (
                  <RecordForm
                    projectId={projectId}
                    model={model}
                    submitLabel="Enregistrer les modifications"
                    successMessage=""
                    onCreated={() => undefined}
                    record={{ id: item.id, data: item.data }}
                    onSaved={replace}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <dl className="m-0 grid gap-3">
                      {model.fields.map((field) => (
                        <div key={field.id}>
                          <dt className="text-xs font-medium uppercase tracking-wide opacity-60">
                            {field.label}
                          </dt>
                          <dd className="m-0 mt-0.5 whitespace-pre-line text-sm">
                            {display(item.data[field.id])}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {item.isMine && (allowEdit || allowDelete) ? (
                      <div className="mt-4 flex flex-wrap items-center gap-4">
                        {allowEdit ? (
                          <button
                            type="button"
                            onClick={() => setEditingId(item.id)}
                            className="text-sm font-medium underline"
                          >
                            Modifier
                          </button>
                        ) : null}
                        {allowDelete ? (
                          <button
                            type="button"
                            onClick={() => void remove(item.id)}
                            className="text-sm underline opacity-70"
                          >
                            Supprimer
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  return String(value).slice(0, 300)
}
