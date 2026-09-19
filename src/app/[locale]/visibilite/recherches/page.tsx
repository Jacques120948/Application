import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import { lireRecherches, type Occasion, type VueRecherches } from '@/server/audit/recherches'
import type { Ligne } from '@/server/integrations/providers/google-search-console'
import { Shell } from '@/components/studio/Shell'

/**
 * Ce que les gens cherchent.
 *
 * Le seul écran du produit qui ne parle pas du site mais de sa demande. Tout le reste
 * mesure des pages ; celui-ci dit combien de fois Google les a montrées, à quelles
 * questions, et à quelle place. C'est ce qui permet de choisir quoi corriger d'abord —
 * autrement, on corrige ce qui est le plus facile à corriger.
 *
 * Il ne tombe jamais : pas de connexion, pas de propriété correspondante, autorisation
 * révoquée sont trois états ordinaires, chacun avec sa phrase et son geste suivant.
 */

/** Le temps à accorder : trois allers-retours chez Google, dont deux en parallèle. */
export const maxDuration = 60

function nombre(valeur: number): string {
  return valeur.toLocaleString('fr-CH').replace(/ | /g, ' ')
}

function Vide({ locale, titre, texte, lien, lienTexte }: {
  locale: string
  titre: string
  texte: string
  lien: string
  lienTexte: string
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <p className="m-0 text-sm font-medium">{titre}</p>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">{texte}</p>
      <a href={`/${locale}${lien}`} className="mt-3 inline-block text-sm text-[var(--color-ink-soft)]">
        {lienTexte}
      </a>
    </div>
  )
}

function Tableau({ titre, note, colonne, lignes }: {
  titre: string
  note: string
  colonne: string
  lignes: Ligne[]
}) {
  return (
    <section className="mt-8">
      <h2 className="m-0 text-base font-semibold">{titre}</h2>
      <p className="mt-1 mb-3 text-sm text-[var(--color-ink-soft)]">{note}</p>
      {lignes.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-ink-faint)]">
          Google n’a rien à montrer sur cette période.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-ink-faint)]">
                <th className="px-4 py-2 font-medium">{colonne}</th>
                <th className="px-4 py-2 text-right font-medium">Clics</th>
                <th className="px-4 py-2 text-right font-medium">Vues</th>
                <th className="px-4 py-2 text-right font-medium">Place</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((ligne) => (
                <tr key={ligne.cle} className="border-t border-[var(--color-line)]">
                  <td className="px-4 py-2 break-all">{ligne.cle}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nombre(ligne.clics)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{nombre(ligne.impressions)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {ligne.position.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Occasions({ occasions }: { occasions: Occasion[] }) {
  return (
    <section className="mt-8">
      <h2 className="m-0 text-base font-semibold">À portée de la première page</h2>
      <p className="mt-1 mb-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Ces pages sortent entre la onzième et la vingtième place : Google les montre déjà,
        presque personne ne les voit. Quelques places gagnées y rapportent plus qu’une page
        neuve, parce que la matière est là.
      </p>
      {occasions.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-ink-faint)]">
          Aucune page en deuxième page sur cette période. Ce n’est pas un défaut : vos pages
          sortent plus haut, ou pas encore assez pour être comptées.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {occasions.map((occasion) => (
            <li
              key={occasion.url}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
            >
              <p className="m-0 text-sm break-all">{occasion.url}</p>
              <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
                {nombre(occasion.impressions)} vues pour {nombre(occasion.clics)}{' '}
                {occasion.clics > 1 ? 'clics' : 'clic'} · place {occasion.position.toFixed(1)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Chiffres({ vue }: { vue: VueRecherches }) {
  return (
    <>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="m-0 text-sm">
          <span className="text-2xl font-semibold tabular-nums">{nombre(vue.totaux.clics)}</span>{' '}
          clics pour{' '}
          <span className="text-2xl font-semibold tabular-nums">
            {nombre(vue.totaux.impressions)}
          </span>{' '}
          affichages
        </p>
        <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          Sur les {vue.jours} derniers jours, pour vos {vue.pages.length} pages les plus vues.
          Ce n’est pas le total de votre site : Google ne rend que les cent premières lignes.
          Ses chiffres ont deux à trois jours de retard.
        </p>
      </div>

      <Occasions occasions={vue.occasions} />

      <Tableau
        titre="Ce que les gens tapent"
        note="Les recherches qui vous ont affiché, les plus cliquées d’abord."
        colonne="Recherche"
        lignes={vue.requetes}
      />

      <Tableau
        titre="Vos pages qui sortent"
        note="Les adresses que Google a montrées, les plus cliquées d’abord."
        colonne="Page"
        lignes={vue.pages}
      />
    </>
  )
}

export default async function RecherchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const locale = resolveLocale((await params).locale)
  const user = await getCurrentUser()
  if (user === null) redirect(`/${locale}/connexion`)

  /*
   * L'identifiant venu de l'adresse n'ouvre aucun droit : `readDashboard` ne le cherche que
   * parmi les sites déjà filtrés par la portée de l'utilisateur.
   */
  const demande = await searchParams
  const [credits, tableau] = await Promise.all([
    availableCredits(user.id),
    readDashboard(user.id, demande.siteId),
  ])
  if (tableau === null) redirect(`/${locale}/visibilite`)

  const lecture = await lireRecherches(user.id, tableau.site.origin)

  return (
    <Shell locale={locale} userName={user.name} credits={credits} screen="visibilite">
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <a
          href={`/${locale}/visibilite?siteId=${tableau.site.id}`}
          className="text-sm text-[var(--color-ink-soft)] no-underline"
        >
          ← Votre visibilité
        </a>
        <h1 className="mt-4 mb-0 text-2xl font-semibold tracking-tight">Ce que les gens cherchent</h1>
        <p className="mt-2 mb-8 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Les chiffres de Google sur {tableau.site.host} : ce que les gens tapent avant
          d’arriver chez vous, et à quelle place vous sortez. Ce ne sont pas des estimations,
          ce sont vos chiffres.
        </p>

        {lecture.ok ? (
          <Chiffres vue={lecture.vue} />
        ) : lecture.etat === 'non-connecte' ? (
          <Vide
            locale={locale}
            titre="Google Search Console n’est pas connecté."
            texte="En le reliant, Evoliia lit vos chiffres de recherche — en lecture seule, elle ne peut rien changer chez Google. C’est gratuit, et votre site doit déjà y être déclaré."
            lien="/connexions"
            lienTexte="Connecter Search Console"
          />
        ) : lecture.etat === 'sans-propriete' ? (
          <Vide
            locale={locale}
            titre={`Votre compte Google ne suit pas ${lecture.hote}.`}
            texte="Le compte connecté ne donne accès à aucune propriété correspondant à ce site. Déclarez-le dans Search Console et vérifiez-en la propriété, ou reconnectez Evoliia avec le compte Google qui le suit déjà."
            lien="/connexions"
            lienTexte="Revoir mes connexions"
          />
        ) : (
          <Vide
            locale={locale}
            titre="Google n’a pas répondu."
            texte={lecture.raison}
            lien="/connexions"
            lienTexte="Revoir mes connexions"
          />
        )}
      </div>
    </Shell>
  )
}
