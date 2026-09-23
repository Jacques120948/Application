import { lireLina } from '@/server/lina/service'
import { lireResultats, testsAB } from '@/server/lina/resultats'
import { ResultatsTableLina, TestsABLina } from '@/components/studio/LinaV2'
import { SaisieResultatLina } from '@/components/studio/ResultatsLina'
import { Card, CardBody } from '@/components/ui'
import { CadreLina, ouvrirLina } from '../cadre'

/**
 * Les résultats des campagnes, saisis depuis l'outil d'envoi, et la comparaison des variantes.
 * Aucun crédit : tout se calcule par du code.
 */
export default async function ResultatsLinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const demande = await searchParams
  const contexte = await ouvrirLina(params, demande.siteId)
  const { user, ouvert } = contexte
  const [vue, resultats] = ouvert ? await Promise.all([lireLina(user.id, { avecNova: false }), lireResultats(user.id)]) : [null, []]
  return (
    <CadreLina contexte={contexte} courant="resultats" onglets={vue !== null && !vue.vierge}>
      {vue === null ? null : (
        <>
          <TestsABLina tests={testsAB(resultats)} />
          <ResultatsTableLina resultats={resultats} devise={vue.devise} />
          <Card>
            <CardBody>
              <h2 className="m-0 text-base font-semibold">Ajouter les résultats d’un envoi</h2>
              <p className="mt-1 mb-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                Recopiez les chiffres de votre outil d’envoi (Shopify Email, Klaviyo, Brevo…). Pour un test A/B, donnez le même nom de test aux deux
                variantes.
              </p>
              <SaisieResultatLina campagnes={vue.campagnes.map((campagne) => ({ cle: campagne.cle, titre: campagne.titre }))} />
            </CardBody>
          </Card>
        </>
      )}
    </CadreLina>
  )
}
