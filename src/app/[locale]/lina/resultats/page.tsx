import { lireLina } from '@/server/lina/service'
import { lireResultats, testsAB } from '@/server/lina/resultats'
import { lireEtatEmailing } from '@/server/lina/emailing'
import { EmailingLina } from '@/components/studio/LinaV3'
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
  const { locale, user, ouvert } = contexte
  const [vue, resultats, emailing] = ouvert
    ? await Promise.all([lireLina(user.id, { avecNova: false }), lireResultats(user.id), lireEtatEmailing(user.id).catch(() => null)])
    : [null, [], null]
  const campagnes = vue === null ? [] : vue.campagnes.map((campagne) => ({ cle: campagne.cle, titre: campagne.titre }))
  return (
    <CadreLina contexte={contexte} courant="resultats" onglets={vue !== null && !vue.vierge}>
      {vue === null ? null : (
        <>
          <EmailingLina etat={emailing} versConnexions={`/${locale}/connexions`} />
          <TestsABLina tests={testsAB(resultats)} />
          <ResultatsTableLina resultats={resultats} devise={vue.devise} campagnes={campagnes} />
          <Card>
            <CardBody>
              <h2 className="m-0 text-base font-semibold">Ajouter les résultats d’un envoi</h2>
              <p className="mt-1 mb-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                Pour un envoi fait ailleurs (Shopify Email, par exemple), recopiez les chiffres de l’outil. Pour un test A/B, donnez le même nom de test aux deux
                variantes.
              </p>
              <SaisieResultatLina campagnes={campagnes} />
            </CardBody>
          </Card>
        </>
      )}
    </CadreLina>
  )
}
