import * as React from 'react'
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  projectKdaRuns,
  type KdaCandidateView,
  type KdaDecisionView,
  type KdaEvaluationView,
  type KdaProfileView,
  type KdaRunView,
  type KdaStageView,
} from './kda-projection.js'

const decisionColor: Record<KdaDecisionView, string> = {
  promote: '#16a34a',
  revise: '#d97706',
  reject: '#dc2626',
}

const panel: CSSProperties = {
  border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
  borderRadius: 12,
  background: 'color-mix(in srgb, currentColor 2%, transparent)',
}

const monospace: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
}

function metricText(value: number | undefined, unit: string | undefined): string {
  if (value === undefined) return '—'
  return `${value}${unit === undefined ? '' : ` ${unit}`}`
}

function durationText(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs.toFixed(1)} ms`
  return `${(durationMs / 1_000).toFixed(2)} s`
}

function decisionBadge(decision: KdaDecisionView): ReactNode {
  return (
    <span style={{
      border: `1px solid ${decisionColor[decision]}`,
      borderRadius: 999,
      color: decisionColor[decision],
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.04em',
      padding: '2px 7px',
    }}>
      {decision.toUpperCase()}
    </span>
  )
}

function StageRow({ stage }: { stage: KdaStageView }) {
  const output = stage.stdout?.text?.trim()
  const error = stage.stderr?.text?.trim()
  return (
    <div style={{ ...panel, padding: 10 }} data-kda-stage={stage.stage} data-kda-stage-ok={String(stage.ok)}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ color: stage.ok ? decisionColor.promote : decisionColor.reject }}>{stage.ok ? '✓' : '✕'}</span>
        <strong style={{ textTransform: 'capitalize' }}>{stage.stage}</strong>
        <span style={{ opacity: 0.58 }}>{durationText(stage.durationMs)}</span>
        {stage.exitCode !== undefined && <span style={{ opacity: 0.58 }}>exit {stage.exitCode ?? 'signal'}</span>}
        {stage.metric !== undefined && (
          <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {metricText(stage.metric, stage.metricUnit)}
          </span>
        )}
      </div>
      {stage.command !== undefined && (
        <div style={{ ...monospace, marginTop: 7, opacity: 0.74, overflowWrap: 'anywhere', fontSize: 12 }}>
          {stage.command}
        </div>
      )}
      {stage.artifact !== undefined && (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.68 }}>
          Artifact: <code>{stage.artifact}</code>
        </div>
      )}
      {(output !== undefined || error !== undefined) && (
        <details style={{ marginTop: 7 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, opacity: 0.7 }}>Command output</summary>
          {output !== undefined && <pre style={{ ...monospace, whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 180, overflow: 'auto' }}>{output}</pre>}
          {error !== undefined && <pre style={{ ...monospace, color: decisionColor.reject, whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 180, overflow: 'auto' }}>{error}</pre>}
        </details>
      )}
    </div>
  )
}

function ProfileEvidence({ profile }: { profile: KdaProfileView }) {
  return (
    <div style={{ ...panel, marginTop: 10, padding: 11 }} data-kda-bottleneck={profile.bottleneck}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <strong>NCU · {profile.bottleneck}</strong>
        <span style={{ opacity: 0.58 }}>{profile.confidence} confidence · {profile.metricCount} metrics</span>
      </div>
      {profile.evidence.length > 0 && (
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {profile.evidence.map(item => <code key={item} style={{ fontSize: 11, overflowWrap: 'anywhere' }}>{item}</code>)}
        </div>
      )}
      {profile.recommendations.length > 0 && (
        <ul style={{ margin: '9px 0 0', paddingLeft: 20, opacity: 0.78 }}>
          {profile.recommendations.map(item => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  )
}

function EvaluationCard({ evaluation, latest }: { evaluation: KdaEvaluationView; latest: boolean }) {
  const result = evaluation.result
  return (
    <details open={latest} style={{ ...panel, overflow: 'hidden' }} data-kda-candidate={result.candidate}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '11px 13px' }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: decisionColor[result.decision] }}>●</span>
          <strong>#{result.iteration ?? '?'} · {result.candidate}</strong>
          {result.parentCandidate !== undefined && <span style={{ opacity: 0.52 }}>from {result.parentCandidate}</span>}
          {decisionBadge(result.decision)}
          <span style={{ marginLeft: 'auto', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {metricText(result.candidateMetric, result.metricUnit)}
          </span>
          {result.improvementPercent !== undefined && (
            <span style={{ color: result.improvementPercent >= 0 ? decisionColor.promote : decisionColor.reject }}>
              {result.improvementPercent >= 0 ? '+' : ''}{result.improvementPercent.toFixed(3)}%
            </span>
          )}
        </div>
      </summary>
      <div style={{ borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)', padding: 13 }}>
        {result.hypothesis !== undefined && <div><strong>Hypothesis:</strong> {result.hypothesis}</div>}
        {result.changeSummary !== undefined && <div style={{ marginTop: 6, opacity: 0.72 }}>{result.changeSummary}</div>}
        <div style={{ marginTop: 8 }}>{result.reason}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8, marginTop: 11 }}>
          {result.stages.map(stage => <StageRow key={stage.stage} stage={stage} />)}
        </div>
        {result.profileAnalysis !== undefined && <ProfileEvidence profile={result.profileAnalysis} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10, fontSize: 11, opacity: 0.55 }}>
          <span>call {evaluation.callId}</span>
          {result.sourceRevision !== undefined && <span>revision {result.sourceRevision}</span>}
          {result.workdir !== undefined && <span>workdir {result.workdir}</span>}
        </div>
      </div>
    </details>
  )
}

function CandidateChip({ candidate }: { candidate: KdaCandidateView }) {
  return (
    <div style={{
      ...panel,
      borderColor: `color-mix(in srgb, ${decisionColor[candidate.decision]} 52%, transparent)`,
      minWidth: 160,
      padding: '8px 10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: decisionColor[candidate.decision] }}>●</span>
        <strong>#{candidate.iteration} {candidate.candidate}</strong>
      </div>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.65 }}>
        {candidate.parentCandidate === undefined ? 'root candidate' : `${candidate.parentCandidate} → ${candidate.candidate}`}
      </div>
      <div style={{ marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
        {metricText(candidate.candidateMetric, candidate.metricUnit)}
        {candidate.improvementPercent !== undefined && ` · ${candidate.improvementPercent.toFixed(3)}%`}
      </div>
    </div>
  )
}

function RunPanel({ run, latest }: { run: KdaRunView; latest: boolean }) {
  return (
    <details open={latest} style={{ ...panel, overflow: 'hidden' }} data-kda-run={run.runId}>
      <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '13px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 9 }}>
          <strong style={{ fontSize: 16 }}>{run.task ?? 'KDA optimization run'}</strong>
          <code style={{ opacity: 0.64 }}>{run.runId}</code>
          <span style={{ marginLeft: 'auto', opacity: 0.58 }}>{run.evaluations.length} evaluations</span>
        </div>
        {run.objective !== undefined && <div style={{ marginTop: 6, opacity: 0.72 }}>{run.objective}</div>}
      </summary>
      <div style={{ borderTop: '1px solid color-mix(in srgb, currentColor 10%, transparent)', padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', opacity: 0.58, marginBottom: 8 }}>
          CANDIDATE LINEAGE
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 5 }}>
          {run.lineage.map(candidate => <CandidateChip key={`${candidate.iteration}:${candidate.candidate}`} candidate={candidate} />)}
        </div>
        <div style={{ display: 'grid', gap: 9, marginTop: 13 }}>
          {run.evaluations.map((evaluation, index) => (
            <EvaluationCard key={evaluation.id} evaluation={evaluation} latest={index === run.evaluations.length - 1} />
          ))}
        </div>
      </div>
    </details>
  )
}

/** Dedicated KDA view reconstructed exclusively from ordinary durable tool results. */
export function KdaView({ useSession }: ConvViewProps) {
  let nodes: readonly unknown[] = []
  try {
    nodes = useSession(snapshot => snapshot?.nodes ?? []) ?? []
  } catch {
    // A newly selected view may render once before its Session snapshot is ready.
  }
  const runs = useMemo(() => projectKdaRuns(nodes), [nodes])
  const candidateCount = runs.reduce((sum, run) => sum + run.evaluations.length, 0)
  const promotedCount = runs.reduce((sum, run) =>
    sum + run.evaluations.filter(item => item.result.decision === 'promote').length, 0)

  return (
    <div style={{ height: '100%', overflow: 'auto' }} data-kda-view="true">
      <div style={{ width: 'min(1120px, calc(100% - 28px))', margin: '0 auto', padding: '18px 0 30px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 750 }}>Kernel Design Agents</div>
            <div style={{ marginTop: 3, opacity: 0.58 }}>Evidence-driven candidate optimization</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <span style={{ ...panel, padding: '6px 9px' }}>{runs.length} runs</span>
            <span style={{ ...panel, padding: '6px 9px' }}>{candidateCount} candidates</span>
            <span style={{ ...panel, padding: '6px 9px', color: decisionColor.promote }}>{promotedCount} promoted</span>
          </div>
        </div>
        {runs.length === 0 ? (
          <div style={{ ...panel, padding: 28, textAlign: 'center' }} data-kda-empty="true">
            <div style={{ fontSize: 17, fontWeight: 700 }}>No KDA evaluations in this session yet</div>
            <div style={{ marginTop: 7, opacity: 0.64 }}>
              Run <code>kda_evaluate_candidate</code>; this page will reconstruct the run from its durable tool result.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {runs.map((run, index) => <RunPanel key={run.runId} run={run} latest={index === 0} />)}
          </div>
        )}
      </div>
    </div>
  )
}
