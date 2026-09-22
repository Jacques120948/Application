'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'

/**
 * Le geste qui va chercher les volumes de recherche.
 *
 * Un bouton, et non un chargement automatique à l'ouverture de l'écran. La raison n'est pas
 * l'élégance : le planificateur de mots-clés compte dans le quota d'appels quotidien
 * d'Evoliia, et ce quota est partagé par tous ses utilisateurs. Un écran qui interrogerait
 * Google à chaque affichage ferait dépendre ce quota du nombre d'onglets ouverts, et son
 * épuisement casserait la création de campagnes de tout le monde — sans que personne ne
 * puisse relier la panne au geste qui l'a causée.
 *
 * Une fois relevés, les volumes sont gardés un mois. C'est une moyenne mensuelle : la
 * redemander chaque semaine réécrirait le même nombre.
 */
export function VolumesRecherche({
  siteId,
  releveLe,
  locale,
}: {
  siteId: string
  /** La date du relevé le plus récent, ou `null` quand rien n'a jamais été demandé. */
  releveLe: string | null
  locale: string
}) {
  const router = useRouter()
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function relever() {
    setOccupe(true)
    setErreur(null)
    const reponse = await fetch(`/api/sites/${siteId}/volumes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => null)
    const corps = (await reponse?.json().catch(() => ({}))) as {
      ok?: boolean
      chiffres?: number
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
          `Google n’a pas répondu (code ${reponse.status}). Réessayez dans un moment.`,
      )
      return
    }
    /*
     * La page est redemandée au serveur plutôt que rangée dans un état local : les volumes
     * traversent le classement entier, et recomposer ce tableau ici en ferait une seconde
     * version de la vérité, qui divergerait au premier changement de tri.
     */
    router.refresh()
  }

  const date =
    releveLe === null
      ? null
      : new Date(releveLe).toLocaleDateString(locale, { day: 'numeric', month: 'long' })

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={relever} disabled={occupe} variant="secondary">
        {occupe
          ? 'Google réfléchit…'
          : releveLe === null
            ? 'Obtenir les volumes de recherche'
            : 'Mettre à jour les volumes'}
      </Button>
      {date === null ? null : (
        <span className="text-xs text-[var(--color-ink-faint)]">Relevé le {date}</span>
      )}
      {erreur === null ? null : (
        <p className="m-0 w-full text-xs break-words text-[var(--color-critical)]">{erreur}</p>
      )}
    </div>
  )
}
