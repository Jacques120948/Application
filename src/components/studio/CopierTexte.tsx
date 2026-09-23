'use client'

import { useState } from 'react'

/** Un bouton qui copie un texte court — une requête de segment à coller dans Shopify. */
export function CopierTexte({ texte, libelle = 'Copier' }: { texte: string; libelle?: string }) {
  const [copie, setCopie] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(texte)
          .then(() => {
            setCopie(true)
            setTimeout(() => setCopie(false), 2_000)
          })
          .catch(() => undefined)
      }}
      className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-ink-soft)] hover:border-[var(--color-ink-soft)]"
    >
      {copie ? 'Copié' : libelle}
    </button>
  )
}
