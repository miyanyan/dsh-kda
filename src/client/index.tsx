import * as React from 'react'
import { useState, type CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { KdaView } from './kda-view.js'
import {
  parseKdaResult,
  type KdaCandidateView as CandidateView,
  type KdaResultView as ResultView,
} from './kda-projection.js'

interface KdaTextBlock {
  type: string
  text?: string
}

type KdaToolBlock =
  | { argsRaw: string }
  | { kind: 'tool-result'; content: readonly KdaTextBlock[]; meta?: unknown }

interface KdaToolCallOwnerProps {
  callId: string
  toolName: string
  block: KdaToolBlock
  inspect?: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: KdaToolCallOwnerProps }
  }
}

type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

const color = {
  baseline: '#2563eb',
  promote: '#16a34a',
  revise: '#d97706',
  reject: '#dc2626',
  running: '#64748b',
} as const

const cardStyle: CSSProperties = {
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: 10,
  margin: '4px 0',
  overflow: 'hidden',
}

function parseResult(block: ToolCallViewProps['block']): ResultView | undefined {
  if (!('kind' in block)) return undefined
  return parseKdaResult(block.meta, block.content)
}

function metric(candidate: CandidateView): string {
  if (candidate.candidateMetric === undefined) return 'no metric'
  return `${candidate.candidateMetric}${candidate.metricUnit === undefined ? '' : ` ${candidate.metricUnit}`}`
}

/** Candidate-aware KDA result row registered for the model-facing evaluator tool. */
export function KdaToolRow({ block, inspect }: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(false)
  const result = parseResult(block)
  if (result === undefined) {
    const running = !('kind' in block)
    return (
      <div style={cardStyle}>
        <div style={{ padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: color.running }}>●</span>
          <strong>KDA</strong>
          <span style={{ opacity: 0.7 }}>{running ? 'Evaluating candidate…' : 'Result unavailable'}</span>
        </div>
      </div>
    )
  }
  const resultMetric = result.candidateMetric === undefined
    ? undefined
    : `${result.candidateMetric}${result.metricUnit === undefined ? '' : ` ${result.metricUnit}`}`
  const candidates = result.candidates ?? []
  return (
    <div style={cardStyle} data-kda-decision={result.decision}>
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        style={{
          width: '100%', padding: '9px 12px', border: 0, background: 'transparent', color: 'inherit',
          display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ color: color[result.decision] }}>●</span>
        <strong>KDA · {result.candidate}</strong>
        <span style={{ opacity: 0.72 }}>{result.decision.toUpperCase()}</span>
        <span style={{ color: result.mechanismAssessment.verdict === 'supported' ? color.promote : color.revise, opacity: 0.78 }}>
          mechanism {result.mechanismAssessment.verdict}
        </span>
        {result.iteration !== undefined && <span style={{ opacity: 0.58 }}>#{result.iteration}</span>}
        {resultMetric !== undefined && <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{resultMetric}</span>}
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)', padding: 12 }}>
          <div style={{ opacity: 0.65, marginBottom: 6 }}>
            Run <code>{result.runId}</code>{result.iteration === undefined ? '' : ` · iteration ${result.iteration}`}
          </div>
          {result.hypothesis !== undefined && <div style={{ marginBottom: 6 }}><strong>Hypothesis:</strong> {result.hypothesis}</div>}
          {result.changeSummary !== undefined && <div style={{ marginBottom: 8, opacity: 0.78 }}>{result.changeSummary}</div>}
          <div style={{ marginBottom: 10 }}>{result.reason}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {result.stages.map(stage => (
              <div key={stage.stage} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: stage.ok ? color.promote : color.reject }}>{stage.ok ? '✓' : '✕'}</span>
                <span style={{ minWidth: 88 }}>{stage.stage}</span>
                <span style={{ opacity: 0.7 }}>{stage.durationMs.toFixed(1)} ms</span>
                {stage.metric !== undefined && <span>{stage.metric}{stage.metricUnit === undefined ? '' : ` ${stage.metricUnit}`}</span>}
                {stage.artifact !== undefined && <code style={{ opacity: 0.7 }}>{stage.artifact}</code>}
              </div>
            ))}
          </div>
          {result.baselineMetric !== undefined && result.improvementPercent !== undefined && (
            <div style={{ marginTop: 10, opacity: 0.75 }}>
              Baseline {result.baselineMetric}{result.metricUnit === undefined ? '' : ` ${result.metricUnit}`}
              {' · '}{result.improvementPercent.toFixed(3)}% improvement
            </div>
          )}
          {result.ncuReportAssessment !== undefined && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid color-mix(in srgb, currentColor 8%, transparent)' }}>
              <strong>Original NCU · {result.ncuReportAssessment.primaryDiagnosis}</strong>
              <span style={{ marginLeft: 7, opacity: 0.6 }}>
                {result.ncuReportAssessment.dimensions.filter(item => item.status !== 'missing-evidence').length}/6 assessed · {result.ncuReportAssessment.patterns.length} playbook matches
              </span>
              {result.ncuReportAssessment.recommendations[0] !== undefined && (
                <div style={{ marginTop: 7 }}><strong>Top action:</strong> {result.ncuReportAssessment.recommendations[0].action}</div>
              )}
              <div style={{ marginTop: 6, opacity: 0.65 }}><code>{result.ncuReportAssessment.reportPath}</code></div>
            </div>
          )}
          {result.ncuReportAssessment === undefined && result.profileAnalysis !== undefined && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid color-mix(in srgb, currentColor 8%, transparent)' }}>
              <strong>Overview only · {result.profileAnalysis.bottleneck}</strong>
              <span style={{ marginLeft: 7, opacity: 0.6 }}>{result.profileStatus} · {result.profileAnalysis.confidence} confidence · {result.profileAnalysis.metricCount} metrics</span>
              <div style={{ marginTop: 6 }}>{result.profileAnalysis.diagnosis}</div>
              {result.profileAnalysis.keyMetrics.slice(0, 6).map(item => (
                <div key={`${item.canonicalName ?? item.name}:${item.name}`}><code>{item.name}={item.value}{item.unit === undefined ? '' : ` ${item.unit}`}</code></div>
              ))}
              <div style={{ marginTop: 7, opacity: 0.8 }}><strong>Next:</strong> {result.profileAnalysis.nextExperiment.action}</div>
              <div style={{ marginTop: 7, color: color.revise }}>Not an original ncu-report-skill decision.</div>
            </div>
          )}
          {candidates.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid color-mix(in srgb, currentColor 8%, transparent)' }}>
              <strong>Candidate lineage</strong>
              <div style={{ display: 'grid', gap: 5, marginTop: 6 }}>
                {candidates.map(candidate => (
                  <div key={`${candidate.iteration}:${candidate.candidate}`} style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
                    <span style={{ color: color[candidate.decision] }}>●</span>
                    <span>#{candidate.iteration}</span>
                    <code>{candidate.parentCandidate === undefined ? candidate.candidate : `${candidate.parentCandidate} → ${candidate.candidate}`}</code>
                    <span style={{ marginLeft: 'auto' }}>{metric(candidate)}</span>
                    {candidate.profileBottleneck !== undefined && <span style={{ opacity: 0.6 }}>{candidate.profileBottleneck}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {inspect !== undefined && <button type="button" onClick={inspect} style={{ marginTop: 12 }}>Inspect dsh trajectory</button>}
        </div>
      )}
    </div>
  )
}

export const inject = ['slots']

/** Register the keyed result card and the dedicated KDA conversation view. */
export function apply(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'kda_evaluate_candidate' },
    KdaToolRow,
  ))
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: 'kda',
      order: 30,
      label: () => 'KDA',
    },
    KdaView,
  ))
}
