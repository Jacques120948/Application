import { iconPath } from '@/lib/icons'

/**
 * Icône d'une application créée. Le dessin vient d'un jeu fermé écrit dans le code :
 * le nom seul est stocké, et un nom inconnu tombe sur l'étincelle.
 */
export function Icon({ name, size = 22, className }: { name?: string; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      // Contenu statique issu de src/lib/icons.ts, jamais d'une donnée utilisateur.
      dangerouslySetInnerHTML={{ __html: iconPath(name) }}
    />
  )
}
