import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { listSites } from '@/server/audit/service'
import { lireCockpit } from '@/server/oria/cockpit'
import { canauxInconnus } from '@/server/oria/sante'
import { Shell } from '@/components/studio/Shell'
import {
  AccueilOria,
  ActiviteEquipe,
  AlertesOria,
  Aujourdhui,
  AutresRecommandations,
  CartePriorite,
  EnteteOria,
  EquipeOria,
  SanteMarketing,
} from '@/components/studio/Oria'

/**
 * Le cockpit d'Oria.
 *
 * Une seule question, et l'écran entier y est ordonné : qu'est-ce que je fais maintenant ?
 * Tout le reste — la santé des canaux, l'équipe, l'activité — vient après, et ne sert qu'à
 * justifier la réponse ou à aller plus loin.
 *
 * **L'ordre des blocs est celui d'un téléphone.** Priorité numéro un, alertes critiques,
 * état des canaux, équipe. Sur grand écran, le même ordre se lit aussi bien : une colonne
 * unique, comme les autres écrans du studio, plutôt qu'une grille de tuiles qui oblige à
 * chercher où regarder.
 *
 * **Rien ici ne coûte un crédit.** Le cockpit ne fait que lire ce que les spécialistes ont
 * déjà produit, et classer par du calcul. On peut l'ouvrir dix fois par jour.
 *
 * **Rien ici n'agit.** Chaque priorité mène à l'écran du spécialiste, où l'on valide ce
 * qu'il propose. Oria recommande ; la personne décide ; l'agent exécute.
 */
export const maxDuration = 60

export default async function OriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  const demande = await searchParams
  const [credits, sites, cockpit] = await Promise.all([
    availableCredits(user.id),
    listSites(user.id),
    lireCockpit(user.id, locale, demande.siteId),
  ])

  const siteId = cockpit.site?.id ?? ''
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  const maintenant = new Date()

  /*
   * Rien à lire : ni site analysé, ni compte publicitaire relié. Oria le dit et propose une
   * seule chose à faire, plutôt que d'afficher six blocs vides qui feraient croire à un
   * écran cassé.
   */
  const vierge = cockpit.site === null && cockpit.sourcesLues.length === 0

  return (
    <Shell
      locale={locale}
      userName={user.name}
      credits={credits}
      isAdmin={user.role === 'ADMIN'}
      screen="visibilite"
      menu="oria"
      siteId={siteId}
      sites={sites.map((site) => ({ id: site.id, host: site.host }))}
    >
      <div className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-10">
        <EnteteOria
          versPriorites="#priorites"
          versConversation={`/${locale}/visibilite/equipe${suffixe === '' ? '?agent=oria' : `${suffixe}&agent=oria`}`}
        />

        {vierge ? (
          <AccueilOria versAnalyse={`/${locale}/visibilite`} />
        ) : (
          <>
            <section id="priorites" className="scroll-mt-6">
              <h2 className="m-0 text-lg font-semibold">Mes 3 priorités</h2>
              <p className="mt-1 mb-4 text-sm text-[var(--color-ink-soft)]">
                Classées par ce qu’elles coûtent, le travail qu’elles demandent, leur urgence et
                la solidité des données derrière.
              </p>
              {cockpit.priorites.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
                  <p className="m-0 text-sm leading-relaxed">
                    Rien n’attend de décision aujourd’hui. Vos spécialistes n’ont aucun point
                    ouvert sur ce qu’ils regardent.
                  </p>
                </div>
              ) : (
                <ol className="m-0 grid list-none gap-4 p-0">
                  {cockpit.priorites.map((signal, rang) => (
                    <li key={signal.cle}>
                      <CartePriorite signal={signal} rang={rang + 1} />
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <AlertesOria alertes={cockpit.alertes} />

            <Aujourdhui
              phrase={cockpit.phrase}
              critiques={cockpit.signaux.filter((signal) => signal.urgence === 'critique').length}
              ouverts={cockpit.signaux.length}
              inconnus={canauxInconnus(cockpit.canaux).length}
            />

            <SanteMarketing canaux={cockpit.canaux} versConnexions={`/${locale}/connexions`} />

            <AutresRecommandations signaux={cockpit.autres} />

            <EquipeOria
              equipe={cockpit.equipe}
              locale={locale}
              siteId={siteId}
              maintenant={maintenant}
            />

            <ActiviteEquipe activite={cockpit.activite} maintenant={maintenant} />
          </>
        )}
      </div>
    </Shell>
  )
}
