import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'

/**
 * L'ancienne adresse du tableau de bord, qui conduit maintenant à la visibilité.
 *
 * Evoliia ne vend plus la construction d'applications : le tableau de bord du produit, c'est
 * l'écran de visibilité. Cette adresse reste parce qu'elle vit dans des favoris, dans des
 * courriels et dans le lien du logo ; la faire disparaître aurait cassé tout cela pour rien.
 *
 * L'atelier du constructeur n'est pas supprimé pour autant : il vit à `/atelier`, hors du
 * menu, pour ceux dont les projets tournent encore.
 */
export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = resolveLocale((await params).locale)
  redirect(`/${locale}/visibilite`)
}
