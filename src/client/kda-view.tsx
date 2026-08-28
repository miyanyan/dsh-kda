import * as React from 'react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  projectKdaRuns,
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
  type KdaRunningStageStatusView,
  type KdaRunView,
  type KdaStageView,
} from './kda-projection.js'

export interface KdaViewNavigation {
  openCall: (callId: string, seq: number) => void
  inspectCall: (callId: string) => void
}

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

function ActionButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{ background: 'transparent', border, borderRadius: 5, color: 'inherit', cursor: 'pointer', fontSize: 11, padding: '5px 8px' }}>{children}</button>
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
  { id: 'raw', label: 'Raw report' },
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

function NcuReportDrawer({ assessment, candidate, profile, profileStage, onClose }: {
  assessment: KdaNcuReportAssessmentView
  candidate: string
  profile?: KdaProfileView | undefined
  profileStage?: KdaStageView | undefined
  onClose: () => void
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

function LineageTree({ run }: { run: KdaRunView }) {
  return (
    <div style={{ borderBottom: border, padding: '8px 12px' }} data-kda-lineage="true" role="tree" aria-label="Candidate lineage">
      <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 5, opacity: 0.52, textTransform: 'uppercase' }}>Candidate lineage</div>
      <div style={{ display: 'grid', gap: 3 }}>
        {run.lineageRows.map(row => {
          const candidate = row.candidateView
          const tone = row.state === 'running' ? color.benchmark : decisionColor[candidate?.decision ?? 'revise']
          return (
            <div key={row.key} role="treeitem" aria-level={row.depth + 1} style={{ alignItems: 'center', display: 'grid', gap: 7, gridTemplateColumns: 'minmax(160px, 1fr) auto auto', marginLeft: row.depth * 18, minHeight: 25 }}>
              <span style={{ alignItems: 'center', display: 'flex', minWidth: 0 }}>
                <span aria-hidden="true" style={{ color: tone, marginRight: 6 }}>{row.depth === 0 ? '●' : '└─'}</span>
                <strong style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.candidate}</strong>
                {row.parentCandidate !== undefined && <span style={{ fontSize: 10, marginLeft: 6, opacity: 0.45 }}>from {row.parentCandidate}</span>}
              </span>
              <ResultText>{candidate === undefined ? '—' : metricText(candidate.candidateMetric, candidate.metricUnit)}</ResultText>
              {row.state === 'running'
                ? <Tag tone={color.benchmark}>running</Tag>
                : <Tag tone={tone}>{candidate?.decision ?? 'unknown'}</Tag>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CandidateLedger({ evaluation, latest, navigation }: { evaluation: KdaEvaluationView; latest: boolean; navigation: KdaViewNavigation }) {
  const [reportOpen, setReportOpen] = useState(false)
  const result = evaluation.result
  const correctness = result.stages.find(stage => stage.stage === 'correctness')
  const benchmark = result.stages.find(stage => stage.stage === 'benchmark')
  const profileStage = result.stages.find(stage => stage.stage === 'profile')
  const profile = result.profileAnalysis
  const comparison = profile?.comparison
  const mechanism = result.mechanismAssessment
  const ncuReport = result.ncuReportAssessment
  const assessedDimensions = ncuReport?.dimensions.filter(item => item.status !== 'missing-evidence').length
  const expectation = mechanism.expectedMetric === undefined
    ? 'no metric declared'
    : `${mechanism.expectedMetric} ${directionSymbol(mechanism.expectedDirection)}${mechanism.expectedMinimumChangePercent === undefined ? '' : ` ≥${mechanism.expectedMinimumChangePercent}%`}`
  const ncuPolicy = result.promotionPolicy === undefined
    ? 'policy not recorded'
    : result.promotionPolicy.requireMechanism || result.promotionPolicy.requireProfile ? 'NCU is blocking' : 'NCU is advisory'

  return (
    <>
    <details open={latest} style={{ borderBottom: border }} data-kda-candidate={result.candidate}>
      <summary style={{ alignItems: 'center', background: latest ? 'color-mix(in srgb, currentColor 2%, transparent)' : undefined, cursor: 'pointer', display: 'grid', gap: 10, gridTemplateColumns: '34px minmax(180px, 1fr) auto auto auto auto', listStyle: 'none', minHeight: 43, padding: '0 12px' }}>
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
      <div style={{ borderTop: subtleBorder, padding: '0 12px 10px' }} data-kda-ledger="true">
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
            <ActionButton onClick={() => navigation.openCall(evaluation.callId, evaluation.seq)}>Open original call</ActionButton>
            <ActionButton onClick={() => navigation.inspectCall(evaluation.callId)}>Open in Trajectory</ActionButton>
          </div>
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
            <div style={{ color: color.revise, fontSize: 11 }}>This compact overview is not an original skill decision. Re-run the candidate with a schema-v1 ncuReportAssessmentJson sidecar.</div>
          </EvidenceNode>
        ) : <NcuReportNodes assessment={ncuReport} latest={latest} onOpenReport={() => setReportOpen(true)} />}
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
          defaultOpen={latest}
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
        </EvidenceNode>
          </div>
        </details>
      </div>
    </details>
    {reportOpen && ncuReport !== undefined && <NcuReportDrawer assessment={ncuReport} candidate={result.candidate} onClose={() => setReportOpen(false)} profile={profile} profileStage={profileStage} />}
    </>
  )
}

const runningStatusColor: Record<KdaRunningStageStatusView, string> = {
  waiting: color.muted,
  running: color.benchmark,
  passed: color.promote,
  failed: color.reject,
}

function RunningCandidateLedger({ candidate, navigation }: { candidate: KdaRunningCandidateView; navigation: KdaViewNavigation }) {
  return (
    <div style={{ borderBottom: border, padding: '10px 12px' }} data-kda-running-candidate={candidate.candidate}>
      <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span aria-hidden="true" style={{ color: color.benchmark }}>●</span>
        <strong>{candidate.candidate}</strong>
        {candidate.parentCandidate !== undefined && <span style={{ fontSize: 11, opacity: 0.5 }}>← {candidate.parentCandidate}</span>}
        <Tag tone={color.benchmark}>evaluating</Tag>
        <span style={{ marginLeft: 'auto' }}><ActionButton onClick={() => navigation.inspectCall(candidate.callId)}>Open in Trajectory</ActionButton></span>
      </div>
      <div style={{ fontSize: 11, marginTop: 7 }}><strong>{candidate.changeSummary ?? 'Candidate evaluation in progress'}</strong></div>
      {candidate.hypothesis !== undefined && <div style={{ fontSize: 11, marginTop: 3, opacity: 0.62 }}>{candidate.hypothesis}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
        {candidate.stages.map(stage => <Tag key={stage.stage} tone={runningStatusColor[stage.status]}>{stage.stage} · {stage.status}</Tag>)}
      </div>
    </div>
  )
}

function RunLedger({ run, latest, navigation }: { run: KdaRunView; latest: boolean; navigation: KdaViewNavigation }) {
  const best = run.bestPromoted
  const fastest = run.fastestMeasured
  const latestResult = run.evaluations.at(-1)?.result
  const fastestIsBest = fastest !== undefined && fastest.candidate === best?.candidate
  return (
    <details open={latest} style={{ border, borderRadius: 7, overflow: 'hidden' }} data-kda-run={run.runId}>
      <summary style={{ alignItems: 'center', cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: 12, listStyle: 'none', minHeight: 48, padding: '7px 12px' }}>
        <span style={{ flex: '1 1 220px', minWidth: 0 }}>
          <strong>{run.task ?? 'KDA optimization run'}</strong>
          <code style={{ display: 'block', fontSize: 10, marginTop: 2, opacity: 0.48 }}>{run.runId}</code>
        </span>
        <span style={{ fontSize: 11 }}>Baseline <strong>{metricText(run.baseline?.candidateMetric, run.baseline?.metricUnit)}</strong></span>
        <span style={{ fontSize: 11 }}>Best promoted <strong>{metricText(best?.candidateMetric, best?.metricUnit)}</strong></span>
        <ResultText tone={best?.improvementPercent === undefined ? undefined : best.improvementPercent >= 0 ? color.promote : color.reject}>{percentText(best?.improvementPercent)}</ResultText>
        {!fastestIsBest && fastest !== undefined && <span style={{ fontSize: 11 }}>Fastest measured <strong>{metricText(fastest.candidateMetric, fastest.metricUnit)}</strong> <span style={{ opacity: 0.55 }}>({fastest.decision})</span></span>}
        {run.runningCandidates.length > 0
          ? <Tag tone={color.benchmark}>{run.runningCandidates.length} running</Tag>
          : <Tag tone={latestResult?.ncuReportAssessment === undefined ? color.revise : color.promote}>{latestResult?.ncuReportAssessment === undefined ? 'NO REPORT' : `${latestResult.ncuReportAssessment.dimensions.filter(item => item.status !== 'missing-evidence').length}/6 REPORT`}</Tag>}
      </summary>
      <LineageTree run={run} />
      {run.objective !== undefined && <div style={{ borderBottom: border, fontSize: 11, opacity: 0.6, padding: '7px 12px' }}><strong>Contract</strong> · {run.objective}</div>}
      {run.evaluations.map((evaluation, index) => <CandidateLedger key={evaluation.id} evaluation={evaluation} latest={run.runningCandidates.length === 0 && index === run.evaluations.length - 1} navigation={navigation} />)}
      {run.runningCandidates.map(candidate => <RunningCandidateLedger key={candidate.callId} candidate={candidate} navigation={navigation} />)}
    </details>
  )
}

/** Trajectory-style KDA semantic ledger reconstructed from ordinary durable tool results. */
export function KdaView({ useSession, openCall, inspectCall }: ConvViewProps & KdaViewNavigation) {
  let nodes: readonly unknown[] = []
  let runningCalls: readonly unknown[] = []
  try {
    const snapshot = useSession(value => value)
    nodes = snapshot?.nodes ?? []
    runningCalls = snapshot?.runningCalls ?? []
  } catch {
    // A newly selected view may render once before its Session snapshot is ready.
  }
  const runs = useMemo(() => projectKdaRuns(nodes, runningCalls), [nodes, runningCalls])
  const candidateCount = runs.reduce((sum, run) => sum + run.evaluations.length + run.runningCandidates.length, 0)
  const promotedCount = runs.reduce((sum, run) => sum + run.evaluations.filter(item => item.result.decision === 'promote').length, 0)
  const runningCount = runs.reduce((sum, run) => sum + run.runningCandidates.length, 0)
  const navigation = useMemo(() => ({ openCall, inspectCall }), [openCall, inspectCall])

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
