'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, CardBody, Field, Input, Notice, Textarea } from '@/components/ui'

/**
 * Ajouter son site, et le voir s'analyser.
 *
 * C'est le premier écran du produit, et le seul que tout le monde traverse. Deux partis pris
 * y tiennent tout.
 *
 * **L'analyse avance par tranches, et cela se voit.** Cinquante pages visitées poliment
 * demandent une à trois minutes. Au lieu d'un sablier — pendant lequel on se demande si
 * quelque chose se passe, puis si quelque chose a planté —, chaque appel rend quelques pages
 * de plus et le compteur bouge. C'est plus honnête, et c'est aussi la seule forme qui
 * survive aux limites de durée d'une requête.
 *
 * **Une tranche qui échoue n'arrête rien.** Chaque appel est indépendant : on réessaie une
 * fois, et si le serveur d'en face ne répond décidément pas, on le dit sans perdre ce qui a
 * déjà été trouvé.
 *
 * **Une analyse abandonnée se reprend.** C'est le navigateur qui fait avancer les tranches :
 * fermer l'onglet interrompt donc l'exploration, et rien ne la relance tout seul. La
 * première version n'en disait rien et n'offrait aucun bouton — un audit interrompu restait
 * « en cours » pour toujours, et il fallait ressaisir l'adresse pour le débloquer. Le cas
 * s'est produit en production avant d'être vu ici. L'écran le dit maintenant avant de
 * lancer, et propose de reprendre là où l'on s'était arrêté.
 */

export type SiteVu = {
  id: string
  host: string
  label: string
  dernierAudit: {
    id: string
    status: string
    pagesCrawled: number
    seoScore: number | null
    geoScore: number | null
  } | null
}

type Avancement = { auditId: string; pagesCrawled: number; maxPages: number; encore: boolean }

const ETATS: Record<string, string> = {
  pending: 'en attente',
  running: 'en cours',
  done: 'terminée',
  failed: 'interrompue',
}

export function SiteBoard({
  sites,
  prefill,
  locale,
}: {
  sites: readonly SiteVu[]
  /** Adresse saisie sur la page d'accueil, portée jusqu'ici pour ne pas la retaper. */
  prefill: string
  locale: string
}) {
  const [url, setUrl] = useState(prefill)
  const [about, setAbout] = useState('')
  const [etat, setEtat] = useState<'idle' | 'busy'>('idle')
  const [erreur, setErreur] = useState<string | null>(null)
  const [avancement, setAvancement] = useState<Avancement | null>(null)
  /** L'analyse qu'on est en train de reprendre, pour désigner la bonne carte. */
  const [reprise, setReprise] = useState<string | null>(null)

  // Arrête la boucle si la personne quitte l'écran : rien ne sert de continuer à appeler
  // pour un affichage que plus personne ne regarde.
  const vivant = useRef(true)
  useEffect(() => {
    vivant.current = true
    return () => {
      vivant.current = false
    }
  }, [])

  const avancer = useCallback(async (auditId: string) => {
    let echecs = 0
    for (let tour = 0; tour < 200 && vivant.current; tour += 1) {
      const response = await fetch(`/api/audits/${auditId}/avancer`, { method: 'POST' })
      const body = (await response.json().catch(() => null)) as
        | (Avancement & { message?: string })
        | null
      if (body === null || !response.ok) {
        echecs += 1
        // Une tranche peut échouer sur un serveur lent : on réessaie une fois avant d'abandonner.
        if (echecs >= 2) {
          setErreur(body?.message ?? "L'analyse s'est interrompue. Relancez-la quand vous voulez.")
          return
        }
        continue
      }
      echecs = 0
      setAvancement(body)
      if (!body.encore) return
    }
  }, [])

  /**
   * Reprend une analyse laissée en plan.
   *
   * Le serveur rend le même audit tant qu'il n'est pas terminé : reprendre ne consomme donc
   * pas un audit de plus dans l'offre, et ne perd pas les pages déjà relevées.
   */
  async function reprendre(auditId: string) {
    if (etat === 'busy') return
    setEtat('busy')
    setErreur(null)
    setAvancement(null)
    setReprise(auditId)
    await avancer(auditId)
    setEtat('idle')
    setReprise(null)
    window.location.assign(`/${locale}/visibilite`)
  }

  async function envoyer() {
    const adresse = url.trim()
    if (adresse === '' || etat === 'busy') return
    setEtat('busy')
    setErreur(null)
    setAvancement(null)

    const response = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: adresse, ...(about.trim() === '' ? {} : { about: about.trim() }) }),
    })
    const body = (await response.json().catch(() => null)) as
      | { auditId?: string; message?: string }
      | null
    if (body === null || !response.ok || body.auditId === undefined) {
      setErreur(body?.message ?? "Ce site n'a pas pu être ajouté.")
      setEtat('idle')
      return
    }

    await avancer(body.auditId)
    setEtat('idle')
    // Les pages relevées sont en base : on recharge pour que la liste dise la vérité.
    window.location.assign(`/${locale}/visibilite`)
  }

  const progression =
    avancement === null
      ? 0
      : Math.min(100, Math.round((avancement.pagesCrawled / Math.max(1, avancement.maxPages)) * 100))

  return (
    <div className="grid gap-6">
      <Card>
        <CardBody>
          <h2 className="m-0 text-lg font-semibold">Analyser un site</h2>
          <p className="mt-2 mb-5 text-sm text-[var(--color-ink-soft)]">
            Entrez son adresse. Nous lisons vos pages comme le ferait un moteur — rien n’est
            modifié chez vous, et aucun accès ne vous est demandé. Gardez cette page ouverte
            pendant l’analyse : c’est elle qui la fait avancer, et la fermer la met en pause.
          </p>

          <div className="grid gap-4">
            <Field label="Adresse du site" hint="Par exemple https://monsite.ch">
              <Input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://monsite.ch"
                disabled={etat === 'busy'}
              />
            </Field>
            <Field
              label="Ce que vous faites, en une phrase"
              hint="Facultatif, mais c’est ce qui évite à l’équipe de vous écrire des généralités."
            >
              <Textarea
                rows={2}
                value={about}
                maxLength={500}
                onChange={(event) => setAbout(event.target.value)}
                placeholder="Bougies artisanales coulées à la main en Gruyère."
                disabled={etat === 'busy'}
              />
            </Field>

            {erreur !== null ? <Notice tone="critical">{erreur}</Notice> : null}

            {avancement !== null ? (
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-[var(--color-ink-soft)]">
                    {avancement.pagesCrawled} page{avancement.pagesCrawled > 1 ? 's' : ''} analysée
                    {avancement.pagesCrawled > 1 ? 's' : ''}
                  </span>
                  <span className="text-[var(--color-ink-faint)]">
                    {avancement.encore ? 'analyse en cours…' : 'terminée'}
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-line)]">
                  <div
                    className="h-full rounded-[var(--radius-pill)] transition-[width] duration-500"
                    style={{ width: `${Math.max(4, progression)}%`, background: 'var(--gradient-cta)' }}
                  />
                </div>
              </div>
            ) : null}

            <Button
              onClick={() => void envoyer()}
              disabled={etat === 'busy' || url.trim() === ''}
              className="justify-self-start"
            >
              {etat === 'busy' ? 'Analyse en cours…' : 'Analyser mon site'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {sites.length === 0 ? null : (
        <div className="grid gap-4">
          <h2 className="m-0 text-lg font-semibold">Vos sites</h2>
          {sites.map((site) => (
            <Card key={site.id}>
              <CardBody>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="m-0 text-base font-semibold">{site.label}</h3>
                  <span className="text-sm text-[var(--color-ink-faint)]">{site.host}</span>
                </div>
                <p className="mt-2 mb-0 text-sm text-[var(--color-ink-soft)]">
                  {site.dernierAudit === null
                    ? 'Aucune analyse pour l’instant.'
                    : `Analyse ${ETATS[site.dernierAudit.status] ?? site.dernierAudit.status} — ${site.dernierAudit.pagesCrawled} page${site.dernierAudit.pagesCrawled > 1 ? 's' : ''} relevée${site.dernierAudit.pagesCrawled > 1 ? 's' : ''}.`}
                </p>
                {/*
                  Les deux notes ensemble, jamais l'une sans l'autre : c'est leur écart qui
                  dit quelque chose. Une note absente s'affiche comme absente, pas comme un
                  zéro, qui se lirait comme un résultat.
                */}
                {/*
                  Une analyse interrompue se reprend d'ici. Sans ce bouton, la carte disait
                  « en cours » indéfiniment et le seul recours était de ressaisir l'adresse —
                  ce qui a l'air de tout recommencer alors que rien n'est perdu.
                */}
                {site.dernierAudit !== null &&
                (site.dernierAudit.status === 'running' ||
                  site.dernierAudit.status === 'pending' ||
                  (site.dernierAudit.status === 'failed' && site.dernierAudit.pagesCrawled > 0)) ? (
                  <div className="mt-3">
                    <Button
                      variant="secondary"
                      onClick={() => void reprendre(site.dernierAudit?.id ?? '')}
                      disabled={etat === 'busy'}
                    >
                      {reprise === site.dernierAudit.id
                        ? 'Reprise en cours…'
                        : site.dernierAudit.status === 'failed'
                          ? 'Terminer l’analyse'
                          : 'Reprendre l’analyse'}
                    </Button>
                    <p className="mt-2 mb-0 text-sm text-[var(--color-ink-faint)]">
                      {site.dernierAudit.status === 'failed'
                        ? `Les ${site.dernierAudit.pagesCrawled} pages déjà lues suffisent à vous donner vos deux notes.`
                        : `Elle repartira des ${site.dernierAudit.pagesCrawled} pages déjà lues.`}
                    </p>
                  </div>
                ) : null}

                {site.dernierAudit?.status === 'done' ? (
                  <p className="mt-3 mb-0 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <span>
                      Référencement :{' '}
                      <strong>
                        {site.dernierAudit.seoScore === null
                          ? '—'
                          : `${site.dernierAudit.seoScore}/100`}
                      </strong>
                    </span>
                    <span>
                      Moteurs IA :{' '}
                      <strong>
                        {site.dernierAudit.geoScore === null
                          ? '—'
                          : `${site.dernierAudit.geoScore}/100`}
                      </strong>
                    </span>
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
