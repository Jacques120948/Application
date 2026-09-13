'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Notice, Select } from '@/components/ui'
import { getTranslator, resolveLocale, type MessageKey, type Translator } from '@/i18n'

/**
 * Le Radar d'opportunités, côté écran.
 *
 * Quatre partis pris.
 *
 * **Aucun appel au modèle à l'affichage.** Tout ce qui est montré vient de la base ; seuls
 * les boutons « Rechercher » et « Comparer » coûtent, et leur prix est écrit dessus.
 *
 * **Le score s'explique.** Cinq curseurs à côté du chiffre, et la phrase qui dit ce que
 * ce chiffre n'est pas. Une estimation qui se présente comme une certitude est une
 * tromperie, même involontaire.
 *
 * **Les actions existantes sont réutilisées.** « Analyser » et « Créer un projet » appellent
 * les routes du parcours d'idées ; « Voir l'analyse » ouvre la fiche d'étude. Le Radar ne
 * possède pas un second validateur.
 *
 * **Chaque état a ses mots.** Quota atteint, copilote absent, rien de nouveau, offre qui
 * n'inclut pas le module : un message écrit pour la personne, jamais un code.
 */

export type OpportunityView = {
  id: string
  title: string
  problem: string
  audience: string
  valueProposition: string
  businessModel: string
  recommendedPriceCents: number
  priceInterval: string
  currency: string
  opportunityScore: number
  subScores: {
    profileFit: number
    demand: number
    monetization: number
    competition: number
    complexity: number
  } | null
  fitReasons: string[]
  whyNow: string | null
  keyAdvantage: string | null
  mainRisk: string | null
  validationQuestions: string[]
  complexityLevel: string
  competitionLevel: string
  timeToMarketWeeks: number
  runningCostCents: number
  customersNeeded: number
  status: 'PROPOSED' | 'SAVED' | 'SELECTED' | 'DISCARDED' | 'ARCHIVED'
  rejectReason: string | null
  analyzed: boolean
  projectId: string | null
  createdAt: string
}

export type QuotaView = { used: number; limit: number; remaining: number; resetsAt: string }

export type RunView = { id: string; createdAt: string; ideaCount: number; creditsSpent: number; trigger: string }

export type ComparisonView = {
  opportunities: OpportunityView[]
  synthesis: {
    byPriority: Array<{ priority: string; pick: string; because: string }>
    caution: string
  }
  creditsSpent: number
}

const REASONS = ['too_complex', 'not_my_sector', 'too_competitive', 'too_expensive', 'no_b2b', 'other'] as const

const MODEL_KEYS: Record<string, MessageKey> = {
  subscription: 'radar.model.subscription',
  one_time: 'radar.model.one_time',
  freemium: 'radar.model.freemium',
  credits: 'radar.model.credits',
}

function modelLabel(t: Translator, model: string): string {
  const key = MODEL_KEYS[model]
  return key === undefined ? model : t(key)
}

function intervalLabel(t: Translator, interval: string): string {
  return interval === 'month' ? t('radar.perMonth') : interval === 'year' ? t('radar.perYear') : ''
}

/** Les montants et dates suivent la langue de l'écran, la Suisse restant la référence. */
function intl(locale: string): string {
  return `${locale}-CH`
}

function money(locale: string, cents: number, currency: string): string {
  return new Intl.NumberFormat(intl(locale), { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100)
}

function scoreTone(score: number): 'positive' | 'caution' | 'neutral' {
  return score >= 70 ? 'positive' : score >= 50 ? 'caution' : 'neutral'
}

/** Cinq curseurs, sur dix. Une barre par composante, lisible sans légende. */
function SubScoreBars({ scores, t }: { scores: NonNullable<OpportunityView['subScores']>; t: Translator }) {
  const lignes: Array<[keyof typeof scores, string]> = [
    ['profileFit', t('radar.sub.profileFit')],
    ['demand', t('radar.sub.demand')],
    ['monetization', t('radar.sub.monetization')],
    ['competition', t('radar.sub.competition')],
    ['complexity', t('radar.sub.complexity')],
  ]
  return (
    <dl className="m-0 grid gap-1.5 text-xs">
      {lignes.map(([cle, label]) => (
        <div key={cle} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-2">
          <dt className="text-[var(--color-ink-soft)]">{label}</dt>
          <dd className="m-0 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
            <span
              className="block h-full rounded-full"
              style={{ width: `${scores[cle] * 10}%`, background: 'var(--gradient-cta)' }}
            />
          </dd>
          <dd className="m-0 text-right tabular-nums text-[var(--color-ink-faint)]">{scores[cle].toFixed(1)}</dd>
        </div>
      ))}
    </dl>
  )
}

function OpportunityCard({
  locale,
  t,
  item,
  selected,
  onSelect,
  onStatus,
  onFeedback,
  busy,
}: {
  locale: string
  t: Translator
  item: OpportunityView
  selected: boolean
  onSelect: () => void
  onStatus: (status: OpportunityView['status'], reason?: string) => void
  onFeedback: (verdict: 'interested' | 'not_for_me', reason?: string) => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState<string>('other')

  return (
    <Card className={selected ? 'ring-brand [--ring-fill:var(--color-surface)]' : undefined}>
      <CardBody className="grid gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-ink-soft)]">
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              aria-label={`${t('radar.compare')} — ${item.title}`}
            />
            {t('radar.compare')}
          </label>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {item.status !== 'PROPOSED' ? <Badge tone="neutral">{t(`radar.status.${item.status}` as never)}</Badge> : null}
            {item.analyzed ? <Badge tone="brand">{t('radar.viewAnalysis')}</Badge> : null}
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <h3 className="m-0 text-lg font-semibold text-balance">{item.title}</h3>
            <p className="mt-1 mb-0 text-sm leading-relaxed text-[var(--color-ink-soft)]">{item.valueProposition}</p>
          </div>
          <div className="text-right">
            <p className="m-0 text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">{t('radar.score')}</p>
            <p className="m-0 text-3xl font-semibold tabular-nums">
              <Badge tone={scoreTone(item.opportunityScore)}>{item.opportunityScore} / 100</Badge>
            </p>
            <p className="m-0 mt-1 text-[11px] text-[var(--color-ink-faint)]">{t('radar.estimate')}</p>
          </div>
        </div>

        <dl className="m-0 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-[var(--color-ink-faint)]">{t('radar.target')}</dt>
            <dd className="m-0">{item.audience}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-ink-faint)]">{t('radar.model')}</dt>
            <dd className="m-0">
              {modelLabel(t, item.businessModel)} · {money(locale, item.recommendedPriceCents, item.currency)}
              {intervalLabel(t, item.priceInterval)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-ink-faint)]">{t('radar.difficulty')}</dt>
            <dd className="m-0">{item.complexityLevel}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-ink-faint)]">{t('radar.budget')}</dt>
            <dd className="m-0">{money(locale, item.runningCostCents, item.currency)}{t('radar.perMonth')} · {t('radar.weeks', { count: item.timeToMarketWeeks })}</dd>
          </div>
        </dl>

        {item.subScores !== null ? <SubScoreBars scores={item.subScores} t={t} /> : null}

        <details open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)} className="group">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--color-brand-strong)]">
            {t('radar.why')}
          </summary>
          <div className="mt-3 grid gap-3 text-sm">
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {item.fitReasons.map((raison) => (
                <li key={raison} className="flex gap-2">
                  <span aria-hidden="true" className="text-[var(--color-brand)]">✓</span>
                  <span>{raison}</span>
                </li>
              ))}
            </ul>
            {item.whyNow !== null ? (
              <div>
                <p className="m-0 font-medium">{t('radar.whyNow')}</p>
                <p className="m-0 mt-1 text-[var(--color-ink-soft)]">{item.whyNow}</p>
                <p className="m-0 mt-1 text-xs text-[var(--color-ink-faint)]">{t('radar.whyNowInterpretation')}</p>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {item.keyAdvantage !== null ? (
                <div>
                  <p className="m-0 font-medium">{t('radar.keyAdvantage')}</p>
                  <p className="m-0 mt-1 text-[var(--color-ink-soft)]">{item.keyAdvantage}</p>
                </div>
              ) : null}
              {item.mainRisk !== null ? (
                <div>
                  <p className="m-0 font-medium">{t('radar.mainRisk')}</p>
                  <p className="m-0 mt-1 text-[var(--color-ink-soft)]">{item.mainRisk}</p>
                </div>
              ) : null}
            </div>
            {item.validationQuestions.length > 0 ? (
              <div>
                <p className="m-0 font-medium">{t('radar.validationQuestions')}</p>
                <ul className="m-0 mt-1 grid list-disc gap-1 pl-5 text-[var(--color-ink-soft)]">
                  {item.validationQuestions.map((q) => <li key={q}>{q}</li>)}
                </ul>
              </div>
            ) : null}
            <p className="m-0 text-xs text-[var(--color-ink-faint)]">{t('radar.customers', { count: item.customersNeeded })}</p>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-4">
          <a
            href={`/${locale}/idees/${item.id}`}
            className="inline-flex items-center justify-center rounded-[var(--radius-control)] px-4 py-2 text-sm font-medium text-white no-underline"
            style={{ backgroundImage: 'var(--gradient-cta)' }}
          >
            {item.analyzed ? t('radar.viewAnalysis') : t('radar.analyze')}
          </a>
          {item.projectId !== null ? (
            <a href={`/${locale}/projets/${item.projectId}`} className="text-sm font-medium text-[var(--color-brand-strong)] no-underline">
              {t('radar.status.SELECTED')} →
            </a>
          ) : item.status !== 'DISCARDED' && item.status !== 'ARCHIVED' ? (
            <a href={`/${locale}/idees/${item.id}`} className="text-sm text-[var(--color-ink-soft)] no-underline hover:text-[var(--color-brand-strong)]">
              {t('radar.createProject')}
            </a>
          ) : null}

          <span className="ml-auto flex flex-wrap gap-2">
            {item.status === 'PROPOSED' ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onStatus('SAVED')}>
                {t('radar.save')}
              </Button>
            ) : null}
            {item.status === 'SAVED' || item.status === 'PROPOSED' ? (
              <>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => onFeedback('interested')}>
                  {t('radar.interested')}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setRejecting((v) => !v)}>
                  {t('radar.reject')}
                </Button>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => onStatus('ARCHIVED')}>
                  {t('radar.archive')}
                </Button>
              </>
            ) : null}
            {item.status === 'DISCARDED' || item.status === 'ARCHIVED' ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onStatus('PROPOSED')}>
                {t('radar.restore')}
              </Button>
            ) : null}
          </span>
        </div>

        {rejecting ? (
          <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-3">
            <Field label={t('radar.rejectWhy')}>
              <Select value={reason} onChange={(event) => setReason(event.target.value)}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{t(`radar.reason.${r}` as never)}</option>
                ))}
              </Select>
            </Field>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                onFeedback('not_for_me', reason)
                onStatus('DISCARDED', reason)
                setRejecting(false)
              }}
            >
              {t('radar.reject')}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

export function RadarBoard({
  locale,
  initialOpportunities,
  initialQuota,
  runs,
  aiAvailable,
  missingPrecisions,
  searchCredits,
  compareCredits,
  credits,
}: {
  locale: string
  initialOpportunities: OpportunityView[]
  initialQuota: QuotaView
  runs: RunView[]
  aiAvailable: boolean
  missingPrecisions: string[]
  searchCredits: number
  compareCredits: number
  credits: number
}) {
  // Les catalogues sont des objets purs : le traducteur se construit ici, côté client, car
  // une fonction ne traverse pas la frontière serveur → client.
  const t = getTranslator(resolveLocale(locale))
  const [items, setItems] = useState(initialOpportunities)
  const [quota, setQuota] = useState(initialQuota)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [comparison, setComparison] = useState<ComparisonView | null>(null)
  const [missing, setMissing] = useState(missingPrecisions)
  const [improving, setImproving] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  const canSearch = aiAvailable && quota.remaining > 0 && credits >= searchCredits && busy === null

  async function search() {
    setBusy('search')
    setError(null)
    setNotice(null)
    const response = await fetch('/api/radar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale }),
    })
    const body = (await response.json()) as {
      opportunities?: OpportunityView[]
      quota?: QuotaView
      skipped?: number
      message?: string
    }
    setBusy(null)
    if (!response.ok || body.opportunities === undefined || body.quota === undefined) {
      setError(body.message ?? t('radar.error'))
      return
    }
    setItems((current) => [...(body.opportunities as OpportunityView[]), ...current])
    setQuota(body.quota)
    if (body.opportunities.length === 0) setNotice(t('radar.noNewBody'))
    else if ((body.skipped ?? 0) > 0) setNotice(t('radar.skipped', { count: body.skipped ?? 0 }))
  }

  async function setStatus(ideaId: string, status: OpportunityView['status'], reason?: string) {
    setBusy(ideaId)
    setError(null)
    const response = await fetch('/api/radar/statut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ideaId, status, ...(reason ? { reason } : {}) }),
    })
    const body = (await response.json()) as { opportunity?: OpportunityView; message?: string }
    setBusy(null)
    if (!response.ok || body.opportunity === undefined) {
      setError(body.message ?? t('radar.error'))
      return
    }
    setItems((current) => current.map((item) => (item.id === ideaId ? (body.opportunity as OpportunityView) : item)))
  }

  async function feedback(ideaId: string, verdict: 'interested' | 'not_for_me', reason?: string) {
    await fetch('/api/radar/avis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ideaId, verdict, ...(reason ? { reason } : {}) }),
    })
  }

  function toggleSelect(ideaId: string) {
    setSelected((current) =>
      current.includes(ideaId) ? current.filter((id) => id !== ideaId) : current.length >= 3 ? current : [...current, ideaId],
    )
  }

  async function runCompare() {
    setBusy('compare')
    setError(null)
    const response = await fetch('/api/radar/comparer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ideaIds: selected, locale }),
    })
    const body = (await response.json()) as ComparisonView & { message?: string }
    setBusy(null)
    if (!response.ok || body.synthesis === undefined) {
      setError(body.message ?? t('radar.error'))
      return
    }
    setComparison(body)
  }

  async function saveProfile(form: FormData) {
    setBusy('profile')
    setError(null)
    setProfileSaved(false)
    const years = form.get('experienceYears')
    const prospect = form.get('willingToProspect')
    const response = await fetch('/api/radar/profil', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        experienceYears: years === '' || years === null ? null : Number(years),
        knownSectors: String(form.get('knownSectors') ?? ''),
        technicalLevel: String(form.get('technicalLevel')),
        entrepreneurExperience: String(form.get('entrepreneurExperience')),
        marketScope: String(form.get('marketScope')),
        productPreference: String(form.get('productPreference')),
        willingToProspect: prospect === 'unknown' ? null : prospect === 'yes',
      }),
    })
    const body = (await response.json()) as { missingPrecisions?: string[]; message?: string }
    setBusy(null)
    if (!response.ok) {
      setError(body.message ?? t('radar.error'))
      return
    }
    setMissing(body.missingPrecisions ?? [])
    setProfileSaved(true)
    setImproving(false)
  }

  const sections: Array<{ key: string; label: string; filter: (o: OpportunityView) => boolean }> = [
    { key: 'new', label: t('radar.section.new'), filter: (o) => o.status === 'PROPOSED' },
    { key: 'saved', label: t('radar.section.saved'), filter: (o) => o.status === 'SAVED' },
    { key: 'converted', label: t('radar.section.converted'), filter: (o) => o.status === 'SELECTED' },
    { key: 'rejected', label: t('radar.section.rejected'), filter: (o) => o.status === 'DISCARDED' },
    { key: 'archived', label: t('radar.section.archived'), filter: (o) => o.status === 'ARCHIVED' },
  ]

  return (
    <div className="grid gap-6">
      <Card>
        <CardBody className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="m-0 text-sm text-[var(--color-ink-soft)]">{t('radar.basedOn')}</p>
              <p className="m-0 text-xs text-[var(--color-ink-faint)]">
                {t('radar.quota', { used: quota.used, limit: quota.limit })} · {t('radar.quotaReset', { date: new Date(quota.resetsAt).toLocaleDateString(intl(locale)) })}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <a href={`/${locale}/objectif`} className="text-sm text-[var(--color-brand-strong)] no-underline">
                {t('radar.editProfile')}
              </a>
              <Button type="button" variant="secondary" onClick={() => setImproving((v) => !v)}>
                {t('radar.improve')}{missing.length > 0 ? ` (${missing.length})` : ''}
              </Button>
              <Button type="button" onClick={search} disabled={!canSearch}>
                {busy === 'search' ? t('radar.searching') : `${t('radar.search')} · ${searchCredits}`}
              </Button>
            </div>
          </div>

          {!aiAvailable ? <Notice tone="caution">{t('radar.aiUnavailable')}</Notice> : null}
          {aiAvailable && quota.remaining <= 0 ? <Notice tone="neutral">{t('radar.quotaExceeded')}</Notice> : null}
          {aiAvailable && quota.remaining > 0 && credits < searchCredits ? (
            <Notice tone="caution">{t('radar.searchCost', { count: searchCredits })}</Notice>
          ) : null}
          {error !== null ? <Notice tone="critical">{error}</Notice> : null}
          {notice !== null ? <Notice tone="neutral">{notice}</Notice> : null}
          {profileSaved ? <Notice tone="positive">{t('radar.profileSaved')}</Notice> : null}

          {improving ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void saveProfile(new FormData(event.currentTarget))
              }}
              className="grid gap-4 rounded-[var(--radius-control)] bg-[var(--color-canvas)] p-4"
            >
              <p className="m-0 text-sm text-[var(--color-ink-soft)]">{t('radar.improveBody')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('radar.field.experienceYears')}>
                  <Input name="experienceYears" type="number" min={0} max={60} />
                </Field>
                <Field label={t('radar.field.knownSectors')}>
                  <Input name="knownSectors" maxLength={300} />
                </Field>
                <Field label={t('radar.field.technicalLevel')}>
                  <Select name="technicalLevel" defaultValue="debutant">
                    {(['debutant', 'intermediaire', 'avance'] as const).map((v) => (
                      <option key={v} value={v}>{t(`radar.level.${v}` as never)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('radar.field.entrepreneurExperience')}>
                  <Select name="entrepreneurExperience" defaultValue="aucune">
                    {(['aucune', 'premiere', 'confirmee'] as const).map((v) => (
                      <option key={v} value={v}>{t(`radar.exp.${v}` as never)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('radar.field.marketScope')}>
                  <Select name="marketScope" defaultValue="francophone">
                    {(['local', 'francophone', 'international'] as const).map((v) => (
                      <option key={v} value={v}>{t(`radar.scope.${v}` as never)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('radar.field.productPreference')}>
                  <Select name="productPreference" defaultValue="indifferent">
                    {(['saas', 'application', 'outil_metier', 'marketplace', 'indifferent'] as const).map((v) => (
                      <option key={v} value={v}>{t(`radar.product.${v}` as never)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('radar.field.willingToProspect')}>
                  <Select name="willingToProspect" defaultValue="unknown">
                    <option value="yes">{t('radar.yes')}</option>
                    <option value="no">{t('radar.no')}</option>
                    <option value="unknown">{t('radar.unknown')}</option>
                  </Select>
                </Field>
              </div>
              <div>
                <Button type="submit" disabled={busy === 'profile'}>{t('radar.saveProfile')}</Button>
              </div>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {selected.length >= 2 ? (
        <Card>
          <CardBody className="flex flex-wrap items-center gap-3">
            <p className="m-0 text-sm">{t('radar.compareHint')} · {t('radar.compareCost', { count: compareCredits })}</p>
            <Button type="button" className="ml-auto" disabled={busy !== null || credits < compareCredits} onClick={runCompare}>
              {busy === 'compare' ? '…' : `${t('radar.compare')} (${selected.length})`}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {comparison !== null ? (
        <Card>
          <CardBody className="grid gap-4">
            <h2 className="m-0 text-lg font-semibold">{t('radar.compareTitle')}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                    <th className="py-2 pr-3"> </th>
                    {comparison.opportunities.map((o) => <th key={o.id} className="py-2 pr-3 font-medium normal-case tracking-normal text-[var(--color-ink)]">{o.title}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {([
                    [t('radar.score'), (o: OpportunityView) => `${o.opportunityScore} / 100`],
                    [t('radar.target'), (o: OpportunityView) => o.audience],
                    [t('radar.sub.complexity'), (o: OpportunityView) => o.complexityLevel],
                    [t('radar.budget'), (o: OpportunityView) => `${money(locale, o.runningCostCents, o.currency)}${t('radar.perMonth')}`],
                    [t('radar.delay'), (o: OpportunityView) => t('radar.weeks', { count: o.timeToMarketWeeks })],
                    [t('radar.model'), (o: OpportunityView) => modelLabel(t, o.businessModel)],
                    [t('radar.sub.competition'), (o: OpportunityView) => o.competitionLevel],
                    [t('radar.sub.profileFit'), (o: OpportunityView) => o.subScores ? `${o.subScores.profileFit.toFixed(1)} / 10` : '—'],
                    [t('radar.mainRisk'), (o: OpportunityView) => o.mainRisk ?? '—'],
                  ] as Array<[string, (o: OpportunityView) => string]>).map(([label, read]) => (
                    <tr key={label} className="border-t border-[var(--color-line)] align-top">
                      <th scope="row" className="py-2 pr-3 text-left font-medium text-[var(--color-ink-soft)]">{label}</th>
                      {comparison.opportunities.map((o) => <td key={o.id} className="py-2 pr-3">{read(o)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2">
              <h3 className="m-0 text-sm font-semibold">{t('radar.compareSynthesis')}</h3>
              <ul className="m-0 grid list-none gap-2 p-0 text-sm">
                {comparison.synthesis.byPriority.map((line) => (
                  <li key={line.priority} className="rounded-[var(--radius-control)] bg-[var(--color-canvas)] px-3 py-2">
                    <span className="font-medium">{line.priority} :</span> {line.pick} — <span className="text-[var(--color-ink-soft)]">{line.because}</span>
                  </li>
                ))}
              </ul>
              <p className="m-0 text-sm"><span className="font-medium">{t('radar.compareCaution')} :</span> {comparison.synthesis.caution}</p>
              <p className="m-0 text-xs text-[var(--color-ink-faint)]">{t('radar.scoreDisclaimer')}</p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title={t('radar.empty')} body={t('radar.emptyBody')} />
      ) : (
        sections.map((section) => {
          // Dans chaque groupe, la meilleure note d'abord : c'est un outil de comparaison.
          const list = items.filter(section.filter).sort((a, b) => b.opportunityScore - a.opportunityScore)
          if (list.length === 0) return null
          return (
            <section key={section.key} className="grid gap-3">
              <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                {section.label} · {list.length}
              </h2>
              {list.map((item) => (
                <OpportunityCard
                  key={item.id}
                  locale={locale}
                  t={t}
                  item={item}
                  selected={selected.includes(item.id)}
                  onSelect={() => toggleSelect(item.id)}
                  onStatus={(status, reason) => void setStatus(item.id, status, reason)}
                  onFeedback={(verdict, reason) => void feedback(item.id, verdict, reason)}
                  busy={busy === item.id}
                />
              ))}
            </section>
          )
        })
      )}

      <p className="m-0 text-xs text-[var(--color-ink-faint)]">{t('radar.scoreDisclaimer')}</p>

      {runs.length > 0 ? (
        <section className="grid gap-2">
          <h2 className="m-0 text-sm font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">{t('radar.history')}</h2>
          <ul className="m-0 grid list-none gap-1 p-0 text-sm text-[var(--color-ink-soft)]">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap justify-between gap-2">
                <span>{new Date(run.createdAt).toLocaleString(intl(locale))} · {t(`radar.trigger.${run.trigger}` as never)}</span>
                <span>{t('radar.historyLine', { count: run.ideaCount, credits: run.creditsSpent })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
