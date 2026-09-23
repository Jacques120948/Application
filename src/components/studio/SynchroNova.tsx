'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui'

/**
 * La dernière synchronisation des ventes, et le bouton pour la refaire.
 *
 * À l'ouverture, l'écran demande une relecture « automatique » : le serveur ne rappelle
 * Shopify que si les données ont plus de douze heures, et répond tout de suite sinon. La
 * page s'affiche donc d'abord avec ce qui est en base — jamais un écran blanc en attendant
 * une boutique — puis se rafraîchit si quelque chose de neuf est arrivé.
 */
export function SynchroNova({
  derniere,
  aRelire,
  probleme,
}: {
  /** Déjà formatée par le serveur : « 23 septembre à 07:32 », ou `null` si jamais lue. */
  derniere: string | null
  aRelire: boolean
  /** Le dernier refus connu, tel que la collecte l'a noté : autorisation manquante, panne. */
  probleme: string | null
}) {
  const router = useRouter()
  const [etat, setEtat] = useState<'repos' | 'lecture' | 'erreur'>(
    aRelire ? 'lecture' : probleme !== null && probleme !== '' ? 'erreur' : 'repos',
  )
  const [message, setMessage] = useState(probleme ?? '')
  const lance = useRef(false)

  async function relire(mode: 'auto' | 'manuel'): Promise<void> {
    setEtat('lecture')
    setMessage('')
    try {
      const reponse = await fetch('/api/nova/synchro', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const corps = (await reponse.json().catch(() => ({}))) as { etat?: string; message?: string }
      if (!reponse.ok || (corps.etat !== 'ok' && corps.message)) {
        setEtat('erreur')
        setMessage(corps.message ?? 'La lecture n’a pas abouti.')
      } else {
        setEtat('repos')
      }
      router.refresh()
    } catch {
      setEtat('erreur')
      setMessage('La lecture n’a pas abouti. Les dernières données restent affichées.')
    }
  }

  useEffect(() => {
    if (!aRelire || lance.current) return
    lance.current = true
    void relire('auto')
    // Une seule fois par ouverture : le serveur décide lui-même s'il faut relire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aRelire])

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-soft)]">
      <span>
        {etat === 'lecture'
          ? 'Lecture des ventes Shopify…'
          : derniere === null
            ? 'Ventes Shopify pas encore lues.'
            : `Dernière synchronisation : ${derniere}`}
      </span>
      <Button variant="ghost" disabled={etat === 'lecture'} onClick={() => void relire('manuel')} className="px-2 py-1 text-xs">
        Actualiser
      </Button>
      {etat === 'erreur' && message !== '' ? <span className="basis-full text-[var(--color-critical)]">{message}</span> : null}
    </div>
  )
}
