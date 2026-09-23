import { lireNova } from '@/server/nova/service'
import { MENTION_PARCOURS, MENTION_VALEUR, MODELES } from '@/server/nova/clients'
import { AudiencesNova, ClientsNova, CohortesClientsNova, ModelesNova, ParcoursNova, PeriodeNova } from '@/components/studio/Nova'
import { CadreNova, ouvrirNova } from '../cadre'

/**
 * Clients et parcours : qui achète, qui revient, et par où ils sont passés.
 *
 * Les comptes sont des faits ; la lecture du parcours est une interprétation, et l'écran
 * l'écrit en toutes lettres. Les modèles d'attribution se montrent côte à côte : aucun n'est
 * « le vrai », et c'est justement ce qu'on comprend en les comparant.
 */
export const maxDuration = 60

export default async function ClientsNovaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ siteId?: string; periode?: string; du?: string; au?: string }>
}) {
  const demande = await searchParams
  const contexte = await ouvrirNova(params, demande.siteId)
  const vue = contexte.ouvert
    ? await lireNova(contexte.user.id, contexte.locale, { periode: demande.periode, du: demande.du, au: demande.au, siteId: contexte.siteId })
    : null
  return (
    <CadreNova contexte={contexte} courant="clients" onglets>
      {vue === null ? null : (
        <>
          <PeriodeNova
            courante={vue.periode.cle}
            libelle={vue.periode.libelle}
            du={vue.periode.du}
            au={vue.periode.au}
            base={{ chemin: `/${contexte.locale}/nova/clients`, siteId: contexte.siteId }}
          />
          {vue.manqueVentes === '' ? null : <p className="m-0 text-sm text-[var(--color-ink-soft)]">{vue.manqueVentes}</p>}
          <ClientsNova repartition={vue.clients} valeur={vue.valeurClient} devise={vue.devise} mention={MENTION_VALEUR} />
          <CohortesClientsNova cohortes={vue.ventes.cohortes} source={vue.ventes.source} devise={vue.devise} />
          <ModelesNova lignes={vue.modeles} devise={vue.devise} explications={MODELES} />
          <ParcoursNova phrases={vue.parcours} mention={MENTION_PARCOURS} />
          <AudiencesNova audiences={vue.audiences} />
        </>
      )}
    </CadreNova>
  )
}
