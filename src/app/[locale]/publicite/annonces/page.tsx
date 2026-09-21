import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { getEntitlements } from '@/server/billing/entitlements'
import { lireCreatifDuCompte } from '@/server/ads/creatif'
import { compteActif } from '@/server/ads/comptes'
import { isEnabled } from '@/server/settings/flags'
import { propositionsDuCompte } from '@/server/ads/redaction'
import { FORMATS, photosPourGroupe } from '@/server/ads/images'
import { Shell } from '@/components/studio/Shell'
import { Annonces } from '@/components/studio/Annonces'
import { LinkButton } from '@/components/ui'

/**
 * Le contenu des campagnes, séparé des chiffres.
 *
 * Un écran à part, et pas une section de plus sur la page de Naya : on n'y vient pas pour la
 * même raison. Les chiffres se regardent le matin, parce qu'ils ont bougé pendant la nuit ;
 * le contenu se regarde quand on a décidé d'écrire, ce qui arrive quelques fois par an. Les
 * mêler ferait une page qu'on fait défiler sans la lire.
 */
export default async function AnnoncesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const [credits, entitlements] = await Promise.all([
    availableCredits(user.id),
    getEntitlements(user.id),
  ])
  if (!entitlements.granted.includes('visibility_ads_agent')) redirect(`/${locale}/publicite`)

  const creatif = await lireCreatifDuCompte(user.id).catch(() => null)
  if (creatif === null) redirect(`/${locale}/publicite`)

  /*
   * Les propositions sont lues en une fois pour tous les contenants : une requête par
   * contenant ferait trente-deux allers-retours pour afficher une page.
   */
  const compte = await compteActif(user.id)
  const parGroupe = compte === null ? new Map() : await propositionsDuCompte(user.id, compte.id)
  const propositions = Object.fromEntries(parGroupe)

  /*
   * Le dépôt a les deux mêmes verrous que les budgets : l'interrupteur d'exploitation, qui
   * vaut pour toute l'installation, et le mode du compte, que la personne règle elle-même.
   * Un bouton visible alors que l'un des deux est fermé serait un bouton qui déçoit au clic.
   */
  const assiste = compte?.mode === 'assiste' && (await isEnabled('publiciteEcriture'))

  /*
   * Les photos ne sont cherchées que pour les groupes d'éléments, et seulement si l'écriture
   * est ouverte : lire tout le catalogue Shopify pour l'afficher sans pouvoir rien déposer
   * serait une lecture payée en temps pour rien.
   */
  const contenants = creatif.groupes.filter((groupe) => groupe.genre === 'elements')
  const photos = assiste
    ? Object.fromEntries(
        await Promise.all(
          contenants.map(async (groupe) => [
            groupe.id,
            await photosPourGroupe(user.id, groupe.id).catch(() => []),
          ]),
        ),
      )
    : {}

  const formats = Object.entries(FORMATS).map(([cle, format]) => ({
    cle,
    nom: format.nom,
    coupe: format.coupe,
    dimensions: `${format.largeur}×${format.hauteur}`,
  }))

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
    >
      <div className="mx-auto w-full max-w-4xl px-5 py-10">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-2xl font-semibold tracking-tight">Vos annonces</h1>
            <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Ce que vos campagnes disent, et les mots que les gens ont réellement tapés pour
              les voir. C’est la matière de tout ce qu’on peut améliorer ensuite.
              {creatif.luAt === null
                ? ''
                : ` Dernière lecture : ${creatif.luAt.toLocaleDateString(locale)}.`}
            </p>
          </div>
          <LinkButton href={`/${locale}/publicite`} variant="secondary">
            Retour aux chiffres
          </LinkButton>
        </div>

        <Annonces
          groupes={creatif.groupes}
          termes={creatif.termes}
          lu={creatif.lu}
          propositions={propositions}
          photos={photos}
          formats={formats}
          assiste={assiste}
        />
      </div>
    </Shell>
  )
}
