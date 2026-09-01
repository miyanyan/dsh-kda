import * as React from 'react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  projectKdaRuns,
  type KdaCandidateView,
  type KdaDecisionGateView,
  type KdaDecisionView,
  type KdaEvaluationView,
  type KdaMechanismVerdictView,
  type KdaMetricComparisonView,
  type KdaMetricView,
  type KdaNcuDimensionAssessmentView,
  type KdaNcuDimensionStatusView,
  type KdaNcuReportAssessmentView,
  type KdaProfileView,
  type KdaProfileStatusView,
  type KdaRunningCandidateView,
  type KdaRunView,
  type KdaStageView,
} from './kda-projection.js'

export interface KdaViewNavigation {
  openCall: (callId: string, seq: number) => void
  inspectCall: (callId: string) => void
  launchNsight: (request: KdaNsightRequest) => Promise<string>
  loadOlder: () => Promise<void>
}

export interface KdaNsightReportReference {
  candidate: string
  iteration?: number
  workdir: string
  reportPath: string
  profileContext?: string
}

export type KdaNsightRequest =
  { action: 'open-report'; report: KdaNsightReportReference }

const color = {
  baseline: '#2563eb',
  promote: '#16a34a',
  revise: '#d97706',
  reject: '#dc2626',
  hypothesis: '#7c3aed',
  change: '#64748b',
  correctness: '#059669',
  benchmark: '#0284c7',
  profile: '#7c3aed',
  mechanism: '#c026d3',
  next: '#0f766e',
  muted: '#64748b',
} as const

const decisionColor: Record<KdaDecisionView, string> = {
  baseline: color.baseline,
  promote: color.promote,
  revise: color.revise,
  reject: color.reject,
}

const mechanismColor: Record<KdaMechanismVerdictView, string> = {
  supported: color.promote,
  'partially-supported': '#65a30d',
  contradicted: color.reject,
  unverified: color.revise,
}

const gateColor: Record<KdaDecisionGateView['status'], string> = {
  passed: color.promote,
  failed: color.reject,
  advisory: color.profile,
  unavailable: color.muted,
}

const dimensionStatusColor: Record<KdaNcuDimensionStatusView, string> = {
  analyzed: color.promote,
  'missing-evidence': color.revise,
  'not-applicable': color.muted,
}

const dimensionLabel: Record<KdaNcuDimensionAssessmentView['dimension'], string> = {
  'launch-occupancy': 'Launch & occupancy',
  'workload-balance': 'Workload balance',
  'stall-hotspots': 'Stalls & hotspots',
  'tensor-core': 'Tensor Core',
  timeline: 'SM timeline',
  memory: 'Memory & cache',
}

const border = '1px solid color-mix(in srgb, currentColor 11%, transparent)'
const subtleBorder = '1px solid color-mix(in srgb, currentColor 7%, transparent)'
const mono: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }

function metricText(value: number | undefined, unit: string | undefined): string {
  return value === undefined ? '—' : `${value}${unit === undefined ? '' : ` ${unit}`}`
}

function percentText(value: number | undefined, digits = 2): string {
  return value === undefined ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function durationText(value: number | undefined): string {
  if (value === undefined) return '—'
  return value < 1_000 ? `${value.toFixed(0)} ms` : `${(value / 1_000).toFixed(2)} s`
}

function profileStatusLabel(status: KdaProfileStatusView): string {
  switch (status) {
    case 'not-requested': return 'not profiled'
    case 'skipped': return 'profile skipped'
    case 'failed': return 'profile failed'
    case 'no-parseable-metrics': return 'no metrics'
    case 'current-only': return 'current only'
    case 'comparable': return 'reference compared'
  }
}

function directionSymbol(direction: 'increase' | 'decrease' | 'stable' | undefined): string {
  if (direction === 'increase') return '↑'
  if (direction === 'decrease') return '↓'
  if (direction === 'stable') return '≈'
  return '—'
}

function Tag({ children, tone = color.muted }: { children: ReactNode; tone?: string }) {
  return (
    <span style={{
      color: tone,
      background: `color-mix(in srgb, ${tone} 9%, transparent)`,
      borderRadius: 3,
      fontSize: 10,
      fontWeight: 750,
      letterSpacing: '0.035em',
      lineHeight: '18px',
      padding: '0 6px',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

function ResultText({ children, tone }: { children: ReactNode; tone?: string | undefined }) {
  return <span style={{ color: tone, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>
}

function ActionButton({ children, disabled = false, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} style={{ background: 'transparent', border, borderRadius: 5, color: 'inherit', cursor: disabled ? 'wait' : 'pointer', fontSize: 11, opacity: disabled ? 0.58 : 1, padding: '5px 8px' }}>{children}</button>
}

function PrimaryActionButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ background: color.profile, border: 0, borderRadius: 5, color: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '6px 9px' }}>{children}</button>
}

interface EvidenceNodeProps {
  label: string
  tone: string
  title: ReactNode
  preview?: ReactNode
  result?: ReactNode
  children?: ReactNode
  defaultOpen?: boolean
  dataKind: string
}

function EvidenceNode({ label, tone, title, preview, result, children, defaultOpen, dataKind }: EvidenceNodeProps) {
  const hasChildren = React.Children.count(children) > 0
  const row = (
    <>
      <span style={{ alignSelf: 'stretch', position: 'relative', width: 22 }}>
        <span style={{ background: tone, border: '2px solid var(--dsw-alias-bg-layer-1, white)', borderRadius: 999, height: 9, left: 6, position: 'absolute', top: 13, width: 9, zIndex: 1 }} />
        <span style={{ background: 'color-mix(in srgb, currentColor 12%, transparent)', bottom: -1, left: 10, position: 'absolute', top: 0, width: 1 }} />
      </span>
      <span style={{ paddingTop: 8 }}><Tag tone={tone}>{label}</Tag></span>
      <span style={{ minWidth: 0, padding: '8px 8px 8px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, fontWeight: 650 }}>{title}</span>
        {preview !== undefined && <span style={{ fontSize: 12, marginLeft: 8, opacity: 0.58 }}>{preview}</span>}
      </span>
      <span style={{ alignItems: 'center', display: 'flex', gap: 6, padding: '8px 8px 8px 0' }}>
        {result}
        {hasChildren && <span style={{ fontSize: 10, opacity: 0.42 }}>›</span>}
      </span>
    </>
  )
  const gridStyle: CSSProperties = {
    borderBottom: subtleBorder,
    display: 'grid',
    gridTemplateColumns: '24px 104px minmax(0, 1fr) auto',
    minHeight: 35,
  }
  if (!hasChildren) return <div style={gridStyle} data-kda-node={dataKind}>{row}</div>
  return (
    <details open={defaultOpen} style={{ borderBottom: subtleBorder }} data-kda-node={dataKind}>
      <summary style={{ ...gridStyle, borderBottom: 0, cursor: 'pointer', listStyle: 'none' }}>{row}</summary>
      <div style={{ margin: '0 10px 10px 128px' }}>{children}</div>
    </details>
  )
}

function CompactMetrics({ metrics }: { metrics: readonly KdaMetricView[] }) {
  if (metrics.length === 0) return <div style={{ opacity: 0.58 }}>No structured metrics.</div>
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 1, background: 'color-mix(in srgb, currentColor 7%, transparent)', border, borderRadius: 6, overflow: 'hidden' }}>
      {metrics.map((metric, index) => (
        <div key={`${metric.canonicalName ?? metric.name}:${index}`} style={{ background: 'var(--dsw-alias-bg-layer-1, white)', display: 'flex', gap: 8, justifyContent: 'space-between', minWidth: 0, padding: '7px 9px' }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.name}</span>
            {metric.canonicalName !== undefined && <code style={{ fontSize: 9, opacity: 0.46 }}>{metric.canonicalName}</code>}
          </span>
          <strong style={{ ...mono, fontSize: 11, whiteSpace: 'nowrap' }}>{metricText(metric.value, metric.unit)}</strong>
        </div>
      ))}
    </div>
  )
}

function ComparisonTable({ metrics, reference }: { metrics: readonly KdaMetricComparisonView[]; reference: string }) {
  return (
    <div style={{ border, borderRadius: 6, overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, fontVariantNumeric: 'tabular-nums', width: '100%' }}>
        <thead>
          <tr style={{ background: 'color-mix(in srgb, currentColor 3%, transparent)', opacity: 0.62, textAlign: 'right' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left' }}>Metric</th>
            <th style={{ padding: '6px 8px' }}>{reference}</th>
            <th style={{ padding: '6px 8px' }}>Candidate</th>
            <th style={{ padding: '6px 8px' }}>Delta</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map(metric => (
            <tr key={metric.canonicalName} style={{ borderTop: subtleBorder }}>
              <td style={{ padding: '6px 8px' }}>
                <span>{metric.name}</span>
                <code style={{ display: 'block', fontSize: 9, opacity: 0.44 }}>{metric.canonicalName}</code>
              </td>
              <td style={{ padding: '6px 8px', textAlign: 'right' }}>{metricText(metric.baselineValue, metric.unit)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{metricText(metric.candidateValue, metric.unit)}</td>
              <td style={{ color: metric.deltaPercent === undefined ? undefined : metric.deltaPercent === 0 ? color.muted : metric.deltaPercent > 0 ? color.promote : color.reject, padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                {metric.deltaPercent === undefined ? metric.delta : percentText(metric.deltaPercent)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type NcuDrawerTab = 'summary' | 'dimensions' | 'metrics' | 'decisions' | 'raw'

const drawerTabs: Array<{ id: NcuDrawerTab; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'dimensions', label: 'Six dimensions' },
  { id: 'metrics', label: 'All metrics' },
  { id: 'decisions', label: 'Rules & plan' },
  { id: 'raw', label: 'Report source' },
]

function NcuMetricTable({ metrics }: { metrics: readonly KdaMetricView[] }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery === '' ? metrics : metrics.filter(metric =>
    [metric.name, metric.canonicalName, metric.section, metric.kernelName, metric.launchId]
      .some(value => value?.toLowerCase().includes(normalizedQuery)))
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
        <input
          aria-label="Filter NCU metrics"
          onChange={event => setQuery(event.currentTarget.value)}
          placeholder="Filter metric, section, kernel or launch…"
          style={{ background: 'transparent', border, borderRadius: 6, color: 'inherit', flex: 1, fontSize: 12, padding: '7px 9px' }}
          value={query}
        />
        <Tag>{filtered.length}/{metrics.length}</Tag>
      </div>
      {filtered.length === 0 ? <div style={{ opacity: 0.56 }}>No matching parsed metrics.</div> : (
        <div style={{ border, borderRadius: 6, maxHeight: 460, overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: 'var(--dsw-alias-bg-layer-2, #f8fafc)', textAlign: 'left' }}>
                <th style={{ padding: '7px 8px' }}>Metric</th><th style={{ padding: '7px 8px' }}>Value</th><th style={{ padding: '7px 8px' }}>Section</th><th style={{ padding: '7px 8px' }}>Kernel / launch</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((metric, index) => (
                <tr key={`${metric.name}:${metric.kernelName ?? ''}:${metric.launchId ?? ''}:${index}`} style={{ borderTop: subtleBorder }}>
                  <td style={{ padding: '7px 8px' }}><code>{metric.canonicalName ?? metric.name}</code><span style={{ display: 'block', fontSize: 10, opacity: 0.48 }}>{metric.name}</span></td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', padding: '7px 8px', whiteSpace: 'nowrap' }}>{metricText(metric.value, metric.unit)}</td>
                  <td style={{ padding: '7px 8px' }}>{metric.section ?? '—'}</td>
                  <td style={{ padding: '7px 8px' }}>{metric.kernelName ?? '—'}{metric.launchId === undefined ? '' : ` · #${metric.launchId}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function NcuReportDrawer({ assessment, candidate, profile, profileStage, onClose, onOpenFull, onOpenSource, openingPath }: {
  assessment: KdaNcuReportAssessmentView
  candidate: string
  profile?: KdaProfileView | undefined
  profileStage?: KdaStageView | undefined
  onClose: () => void
  onOpenFull?: (() => void) | undefined
  onOpenSource?: (() => void) | undefined
  openingPath?: string | undefined
}) {
  const [tab, setTab] = useState<NcuDrawerTab>('summary')
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const assessed = assessment.dimensions.filter(item => item.status !== 'missing-evidence').length
  return (
    <div
      aria-label="Original NCU report details"
      aria-modal="true"
      data-kda-ncu-drawer="true"
      onClick={event => { if (event.currentTarget === event.target) onClose() }}
      role="dialog"
      style={{ background: 'color-mix(in srgb, black 26%, transparent)', display: 'flex', inset: 0, justifyContent: 'flex-end', position: 'fixed', zIndex: 1200 }}
    >
      <aside style={{ background: 'var(--dsw-alias-bg-layer-1, white)', boxShadow: '-12px 0 36px color-mix(in srgb, black 20%, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', display: 'flex', flexDirection: 'column', height: '100%', maxWidth: '92vw', width: 760 }}>
        <header style={{ borderBottom: border, padding: '14px 16px 0' }}>
          <div style={{ alignItems: 'flex-start', display: 'flex', gap: 12 }}>
            <span style={{ minWidth: 0 }}>
              <Tag tone={color.profile}>Original NCU</Tag>
              <strong style={{ display: 'block', fontSize: 16, marginTop: 8 }}>{assessment.targetKernel}</strong>
              <span style={{ display: 'block', fontSize: 11, marginTop: 3, opacity: 0.56 }}>{candidate} · {assessment.targetHardware} · {assessed}/6 assessed</span>
            </span>
            {onOpenFull !== undefined && <ActionButton disabled={openingPath !== undefined} onClick={onOpenFull}>{openingPath === assessment.fullReportPath ? 'Opening…' : 'Open in Nsight Compute'}</ActionButton>}
            {onOpenSource !== undefined && <ActionButton disabled={openingPath !== undefined} onClick={onOpenSource}>{openingPath === assessment.sourceReportPath ? 'Opening source…' : 'Open source capture'}</ActionButton>}
            <button aria-label="Close NCU report" onClick={onClose} style={{ background: 'transparent', border, borderRadius: 6, color: 'inherit', cursor: 'pointer', fontSize: 18, height: 30, marginLeft: 'auto', width: 32 }} type="button">×</button>
          </div>
          <nav aria-label="NCU report sections" role="tablist" style={{ display: 'flex', gap: 2, marginTop: 13, overflowX: 'auto' }}>
            {drawerTabs.map(item => (
              <button
                aria-selected={tab === item.id}
                key={item.id}
                onClick={() => setTab(item.id)}
                role="tab"
                style={{ background: tab === item.id ? `color-mix(in srgb, ${color.profile} 10%, transparent)` : 'transparent', border: 0, borderBottom: tab === item.id ? `2px solid ${color.profile}` : '2px solid transparent', color: 'inherit', cursor: 'pointer', fontSize: 11, fontWeight: tab === item.id ? 750 : 500, padding: '8px 10px', whiteSpace: 'nowrap' }}
                type="button"
              >{item.label}</button>
            ))}
          </nav>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
          {tab === 'summary' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <section><Tag tone={color.mechanism}>Primary diagnosis</Tag><div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.45, marginTop: 8 }}>{assessment.primaryDiagnosis}</div></section>
              <section style={{ border, borderRadius: 7, display: 'grid', fontSize: 11, gap: 7, padding: 11 }}>
                <div><strong>Workload</strong> · {assessment.workload}</div>
                <div><strong>REPORT.md</strong> · <code>{assessment.reportPath}</code></div>
                {assessment.fullReportPath !== undefined && <div><strong>Full profile</strong> · <code>{assessment.fullReportPath}</code></div>}
                {assessment.sourceReportPath !== undefined && <div><strong>Source profile</strong> · <code>{assessment.sourceReportPath}</code></div>}
                {assessment.mergedReportPath !== undefined && <div><strong>Merged run</strong> · <code>{assessment.mergedReportPath}</code></div>}
                {assessment.analysisPath !== undefined && <div><strong>Analysis</strong> · <code>{assessment.analysisPath}</code></div>}
                <div><strong>Skill</strong> · <code>{assessment.source}@{assessment.sourceCommit}</code></div>
              </section>
              {assessment.secondaryFindings.length > 0 && <section><strong>Secondary findings</strong><ul>{assessment.secondaryFindings.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
              {assessment.limitations.length > 0 && <section style={{ border: `1px solid color-mix(in srgb, ${color.revise} 35%, transparent)`, borderRadius: 7, padding: 11 }}><strong style={{ color: color.revise }}>Limitations</strong><ul>{assessment.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
            </div>
          )}
          {tab === 'dimensions' && (
            <div style={{ display: 'grid', gap: 9 }}>
              {assessment.dimensions.map((dimension, index) => (
                <section key={dimension.dimension} style={{ border, borderRadius: 7, padding: 11 }}>
                  <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}><Tag tone={dimensionStatusColor[dimension.status]}>Dim {index + 1}</Tag><strong>{dimensionLabel[dimension.dimension]}</strong><ResultText tone={dimensionStatusColor[dimension.status]}>{dimension.status}</ResultText></div>
                  <div style={{ fontSize: 13, marginTop: 8 }}>{dimension.conclusion}</div>
                  {dimension.signals.map((signal, signalIndex) => <div key={signalIndex} style={{ borderTop: subtleBorder, fontSize: 11, marginTop: 8, paddingTop: 7 }}>{signal.statement}{signal.metric !== undefined && <code style={{ display: 'block', marginTop: 3 }}>{signal.metric}{signal.value === undefined ? '' : ` = ${metricText(signal.value, signal.unit)}`}</code>}<span style={{ display: 'block', marginTop: 2, opacity: 0.48 }}>{signal.source}</span></div>)}
                  {dimension.limitations.length > 0 && <div style={{ color: color.revise, fontSize: 11, marginTop: 7 }}>{dimension.limitations.join(' · ')}</div>}
                </section>
              ))}
            </div>
          )}
          {tab === 'metrics' && (
            <div style={{ display: 'grid', gap: 16 }}>
              {profile?.comparison !== undefined && <section><strong style={{ display: 'block', marginBottom: 8 }}>Baseline comparison</strong><ComparisonTable metrics={profile.comparison.metrics} reference={profile.comparison.referenceCandidate} /></section>}
              <section><strong style={{ display: 'block', marginBottom: 8 }}>Parsed NCU metrics</strong><NcuMetricTable metrics={profile?.metrics ?? []} /></section>
            </div>
          )}
          {tab === 'decisions' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <section><strong>Playbook matches</strong><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{assessment.patterns.map(pattern => <div key={pattern.id} style={{ border, borderRadius: 7, padding: 10 }}><div style={{ alignItems: 'center', display: 'flex', gap: 7 }}><Tag tone={color.mechanism}>Pattern {pattern.id}</Tag><strong>{pattern.name}</strong><span style={{ marginLeft: 'auto' }}>{pattern.confidence}</span></div><div style={{ fontSize: 11, marginTop: 7 }}><strong>Signals</strong> · {pattern.signals.join(' · ')}</div><div style={{ fontSize: 11, marginTop: 4 }}><strong>Cause</strong> · {pattern.cause}</div><div style={{ fontSize: 11, marginTop: 4 }}><strong>First fix</strong> · {pattern.firstLineFix}</div></div>)}</div></section>
              <section><strong>NCU rules</strong><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{assessment.rules.map((rule, index) => <div key={`${rule.name}:${index}`} style={{ border, borderRadius: 7, padding: 10 }}><strong>{rule.name}</strong><Tag tone={rule.severity === 'optimization' ? color.promote : rule.severity === 'warning' ? color.revise : color.muted}>{rule.severity}</Tag><div style={{ fontSize: 11, marginTop: 6 }}>{rule.message}</div><div style={{ fontSize: 10, marginTop: 3, opacity: 0.5 }}>{rule.evidence.join(' · ')}</div></div>)}</div></section>
              <section><strong>Ranked plan</strong><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{assessment.recommendations.map(item => <div key={item.rank} style={{ border, borderRadius: 7, display: 'grid', gap: 9, gridTemplateColumns: '24px minmax(0, 1fr)', padding: 10 }}><Tag tone={color.next}>{item.rank}</Tag><span><strong>{item.action}</strong><span style={{ display: 'block', fontSize: 11, marginTop: 4 }}>{item.rationale}</span><span style={{ display: 'block', fontSize: 10, marginTop: 3, opacity: 0.5 }}>{item.expectedImpact} · Re-measure {item.requiredMetrics.join(', ')}</span></span></div>)}</div></section>
            </div>
          )}
          {tab === 'raw' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ fontSize: 10, opacity: 0.55 }}>Processed REPORT.md and captured profiler output. Binary .ncu-rep artifacts are referenced but not loaded here.</div>
              <section><strong style={{ display: 'block', marginBottom: 7 }}>REPORT.md</strong><pre style={{ ...mono, border, borderRadius: 7, fontSize: 11, lineHeight: 1.55, margin: 0, overflow: 'auto', padding: 12, whiteSpace: 'pre-wrap' }}>{assessment.reportMarkdown}</pre></section>
              <section><strong style={{ display: 'block', marginBottom: 7 }}>Profiler command output</strong><pre style={{ ...mono, border, borderRadius: 7, fontSize: 10, margin: 0, maxHeight: 300, overflow: 'auto', padding: 12, whiteSpace: 'pre-wrap' }}>{profileStage?.stdout?.text ?? 'No captured stdout.'}</pre>{profileStage?.stderr?.text !== undefined && profileStage.stderr.text.trim() !== '' && <pre style={{ ...mono, border, borderRadius: 7, color: color.reject, fontSize: 10, marginTop: 8, maxHeight: 220, overflow: 'auto', padding: 12, whiteSpace: 'pre-wrap' }}>{profileStage.stderr.text}</pre>}</section>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

function CommandEvidence({ stages }: { stages: readonly KdaStageView[] }) {
  return (
    <div style={{ border, borderRadius: 6, overflow: 'hidden' }}>
      {stages.map(stage => (
        <details key={stage.stage} style={{ borderTop: stage === stages[0] ? undefined : subtleBorder }}>
          <summary style={{ cursor: 'pointer', display: 'flex', gap: 9, padding: '7px 9px' }}>
            <span style={{ color: stage.ok ? color.promote : color.reject }}>{stage.ok ? '✓' : '✕'}</span>
            <strong style={{ textTransform: 'capitalize' }}>{stage.stage}</strong>
            <span style={{ opacity: 0.54 }}>{durationText(stage.durationMs)}</span>
            {stage.metric !== undefined && <code style={{ marginLeft: 'auto' }}>{metricText(stage.metric, stage.metricUnit)}</code>}
          </summary>
          <div style={{ background: 'color-mix(in srgb, currentColor 2%, transparent)', padding: '7px 10px' }}>
            <code style={{ ...mono, display: 'block', fontSize: 10, overflowWrap: 'anywhere' }}>{stage.command}</code>
            {stage.artifact !== undefined && <div style={{ fontSize: 10, marginTop: 5 }}>Artifact: <code>{stage.artifact}</code></div>}
            {stage.stdout?.text !== undefined && <pre style={{ ...mono, fontSize: 10, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{stage.stdout.text}</pre>}
            {stage.stderr?.text !== undefined && stage.stderr.text.trim() !== '' && <pre style={{ ...mono, color: color.reject, fontSize: 10, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{stage.stderr.text}</pre>}
          </div>
        </details>
      ))}
    </div>
  )
}

function DecisionGates({ gates }: { gates: readonly KdaDecisionGateView[] }) {
  if (gates.length === 0) {
    return <div style={{ color: color.revise, fontSize: 11 }}>Promotion policy was not recorded in this evaluation. Re-run the candidate to see every decision gate.</div>
  }
  return (
    <div style={{ border, borderRadius: 6, overflow: 'hidden' }} data-kda-decision-gates="true">
      {gates.map((gate, index) => (
        <div key={gate.name} style={{ borderTop: index === 0 ? undefined : subtleBorder, display: 'grid', gap: 8, gridTemplateColumns: '92px 84px minmax(0, 1fr)', padding: '7px 9px' }}>
          <strong style={{ fontSize: 11, textTransform: 'capitalize' }}>{gate.name}</strong>
          <Tag tone={gateColor[gate.status]}>{gate.blocking ? gate.status : 'advisory'}</Tag>
          <span style={{ fontSize: 11 }}>
            {gate.summary}
            {gate.evidence.length > 0 && <span style={{ display: 'block', fontSize: 10, marginTop: 2, opacity: 0.52 }}>{gate.evidence.join(' · ')}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function NcuReportNodes({ assessment, latest, onOpenReport }: { assessment: KdaNcuReportAssessmentView; latest: boolean; onOpenReport: () => void }) {
  const analyzed = assessment.dimensions.filter(item => item.status === 'analyzed').length
  const assessed = assessment.dimensions.filter(item => item.status !== 'missing-evidence').length
  const notApplicable = assessment.dimensions.filter(item => item.status === 'not-applicable').length
  const topPattern = [...assessment.patterns].sort((left, right) =>
    (right.estimatedSpeedupPercent ?? Number.NEGATIVE_INFINITY) - (left.estimatedSpeedupPercent ?? Number.NEGATIVE_INFINITY))[0]
  const topRule = [...assessment.rules].sort((left, right) =>
    (right.estimatedSpeedupPercent ?? Number.NEGATIVE_INFINITY) - (left.estimatedSpeedupPercent ?? Number.NEGATIVE_INFINITY))[0]
  return (
    <>
      <EvidenceNode
        label="Original NCU"
        tone={color.profile}
        title={assessment.primaryDiagnosis}
        preview={`${assessment.targetKernel} · ${assessment.targetHardware}`}
        result={<Tag tone={assessed === 6 ? color.promote : color.revise}>{assessed}/6 assessed</Tag>}
        defaultOpen={latest}
        dataKind="ncu-report"
      >
        <div style={{ display: 'grid', gap: 5, fontSize: 11 }}>
          <div><button data-kda-open-ncu-drawer="true" onClick={onOpenReport} style={{ background: color.profile, border: 0, borderRadius: 6, color: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '7px 10px' }} type="button">View full NCU report</button></div>
          <div><strong>Workload</strong> · {assessment.workload}</div>
          <div><strong>REPORT.md</strong> · <code>{assessment.reportPath}</code></div>
          {assessment.fullReportPath !== undefined && <div><strong>Full profile</strong> · <code>{assessment.fullReportPath}</code></div>}
          {assessment.sourceReportPath !== undefined && <div><strong>Source profile</strong> · <code>{assessment.sourceReportPath}</code></div>}
          {assessment.mergedReportPath !== undefined && <div><strong>Merged run</strong> · <code>{assessment.mergedReportPath}</code></div>}
          {assessment.analysisPath !== undefined && <div><strong>Analysis</strong> · <code>{assessment.analysisPath}</code></div>}
          <div><strong>Skill source</strong> · <code>{assessment.source}@{assessment.sourceCommit.slice(0, 8)}</code></div>
          <div><strong>Coverage</strong> · {analyzed} analyzed{notApplicable === 0 ? '' : ` · ${notApplicable} not applicable`} · {6 - assessed} missing evidence</div>
          {assessment.secondaryFindings.map((finding, index) => <div key={`secondary:${index}`}><strong>Secondary</strong> · {finding}</div>)}
          {assessment.limitations.map((limitation, index) => <div key={`limit:${index}`} style={{ color: color.revise }}><strong>Limitation</strong> · {limitation}</div>)}
        </div>
      </EvidenceNode>
      {assessment.dimensions.map((dimension, index) => (
        <EvidenceNode
          key={dimension.dimension}
          label={`Dim ${index + 1}`}
          tone={dimensionStatusColor[dimension.status]}
          title={dimension.conclusion}
          preview={dimensionLabel[dimension.dimension]}
          result={<ResultText tone={dimensionStatusColor[dimension.status]}>{dimension.status}</ResultText>}
          dataKind={`ncu-dimension-${dimension.dimension}`}
        >
          <div style={{ border, borderRadius: 6, overflow: 'hidden' }}>
            {dimension.signals.length === 0 ? (
              <div style={{ color: color.revise, fontSize: 11, padding: '7px 9px' }}>No durable signal recorded for this dimension.</div>
            ) : dimension.signals.map((signal, signalIndex) => (
              <div key={`${signal.source}:${signalIndex}`} style={{ borderTop: signalIndex === 0 ? undefined : subtleBorder, display: 'grid', gap: 8, gridTemplateColumns: 'minmax(160px, 1fr) auto', padding: '7px 9px' }}>
                <span style={{ fontSize: 11 }}>
                  {signal.statement}
                  <span style={{ display: 'block', fontSize: 10, marginTop: 2, opacity: 0.5 }}>{signal.source}</span>
                </span>
                {signal.metric !== undefined && <code style={{ ...mono, fontSize: 10 }}>{signal.metric}{signal.value === undefined ? '' : ` = ${metricText(signal.value, signal.unit)}`}</code>}
              </div>
            ))}
          </div>
          {dimension.limitations.length > 0 && <div style={{ color: color.revise, fontSize: 11, marginTop: 6 }}>{dimension.limitations.join(' · ')}</div>}
        </EvidenceNode>
      ))}
      <EvidenceNode
        label="Playbook"
        tone={color.mechanism}
        title={assessment.primaryDiagnosis}
        preview={topPattern === undefined ? 'no pattern matched' : `Pattern ${topPattern.id} · ${topPattern.name}`}
        result={<ResultText tone={assessment.patterns.length > 0 ? color.mechanism : color.revise}>{assessment.patterns.length} matches</ResultText>}
        defaultOpen={latest && assessment.patterns.length > 0}
        dataKind="ncu-playbook"
      >
        <div style={{ display: 'grid', gap: 7 }}>
          {assessment.patterns.map(pattern => (
            <div key={pattern.id} style={{ border, borderRadius: 6, fontSize: 11, padding: '8px 9px' }}>
              <div style={{ alignItems: 'center', display: 'flex', gap: 7 }}>
                <Tag tone={color.mechanism}>Pattern {pattern.id}</Tag>
                <strong>{pattern.name}</strong>
                <span style={{ marginLeft: 'auto' }}>{pattern.confidence} confidence</span>
                {pattern.estimatedSpeedupPercent !== undefined && <ResultText tone={color.promote}>Est. {percentText(pattern.estimatedSpeedupPercent)}</ResultText>}
              </div>
              <div style={{ marginTop: 6 }}><strong>Signals</strong> · {pattern.signals.join(' · ')}</div>
              <div style={{ marginTop: 4 }}><strong>Cause</strong> · {pattern.cause}</div>
              <div style={{ marginTop: 4 }}><strong>First fix</strong> · {pattern.firstLineFix}</div>
              {pattern.exceptions.length > 0 && <div style={{ color: color.revise, marginTop: 4 }}><strong>Checked exceptions</strong> · {pattern.exceptions.join(' · ')}</div>}
            </div>
          ))}
        </div>
      </EvidenceNode>
      {assessment.rules.length > 0 && (
        <EvidenceNode
          label="NCU Rules"
          tone={color.benchmark}
          title={topRule?.message ?? 'NCU rule findings'}
          preview={topRule?.name}
          result={<ResultText tone={color.benchmark}>{assessment.rules.length} rules</ResultText>}
          dataKind="ncu-rules"
        >
          <div style={{ display: 'grid', gap: 6 }}>
            {assessment.rules.map((rule, index) => (
              <div key={`${rule.name}:${index}`} style={{ border, borderRadius: 6, fontSize: 11, padding: '8px 9px' }}>
                <div style={{ display: 'flex', gap: 7 }}><strong>{rule.name}</strong><Tag tone={rule.severity === 'optimization' ? color.promote : rule.severity === 'warning' ? color.revise : color.muted}>{rule.severity}</Tag>{rule.estimatedSpeedupPercent !== undefined && <ResultText tone={color.promote}>Est. {percentText(rule.estimatedSpeedupPercent)}</ResultText>}</div>
                <div style={{ marginTop: 5 }}>{rule.message}</div>
                {rule.evidence.length > 0 && <div style={{ marginTop: 3, opacity: 0.55 }}>{rule.evidence.join(' · ')}</div>}
              </div>
            ))}
          </div>
        </EvidenceNode>
      )}
      {assessment.recommendations.length > 0 && (
        <EvidenceNode
          label="Ranked Plan"
          tone={color.next}
          title={assessment.recommendations[0]?.action ?? 'No ranked action'}
          preview={assessment.recommendations[0]?.expectedImpact}
          result={<ResultText tone={color.next}>{assessment.recommendations.length} ranked</ResultText>}
          defaultOpen={latest}
          dataKind="ncu-ranked-plan"
        >
          <div style={{ display: 'grid', gap: 6 }}>
            {assessment.recommendations.map(recommendation => (
              <div key={recommendation.rank} style={{ border, borderRadius: 6, display: 'grid', gap: 8, gridTemplateColumns: '26px minmax(0, 1fr)', padding: '8px 9px' }}>
                <span style={{ alignItems: 'center', background: color.next, borderRadius: 999, color: 'white', display: 'inline-flex', fontSize: 11, fontWeight: 750, height: 22, justifyContent: 'center', width: 22 }}>{recommendation.rank}</span>
                <span style={{ fontSize: 11 }}><strong>{recommendation.action}</strong><span style={{ display: 'block', marginTop: 3 }}>{recommendation.rationale}</span><span style={{ display: 'block', marginTop: 3, opacity: 0.55 }}>{recommendation.expectedImpact} · Patterns {recommendation.supportingPatterns.join(', ') || 'none'} · Re-measure {recommendation.requiredMetrics.join(', ')}</span></span>
              </div>
            ))}
          </div>
        </EvidenceNode>
      )}
    </>
  )
}

function nsightReportReference(result: KdaEvaluationView['result'], reportPath: string | undefined): KdaNsightReportReference | undefined {
  if (reportPath === undefined || result.workdir === undefined || !reportPath.toLowerCase().endsWith('.ncu-rep')) return undefined
  return {
    candidate: result.candidate,
    ...(result.iteration !== undefined ? { iteration: result.iteration } : {}),
    workdir: result.workdir,
    reportPath,
    ...(result.profileContext !== undefined ? { profileContext: result.profileContext } : {}),
  }
}

function CandidateLedger({ embedded = false, evaluation, latest, navigation, onOpenRawEvaluation }: { embedded?: boolean; evaluation: KdaEvaluationView; latest: boolean; navigation: KdaViewNavigation; onOpenRawEvaluation: () => void }) {
  const [reportOpen, setReportOpen] = useState(false)
  const [openingPath, setOpeningPath] = useState<string>()
  const [nsightMessage, setNsightMessage] = useState<string>()
  const [nsightError, setNsightError] = useState<string>()
  const result = evaluation.result
  const correctness = result.stages.find(stage => stage.stage === 'correctness')
  const benchmark = result.stages.find(stage => stage.stage === 'benchmark')
  const profileStage = result.stages.find(stage => stage.stage === 'profile')
  const profile = result.profileAnalysis
  const comparison = profile?.comparison
  const mechanism = result.mechanismAssessment
  const ncuReport = result.ncuReportAssessment
  const fullReport = nsightReportReference(result, ncuReport?.fullReportPath)
  const sourceReport = nsightReportReference(result, ncuReport?.sourceReportPath)
  const assessedDimensions = ncuReport?.dimensions.filter(item => item.status !== 'missing-evidence').length
  const expectation = mechanism.expectedMetric === undefined
    ? 'no metric declared'
    : `${mechanism.expectedMetric} ${directionSymbol(mechanism.expectedDirection)}${mechanism.expectedMinimumChangePercent === undefined ? '' : ` ≥${mechanism.expectedMinimumChangePercent}%`}`
  const ncuPolicy = result.promotionPolicy === undefined
    ? 'policy not recorded'
    : result.promotionPolicy.requireMechanism || result.promotionPolicy.requireProfile ? 'NCU is blocking' : 'NCU is advisory'

  const openNsightReport = async (report: KdaNsightReportReference): Promise<void> => {
    setOpeningPath(report.reportPath)
    setNsightMessage(undefined)
    setNsightError(undefined)
    try {
      setNsightMessage(await navigation.launchNsight({ action: 'open-report', report }))
    } catch (error) {
      setNsightError(error instanceof Error ? error.message : String(error))
    } finally {
      setOpeningPath(undefined)
    }
  }

  return (
    <>
    <details open={latest || embedded} style={{ borderBottom: embedded ? 0 : border }} data-kda-candidate-details={result.candidate}>
      <summary style={{ alignItems: 'center', background: latest ? 'color-mix(in srgb, currentColor 2%, transparent)' : undefined, cursor: 'pointer', display: embedded ? 'none' : 'grid', gap: 10, gridTemplateColumns: '34px minmax(180px, 1fr) auto auto auto auto', listStyle: 'none', minHeight: 43, padding: '0 12px' }}>
        <span style={{ alignItems: 'center', background: decisionColor[result.decision], borderRadius: 999, color: 'white', display: 'inline-flex', fontSize: 11, fontWeight: 750, height: 22, justifyContent: 'center', width: 22 }}>{result.iteration ?? '?'}</span>
        <span style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 13 }}>{result.candidate}</strong>
          {result.parentCandidate !== undefined && <span style={{ fontSize: 11, marginLeft: 8, opacity: 0.48 }}>← {result.parentCandidate}</span>}
        </span>
        <ResultText>{metricText(result.candidateMetric, result.metricUnit)}</ResultText>
        <ResultText tone={result.improvementPercent === undefined ? undefined : result.improvementPercent >= 0 ? color.promote : color.reject}>{percentText(result.improvementPercent)}</ResultText>
        <Tag tone={ncuReport === undefined ? color.revise : assessedDimensions === 6 ? color.promote : color.profile}>{ncuReport === undefined ? 'NO REPORT' : `REPORT ${assessedDimensions}/6`}</Tag>
        <Tag tone={decisionColor[result.decision]}>{result.decision}</Tag>
      </summary>
      <div style={{ borderTop: embedded ? 0 : subtleBorder, padding: embedded ? '0 16px 18px' : '0 12px 10px' }} data-kda-ledger="true">
        <div style={{ alignItems: 'start', display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', padding: '10px 0' }} data-kda-candidate-summary="true">
          <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 750, opacity: 0.48, textTransform: 'uppercase' }}>Candidate story</div>
            <div style={{ fontSize: 12, marginTop: 4 }}><strong>{result.changeSummary ?? 'No change summary recorded'}</strong></div>
            <div style={{ fontSize: 11, marginTop: 3, opacity: 0.62 }}>{result.hypothesis ?? 'No hypothesis recorded'}</div>
          </div>
          <div><div style={{ fontSize: 10, opacity: 0.48 }}>Correctness</div><ResultText tone={correctness === undefined ? color.revise : correctness.ok ? color.promote : color.reject}>{correctness === undefined ? 'Not recorded' : correctness.ok ? 'Passed' : 'Failed'}</ResultText></div>
          <div><div style={{ fontSize: 10, opacity: 0.48 }}>Performance</div><ResultText tone={result.improvementPercent !== undefined && result.improvementPercent >= 0 ? color.promote : undefined}>{metricText(result.candidateMetric, result.metricUnit)} · {percentText(result.improvementPercent)}</ResultText></div>
          <div><div style={{ fontSize: 10, opacity: 0.48 }}>Decision</div><Tag tone={decisionColor[result.decision]}>{result.decision}</Tag><div style={{ fontSize: 10, marginTop: 4, opacity: 0.62 }}>{result.reason}</div></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ncuReport === undefined
              ? <span style={{ color: color.revise, fontSize: 10, padding: '6px 0' }}>NCU report unavailable</span>
              : <PrimaryActionButton onClick={() => setReportOpen(true)}>View NCU report</PrimaryActionButton>}
            {fullReport !== undefined && <ActionButton disabled={openingPath !== undefined} onClick={() => { void openNsightReport(fullReport) }}>{openingPath === fullReport.reportPath ? 'Opening Nsight Compute…' : 'Open in Nsight Compute'}</ActionButton>}
            <ActionButton onClick={() => navigation.inspectCall(evaluation.callId)}>Open in Trajectory</ActionButton>
          </div>
          {nsightMessage !== undefined && <div role="status" style={{ color: color.promote, fontSize: 10, gridColumn: '1 / -1' }}>{nsightMessage}</div>}
          {nsightError !== undefined && <div role="alert" style={{ color: color.reject, fontSize: 10, gridColumn: '1 / -1' }}>{nsightError}</div>}
        </div>
        <details style={{ borderTop: subtleBorder }} data-kda-evidence="true">
          <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, listStyle: 'none', padding: '8px 0' }}>Inspect full evidence · {result.stages.length} stages</summary>
          <div style={{ borderTop: subtleBorder }}>
        <EvidenceNode label="Hypothesis" tone={color.hypothesis} title={result.hypothesis ?? 'No hypothesis recorded'} dataKind="hypothesis" />
        <EvidenceNode label="Change" tone={color.change} title={result.changeSummary ?? 'No change summary recorded'} preview={result.sourceRevision === undefined ? undefined : `revision ${result.sourceRevision}`} dataKind="change" />
        <EvidenceNode
          label="Correctness"
          tone={color.correctness}
          title={correctness?.command ?? 'stage did not run'}
          preview={durationText(correctness?.durationMs)}
          result={<ResultText tone={correctness?.ok === true ? color.promote : color.reject}>{correctness?.ok === true ? 'passed' : 'failed'}</ResultText>}
          dataKind="correctness"
        />
        <EvidenceNode
          label="Benchmark"
          tone={color.benchmark}
          title={`${metricText(result.baselineMetric, result.metricUnit)} → ${metricText(result.candidateMetric, result.metricUnit)}`}
          preview={`${result.lowerIsBetter === false ? 'higher' : 'lower'} is better · threshold ${result.minimumImprovementPercent ?? 0}%`}
          result={<ResultText tone={decisionColor[result.decision]}>{result.candidateRole === 'baseline' ? 'reference' : percentText(result.improvementPercent)}</ResultText>}
          dataKind="benchmark"
        >
          <div style={{ fontSize: 11 }}>
            <div><strong>Context</strong> <code>{result.benchmarkContext ?? 'not recorded'}</code></div>
            <div style={{ marginTop: 5 }}>{result.reason}</div>
          </div>
        </EvidenceNode>
        <EvidenceNode
          label="Profile"
          tone={color.profile}
          title={profile === undefined ? profileStatusLabel(result.profileStatus) : `${profile.metricCount} NCU metrics collected`}
          preview={profile === undefined ? undefined : `${profile.kernelNames.length || 'unknown'} kernel(s) · ${profile.launchIds.length || 'unknown'} launch(es)`}
          result={<ResultText tone={result.profileStatus === 'comparable' ? color.promote : color.revise}>{profileStatusLabel(result.profileStatus)}</ResultText>}
          dataKind="profile"
        >
          {profile !== undefined && (
            <div style={{ display: 'grid', gap: 8 }}>
              {comparison === undefined
                ? <CompactMetrics metrics={profile.keyMetrics.slice(0, 12)} />
                : <ComparisonTable metrics={comparison.metrics.slice(0, 14)} reference={comparison.referenceCandidate} />}
            </div>
          )}
        </EvidenceNode>
        {ncuReport === undefined ? (
          <EvidenceNode
            label="Overview only"
            tone={color.revise}
            title={profile?.diagnosis ?? 'Original ncu-report-skill assessment was not recorded'}
            preview={profile === undefined ? undefined : `${profile.bottleneck} · non-authoritative heuristic`}
            result={<ResultText tone={color.revise}>no report</ResultText>}
            dataKind="ncu-overview-heuristic"
          >
            <div style={{ color: color.revise, fontSize: 11 }}>This compact overview is not an original skill decision. Re-run the candidate with a validated original NCU assessment sidecar.</div>
          </EvidenceNode>
        ) : <NcuReportNodes assessment={ncuReport} latest={latest && !embedded} onOpenReport={() => setReportOpen(true)} />}
        <EvidenceNode
          label="NCU Verdict"
          tone={color.mechanism}
          title={expectation}
          preview={mechanism.evidence[0] ?? mechanism.limitations[0]}
          result={<ResultText tone={mechanismColor[mechanism.verdict]}>{mechanism.verdict}</ResultText>}
          dataKind="ncu-verdict"
        >
          <div style={{ display: 'grid', gap: 5, fontSize: 11 }}>
            {mechanism.observed !== undefined && <div><strong>Observed</strong> · {mechanism.observed.name}: {metricText(mechanism.observed.baselineValue, mechanism.observed.unit)} → {metricText(mechanism.observed.candidateValue, mechanism.observed.unit)} ({percentText(mechanism.observed.deltaPercent)})</div>}
            {mechanism.evidence.map((item, index) => <div key={`e:${index}`}><strong>Evidence</strong> · {item}</div>)}
            {mechanism.limitations.map((item, index) => <div key={`l:${index}`} style={{ color: color.revise }}><strong>Limitation</strong> · {item}</div>)}
          </div>
        </EvidenceNode>
        <EvidenceNode
          label="Promotion"
          tone={decisionColor[result.decision]}
          title={result.reason}
          preview={`${ncuReport === undefined ? 'original report missing' : 'original report recorded'} · ${ncuPolicy}`}
          result={<Tag tone={decisionColor[result.decision]}>{result.decision}</Tag>}
          defaultOpen={latest && !embedded}
          dataKind="decision"
        >
          <DecisionGates gates={result.decisionGates} />
          {result.contextWarnings.length > 0 && <div style={{ color: color.revise, fontSize: 11, marginTop: 7 }}>{result.contextWarnings.join(' · ')}</div>}
        </EvidenceNode>
        {ncuReport === undefined && profile?.nextExperiment !== undefined && (
          <EvidenceNode
            label="Next"
            tone={color.next}
            title={profile.nextExperiment.action}
            preview={profile.nextExperiment.rationale}
            result={<ResultText tone={color.next}>{profile.nextExperiment.requiredMetrics.length} metrics</ResultText>}
            dataKind="next"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {profile.nextExperiment.requiredMetrics.map(metric => <Tag key={metric} tone={color.next}>{metric}</Tag>)}
            </div>
          </EvidenceNode>
        )}
        <EvidenceNode
          label="Evidence"
          tone={color.muted}
          title="Commands, output and durable pointers"
          preview={`call ${evaluation.callId}`}
          result={<ResultText>{result.stages.length} stages</ResultText>}
          dataKind="evidence"
        >
          <CommandEvidence stages={result.stages} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, marginTop: 7, opacity: 0.5 }}>
            <span>call {evaluation.callId}</span>
            {result.workdir !== undefined && <span>workdir {result.workdir}</span>}
            {profileStage?.artifact !== undefined && <span>artifact {profileStage.artifact}</span>}
            {result.profileContext !== undefined && <span>profile {result.profileContext}</span>}
          </div>
          <div style={{ marginTop: 9 }}><ActionButton onClick={onOpenRawEvaluation}>View raw evaluation</ActionButton></div>
        </EvidenceNode>
          </div>
        </details>
      </div>
    </details>
    {reportOpen && ncuReport !== undefined && <NcuReportDrawer
      assessment={ncuReport}
      candidate={result.candidate}
      onClose={() => setReportOpen(false)}
      onOpenFull={fullReport === undefined ? undefined : () => { void openNsightReport(fullReport) }}
      onOpenSource={sourceReport === undefined ? undefined : () => { void openNsightReport(sourceReport) }}
      openingPath={openingPath}
      profile={profile}
      profileStage={profileStage}
    />}
    </>
  )
}

function CandidateDetailDrawer({ evaluation, navigation, onClose }: { evaluation: KdaEvaluationView; navigation: KdaViewNavigation; onClose: () => void }) {
  const result = evaluation.result
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && document.querySelector('[data-kda-ncu-drawer]') === null) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return (
    <div
      aria-label={`${result.candidate} candidate details`}
      aria-modal="true"
      data-kda-candidate-drawer={result.candidate}
      onClick={event => { if (event.currentTarget === event.target) onClose() }}
      role="dialog"
      style={{ background: 'color-mix(in srgb, black 24%, transparent)', display: 'flex', inset: 0, justifyContent: 'flex-end', position: 'fixed', zIndex: 1100 }}
    >
      <aside style={{ background: 'var(--dsw-alias-bg-layer-1, white)', boxShadow: '-12px 0 36px color-mix(in srgb, black 18%, transparent)', color: 'var(--dsw-alias-label-primary, inherit)', display: 'flex', flexDirection: 'column', height: '100%', maxWidth: '94vw', width: 720 }}>
        <header style={{ alignItems: 'center', borderBottom: border, display: 'flex', gap: 10, padding: '13px 16px' }}>
          <span style={{ alignItems: 'center', background: decisionColor[result.decision], borderRadius: 999, color: 'white', display: 'inline-flex', fontSize: 11, fontWeight: 750, height: 25, justifyContent: 'center', width: 25 }}>{result.iteration ?? '?'}</span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', fontSize: 15 }}>{result.candidate}</strong>
            <span style={{ display: 'block', fontSize: 10, marginTop: 2, opacity: 0.5 }}>{result.parentCandidate === undefined ? 'Baseline candidate' : `from ${result.parentCandidate}`}</span>
          </span>
          <ResultText>{metricText(result.candidateMetric, result.metricUnit)}</ResultText>
          <ResultText tone={result.improvementPercent === undefined ? undefined : result.improvementPercent >= 0 ? color.promote : color.reject}>{percentText(result.improvementPercent)}</ResultText>
          <Tag tone={decisionColor[result.decision]}>{result.decision}</Tag>
          <button aria-label="Close candidate details" onClick={onClose} style={{ background: 'transparent', border, borderRadius: 6, color: 'inherit', cursor: 'pointer', fontSize: 18, height: 30, marginLeft: 'auto', width: 32 }} type="button">×</button>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <CandidateLedger
            embedded
            evaluation={evaluation}
            latest={false}
            navigation={navigation}
            onOpenRawEvaluation={() => {
              onClose()
              navigation.openCall(evaluation.callId, evaluation.seq)
            }}
          />
        </div>
      </aside>
    </div>
  )
}

const iterationColumns = '42px minmax(210px, 1fr) 118px 88px 92px 94px'

function CandidateRow({ evaluation, onSelect }: { evaluation: KdaEvaluationView; onSelect: () => void }) {
  const result = evaluation.result
  const assessedDimensions = result.ncuReportAssessment?.dimensions.filter(item => item.status !== 'missing-evidence').length
  return (
    <button
      aria-label={`Open ${result.candidate} details`}
      data-kda-candidate={result.candidate}
      onClick={onSelect}
      style={{ alignItems: 'center', background: 'transparent', border: 0, borderTop: subtleBorder, color: 'inherit', cursor: 'pointer', display: 'grid', font: 'inherit', gap: 10, gridTemplateColumns: iterationColumns, minHeight: 45, padding: '0 12px', textAlign: 'left', width: '100%' }}
      type="button"
    >
      <span style={{ alignItems: 'center', background: decisionColor[result.decision], borderRadius: 999, color: 'white', display: 'inline-flex', fontSize: 11, fontWeight: 750, height: 22, justifyContent: 'center', width: 22 }}>{result.iteration ?? '?'}</span>
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.candidate}</strong>
        {result.parentCandidate !== undefined && <span style={{ display: 'block', fontSize: 9, marginTop: 2, opacity: 0.42, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>from {result.parentCandidate}</span>}
      </span>
      <ResultText>{metricText(result.candidateMetric, result.metricUnit)}</ResultText>
      <ResultText tone={result.improvementPercent === undefined ? undefined : result.improvementPercent >= 0 ? color.promote : color.reject}>{percentText(result.improvementPercent)}</ResultText>
      <Tag tone={result.ncuReportAssessment === undefined ? color.revise : assessedDimensions === 6 ? color.promote : color.profile}>{result.ncuReportAssessment === undefined ? '—' : `${assessedDimensions}/6`}</Tag>
      <Tag tone={decisionColor[result.decision]}>{result.decision}</Tag>
    </button>
  )
}

function RunningCandidateLedger({ candidate, navigation }: { candidate: KdaRunningCandidateView; navigation: KdaViewNavigation }) {
  const activeStage = candidate.stages.find(stage => stage.status === 'running')?.stage ?? candidate.stages.filter(stage => stage.status === 'passed').at(-1)?.stage ?? 'queued'
  return (
    <button aria-label={`Open running ${candidate.candidate} in Trajectory`} data-kda-running-candidate={candidate.candidate} onClick={() => navigation.inspectCall(candidate.callId)} style={{ alignItems: 'center', background: 'transparent', border: 0, borderTop: subtleBorder, color: 'inherit', cursor: 'pointer', display: 'grid', font: 'inherit', gap: 10, gridTemplateColumns: iterationColumns, minHeight: 45, padding: '0 12px', textAlign: 'left', width: '100%' }} type="button">
      <span style={{ color: color.benchmark, fontSize: 17 }}>●</span>
      <span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.candidate}</strong>{candidate.parentCandidate !== undefined && <span style={{ display: 'block', fontSize: 9, marginTop: 2, opacity: 0.42 }}>from {candidate.parentCandidate}</span>}</span>
      <ResultText>—</ResultText>
      <ResultText tone={color.benchmark}>{activeStage}</ResultText>
      <Tag tone={color.benchmark}>{candidate.stages.filter(stage => stage.status === 'passed').length}/{candidate.stages.length}</Tag>
      <Tag tone={color.benchmark}>running</Tag>
    </button>
  )
}

function RecoveredCandidateLedger({ candidate }: { candidate: KdaCandidateView }) {
  return (
    <div data-kda-recovered-candidate={candidate.candidate} style={{ alignItems: 'center', borderTop: subtleBorder, display: 'grid', gap: 10, gridTemplateColumns: iterationColumns, minHeight: 45, padding: '0 12px' }} title="Load earlier evidence to open this candidate">
      <span style={{ alignItems: 'center', background: decisionColor[candidate.decision], borderRadius: 999, color: 'white', display: 'inline-flex', fontSize: 11, fontWeight: 750, height: 22, justifyContent: 'center', width: 22 }}>{candidate.iteration}</span>
      <span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{candidate.candidate}</strong>{candidate.parentCandidate !== undefined && <span style={{ display: 'block', fontSize: 9, marginTop: 2, opacity: 0.42 }}>from {candidate.parentCandidate}</span>}</span>
      <ResultText>{metricText(candidate.candidateMetric, candidate.metricUnit)}</ResultText>
      <ResultText tone={candidate.improvementPercent === undefined ? undefined : candidate.improvementPercent >= 0 ? color.promote : color.reject}>{percentText(candidate.improvementPercent)}</ResultText>
      <Tag tone={color.revise}>summary</Tag>
      <Tag tone={decisionColor[candidate.decision]}>{candidate.decision}</Tag>
    </div>
  )
}

function evaluationForCandidate(run: KdaRunView, candidate: KdaCandidateView): KdaEvaluationView | undefined {
  return candidate.evaluationId === undefined
    ? run.evaluations.find(evaluation => evaluation.result.candidate === candidate.candidate)
    : run.evaluations.find(evaluation => evaluation.result.evaluationId === candidate.evaluationId)
}

/** Count lineage summaries whose original durable evaluator result is not in the loaded snapshot. */
export function countRecoveredCandidates(runs: readonly KdaRunView[]): number {
  return runs.reduce(
    (total, run) => total + run.lineage.filter(candidate => evaluationForCandidate(run, candidate) === undefined).length,
    0,
  )
}

function OutcomeCard({ children, label, tone = color.muted }: { children: ReactNode; label: string; tone?: string }) {
  return (
    <section style={{ border, borderRadius: 7, minHeight: 76, padding: '10px 11px' }}>
      <div style={{ color: tone, fontSize: 9, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 12, lineHeight: 1.4, marginTop: 6 }}>{children}</div>
    </section>
  )
}

export interface KdaOutcomeView {
  best?: KdaCandidateView | undefined
  latest?: KdaEvaluationView['result'] | undefined
  diagnosis: string
  nextAction: string
}

/** Project the four scan-first facts shown above an optimization run. */
export function summarizeRunOutcome(run: KdaRunView): KdaOutcomeView {
  const latest = run.evaluations.at(-1)?.result
  return {
    best: run.bestPromoted,
    latest,
    diagnosis: latest?.ncuReportAssessment?.primaryDiagnosis ?? latest?.profileAnalysis?.diagnosis ?? 'No profiler diagnosis recorded.',
    nextAction: latest?.ncuReportAssessment?.recommendations[0]?.action ?? latest?.profileAnalysis?.nextExperiment.action ?? 'No next experiment recorded.',
  }
}

function OutcomeSummary({ run }: { run: KdaRunView }) {
  const { best, diagnosis, latest, nextAction } = summarizeRunOutcome(run)
  return (
    <div style={{ background: 'color-mix(in srgb, currentColor 2%, transparent)', borderBottom: border, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', padding: 10 }} data-kda-outcome="true">
      <OutcomeCard label="Best result" tone={color.promote}>
        <strong style={{ display: 'block', fontSize: 14 }}>{best?.candidate ?? 'No promoted candidate'}</strong>
        <span style={{ alignItems: 'center', display: 'flex', gap: 8, marginTop: 3 }}><ResultText>{metricText(best?.candidateMetric, best?.metricUnit)}</ResultText><ResultText tone={color.promote}>{percentText(best?.improvementPercent)}</ResultText></span>
      </OutcomeCard>
      <OutcomeCard label="Latest verdict" tone={latest === undefined ? color.muted : decisionColor[latest.decision]}>
        {latest === undefined ? <span>No completed evaluation.</span> : <><Tag tone={decisionColor[latest.decision]}>{latest.decision}</Tag><span style={{ display: '-webkit-box', marginTop: 6, overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>{latest.reason}</span></>}
      </OutcomeCard>
      <OutcomeCard label="NCU diagnosis" tone={color.profile}>
        <span style={{ overflowWrap: 'anywhere' }}>{diagnosis}</span>
      </OutcomeCard>
      <OutcomeCard label="Recommended action" tone={color.next}>
        <strong style={{ display: '-webkit-box', overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>{nextAction}</strong>
      </OutcomeCard>
    </div>
  )
}

export interface KdaMergedNsightReport {
  report?: KdaNsightReportReference
  unavailableReason?: string
}

/** Select the latest Concat artifact already produced in the benchmark/profile environment. */
export function mergedNsightReportForRun(run: KdaRunView): KdaMergedNsightReport {
  for (const evaluation of [...run.evaluations].reverse()) {
    const report = nsightReportReference(evaluation.result, evaluation.result.ncuReportAssessment?.mergedReportPath)
    if (report !== undefined) return { report }
  }
  return { unavailableReason: 'No merged NCU report was recorded. Generate Concat in the benchmark/profile environment first.' }
}

function RunLedger({ run, latest, navigation }: { run: KdaRunView; latest: boolean; navigation: KdaViewNavigation }) {
  const [selectedEvaluation, setSelectedEvaluation] = useState<KdaEvaluationView>()
  const [openingMerged, setOpeningMerged] = useState(false)
  const [mergedMessage, setMergedMessage] = useState<string>()
  const [mergedError, setMergedError] = useState<string>()
  const best = run.bestPromoted
  const latestResult = run.evaluations.at(-1)?.result
  const merged = mergedNsightReportForRun(run)

  const openMergedInNsight = async (): Promise<void> => {
    if (merged.report === undefined) return
    setOpeningMerged(true)
    setMergedMessage(undefined)
    setMergedError(undefined)
    try {
      setMergedMessage(await navigation.launchNsight({ action: 'open-report', report: merged.report }))
    } catch (error) {
      setMergedError(error instanceof Error ? error.message : String(error))
    } finally {
      setOpeningMerged(false)
    }
  }
  return (
    <>
      <details open={latest} style={{ border, borderRadius: 7, overflow: 'hidden' }} data-kda-run={run.runId}>
        <summary style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: 10, listStyle: 'none', minHeight: 48, padding: '7px 12px' }}>
          <span style={{ flex: '1 1 260px', minWidth: 0 }}>
            <strong>{run.task ?? 'KDA optimization run'}</strong>
            <code style={{ display: 'block', fontSize: 9, marginTop: 2, opacity: 0.4 }}>{run.runId}</code>
          </span>
          <span style={{ fontSize: 11 }}>Best <strong>{metricText(best?.candidateMetric, best?.metricUnit)}</strong></span>
          <ResultText tone={best?.improvementPercent === undefined ? undefined : best.improvementPercent >= 0 ? color.promote : color.reject}>{percentText(best?.improvementPercent)}</ResultText>
          <Tag>{run.lineage.length} candidates</Tag>
          {run.runningCandidates.length > 0
            ? <Tag tone={color.benchmark}>{run.runningCandidates.length} running</Tag>
            : <Tag tone={latestResult?.ncuReportAssessment === undefined ? color.revise : color.promote}>{latestResult?.ncuReportAssessment === undefined ? 'NO NCU' : `${latestResult.ncuReportAssessment.dimensions.filter(item => item.status !== 'missing-evidence').length}/6 NCU`}</Tag>}
        </summary>
        <OutcomeSummary run={run} />
        <div style={{ alignItems: 'center', borderBottom: border, display: 'flex', flexWrap: 'wrap', gap: 8, padding: '7px 12px' }} data-kda-nsight-merged="true">
          <ActionButton disabled={openingMerged || merged.report === undefined} onClick={() => { void openMergedInNsight() }}>
            {openingMerged ? 'Opening merged report…' : 'Open merged NCU report'}
          </ActionButton>
          <span style={{ fontSize: 10, opacity: 0.58 }}>
            {merged.unavailableReason ?? `Concat produced in execution environment · ${merged.report?.profileContext ?? 'profile context not recorded'}`}
          </span>
          {mergedMessage !== undefined && <span role="status" style={{ color: color.promote, flexBasis: '100%', fontSize: 10 }}>{mergedMessage}</span>}
          {mergedError !== undefined && <span role="alert" style={{ color: color.reject, flexBasis: '100%', fontSize: 10 }}>{mergedError}</span>}
        </div>
        {run.objective !== undefined && <details style={{ borderBottom: border, fontSize: 10 }}><summary style={{ cursor: 'pointer', listStyle: 'none', opacity: 0.55, padding: '6px 12px' }}>Run contract</summary><div style={{ padding: '0 12px 8px' }}>{run.objective}</div></details>}
        <section aria-label="Optimization candidates" data-kda-candidates="true" style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 690 }}>
            <div style={{ alignItems: 'center', display: 'grid', fontSize: 9, fontWeight: 750, gap: 10, gridTemplateColumns: iterationColumns, letterSpacing: '0.05em', minHeight: 30, opacity: 0.45, padding: '0 12px', textTransform: 'uppercase' }}>
              <span>#</span><span>Candidate</span><span>Metric</span><span>vs baseline</span><span>NCU</span><span>Verdict</span>
            </div>
            {run.lineage.map(candidate => {
              const evaluation = evaluationForCandidate(run, candidate)
              return evaluation === undefined
                ? <RecoveredCandidateLedger key={`recovered:${candidate.iteration}:${candidate.candidate}`} candidate={candidate} />
                : <CandidateRow key={evaluation.id} evaluation={evaluation} onSelect={() => setSelectedEvaluation(evaluation)} />
            })}
            {run.runningCandidates.map(candidate => <RunningCandidateLedger key={candidate.callId} candidate={candidate} navigation={navigation} />)}
          </div>
        </section>
      </details>
      {selectedEvaluation !== undefined && <CandidateDetailDrawer evaluation={selectedEvaluation} navigation={navigation} onClose={() => setSelectedEvaluation(undefined)} />}
    </>
  )
}

/** Trajectory-style KDA semantic ledger reconstructed from ordinary durable tool results. */
export function KdaView({ useSession, openCall, inspectCall, launchNsight, loadOlder }: ConvViewProps & KdaViewNavigation) {
  let nodes: readonly unknown[] = []
  let runningCalls: readonly unknown[] = []
  let hasMore = false
  let loadingOlder = false
  try {
    const snapshot = useSession(value => value)
    nodes = snapshot?.nodes ?? []
    runningCalls = snapshot?.runningCalls ?? []
    hasMore = snapshot?.hasMore ?? false
    loadingOlder = snapshot?.loadingOlder ?? false
  } catch {
    // A newly selected view may render once before its Session snapshot is ready.
  }
  const runs = useMemo(() => projectKdaRuns(nodes, runningCalls), [nodes, runningCalls])
  const candidateCount = runs.reduce((sum, run) => sum + run.lineageRows.length, 0)
  const promotedCount = runs.reduce((sum, run) => sum + run.lineage.filter(candidate => candidate.decision === 'promote').length, 0)
  const runningCount = runs.reduce((sum, run) => sum + run.runningCandidates.length, 0)
  const recoveredCount = countRecoveredCandidates(runs)
  const [loadError, setLoadError] = useState<string>()
  const [requestingOlder, setRequestingOlder] = useState(false)
  const navigation = useMemo(() => ({ openCall, inspectCall, launchNsight, loadOlder }), [openCall, inspectCall, launchNsight, loadOlder])

  const requestEarlierEvidence = async () => {
    setRequestingOlder(true)
    setLoadError(undefined)
    try {
      await loadOlder()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setRequestingOlder(false)
    }
  }

  return (
    <div style={{ background: 'var(--dsw-alias-bg-layer-1, white)', color: 'var(--dsw-alias-label-primary, inherit)', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} data-kda-view="true">
      <div style={{ alignItems: 'center', borderBottom: border, display: 'flex', flexWrap: 'wrap', gap: 12, minHeight: 33, padding: '0 12px' }}>
        <strong style={{ fontSize: 12 }}>KDA semantic trajectory</strong>
        <span style={{ fontSize: 10, opacity: 0.5 }}>Hypothesis → evidence → verdict → next</span>
        <span style={{ marginLeft: 'auto' }}><Tag>{runs.length} runs</Tag></span>
        <Tag>{candidateCount} candidates</Tag>
        {runningCount > 0 && <Tag tone={color.benchmark}>{runningCount} running</Tag>}
        <Tag tone={color.promote}>{promotedCount} promoted</Tag>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 10px calc(var(--dsh-composer-height, 152px) + 16px)' }}>
        {recoveredCount > 0 && (
          <div style={{ alignItems: 'center', background: 'color-mix(in srgb, #d97706 8%, transparent)', border: '1px solid color-mix(in srgb, #d97706 35%, transparent)', borderRadius: 7, display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, padding: '9px 12px' }} data-kda-history-status="partial">
            <span aria-hidden="true" style={{ color: color.revise }}>●</span>
            <span style={{ flex: '1 1 280px', fontSize: 11 }}>
              <strong>{recoveredCount} candidate{recoveredCount === 1 ? '' : 's'} only have recovered summaries.</strong>{' '}
              {hasMore ? 'Load an earlier history page to restore their stages, evidence, and source calls.' : 'All available history is loaded; their original evaluator calls are no longer available in this session.'}
            </span>
            {hasMore && (
              <ActionButton disabled={loadingOlder || requestingOlder} onClick={() => { void requestEarlierEvidence() }}>
                {loadingOlder || requestingOlder ? 'Loading earlier evidence…' : 'Load earlier evidence'}
              </ActionButton>
            )}
            {loadError !== undefined && <span role="alert" style={{ color: color.reject, flexBasis: '100%', fontSize: 10 }}>{loadError}</span>}
          </div>
        )}
        {runs.length === 0 ? (
          <div style={{ border, borderRadius: 7, padding: 30, textAlign: 'center' }} data-kda-empty="true">
            <strong>No schema-v1 KDA evaluations</strong>
            <div style={{ fontSize: 12, marginTop: 7, opacity: 0.56 }}>Run the original ncu-report-skill, then record a measured baseline with its six-dimension assessment.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {runs.map((run, index) => <RunLedger key={run.runId} run={run} latest={index === 0} navigation={navigation} />)}
          </div>
        )}
      </div>
    </div>
  )
}
