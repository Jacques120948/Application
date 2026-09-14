'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Field, Select } from '@/components/ui'

/**
 * Changer de projet sans quitter l'écran.
 *
 * L'équipe marketing, comme les autres écrans d'un projet, vit à une adresse qui nomme le
 * projet. Plutôt que de renvoyer à la liste des projets pour en choisir un autre, la
 * liste déroulante mène directement au même écran pour le projet choisi : l'adresse reste
 * la vérité, et un lien copié ouvre toujours le bon projet.
 */
export type SwitchableProject = { id: string; name: string; status: string }

export function ProjectSwitcher({
  projects,
  currentId,
  hrefTemplate,
  label,
  hint,
}: {
  projects: readonly SwitchableProject[]
  currentId: string
  /**
   * L'adresse de ce même écran pour un autre projet, avec `{id}` à la place de
   * l'identifiant. Un gabarit plutôt qu'une fonction : la page est rendue côté serveur et
   * ne peut transmettre qu'une valeur sérialisable.
   */
  hrefTemplate: string
  label: string
  hint?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  return (
    <Field label={label} hint={hint}>
      <Select
        value={currentId}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value
          if (next === currentId) return
          setPending(true)
          router.push(hrefTemplate.replace('{id}', next))
        }}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.status === 'PUBLISHED' ? `${project.name} · en ligne` : project.name}
          </option>
        ))}
      </Select>
    </Field>
  )
}
