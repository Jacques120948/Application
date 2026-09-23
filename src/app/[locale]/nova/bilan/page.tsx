import { lireBilan } from '@/server/nova/bilan'
import { BilanNova } from '@/components/studio/Nova'
import { CadreNova, ouvrirNova } from '../cadre'

/**
 * Le bilan de Nova : la dernière semaine terminée, comparée à la précédente.
 *
 * Aucun crédit : c'est la même mesure que le tableau de bord, sur sept jours fixes, réduite
 * à ce qu'on lit le lundi matin — ce qui progresse, ce qui baisse, ce qui mérite l'attention.
 */
export const maxDuration = 60

export default async function BilanNovaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const contexte = await ouvrirNova(params, (await searchParams).siteId)
  const bilan = contexte.ouvert ? await lireBilan(contexte.user.id, contexte.locale, contexte.siteId) : null
  return (
    <CadreNova contexte={contexte} courant="bilan" onglets>
      {bilan === null ? null : (
        <>
          <h2 className="m-0 text-lg font-semibold">Bilan Nova de la semaine</h2>
          <BilanNova bilan={bilan} />
        </>
      )}
    </CadreNova>
  )
}
