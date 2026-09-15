'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DataModel } from '@/server/spec/schema'
import { RecordForm, type EditedRecord } from './RecordForm'

type Item = { id: string; data: Record<string, unknown>; createdAt: string; isMine: boolean }

/** Une page de résultats telle que le serveur la rend. */
type Page = { items?: Item[]; total?: number; message?: string }

const PAGE = 20

/** Au-dessous de ce nombre, chercher et trier sont des questions qu'on ne se pose pas. */
const SEUIL_OUTILS = 6

const ORDRES = [
  { id: 'recent', label: 'Plus récent d’abord' },
  { id: 'ancien', label: 'Plus ancien d’abord' },
  { id: 'az', label: 'A → Z' },
  { id: 'za', label: 'Z → A' },
] as const

/**
 * Liste alimentée par les données réellement enregistrées côté serveur.
 *
 * Trois choses la rendent utilisable au-delà de quelques fiches.
 *
 * **On cherche dans la base, pas dans la page.** Chercher parmi les vingt fiches déjà
 * chargées ne serait pas chercher, ce serait en donner l'illusion : la recherche part au
 * serveur, qui interroge l'ensemble.
 *
 * **Les outils n'apparaissent que s'ils servent.** Une liste de trois éléments s'affiche
 * nue. C'est le nombre total de fiches, mesuré au premier chargement, qui décide.
 *
 * **Une ligne s'ouvre et montre tout.** Un titre et un sous-titre suffisent à parcourir,
 * jamais à consulter. Ouverte, une fiche qu'on a soi-même saisie se corrige sur place — le
 * droit étant revérifié par le serveur à chaque requête, jamais décidé ici.
 */
export function RecordList({
  projectId,
  model,
  titleField,
  subtitleField,
  emptyText,
  allowDelete,
  allowEdit,
  searchable,
  filterField,
  sort,
  refreshToken,
}: {
  projectId: string
  model: DataModel
  titleField: string
  subtitleField?: string
  emptyText: string
  allowDelete: boolean
  allowEdit: boolean
  searchable: boolean
  filterField?: string
  sort: 'recent' | 'ancien' | 'az' | 'za'
  refreshToken: number
}) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [saisie, setSaisie] = useState('')
  const [recherche, setRecherche] = useState('')
  const [valeur, setValeur] = useState('')
  const [ordre, setOrdre] = useState(sort)

  /** Le nombre de fiches sans aucun critère : il décide de l'affichage des outils. */
  const [totalNu, setTotalNu] = useState<number | null>(null)

  const filtre = useMemo(
    () => model.fields.find((field) => field.id === filterField && field.type === 'select'),
    [model.fields, filterField],
  )

  const charge = useCallback(
    async (depuis: number): Promise<Page | null> => {
      const params = new URLSearchParams({ modelId: model.id, limite: String(PAGE), depuis: String(depuis) })
      if (recherche !== '') params.set('recherche', recherche)
      if (filtre !== undefined && valeur !== '') {
        params.set('champ', filtre.id)
        params.set('valeur', valeur)
      }
      if (ordre !== 'recent') {
        params.set('sort', ordre)
        // L'ordre alphabétique porte sur ce que la liste montre, pas sur un champ caché.
        if (ordre === 'az' || ordre === 'za') params.set('champTri', titleField)
      }
      try {
        const response = await fetch(`/api/app/${projectId}/records?${params.toString()}`, {
          cache: 'no-store',
        })
        const body = (await response.json().catch(() => null)) as Page | null
        if (body === null || !response.ok) {
          setError(body?.message ?? 'Impossible de charger les éléments.')
          return null
        }
        setError(null)
        return body
      } catch {
        setError('La connexion a échoué.')
        return null
      }
    },
    [projectId, model.id, recherche, filtre, valeur, ordre, titleField],
  )

  useEffect(() => {
    let annule = false
    void (async () => {
      const page = await charge(0)
      if (annule) return
      setItems(page?.items ?? [])
      setTotal(page?.total ?? 0)
      setOpenId(null)
      setEditingId(null)
      // Le total sans critère se mesure une fois, au premier chargement.
      setTotalNu((actuel) =>
        actuel === null && recherche === '' && valeur === '' ? (page?.total ?? 0) : actuel,
      )
    })()
    return () => {
      annule = true
    }
  }, [charge, refreshToken])

  /** La recherche part après une pause : une requête par lettre serait un gaspillage. */
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (pause.current !== null) clearTimeout(pause.current)
    pause.current = setTimeout(() => setRecherche(saisie.trim()), 300)
    return () => {
      if (pause.current !== null) clearTimeout(pause.current)
    }
  }, [saisie])

  async function voirPlus() {
    const page = await charge(items?.length ?? 0)
    if (page === null) return
    setItems((actuels) => [...(actuels ?? []), ...(page.items ?? [])])
    setTotal(page.total ?? 0)
  }

  async function remove(id: string) {
    const response = await fetch(`/api/app/${projectId}/records/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: model.id }),
    })
    if (response.ok) {
      setItems((current) => (current ?? []).filter((item) => item.id !== id))
      setTotal((n) => Math.max(0, n - 1))
      setTotalNu((n) => (n === null ? n : Math.max(0, n - 1)))
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

  const outils = (totalNu ?? 0) >= SEUIL_OUTILS && (searchable || filtre !== undefined)
  const critere = recherche !== '' || valeur !== ''
  const controle = 'rounded-[var(--app-radius)] border px-3 py-2 text-sm'
  const style = { borderColor: 'var(--app-muted)', background: 'var(--app-surface)' }

  return (
    <div className="grid gap-4">
      {outils ? (
        <div className="flex flex-wrap items-center gap-3">
          {searchable ? (
            <input
              type="search"
              value={saisie}
              onChange={(event) => setSaisie(event.target.value)}
              placeholder="Rechercher…"
              aria-label="Rechercher"
              className={`${controle} min-w-48 flex-1`}
              style={style}
            />
          ) : null}
          {filtre !== undefined ? (
            <select
              value={valeur}
              onChange={(event) => setValeur(event.target.value)}
              aria-label={filtre.label}
              className={controle}
              style={style}
            >
              <option value="">{filtre.label} : tout</option>
              {(filtre.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={ordre}
            onChange={(event) => setOrdre(event.target.value as typeof ordre)}
            aria-label="Ordre"
            className={controle}
            style={style}
          >
            {ORDRES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {items === null ? (
        <p className="text-sm opacity-70">Chargement…</p>
      ) : error !== null ? (
        <p className="text-sm opacity-70">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-sm opacity-70">{critere ? 'Aucun résultat pour cette recherche.' : emptyText}</p>
      ) : (
        <>
          {outils ? (
            <p className="m-0 text-sm opacity-70" role="status">
              {total === 1 ? '1 résultat' : `${total} résultats`}
            </p>
          ) : null}

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
                    <div
                      className="border-t px-4 pb-4 pt-4"
                      style={{ borderColor: 'var(--app-muted)' }}
                    >
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

          {items.length < total ? (
            <div>
              <button
                type="button"
                onClick={() => void voirPlus()}
                className="rounded-[var(--app-radius)] border px-4 py-2 text-sm font-medium"
                style={style}
              >
                Voir plus
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non'
  return String(value).slice(0, 300)
}
