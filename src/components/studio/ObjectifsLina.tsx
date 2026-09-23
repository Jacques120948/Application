'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Les objectifs CRM, fixés par la personne. Aucun n'est proposé par défaut : une cible
 * choisie par Evoliia serait une promesse. Un champ vide retire l'objectif.
 */

type Cle = 'tauxReachat' | 'caExistants30' | 'reactives30' | 'valeurClient' | 'score'
export type ObjectifsSaisis = Record<Cle, number | null>

const CHAMPS: { cle: Cle; label: string; aide: string; pas: number; max: number }[] = [
  { cle: 'tauxReachat', label: 'Taux de réachat visé (%)', aide: 'Part des acheteurs qui ont commandé au moins deux fois.', pas: 0.1, max: 100 },
  { cle: 'caExistants30', label: 'CA des clients existants sur 30 jours', aide: 'Dans la devise de la boutique.', pas: 1, max: 100_000_000 },
  { cle: 'reactives30', label: 'Clients réactivés sur 30 jours', aide: 'Clients revenus après une longue absence.', pas: 1, max: 1_000_000 },
  { cle: 'valeurClient', label: 'Valeur client visée', aide: 'Dépense moyenne d’un acheteur, dans la devise de la boutique.', pas: 1, max: 10_000_000 },
  { cle: 'score', label: 'Score de fidélité visé (sur 100)', aide: 'Indicateur interne d’Evoliia.', pas: 1, max: 100 },
]

export function ObjectifsFormLina({ objectifs }: { objectifs: ObjectifsSaisis }) {
  const router = useRouter()
  const [valeurs, setValeurs] = useState<Record<Cle, string>>(() => ({
    tauxReachat: objectifs.tauxReachat?.toString() ?? '',
    caExistants30: objectifs.caExistants30?.toString() ?? '',
    reactives30: objectifs.reactives30?.toString() ?? '',
    valeurClient: objectifs.valeurClient?.toString() ?? '',
    score: objectifs.score?.toString() ?? '',
  }))
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok' | 'erreur'>('repos')
  const [message, setMessage] = useState('')

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault()
    setEtat('envoi')
    const lu = (texte: string, entier: boolean) => (texte.trim() === '' ? null : entier ? Math.round(Number(texte)) : Number(texte))
    const reponse = await fetch('/api/lina/objectifs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tauxReachat: lu(valeurs.tauxReachat, false),
        caExistants30: lu(valeurs.caExistants30, false),
        reactives30: lu(valeurs.reactives30, true),
        valeurClient: lu(valeurs.valeurClient, false),
        score: lu(valeurs.score, true),
      }),
    }).catch(() => null)
    if (reponse === null || !reponse.ok) {
      const detail = (await reponse?.json().catch(() => null)) as { message?: string } | null
      setEtat('erreur')
      setMessage(detail?.message ?? 'Ces objectifs n’ont pas pu être enregistrés.')
      return
    }
    setEtat('ok')
    router.refresh()
  }

  const champ = 'w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-sm tabular-nums'
  return (
    <form onSubmit={(evenement) => void enregistrer(evenement)} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {CHAMPS.map((un) => (
          <label key={un.cle} className="grid min-w-0 gap-1 text-xs">
            <span>{un.label}</span>
            <input
              type="number"
              inputMode="decimal"
              min={1}
              max={un.max}
              step={un.pas}
              value={valeurs[un.cle]}
              onChange={(evenement) => setValeurs({ ...valeurs, [un.cle]: evenement.target.value })}
              className={champ}
            />
            <span className="text-[11px] text-[var(--color-ink-faint)]">{un.aide}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={etat === 'envoi'}>
          Enregistrer les objectifs
        </Button>
        {etat === 'ok' ? <span className="text-xs text-[var(--color-positive)]">Enregistrés.</span> : null}
        {etat === 'erreur' ? <span className="text-xs text-[var(--color-critical)]">{message}</span> : null}
      </div>
    </form>
  )
}
