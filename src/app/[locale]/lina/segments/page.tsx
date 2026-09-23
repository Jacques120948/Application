import { lireLina, lireMembres } from '@/server/lina/service'
import { CLES_SEGMENTS, type CleSegment } from '@/server/lina/segments'
import { CriteresLina } from '@/components/studio/CriteresLina'
import { AutonomieLina } from '@/components/studio/AssisteLina'
import { lienSegment, lireActions, lireAutonomie } from '@/server/lina/assiste'
import { MembresLina, RfmLina, SegmentsLina } from '@/components/studio/Lina'
import { Card, CardBody } from '@/components/ui'
import { CadreLina, ouvrirLina } from '../cadre'

/**
 * Les segments de Lina, leurs seuils, et les clients de celui qu'on ouvre.
 *
 * Les clients s'affichent par un numéro et des chiffres, avec un lien vers leur fiche
 * Shopify : c'est là que la personne voit un nom, jamais ici.
 */
export default async function SegmentsLinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; segment?: string }>
}) {
  const demande = await searchParams
  const contexte = await ouvrirLina(params, demande.siteId)
  const { locale, user, siteId, ouvert } = contexte
  const [vue, autonomie, actions] = ouvert
    ? await Promise.all([lireLina(user.id, { avecNova: false }), lireAutonomie(user.id), lireActions(user.id, 5)])
    : [null, 'conseil' as const, []]
  const selection = (CLES_SEGMENTS as readonly string[]).includes(demande.segment ?? '') ? (demande.segment as CleSegment) : null
  const membres = vue !== null && !vue.vierge && selection !== null ? await lireMembres(user.id, selection, 30) : []
  const segment = vue?.segments.find((un) => un.cle === selection) ?? null
  const base = `/${locale}/lina/segments`
  const lien = (cle: string) => {
    const parametres = new URLSearchParams()
    if (siteId !== '') parametres.set('siteId', siteId)
    parametres.set('segment', cle)
    return `${base}?${parametres.toString()}#membres`
  }

  return (
    <CadreLina contexte={contexte} courant="segments" onglets={vue !== null && !vue.vierge}>
      {vue === null ? null : vue.vierge ? (
        <Card>
          <CardBody>
            <p className="m-0 text-sm leading-relaxed">
              Les segments apparaîtront après la première analyse de votre base clients.{' '}
              <a href={`/${locale}/lina${siteId === '' ? '' : `?siteId=${siteId}`}#analyse`}>Analyser mes clients</a>
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          {segment === null ? null : (
            <div id="membres" className="scroll-mt-6">
              <MembresLina
                segment={segment}
                membres={membres}
                devise={vue.devise}
                boutique={vue.etat.boutique}
                source={vue.etat.source}
                assiste={autonomie === 'assiste' && vue.etat.source === 'shopify'}
                versFiche={(ref) => `/${locale}/lina/clients/${encodeURIComponent(ref)}${siteId === '' ? '' : `?siteId=${siteId}`}`}
              />
            </div>
          )}
          <SegmentsLina segments={vue.segments} devise={vue.devise} selection={selection} lien={lien} />
          <RfmLina lignes={vue.rfm} devise={vue.devise} />
          <Card>
            <CardBody>
              <h2 className="m-0 text-base font-semibold">Critères des segments</h2>
              <p className="mt-1 mb-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                Adaptez-les à votre cycle d’achat : un client de café revient chaque mois, un client de mobilier chaque année.
              </p>
              <CriteresLina initiaux={vue.criteres} />
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <h2 className="m-0 text-base font-semibold">Autonomie de Lina</h2>
              <div className="mt-3">
                <AutonomieLina niveau={autonomie} />
              </div>
              {actions.length === 0 ? null : (
                <>
                  <h3 className="mt-4 mb-0 text-sm font-semibold">Ce que Lina a exécuté</h3>
                  <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-xs">
                    {actions.map((action) => (
                      <li key={action.id}>
                        {action.createdAt.toISOString().slice(0, 10).split('-').reverse().join('.')} — segment créé dans Shopify : « {action.nom} »
                        {vue.etat.boutique === '' || action.refExterne === '' ? null : (
                          <>
                            {' '}
                            <a href={lienSegment(vue.etat.boutique, action.refExterne)} target="_blank" rel="noopener noreferrer">
                              voir ↗
                            </a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </CadreLina>
  )
}
