'use client'

import { useState } from 'react'

/**
 * Ce que Naya propose d'acheter, et ce que ça coûterait.
 *
 * L'écran qui manquait pour que la publicité Recherche soit décidable. Jusqu'ici Evoliia
 * savait dire ce que les gens tapent pour trouver le site ; elle ne savait pas dire ce
 * qu'il en coûterait d'acheter ces recherches-là, ni lesquelles sont déjà gagnées sans
 * payer.
 *
 * Trois partis pris d'affichage.
 *
 * **Le prix est traduit en effort.** « 2,10 CHF le clic » ne dit rien à personne. « Il
 * faudrait convertir 8,4 % des visiteurs pour tenir 25 CHF par vente » se compare à ce que
 * la personne constate déjà sur sa boutique, et se conteste.
 *
 * **Les requêtes déjà gagnées sont comptées, pas cachées.** Si dix recherches ont été
 * écartées parce que le site sort déjà en tête dessus, l'écran le dit : c'est une bonne
 * nouvelle, et ça explique pourquoi une requête bien visible dans les chiffres n'est pas
 * dans la liste.
 *
 * **Un mot-clé ouvre une dépense.** C'est le seul dépôt d'Evoliia dont ce soit vrai, et la
 * confirmation le dit en toutes lettres.
 */

export type MotCleVue = {
  id: string
  texte: string
  correspondance: string
  langue: string
  intention: string
  position: number
  impressions: number
  volume: number
  coutBasMicros: number
  coutHautMicros: number
  concurrence: string
  motif: string
}

const MICROS = 1_000_000

const CONCURRENCES: Record<string, string> = {
  LOW: 'peu disputé',
  MEDIUM: 'disputé',
  HIGH: 'très disputé',
}

const LANGUES: Record<string, string> = {
  fr: 'FR',
  de: 'DE',
  it: 'IT',
  en: 'EN',
  es: 'ES',
}

function prix(micros: number, devise: string): string {
  return `${(micros / MICROS).toFixed(2)} ${devise}`
}

export function MotsClesAds({
  groupeId,
  initiales,
  devise,
  deposable,
  achetable,
}: {
  groupeId: string
  initiales: readonly MotCleVue[]
  devise: string
  /** Vrai quand le dépôt est possible : mode assisté activé. */
  deposable: boolean
  /** Faux pour une Performance Max : elle n'achète pas de mots-clés. */
  achetable: boolean
}) {
  const [liste, setListe] = useState<MotCleVue[]>([...initiales])
  const [occupe, setOccupe] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [aConfirmer, setAConfirmer] = useState<string | null>(null)

  if (!achetable) return null

  async function chercher() {
    setOccupe('chercher')
    setErreur(null)
    setMessage(null)
    const reponse = await fetch('/api/ads/mots-cles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'chercher', groupeId }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as {
      ok?: boolean
      message?: string
      bilan?: {
        proposes: number
        dejaGagnees: number
        marche: string
        langue: string
        sansPrix?: string
      }
    } | null
    setOccupe(null)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `La recherche n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    const bilan = corps?.bilan
    setMessage(
      bilan === undefined
        ? 'Recherche terminée. Rechargez la page.'
        : `${bilan.proposes} mot${bilan.proposes > 1 ? 's' : ''}-clé${
            bilan.proposes > 1 ? 's' : ''
          } proposé${bilan.proposes > 1 ? 's' : ''} pour ${bilan.marche} en ${bilan.langue}. Rechargez la page.`,
    )
    /*
     * Une liste sans volume ni prix n'est pas une liste ratée : c'est une liste amputée. Le
     * dire, et dire de quoi, vaut mieux que laisser croire que Google ne facture rien pour
     * ces recherches.
     */
    if (bilan?.sansPrix !== undefined && bilan.sansPrix !== '') {
      setErreur(`Les volumes et les prix manquent. ${bilan.sansPrix}`)
      return
    }
    window.location.reload()
  }

  async function deposer(id: string) {
    setOccupe(id)
    setErreur(null)
    setMessage(null)
    const reponse = await fetch('/api/ads/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'mot-cle', motCleId: id }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as
      | { ok?: boolean; raison?: string; message?: string }
      | null
    setOccupe(null)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `L’envoi n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    if (corps?.ok !== true) {
      setErreur(corps?.raison ?? 'Google n’a pas accepté ce mot-clé.')
      setAConfirmer(null)
      return
    }
    window.location.reload()
  }

  async function ecarter(id: string) {
    setOccupe(id)
    setErreur(null)
    const reponse = await fetch('/api/ads/mots-cles', {
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

  return (
    <div className="mt-4 border-t border-[var(--color-line)] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-xs font-semibold tracking-wide text-[var(--color-ink-faint)] uppercase">
          Mots-clés à acheter{liste.length === 0 ? '' : ` — ${liste.length}`}
        </p>
        <button
          type="button"
          onClick={() => void chercher()}
          disabled={occupe !== null}
          className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-brand-strong)] disabled:cursor-not-allowed disabled:border-[var(--color-line)] disabled:text-[var(--color-ink-faint)]"
        >
          {occupe === 'chercher'
            ? 'Naya cherche…'
            : liste.length === 0
              ? 'Chercher des mots-clés'
              : 'En chercher d’autres'}
        </button>
      </div>

      {liste.length === 0 ? (
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Naya croise ce que les gens tapent déjà pour trouver votre site avec ce que Google
          facture pour ces recherches. Elle écarte celles où vous sortez déjà en tête sans
          payer : les acheter reviendrait à payer un clic que vous obtenez gratuitement.
        </p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {liste.map((un) => (
            <li
              key={un.id}
              className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-3 py-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{un.texte}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-faint)]">
                  {LANGUES[un.langue] === undefined ? '' : `${LANGUES[un.langue]} · `}
                  {un.correspondance === 'exact' ? 'Exact' : 'Expression'}
                  {un.coutHautMicros === 0
                    ? ''
                    : ` · ${prix(un.coutBasMicros, devise)} – ${prix(un.coutHautMicros, devise)}`}
                  {un.concurrence === '' ? '' : ` · ${CONCURRENCES[un.concurrence] ?? un.concurrence}`}
                </span>
              </div>
              {un.motif === '' ? null : (
                <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                  {un.motif}
                </p>
              )}
              {un.intention === 'information' ? (
                /*
                  Un avertissement, pas un filtre : la personne connaît son marché. Mais les
                  chiffres d'une recherche d'information sont souvent les plus flatteurs de
                  la liste — gros volume, clic bon marché — et c'est précisément ce qui la
                  rend coûteuse. Le dire à côté des chiffres, et non à leur place.
                */
                <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-warning-strong,var(--color-ink-soft))]">
                  ⚠ Ces gens cherchent à comprendre, pas à acheter. Le volume est peut-être
                  élevé et le clic bon marché : c’est ce qui rend ce mot-clé cher en pure
                  perte.
                </p>
              ) : null}
              {aConfirmer === un.id ? (
                <div className="mt-2 rounded-[var(--radius-control)] bg-[var(--color-surface)] p-3">
                  <p className="m-0 text-sm font-medium">
                    Acheter « {un.texte} » en{' '}
                    {un.correspondance === 'exact' ? 'correspondance exacte' : 'expression exacte'}.
                  </p>
                  {LANGUES[un.langue] === undefined ? null : (
                    <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                      Cette recherche est {un.langue === 'de' ? 'en allemand' : un.langue === 'it' ? 'en italien' : un.langue === 'en' ? 'en anglais' : 'en français'}.
                      Les annonces de ce groupe doivent l’être aussi : sinon les gens verront
                      un texte dans une langue qu’ils n’ont pas cherchée, et ne cliqueront pas.
                    </p>
                  )}
                  <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                    C’est le seul geste d’Evoliia qui ouvre une dépense au lieu d’en ajuster
                    une : dès que ce mot-clé est en place, Google pourra acheter des clics
                    dessus, dans la limite du budget de la campagne — qui ne change pas.
                    {un.coutHautMicros === 0
                      ? ' Google ne donne pas de prix indicatif pour cette recherche.'
                      : ` Comptez ${prix(un.coutBasMicros, devise)} à ${prix(un.coutHautMicros, devise)} par clic.`}{' '}
                    Vous pourrez le retirer depuis le journal, sur la page Publicité.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void deposer(un.id)}
                      disabled={occupe !== null}
                      className="cursor-pointer rounded-[var(--radius-control)] border-0 px-4 py-2 text-sm font-medium text-white [background-image:var(--gradient-cta)] disabled:opacity-50"
                    >
                      {occupe === un.id ? 'Envoi…' : 'Confirmer et envoyer'}
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
                <div className="mt-2 flex flex-wrap gap-2">
                  {deposable ? (
                    <button
                      type="button"
                      onClick={() => setAConfirmer(un.id)}
                      disabled={occupe !== null}
                      className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1 text-xs text-[var(--color-brand-strong)] disabled:opacity-50"
                    >
                      Déposer…
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void ecarter(un.id)}
                    disabled={occupe !== null}
                    className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1 text-xs text-[var(--color-ink-soft)] disabled:opacity-50"
                  >
                    {occupe === un.id ? 'Un instant…' : 'Écarter'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {message === null ? null : (
        <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">{message}</p>
      )}
      {erreur === null ? null : (
        <p role="alert" className="mt-2 mb-0 text-sm break-words text-[var(--color-critical)]">
          {erreur}
        </p>
      )}

      <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        {deposable
          ? 'Evoliia ne dépose qu’en expression exacte ou en correspondance exacte. La correspondance large laisse Google acheter les recherches voisines : sur un petit budget, elle le dépense en un matin sur des requêtes que personne n’a validées. Les volumes et les prix viennent du planificateur de Google et sont indicatifs : ce sont des moyennes de marché, pas une promesse.'
          : 'Ces mots-clés ne sont pas chez Google : ils vivent chez Evoliia. Pour pouvoir les déposer, passez votre compte en mode assisté depuis la page Publicité. Les volumes et les prix viennent du planificateur de Google et sont indicatifs : ce sont des moyennes de marché, pas une promesse.'}
      </p>
    </div>
  )
}
