import { useState, type CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime, SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

interface KdaTextBlock {
  type: string
  text?: string
}

type KdaToolBlock =
  | { argsRaw: string }
  | { kind: 'tool-result'; content: readonly KdaTextBlock[] }

interface KdaToolCallOwnerProps {
  callId: string
  toolName: string
  block: KdaToolBlock
  inspect?: () => void
}

interface ClientSlotService {
  inject(name: string, register: () => () => void): void
  register: SlotCore['register']
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: ClientSlotService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'tool.call.toolview': { kind: 'keyed'; scope: 'session'; owner: KdaToolCallOwnerProps }
  }
}

type ToolCallViewProps = PropsRuntime<'tool.call.toolview'>

interface StageView {
  stage: 'correctness' | 'benchmark' | 'profile'
  ok: boolean
  durationMs: number
  metric?: number
  metricUnit?: string
  artifact?: string
}

interface ResultView {
  schemaVersion: 1
  candidate: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  decision: 'promote' | 'revise' | 'reject'
  reason: string
  stages: StageView[]
}

const color = {
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

function resultText(block: ToolCallViewProps['block']): string | undefined {
  if (!('kind' in block)) return undefined
  return block.content
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string)
    .join('\n')
}

function parseResult(block: ToolCallViewProps['block']): ResultView | undefined {
  const text = resultText(block)
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return undefined
    const candidate = (value as { candidate?: unknown }).candidate
    const decision = (value as { decision?: unknown }).decision
    const reason = (value as { reason?: unknown }).reason
    const stages = (value as { stages?: unknown }).stages
    if (typeof candidate !== 'string' || typeof reason !== 'string' || !Array.isArray(stages)) return undefined
    if (decision !== 'promote' && decision !== 'revise' && decision !== 'reject') return undefined
    return value as ResultView
  } catch {
    return undefined
  }
}

/** Compact KDA result row registered for the model-facing evaluator tool. */
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
  const metric = result.candidateMetric === undefined
    ? undefined
    : `${result.candidateMetric}${result.metricUnit === undefined ? '' : ` ${result.metricUnit}`}`
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
        {metric !== undefined && <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{metric}</span>}
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)', padding: 12 }}>
          <div style={{ marginBottom: 10 }}>{result.reason}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {result.stages.map(stage => (
              <div key={stage.stage} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: stage.ok ? color.promote : color.reject }}>{stage.ok ? '✓' : '✕'}</span>
                <span style={{ minWidth: 88 }}>{stage.stage}</span>
                <span style={{ opacity: 0.7 }}>{stage.durationMs.toFixed(1)} ms</span>
                {stage.metric !== undefined && (
                  <span>{stage.metric}{stage.metricUnit === undefined ? '' : ` ${stage.metricUnit}`}</span>
                )}
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
          {inspect !== undefined && (
            <button type="button" onClick={inspect} style={{ marginTop: 10 }}>Inspect trajectory</button>
          )}
        </div>
      )}
    </div>
  )
}

export const inject = ['slots']

/** Register the keyed tool result view in dsh Web. */
export function apply(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'kda_evaluate_candidate' },
    KdaToolRow,
  ))
}
