'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { labelFieldOf } from '@/lib/record-label'
import type { DataModel } from '@/server/spec/schema'
import { Badge, Button, Card, CardBody, Field, Input, Notice, Select, Textarea } from '@/components/ui'

type Item = { id: string; data: Record<string, unknown>; createdAt: string }
type Choix = Array<{ id: string; label: string }>
type Page = {
  items?: Item[]
  total?: number
  references?: Record<string, string>
  choices?: Record<string, Choix>
  filterValues?: string[]
  message?: string
}

const PAGE = 20

const ORDRES = [
  { id: 'recent', label: 'Plus récent d’abord' },
  { id: 'ancien', label: 'Plus ancien d’abord' },
  { id: 'az', label: 'A → Z' },
  { id: 'za', label: 'Z → A' },
] as const

/**
 * Les données que l'application a collectées, du point de vue de son créateur.
 *
 * Il ne pouvait jusqu'ici que les regarder : un compteur et les dix derniers résumés. Une
 * application de réservation dont le propriétaire ne peut pas confirmer un rendez-vous est
 * une demi-application. Il dispose donc ici des mêmes gestes que ses visiteurs — chercher,
 * filtrer, trier, ouvrir, corriger — plus ceux qui n'appartiennent qu'à lui : écarter une
 * fiche, et emporter le tout dans un tableur.
 *
 * Aucun droit n'est décidé ici. Le serveur revérifie à chaque requête que le projet est
 * bien celui de la personne connectée, et la base le revérifie encore.
 */
export function DataPanel({
  projectId,
  models,
  endUserCount,
  locale,
}: {
  projectId: string
  models: readonly DataModel[]
  endUserCount: number
  locale: string
}) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardBody>
          <p className="m-0 text-sm text-[var(--color-ink-soft)]">
            Comptes créés dans votre application
          </p>
          <p className="m-0 mt-1 text-2xl font-semibold">{endUserCount}</p>
        </CardBody>
      </Card>
      {models.map((model) => (
        <ModelData key={model.id} projectId={projectId} model={model} models={models} locale={locale} />
      ))}
    </div>
  )
}

function ModelData({
  projectId,
  model,
  models,
  locale,
}: {
  projectId: string
  model: DataModel
  models: readonly DataModel[]
  locale: string
}) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [total, setTotal] = useState(0)
  const [renvois, setRenvois] = useState<Record<string, string>>({})
  const [choix, setChoix] = useState<Record<string, Choix>>({})
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [saisie, setSaisie] = useState('')
  const [recherche, setRecherche] = useState('')
  const [valeur, setValeur] = useState('')
  const [ordre, setOrdre] = useState<(typeof ORDRES)[number]['id']>('recent')
  /** Valeurs hors liste rencontrées dans les données, quand le champ les autorise. */
  const [valeursLibres, setValeursLibres] = useState<string[]>([])

  /** Un seul filtre, sur le premier champ à choix : ailleurs, aucune valeur ne se répète. */
  const filtre = useMemo(() => model.fields.find((field) => field.type === 'select'), [model.fields])
  const champNom = useMemo(
    () =>
      model.fields.find((field) => field.id === model.labelField) ??
      model.fields.find((field) => field.type === 'text'),
    [model.fields, model.labelField],
  )

  const charge = useCallback(
    async (depuis: number): Promise<Page | null> => {
      const params = new URLSearchParams({ limite: String(PAGE), depuis: String(depuis) })
      if (recherche !== '') params.set('recherche', recherche)
      if (filtre !== undefined) {
        params.set('champ', filtre.id)
        if (valeur !== '') params.set('valeur', valeur)
      }
      if (ordre !== 'recent') {
        params.set('sort', ordre)
        if ((ordre === 'az' || ordre === 'za') && champNom !== undefined) {
          params.set('champTri', champNom.id)
        }
      }
      try {
        const response = await fetch(
          `/api/projects/${projectId}/donnees/${encodeURIComponent(model.id)}?${params.toString()}`,
          { cache: 'no-store' },
        )
        const body = (await response.json().catch(() => null)) as Page | null
        if (body === null || !response.ok) {
          setError(body?.message ?? 'Impossible de charger ces données.')
          return null
        }
        setError(null)
        return body
      } catch {
        setError('La connexion a échoué.')
        return null
      }
    },
    [projectId, model.id, recherche, filtre, valeur, ordre, champNom],
  )

  useEffect(() => {
    let annule = false
    void (async () => {
      const page = await charge(0)
      if (annule) return
      setItems(page?.items ?? [])
      setTotal(page?.total ?? 0)
      setRenvois(page?.references ?? {})
      setChoix(page?.choices ?? {})
      setValeursLibres(page?.filterValues ?? [])
      setOpenId(null)
      setEditingId(null)
    })()
    return () => {
      annule = true
    }
  }, [charge])

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
    setRenvois((actuels) => ({ ...actuels, ...(page.references ?? {}) }))
  }

  async function supprimer(id: string) {
    const response = await fetch(`/api/projects/${projectId}/donnees/${model.id}/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
    })
    if (!response.ok) {
      setError('La suppression n’a pas abouti.')
      return
    }
    setItems((actuels) => (actuels ?? []).filter((item) => item.id !== id))
    setTotal((n) => Math.max(0, n - 1))
    setOpenId((actuel) => (actuel === id ? null : actuel))
  }

  function remplace(id: string, data: Record<string, unknown>) {
    setItems((actuels) => (actuels ?? []).map((item) => (item.id === id ? { ...item, data } : item)))
    setEditingId(null)
  }

  return (
    <Card>
      <CardBody className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="m-0 text-sm font-semibold">{model.labelPlural}</h3>
          <Badge tone="neutral">{total} enregistrement(s)</Badge>
          <a
            href={`/api/projects/${projectId}/donnees/${model.id}/export`}
            className="ml-auto text-sm text-[var(--color-brand-strong)] no-underline hover:underline"
          >
            Exporter en CSV
          </a>
        </div>

        {total > 0 || recherche !== '' || valeur !== '' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="search"
              value={saisie}
              onChange={(event) => setSaisie(event.target.value)}
              placeholder="Rechercher…"
              aria-label={`Rechercher dans ${model.labelPlural}`}
              className="min-w-48 max-w-64 flex-1"
            />
            {filtre !== undefined ? (
              <Select
                value={valeur}
                onChange={(event) => setValeur(event.target.value)}
                aria-label={filtre.label}
                className="max-w-52"
              >
                <option value="">{filtre.label} : tout</option>
                {[...(filtre.options ?? []), ...valeursLibres].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select
              value={ordre}
              onChange={(event) => setOrdre(event.target.value as typeof ordre)}
              aria-label="Ordre"
              className="max-w-52"
            >
              {ORDRES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {error !== null ? <Notice tone="critical">{error}</Notice> : null}

        {items === null ? (
          <p className="m-0 text-sm text-[var(--color-ink-soft)]">Chargement…</p>
        ) : items.length === 0 ? (
          <p className="m-0 text-sm text-[var(--color-ink-soft)]">
            {recherche !== '' || valeur !== ''
              ? 'Aucun résultat pour cette recherche.'
              : 'Rien n’a encore été enregistré.'}
          </p>
        ) : (
          <>
            <ul className="m-0 grid list-none gap-2 p-0">
              {items.map((item) => {
                const ouvert = openId === item.id
                return (
                  <li
                    key={item.id}
                    className="rounded-[var(--radius-control)] border border-[var(--color-line)]"
                  >
                    <button
                      type="button"
                      aria-expanded={ouvert}
                      onClick={() => {
                        setOpenId(ouvert ? null : item.id)
                        setEditingId(null)
                      }}
                      className="flex w-full items-start justify-between gap-4 px-3 py-2 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm">{resume(model, item.data, renvois)}</span>
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-soft)]">
                          {new Date(item.createdAt).toLocaleString(locale)}
                        </span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-xs opacity-60">
                        {ouvert ? '▲' : '▼'}
                      </span>
                    </button>

                    {ouvert ? (
                      <div className="border-t border-[var(--color-line)] px-3 py-3">
                        {editingId === item.id ? (
                          <EditForm
                            projectId={projectId}
                            model={model}
                            models={models}
                            item={item}
                            choix={choix}
                            onSaved={(data) => remplace(item.id, data)}
                            onCancel={() => setEditingId(null)}
                          />
                        ) : (
                          <>
                            <dl className="m-0 grid gap-2">
                              {model.fields.map((field) => (
                                <div key={field.id}>
                                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                                    {field.label}
                                  </dt>
                                  <dd className="m-0 mt-0.5 whitespace-pre-line text-sm">
                                    {montre(model, field.id, item.data, renvois)}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              <Button variant="secondary" onClick={() => setEditingId(item.id)}>
                                Modifier
                              </Button>
                              <button
                                type="button"
                                onClick={() => void supprimer(item.id)}
                                className="text-sm text-[var(--color-ink-soft)] underline"
                              >
                                Supprimer
                              </button>
                            </div>
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
                <Button variant="secondary" onClick={() => void voirPlus()}>
                  Voir plus
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  )
}

/** Correction d'une fiche par le créateur. Mêmes champs, même validation côté serveur. */
function EditForm({
  projectId,
  model,
  models,
  item,
  choix,
  onSaved,
  onCancel,
}: {
  projectId: string
  model: DataModel
  models: readonly DataModel[]
  item: Item
  choix: Record<string, Choix>
  onSaved: (data: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const formElement = event.currentTarget
    setBusy(true)
    setError(null)

    const form = new FormData(formElement)
    const payload: Record<string, unknown> = {}
    for (const field of model.fields) {
      payload[field.id] =
        field.type === 'boolean' ? form.get(field.id) === 'on' : (form.get(field.id) ?? '')
    }

    const response = await fetch(`/api/projects/${projectId}/donnees/${model.id}/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: payload }),
    })
    const body = (await response.json().catch(() => null)) as {
      message?: string
      record?: { data: Record<string, unknown> }
    } | null
    setBusy(false)
    if (body === null || !response.ok) {
      setError(body?.message ?? 'La correction n’a pas abouti.')
      return
    }
    onSaved(body.record?.data ?? payload)
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      {model.fields.map((field) => (
        <Champ
          key={field.id}
          field={field}
          initial={item.data[field.id]}
          choix={choix[field.id]}
          models={models}
        />
      ))}
      {error !== null ? <Notice tone="critical">{error}</Notice> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        <button type="button" onClick={onCancel} className="text-sm underline">
          Annuler
        </button>
      </div>
    </form>
  )
}

function Champ({
  field,
  initial,
  choix,
  models,
}: {
  field: DataModel['fields'][number]
  initial: unknown
  choix?: Choix
  models: readonly DataModel[]
}) {
  const valeur = initial === null || initial === undefined ? undefined : String(initial)
  const label = field.label + (field.required ? ' *' : '')

  if (field.type === 'reference') {
    const cible = models.find((candidate) => candidate.id === field.referenceModelId)
    return (
      <Field label={label} hint={cible === undefined ? undefined : `Parmi ${cible.labelPlural}`}>
        <Select name={field.id} required={field.required} defaultValue={valeur ?? ''}>
          <option value="">Choisir…</option>
          {(choix ?? []).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  if (field.type === 'longText') {
    return (
      <Field label={label}>
        <Textarea name={field.id} required={field.required} defaultValue={valeur} rows={3} />
      </Field>
    )
  }

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name={field.id} defaultChecked={initial === true} className="h-4 w-4" />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.type === 'select') {
    return (
      <Field label={label}>
        {field.allowOther === true ? (
          <ChoixOuLibre field={field} initial={valeur} />
        ) : (
          <Select name={field.id} required={field.required} defaultValue={valeur ?? ''}>
            <option value="">Choisir…</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </Field>
    )
  }

  const type =
    field.type === 'number'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'email'
          ? 'email'
          : field.type === 'url'
            ? 'url'
            : 'text'
  return (
    <Field label={label}>
      <Input type={type} name={field.id} required={field.required} defaultValue={valeur} />
    </Field>
  )
}

/**
 * Le résumé d'une ligne repliée : le nom de la fiche, puis le premier autre champ rempli.
 *
 * Il passe par le même affichage que le détail, sans quoi une fiche dont le champ nommant
 * est un renvoi se résumerait par un identifiant que personne ne reconnaît.
 */
function resume(
  model: DataModel,
  data: Record<string, unknown>,
  renvois: Record<string, string>,
): string {
  const champNom = labelFieldOf(model)
  const nom = champNom === undefined ? 'Sans nom' : montre(model, champNom.id, data, renvois)
  const autre = model.fields.find(
    (field) =>
      field.id !== champNom?.id &&
      data[field.id] !== null &&
      data[field.id] !== undefined &&
      data[field.id] !== '',
  )
  if (autre === undefined) return nom
  return `${nom} — ${montre(model, autre.id, data, renvois)}`
}

/** La valeur d'un champ, telle qu'on la montre. Un renvoi montre le nom de sa cible. */
function montre(
  model: DataModel,
  fieldId: string,
  data: Record<string, unknown>,
  renvois: Record<string, string>,
): string {
  const champ = model.fields.find((field) => field.id === fieldId)
  const valeur = data[fieldId]
  if (champ?.type === 'reference') {
    if (typeof valeur !== 'string' || valeur === '') return '—'
    return renvois[valeur] ?? 'Élément supprimé'
  }
  if (valeur === null || valeur === undefined || valeur === '') return '—'
  if (typeof valeur === 'boolean') return valeur ? 'Oui' : 'Non'
  return String(valeur).slice(0, 300)
}

/**
 * La valeur interne du choix « Autre ».
 *
 * Elle ne peut pas être une constante quelconque : les options sont écrites par le
 * créateur, donc n'importe quelle chaîne fixe pourrait un jour être un vrai choix. On part
 * d'un motif improbable et on l'allonge tant qu'il entre en collision — ainsi la sentinelle
 * est toujours distincte, quelles que soient les options.
 *
 * Elle doit aussi rester transmissible en HTML : un caractère nul, par exemple, ne survit
 * pas à la sérialisation de la page et le choix devient inopérant. Mesuré en conditions
 * réelles.
 */
function sentinelleAutre(options: readonly string[]): string {
  let valeur = '__autre__'
  while (options.includes(valeur)) valeur += '_'
  return valeur
}

/**
 * Même contrôle que dans l'application, côté créateur.
 *
 * Il corrige les fiches de ses visiteurs depuis son tableau de bord : s'il ne pouvait pas
 * y saisir la même valeur libre qu'eux, corriger une faute de frappe sur un métier hors
 * liste l'obligerait à le remplacer par un choix qui ne lui convient pas.
 */
function ChoixOuLibre({
  field,
  initial,
}: {
  field: DataModel['fields'][number]
  initial?: string
}) {
  const options = field.options ?? []
  const AUTRE = sentinelleAutre(options)
  const horsListe = initial !== undefined && initial !== '' && !options.includes(initial)
  const [choix, setChoix] = useState(horsListe ? AUTRE : (initial ?? ''))
  const [libre, setLibre] = useState(horsListe ? initial : '')

  return (
    <>
      <Select
        required={field.required}
        value={choix}
        onChange={(event) => setChoix(event.target.value)}
      >
        <option value="">Choisir…</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={AUTRE}>Autre…</option>
      </Select>
      {choix === AUTRE ? (
        <Input
          className="mt-2"
          required
          maxLength={80}
          value={libre}
          onChange={(event) => setLibre(event.target.value)}
          placeholder={`Précisez : ${field.label.toLowerCase()}`}
        />
      ) : null}
      <input type="hidden" name={field.id} value={choix === AUTRE ? libre.trim() : choix} />
    </>
  )
}
