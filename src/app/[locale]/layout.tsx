import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { isLocale, renderedLocale, resolveLocale } from '@/i18n/config'

/**
 * Enveloppe des pages de la plateforme.
 *
 * Elle porte la langue du contenu. L'attribut vit ici et non sur `<html>` parce que la
 * racine du projet sert aussi les applications publiées, qui ont leur propre langue : elle
 * ne peut donc pas en déclarer une pour tout le monde. Un attribut `lang` posé sur un
 * conteneur est valide et fait foi pour le sous-arbre qu'il contient, ce dont se servent
 * les lecteurs d'écran pour choisir la bonne prononciation.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  return <div lang={renderedLocale(resolveLocale(locale))}>{children}</div>
}
