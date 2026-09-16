'use client'

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { recordLabel } from '@/lib/record-label'
import { PHOTO_ACCEPT, photoUrl, uploadPhoto } from '@/lib/photo-upload'
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
  /*
   * Compteur de remises à zéro.
   *
   * `form.reset()` ne rend leur état initial qu'aux champs du navigateur. Les contrôles qui
   * tiennent le leur — la photo déjà envoyée, la valeur libre d'une liste de choix —
   * garderaient la saisie précédente, et la fiche suivante partirait avec la photo de la
   * première. Changer leur clé les remonte, ce qui est la seule remise à zéro qui les
   * concerne tous sans que chacun ait à s'en occuper.
   */
  const [remises, setRemises] = useState(0)
  const correction = record !== undefined
  // Un champ calculé n'apparaît pas au formulaire : il se déduit des autres, et le montrer
  // laisserait croire qu'on peut le corriger à la main.
  const saisissables = model.fields.filter((field) => field.type !== 'computed')

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
    for (const field of saisissables) {
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
      setRemises((valeur) => valeur + 1)
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
      {saisissables.map((field) => (
        <label key={`${field.id}-${remises}`} className="block text-sm">
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

  if (field.type === 'photo') {
    return <PhotoPicker field={field} initial={value} projectId={projectId} style={style} />
  }

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
      return field.allowOther === true ? (
        <SelectWithOther field={field} initial={value} className={className} style={style} />
      ) : (
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
 * Une liste de choix qui accepte une valeur qu'elle n'avait pas prévue.
 *
 * Le besoin vient du terrain : un annuaire d'artisans qui propose cinq métiers rencontrera
 * un carreleur. Les deux réponses habituelles sont mauvaises — une option « Autre » perd
 * l'information, et le texte libre ruine le filtre en multipliant les orthographes. Ici, la
 * liste reste la voie normale, et la saisie libre est une sortie de secours : la valeur
 * écrite est conservée telle quelle, et le filtre la proposera ensuite aux autres.
 *
 * Un seul champ est envoyé au serveur : le champ caché. La zone de texte n'a pas de nom,
 * sinon deux valeurs partiraient sous le même nom et le serveur en lirait une au hasard.
 */
function SelectWithOther({
  field,
  initial,
  className,
  style,
}: {
  field: DataModel['fields'][number]
  initial?: string
  className: string
  style: Record<string, string>
}) {
  const options = field.options ?? []
  const AUTRE = sentinelleAutre(options)
  // Une valeur déjà enregistrée qui n'est pas dans la liste vient forcément d'une saisie
  // libre : on rouvre la zone de texte avec, plutôt que de l'effacer en silence.
  const horsListe = initial !== undefined && initial !== '' && !options.includes(initial)
  const [choix, setChoix] = useState(horsListe ? AUTRE : (initial ?? ''))
  const [libre, setLibre] = useState(horsListe ? initial : '')

  const valeur = choix === AUTRE ? libre.trim() : choix

  return (
    <>
      <select
        required={field.required}
        value={choix}
        onChange={(event) => setChoix(event.target.value)}
        className={className}
        style={style}
      >
        <option value="">Choisir…</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={AUTRE}>Autre…</option>
      </select>
      {choix === AUTRE ? (
        <input
          type="text"
          required
          maxLength={80}
          value={libre}
          onChange={(event) => setLibre(event.target.value)}
          placeholder={`Précisez : ${field.label.toLowerCase()}`}
          className={`${className} mt-2`}
          style={style}
        />
      ) : null}
      <input type="hidden" name={field.id} value={valeur} />
    </>
  )
}

/**
 * Le choix d'une photo.
 *
 * Elle part dès qu'elle est choisie, et non au moment d'envoyer le formulaire. Deux raisons.
 * Celui qui l'envoie doit **la voir** avant de valider — une photo choisie à l'aveugle est
 * une photo de travers une fois sur trois. Et un formulaire qui enverrait tout d'un bloc
 * ferait attendre dix secondes sans rien montrer, puis échouerait parfois en perdant la
 * saisie avec la photo.
 *
 * Ce qui part au serveur avec la fiche n'est donc qu'un identifiant, porté par un champ
 * caché : le formulaire ne manipule jamais de fichier.
 *
 * Une photo envoyée puis abandonnée n'est pas perdue pour rien — le serveur reprend au bout
 * d'une heure ce qu'aucune fiche ne réclame.
 */
function PhotoPicker({
  field,
  initial,
  projectId,
  style,
}: {
  field: DataModel['fields'][number]
  initial?: string
  projectId: string
  style: Record<string, string>
}) {
  const [photoId, setPhotoId] = useState(initial ?? '')
  const [etat, setEtat] = useState<'idle' | 'envoi'>('idle')
  const [erreur, setErreur] = useState<string | null>(null)

  async function choisir(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Le champ est remis à zéro tout de suite : sans cela, rechoisir le même fichier après
    // une erreur ne déclencherait aucun événement et rien ne se passerait.
    event.target.value = ''
    if (file === undefined) return

    setEtat('envoi')
    setErreur(null)
    try {
      const photo = await uploadPhoto(projectId, file)
      setPhotoId(photo.id)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : "Cette photo n'a pas pu être envoyée.")
    } finally {
      setEtat('idle')
    }
  }

  return (
    <>
      {photoId !== '' ? (
        <span className="mb-2 block">
          {/* eslint-disable-next-line @next/next/no-img-element -- l'image vient de la base, sans dimensions connues à l'avance */}
          <img
            src={photoUrl(projectId, photoId, 'thumb')}
            alt={field.label}
            className="max-h-40 rounded-[var(--app-radius)] border"
            style={{ borderColor: 'var(--app-muted)' }}
          />
          <button
            type="button"
            onClick={() => setPhotoId('')}
            className="mt-1 text-xs underline opacity-70"
          >
            Retirer la photo
          </button>
        </span>
      ) : null}

      <input
        type="file"
        accept={PHOTO_ACCEPT}
        onChange={(event) => void choisir(event)}
        disabled={etat === 'envoi'}
        // Obligatoire seulement tant que rien n'a été envoyé : une fois la photo reçue, ce
        // champ est vide par construction et le navigateur bloquerait un formulaire pourtant
        // complet.
        required={field.required && photoId === ''}
        className="w-full rounded-[var(--app-radius)] border px-3 py-2 text-sm"
        style={style}
      />
      {etat === 'envoi' ? <span className="mt-1 block text-xs opacity-70">Envoi de la photo…</span> : null}
      {erreur !== null ? (
        <span role="alert" className="mt-1 block text-xs" style={{ color: '#b91c1c' }}>
          {erreur}
        </span>
      ) : null}
      <input type="hidden" name={field.id} value={photoId} />
    </>
  )
}
