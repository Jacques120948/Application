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

const COULEURS: Record<Verdict, { point: string; nom: string }> = {
  bon: { point: 'var(--color-positive)', nom: 'Conforme à vos objectifs' },
  surveiller: { point: 'var(--color-caution)', nom: 'À surveiller' },
  agir: { point: 'var(--color-critical)', nom: 'Intervention recommandée' },
  insuffisant: { point: 'var(--color-ink-faint)', nom: 'Données insuffisantes' },
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

function Chiffres({ total, ecarts, devise }: {
  total: IndicateursMeta
  ecarts: VueMeta['ecarts']
  devise: string
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <Carte nom="Dépensé" valeur={argent(total.cout, devise)} ecart={ecarts.cout} inverse />
      <Carte
        nom="Chiffre d’affaires attribué"
        valeur={argent(total.valeur, devise)}
        note="Tel que Meta l’attribue"
      />
      <Carte
        nom="ROAS"
        valeur={total.roas === null ? '—' : `${total.roas} %`}
        ecart={ecarts.roas}
        unite=" pts"
      />
      <Carte nom="Ventes" valeur={nombre(total.conversions)} ecart={ecarts.conversions} />
      <Carte
        nom="Coût par vente"
        valeur={argent(total.cpa, devise)}
        ecart={ecarts.cpa}
        inverse
      />
      <Carte nom="Coût par clic" valeur={argent(total.cpc, devise)} />
      <Carte nom="Coût des mille affichages" valeur={argent(total.cpm, devise)} />
      <Carte nom="Taux de clic" valeur={total.ctr === null ? '—' : `${total.ctr} %`} />
      <Carte nom="Affichages" valeur={nombre(total.impressions)} />
      <Carte nom="Clics" valeur={nombre(total.clics)} />
      <Carte
        nom="Portée"
        valeur={total.portee === 0 ? '—' : nombre(total.portee)}
        note="Personnes différentes atteintes"
      />
      <Carte
        nom="Fréquence"
        valeur={total.frequence === 0 ? '—' : String(total.frequence)}
        note="Affichages par personne"
      />
    </div>
  )
}

export function TableauMeta({ vue }: { vue: VueMeta }) {
  const devise = vue.compte.devise === '' ? '' : vue.compte.devise

  return (
    <div className="min-w-0">
      <Chiffres total={vue.total} ecarts={vue.ecarts} devise={devise} />

      <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        Les totaux portent sur les campagnes, jamais sur la somme des trois étages — additionner
        une campagne, ses ensembles et ses annonces compterait la même dépense trois fois. Les
        chiffres sont ceux de la fenêtre d’attribution de votre compte Meta, et le jour en cours
        n’y est pas : il est incomplet par définition.
      </p>

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

      <section className="mt-8 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <h2 className="m-0 text-base font-semibold">Ce que disent les pastilles</h2>
        <ul className="mt-3 mb-0 grid list-none gap-2 p-0 text-sm">
          {(Object.keys(COULEURS) as Verdict[]).map((verdict) => (
            <li key={verdict} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: COULEURS[verdict].point }}
              />
              <span>{COULEURS[verdict].nom}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 mb-0 text-xs leading-relaxed text-[var(--color-ink-faint)]">
          Ces verdicts se fondent sur vos objectifs — ROAS visé, coût par vente acceptable — et
          sur rien d’autre. Sans objectif renseigné, MIRA se tait : « coût par vente de 37 »
          n’est ni bon ni mauvais tant qu’on ignore votre marge et votre panier moyen.
        </p>
      </section>
    </div>
  )
}
