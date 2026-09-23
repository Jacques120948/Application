'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Les seuils des segments. Changer un seuil ne relit pas la boutique : les segments se
 * recalculent sur l'index déjà lu, à l'affichage suivant.
 */

type Criteres = { actifJours: number; dormantJours: number; nouveauJours: number; fideleCommandes: number; vipPart: number }

const CHAMPS: { cle: keyof Criteres; label: string; aide: string; min: number; max: number; pourcent?: boolean }[] = [
  { cle: 'actifJours', label: 'Client actif : dernière commande depuis au plus (jours)', aide: 'Adaptez à votre cycle d’achat.', min: 14, max: 730 },
  { cle: 'dormantJours', label: 'Client dormant : aucune commande depuis plus de (jours)', aide: 'Plus long que le seuil actif.', min: 30, max: 1095 },
  { cle: 'nouveauJours', label: 'Nouveau client : premier achat depuis au plus (jours)', aide: '', min: 7, max: 180 },
  { cle: 'fideleCommandes', label: 'Client fidèle : à partir de (commandes)', aide: '', min: 2, max: 50 },
  { cle: 'vipPart', label: 'VIP : la part qui dépense le plus (%)', aide: 'Par exemple 5 %.', min: 1, max: 30, pourcent: true },
]

export function CriteresLina({ initiaux }: { initiaux: Criteres }) {
  const router = useRouter()
  const [valeurs, setValeurs] = useState<Record<keyof Criteres, string>>({
    actifJours: String(initiaux.actifJours),
    dormantJours: String(initiaux.dormantJours),
    nouveauJours: String(initiaux.nouveauJours),
    fideleCommandes: String(initiaux.fideleCommandes),
    vipPart: String(Math.round(initiaux.vipPart * 100)),
  })
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'ok' | 'erreur'>('repos')
  const [message, setMessage] = useState('')

  async function enregistrer(evenement: React.FormEvent) {
    evenement.preventDefault()
    setEtat('envoi')
    const corps: Criteres = {
      actifJours: Number(valeurs.actifJours),
      dormantJours: Number(valeurs.dormantJours),
      nouveauJours: Number(valeurs.nouveauJours),
      fideleCommandes: Number(valeurs.fideleCommandes),
      vipPart: Number(valeurs.vipPart) / 100,
    }
    const reponse = await fetch('/api/lina/reglages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps),
    }).catch(() => null)
    if (reponse === null || !reponse.ok) {
      const detail = (await reponse?.json().catch(() => null)) as { message?: string } | null
      setEtat('erreur')
      setMessage(detail?.message ?? 'Ces réglages n’ont pas pu être enregistrés.')
      return
    }
    setEtat('ok')
    router.refresh()
  }

  return (
    <form onSubmit={(evenement) => void enregistrer(evenement)} className="grid gap-3">
      {CHAMPS.map((champ) => (
        <label key={champ.cle} className="grid gap-1 text-xs">
          <span className="text-[var(--color-ink)]">{champ.label}</span>
          <input
            type="number"
            inputMode="numeric"
            min={champ.min}
            max={champ.max}
            step={1}
            required
            value={valeurs[champ.cle]}
            onChange={(evenement) => setValeurs({ ...valeurs, [champ.cle]: evenement.target.value })}
            className="w-32 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-sm tabular-nums"
          />
          {champ.aide === '' ? null : <span className="text-[var(--color-ink-faint)]">{champ.aide}</span>}
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={etat === 'envoi'}>
          Enregistrer
        </Button>
        {etat === 'ok' ? <span className="text-xs text-[var(--color-positive)]">Enregistré : les segments sont recalculés.</span> : null}
        {etat === 'erreur' ? <span className="text-xs text-[var(--color-critical)]">{message}</span> : null}
      </div>
    </form>
  )
}
