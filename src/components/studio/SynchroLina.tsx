'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'

/**
 * « Analyser mes clients » : lance la lecture de la base, puis la suit jusqu'au bout.
 *
 * Shopify prépare l'export de son côté, en quelques secondes pour une petite boutique, en
 * quelques minutes pour une grande. L'écran demande donc où il en est toutes les quelques
 * secondes — sans rien relancer —, et se rafraîchit quand les clients sont lus. Au-delà de
 * trois minutes, il cesse de demander et le dit : l'export continue chez Shopify, et la
 * prochaine ouverture le relira.
 */

const INTERVALLE_MS = 4_000
const ESSAIS_MAX = 45

type Reponse = { etat?: string; message?: string; clients?: number }

export function SynchroLina({
  derniere,
  enCours,
  aRelire,
  probleme,
  libelle = 'Analyser mes clients',
}: {
  derniere: string | null
  enCours: boolean
  aRelire: boolean
  probleme: string | null
  libelle?: string
}) {
  const router = useRouter()
  const [etat, setEtat] = useState<'repos' | 'lecture' | 'attente' | 'erreur'>(
    enCours ? 'lecture' : probleme !== null && probleme !== '' ? 'erreur' : 'repos',
  )
  const [message, setMessage] = useState(probleme ?? '')
  const lance = useRef(false)

  async function demander(mode: 'auto' | 'manuel' | 'suivre'): Promise<Reponse | null> {
    const reponse = await fetch('/api/lina/synchro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => null)
    if (reponse === null) return null
    const corps = (await reponse.json().catch(() => ({}))) as Reponse
    return reponse.ok ? corps : { etat: 'erreur', message: corps.message ?? 'La lecture n’a pas abouti.' }
  }

  async function suivre(premier: Reponse | null): Promise<void> {
    let courant = premier
    for (let essai = 0; essai < ESSAIS_MAX && courant?.etat === 'en-cours'; essai += 1) {
      await new Promise((resolve) => setTimeout(resolve, INTERVALLE_MS))
      courant = await demander('suivre')
    }
    if (courant === null) {
      setEtat('erreur')
      setMessage('La lecture n’a pas abouti. Les dernières données restent affichées.')
    } else if (courant.etat === 'en-cours') {
      setEtat('attente')
    } else if (courant.etat === 'ok') {
      setEtat('repos')
    } else {
      setEtat('erreur')
      setMessage(courant.message ?? '')
    }
    router.refresh()
  }

  async function lancer(mode: 'auto' | 'manuel'): Promise<void> {
    setEtat('lecture')
    setMessage('')
    await suivre(await demander(mode))
  }

  useEffect(() => {
    if (lance.current) return
    lance.current = true
    if (enCours) void suivre({ etat: 'en-cours' })
    else if (aRelire) void lancer('auto')
    // Une seule fois par ouverture : le serveur décide lui-même s'il faut relire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--color-ink-soft)]">
      <span>
        {etat === 'lecture'
          ? 'Lecture de votre base clients chez Shopify…'
          : etat === 'attente'
            ? 'Shopify prépare encore l’export de vos clients. Revenez dans quelques minutes.'
            : derniere === null
              ? 'Base clients pas encore analysée.'
              : `Dernière analyse : ${derniere}`}
      </span>
      <Button variant={derniere === null ? 'primary' : 'ghost'} disabled={etat === 'lecture'} onClick={() => void lancer('manuel')} className={derniere === null ? '' : 'px-2 py-1 text-xs'}>
        {derniere === null ? libelle : 'Actualiser'}
      </Button>
      {etat === 'erreur' && message !== '' ? <span className="basis-full leading-relaxed text-[var(--color-critical)]">{message}</span> : null}
    </div>
  )
}
