import { lireFicheClient } from '@/server/lina/service'
import { Badge, Card, CardBody } from '@/components/ui'
import { CadreLina, ouvrirLina } from '../../cadre'

/**
 * La fiche d'un client, telle que Lina la connaît : des dates, des montants, des segments.
 * Son nom, son courriel et son adresse se lisent dans l'outil de la boutique, par le lien.
 * Aucun crédit, aucun modèle.
 */

const MOT_CONSENTEMENT: Record<string, string> = {
  oui: 'Accepte les emails marketing',
  non: 'N’accepte pas les emails marketing',
  'sans-email': 'Pas d’adresse email',
  inconnu: 'Inconnu : à vérifier dans votre outil d’envoi',
}

const MOT_SMS: Record<string, string> = {
  oui: 'Accepte les SMS marketing',
  non: 'N’accepte pas les SMS marketing',
  'sans-telephone': 'Pas de numéro de téléphone',
  inconnu: 'Inconnu : Shopify ne l’a pas donné',
}

function argent(cents: number | null, devise: string): string {
  if (cents === null) return '—'
  const valeur = cents / 100
  return `${devise} ${new Intl.NumberFormat('fr-CH', { maximumFractionDigits: Math.abs(valeur) < 100 ? 2 : 0 }).format(valeur)}`.trim()
}

function date(iso: string | null): string {
  return iso === null ? '—' : iso.split('-').reverse().join('.')
}

function Ligne({ label, valeur, note }: { label: string; valeur: string; note?: string }) {
  return (
    <div className="grid gap-0.5 border-b border-[var(--color-line)] pb-2">
      <dt className="text-[11px] text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 text-sm">
        {valeur}
        {note === undefined ? null : <span className="block text-[11px] text-[var(--color-ink-faint)]">{note}</span>}
      </dd>
    </div>
  )
}

export default async function FicheClientLinaPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; ref: string }>
  searchParams: Promise<{ siteId?: string }>
}) {
  const [{ ref }, demande] = await Promise.all([params, searchParams])
  const contexte = await ouvrirLina(params, demande.siteId)
  const { locale, user, siteId, ouvert } = contexte
  const fiche = ouvert ? await lireFicheClient(user.id, decodeURIComponent(ref)) : null
  const retour = `/${locale}/lina/segments${siteId === '' ? '' : `?siteId=${siteId}`}`
  return (
    <CadreLina contexte={contexte} courant="segments" onglets={ouvert}>
      {!ouvert ? null : fiche === null ? (
        <Card>
          <CardBody>
            <p className="m-0 text-sm">Ce client n’est pas dans la base lue par Lina. <a href={retour}>Retour aux segments</a></p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-base font-semibold">{fiche.numero}</h2>
              {fiche.lien === null ? null : (
                <a href={fiche.lien.href} target="_blank" rel="noopener noreferrer" className="text-sm font-medium">
                  {fiche.lien.libelle}
                </a>
              )}
            </div>
            <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
              Lina ne connaît ni le nom, ni le courriel, ni l’adresse de ce client
              {fiche.lien === null ? '.' : ` : ouvrez sa fiche dans ${fiche.lien.libelle.replace(/^Ouvrir dans | ↗$/gu, '')} pour les voir.`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={fiche.statut.startsWith('Risque') ? 'caution' : fiche.statut === 'Actif' ? 'positive' : 'neutral'}>{fiche.statut}</Badge>
              {fiche.segments.map((segment) => (
                <Badge key={segment}>{segment}</Badge>
              ))}
            </div>
            <dl className="m-0 mt-4 grid gap-2 sm:grid-cols-2 sm:gap-x-6">
              <Ligne label="Première commande" valeur={date(fiche.premiereCommande)} />
              <Ligne
                label="Dernière commande"
                valeur={date(fiche.derniereCommande)}
                note={fiche.joursDepuis === null ? undefined : `il y a ${fiche.joursDepuis} jour${fiche.joursDepuis > 1 ? 's' : ''}`}
              />
              <Ligne label="Nombre de commandes" valeur={String(fiche.commandes)} />
              <Ligne label="Chiffre d’affaires généré (observé)" valeur={argent(fiche.caCents, fiche.devise)} />
              <Ligne label="Panier moyen" valeur={argent(fiche.panierMoyenCents, fiche.devise)} />
              <Ligne
                label="Fréquence d’achat"
                valeur={fiche.rythmeJours === null ? '—' : `environ tous les ${fiche.rythmeJours} jours`}
                note={fiche.rythmeJours === null ? 'Il faut deux commandes au moins.' : undefined}
              />
              <Ligne label="Produit le plus acheté" valeur={fiche.produitPrincipal ?? '—'} />
              <Ligne
                label="Valeur client estimée"
                valeur={argent(fiche.valeurEstimeeCents, fiche.devise)}
                note={
                  fiche.valeurEstimeeCents === null
                    ? 'Pas assez d’historique pour l’estimer.'
                    : 'Estimation : son panier moyen × ses commandes par an × la durée de vie estimée de vos clients. Pas une garantie.'
                }
              />
              <Ligne label="Consentement marketing (email)" valeur={MOT_CONSENTEMENT[fiche.consentement] ?? fiche.consentement} />
              <Ligne label="Consentement SMS" valeur={MOT_SMS[fiche.consentementSms] ?? fiche.consentementSms} />
            </dl>
            <p className="mt-4 mb-0 text-xs">
              <a href={retour}>← Retour aux segments</a>
            </p>
          </CardBody>
        </Card>
      )}
    </CadreLina>
  )
}
