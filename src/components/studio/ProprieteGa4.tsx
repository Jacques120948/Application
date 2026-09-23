'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'

/**
 * Changer la propriété Google Analytics suivie.
 *
 * La liste n'est demandée à Google qu'au clic : l'afficher à chaque ouverture de Nova
 * coûterait un appel pour une question qu'on ne se pose qu'une fois.
 */
export function ProprieteGa4({ actuelle }: { actuelle: string }) {
  const router = useRouter()
  const [proprietes, setProprietes] = useState<{ id: string; nom: string; compte: string }[] | null>(null)
  const [choix, setChoix] = useState(actuelle)
  const [etat, setEtat] = useState<'repos' | 'chargement' | 'envoi' | 'erreur'>('repos')
  const [message, setMessage] = useState('')

  async function charger(): Promise<void> {
    setEtat('chargement')
    const reponse = await fetch('/api/nova/ga4').catch(() => null)
    const corps = (await reponse?.json().catch(() => ({}))) as { proprietes?: { id: string; nom: string; compte: string }[]; message?: string }
    if (reponse === null || reponse === undefined || !reponse.ok || corps.proprietes === undefined) {
      setEtat('erreur')
      setMessage(corps?.message ?? 'La liste des propriétés n’a pas pu être lue.')
      return
    }
    setProprietes(corps.proprietes)
    setEtat('repos')
  }

  async function enregistrer(): Promise<void> {
    setEtat('envoi')
    const reponse = await fetch('/api/nova/ga4', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propriete: choix }),
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => ({}))) as { message?: string }
    if (reponse === null || reponse === undefined || !reponse.ok) {
      setEtat('erreur')
      setMessage(corps?.message ?? 'Le changement n’a pas pu être enregistré.')
      return
    }
    setEtat('repos')
    setProprietes(null)
    router.refresh()
  }

  if (proprietes === null) {
    return (
      <div className="grid gap-1">
        <Button variant="ghost" className="justify-self-start px-0 text-xs" disabled={etat === 'chargement'} onClick={() => void charger()}>
          {etat === 'chargement' ? 'Lecture des propriétés…' : 'Changer de propriété Google Analytics'}
        </Button>
        {etat === 'erreur' ? <span className="text-xs text-[var(--color-critical)]">{message}</span> : null}
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={choix}
        onChange={(evenement) => setChoix(evenement.target.value)}
        className="min-w-0 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-sm"
      >
        {proprietes.map((propriete) => (
          <option key={propriete.id} value={propriete.id}>
            {propriete.nom}
            {propriete.compte === '' ? '' : ` — ${propriete.compte}`}
            {` · n° ${propriete.id.replace(/^properties\//u, '')}`}
          </option>
        ))}
      </select>
      <Button variant="secondary" className="px-3 py-1 text-xs" disabled={etat === 'envoi' || choix === actuelle} onClick={() => void enregistrer()}>
        {etat === 'envoi' ? 'Lecture…' : 'Suivre cette propriété'}
      </Button>
      {etat === 'erreur' ? <span className="basis-full text-xs text-[var(--color-critical)]">{message}</span> : null}
    </div>
  )
}
