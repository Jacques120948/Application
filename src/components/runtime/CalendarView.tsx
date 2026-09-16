'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Entry = { id: string; day: string; label: string; tone: string | null; isMine: boolean }

/**
 * Un mois de fiches, posées sur une grille.
 *
 * Une liste triée par date répond à « qu'est-ce qui vient ? ». Elle ne répond pas à
 * « suis-je libre jeudi ? » ni à « ai-je trois rendez-vous le même matin ? ». Ce sont
 * pourtant les deux questions d'une application de réservation ou de planning, et elles ne
 * se posent qu'en voyant un mois d'un coup.
 *
 * Trois choix de fabrication.
 *
 * **La semaine commence le lundi**, et le mois est complété par les jours voisins en gris.
 * Une grille à trous se lit mal, et un calendrier qui commence le dimanche déroute ici.
 *
 * **Un jour chargé se voit sans être lu.** Au-delà de trois fiches, la case annonce
 * « +4 » plutôt que d'empiler des titres illisibles. On les lit en ouvrant le jour.
 *
 * **Aujourd'hui est marqué, le passé est atténué.** Ce sont les deux repères qu'on cherche
 * d'abord en ouvrant un planning, avant même de lire quoi que ce soit.
 */

const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const

/** Au-delà, la case compte au lieu d'énumérer. */
const MAX_VISIBLE = 3

/** Le mois d'une date, au format `AAAA-MM`. */
function moisDe(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Le jour, au format `AAAA-MM-JJ`, sans passer par UTC — un planning est local. */
function jourDe(date: Date): string {
  return `${moisDe(date)}-${String(date.getDate()).padStart(2, '0')}`
}

/** Les 35 ou 42 cases d'un mois, lundi en premier, bordées des jours voisins. */
function grille(mois: string): Date[] {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  const premier = new Date(annee, numero - 1, 1)
  // `getDay()` rend 0 pour dimanche : on décale pour que lundi vaille 0.
  const decalage = (premier.getDay() + 6) % 7
  const debut = new Date(annee, numero - 1, 1 - decalage)

  const fin = new Date(annee, numero, 0)
  const cases = decalage + fin.getDate()
  const total = Math.ceil(cases / 7) * 7

  return Array.from({ length: total }, (_, index) => {
    const jour = new Date(debut)
    jour.setDate(debut.getDate() + index)
    return jour
  })
}

export function CalendarView({
  projectId,
  blockId,
  emptyText,
  refreshToken,
}: {
  projectId: string
  blockId: string
  emptyText: string
  refreshToken: number
}) {
  const [mois, setMois] = useState(() => moisDe(new Date()))
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ouvert, setOuvert] = useState<string | null>(null)

  const charge = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/app/${projectId}/calendrier?bloc=${encodeURIComponent(blockId)}&mois=${mois}`,
        { cache: 'no-store' },
      )
      const body = (await response.json().catch(() => null)) as {
        entries?: Entry[]
        message?: string
      } | null
      if (body === null || !response.ok) {
        setError(body?.message ?? 'Impossible de charger le calendrier.')
        return
      }
      setError(null)
      setEntries(body.entries ?? [])
    } catch {
      setError('La connexion a échoué.')
    }
  }, [projectId, blockId, mois])

  useEffect(() => {
    let annule = false
    void (async () => {
      if (!annule) await charge()
    })()
    return () => {
      annule = true
    }
  }, [charge, refreshToken])

  /** Les fiches rangées par jour : la grille n'a plus qu'à lire. */
  const parJour = useMemo(() => {
    const table = new Map<string, Entry[]>()
    for (const entry of entries ?? []) {
      const liste = table.get(entry.day)
      if (liste === undefined) table.set(entry.day, [entry])
      else liste.push(entry)
    }
    return table
  }, [entries])

  const cases = useMemo(() => grille(mois), [mois])
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  const aujourdhui = jourDe(new Date())

  function decale(pas: number) {
    const date = new Date(annee, numero - 1 + pas, 1)
    setMois(moisDe(date))
    setOuvert(null)
  }

  const bordure = { borderColor: 'var(--app-muted)' }
  const ouvertes = ouvert === null ? [] : (parJour.get(ouvert) ?? [])

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-lg font-medium">
          {MOIS[numero - 1]} {annee}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => decale(-1)}
            aria-label="Mois précédent"
            className="rounded-[var(--app-radius)] border px-3 py-1.5 text-sm"
            style={bordure}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              setMois(moisDe(new Date()))
              setOuvert(null)
            }}
            className="rounded-[var(--app-radius)] border px-3 py-1.5 text-sm"
            style={bordure}
          >
            Aujourd’hui
          </button>
          <button
            type="button"
            onClick={() => decale(1)}
            aria-label="Mois suivant"
            className="rounded-[var(--app-radius)] border px-3 py-1.5 text-sm"
            style={bordure}
          >
            →
          </button>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="m-0 text-sm" style={{ color: '#b91c1c' }}>
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[var(--app-radius-lg)] border"
        style={{ borderColor: 'var(--app-muted)', background: 'var(--app-muted)' }}
      >
        {JOURS.map((jour) => (
          <div
            key={jour}
            className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide opacity-70"
            style={{ background: 'var(--app-surface)' }}
          >
            {jour}
          </div>
        ))}

        {cases.map((date) => {
          const jour = jourDe(date)
          const dedans = date.getMonth() === numero - 1
          const fiches = parJour.get(jour) ?? []
          const cejour = jour === aujourdhui

          return (
            <button
              key={jour}
              type="button"
              onClick={() => setOuvert(fiches.length === 0 ? null : jour)}
              className="min-h-24 p-2 text-left align-top"
              style={{
                background: 'var(--app-surface)',
                opacity: dedans ? 1 : 0.45,
                cursor: fiches.length === 0 ? 'default' : 'pointer',
              }}
              aria-label={`${date.getDate()} ${MOIS[date.getMonth()]}, ${fiches.length} élément${fiches.length > 1 ? 's' : ''}`}
            >
              <span
                className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs"
                style={
                  cejour
                    ? { background: 'var(--app-primary)', color: '#fff', fontWeight: 600 }
                    : undefined
                }
              >
                {date.getDate()}
              </span>

              <span className="mt-1 block space-y-1">
                {fiches.slice(0, MAX_VISIBLE).map((entry) => (
                  <span
                    key={entry.id}
                    className="block truncate rounded-[var(--app-radius)] px-1.5 py-0.5 text-xs"
                    style={{ background: 'var(--app-muted)' }}
                    title={entry.label}
                  >
                    {entry.tone === null ? entry.label : `${entry.tone} · ${entry.label}`}
                  </span>
                ))}
                {fiches.length > MAX_VISIBLE ? (
                  <span className="block px-1.5 text-xs opacity-70">
                    +{fiches.length - MAX_VISIBLE}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {entries !== null && entries.length === 0 ? (
        <p className="m-0 text-sm opacity-70">{emptyText}</p>
      ) : null}

      {ouvert !== null && ouvertes.length > 0 ? (
        <div
          className="rounded-[var(--app-radius-lg)] border p-4"
          style={{ borderColor: 'var(--app-border)', background: 'var(--app-surface)' }}
        >
          <p className="m-0 mb-2 font-medium">
            {Number(ouvert.slice(8))} {MOIS[Number(ouvert.slice(5, 7)) - 1]}
          </p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {ouvertes.map((entry) => (
              <li key={entry.id} className="text-sm">
                {entry.tone === null ? null : (
                  <span
                    className="mr-2 inline-block rounded-full border px-2 py-0.5 text-xs"
                    style={bordure}
                  >
                    {entry.tone}
                  </span>
                )}
                {entry.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
