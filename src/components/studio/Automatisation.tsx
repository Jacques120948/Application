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
  assistants: boolean
  assistantsJours: number
  point: boolean
  blogId: string
  parPeriode: number
  periode: 'semaine' | 'mois'
}

/**
 * Les cadences du relevé dans les assistants, dites en clair et avec leur prix.
 *
 * La durée seule ne dit rien : « tous les 30 jours » ne se compare pas à « toutes les
 * semaines » tant qu'on n'a pas fait la division soi-même. Or c'est exactement cette
 * division qui décide — passer au mois divise par quatre la dépense la plus lourde du
 * produit. L'écran la fait donc, avec les questions réellement suivies.
 */
const CADENCES: { jours: number; label: string; parAn: number }[] = [
  { jours: 7, label: 'Chaque semaine', parAn: 52 },
  { jours: 14, label: 'Toutes les deux semaines', parAn: 26 },
  { jours: 30, label: 'Une fois par mois', parAn: 12 },
]

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
  questionsIa,
  coutIa,
  coutPoint,
}: {
  siteId: string
  initiaux: ReglagesVus
  /** La fourchette d'un article, telle que le catalogue la donne. */
  cout: { min: number; max: number } | null
  boutiqueReliee: boolean
  rechercheReliee: boolean
  /** Combien de questions sont suivies : c'est ce qui décide de la dépense hebdomadaire. */
  questionsIa: number
  coutIa: number
  coutPoint: number
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
          <Interrupteur
            titre="Le point hebdomadaire de Léa"
            detail={`Une fois par semaine, Léa regarde tout — l’analyse, les pannes, l’indexation, vos chiffres de recherche, ce qui a été publié, votre visibilité dans les assistants — et dit où vous en êtes et par quoi continuer. Environ ${coutPoint} crédits par semaine. Ses conclusions passent aussi à Néo, Gia et Milo.`}
            actif={reglages.point}
            onChange={(point) => changer({ point })}
          />
          <Interrupteur
            titre="Poser vos questions aux assistants"
            detail={
              questionsIa === 0
                ? 'Vous ne suivez aucune question pour l’instant. Ajoutez-en depuis « Votre marque dans les IA ».'
                : `${questionsIa} question${questionsIa > 1 ? 's' : ''} suivie${questionsIa > 1 ? 's' : ''}, soit ${questionsIa * coutIa} crédits par relevé. Jamais chaque nuit : une réponse d’assistant ne change pas d’un jour à l’autre.`
            }
            actif={reglages.assistants}
            onChange={(assistants) => changer({ assistants })}
          />
          {!reglages.assistants ? null : (
            /*
             * Sous l'interrupteur, et seulement quand il est allumé : une cadence pour
             * quelque chose d'éteint est un réglage sans objet, et il occupe la place au
             * moment précis où l'on décide d'allumer.
             */
            <label className="block px-4 pt-2">
              <span className="text-sm font-medium">Tous les combien ?</span>
              <select
                value={reglages.assistantsJours}
                onChange={(event) => changer({ assistantsJours: Number(event.target.value) })}
                className="mt-1.5 w-full rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-2.5 text-sm"
              >
                {CADENCES.map((cadence) => (
                  <option key={cadence.jours} value={cadence.jours}>
                    {cadence.label}
                    {questionsIa === 0
                      ? ''
                      : ` — environ ${Math.round((questionsIa * coutIa * cadence.parAn) / 12)} crédits par mois`}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-xs leading-relaxed text-[var(--color-ink-faint)]">
                C’est de loin la dépense la plus lourde du produit, et la seule qui se
                divise sans rien perdre : ce qu’un assistant répond bouge au mois, pas à la
                semaine. Douze mesures par an et par question suffisent à voir une tendance.
              </span>
            </label>
          )}
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
