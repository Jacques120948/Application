'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton({ label, locale }: { label: string; locale: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await fetch('/api/auth/logout', { method: 'POST' })
        router.push(`/${locale}`)
        router.refresh()
      }}
      className="text-[var(--color-ink-soft)] underline disabled:opacity-50"
    >
      {label}
    </button>
  )
}
