'use client'

import { useState } from 'react'

/**
 * Le plan d'action.
 *
 * C'est ce qui sépare un rapport d'un outil. Un audit qui rend trente constats et repart de
 * zéro le mois suivant se referme ; une liste où l'on coche ce qu'on a fait, et qui s'en
 * souvient, se rouvre. Trois partis pris.
 *
 * **Quatre états, pas une case à cocher.** « En cours » existe parce que corriger deux cents
 * descriptions prend plusieurs séances, et qu'une liste qui ne sait dire que fait ou pas
 * fait oblige à tout garder en tête. « Ignorée » existe parce qu'un constat qu'on a décidé
 * de ne pas traiter doit cesser de remonter, sans disparaître pour autant.
 *
 * **L'état part au serveur tout de suite, et l'écran ne ment pas en attendant.** Le bouton
 * s'affiche coché dès le clic — sinon on doute d'avoir cliqué — mais un refus le rend à son
 * état d'avant et le dit. Un plan qui affiche « corrigée » sur quelque chose qui n'a pas été
 * enregistré est pire que pas de plan du tout.
 *
 * **Ce qui est réglé ou ignoré descend, il ne disparaît pas.** Voir ce qu'on a traité est ce
 * qui donne envie de continuer.
 */

export type EtatAction = 'todo' | 'doing' | 'done' | 'ignored'

export type Correction = { path: string; url: string; field: string; before: string; after: string }

export type LigneVue = {
  checkId: string
  engine: string
  label: string
  why: string
  scope: string
  severity: string
  affected: number
  examined: number
  sample: { path: string; url: string; title: string }[]
  state: EtatAction
  /** L'équipe sait rédiger la correction de ce constat. */
  corrigeable: boolean
  /** Ce qui a déjà été rédigé, et déjà payé. Relire ne coûte rien. */
  corrections: Correction[]
}

const ETATS: { id: EtatAction; label: string }[] = [
  { id: 'todo', label: 'À faire' },
  { id: 'doing', label: 'En cours' },
  { id: 'done', label: 'Corrigée' },
  { id: 'ignored', label: 'Ignorée' },
]

const GRAVITES: Record<string, { label: string; fond: string; texte: string }> = {
  critical: { label: 'Critique', fond: 'var(--color-critical-soft)', texte: 'var(--color-critical)' },
  important: { label: 'Important', fond: 'var(--color-accent-soft)', texte: 'var(--color-accent)' },
  improvement: {
    label: 'Amélioration',
    fond: 'var(--color-brand-soft)',
    texte: 'var(--color-brand-strong)',
  },
}

const MOTEURS: Record<string, string> = {
  seo: 'Référencement',
  geo: 'Moteurs IA',
  cro: 'Conversion',
}

const CHAMPS: Record<string, string> = {
  title: 'Titre de la page (balise title)',
  description: 'Meta description',
  h1: 'Titre visible (H1)',
  intro: 'Premier paragraphe',
}

/**
 * Les corrections rédigées, l'ancienne en face de la nouvelle.
 *
 * Une correction se relit par comparaison : voir « Accueil » en face de la phrase proposée
 * est ce qui permet de juger en une seconde. Rien ne s'applique tout seul — Evoliia ne
 * touche pas au site de la personne, et le bouton qui le ferait n'existe pas.
 */
function Corrections({ items }: { items: readonly Correction[] }) {
  if (items.length === 0) return null
  return (
    <div className="mt-4 grid gap-3 rounded-[var(--radius-card)] bg-[var(--color-canvas)] p-4">
      {items.map((item) => (
        <div key={`${item.path}-${item.field}`}>
          <p className="m-0 text-xs font-semibold text-[var(--color-ink-faint)]">
            {item.path} — {CHAMPS[item.field] ?? item.field}
          </p>
          {item.before.trim() === '' ? null : (
            <p className="m-0 mt-1 text-sm text-[var(--color-ink-faint)] line-through">
              {item.before}
            </p>
          )}
          <p className="m-0 mt-1 text-sm text-[var(--color-ink)]">{item.after}</p>
        </div>
      ))}
      <p className="m-0 text-xs text-[var(--color-ink-faint)]">
        À copier dans votre site. Evoliia n’y touche pas.
      </p>
    </div>
  )
}

/** Une ligne traitée s'efface visuellement sans quitter la liste. */
const RETIREE: Record<EtatAction, boolean> = {
  todo: false,
  doing: false,
  done: true,
  ignored: true,
}

export function PlanAction({
  siteId,
  lignes,
  locale,
  cout,
}: {
  siteId: string
  lignes: readonly LigneVue[]
  locale: string
  /** Fourchette annoncée, lue dans le catalogue administrable. Jamais ce qui sera débité. */
  cout: { min: number; max: number } | null
}) {
  const [etats, setEtats] = useState<Record<string, EtatAction>>(
    Object.fromEntries(lignes.map((ligne) => [ligne.checkId, ligne.state])),
  )
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [corrections, setCorrections] = useState<Record<string, Correction[]>>(
    Object.fromEntries(lignes.map((ligne) => [ligne.checkId, ligne.corrections])),
  )
  const [redaction, setRedaction] = useState<string | null>(null)

  /**
   * Fait rédiger les corrections d'un constat.
   *
   * C'est la seule action payante de l'écran, et elle le dit avant d'être lancée. On ne
   * suppose rien du résultat : contrairement à un changement d'état, rien ne s'affiche tant
   * que le serveur n'a pas rendu le texte — afficher une correction qui n'existe pas encore
   * serait montrer quelque chose qu'on a peut-être facturé pour rien.
   */
  async function rediger(checkId: string) {
    setRedaction(checkId)
    setErreur(null)
    const response = await fetch(`/api/sites/${siteId}/corrections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkId, locale }),
    }).catch(() => null)
    const body = (await response?.json().catch(() => null)) as
      | { corrections?: Correction[]; message?: string }
      | null
    setRedaction(null)

    if (response === null || !response.ok || body?.corrections === undefined) {
      setErreur(body?.message ?? 'La rédaction n’a pas abouti. Rien ne vous a été débité.')
      return
    }
    setCorrections((actuelles) => ({ ...actuelles, [checkId]: body.corrections ?? [] }))
  }

  async function changer(checkId: string, state: EtatAction) {
    const avant = etats[checkId] ?? 'todo'
    if (state === avant) return
    // On montre le résultat tout de suite : sans cela, on doute d'avoir cliqué.
    setEtats((actuels) => ({ ...actuels, [checkId]: state }))
    setErreur(null)
    setEnCours(checkId)

    const response = await fetch(`/api/sites/${siteId}/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkId, state }),
    }).catch(() => null)
    setEnCours(null)

    if (response === null || !response.ok) {
      // Rendre la ligne à son état d'avant : un plan qui affiche « corrigée » sur quelque
      // chose qui n'a pas été enregistré est pire que pas de plan du tout.
      setEtats((actuels) => ({ ...actuels, [checkId]: avant }))
      setErreur('Ce changement n’a pas été enregistré. Réessayez dans un instant.')
    }
  }

  const restantes = lignes.filter((ligne) => !RETIREE[etats[ligne.checkId] ?? 'todo']).length

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <p className="m-0 text-sm text-[var(--color-ink-soft)]">
          {restantes === 0
            ? 'Tout est traité. Relancez une analyse pour vérifier.'
            : `${restantes} point${restantes > 1 ? 's' : ''} encore ouvert${restantes > 1 ? 's' : ''} sur ${lignes.length}.`}
        </p>
        {erreur === null ? null : (
          <p className="m-0 text-sm text-[var(--color-critical)]">{erreur}</p>
        )}
      </div>

      <ol className="m-0 grid list-none gap-3 p-0">
        {lignes.map((ligne, rang) => {
          const etat = etats[ligne.checkId] ?? 'todo'
          const traitee = RETIREE[etat]
          const gravite = GRAVITES[ligne.severity] ?? GRAVITES['improvement']
          return (
            <li
              key={ligne.checkId}
              /*
                Un liséré de la couleur du verdict, à gauche.
                
                C'est ce qui permet de trier une liste de dix constats sans en lire un seul :
                l'œil suit une colonne de couleurs avant de lire des mots. La pastille dit
                déjà la gravité, mais elle est au milieu d'autres pastilles — celle du
                moteur, celle du nombre de pages — et se noie dans la ligne.
              */
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 transition-opacity"
              style={{
                opacity: traitee ? 0.55 : 1,
                borderLeftWidth: '4px',
                borderLeftColor: gravite?.texte ?? 'var(--color-line)',
              }}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-sm font-semibold text-[var(--color-ink-faint)]">
                  {rang + 1}.
                </span>
                <h3
                  className="m-0 text-base font-semibold"
                  style={{ textDecoration: etat === 'ignored' ? 'line-through' : 'none' }}
                >
                  {ligne.label}
                </h3>
                <span
                  className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold"
                  style={{ background: gravite?.fond, color: gravite?.texte }}
                >
                  {gravite?.label}
                </span>
                <span className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-2.5 py-0.5 text-xs text-[var(--color-ink-soft)]">
                  {MOTEURS[ligne.engine] ?? ligne.engine}
                </span>
              </div>

              {/*
                L'ampleur, en chiffres plutôt qu'en incise.
                
                « 47 pages sur 176 » perdue au bout d'une rangée de pastilles ne se lit pas ;
                c'est pourtant ce qui décide de l'ordre dans lequel on traite la liste. Un
                constat qui touche trois pages et un qui en touche la moitié ne demandent
                pas le même matin.
              */}
              {ligne.scope === 'site' || ligne.examined === 0 ? null : (
                <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-2xl leading-none font-semibold">{ligne.affected}</span>
                  <span className="text-sm text-[var(--color-ink-soft)]">
                    page{ligne.affected > 1 ? 's' : ''} concernée{ligne.affected > 1 ? 's' : ''}{' '}
                    sur {ligne.examined} analysées
                  </span>
                  <span
                    aria-hidden="true"
                    className="ml-1 h-1.5 w-24 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-canvas)]"
                  >
                    <span
                      className="block h-1.5 rounded-[var(--radius-pill)]"
                      style={{
                        width: `${Math.min(100, Math.round((ligne.affected / ligne.examined) * 100))}%`,
                        background: gravite?.texte ?? 'var(--color-ink-soft)',
                      }}
                    />
                  </span>
                </div>
              )}

              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {ligne.why}
              </p>

              {ligne.sample.length === 0 ? null : (
                <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
                  {ligne.sample.map((exemple) => (
                    <li
                      key={exemple.url}
                      className="rounded-[var(--radius-pill)] bg-[var(--color-canvas)] px-3 py-1 text-xs text-[var(--color-ink-soft)]"
                    >
                      {exemple.path}
                    </li>
                  ))}
                </ul>
              )}

              <Corrections items={corrections[ligne.checkId] ?? []} />

              <div
                className="mt-4 inline-flex flex-wrap gap-1 rounded-[var(--radius-pill)] bg-[var(--color-canvas)] p-1"
                role="group"
                aria-label={`État de « ${ligne.label} »`}
              >
                {ETATS.map((choix) => {
                  const actif = etat === choix.id
                  return (
                    <button
                      key={choix.id}
                      type="button"
                      onClick={() => void changer(ligne.checkId, choix.id)}
                      disabled={enCours === ligne.checkId}
                      aria-pressed={actif}
                      className="rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition disabled:opacity-50"
                      style={{
                        background: actif ? 'var(--color-surface)' : 'transparent',
                        color: actif ? 'var(--color-ink)' : 'var(--color-ink-soft)',
                        boxShadow: actif ? '0 1px 3px rgba(23, 6, 47, 0.12)' : 'none',
                      }}
                    >
                      {choix.label}
                    </button>
                  )
                })}
              </div>

              {/*
                Le prix est annoncé avant, mesuré après : la fourchette vient du catalogue
                administrable, le débit suivra les jetons réellement consommés. Personne ne
                découvre le prix après coup, et personne n'est facturé sur une estimation.
              */}
              {!ligne.corrigeable ? null : (
                <button
                  type="button"
                  onClick={() => void rediger(ligne.checkId)}
                  disabled={redaction !== null}
                  className="mt-4 ml-3 inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:border-[var(--color-brand)] hover:text-[var(--color-brand-strong)] disabled:opacity-50"
                >
                  {redaction === ligne.checkId
                    ? 'L’équipe rédige…'
                    : (corrections[ligne.checkId] ?? []).length > 0
                      ? 'Rédiger à nouveau'
                      : 'Faire rédiger la correction'}
                  {cout === null ? null : (
                    <span className="text-xs text-[var(--color-ink-faint)]">
                      {cout.min === cout.max
                        ? `${cout.min} crédit${cout.min > 1 ? 's' : ''}`
                        : `${cout.min} à ${cout.max} crédits`}
                    </span>
                  )}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
