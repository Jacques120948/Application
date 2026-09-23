'use client'

import { useState } from 'react'

/**
 * Le résumé d'Oria, et le bouton qui le demande.
 *
 * Le prix est écrit sur le bouton, avant le clic. C'est la seule chose d'Oria qui coûte, et
 * personne ne doit le découvrir sur son solde.
 *
 * Un résumé déjà écrit s'affiche avec sa date, gratuitement ; le bouton propose alors de le
 * réécrire, pas de l'écrire. Rien ne se déclenche seul.
 */

type Resume = { phrases: string[]; createdAt: string; creditsSpent: number }

function quand(iso: string): string {
  const date = new Date(iso)
  const minutes = Math.round((Date.now() - +date) / 60_000)
  if (minutes < 2) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} minutes`
  const heures = Math.round(minutes / 60)
  if (heures < 24) return `il y a ${heures} heure${heures > 1 ? 's' : ''}`
  return `le ${new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long' }).format(date)}`
}

export function ResumeOria({
  titre,
  genre,
  siteId,
  locale,
  initial,
  cout,
}: {
  titre: string
  genre: 'jour' | 'semaine'
  siteId: string
  locale: string
  initial: Resume | null
  /** La fourchette annoncée, lue dans le catalogue réglable. */
  cout: { min: number; max: number } | null
}) {
  const [resume, setResume] = useState<Resume | null>(initial)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const prix =
    cout === null ? '' : cout.min === cout.max ? ` (${cout.min} crédits)` : ` (${cout.min} à ${cout.max} crédits)`

  async function demander() {
    setOccupe(true)
    setErreur(null)
    const reponse = await fetch('/api/oria/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ genre, locale, ...(siteId === '' ? {} : { siteId }) }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as
      | { resume?: { phrases: string[]; createdAt: string; creditsSpent: number }; message?: string }
      | null
    setOccupe(false)
    if (reponse === null || !reponse.ok || corps?.resume === undefined) {
      setErreur(corps?.message ?? `Oria n’a pas pu écrire le résumé (code ${reponse?.status ?? 0}).`)
      return
    }
    setResume(corps.resume)
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/equipe/oria.webp" alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
        <h2 className="m-0 text-base font-semibold">{titre}</h2>
      </div>

      {resume === null ? (
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Oria peut vous dire tout cela en quelques phrases. Tout ce qu’elle écrira est déjà sur
          cette page : elle le met en mots, elle n’ajoute rien.
        </p>
      ) : (
        <div className="mt-3">
          <p className="m-0 text-sm leading-relaxed">{resume.phrases.join(' ')}</p>
          <p className="mt-2 mb-0 text-xs text-[var(--color-ink-faint)]">
            Écrit {quand(resume.createdAt)}
            {resume.creditsSpent > 0 ? ` · ${resume.creditsSpent} crédit${resume.creditsSpent > 1 ? 's' : ''}` : ''}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={demander}
          disabled={occupe}
          className="inline-flex items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium hover:border-[var(--color-brand)] disabled:opacity-50"
        >
          {occupe ? 'Oria écrit…' : `${resume === null ? 'Demander le résumé' : 'Le réécrire'}${prix}`}
        </button>
        {erreur === null ? null : (
          <p role="alert" className="m-0 text-sm" style={{ color: 'var(--color-critical)' }}>
            {erreur}
          </p>
        )}
      </div>
    </section>
  )
}
