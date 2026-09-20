'use client'

import { useState } from 'react'

/**
 * Ce qu'on laisse tourner seul.
 *
 * Quatre interrupteurs, et une frontière que l'écran doit rendre évidente : trois ne
 * coûtent rien, le quatrième dépense. Les mélanger dans une même liste ferait allumer la
 * dépense par inadvertance, en cochant « tout ».
 *
 * Rien n'est allumé au départ. Une fonctionnalité qui existe n'est pas une fonctionnalité
 * qu'on veut, et le jour où Evoliia écrit un article que personne n'a demandé puis le
 * facture, elle a perdu la confiance de quelqu'un pour toujours.
 */

export type ReglagesVus = {
  indexation: boolean
  releve: boolean
  redaction: boolean
  depot: boolean
  blogId: string
  parPeriode: number
  periode: 'semaine' | 'mois'
}

const RYTHMES: { parPeriode: number; periode: 'semaine' | 'mois'; label: string }[] = [
  { parPeriode: 1, periode: 'semaine', label: '1 par semaine' },
  { parPeriode: 2, periode: 'semaine', label: '2 par semaine' },
  { parPeriode: 3, periode: 'semaine', label: '3 par semaine' },
  { parPeriode: 1, periode: 'mois', label: '1 par mois' },
  { parPeriode: 2, periode: 'mois', label: '2 par mois' },
]

function Interrupteur({
  titre,
  detail,
  actif,
  onChange,
}: {
  titre: string
  detail: string
  actif: boolean
  onChange: (valeur: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-4 py-3">
      <input
        type="checkbox"
        checked={actif}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{titre}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-ink-soft)]">
          {detail}
        </span>
      </span>
    </label>
  )
}

export function Automatisation({
  siteId,
  initiaux,
  cout,
  boutiqueReliee,
  rechercheReliee,
}: {
  siteId: string
  initiaux: ReglagesVus
  /** La fourchette d'un article, telle que le catalogue la donne. */
  cout: { min: number; max: number } | null
  boutiqueReliee: boolean
  rechercheReliee: boolean
}) {
  const [reglages, setReglages] = useState<ReglagesVus>(initiaux)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enregistre, setEnregistre] = useState(false)

  function changer(patch: Partial<ReglagesVus>) {
    setReglages((actuels) => ({ ...actuels, ...patch }))
    setEnregistre(false)
  }

  async function enregistrer() {
    setOccupe(true)
    setErreur(null)
    const reponse = await fetch(`/api/sites/${siteId}/automatisation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reglages),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as { message?: string } | null
    setOccupe(false)
    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `L’enregistrement n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    setEnregistre(true)
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 mb-1 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
          Sans frais
        </p>
        <p className="m-0 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Ces deux-là lisent chez Google avec votre propre compte. Aucun crédit n’est débité,
          ni maintenant ni plus tard.
        </p>
        <div className="grid gap-2">
          <Interrupteur
            titre="Vérifier l’indexation chaque nuit"
            detail={
              rechercheReliee
                ? 'Evoliia demande à Google l’état de 10 pages parmi celles qui n’apparaissent jamais, et met l’écran à jour.'
                : 'Demande Google Search Console, qui n’est pas relié pour ce site.'
            }
            actif={reglages.indexation}
            onChange={(indexation) => changer({ indexation })}
          />
          <Interrupteur
            titre="Garder la trace des chiffres de recherche"
            detail="Une photographie par jour, gardée six mois. C’est ce qui permet de dire qu’une recherche a gagné des places — Google ne le dit pas sous cette forme."
            actif={reglages.releve}
            onChange={(releve) => changer({ releve })}
          />
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 mb-1 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
          Dépense des crédits
        </p>
        <p className="m-0 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {cout === null
            ? 'Chaque article écrit débite des crédits, au même tarif que si vous cliquiez vous-même.'
            : `Chaque article écrit débite ${cout.min} à ${cout.max} crédits, au même tarif que si vous cliquiez vous-même.`}{' '}
          Rien ne part si votre solde est vide, et le retard ne se rattrape jamais : trois
          semaines sans tournée donnent un article, pas trois.
        </p>
        <div className="grid gap-2">
          <Interrupteur
            titre="Faire écrire les articles du calendrier"
            detail="Milo écrit sur la recherche qui vient en tête du calendrier, dans sa langue. Vous relisez ensuite, comme d’habitude."
            actif={reglages.redaction}
            onChange={(redaction) => changer({ redaction })}
          />
          {!reglages.redaction ? null : (
            <>
              <label className="block px-4 pt-2">
                <span className="text-sm font-medium">À quel rythme ?</span>
                <select
                  value={`${reglages.parPeriode}-${reglages.periode}`}
                  onChange={(event) => {
                    const [par, periode] = event.target.value.split('-')
                    changer({
                      parPeriode: Number(par),
                      periode: periode === 'mois' ? 'mois' : 'semaine',
                    })
                  }}
                  className="mt-1.5 w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-2.5 text-sm"
                >
                  {RYTHMES.map((rythme) => (
                    <option
                      key={`${rythme.parPeriode}-${rythme.periode}`}
                      value={`${rythme.parPeriode}-${rythme.periode}`}
                    >
                      {rythme.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1.5 block text-xs text-[var(--color-ink-faint)]">
                  C’est la borne de la dépense, pas un objectif : Evoliia n’écrira jamais
                  plus vite que ce rythme.
                </span>
              </label>
              <Interrupteur
                titre="Déposer l’article dans Shopify"
                detail={
                  boutiqueReliee
                    ? 'En brouillon, jamais publié. Vous le relisez dans Shopify et vous le publiez vous-même.'
                    : 'Demande une boutique Shopify reliée, ce qui n’est pas le cas.'
                }
                actif={reglages.depot}
                onChange={(depot) => changer({ depot })}
              />
            </>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={occupe}
          className="cursor-pointer rounded-[var(--radius-pill)] border-0 bg-[var(--color-brand)] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {enregistre ? (
          <span className="text-sm text-[var(--color-ink-soft)]">Enregistré.</span>
        ) : null}
        {erreur === null ? null : (
          <span className="text-sm text-[var(--color-danger,#b42318)]">{erreur}</span>
        )}
      </div>
    </div>
  )
}
