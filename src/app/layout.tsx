import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
/*
 * Polices des applications créées, auto-hébergées. Seules les déclarations sont chargées
 * ici : le navigateur ne télécharge un fichier de police que si une page l'utilise.
 */
import '@fontsource-variable/lora'
import '@fontsource-variable/nunito'
import '@fontsource-variable/playfair-display'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/outfit'
import '@fontsource-variable/manrope'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/inter'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/space-grotesk'

export const metadata: Metadata = {
  title: 'Evoliia',
  description:
    "Trouvez une idée. Créez-la. Lancez-la. Monétisez-la. Sans savoir coder.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
