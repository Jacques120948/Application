import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { negotiateLocale } from '@/i18n/config'

/** Entrée du site : oriente vers la langue du visiteur. */
export default async function RootPage() {
  const requestHeaders = await headers()
  redirect(`/${negotiateLocale(requestHeaders.get('accept-language'))}`)
}
