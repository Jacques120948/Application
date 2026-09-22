import type { ConstatMeta, Priorite } from '@/server/ads/regles-meta'
import type { IndicateursMeta, LigneMeta, Verdict, VueMeta } from '@/server/ads/tableau-meta'

/**
 * Ce que MIRA montre, et dans quel ordre.
 *
 * L'ordre est le propos. Les chiffres du compte d'abord, parce que c'est la question qu'on
 * se pose en arrivant ; les trois étages ensuite, du plus large au plus fin, parce qu'on
 * descend vers la cause. L'inverse — une liste d'annonces avant un total — oblige à
 * reconstruire mentalement ce que le total dit d'un coup d'œil.
 *
 * Deux partis pris.
 *
 * **Une pastille n'est jamais muette.** Chaque couleur porte son motif au survol et en
 * dessous du tableau : « rouge » sans raison fait chercher ce qu'on a mal fait, et le gris
 * — données insuffisantes — est le plus mal compris de tous s'il ne se dit pas.
 *
 * **Une variation absente s'affiche « — », jamais « 0 % ».** Comparer à une période vide ne
 * donne pas une stabilité : cela ne donne rien, et un zéro à cet endroit ressemble à un
 * constat.
 */

const COULEURS: Record<Verdict, { point: string; fond: string; nom: string }> = {
  bon: {
    point: 'var(--color-positive)',
    fond: 'var(--color-positive-soft)',
    nom: 'Conforme à vos objectifs',
  },
  surveiller: {
    point: 'var(--color-caution)',
    fond: 'var(--color-caution-soft)',
    nom: 'À surveiller',
  },
  agir: {
    point: 'var(--color-critical)',
    fond: 'var(--color-critical-soft)',
    nom: 'Intervention recommandée',
  },
  insuffisant: {
    point: 'var(--color-ink-faint)',
    fond: 'var(--color-canvas)',
    nom: 'Données insuffisantes',
  },
}

function nombre(valeur: number): string {
  return valeur.toLocaleString('fr-CH').replace(/ | /g, ' ')
}

function argent(valeur: number | null, devise: string): string {
  if (valeur === null) return '—'
  return `${valeur.toLocaleString('fr-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`
}

/** Une variation, avec son signe. « — » quand la comparaison n'a pas de sens. */
function Ecart({ valeur, unite, inverse }: { valeur: number | null; unite: string; inverse?: boolean }) {
  if (valeur === null || valeur === 0) {
    return <span className="text-[var(--color-ink-faint)]">—</span>
  }
  /*
   * `inverse` pour ce qui est meilleur en baissant : un coût par vente qui recule est une
   * bonne nouvelle, et le peindre en rouge parce qu'il porte un signe moins ferait lire
   * l'inverse de ce qui se passe.
   */
  const bon = inverse === true ? valeur < 0 : valeur > 0
  return (
    <span style={{ color: bon ? 'var(--color-positive)' : 'var(--color-critical)' }}>
      {valeur > 0 ? '+' : ''}
      {valeur}
      {unite}
    </span>
  )
}

function Carte({
  nom,
  valeur,
  ecart,
  unite = '%',
  inverse,
  note,
}: {
  nom: string
  valeur: string
  ecart?: number | null
  unite?: string
  inverse?: boolean
  note?: string
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <p className="m-0 text-xs text-[var(--color-ink-soft)]">{nom}</p>
      <p className="mt-1 mb-0 text-xl font-semibold tabular-nums break-words">{valeur}</p>
      {ecart === undefined ? (
        note === undefined ? null : (
          <p className="mt-1 mb-0 text-xs text-[var(--color-ink-faint)]">{note}</p>
        )
      ) : (
        <p className="mt-1 mb-0 text-xs tabular-nums">
          <Ecart valeur={ecart} unite={unite} inverse={inverse} />
          <span className="text-[var(--color-ink-faint)]"> vs période précédente</span>
        </p>
      )}
    </div>
  )
}

function Niveau({
  titre,
  note,
  lignes,
  devise,
  budget,
}: {
  titre: string
  note: string
  lignes: LigneMeta[]
  devise: string
  budget: boolean
}) {
  return (
    <section className="mt-8 min-w-0">
      <h2 className="m-0 text-base font-semibold">{titre}</h2>
      <p className="mt-1 mb-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">{note}</p>

      {lignes.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-ink-faint)]">
          Rien n’a dépensé sur cette période.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-line)]">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-ink-faint)]">
                <th className="px-4 py-2 font-medium">Nom</th>
                {budget ? <th className="px-4 py-2 text-right font-medium">Budget/j</th> : null}
                <th className="px-4 py-2 text-right font-medium">Dépensé</th>
                <th className="px-4 py-2 text-right font-medium">Ventes</th>
                <th className="px-4 py-2 text-right font-medium">ROAS</th>
                <th className="px-4 py-2 text-right font-medium">Coût/vente</th>
                <th className="px-4 py-2 text-right font-medium">CTR</th>
                <th className="px-4 py-2 text-right font-medium">Fréq.</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((ligne) => (
                <tr key={ligne.id} className="border-t border-[var(--color-line)] align-top">
                  <td className="px-4 py-2">
                    <span className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: COULEURS[ligne.jugement.verdict].point }}
                        title={COULEURS[ligne.jugement.verdict].nom}
                      />
                      <span className="min-w-0">
                        <span className="block break-words">{ligne.nom}</span>
                        <span className="block text-xs text-[var(--color-ink-faint)]">
                          {ligne.jugement.motif}
                        </span>
                      </span>
                    </span>
                  </td>
                  {budget ? (
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                      {ligne.budget === 0 ? '—' : argent(ligne.budget, devise)}
                    </td>
                  ) : null}
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                    {argent(ligne.actuel.cout, devise)}
                    <span className="block text-xs">
                      <Ecart valeur={ligne.ecarts.cout} unite="%" />
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{ligne.actuel.conversions}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                    {ligne.actuel.roas === null ? '—' : `${ligne.actuel.roas} %`}
                    <span className="block text-xs">
                      <Ecart valeur={ligne.ecarts.roas} unite=" pts" />
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                    {argent(ligne.actuel.cpa, devise)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {ligne.actuel.ctr === null ? '—' : `${ligne.actuel.ctr} %`}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {ligne.actuel.frequence === 0 ? '—' : ligne.actuel.frequence}
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

/** La couleur d'une priorité. Même vocabulaire que les pastilles, autre échelle. */
const PRIORITES: Record<Priorite, { point: string; fond: string; nom: string }> = {
  urgent: {
    point: 'var(--color-critical)',
    fond: 'var(--color-critical-soft)',
    nom: 'À traiter',
  },
  surveiller: {
    point: 'var(--color-caution)',
    fond: 'var(--color-caution-soft)',
    nom: 'À surveiller',
  },
  opportunite: {
    point: 'var(--color-positive)',
    fond: 'var(--color-positive-soft)',
    nom: 'Opportunité',
  },
  information: {
    point: 'var(--color-brand)',
    fond: 'var(--color-brand-soft)',
    nom: 'Pour information',
  },
}

/**
 * Ce que MIRA a trouvé, avant tout le reste.
 *
 * C'est la seule chose qu'on doit voir sans chercher. Un tableau de bord qui commence par
 * des totaux répond à « combien » ; celui-ci répond à « et alors ? », qui est la question
 * qu'on se pose en l'ouvrant.
 *
 * Chaque constat tient en quatre temps, et la séparation vient de l'usage. « Votre fréquence
 * est à 4,2 » ne fait agir personne ; « votre fréquence est à 4,2, donc les mêmes personnes
 * voient la même image quatre fois, donc votre coût par vente va monter, donc changez de
 * visuel » fait agir. Les deux temps du milieu sont repliés : on les ouvre quand on doute,
 * pas quand on a déjà compris.
 *
 * Le silence est dit en toutes lettres : un bloc absent se prend pour un écran qui n'a pas
 * fini de charger.
 */
function AFaire({ constats }: { constats: ConstatMeta[] }) {
  if (constats.length === 0) {
    return (
      <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-positive-soft)] p-5">
        <h2 className="m-0 text-base font-semibold">Rien ne réclame votre attention</h2>
        <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Sur cette période, aucune de vos campagnes, de vos ensembles ni de vos annonces ne
          déclenche l’une des règles de MIRA. Les chiffres détaillés restent en dessous.
        </p>
      </section>
    )
  }

  const urgents = constats.filter((un) => un.priorite === 'urgent').length

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-base font-semibold">Ce que MIRA a trouvé</h2>
        <span className="text-xs text-[var(--color-ink-faint)]">
          {constats.length} constat{constats.length > 1 ? 's' : ''}
          {urgents === 0 ? '' : ` · ${urgents} à traiter`}
        </span>
      </div>

      <ul className="mt-4 mb-0 grid list-none gap-3 p-0">
        {constats.map((constat) => (
          <li
            key={`${constat.regle}-${constat.cibleId}`}
            className="rounded-[var(--radius-card)] border border-[var(--color-line)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: PRIORITES[constat.priorite].fond,
                  color: PRIORITES[constat.priorite].point,
                }}
              >
                {PRIORITES[constat.priorite].nom}
              </span>
              <span className="text-xs text-[var(--color-ink-faint)] capitalize">
                {constat.niveau}
              </span>
            </div>

            <p className="mt-2 mb-0 text-sm font-medium break-words">{constat.titre}</p>
            <p className="mt-1 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {constat.observation}
            </p>

            <p className="mt-3 mb-0 text-sm leading-relaxed">
              <span className="font-medium">Ce que je propose : </span>
              {constat.recommandation}
            </p>

            <details className="mt-2">
              <summary className="cursor-pointer list-none text-xs text-[var(--color-ink-soft)]">
                <span className="underline underline-offset-4">Pourquoi, et ce qui arrive sinon</span>
              </summary>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {constat.pourquoi}
              </p>
              <p className="mt-2 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {constat.consequence}
              </p>
            </details>
          </li>
        ))}
      </ul>

      <p className="mt-4 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Ces constats sont produits par des règles écrites, pas par un modèle : chacun porte
        les chiffres qui l’ont déclenché, et se vérifie. Aucun n’est appliqué — MIRA propose,
        c’est vous qui décidez.
      </p>
    </section>
  )
}

function Chiffres({ total, ecarts, devise }: {
  total: IndicateursMeta
  ecarts: VueMeta['ecarts']
  devise: string
}) {
  /*
   * Quatre devant, huit repliés. Douze cartes d'un bloc se regardent comme un mur : on les
   * parcourt sans en lire aucune. Les quatre qui restent sont celles qui répondent à « est-ce
   * que ça marche » — ce que j'ai dépensé, ce que ça a rapporté, combien de ventes, à quel
   * prix. Les autres servent à comprendre pourquoi, et on ne les cherche qu'ensuite.
   */
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Carte nom="Dépensé" valeur={argent(total.cout, devise)} ecart={ecarts.cout} inverse />
        <Carte
          nom="Chiffre d’affaires"
          valeur={argent(total.valeur, devise)}
          note="Tel que Meta l’attribue"
        />
        <Carte
          nom="ROAS"
          valeur={total.roas === null ? '—' : `${total.roas} %`}
          ecart={ecarts.roas}
          unite=" pts"
        />
        <Carte
          nom="Coût par vente"
          valeur={argent(total.cpa, devise)}
          ecart={ecarts.cpa}
          inverse
        />
      </div>

      <details className="mt-3 group">
        <summary className="cursor-pointer list-none text-sm text-[var(--color-ink-soft)]">
          <span className="underline underline-offset-4">Voir les autres indicateurs</span>
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Carte nom="Ventes" valeur={nombre(total.conversions)} ecart={ecarts.conversions} />
          <Carte nom="Coût par clic" valeur={argent(total.cpc, devise)} />
          <Carte nom="Coût des mille affichages" valeur={argent(total.cpm, devise)} />
          <Carte nom="Taux de clic" valeur={total.ctr === null ? '—' : `${total.ctr} %`} />
          <Carte nom="Affichages" valeur={nombre(total.impressions)} />
          <Carte nom="Clics" valeur={nombre(total.clics)} />
          <Carte
            nom="Portée"
            valeur={total.portee === 0 ? '—' : nombre(total.portee)}
            note="Personnes différentes"
          />
          <Carte
            nom="Fréquence"
            valeur={total.frequence === 0 ? '—' : String(total.frequence)}
            note="Affichages par personne"
          />
        </div>
      </details>
    </div>
  )
}

/**
 * L'écran de MIRA, dans l'ordre où l'on se pose les questions.
 *
 * Ce qu'il faut regarder d'abord, parce que c'est pour cela qu'on ouvre la page. Les quatre
 * chiffres qui disent où l'on en est ensuite. Le détail par étage en dernier, et replié : il
 * répond au « pourquoi », qu'on ne cherche qu'après avoir vu le « quoi ».
 *
 * L'ordre inverse — trois tableaux à lire de haut en bas, la ligne qui compte quelque part
 * dedans — est celui de la première version, et c'est ce qu'on lui a reproché à raison.
 */
export function TableauMeta({ vue, constats }: { vue: VueMeta; constats: ConstatMeta[] }) {
  /*
   * Les constats arrivent calculés, ils ne sont pas déduits ici. Un composant ne peut pas
   * appeler le serveur — il n'en importe que des types — et c'est une bonne barrière : des
   * règles qui décident d'une dépense se testent sans monter d'écran.
   */
  const devise = vue.compte.devise === '' ? '' : vue.compte.devise

  return (
    <div className="grid min-w-0 gap-8">
      <AFaire constats={constats} />

      <div className="min-w-0">
        <h2 className="m-0 mb-3 text-base font-semibold">Où vous en êtes</h2>
        <Chiffres total={vue.total} ecarts={vue.ecarts} devise={devise} />
      </div>

      <details className="min-w-0 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <summary className="cursor-pointer list-none">
          <span className="text-base font-semibold">Le détail, étage par étage</span>
          <span className="ml-2 text-sm text-[var(--color-ink-soft)]">
            {vue.campagnes.length} campagnes · {vue.ensembles.length} ensembles ·{' '}
            {vue.annonces.length} annonces
          </span>
        </summary>

        <Niveau
          titre="Campagnes"
          note="Le budget est indiqué quand la campagne le pilote ; sinon il vit sur les ensembles."
          lignes={vue.campagnes}
          devise={devise}
          budget
        />
        <Niveau
          titre="Ensembles de publicités"
          note="C’est ici que Meta place le plus souvent le budget, et l’audience visée."
          lignes={vue.ensembles}
          devise={devise}
          budget
        />
        <Niveau
          titre="Annonces"
          note="Les créatives elles-mêmes. Une fréquence qui monte pendant que le taux de clic baisse est le signe d’une audience qui se lasse."
          lignes={vue.annonces}
          devise={devise}
          budget={false}
        />

        <div className="mt-8 border-t border-[var(--color-line)] pt-5">
          <p className="m-0 text-sm font-medium">Ce que disent les pastilles</p>
          <ul className="mt-2 mb-0 flex flex-wrap list-none gap-x-5 gap-y-2 p-0 text-sm">
            {(Object.keys(COULEURS) as Verdict[]).map((verdict) => (
              <li key={verdict} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: COULEURS[verdict].point }}
                />
                <span>{COULEURS[verdict].nom}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
            Ces verdicts se fondent sur vos objectifs — ROAS visé, coût par vente acceptable —
            et sur rien d’autre. Les totaux portent sur les campagnes, jamais sur la somme des
            trois étages : additionner une campagne, ses ensembles et ses annonces compterait
            la même dépense trois fois. Le jour en cours n’y est pas, il est incomplet par
            définition.
          </p>
        </div>
      </details>
    </div>
  )
}
