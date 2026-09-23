import { lireLina } from '@/server/lina/service'
import { ObjectifsFormLina } from '@/components/studio/ObjectifsLina'
import { BilanEmailLina } from '@/components/studio/AssisteLina'
import { lireBilanEmail } from '@/server/lina/bilan-email'
import { isEmailAvailable } from '@/server/email/send'
import { isEnabled } from '@/server/settings/flags'
import { AlertesLina, BilanSemaineLina, ProgressionLina, ScoreLina } from '@/components/studio/LinaV3'
import { Card, CardBody } from '@/components/ui'
import { CadreLina, ouvrirLina } from '../cadre'

/**
 * Le bilan de la semaine, les alertes, le score de fidélité et les objectifs CRM.
 * Aucun crédit : des relevés hebdomadaires comparés par du code.
 */
export default async function BilanLinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const demande = await searchParams
  const contexte = await ouvrirLina(params, demande.siteId)
  const { locale, user, siteId, ouvert } = contexte
  const [vue, bilanEmail, envoiOuvert] = ouvert
    ? await Promise.all([lireLina(user.id, { avecNova: false }), lireBilanEmail(user.id), isEnabled('linaBilanEmail')])
    : [null, false, false]
  const suffixe = siteId === '' ? '' : `?siteId=${siteId}`
  return (
    <CadreLina contexte={contexte} courant="bilan" onglets={vue !== null && !vue.vierge}>
      {vue === null ? null : vue.vierge || vue.bilan === null ? (
        <Card>
          <CardBody>
            <p className="m-0 text-sm leading-relaxed">Le bilan de la semaine apparaîtra dès que Lina aura lu votre base clients.</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <AlertesLina alertes={vue.alertes} versOnglet={(onglet) => `/${locale}/lina${onglet === 'tableau' ? '' : `/${onglet}`}${suffixe}`} />
          <BilanSemaineLina bilan={vue.bilan} />
          <Card>
            <CardBody>
              <BilanEmailLina actif={bilanEmail} disponible={envoiOuvert && isEmailAvailable()} />
            </CardBody>
          </Card>
          <ScoreLina score={vue.score} releves={vue.releves} />
          <Card>
            <CardBody>
              <h2 className="m-0 text-base font-semibold">Objectifs CRM</h2>
              <div className="mt-3">
                <ProgressionLina lignes={vue.progression} />
              </div>
              <details className="mt-4">
                <summary className="cursor-pointer text-sm">{vue.progression.length === 0 ? 'Fixer des objectifs' : 'Modifier les objectifs'}</summary>
                <div className="mt-3">
                  <ObjectifsFormLina objectifs={vue.objectifs} />
                </div>
              </details>
            </CardBody>
          </Card>
        </>
      )}
    </CadreLina>
  )
}
