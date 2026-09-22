'use client'

import { useState } from 'react'

/**
 * Ce que MIRA a trouvé, et ce qu'on peut en faire.
 *
 * Le bloc existait déjà dans le tableau, recalculé à chaque affichage. Il en sort pour trois
 * raisons, et chacune se voit à l'écran.
 *
 * **Un constat a un âge.** « Cette annonce fatigue depuis douze jours » ne se lit pas comme
 * « depuis hier » : la première phrase dit qu'on n'a rien fait, la seconde qu'on vient
 * d'apprendre. Un calcul à l'affichage ne peut pas le savoir.
 *
 * **Un constat écarté reste écarté.** Un mois, pas pour toujours : rouvrir le lendemain
 * l'avis refusé la veille est la façon la plus sûre de faire cesser de lire une liste ; le
 * taire à jamais en est l'autre, puisque la situation, elle, n'a pas disparu.
 *
 * **La liste ne dépend pas de la période affichée.** Les règles jugent sur quatorze jours,
 * quelle que soit la case cochée plus haut. Le sélecteur sert à regarder des chiffres ; il
 * n'a pas à faire apparaître et disparaître des problèmes.
 *
 * Rien ne s'applique ici. Aucun bouton n'envoie quoi que ce soit chez Meta — MIRA propose,
 * et tant que l'écriture n'existe pas, un bouton « appliquer » inerte serait pire que pas de
 * bouton du tout.
 */

export type ConstatVue = {
  id: string
  regle: string
  priorite: 'urgent' | 'surveiller' | 'opportunite' | 'information'
  niveau: 'campagne' | 'ensemble' | 'annonce'
  titre: string
  observation: string
  pourquoi: string
  consequence: string
  recommandation: string
  /** Jours écoulés depuis l'ouverture, calculés côté serveur. */
  age: number
}

const PRIORITES: Record<ConstatVue['priorite'], { mot: string; point: string; fond: string }> = {
  urgent: {
    mot: 'À traiter',
    point: 'var(--color-critical)',
    fond: 'var(--color-critical-soft)',
  },
  opportunite: {
    mot: 'Occasion',
    point: 'var(--color-positive)',
    fond: 'var(--color-positive-soft)',
  },
  surveiller: {
    mot: 'À surveiller',
    point: 'var(--color-caution)',
    fond: 'var(--color-caution-soft)',
  },
  information: {
    mot: 'Bon à savoir',
    point: 'var(--color-ink-soft)',
    fond: 'var(--color-canvas)',
  },
}

const ETAGES: Record<ConstatVue['niveau'], string> = {
  campagne: 'Campagne',
  ensemble: 'Ensemble de publicités',
  annonce: 'Publicité',
}

export function ConstatsMeta({ initiaux }: { initiaux: readonly ConstatVue[] }) {
  const [liste, setListe] = useState<ConstatVue[]>([...initiaux])
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  async function ecarter(id: string) {
    setOccupe(id)
    setErreur(null)
    const reponse = await fetch('/api/ads/meta/recommandations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ecarter', id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(null)
    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `Le geste n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    setListe((actuels) => actuels.filter((un) => un.id !== id))
  }

  /*
   * Le silence est dit en toutes lettres : un bloc absent se prend pour un écran qui n'a pas
   * fini de charger, et on cherche alors ce qu'on a mal fait.
   */
  if (liste.length === 0) {
    return (
      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-positive-soft)] p-5">
        <h2 className="m-0 text-base font-semibold">Rien ne réclame votre attention</h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Sur les quatorze derniers jours, aucune de vos campagnes, de vos ensembles ni de vos
          annonces ne déclenche l’une des règles de MIRA. Les chiffres détaillés restent en
          dessous.
        </p>
      </section>
    )
  }

  const urgents = liste.filter((un) => un.priorite === 'urgent').length

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">Ce que MIRA a trouvé</h2>
        <span className="text-xs text-[var(--color-ink-faint)]">
          {liste.length} constat{liste.length > 1 ? 's' : ''}
          {urgents === 0 ? '' : ` · ${urgents} à traiter`}
        </span>
      </div>

      {erreur === null ? null : (
        <p
          role="alert"
          className="mt-3 mb-0 rounded-[var(--radius-control)] bg-[var(--color-critical-soft)] p-3 text-sm text-[var(--color-critical)]"
        >
          {erreur}
        </p>
      )}

      <ul className="mt-4 mb-0 grid list-none gap-3 p-0">
        {liste.map((constat) => {
          const ton = PRIORITES[constat.priorite]
          return (
            <li
              key={constat.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: ton.fond, color: ton.point }}
                >
                  {ton.mot}
                </span>
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {ETAGES[constat.niveau]}
                </span>
                <span className="text-xs text-[var(--color-ink-faint)]">
                  ·{' '}
                  {constat.age === 0
                    ? 'repéré aujourd’hui'
                    : `ouvert depuis ${constat.age} jour${constat.age > 1 ? 's' : ''}`}
                </span>
              </div>

              <p className="mt-2 mb-0 text-sm font-medium break-words">{constat.titre}</p>
              <p className="mt-1 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {constat.observation}
              </p>

              <p className="mt-3 mb-0 text-sm leading-relaxed">
                <span className="font-medium">Ce que je propose : </span>
                {constat.recommandation}
              </p>

              <details className="mt-2">
                <summary className="cursor-pointer list-none text-xs text-[var(--color-ink-soft)]">
                  <span className="underline underline-offset-4">
                    Pourquoi, et ce qui arrive sinon
                  </span>
                </summary>
                <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {constat.pourquoi}
                </p>
                <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  {constat.consequence}
                </p>
              </details>

              <button
                type="button"
                onClick={() => void ecarter(constat.id)}
                disabled={occupe === constat.id}
                className="mt-3 cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-ink-soft)] disabled:opacity-50"
              >
                {occupe === constat.id ? 'Un instant…' : 'Ce n’est pas un problème'}
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-4 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Ces constats sont produits par des règles écrites, pas par un modèle : chacun porte
        les chiffres qui l’ont déclenché, et se vérifie. Ils sont jugés sur quatorze jours,
        quelle que soit la période affichée plus bas. Aucun n’est appliqué — MIRA propose,
        c’est vous qui décidez. « Ce n’est pas un problème » écarte le constat pour un mois.
      </p>
    </section>
  )
}
