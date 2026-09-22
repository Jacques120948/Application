'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'

/**
 * Le recomptage à la demande.
 *
 * La nuit le fait toute seule ; ce bouton sert au premier jour, et aux fois où l'on veut
 * vérifier tout de suite qu'une reconnexion a bien pris. Il traverse la base utilisateur par
 * utilisateur, ce qui interdit de le faire à l'ouverture de la page.
 */
export function RecompterConnecteurs() {
  const router = useRouter()
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function recompter() {
    setOccupe(true)
    setErreur(null)
    const reponse = await fetch('/api/admin/connecteurs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => null)
    setOccupe(false)

    if (reponse === null || !reponse.ok) {
      setErreur(`Le recomptage n’a pas abouti (code ${reponse?.status ?? 0}).`)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={recompter} disabled={occupe} variant="secondary">
        {occupe ? 'Recomptage…' : 'Recompter maintenant'}
      </Button>
      {erreur === null ? null : (
        <span className="text-sm break-words text-[var(--color-critical)]">{erreur}</span>
      )}
    </div>
  )
}
