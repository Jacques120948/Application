import { Badge, Card, CardBody } from '@/components/ui'
import type { EtatEmailing } from '@/server/lina/emailing'
import type { ProgressionObjectif } from '@/server/lina/objectifs'
import { semaineLisible, type AlerteLina, type BilanLina, type ReleveDate, type ScoreFidelite } from '@/server/lina/releves'
import type { PisteService } from '@/server/lina/services'

/**
 * Les blocs de la V3 de Lina : bilan de la semaine, alertes, score de fidélité, objectifs,
 * pistes pour les services et les SaaS, outil d'envoi relié.
 *
 * Tout est calculé par du code ; chaque évolution est une comparaison de relevés, jamais une
 * explication.
 */

function quandLisible(date: Date): string {
  return new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(date)
}

export function AlertesLina({ alertes, versOnglet }: { alertes: readonly AlerteLina[]; versOnglet: (onglet: AlerteLina['onglet']) => string }) {
  if (alertes.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Alertes de la semaine</h2>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {alertes.map((alerte) => (
            <li
              key={alerte.cle}
              className={`border-l-2 pl-3 text-sm leading-relaxed ${alerte.niveau === 'attention' ? 'border-[var(--color-caution)]' : 'border-[var(--color-positive)]'}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong>{alerte.titre}</strong>
                {alerte.niveau === 'positif' ? <Badge tone="positive">Bonne nouvelle</Badge> : <Badge tone="caution">À regarder</Badge>}
              </div>
              <p className="mt-1 mb-0">{alerte.texte}</p>
              <a href={versOnglet(alerte.onglet)} className="text-xs">
                Voir le détail
              </a>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

const TON_SENS = { mieux: 'positive', 'moins-bien': 'caution', stable: 'neutral' } as const

export function BilanSemaineLina({ bilan }: { bilan: BilanLina }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Bilan de la semaine du {semaineLisible(bilan.semaine)}</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
          {bilan.compareA === null
            ? 'Premier relevé : les évolutions apparaîtront la semaine prochaine. Lina garde un relevé par semaine, des totaux seulement.'
            : `Comparé au relevé de la semaine du ${semaineLisible(bilan.compareA)}. Une évolution est observée, pas expliquée.`}
        </p>
        <dl className="m-0 mt-3 grid gap-2">
          {bilan.lignes.map((ligne) => (
            <div key={ligne.cle} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--color-line)] pb-2 text-sm">
              <dt className="min-w-0">{ligne.libelle}</dt>
              <dd className="m-0 flex flex-wrap items-center gap-2 tabular-nums">
                <strong className="font-medium">{ligne.valeur}</strong>
                {ligne.evolution === null || ligne.sens === null ? null : <Badge tone={TON_SENS[ligne.sens]}>{ligne.evolution}</Badge>}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Liste titre="Ce qui progresse" lignes={bilan.progresse} vide={bilan.compareA === null ? 'Pas encore de comparaison.' : 'Rien de notable.'} />
          <Liste titre="Ce qui baisse" lignes={bilan.baisse} vide={bilan.compareA === null ? 'Pas encore de comparaison.' : 'Rien de notable.'} />
        </div>
        <div className="mt-4 grid gap-2 text-sm">
          {bilan.segmentPrioritaire === null ? null : (
            <p className="m-0">
              <span className="text-[var(--color-ink-soft)]">Segment prioritaire : </span>
              {bilan.segmentPrioritaire}
            </p>
          )}
          {bilan.opportunite === null ? null : (
            <p className="m-0">
              <span className="text-[var(--color-ink-soft)]">Opportunité principale : </span>
              {bilan.opportunite}
            </p>
          )}
        </div>
        <Liste titre="À faire cette semaine" lignes={bilan.aFaire} vide="Aucune action rapide cette semaine." ordonnee />
      </CardBody>
    </Card>
  )
}

function Liste({ titre, lignes, vide, ordonnee = false }: { titre: string; lignes: readonly string[]; vide: string; ordonnee?: boolean }) {
  const Balise = ordonnee ? 'ol' : 'ul'
  return (
    <div className="mt-3 min-w-0">
      <h3 className="m-0 text-sm font-semibold">{titre}</h3>
      {lignes.length === 0 ? (
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">{vide}</p>
      ) : (
        <Balise className={`m-0 mt-1 grid gap-1 pl-5 text-sm leading-relaxed ${ordonnee ? 'list-decimal' : 'list-disc'}`}>
          {lignes.map((ligne) => (
            <li key={ligne}>{ligne}</li>
          ))}
        </Balise>
      )}
    </div>
  )
}

export function ScoreLina({ score, releves }: { score: ScoreFidelite | null; releves: readonly ReleveDate[] }) {
  const serie = [...releves].filter((un) => un.score !== null).sort((a, b) => a.semaine.localeCompare(b.semaine)).slice(-12)
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Score de fidélité</h2>
        {score === null ? (
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">Il faut au moins 20 acheteurs pour que le score veuille dire quelque chose.</p>
        ) : (
          <>
            <p className="mt-2 mb-0 text-3xl font-semibold tabular-nums">
              {score.score}
              <span className="text-base font-normal text-[var(--color-ink-soft)]">/100</span>
            </p>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">{score.note}</p>
            <dl className="m-0 mt-3 grid gap-2">
              {score.composantes.map((un) => (
                <div key={un.cle} className="grid gap-1 text-xs">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <dt className="min-w-0">
                      {un.libelle} : {un.valeur}
                    </dt>
                    <dd className="m-0 tabular-nums text-[var(--color-ink-soft)]">
                      {new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 1 }).format(un.points)} / {un.max}
                    </dd>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--color-canvas)]">
                    <div className="h-1.5 rounded-full bg-[var(--color-brand)]" style={{ width: `${Math.round((un.points / un.max) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </dl>
          </>
        )}
        {serie.length >= 2 ? (
          <div className="mt-4">
            <h3 className="m-0 text-sm font-semibold">Semaine après semaine</h3>
            <div className="mt-2 flex h-24 items-end gap-1" role="img" aria-label={`Score des ${serie.length} dernières semaines`}>
              {serie.map((un) => (
                <div key={un.semaine} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`Semaine du ${semaineLisible(un.semaine)} : ${un.score}/100`}>
                  <span className="text-[10px] tabular-nums text-[var(--color-ink-soft)]">{un.score}</span>
                  <div className="w-full rounded-t-sm bg-[var(--color-brand)]" style={{ height: `${Math.max(2, un.score ?? 0) * 0.75}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1">
              {serie.map((un) => (
                <span key={un.semaine} className="min-w-0 flex-1 text-center text-[10px] leading-tight break-all text-[var(--color-ink-faint)]">
                  {un.semaine.slice(8, 10)}.{un.semaine.slice(5, 7)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

export function ProgressionLina({ lignes }: { lignes: readonly ProgressionObjectif[] }) {
  if (lignes.length === 0) {
    return <p className="m-0 text-sm text-[var(--color-ink-soft)]">Aucun objectif fixé. Lina n’en propose pas d’elle-même : c’est à vous de décider de la cible.</p>
  }
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {lignes.map((un) => (
        <li key={un.cle} className="grid gap-1 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="min-w-0">{un.libelle}</span>
            <span className="tabular-nums">
              {un.actuel ?? 'non mesuré'} <span className="text-[var(--color-ink-soft)]">/ {un.cible}</span>
              {un.atteint ? (
                <>
                  {' '}
                  <Badge tone="positive">Atteint</Badge>
                </>
              ) : null}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--color-canvas)]">
            <div className={`h-1.5 rounded-full ${un.atteint ? 'bg-[var(--color-positive)]' : 'bg-[var(--color-brand)]'}`} style={{ width: `${Math.round((un.part ?? 0) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function PistesServicesLina({ pistes, activite }: { pistes: readonly PisteService[]; activite: string }) {
  if (pistes.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">{activite === 'saas' ? 'Abonnés et prospects' : activite === 'services' ? 'Clients et prospects' : 'Prospects et abonnés'}</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">D’après ce que Nova lit dans votre CRM et dans Stripe : des totaux, aucune personne.</p>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {pistes.map((piste) => (
            <li key={piste.cle} className="border-l-2 border-[var(--color-brand)] pl-3 text-sm leading-relaxed">
              <strong>{piste.titre}</strong>
              <p className="mt-1 mb-0">{piste.constat}</p>
              <p className="mt-1 mb-0">{piste.action}</p>
              <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">{piste.mesure}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

export function EmailingLina({ etat, versConnexions }: { etat: EtatEmailing; versConnexions: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Outil d’envoi</h2>
        {etat === null ? (
          <p className="mt-2 mb-0 text-sm leading-relaxed">
            Reliez Klaviyo, Brevo ou Mailchimp dans <a href={versConnexions}>Connexions</a> avec une clé en lecture seule : Lina relira les résultats de vos
            campagnes toute seule. Evoliia ne lit que les totaux des campagnes, jamais vos listes de contacts, et n’envoie rien.
          </p>
        ) : (
          <>
            <p className="mt-2 mb-0 text-sm">
              {etat.nom} relié. {etat.at === null ? 'Résultats pas encore relus.' : `Résultats relus le ${quandLisible(etat.at)}.`}
            </p>
            {etat.message === '' ? null : <p className="mt-1 mb-0 text-xs text-[var(--color-critical)]">{etat.message}</p>}
            <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
              Les 50 dernières campagnes envoyées. Ce que {etat.nom} ne mesure pas reste « non mesuré ». Donnez un nom de test et une variante aux
              campagnes d’un test A/B pour que Lina les compare.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  )
}
