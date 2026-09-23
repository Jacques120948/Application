import { lireNova } from '@/server/nova/service'
import { MENTION_MARGE } from '@/server/nova/pilotage'
import { Card, CardBody } from '@/components/ui'
import { MargeNova, ObjectifsNova, PrevisionNova } from '@/components/studio/Nova'
import { ReglagesNova } from '@/components/studio/ReglagesNova'
import { ProspectsNova } from '@/components/studio/ProspectsNova'
import { CadreNova, ouvrirNova } from '../cadre'

/**
 * Objectifs et marge : ce que la personne vise, et ce qui lui reste vraiment.
 *
 * La marge porte sur les trente derniers jours, avec les coûts que la personne a saisis ; les
 * objectifs mensuels, sur le mois en cours. Rien n'est deviné : un coût non renseigné est
 * nommé comme tel sous la marge.
 */
export const maxDuration = 60

export default async function PilotageNovaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const contexte = await ouvrirNova(params, (await searchParams).siteId)
  const vue = contexte.ouvert ? await lireNova(contexte.user.id, contexte.locale, { periode: '30', siteId: contexte.siteId }) : null
  return (
    <CadreNova contexte={contexte} courant="pilotage" onglets>
      {vue === null ? null : (
        <>
          <ObjectifsNova suivis={vue.objectifs} devise={vue.devise} versReglages="#reglages" />
          <PrevisionNova prevision={vue.prevision} devise={vue.devise} />
          <div>
            <p className="m-0 mb-2 text-xs text-[var(--color-ink-soft)]">Sur les 30 derniers jours.</p>
            <MargeNova marge={vue.marge} devise={vue.devise} mention={MENTION_MARGE} />
          </div>
          {vue.leads === null ? null : (
            <Card>
              <CardBody>
                <h2 className="m-0 mb-1 text-base font-semibold">Ce qui compte comme prospect</h2>
                <p className="mt-0 mb-3 text-sm text-[var(--color-ink-soft)]">
                  {vue.leads.total} prospect{vue.leads.total > 1 ? 's' : ''} sur 30 jours, lus dans les événements clés de Google Analytics.
                </p>
                <ProspectsNova disponibles={vue.leads.disponibles} choisis={vue.leads.evenements} auto={vue.leads.auto} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardBody>
              <h2 id="reglages" className="m-0 mb-1 scroll-mt-6 text-base font-semibold">
                Votre activité, vos objectifs, vos coûts
              </h2>
              <p className="mt-0 mb-5 text-sm text-[var(--color-ink-soft)]">
                Nova ne devine rien : ce que vous laissez vide reste « non renseigné ».
              </p>
              <ReglagesNova
                devise={vue.devise}
                initial={{ activite: vue.reglages.activite, objectifs: vue.reglages.objectifs, couts: vue.reglages.couts }}
              />
            </CardBody>
          </Card>
        </>
      )}
    </CadreNova>
  )
}
