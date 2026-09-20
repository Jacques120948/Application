'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Ce que Google a indexé, et ce qu'il ignore.
 *
 * Trois partis pris, chacun contre une façon de mentir avec ce sujet.
 *
 * **« Suspecte » et non « absente ».** Une page qui ne sort jamais dans Google peut être
 * parfaitement indexée et n'intéresser personne. Seul Google sait, et il faut le lui
 * demander page par page. Annoncer « 40 pages non indexées » à partir d'un écart de
 * chiffres serait faux, et c'est pourtant ce que vend la moitié du marché.
 *
 * **La vérification se demande, elle ne se subit pas.** Interroger Google à l'ouverture de
 * l'écran brûlerait un quota qu'on ne connaît pas, pour quelqu'un qui passait par là.
 *
 * **Rien n'est promis.** Evoliia ne peut pas faire indexer une page : personne ne le peut.
 * On dit ce que Google dit, et ce qui, dans le site, l'empêche peut-être.
 */

export type SuspecteVue = { url: string; path: string; depth: number }

export type EtatPageVu = {
  url: string
  verdict: string
  etat: string
  vueLe: string | null
  robots: string
  canoniqueDivergent: string | null
  lien: string | null
}

const TEINTE: Record<string, string> = {
  PASS: 'var(--color-positive, #067647)',
  PARTIAL: 'var(--color-caution, #b54708)',
  FAIL: 'var(--color-critical, #b42318)',
}

function enClair(iso: string | null, locale: string): string {
  if (iso === null) return 'jamais'
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? 'jamais'
    : date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
}

export function Indexation({
  siteId,
  locale,
  suspectes,
  explorees,
  affichees,
  jours,
  propriete,
  maximum,
}: {
  siteId: string
  locale: string
  suspectes: readonly SuspecteVue[]
  explorees: number
  affichees: number
  jours: number
  propriete: string | null
  maximum: number
}) {
  const [etats, setEtats] = useState<EtatPageVu[] | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function verifier() {
    setOccupe(true)
    setErreur(null)
    const reponse = await fetch(`/api/sites/${siteId}/indexation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: suspectes.slice(0, maximum).map((page) => page.url) }),
    })
    const corps = (await reponse.json().catch(() => ({}))) as {
      ok?: boolean
      pages?: EtatPageVu[]
      raison?: string
      message?: string
    }
    setOccupe(false)
    if (!reponse.ok || corps.ok === false) {
      setErreur(corps.raison ?? corps.message ?? 'La vérification n’a pas abouti.')
      return
    }
    setEtats(corps.pages ?? [])
  }

  if (propriete === null) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm leading-relaxed">
          Google Search Console n’est pas relié pour ce site. Sans lui, Evoliia ne peut pas
          savoir ce que Google a indexé — c’est Google qui détient la réponse, et personne
          d’autre.
        </p>
        <a
          href={`/${locale}/connexions`}
          className="mt-3 inline-block text-sm text-[var(--color-ink-soft)]"
        >
          Connecter Search Console
        </a>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <div className="flex flex-wrap items-center gap-3">
          <img
            src="/equipe/neo.webp"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
          <p className="m-0 flex-1 text-sm leading-relaxed">
            <strong>Néo</strong> a relevé <strong>{explorees}</strong> pages sur votre site.
            Google en a affiché <strong>{affichees}</strong> au moins une fois ces {jours}{' '}
            derniers jours.
          </p>
        </div>

        <p className="mt-4 mb-0 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {suspectes.length === 0
            ? 'Toutes vos pages relevées apparaissent au moins une fois dans Google. Il n’y a rien à vérifier.'
            : `${suspectes.length} pages n’apparaissent jamais. Ce n’est pas une preuve : une page peut être indexée et n’intéresser personne. Seul Google tranche, et il faut le lui demander page par page.`}
        </p>

        {suspectes.length === 0 ? null : (
          <div className="mt-5 grid gap-2">
            {erreur === null ? null : (
              <p className="m-0 text-xs text-[var(--color-critical)]">{erreur}</p>
            )}
            <Button disabled={occupe} onClick={() => void verifier()}>
              {occupe
                ? 'Google répond…'
                : `Demander à Google (${Math.min(suspectes.length, maximum)} pages)`}
            </Button>
            <p className="m-0 text-xs text-[var(--color-ink-faint)]">
              Gratuit, aucun crédit. {maximum} pages au plus par vérification : Google limite
              le nombre d’inspections par jour.
            </p>
          </div>
        )}
      </div>

      {etats === null ? (
        suspectes.length === 0 ? null : (
          <section>
            <h2 className="m-0 mb-3 text-base font-semibold">Pages à vérifier</h2>
            <ul className="m-0 grid list-none gap-2 p-0">
              {suspectes.map((page) => (
                <li
                  key={page.url}
                  className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-2.5 text-sm break-all"
                >
                  {page.path}
                </li>
              ))}
            </ul>
          </section>
        )
      ) : (
        <section>
          <h2 className="m-0 mb-3 text-base font-semibold">Ce que Google répond</h2>
          {etats.length === 0 ? (
            <p className="m-0 text-sm text-[var(--color-ink-faint)]">
              Google n’a rien rendu pour ces pages.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {etats.map((page) => (
                <li
                  key={page.url}
                  className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
                >
                  <p className="m-0 text-sm font-medium break-all">{page.url}</p>
                  <p className="mt-1 mb-0 text-sm">
                    <span style={{ color: TEINTE[page.verdict] ?? 'var(--color-ink-soft)' }}>
                      ● 
                    </span>
                    {page.etat}
                  </p>
                  <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
                    Vue par Google : {enClair(page.vueLe, locale)}
                    {page.robots === 'ALLOWED' ? '' : ` · robots.txt : ${page.robots}`}
                  </p>
                  {page.canoniqueDivergent === null ? null : (
                    <p className="mt-1 mb-0 text-xs text-[var(--color-caution,#b54708)]">
                      Google a retenu une autre adresse : {page.canoniqueDivergent}
                    </p>
                  )}
                  {page.lien === null ? null : (
                    <a
                      href={page.lien}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-xs text-[var(--color-ink-soft)]"
                    >
                      Ouvrir dans Search Console ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Evoliia ne peut pas faire indexer une page, et personne ne le peut — ni elle, ni
            un outil qui vous le promet. Ce qui se corrige, c’est ce qui l’empêche : une
            page bloquée, un canonique qui renvoie ailleurs, une page trop mince. Demandez à
            Néo quoi faire de ce qui précède.
          </p>
        </section>
      )}
    </div>
  )
}
