import { describe, expect, it } from 'vitest'
import { parseKdaResult, projectKdaRuns, type KdaResultView } from '../src/client/kda-projection.js'

function result(overrides: Partial<KdaResultView> = {}): KdaResultView {
  return {
    schemaVersion: 2,
    runId: 'run-a',
    evaluationId: 'eval-1',
    iteration: 1,
    task: 'fused-rmsnorm',
    objective: 'Reduce median latency',
    candidate: 'candidate-1',
    parentCandidate: 'baseline',
    hypothesis: 'Vector loads reduce stalls',
    baselineMetric: 10,
    candidateMetric: 8.5,
    metricUnit: 'us',
    improvementPercent: 15,
    decision: 'promote',
    reason: 'Correct and faster than the promotion threshold.',
    stages: [
      { stage: 'correctness', ok: true, durationMs: 12, exitCode: 0 },
      { stage: 'benchmark', ok: true, durationMs: 20, exitCode: 0, metric: 8.5, metricUnit: 'us' },
    ],
    candidates: [{
      evaluationId: 'eval-1',
      candidate: 'candidate-1',
      parentCandidate: 'baseline',
      iteration: 1,
      hypothesis: 'Vector loads reduce stalls',
      baselineMetric: 10,
      candidateMetric: 8.5,
      metricUnit: 'us',
      improvementPercent: 15,
      decision: 'promote',
    }],
    ...overrides,
  }
}

function node(value: KdaResultView, seq: number, meta = false): Record<string, unknown> {
  return {
    kind: 'tool-result',
    seq,
    time: seq * 1_000,
    callId: `call-${seq}`,
    call: { name: 'kda_evaluate_candidate', argsRaw: '{}' },
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(meta ? { meta: value } : {}),
  }
}

describe('KDA client projection', () => {
  it('parses presentation metadata before the JSON text fallback', () => {
    const metadata = result({ candidate: 'from-meta' })
    const parsed = parseKdaResult(metadata, [{ type: 'text', text: JSON.stringify(result({ candidate: 'from-text' })) }])
    expect(parsed?.candidate).toBe('from-meta')
  })

  it('groups evaluations by run and orders the latest run first', () => {
    const first = result({ decision: 'revise', candidateMetric: 9.8, improvementPercent: 2, reason: 'Needs revision.' })
    const second = result({
      evaluationId: 'eval-2',
      iteration: 2,
      candidate: 'candidate-2',
      parentCandidate: 'candidate-1',
      candidateMetric: 8.5,
      candidates: [
        ...(first.candidates ?? []),
        {
          evaluationId: 'eval-2', candidate: 'candidate-2', parentCandidate: 'candidate-1', iteration: 2,
          hypothesis: 'Increase vector width', candidateMetric: 8.5, metricUnit: 'us', decision: 'promote',
        },
      ],
    })
    const other = result({ runId: 'run-b', evaluationId: 'eval-b', candidate: 'other' })
    const runs = projectKdaRuns([node(first, 1), node(second, 2, true), node(other, 3)])
    expect(runs.map(run => run.runId)).toEqual(['run-b', 'run-a'])
    expect(runs[1]?.evaluations.map(item => item.result.candidate)).toEqual(['candidate-1', 'candidate-2'])
    expect(runs[1]?.lineage.map(item => item.candidate)).toEqual(['candidate-1', 'candidate-2'])
  })

  it('ignores unrelated tools and de-duplicates one evaluation id', () => {
    const evaluation = result()
    const unrelated = { ...node(evaluation, 1), call: { name: 'read', argsRaw: '{}' } }
    const runs = projectKdaRuns([unrelated, node(evaluation, 2), node(evaluation, 3, true)])
    expect(runs).toHaveLength(1)
    expect(runs[0]?.evaluations).toHaveLength(1)
  })

  it('keeps NCU diagnosis evidence for the dedicated view', () => {
    const evaluation = result({
      profileAnalysis: {
        parser: 'kda-lines',
        bottleneck: 'memory-throughput',
        confidence: 'medium',
        metricCount: 2,
        evidence: ['dram__throughput.avg.pct_of_peak_sustained_elapsed=88 %'],
        recommendations: ['Inspect coalescing.'],
      },
    })
    const runs = projectKdaRuns([node(evaluation, 1)])
    expect(runs[0]?.evaluations[0]?.result.profileAnalysis?.bottleneck).toBe('memory-throughput')
    expect(runs[0]?.evaluations[0]?.result.profileAnalysis?.evidence).toHaveLength(1)
  })
})
