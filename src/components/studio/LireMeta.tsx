'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'

/**
 * Le geste qui va lire les campagnes Meta.
 *
 * Un bouton, et non une lecture à l'ouverture de l'écran. Six appels chez Meta partent à
 * chaque fois, sur un plafond partagé par tous les comptes reliés à Evoliia : un écran qui
 * lirait à chaque affichage ferait dépendre ce plafond du nombre d'onglets ouverts.
 *
 * La première lecture remonte quatre-vingt-dix jours et peut prendre une minute. C'est dit
 * avant le clic plutôt que découvert pendant l'attente — une attente qu'on n'a pas annoncée
 * ressemble à une panne.
 */
export function LireMeta({ premiere }: { premiere: boolean }) {
  const router = useRouter()
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function lire() {
    setOccupe(true)
    setErreur(null)
    const reponse = await fetch('/api/ads/meta/synchro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => ({}))) as {
      ok?: boolean
      raison?: string
      message?: string
    }
    setOccupe(false)

    if (reponse === null) {
      setErreur('La connexion s’est interrompue. Réessayez.')
      return
    }
    if (!reponse.ok || corps.ok === false) {
      setErreur(
        corps.raison ??
          corps.message ??
          `Meta n’a pas répondu (code ${reponse.status}). Réessayez dans un moment.`,
      )
      return
    }
    router.refresh()
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={lire} disabled={occupe}>
          {occupe
            ? 'Lecture en cours…'
            : premiere
              ? 'Lire mes campagnes Meta'
              : 'Relire mes campagnes'}
        </Button>
        {premiere && !occupe ? (
          <span className="text-xs text-[var(--color-ink-faint)]">
            La première lecture remonte 90 jours et peut prendre une minute.
          </span>
        ) : null}
      </div>
      {erreur === null ? null : (
        <p className="m-0 text-sm break-words text-[var(--color-critical)]">{erreur}</p>
      )}
    </div>
  )
}
