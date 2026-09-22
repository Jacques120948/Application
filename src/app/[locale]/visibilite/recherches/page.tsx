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
import {
  compterTranches,
  lireOrganique,
  periodeValide,
  PERIODES_ORGANIQUE,
  type Mouvement,
  type Rang,
  type Tranche,
  type VueOrganique,
} from '@/server/audit/organique'
import { lireVolumes, normaliser, type VolumeConnu } from '@/server/audit/volumes'
import { nomDuPays } from '@/lib/pays'
import type { Ligne } from '@/server/integrations/providers/google-search-console'
import { CourbeOrganique } from '@/components/studio/CourbeOrganique'
import { VolumesRecherche } from '@/components/studio/VolumesRecherche'
import { Shell } from '@/components/studio/Shell'
import { LinkButton } from '@/components/ui'

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
      <LinkButton href={`/${locale}${lien}`} variant="secondary" className="mt-3">
        {lienTexte}
      </LinkButton>
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

/**
 * Les quatre endroits où l'on peut être, nommés comme on en parle.
 *
 * « Position moyenne 14,2 » ne dit rien à personne. « Deuxième page » dit tout, parce que
 * c'est la seule frontière qui change quelque chose : au-dessus on est vu, en dessous on ne
 * l'est pas. Le nombre reste affiché à côté pour qui veut le détail.
 */
const TRANCHES: { cle: Tranche; titre: string; note: string; teinte: string; fond: string }[] = [
  {
    cle: 'podium',
    titre: 'Sur le podium',
    note: 'Les trois premiers résultats. C’est là que se font presque tous les clics.',
    teinte: 'var(--color-positive)',
    fond: 'var(--color-positive-soft)',
  },
  {
    cle: 'page-1',
    titre: 'En première page',
    note: 'Places 4 à 10 : on vous voit sans faire défiler jusqu’en bas.',
    teinte: 'var(--color-brand)',
    fond: 'var(--color-brand-soft)',
  },
  {
    cle: 'page-2',
    titre: 'En deuxième page',
    note: 'Places 11 à 20 : Google vous montre, presque personne ne descend jusque-là.',
    teinte: 'var(--color-caution)',
    fond: 'var(--color-caution-soft)',
  },
  {
    cle: 'loin',
    titre: 'Au-delà',
    note: 'Au-delà de la vingtième place : en pratique, vous n’êtes pas trouvé sur ces mots.',
    teinte: 'var(--color-critical)',
    fond: 'var(--color-critical-soft)',
  },
]

/**
 * Le volume mensuel d'une recherche, ou rien.
 *
 * Toujours précédé d'un « environ », et ce n'est pas une coquetterie : Google ne publie pas
 * un compte, il publie une moyenne sur douze mois arrondie à un palier. Afficher « 590 »
 * sans réserve laisserait croire à un décompte, et la première personne qui comparerait deux
 * outils y verrait une erreur d'Evoliia plutôt que la nature de la donnée.
 */
function Volume({ connu }: { connu: VolumeConnu | undefined }) {
  // -1 : demandé, mais Google n'a rien à dire. Distinct de 0, qui est une réponse.
  if (connu === undefined || connu.volume < 0) {
    return <span className="text-[var(--color-ink-faint)]">—</span>
  }
  if (connu.volume === 0) {
    return (
      <span
        className="text-[var(--color-ink-faint)]"
        title="Google ne mesure aucune recherche sur ce mot : trop rare pour être compté."
      >
        &lt; 10
      </span>
    )
  }
  return (
    <span title={concurrenceEnClair(connu.concurrence)}>≈ {nombre(connu.volume)}</span>
  )
}

/** La concurrence publicitaire, dite en français plutôt qu'en majuscules anglaises. */
function concurrenceEnClair(valeur: string): string {
  if (valeur === 'LOW') return 'Peu d’annonceurs se disputent ce mot.'
  if (valeur === 'MEDIUM') return 'Quelques annonceurs se disputent ce mot.'
  if (valeur === 'HIGH') return 'Beaucoup d’annonceurs se disputent ce mot.'
  return ''
}

/** Le mouvement d'une recherche, ou le silence honnête quand on ne le connaît pas. */
function Deplacement({ gain }: { gain: number | null }) {
  if (gain === null) {
    return (
      <span
        className="text-[var(--color-ink-faint)]"
        title="Cette recherche ne figurait pas dans notre relevé le plus ancien de la période. Cela ne veut pas dire qu’elle est nouvelle : nous ne relevons que les vingt-cinq recherches les plus cliquées de chaque nuit."
      >
        —
      </span>
    )
  }
  if (gain === 0) return <span className="text-[var(--color-ink-faint)]">=</span>
  const monte = gain > 0
  return (
    <span
      className="font-medium"
      style={{ color: monte ? 'var(--color-positive)' : 'var(--color-critical)' }}
    >
      {monte ? '▲' : '▼'} {Math.abs(gain).toFixed(1)}
    </span>
  )
}

/**
 * Le classement : où vous sortez, recherche par recherche.
 *
 * Trié par place et non par clics, et c'est tout l'intérêt. La liste par clics répond à
 * « qu'est-ce qui marche » ; celle-ci répond à « où j'en suis ». Une recherche en deuxième
 * position à trois clics par mois est un mot que personne ne tape, pas un échec ; une
 * recherche en quinzième position à quarante clics est un travail qui reste à faire.
 */
function Classement({
  rangs,
  jours,
  volumes,
  siteId,
  locale,
}: {
  rangs: Rang[]
  jours: number
  volumes: Map<string, VolumeConnu>
  siteId: string
  locale: string
}) {
  if (rangs.length === 0) return null

  const compte = compterTranches(rangs)

  /*
   * La date du relevé le plus récent, pour que le bouton dise si les volumes datent d'hier
   * ou de six mois. Calculée sur ce qui est réellement affiché, et non sur toute la table :
   * une ligne fraîche pour un mot qu'on ne montre plus ne dit rien de ce tableau-ci.
   */
  let releveLe: Date | null = null
  for (const rang of rangs) {
    const connu = volumes.get(normaliser(rang.requete))
    if (connu !== undefined && (releveLe === null || connu.releveAt > releveLe)) {
      releveLe = connu.releveAt
    }
  }

  return (
    <section className="mt-8">
      <h2 className="m-0 text-base font-semibold">Où vous sortez</h2>
      <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
        Vos recherches classées par place, la meilleure d’abord. C’est une moyenne sur les{' '}
        {jours} derniers jours, pas votre position en direct : une recherche qui sort 3
        <sup>e</sup> certains jours et 30<sup>e</sup> d’autres s’affiche autour de la 16
        <sup>e</sup>. Google la calcule ainsi, et c’est bien la bonne façon de la lire.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TRANCHES.map((tranche) => (
          <div
            key={tranche.cle}
            className="rounded-[var(--radius-card)] p-4"
            style={{ backgroundColor: tranche.fond }}
          >
            <p
              className="m-0 text-2xl font-semibold tabular-nums"
              style={{ color: tranche.teinte }}
            >
              {compte[tranche.cle]}
            </p>
            <p className="mt-1 mb-0 text-xs font-medium">{tranche.titre}</p>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              {tranche.note}
            </p>
          </div>
        ))}
      </div>

      {/*
        Le volume est la moitié que Search Console ne connaît pas, et la confusion entre les
        deux colonnes est la plus coûteuse du référencement. « Vues » compte les fois où
        Google vous a montré ; « Cherché » compte les fois où le mot a été tapé, par qui que
        ce soit. Sortir trentième sur un mot cherché cinq mille fois donne moins de vues que
        sortir troisième sur un mot cherché vingt fois — et sans la seconde colonne, ces deux
        lignes se lisent dans le mauvais ordre.
      */}
      <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <p className="m-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          <strong className="font-medium text-[var(--color-ink)]">Cherché / mois</strong> n’est
          pas la même chose que <strong className="font-medium text-[var(--color-ink)]">Vues</strong> :
          l’une compte les fois où le mot a été tapé par qui que ce soit, l’autre les fois où
          Google vous a montré. Sortir 30<sup>e</sup> sur un mot cherché cinq mille fois vaut
          mieux que sortir 3<sup>e</sup> sur un mot cherché vingt fois, et seule la première
          colonne le dit. Elle vient du planificateur de Google Ads, et demande donc un compte
          publicitaire relié.
        </p>
        <div className="mt-3">
          <VolumesRecherche
            siteId={siteId}
            releveLe={releveLe === null ? null : releveLe.toISOString()}
            locale={locale}
          />
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--color-ink-faint)]">
              <th className="px-4 py-2 text-right font-medium">Place</th>
              <th className="px-4 py-2 font-medium">Recherche</th>
              <th className="px-4 py-2 text-right font-medium">Évolution</th>
              <th className="px-4 py-2 text-right font-medium">Cherché / mois</th>
              <th className="px-4 py-2 text-right font-medium">Clics</th>
              <th className="px-4 py-2 text-right font-medium">Vues</th>
            </tr>
          </thead>
          <tbody>
            {rangs.map((rang) => {
              const tranche = TRANCHES.find((une) => une.cle === rang.tranche)
              return (
                <tr key={rang.requete} className="border-t border-[var(--color-line)]">
                  <td className="px-4 py-2 text-right tabular-nums">
                    <span
                      className="inline-flex min-w-9 justify-center rounded-[var(--radius-pill)] px-2 py-0.5 font-medium"
                      style={{ backgroundColor: tranche?.fond, color: tranche?.teinte }}
                    >
                      {rang.position.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-2 break-words">{rang.requete}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                    <Deplacement gain={rang.gain} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                    <Volume connu={volumes.get(normaliser(rang.requete))} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{nombre(rang.clics)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {nombre(rang.impressions)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        L’évolution se lit contre notre relevé le plus ancien de la période choisie plus bas.
        Un tiret veut dire que la recherche n’y figurait pas — et non qu’elle est nouvelle :
        Evoliia ne note chaque nuit que vos vingt-cinq recherches les plus cliquées.
      </p>
    </section>
  )
}

/** Comment nommer une fenêtre, en français et sans arithmétique mentale. */
const NOM_PERIODE: Record<number, string> = {
  28: '4 semaines',
  90: '3 mois',
  180: '6 mois',
  480: '16 mois',
}

/**
 * Le choix de la période, en liens comme celui du pays.
 *
 * L'adresse porte le choix, pour la même raison qu'ailleurs : elle se met en favori, se
 * partage et survit au rafraîchissement. Le pays choisi est reconduit, sans quoi changer de
 * période effacerait silencieusement l'autre filtre.
 */
function ChoixDePeriode({
  jours,
  locale,
  siteId,
  pays,
}: {
  jours: number
  locale: string
  siteId: string
  pays: string | null
}) {
  const base = `/${locale}/visibilite/recherches?siteId=${siteId}${
    pays === null ? '' : `&pays=${pays}`
  }`
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Choisir la période">
      {PERIODES_ORGANIQUE.map((periode) => {
        const actif = periode === jours
        return (
          <a
            key={periode}
            href={`${base}&jours=${periode}`}
            aria-current={actif ? 'true' : undefined}
            className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs no-underline ${
              actif
                ? 'border-transparent bg-[var(--color-ink)] text-[var(--color-surface)]'
                : 'border-[var(--color-line)] text-[var(--color-ink-soft)]'
            }`}
          >
            {NOM_PERIODE[periode] ?? `${periode} jours`}
          </a>
        )
      })}
    </nav>
  )
}

function ListeMouvements({
  titre,
  note,
  mouvements,
  vide,
}: {
  titre: string
  note: string
  mouvements: Mouvement[]
  vide: string
}) {
  return (
    <div className="min-w-0">
      <h3 className="m-0 text-sm font-semibold">{titre}</h3>
      <p className="mt-1 mb-2 text-xs leading-relaxed text-[var(--color-ink-soft)]">{note}</p>
      {mouvements.length === 0 ? (
        <p className="m-0 text-xs text-[var(--color-ink-faint)]">{vide}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {mouvements.map((mouvement) => (
            <li
              key={mouvement.requete}
              className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-3"
            >
              <p className="m-0 text-sm break-words">{mouvement.requete}</p>
              <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)] tabular-nums">
                place {mouvement.positionAvant.toFixed(1)} → {mouvement.position.toFixed(1)} (
                {mouvement.gain > 0 ? '+' : ''}
                {mouvement.gain.toFixed(1)}) · {nombre(mouvement.impressions)} vues
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * L'évolution : la courbe, et ce qui a bougé dedans.
 *
 * Les deux mesures n'ont pas la même source et ce n'est pas un détail. La courbe vient de
 * Google, qui garde seize mois — elle est donc juste dès le premier jour d'utilisation. Les
 * mouvements de rang viennent des relevés d'Evoliia, parce que Google ne conserve pas la
 * position passée d'une requête ; ils n'existent qu'à partir du deuxième relevé, et l'écran
 * le dit plutôt que d'afficher deux colonnes vides sans explication.
 */
function Evolution({
  vue,
  locale,
  siteId,
  pays,
}: {
  vue: VueOrganique
  locale: string
  siteId: string
  pays: string | null
}) {
  return (
    <section className="mt-8 grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">Votre trafic naturel dans le temps</h2>
        <ChoixDePeriode jours={vue.jours} locale={locale} siteId={siteId} pays={pays} />
      </div>

      <CourbeOrganique serie={vue.serie} />

      <div className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="m-0 text-base font-semibold">Ce qui a bougé</h2>
        {vue.ecartJours === 0 ? (
          <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Evoliia n’a pas encore deux relevés à comparer sur cette période. Google ne garde
            pas la place que vous occupiez il y a un mois sur une recherche donnée : c’est
            Evoliia qui la note chaque nuit, et il lui faut quelques nuits.
          </p>
        ) : (
          <>
            <p className="mt-1 mb-4 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              Entre nos deux relevés les plus éloignés de la période, soit {vue.ecartJours}{' '}
              {vue.ecartJours > 1 ? 'jours' : 'jour'}. Une place plus petite est meilleure : la
              première place, c’est 1.
              {vue.mouvementsTousPays
                ? ' Ces places sont relevées tous pays confondus, contrairement à la courbe.'
                : ''}
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <ListeMouvements
                titre="Vous êtes monté"
                note="Les recherches où vous avez gagné des places."
                mouvements={vue.gagnees}
                vide="Aucune remontée nette sur cette période."
              />
              <ListeMouvements
                titre="Vous êtes descendu"
                note="Celles où vous en avez perdu. C’est là qu’il y a du travail à refaire."
                mouvements={vue.perdues}
                vide="Aucune baisse nette sur cette période. C’est une bonne nouvelle."
              />
            </div>
          </>
        )}
      </div>
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
  searchParams: Promise<{ siteId?: string; pays?: string; jours?: string }>
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
  /*
   * La fenêtre de la courbe vient de l'adresse et n'ouvre aucun droit : elle est ramenée à
   * l'une des valeurs proposées, et toute autre vaut la valeur par défaut. Les tableaux, eux,
   * gardent leurs vingt-huit jours : ce sont deux questions différentes, et lire les cent
   * meilleures requêtes sur seize mois ne dirait plus rien de ce qui se passe maintenant.
   */
  const jours = periodeValide(demande.jours)

  const [lecture, organique, volumes] = await Promise.all([
    lireRecherches(user.id, tableau.site.origin, demande.pays),
    /*
     * La courbe est lue en parallèle et son échec n'emporte pas la page : c'est un appel de
     * plus chez Google, et une lecture qui échoue doit coûter un bloc, pas l'écran entier.
     */
    lireOrganique(user.id, tableau.site.id, tableau.site.origin, jours, demande.pays),
    /*
     * Lus en base, jamais chez Google : un volume est une moyenne mensuelle, et le
     * redemander à chaque affichage ferait dépendre le quota d'appels d'Evoliia — partagé
     * par tous ses utilisateurs — du nombre d'onglets ouverts. Le bouton s'en charge.
     */
    lireVolumes(user.id, tableau.site.id),
  ])

  return (
    <Shell locale={locale} userName={user.name} credits={credits} isAdmin={user.role === 'ADMIN'} screen="visibilite">
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
          <>
            <Chiffres vue={lecture.vue} locale={locale} siteId={tableau.site.id} />
            {organique.ok ? (
              <>
                {/*
                  Où l'on est d'abord, comment cela bouge ensuite. L'ordre inverse ferait
                  commencer l'écran par une dérivée avant d'avoir donné la valeur.
                */}
                <Classement
                  rangs={organique.vue.classement}
                  jours={lecture.vue.jours}
                  volumes={volumes}
                  siteId={tableau.site.id}
                  locale={locale}
                />
                <Evolution
                  vue={organique.vue}
                  locale={locale}
                  siteId={tableau.site.id}
                  pays={lecture.vue.paysRetenu}
                />
              </>
            ) : null}
          </>
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
