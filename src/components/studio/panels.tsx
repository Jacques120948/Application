'use client'

import { useState } from 'react'
import type { AppSpec } from '@/server/spec/schema'
import type { CheckReport } from '@/server/spec/checks'
import type { PatchOperation } from '@/server/spec/patch'
import { STYLE_PRESETS } from '@/lib/style-presets'
import { DENSITIES, DENSITY_LABELS, FONT_PAIRINGS, PATTERNS, PATTERN_LABELS } from '@/lib/fonts'
import { Badge, Button, Card, CardBody, ComingSoon, Field, Input, Notice, Select } from '@/components/ui'

/**
 * Panneaux latéraux du studio.
 *
 * Ils modifient l'application **sans IA et sans crédit** (exigence 7), en passant par le
 * même moteur de patch que l'assistant : mêmes garanties de validation.
 */

export type PatchSender = (summary: string, operations: PatchOperation[]) => Promise<void>

// ─────────────────────────────── Design ──────────────────────────────────────

const COLOR_FIELDS = [
  { path: 'theme.colors.primary', label: 'Couleur principale' },
  { path: 'theme.colors.accent', label: "Couleur d'accent" },
  { path: 'theme.colors.background', label: 'Fond' },
  { path: 'theme.colors.surface', label: 'Cartes' },
  { path: 'theme.colors.text', label: 'Texte' },
] as const

export function DesignPanel({ spec, send }: { spec: AppSpec; send: PatchSender }) {
  const [busy, setBusy] = useState(false)

  async function apply(summary: string, operations: PatchOperation[]) {
    setBusy(true)
    await send(summary, operations)
    setBusy(false)
  }

  /*
   * Un style est reconnu comme « actif » quand le thème lui correspond encore trait pour
   * trait. Dès qu'une couleur est retouchée à la main, aucun style n'est surligné : c'est
   * honnête, et cela n'empêche pas d'en réappliquer un.
   */
  const activePreset = STYLE_PRESETS.find(
    (preset) => JSON.stringify(preset.theme) === JSON.stringify(spec.theme),
  )?.id

  return (
    <div className="grid gap-5">
      <Card>
        <CardBody>
          <h3 className="mt-0 text-sm font-semibold">Style</h3>
          <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
            Un style règle d&apos;un coup les couleurs, les polices, les formes et le motif de
            fond. Vous pouvez ensuite retoucher chaque détail plus bas.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={busy}
                title={preset.hint}
                onClick={() =>
                  void apply(`Style « ${preset.label} » appliqué`, [
                    { op: 'set', path: 'theme', value: preset.theme },
                  ])
                }
                className={`grid gap-2 rounded-[var(--radius-control)] border p-2.5 text-left transition ${
                  activePreset === preset.id
                    ? 'border-[var(--color-brand)] ring-2 ring-[var(--color-brand-soft)]'
                    : 'border-[var(--color-line)] hover:border-[var(--color-brand)]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 items-end gap-1 overflow-hidden rounded-[8px] p-1.5"
                  style={{ background: preset.theme.colors.background }}
                >
                  <span
                    className="h-full w-1/2 rounded-[5px]"
                    style={{
                      background: `linear-gradient(135deg, ${preset.theme.colors.primary}, ${preset.theme.colors.accent})`,
                    }}
                  />
                  <span className="grid flex-1 gap-1">
                    <span className="h-1.5 w-full rounded-full" style={{ background: preset.theme.colors.text }} />
                    <span className="h-1.5 w-2/3 rounded-full" style={{ background: preset.theme.colors.muted }} />
                  </span>
                </span>
                <span className="text-xs font-medium text-[var(--color-ink)]">{preset.label}</span>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="mt-0 text-sm font-semibold">Identité</h3>
          <div className="mt-3 grid gap-3">
            <Field label="Nom de l'application">
              <Input
                defaultValue={spec.name}
                maxLength={120}
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value !== '' && value !== spec.name) {
                    void apply('Nom modifié', [{ op: 'set', path: 'name', value }])
                  }
                }}
              />
            </Field>
            <Field label="Phrase de présentation">
              <Input
                defaultValue={spec.tagline}
                maxLength={400}
                onBlur={(event) => {
                  const value = event.target.value.trim()
                  if (value !== '' && value !== spec.tagline) {
                    void apply('Présentation modifiée', [{ op: 'set', path: 'tagline', value }])
                  }
                }}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="mt-0 text-sm font-semibold">Couleurs</h3>
          <div className="mt-3 grid gap-3">
            {COLOR_FIELDS.map((field) => (
              <label key={field.path} className="flex items-center gap-3 text-sm">
                <input
                  type="color"
                  value={readColor(spec, field.path)}
                  disabled={busy}
                  onChange={(event) =>
                    void apply(`${field.label} modifiée`, [
                      { op: 'set', path: field.path, value: event.target.value.toUpperCase() },
                    ])
                  }
                  className="h-8 w-12 cursor-pointer rounded border border-[var(--color-line)]"
                />
                <span>{field.label}</span>
              </label>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h3 className="mt-0 text-sm font-semibold">Style</h3>
          <div className="mt-3 grid gap-3">
            <Field label="Coins">
              <Select
                value={spec.theme.radius}
                onChange={(event) =>
                  void apply('Style des coins modifié', [
                    { op: 'set', path: 'theme.radius', value: event.target.value },
                  ])
                }
              >
                <option value="none">Carrés</option>
                <option value="small">Légèrement arrondis</option>
                <option value="medium">Arrondis</option>
                <option value="large">Très arrondis</option>
              </Select>
            </Field>
            <Field
              label="Polices"
              hint={FONT_PAIRINGS.find((pairing) => pairing.id === spec.theme.font)?.hint}
            >
              <Select
                value={spec.theme.font}
                onChange={(event) =>
                  void apply('Polices modifiées', [
                    { op: 'set', path: 'theme.font', value: event.target.value },
                  ])
                }
              >
                {FONT_PAIRINGS.map((pairing) => (
                  <option key={pairing.id} value={pairing.id}>
                    {pairing.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Motif des bandeaux">
              <Select
                value={spec.theme.pattern ?? 'blobs'}
                onChange={(event) =>
                  void apply('Motif modifié', [
                    { op: 'set', path: 'theme.pattern', value: event.target.value },
                  ])
                }
              >
                {PATTERNS.map((pattern) => (
                  <option key={pattern} value={pattern}>
                    {PATTERN_LABELS[pattern]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Respiration">
              <Select
                value={spec.theme.density ?? 'balanced'}
                onChange={(event) =>
                  void apply('Respiration modifiée', [
                    { op: 'set', path: 'theme.density', value: event.target.value },
                  ])
                }
              >
                {DENSITIES.map((density) => (
                  <option key={density} value={density}>
                    {DENSITY_LABELS[density]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ambiance">
              <Select
                value={spec.theme.mode}
                onChange={(event) =>
                  void apply('Ambiance modifiée', [
                    { op: 'set', path: 'theme.mode', value: event.target.value },
                  ])
                }
              >
                <option value="light">Claire</option>
                <option value="dark">Sombre</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function readColor(spec: AppSpec, path: string): string {
  const key = path.split('.').at(-1) as keyof AppSpec['theme']['colors']
  return spec.theme.colors[key]
}

// ───────────────────────────── Fonctionnalités ───────────────────────────────

export function FeaturesPanel({ spec, send }: { spec: AppSpec; send: PatchSender }) {
  const hasAssistant = spec.pages.some((page) =>
    page.blocks.some((block) => block.type === 'assistant'),
  )
  return (
    <div className="grid gap-5">
      {/*
        Le créateur doit savoir qu'une section coûte de l'argent avant de la publier, pas
        en découvrant son solde. C'est la seule section dont l'usage est déclenché par ses
        visiteurs et facturé sur ses crédits.
      */}
      {hasAssistant ? (
        <Notice tone="caution" title="Votre application contient un assistant IA">
          Chaque réponse donnée à un visiteur consomme vos crédits, environ un par question.
          L’assistant répond au maximum deux cents fois par jour, puis se met en pause
          jusqu’au lendemain. Si votre solde tombe à zéro, il se tait poliment au lieu de
          continuer.
        </Notice>
      ) : null}
      {spec.pages.map((page, pageIndex) => (
        <Card key={page.id}>
          <CardBody>
            <div className="flex items-center gap-2">
              <h3 className="m-0 text-sm font-semibold">{page.title}</h3>
              {page.requiresAuth ? <Badge tone="brand">Réservée</Badge> : null}
              <span className="ml-auto text-xs text-[var(--color-ink-soft)]">/{page.path}</span>
            </div>
            <ul className="mt-3 grid gap-2 p-0 text-sm list-none">
              {page.blocks.map((block, blockIndex) => (
                <li
                  key={block.id}
                  className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2"
                >
                  <span>{blockLabel(block.type)}</span>
                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      aria-label="Monter"
                      disabled={blockIndex === 0}
                      onClick={() =>
                        void send('Section déplacée', [
                          {
                            op: 'move',
                            path: `pages[${pageIndex}].blocks`,
                            from: blockIndex,
                            to: blockIndex - 1,
                          },
                        ])
                      }
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      aria-label="Descendre"
                      disabled={blockIndex === page.blocks.length - 1}
                      onClick={() =>
                        void send('Section déplacée', [
                          {
                            op: 'move',
                            path: `pages[${pageIndex}].blocks`,
                            from: blockIndex,
                            to: blockIndex + 1,
                          },
                        ])
                      }
                    >
                      ↓
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
      <Notice tone="neutral">
        Pour ajouter une page ou une section, demandez-le à l&apos;assistant : « Ajoute une page
        à propos », « Ajoute une galerie photos », « Ajoute les étapes pour réserver », « Ajoute
        une section contact avec mon adresse ».
      </Notice>
    </div>
  )
}

function blockLabel(type: string): string {
  const labels: Record<string, string> = {
    hero: "Bandeau d'accueil",
    richText: 'Texte',
    imageText: 'Image et texte',
    features: 'Liste d’atouts',
    steps: 'Étapes',
    gallery: 'Galerie',
    testimonials: 'Témoignages',
    team: 'Équipe',
    logos: 'Partenaires',
    faq: 'Questions fréquentes',
    stats: 'Chiffres clés',
    comparison: 'Tableau comparatif',
    video: 'Vidéo',
    contact: 'Contact',
    banner: 'Bandeau d’annonce',
    cta: 'Appel à l’action',
    pricing: 'Tarifs',
    recordForm: 'Formulaire',
    recordList: 'Liste de données',
    auth: 'Connexion',
    assistant: 'Assistant IA',
  }
  return labels[type] ?? type
}

// ────────────────────────────── Monétisation ─────────────────────────────────

export function MonetizationPanel({ spec, send }: { spec: AppSpec; send: PatchSender }) {
  return (
    <div className="grid gap-5">
      <Card>
        <CardBody>
          <h3 className="mt-0 text-sm font-semibold">Comment gagner de l&apos;argent</h3>
          <div className="mt-3">
            <Field label="Modèle choisi">
              <Select
                defaultValue={spec.monetization.model}
                onChange={(event) =>
                  void send('Modèle économique modifié', [
                    { op: 'set', path: 'monetization.model', value: event.target.value },
                  ])
                }
              >
                <option value="free">Gratuit</option>
                <option value="one_time">Paiement unique</option>
                <option value="subscription">Abonnement</option>
                <option value="freemium">Gratuit puis payant</option>
                <option value="credits">Crédits</option>
              </Select>
            </Field>
          </div>
          {spec.monetization.note !== undefined ? (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">{spec.monetization.note}</p>
          ) : null}
        </CardBody>
      </Card>

      {spec.monetization.plans.map((plan, index) => (
        <Card key={plan.id}>
          <CardBody>
            <div className="flex items-center gap-2">
              <h3 className="m-0 text-sm font-semibold">{plan.name}</h3>
              {plan.highlighted ? <Badge tone="brand">Mise en avant</Badge> : null}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Prix (en centimes)">
                <Input
                  type="number"
                  min={0}
                  defaultValue={plan.priceCents}
                  onBlur={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isInteger(value) && value >= 0 && value !== plan.priceCents) {
                      void send(`Tarif ${plan.name} modifié`, [
                        { op: 'set', path: `monetization.plans[${index}].priceCents`, value },
                      ])
                    }
                  }}
                />
              </Field>
              <Field label="Rythme">
                <Select
                  defaultValue={plan.interval}
                  onChange={(event) =>
                    void send(`Rythme ${plan.name} modifié`, [
                      {
                        op: 'set',
                        path: `monetization.plans[${index}].interval`,
                        value: event.target.value,
                      },
                    ])
                  }
                >
                  <option value="once">Une seule fois</option>
                  <option value="month">Par mois</option>
                  <option value="year">Par an</option>
                </Select>
              </Field>
            </div>
          </CardBody>
        </Card>
      ))}

      <ComingSoon
        what="Achats intégrés iPhone et Android"
        when="prévu en phase 3 — Stripe ne peut pas être utilisé librement dans une application mobile"
      />
    </div>
  )
}

// ──────────────────────────────── Tests ──────────────────────────────────────

export function ChecksPanel({
  report,
  running,
  onRun,
}: {
  report: CheckReport | null
  running: boolean
  onRun: () => void
}) {
  return (
    <div className="grid gap-4">
      <Button onClick={onRun} disabled={running} size="large">
        {running ? 'Test en cours…' : 'Tester mon application'}
      </Button>

      {report !== null ? (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="positive">🟢 {report.counts.ok} points vérifiés</Badge>
            <Badge tone="caution">🟠 {report.counts.warn} à améliorer</Badge>
            <Badge tone="critical">🔴 {report.counts.error} à corriger</Badge>
          </div>

          <ul className="grid gap-2 p-0 text-sm list-none">
            {report.results.map((result) => (
              <li
                key={result.id}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5"
              >
                <div className="flex items-start gap-2">
                  <span aria-hidden>
                    {result.status === 'ok' ? '🟢' : result.status === 'warn' ? '🟠' : '🔴'}
                  </span>
                  <div>
                    <p className="m-0">{result.label}</p>
                    {result.hint !== undefined ? (
                      <p className="m-0 mt-1 text-xs text-[var(--color-ink-soft)]">{result.hint}</p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Notice tone="neutral">
            Pour corriger un point, demandez-le à l&apos;assistant. Il applique la correction et
            crée une nouvelle version, que vous pouvez annuler.
          </Notice>
        </>
      ) : null}
    </div>
  )
}
