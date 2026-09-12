'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardBody, Notice, Textarea } from '@/components/ui'
import {
  ANGLE_FAMILY_LABEL,
  DAY_LABEL,
  FORMAT_LABEL,
  OBJECTIVE_LABEL,
  type LaunchKit,
} from '@/lib/marketing'

/**
 * Kit de lancement.
 *
 * Trois partis pris. Le moteur propose, le créateur dispose : chaque texte est modifiable
 * avant d'être approuvé, et rien n'est programmé ni publié depuis cet écran. Les angles
 * peuvent être écartés d'un clic, parce qu'un angle qui ne ressemble pas au créateur
 * abîmerait tout ce qui en découle. Et ce qui n'existe pas encore n'est pas montré comme
 * un bouton grisé : il vaut mieux un écran honnête qu'un catalogue de promesses.
 */

export type KitState = {
  id: string
  content: LaunchKit
  approvedAt: string | null
  sentToSocialAt: string | null
  creditsSpent: number
}

export function LaunchKitBoard({
  projectId,
  initialKit,
  engineReady,
  credits,
  estimatedCredits,
  socialLinked,
}: {
  projectId: string
  initialKit: KitState | null
  engineReady: boolean
  credits: number
  estimatedCredits: number
  /** Un espace Postelya est relié : sans lui, l'envoi n'a nulle part où aller. */
  socialLinked: boolean
}) {
  const [kit, setKit] = useState(initialKit)
  const [busy, setBusy] = useState<
    'creation' | 'enregistrement' | 'approbation' | 'envoi' | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  async function create() {
    setBusy('creation')
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/marketing`, { method: 'POST' })
    const body = (await response.json()) as { message?: string; kit?: KitState }
    setBusy(null)
    if (!response.ok || body.kit === undefined) {
      setError(body.message ?? "La préparation n'a pas abouti.")
      return
    }
    setKit(body.kit)
    setDirty(false)
  }

  async function save(content: LaunchKit) {
    if (kit === null) return
    setBusy('enregistrement')
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/marketing`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kitId: kit.id, content }),
    })
    const body = (await response.json()) as { message?: string }
    setBusy(null)
    if (!response.ok) {
      setError(body.message ?? "L'enregistrement n'a pas abouti.")
      return
    }
    setDirty(false)
  }

  async function approve() {
    if (kit === null) return
    setBusy('approbation')
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/marketing`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kitId: kit.id }),
    })
    const body = (await response.json()) as { message?: string }
    setBusy(null)
    if (!response.ok) {
      setError(body.message ?? "L'approbation n'a pas abouti.")
      return
    }
    setKit({ ...kit, approvedAt: new Date().toISOString() })
  }

  /**
   * Dépose la semaine dans l'espace Postelya du créateur.
   *
   * Le bouton reste actif après un envoi réussi : Postelya refuse de créer deux fois la
   * même publication, donc recliquer ne fait pas de doublon. Le griser priverait le
   * créateur du moyen le plus simple de réparer un dépôt à moitié abouti.
   */
  async function send() {
    if (kit === null) return
    setBusy('envoi')
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/marketing/envoi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kitId: kit.id }),
    })
    const body = (await response.json()) as {
      message?: string
      created?: number
      alreadyThere?: number
      workspace?: string
    }
    setBusy(null)
    if (!response.ok) {
      setError(body.message ?? "L'envoi n'a pas abouti.")
      return
    }
    const created = body.created ?? 0
    setSent(
      created === 0
        ? `Ces publications étaient déjà dans ${body.workspace ?? 'votre espace'}.`
        : `${created} publication(s) déposées en brouillon dans ${body.workspace ?? 'votre espace'}.`,
    )
    setKit({ ...kit, sentToSocialAt: new Date().toISOString() })
  }

  function edit(next: LaunchKit) {
    if (kit === null) return
    setKit({ ...kit, content: next })
    setDirty(true)
  }

  if (kit === null) {
    return (
      <div className="grid gap-6">
        {error !== null ? <Notice tone="critical">{error}</Notice> : null}
        <Card>
          <CardBody className="grid gap-4">
            <h2 className="m-0 text-lg font-semibold">Votre application est prête.</h2>
            <p className="m-0 text-[var(--color-ink-soft)]">
              Préparons maintenant son lancement. À partir de ce que vous avez déjà décrit —
              le problème, votre clientèle, votre proposition de valeur — nous préparons vos
              bénéfices principaux, trois angles marketing, sept idées de publications et le
              calendrier de votre première semaine. Vous relisez, vous corrigez, vous gardez.
            </p>
            {engineReady ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={busy !== null} onClick={() => void create()}>
                  {busy === 'creation' ? 'Préparation en cours…' : 'Préparer mon lancement'}
                </Button>
                <span className="text-xs text-[var(--color-ink-soft)]">
                  Environ {estimatedCredits} crédits. Il vous en reste {credits}.
                </span>
              </div>
            ) : (
              <Notice tone="neutral">
                Le module marketing n’est pas encore activé sur cette installation. Votre
                projet reste accessible.
              </Notice>
            )}
          </CardBody>
        </Card>
      </div>
    )
  }

  const { content } = kit

  return (
    <div className="grid gap-8">
      {error !== null ? <Notice tone="critical">{error}</Notice> : null}
      {sent !== null ? (
        <Notice tone="positive" title="Déposé en brouillon">
          {sent} Rien n’est publié : relisez et programmez depuis Postelya.
        </Notice>
      ) : null}
      {kit.approvedAt !== null && !socialLinked ? (
        <Notice tone="neutral" title="Envoyer vers vos réseaux">
          Reliez votre espace Postelya depuis l’écran Connexions pour y déposer cette
          semaine en brouillon.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {kit.approvedAt === null ? (
            <Badge tone="caution">À relire</Badge>
          ) : (
            <Badge tone="positive">✓ Approuvé</Badge>
          )}
          {dirty ? <Badge tone="neutral">Modifications non enregistrées</Badge> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy !== null || !dirty}
            onClick={() => void save(content)}
          >
            {busy === 'enregistrement' ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Button disabled={busy !== null || kit.approvedAt !== null} onClick={() => void approve()}>
            {busy === 'approbation' ? 'Approbation…' : 'Approuver'}
          </Button>
          {/*
            L'envoi n'apparaît qu'une fois la semaine approuvée : c'est le geste par lequel
            le créateur dit avoir tout relu, et on ne dépose que ce qui a été relu.
          */}
          {kit.approvedAt !== null && socialLinked ? (
            <Button variant="secondary" disabled={busy !== null} onClick={() => void send()}>
              {busy === 'envoi'
                ? 'Envoi…'
                : kit.sentToSocialAt === null
                  ? 'Envoyer vers Postelya'
                  : 'Renvoyer vers Postelya'}
            </Button>
          ) : null}
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
          Ce que votre application apporte
        </h2>
        <Card>
          <CardBody className="grid gap-3">
            <p className="m-0 font-medium">{content.valueProposition}</p>
            <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-[var(--color-ink-soft)]">
              {content.benefits.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
          Vos angles marketing
        </h2>
        <p className="mb-3 text-sm text-[var(--color-ink-soft)]">
          Plusieurs façons de présenter la même application. Gardez celles qui vous
          ressemblent, écartez les autres.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {content.angles.map((angle, index) => (
            <Card key={`${angle.key}-${index}`}>
              <CardBody className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="m-0 text-base font-semibold">{angle.title}</h3>
                  <Badge tone="neutral">{ANGLE_FAMILY_LABEL[angle.key]}</Badge>
                </div>
                <p className="m-0 text-sm text-[var(--color-ink-soft)]">{angle.promise}</p>
                <p className="m-0 text-sm italic">« {angle.example} »</p>
                <div>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      edit({
                        ...content,
                        angles: content.angles.filter((_, position) => position !== index),
                      })
                    }
                  >
                    Écarter cet angle
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
          Idées de publications
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {content.ideas.map((idea, index) => (
            <Card key={`${idea.title}-${index}`}>
              <CardBody className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="m-0 text-base font-semibold">{idea.title}</h3>
                  <Badge tone="neutral">{FORMAT_LABEL[idea.format]}</Badge>
                </div>
                <p className="m-0 text-sm font-medium">{idea.hook}</p>
                <p className="m-0 text-sm text-[var(--color-ink-soft)]">{idea.description}</p>
                <p className="m-0 text-xs text-[var(--color-ink-faint)]">À prendre en photo ou en vidéo : {idea.visual}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
          Votre première semaine
        </h2>
        <p className="mb-3 text-sm text-[var(--color-ink-soft)]">
          Chaque texte est modifiable. Rien n’est programmé ni publié : aucun réseau social
          n’est relié pour l’instant.
        </p>
        <div className="grid gap-4">
          {content.week.map((post, index) => (
            <Card key={`${post.day}-${post.time}-${index}`}>
              <CardBody className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="m-0 text-base font-semibold">
                    {DAY_LABEL[post.day] ?? 'Jour'} à {post.time}
                  </h3>
                  <Badge tone="brand">{ANGLE_FAMILY_LABEL[post.angleKey]}</Badge>
                  <Badge tone="neutral">{OBJECTIVE_LABEL[post.objective]}</Badge>
                  <Badge tone="neutral">{FORMAT_LABEL[post.format]}</Badge>
                </div>
                <Textarea
                  value={post.caption}
                  aria-label={`Texte de la publication du ${DAY_LABEL[post.day] ?? 'jour'}`}
                  onChange={(event) =>
                    edit({
                      ...content,
                      week: content.week.map((entry, position) =>
                        position === index ? { ...entry, caption: event.target.value } : entry,
                      ),
                    })
                  }
                />
                <p className="m-0 text-sm">{post.cta}</p>
                {post.hashtags.length > 0 ? (
                  <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                    {post.hashtags.map((tag) => `#${tag}`).join(' ')}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <p className="text-xs text-[var(--color-ink-faint)]">
        Préparé le {new Date(kit.approvedAt ?? Date.now()).toLocaleDateString('fr-CH')} ·{' '}
        {kit.creditsSpent} crédits.
      </p>
    </div>
  )
}
