'use client'

import { useState } from 'react'
import { FACTEUR_MAX, FACTEUR_MIN } from '@/lib/bornes-budget'

/**
 * Agir sur une campagne, depuis la campagne elle-même.
 *
 * Les recommandations n'atteignent pas tout. Une baisse de ROAS est une observation, pas une
 * action : elle n'a pas de bouton, et elle ne doit pas en avoir — corriger une dérive d'un
 * clic serait précisément le genre de geste réflexe que ce produit cherche à éviter. Mais
 * quelqu'un qui a activé le mode assisté et n'a aucun constat actionnable se retrouverait
 * avec un réglage qui ne sert à rien. D'où ces deux commandes, au même endroit que les
 * chiffres qui les justifient.
 *
 * Trois partis pris.
 *
 * **Les bornes sont affichées avant la frappe.** Un champ qui accepte ce que le serveur
 * refuse fait perdre le geste et la confiance. Les facteurs viennent du fichier de
 * garde-fous, pas d'une copie : deux vérités finiraient par diverger, et l'écran annoncerait
 * alors une limite que le serveur ne reconnaîtrait pas.
 *
 * **La confirmation porte la phrase exacte.** Le montant de départ, le montant d'arrivée, le
 * nom de la campagne. C'est cela qu'on confirme, pas un bouton.
 *
 * **La valeur d'avant part avec la demande.** Si le budget a bougé entre l'affichage et le
 * clic, le serveur refuse : appliquer un geste calculé sur un chiffre périmé ferait une
 * modification que personne n'a voulue.
 */

const MICROS = 1_000_000

function montant(valeur: number, devise: string): string {
  return `${valeur.toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

/** Un montant tapé à la main. La virgule vaut le point, comme partout en Suisse romande. */
function nombre(saisi: string): number {
  const propre = saisi.replace(',', '.').trim()
  const lu = Number(propre)
  return Number.isFinite(lu) ? lu : 0
}

type Demande =
  | { type: 'statut'; campagneId: string; vers: 'ENABLED' | 'PAUSED'; attendu: string }
  | { type: 'budget'; campagneId: string; versMicros: number; attenduMicros: number }

export function ActionsCampagne({
  campagneId,
  nom,
  statut,
  budget,
  devise,
}: {
  campagneId: string
  nom: string
  statut: string
  /** Budget quotidien en unités de la devise du compte. */
  budget: number
  devise: string
}) {
  const [ouvert, setOuvert] = useState<'budget' | null>(null)
  const [saisie, setSaisie] = useState(budget === 0 ? '' : String(budget))
  const [aConfirmer, setAConfirmer] = useState<{ demande: Demande; phrase: string } | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const diffuse = statut === 'ENABLED'
  const plancher = Math.ceil(budget * FACTEUR_MIN * 100) / 100
  const plafond = Math.floor(budget * FACTEUR_MAX * 100) / 100

  async function envoyer() {
    if (aConfirmer === null) return
    setEnvoi(true)
    setErreur(null)
    const reponse = await fetch('/api/ads/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(aConfirmer.demande),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => null)) as
      | { ok?: boolean; raison?: string; message?: string }
      | null
    setEnvoi(false)

    if (reponse === null || !reponse.ok) {
      setErreur(corps?.message ?? `L’envoi n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    if (corps?.ok !== true) {
      setErreur(corps?.raison ?? 'Google n’a pas accepté la modification.')
      setAConfirmer(null)
      return
    }
    // La page est rendue côté serveur : budget, statut et journal ont tous changé.
    window.location.reload()
  }

  function demanderStatut() {
    const vers = diffuse ? 'PAUSED' : 'ENABLED'
    setAConfirmer({
      demande: { type: 'statut', campagneId, vers, attendu: statut },
      phrase: diffuse
        ? `Mettre « ${nom} » en pause. Elle cessera de diffuser et de dépenser.`
        : `Remettre « ${nom} » en diffusion. Elle recommencera à dépenser dès aujourd’hui.`,
    })
    setOuvert(null)
  }

  function demanderBudget() {
    const vers = nombre(saisie)
    if (vers <= 0) {
      setErreur('Indiquez un montant quotidien.')
      return
    }
    if (vers === budget) {
      setErreur('C’est déjà le budget de cette campagne.')
      return
    }
    if (vers < plancher || vers > plafond) {
      setErreur(
        `Evoliia ne change pas un budget de plus de moitié d’un coup : ici, entre ${montant(plancher, devise)} et ${montant(plafond, devise)}.`,
      )
      return
    }
    setErreur(null)
    setAConfirmer({
      demande: {
        type: 'budget',
        campagneId,
        versMicros: Math.round(vers * MICROS),
        attenduMicros: Math.round(budget * MICROS),
      },
      phrase: `Passer le budget quotidien de « ${nom} » de ${montant(budget, devise)} à ${montant(vers, devise)}.`,
    })
    setOuvert(null)
  }

  if (aConfirmer !== null) {
    return (
      <div className="mt-3 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3">
        <p className="m-0 text-sm font-medium">{aConfirmer.phrase}</p>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          La modification part chez Google immédiatement. Sa valeur d’avant est conservée :
          vous pourrez revenir en arrière depuis le journal, en bas de cette page.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void envoyer()}
            disabled={envoi}
            className="cursor-pointer rounded-[var(--radius-control)] border-0 px-4 py-2 text-sm font-medium text-white [background-image:var(--gradient-cta)] disabled:opacity-50"
          >
            {envoi ? 'Envoi…' : 'Confirmer et envoyer'}
          </button>
          <button
            type="button"
            onClick={() => setAConfirmer(null)}
            disabled={envoi}
            className="cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-line)] bg-transparent px-4 py-2 text-sm disabled:opacity-50"
          >
            Annuler
          </button>
        </div>
        {erreur === null ? null : (
          <p role="alert" className="mt-2 mb-0 text-sm text-[var(--color-critical)]">
            {erreur}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 border-t border-[var(--color-line)] pt-3">
      {ouvert === 'budget' ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--color-ink-soft)]">
              Budget quotidien, entre {montant(plancher, devise)} et {montant(plafond, devise)}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={saisie}
              onChange={(evenement) => setSaisie(evenement.target.value)}
              className="w-32 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={demanderBudget}
            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-brand)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-brand-strong)]"
          >
            Continuer
          </button>
          <button
            type="button"
            onClick={() => {
              setOuvert(null)
              setErreur(null)
              setSaisie(budget === 0 ? '' : String(budget))
            }}
            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs text-[var(--color-ink-soft)]"
          >
            Annuler
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={demanderStatut}
            className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {diffuse ? 'Mettre en pause' : 'Remettre en diffusion'}
          </button>
          {budget > 0 ? (
            <button
              type="button"
              onClick={() => setOuvert('budget')}
              className="cursor-pointer rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-transparent px-3 py-1.5 text-xs"
            >
              Modifier le budget
            </button>
          ) : null}
          <span className="text-xs text-[var(--color-ink-faint)]">
            Chaque modification demande votre confirmation et reste annulable.
          </span>
        </div>
      )}

      {erreur === null ? null : (
        <p role="alert" className="mt-2 mb-0 text-sm text-[var(--color-critical)]">
          {erreur}
        </p>
      )}
    </div>
  )
}
