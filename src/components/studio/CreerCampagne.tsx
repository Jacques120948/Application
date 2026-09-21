'use client'

import { useState } from 'react'

/**
 * Créer une campagne Recherche, en voyant d'abord ce qui sera créé.
 *
 * Une campagne, chez Google, c'est sept objets : un budget, la campagne, son pays, sa
 * langue, un groupe d'annonces, ses mots-clés, une annonce. Un formulaire qui demanderait un
 * nom et un budget puis créerait les sept en cacherait cinq — et la personne découvrirait
 * après coup ce qu'elle a accepté.
 *
 * D'où les deux temps. On décrit ce qu'on veut ; Naya compose un plan complet, qu'on relit
 * en entier ; on crée, ou on abandonne. Entre les deux, rien n'est parti chez Google.
 *
 * Ce qui est écrit sur cet écran et qui ne se règle pas : la campagne naît en pause, le
 * réseau Display et les partenaires de recherche sont coupés, le ciblage est en présence
 * seule. Ce sont les trois réglages par lesquels un petit budget se vide sans qu'on
 * comprenne, et Evoliia ne propose pas de les desserrer.
 */

export type MotClePlan = {
  texte: string
  correspondance: string
  volume: number
  coutBasMicros: number
  coutHautMicros: number
  motif: string
}

export type PlanVue = {
  id: string
  nom: string
  budgetMicros: number
  enchereMicros: number
  urlFinale: string
  marcheNom: string
  langueNom: string
  motsCles: MotClePlan[]
  titres: string[]
  descriptions: string[]
}

const MICROS = 1_000_000

function prix(micros: number, devise: string): string {
  return `${(micros / MICROS).toFixed(2)} ${devise}`
}

export function CreerCampagne({
  plans,
  devise,
  hote,
  deposable,
}: {
  plans: readonly PlanVue[]
  devise: string
  /** Le domaine du site suivi : la page d'arrivée doit s'y trouver. */
  hote: string
  /** Vrai quand le compte est en mode assisté. Sans cela, rien ne peut être créé. */
  deposable: boolean
}) {
  const [ouvert, setOuvert] = useState(false)
  const [nom, setNom] = useState('')
  const [budget, setBudget] = useState('')
  const [url, setUrl] = useState(hote === '' ? '' : `https://${hote}/`)
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)

  async function appeler(corps: Record<string, unknown>, clef: string) {
    setOccupe(clef)
    setErreur(null)
    setMessage(null)
    const reponse = await fetch('/api/ads/campagne', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }).catch(() => null)
    const lu = (await reponse?.json().catch(() => null)) as {
      ok?: boolean
      raison?: string
      message?: string
      bilan?: { dejaGagnees: number; credits: number }
    } | null
    setOccupe(null)
    if (reponse === null || !reponse.ok) {
      setErreur(lu?.message ?? `Le geste n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return null
    }
    if (lu?.ok !== true) {
      setErreur(lu?.raison ?? 'Google n’a pas accepté.')
      setAConfirmer(null)
      return null
    }
    return lu
  }

  async function preparer() {
    const montant = Number(budget.replace(',', '.'))
    if (!Number.isFinite(montant) || montant <= 0) {
      setErreur('Indiquez un budget quotidien.')
      return
    }
    const lu = await appeler(
      { action: 'preparer', nom: nom.trim(), budget: montant, urlFinale: url.trim() },
      'preparer',
    )
    if (lu === null) return
    setMessage('Plan préparé. Rechargez la page.')
    window.location.reload()
  }

  async function creer(planId: string) {
    const lu = await appeler({ action: 'creer', planId }, planId)
    if (lu === null) return
    window.location.reload()
  }

  async function abandonner(planId: string) {
    const lu = await appeler({ action: 'abandonner', planId }, planId)
    if (lu === null) return
    window.location.reload()
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">Créer une campagne Recherche</h2>
        {plans.length > 0 || ouvert ? null : (
          <button
            type="button"
            onClick={() => setOuvert(true)}
            disabled={!deposable}
            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:border-[var(--color-line)] disabled:text-[var(--color-ink-faint)]"
          >
            Préparer un plan
          </button>
        )}
      </div>

      {plans.length === 0 && !ouvert ? (
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          {deposable
            ? 'Naya compose une campagne complète à partir de ce que les gens tapent déjà pour vous trouver : les mots-clés, l’annonce, le budget, le ciblage. Vous relisez tout avant qu’une seule ligne parte chez Google.'
            : 'Pour créer une campagne, passez d’abord votre compte en mode assisté, plus haut sur cette page.'}
        </p>
      ) : null}

      {ouvert && plans.length === 0 ? (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--color-ink-soft)]">Nom de la campagne</span>
            <input
              value={nom}
              onChange={(evenement) => setNom(evenement.target.value)}
              maxLength={120}
              placeholder="Recherche — Bougies citrine"
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--color-ink-soft)]">Budget quotidien ({devise})</span>
            <input
              value={budget}
              onChange={(evenement) => setBudget(evenement.target.value)}
              inputMode="decimal"
              placeholder="5"
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-[var(--color-ink-soft)]">Page d’arrivée</span>
            <input
              value={url}
              onChange={(evenement) => setUrl(evenement.target.value)}
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2"
            />
            <span className="text-xs text-[var(--color-ink-faint)]">
              Sur votre domaine{hote === '' ? '' : ` (${hote})`}. Evoliia n’achète pas de trafic
              vers une adresse qui n’est pas la vôtre.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void preparer()}
              disabled={occupe !== null}
              className="cursor-pointer rounded-[var(--radius-control)] border-0 px-4 py-2 text-sm font-medium text-white [background-image:var(--gradient-cta)] disabled:opacity-50"
            >
              {occupe === 'preparer' ? 'Naya compose…' : 'Composer le plan'}
            </button>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              disabled={occupe !== null}
              className="cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Composer un plan ne touche pas à Google et coûte quelques crédits : Naya rédige
            l’annonce. Rien ne sera créé tant que vous ne l’aurez pas relu.
          </p>
        </div>
      ) : null}

      {plans.map((plan) => (
        <article
          key={plan.id}
          className="mt-4 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="m-0 text-sm font-semibold">{plan.nom}</h3>
            <span className="text-xs text-[var(--color-ink-faint)]">
              {prix(plan.budgetMicros, devise)} par jour · enchère{' '}
              {plan.enchereMicros === 0 ? '—' : prix(plan.enchereMicros, devise)} · {plan.marcheNom}{' '}
              en {plan.langueNom}
            </span>
          </div>

          <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">
            Page d’arrivée : {plan.urlFinale}
          </p>

          <p className="mt-3 mb-1 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
            {plan.motsCles.length} mots-clés
          </p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {plan.motsCles.map((mot) => (
              <li key={mot.texte} className="text-sm">
                <span className="font-medium">{mot.texte}</span>{' '}
                <span className="text-xs text-[var(--color-ink-faint)]">
                  {mot.correspondance === 'exact' ? 'exact' : 'expression'}
                  {mot.volume === 0 ? '' : ` · ${mot.volume} recherches/mois`}
                  {mot.coutHautMicros === 0
                    ? ''
                    : ` · ${prix(mot.coutBasMicros, devise)} – ${prix(mot.coutHautMicros, devise)}`}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3 mb-1 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
            L’annonce — {plan.titres.length} titres, {plan.descriptions.length} descriptions
          </p>
          <ul className="m-0 grid list-none gap-1 p-0 text-sm">
            {plan.titres.map((titre) => (
              <li key={titre}>{titre}</li>
            ))}
          </ul>
          <ul className="m-0 mt-1 grid list-none gap-1 p-0 text-sm text-[var(--color-ink-soft)]">
            {plan.descriptions.map((description) => (
              <li key={description}>{description}</li>
            ))}
          </ul>

          <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-surface)] p-3">
            <p className="m-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              La campagne sera créée <strong>en pause</strong> : elle ne dépensera rien tant que
              vous ne l’aurez pas lancée depuis Google Ads. Le réseau Display et les partenaires
              de recherche sont coupés, et le ciblage est en présence seule — trois réglages par
              lesquels un petit budget se vide sans qu’on comprenne. L’enchère est manuelle :
              une stratégie automatique dépenserait d’abord pour apprendre.
            </p>
          </div>

          {aConfirmer === plan.id ? (
            <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-surface)] p-3">
              <p className="m-0 text-sm font-medium">
                Créer « {plan.nom} » chez Google, en pause.
              </p>
              <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                Sept objets partiront ensemble : le budget, la campagne, son pays, sa langue, un
                groupe d’annonces, ses {plan.motsCles.length} mots-clés et l’annonce. Si l’un est
                refusé, aucun n’est créé. Vous pourrez tout supprimer depuis le journal.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void creer(plan.id)}
                  disabled={occupe !== null}
                  className="cursor-pointer rounded-[var(--radius-control)] border-0 px-4 py-2 text-sm font-medium text-white [background-image:var(--gradient-cta)] disabled:opacity-50"
                >
                  {occupe === plan.id ? 'Création…' : 'Confirmer et créer'}
                </button>
                <button
                  type="button"
                  onClick={() => setAConfirmer(null)}
                  disabled={occupe !== null}
                  className="cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {deposable ? (
                <button
                  type="button"
                  onClick={() => setAConfirmer(plan.id)}
                  disabled={occupe !== null}
                  className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1 text-xs text-[var(--color-brand-strong)] disabled:opacity-50"
                >
                  Créer la campagne…
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void abandonner(plan.id)}
                disabled={occupe !== null}
                className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1 text-xs text-[var(--color-ink-soft)] disabled:opacity-50"
              >
                Abandonner ce plan
              </button>
            </div>
          )}
        </article>
      ))}

      {message === null ? null : (
        <p className="mt-3 mb-0 text-sm text-[var(--color-ink-soft)]">{message}</p>
      )}
      {erreur === null ? null : (
        <p role="alert" className="mt-3 mb-0 text-sm text-[var(--color-critical)]">
          {erreur}
        </p>
      )}
    </section>
  )
}
