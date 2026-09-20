import { redirect } from 'next/navigation'
import { resolveLocale } from '@/i18n'
import { getCurrentUser } from '@/server/auth/session'
import { availableCredits } from '@/server/billing/credits'
import { readDashboard } from '@/server/audit/service'
import {
  lireRecherches,
  type Occasion,
  type PartPays,
  type VueRecherches,
} from '@/server/audit/recherches'
import { nomDuPays } from '@/lib/pays'
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
        Ces pages sortent au-delà de la dixième place en moyenne, sans dépasser la
        vingtième : selon la recherche, elles apparaissent en bas de la première page ou en
        haut de la deuxième. Google les montre déjà, presque personne ne les voit. Quelques
        places gagnées y rapportent plus qu’une page neuve, parce que la matière est là.
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
              key={occasion.cle}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4"
            >
              <p className="m-0 text-sm break-all">{occasion.cle}</p>
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

/** Ce qu'on propose de choisir. Au-delà, la barre déborde et ne se lit plus. */
const PAYS_PROPOSES = 6

/**
 * Le choix du pays, en liens plutôt qu'en menu.
 *
 * L'adresse porte le choix : elle se met en favori, se partage et se recharge. Un menu
 * aurait demandé du JavaScript pour dire la même chose, et aurait perdu le choix au premier
 * rafraîchissement.
 */
function ChoixDuPays({
  pays,
  retenu,
  locale,
  siteId,
}: {
  pays: PartPays[]
  retenu: string | null
  locale: string
  siteId: string
}) {
  if (pays.length < 2) return null

  const base = `/${locale}/visibilite/recherches?siteId=${siteId}`
  const total = pays.reduce((somme, part) => somme + part.impressions, 0)
  const choix = [
    { code: null as string | null, label: 'Tous les pays', impressions: total },
    ...pays.slice(0, PAYS_PROPOSES).map((part) => ({
      code: part.code,
      label: nomDuPays(part.code, locale),
      impressions: part.impressions,
    })),
  ]
  /*
   * Un pays choisi hors des plus visités doit rester visible, sinon l'écran affiche ses
   * chiffres sans montrer nulle part lequel il montre — et sans moyen d'en sortir.
   */
  if (retenu !== null && !choix.some((entree) => entree.code === retenu)) {
    const part = pays.find((entree) => entree.code === retenu)
    choix.push({
      code: retenu,
      label: nomDuPays(retenu, locale),
      impressions: part?.impressions ?? 0,
    })
  }

  return (
    <nav className="mt-4 flex flex-wrap gap-2" aria-label="Filtrer par pays">
      {choix.map((entree) => {
        const actif = entree.code === retenu
        return (
          <a
            key={entree.code ?? 'tous'}
            href={entree.code === null ? base : `${base}&pays=${entree.code}`}
            aria-current={actif ? 'true' : undefined}
            className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
              actif
                ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
            }`}
          >
            {entree.label}
            <span className={actif ? 'opacity-70' : 'text-[var(--color-ink-faint)]'}>
              {' '}
              {nombre(entree.impressions)}
            </span>
          </a>
        )
      })}
    </nav>
  )
}

function Chiffres({
  vue,
  locale,
  siteId,
}: {
  vue: VueRecherches
  locale: string
  siteId: string
}) {
  const pays = vue.paysRetenu === null ? null : nomDuPays(vue.paysRetenu, locale)
  return (
    <>
      <ChoixDuPays
        pays={vue.pays}
        retenu={vue.paysRetenu}
        locale={locale}
        siteId={siteId}
      />

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
          {pays === null ? 'Tous pays confondus, sur' : `Depuis ${pays}, sur`} les {vue.jours}{' '}
          derniers jours, pour vos {vue.pages.length} pages les plus vues. Ce n’est pas le total
          de votre site : Google ne rend que les cent premières lignes. Ses chiffres ont deux à
          trois jours de retard.
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
  searchParams: Promise<{ siteId?: string; pays?: string }>
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

  /*
   * Le pays vient de l'adresse : il n'ouvre aucun droit et n'atteint Google qu'après avoir
   * été réécrit sur trois lettres. Une valeur fantaisiste rend les chiffres de tout le
   * monde, jamais une erreur.
   */
  const lecture = await lireRecherches(user.id, tableau.site.origin, demande.pays)

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
          <Chiffres vue={lecture.vue} locale={locale} siteId={tableau.site.id} />
        ) : lecture.etat === 'non-connecte' ? (
          <Vide
            locale={locale}
            titre="Google Search Console n’est pas connecté."
            texte="En le reliant, Evoliia lit vos chiffres de recherche — en lecture seule, elle ne peut rien changer chez Google. C’est gratuit, et votre site doit déjà y être déclaré."
            lien="/connexions"
            lienTexte="Connecter Search Console"
          />
        ) : lecture.etat === 'hors-offre' ? (
          <Vide
            locale={locale}
            titre="Votre offre n’ouvre pas les chiffres de recherche."
            texte={lecture.raison}
            lien="/abonnement"
            lienTexte="Voir les offres"
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
