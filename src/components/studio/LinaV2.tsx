import { Badge, Card, CardBody } from '@/components/ui'
import type { AnalyseCommandes, ProduitAnalyse } from '@/server/lina/commandes'
import type { ResultatVu, VerdictAB } from '@/server/lina/resultats'
import type { AudiencePub, NiveauRisque, PalierFidelite, ReachatProduit, Scenario, SuggestionProduit, ValeurClient } from '@/server/lina/valeur'
import { CopierTexte } from './CopierTexte'
import { DelegationOria } from './DelegationOria'
import { SupprimerResultatLina } from './ResultatsLina'
import type { TransmissionLina } from './Lina'

/**
 * Les blocs de la V2 de Lina : produits et réachat, valeur client, résultats de campagnes.
 *
 * Même règle que la V1 : rien ici ne vient d'un modèle, et chaque chiffre dit s'il est
 * observé ou estimé.
 */

function nombre(valeur: number, decimales = 0): string {
  return new Intl.NumberFormat('fr-CH', { maximumFractionDigits: decimales }).format(valeur)
}

function argent(cents: number | null, devise: string): string {
  if (cents === null) return '—'
  const valeur = cents / 100
  return `${devise} ${nombre(valeur, Math.abs(valeur) < 100 ? 2 : 0)}`.trim()
}

function pourcent(part: number | null): string {
  return part === null ? '—' : `${nombre(part * 100, part < 0.1 ? 1 : 0)} %`
}

function Chiffre({ label, valeur }: { label: string; valeur: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-[11px] text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="m-0 text-sm font-medium tabular-nums">{valeur}</dd>
    </div>
  )
}

/** Tant que les commandes ne sont pas lues, la page le dit plutôt que d'afficher des vides. */
export function CommandesAttenteLina({ enCours, message }: { enCours: boolean; message: string }) {
  return (
    <Card>
      <CardBody>
        <p className="m-0 text-sm leading-relaxed">
          {enCours
            ? 'Lina lit vos commandes chez Shopify. Les produits, le réachat et les cohortes apparaîtront dans quelques minutes.'
            : 'Les commandes n’ont pas encore été lues. Relancez l’analyse depuis le tableau de bord.'}
        </p>
        {message === '' ? null : <p className="mt-2 mb-0 text-xs leading-relaxed text-[var(--color-critical)]">{message}</p>}
      </CardBody>
    </Card>
  )
}

// ── Produits et réachat ─────────────────────────────────────────────────────

export function ReachatGlobalLina({ analyse }: { analyse: AnalyseCommandes }) {
  const r = analyse.reachat
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Quand les clients reviennent</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
          Sur {nombre(analyse.commandes)} commandes lues depuis le {analyse.depuis.split('-').reverse().join('.')}
          {analyse.tronque ? ' (lecture partielle)' : ''}. Observé.
        </p>
        {r.medianeJours === null ? (
          <p className="mt-3 mb-0 text-sm text-[var(--color-ink-soft)]">Trop peu de deuxièmes commandes pour lire un délai.</p>
        ) : (
          <>
            <p className="mt-3 mb-0 text-sm leading-relaxed">
              La deuxième commande arrive en général <strong>{r.medianeJours} jours</strong> après la première (la moitié des cas entre {r.p25Jours} et {r.p75Jours} jours).
            </p>
            <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {r.sous.map((un) => (
                <Chiffre key={un.jours} label={`recommandent sous ${un.jours} j`} valeur={pourcent(un.part)} />
              ))}
            </dl>
            <p className="mt-2 mb-0 text-[11px] text-[var(--color-ink-faint)]">Sur {nombre(r.base)} clients arrivés il y a plus de six mois.</p>
          </>
        )}
      </CardBody>
    </Card>
  )
}

export function ProduitsReachatLina({ reachat, versTableau }: { reachat: readonly ReachatProduit[]; versTableau: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Produits qui se rachètent</h2>
        {reachat.length === 0 ? (
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">Aucun produit n’a encore été racheté par au moins cinq clients.</p>
        ) : (
          <ul className="m-0 mt-3 grid list-none gap-3 p-0">
            {reachat.slice(0, 8).map((produit, rang) => (
              <li key={produit.ref} className="border-b border-[var(--color-line)] pb-3 text-sm leading-relaxed">
                <p className="m-0">{produit.texte}</p>
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
                  {nombre(produit.reacheteurs)} sur {nombre(produit.acheteurs)} acheteurs l’ont racheté ({pourcent(produit.part)}) · médiane {produit.mediane} jours
                </p>
                {/* Les deux premiers ont leur campagne sur le tableau de bord. */}
                {rang < 2 ? (
                  <a href={`${versTableau}#campagne-reachat-${produit.ref}`} className="mt-1 inline-block text-xs font-medium">
                    Créer une campagne de réachat →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

export function SuggestionsLina({
  titre,
  sousTitre,
  liste,
  prefixe,
  versTableau,
}: {
  titre: string
  sousTitre: string
  liste: readonly SuggestionProduit[]
  prefixe: 'cross-sell' | 'upsell'
  versTableau: string
}) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">{titre}</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">{sousTitre}</p>
        {liste.length === 0 ? (
          <p className="mt-3 mb-0 text-sm text-[var(--color-ink-soft)]">Rien d’assez fréquent pour en tirer une règle (au moins cinq clients).</p>
        ) : (
          <ul className="m-0 mt-3 grid list-none gap-3 p-0">
            {liste.slice(0, 6).map((suggestion, rang) => (
              <li key={`${suggestion.de.ref}-${suggestion.vers.ref}`} className="border-b border-[var(--color-line)] pb-3 text-sm leading-relaxed">
                <p className="m-0">{suggestion.texte}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {suggestion.ensemble ? <Badge tone="brand">Aussi achetés ensemble : offre groupée possible</Badge> : null}
                  <Badge>Campagne email</Badge>
                  <Badge>Bloc de recommandation</Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="text-[11px] break-all">{suggestion.requeteShopify}</code>
                  <CopierTexte texte={suggestion.requeteShopify} />
                </div>
                {rang < (prefixe === 'cross-sell' ? 2 : 1) ? (
                  <a href={`${versTableau}#campagne-${prefixe}-${suggestion.de.ref}-${suggestion.vers.ref}`} className="mt-1 inline-block text-xs font-medium">
                    Voir la campagne →
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

export function TopProduitsLina({ produits, devise }: { produits: readonly ProduitAnalyse[]; devise: string }) {
  if (produits.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Produits qui font le chiffre</h2>
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {produits.slice(0, 10).map((produit) => (
            <li key={produit.ref} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line)] pb-2 text-sm">
              <span className="min-w-0">{produit.titre}</span>
              <span className="text-xs tabular-nums text-[var(--color-ink-soft)]">
                {argent(produit.caCents, devise)} · {nombre(produit.acheteurs)} acheteurs · {pourcent(produit.acheteurs === 0 ? null : produit.reacheteurs / produit.acheteurs)} rachètent
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

// ── Valeur client ───────────────────────────────────────────────────────────

export function ValeurLina({ valeur, devise, cac }: { valeur: ValeurClient; devise: string; cac: number | null }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Valeur client</h2>
        <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Chiffre label="Observée : dépensé jusqu’ici" valeur={argent(valeur.observeeCents, devise)} />
          <Chiffre label="Estimée sur la durée de vie" valeur={argent(valeur.estimeeCents, devise)} />
          <Chiffre label="Commandes par an" valeur={valeur.commandesParAn === null ? '—' : nombre(valeur.commandesParAn, 2)} />
          <Chiffre label="Attrition annuelle" valeur={pourcent(valeur.attritionAnnuelle)} />
        </dl>
        <p className="mt-3 mb-0 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          {valeur.estimeeCents === null
            ? `Estimation impossible pour l’instant : ${nombre(valeur.base)} clients arrivés il y a plus d’un an, il en faut 50.`
            : `${valeur.methode} Durée de vie retenue : ${valeur.dureeVieAns} ans. Une estimation, pas une promesse.`}
        </p>
        {cac !== null && valeur.estimeeCents !== null ? (
          <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">
            Selon Nova, un nouveau client coûte {devise} {nombre(cac, 2)} en publicité sur 30 jours.
          </p>
        ) : null}
      </CardBody>
    </Card>
  )
}

export function RisquesLina({ risques, devise, versSegment }: { risques: readonly NiveauRisque[]; devise: string; versSegment: string }) {
  if (risques.every((risque) => risque.clients === 0)) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Clients qui risquent de partir</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">Risque estimé à partir du rythme de chaque client : un comportement inhabituel, pas une certitude.</p>
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {risques.map((risque) => (
            <li key={risque.niveau} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={risque.niveau === 'eleve' ? 'critical' : 'caution'}>Risque {risque.niveau === 'eleve' ? 'élevé' : 'moyen'}</Badge>
              <span>
                {nombre(risque.clients)} clients · {argent(risque.caCents, devise)} de CA historique — {risque.libelle.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
        <a href={versSegment} className="mt-3 inline-block text-xs font-medium">
          Voir les clients à risque →
        </a>
      </CardBody>
    </Card>
  )
}

export function FideliteLina({ paliers, devise }: { paliers: readonly PalierFidelite[]; devise: string }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Programme de fidélité proposé</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">Des paliers tirés de votre base. Les avantages proposés reconnaissent le client plutôt que de lui faire une remise.</p>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0 sm:grid-cols-2">
          {paliers.map((palier) => (
            <li key={palier.cle} className="rounded-[var(--radius-control)] border border-[var(--color-line)] p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-sm">{palier.nom}</strong>
                <span className="text-sm tabular-nums">{nombre(palier.clients)} clients</span>
              </div>
              <p className="mt-1 mb-0 text-[11px] text-[var(--color-ink-soft)]">{palier.regle}</p>
              <p className="mt-2 mb-0 text-xs">
                {argent(palier.caCents, devise)} · {pourcent(palier.partCa)} du CA
              </p>
              <p className="mt-2 mb-0 text-xs text-[var(--color-ink-soft)]">{palier.avantage}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

export function AudiencesLina({ audiences, transmission }: { audiences: readonly AudiencePub[]; transmission?: TransmissionLina }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Audiences publicitaires</h2>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          Aucune liste ne quitte Evoliia. Créez le segment dans Shopify : ses canaux Facebook &amp; Instagram et Google peuvent le synchroniser, avec
          votre accord et selon la base légale qui s’applique à vos clients. Lina transmet à MIRA ou à Naya la taille et l’usage de l’audience.
        </p>
        {audiences.length === 0 ? (
          <p className="mt-3 mb-0 text-sm text-[var(--color-ink-soft)]">Aucun segment n’est encore assez grand (100 clients au moins).</p>
        ) : (
          <ul className="m-0 mt-3 grid list-none gap-3 p-0">
            {audiences.map((audience) => (
              <li key={audience.cle} className="border-b border-[var(--color-line)] pb-3 text-sm">
                <p className="m-0">
                  <strong>{audience.nom}</strong> · {nombre(audience.clients)} clients
                </p>
                <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">{audience.usage}</p>
                {transmission === undefined ? null : (
                  <DelegationOria
                    cle={`audience-${audience.cle}`}
                    siteId={transmission.siteId}
                    locale={transmission.locale}
                    destinataires={[{ agent: audience.agent, pour: 'l’utiliser dans les campagnes' }]}
                    cout={{ min: transmission.cout, max: transmission.cout }}
                    versConversation={transmission.versConversation}
                    route="/api/lina/deleguer"
                    expediteur="Lina"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

export function ScenariosLina({ scenarios }: { scenarios: readonly Scenario[] }) {
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Scénarios automatisés, préparés</h2>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          Lina ne déclenche aucun envoi : chaque scénario s’active dans Shopify, où vous gardez la main. Le nombre indique qui serait concerné aujourd’hui.
        </p>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {scenarios.map((scenario) => (
            <li key={scenario.cle} className="border-b border-[var(--color-line)] pb-3 text-sm leading-relaxed">
              <p className="m-0">
                <span className="font-semibold">SI</span> {scenario.si} <span className="font-semibold">ALORS</span> {scenario.alors}
              </p>
              <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
                {scenario.concernes === null ? '' : `${nombre(scenario.concernes)} concernés aujourd’hui · `}Où : {scenario.ou}
              </p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

// ── Résultats de campagnes ──────────────────────────────────────────────────

export function ResultatsTableLina({ resultats, devise }: { resultats: readonly ResultatVu[]; devise: string }) {
  if (resultats.length === 0) {
    return (
      <Card>
        <CardBody>
          <h2 className="m-0 text-base font-semibold">Résultats CRM</h2>
          <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">Aucun résultat saisi pour l’instant.</p>
        </CardBody>
      </Card>
    )
  }
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Résultats CRM</h2>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {resultats.map((r) => (
            <li key={r.id} className="border-b border-[var(--color-line)] pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-sm">
                  {r.nom}
                  {r.variante === '' ? '' : ` · variante ${r.variante}`}
                </strong>
                <SupprimerResultatLina id={r.id} />
              </div>
              <dl className="m-0 mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <Chiffre label="Envoyés" valeur={nombre(r.envoyes)} />
                <Chiffre label="Ouvertures" valeur={pourcent(r.tauxOuverture)} />
                <Chiffre label="Clics" valeur={pourcent(r.tauxClic)} />
                <Chiffre label="Conversion" valeur={pourcent(r.tauxConversion)} />
                <Chiffre label="Chiffre d’affaires" valeur={argent(r.caCents, devise)} />
                <Chiffre label="Revenu par destinataire" valeur={argent(r.revenuParDestinataireCents, devise)} />
                <Chiffre label="Désinscriptions" valeur={pourcent(r.tauxDesinscription)} />
                <Chiffre label="Envoyé le" valeur={r.envoyeLe === null ? '—' : r.envoyeLe.split('-').reverse().join('.')} />
              </dl>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

export function TestsABLina({ tests }: { tests: readonly VerdictAB[] }) {
  if (tests.length === 0) return null
  return (
    <Card>
      <CardBody>
        <h2 className="m-0 text-base font-semibold">Tests A/B</h2>
        <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
          Un gagnant n’est déclaré qu’avec au moins 100 envois par variante, 20 actions au total et 95 % de confiance.
        </p>
        <ul className="m-0 mt-3 grid list-none gap-3 p-0">
          {tests.map((test) => (
            <li key={test.groupe} className="border-b border-[var(--color-line)] pb-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{test.groupe}</strong>
                {test.gagnant === null ? <Badge>Pas de gagnant</Badge> : <Badge tone="positive">Variante {test.gagnant} gagnante</Badge>}
              </div>
              <p className="mt-1 mb-0 text-xs text-[var(--color-ink-soft)]">
                A : {pourcent(test.critere === 'conversions' ? test.a.tauxConversion : test.a.tauxClic)} · B :{' '}
                {pourcent(test.critere === 'conversions' ? test.b.tauxConversion : test.b.tauxClic)} ({test.critere})
              </p>
              <p className="mt-1 mb-0 text-xs">{test.explication}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
