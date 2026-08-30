import { describe, expect, it } from 'vitest'
import { parseKdaResult, projectKdaRuns, type KdaResultView } from '../src/client/kda-projection.js'
import { countRecoveredCandidates, summarizeRunOutcome } from '../src/client/kda-view.js'
import { ncuAssessment } from './fixtures.js'

const unverified = {
  verdict: 'unverified' as const,
  evidence: [],
  limitations: ['No declared metric mechanism.'],
}

function result(overrides: Partial<KdaResultView> = {}): KdaResultView {
  return {
    schemaVersion: 1,
    runId: 'run-a',
    evaluationId: 'eval-baseline',
    iteration: 1,
    task: 'fused-rmsnorm',
    objective: 'Reduce median latency',
    candidate: 'baseline',
    candidateRole: 'baseline',
    hypothesis: 'Measure the unmodified reference.',
    baselineMetric: 10,
    candidateMetric: 10,
    metricUnit: 'us',
    lowerIsBetter: true,
    minimumImprovementPercent: 5,
    benchmarkContext: 'rtx5070ti-shape-a',
    decision: 'baseline',
    reason: 'Measured baseline recorded.',
    stages: [
      { stage: 'correctness', ok: true, durationMs: 12, exitCode: 0 },
      { stage: 'benchmark', ok: true, durationMs: 20, exitCode: 0, metric: 10, metricUnit: 'us' },
    ],
    profileStatus: 'not-requested',
    mechanismAssessment: unverified,
    promotionPolicy: { requireProfile: false, requireMechanism: false },
    decisionGates: [],
    contextWarnings: [],
    candidates: [{
      evaluationId: 'eval-baseline',
      candidate: 'baseline',
      candidateRole: 'baseline',
      iteration: 1,
      hypothesis: 'Measure the unmodified reference.',
      baselineMetric: 10,
      candidateMetric: 10,
      metricUnit: 'us',
      lowerIsBetter: true,
      minimumImprovementPercent: 5,
      decision: 'baseline',
      benchmarkContext: 'rtx5070ti-shape-a',
      profileStatus: 'not-requested',
      mechanismVerdict: 'unverified',
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

  it('groups runs, orders candidates, and derives the measured baseline, promoted best, and fastest measurement', () => {
    const baseline = result()
    const candidate = result({
      evaluationId: 'eval-2',
      iteration: 2,
      candidate: 'vector-load-v1',
      candidateRole: 'experiment',
      parentCandidate: 'baseline',
      hypothesis: 'Increase load width.',
      changeSummary: 'Use float4 loads.',
      candidateMetric: 8.5,
      improvementPercent: 15,
      decision: 'promote',
      reason: 'Correct and 15% faster.',
      candidates: [
        ...(baseline.candidates ?? []),
        {
          evaluationId: 'eval-2', candidate: 'vector-load-v1', candidateRole: 'experiment', parentCandidate: 'baseline', iteration: 2,
          hypothesis: 'Increase load width.', candidateMetric: 8.5, baselineMetric: 10, metricUnit: 'us', improvementPercent: 15,
          lowerIsBetter: true, minimumImprovementPercent: 5, decision: 'promote', benchmarkContext: 'rtx5070ti-shape-a',
          profileStatus: 'not-requested', mechanismVerdict: 'unverified',
        },
      ],
    })
    const other = result({ runId: 'run-b', evaluationId: 'eval-b', candidate: 'other-baseline' })
    const runs = projectKdaRuns([node(candidate, 2, true), node(baseline, 1), node(other, 3)])

    expect(runs.map(run => run.runId)).toEqual(['run-b', 'run-a'])
    expect(runs[1]?.evaluations.map(item => item.result.candidate)).toEqual(['baseline', 'vector-load-v1'])
    expect(runs[1]?.lineage.map(item => item.candidate)).toEqual(['baseline', 'vector-load-v1'])
    expect(runs[1]?.baseline?.candidate).toBe('baseline')
    expect(runs[1]?.bestPromoted?.candidate).toBe('vector-load-v1')
    expect(runs[1]?.fastestMeasured?.candidate).toBe('vector-load-v1')
  })

  it('never labels a faster revised candidate as the best promoted candidate', () => {
    const baseline = result()
    const promoted = {
      evaluationId: 'eval-promoted', candidate: 'safe-v1', candidateRole: 'experiment' as const, parentCandidate: 'baseline', iteration: 2,
      hypothesis: 'Make a safe improvement.', candidateMetric: 9, baselineMetric: 10, metricUnit: 'us', improvementPercent: 10,
      lowerIsBetter: true, minimumImprovementPercent: 5, decision: 'promote' as const,
    }
    const revised = {
      evaluationId: 'eval-revised', candidate: 'fast-but-unverified', candidateRole: 'experiment' as const, parentCandidate: 'baseline', iteration: 3,
      hypothesis: 'Try an aggressive path.', candidateMetric: 7, baselineMetric: 10, metricUnit: 'us', improvementPercent: 30,
      lowerIsBetter: true, minimumImprovementPercent: 5, decision: 'revise' as const,
    }
    const latest = result({
      evaluationId: 'eval-revised', iteration: 3, candidate: revised.candidate, candidateRole: 'experiment', parentCandidate: 'baseline',
      hypothesis: revised.hypothesis, candidateMetric: 7, improvementPercent: 30, decision: 'revise',
      candidates: [...(baseline.candidates ?? []), promoted, revised],
    })
    const run = projectKdaRuns([node(latest, 3), node(baseline, 1)])[0]
    expect(run?.bestPromoted?.candidate).toBe('safe-v1')
    expect(run?.fastestMeasured?.candidate).toBe('fast-but-unverified')
  })

  it('counts lineage summaries whose original evaluator result is outside loaded history', () => {
    const baseline = result()
    const candidate = result({
      evaluationId: 'eval-2', iteration: 2, candidate: 'vector-load-v1', candidateRole: 'experiment', parentCandidate: 'baseline',
      candidates: [
        ...(baseline.candidates ?? []),
        {
          evaluationId: 'eval-2', candidate: 'vector-load-v1', candidateRole: 'experiment', parentCandidate: 'baseline', iteration: 2,
          hypothesis: 'Increase load width.', candidateMetric: 8.5, baselineMetric: 10, metricUnit: 'us', improvementPercent: 15,
          lowerIsBetter: true, minimumImprovementPercent: 5, decision: 'promote', benchmarkContext: 'rtx5070ti-shape-a',
          profileStatus: 'not-requested', mechanismVerdict: 'unverified',
        },
      ],
    })

    expect(countRecoveredCandidates(projectKdaRuns([node(candidate, 2)]))).toBe(1)
    expect(countRecoveredCandidates(projectKdaRuns([node(baseline, 1), node(candidate, 2)]))).toBe(0)
  })

  it('projects the scan-first outcome from the latest durable evaluation', () => {
    const promoted = result({
      candidate: 'vector-load-v1', candidateRole: 'experiment', candidateMetric: 8.5, improvementPercent: 15,
      decision: 'promote', reason: 'Correct and faster.', ncuReportAssessment: ncuAssessment(),
      candidates: [{
        candidate: 'vector-load-v1', candidateRole: 'experiment', iteration: 2, hypothesis: 'Increase load width.',
        baselineMetric: 10, candidateMetric: 8.5, metricUnit: 'us', improvementPercent: 15, lowerIsBetter: true,
        minimumImprovementPercent: 5, decision: 'promote',
      }],
    })
    const run = projectKdaRuns([node(promoted, 2)])[0]
    expect(run === undefined ? undefined : summarizeRunOutcome(run)).toMatchObject({
      best: { candidate: 'vector-load-v1', candidateMetric: 8.5 },
      latest: { decision: 'promote', reason: 'Correct and faster.' },
      diagnosis: 'The kernel is latency-bound on dependent global loads, not DRAM bandwidth.',
      nextAction: 'Unroll to expose four independent loads.',
    })
  })

  it('projects running candidates, their stages, and branched lineage without inventing results', () => {
    const baseline = result()
    const runningCall = {
      callId: 'call-running',
      name: 'kda_evaluate_candidate',
      time: 4_000,
      argsRaw: JSON.stringify({
        optimizationRunId: 'run-a', task: 'fused-rmsnorm', objective: 'Reduce median latency',
        candidate: 'branch-v2', candidateRole: 'experiment', parentCandidate: 'baseline',
        hypothesis: 'Try a second branch.', changeSummary: 'Change the reduction layout.',
      }),
      subCalls: [
        { kind: 'tool-result', call: { name: 'kda/correctness' }, isError: false },
        { callId: 'benchmark-running', name: 'kda/benchmark' },
      ],
    }
    const run = projectKdaRuns([node(baseline, 1)], [runningCall])[0]
    expect(run?.runningCandidates).toHaveLength(1)
    expect(run?.runningCandidates[0]).toMatchObject({ candidate: 'branch-v2', parentCandidate: 'baseline' })
    expect(run?.runningCandidates[0]?.stages).toEqual([
      { stage: 'correctness', status: 'passed' },
      { stage: 'benchmark', status: 'running' },
      { stage: 'profile', status: 'waiting' },
    ])
    expect(run?.lineageRows.map(row => [row.candidate, row.depth, row.state])).toEqual([
      ['baseline', 0, 'settled'],
      ['branch-v2', 1, 'running'],
    ])
    expect(run?.fastestMeasured).toBeUndefined()
  })

  it('shows a running-only run and ignores malformed running arguments', () => {
    const valid = {
      callId: 'call-running-only', name: 'kda_evaluate_candidate', time: 5_000, subCalls: [],
      argsRaw: JSON.stringify({ optimizationRunId: 'run-live', candidate: 'baseline-live', candidateRole: 'baseline', task: 'live task' }),
    }
    const malformed = { ...valid, callId: 'bad', argsRaw: '{' }
    const runs = projectKdaRuns([], [malformed, valid])
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ runId: 'run-live', task: 'live task', evaluations: [] })
    expect(runs[0]?.runningCandidates[0]?.candidate).toBe('baseline-live')
  })

  it('ignores unrelated tools and de-duplicates one evaluation id', () => {
    const evaluation = result()
    const unrelated = { ...node(evaluation, 1), call: { name: 'read', argsRaw: '{}' } }
    const runs = projectKdaRuns([unrelated, node(evaluation, 2), node(evaluation, 3, true)])
    expect(runs).toHaveLength(1)
    expect(runs[0]?.evaluations).toHaveLength(1)
  })

  it('keeps exact NCU measurements, comparisons, diagnosis, and mechanism evidence', () => {
    const evaluation = result({
      profileStatus: 'comparable',
      profileAnalysis: {
        parser: 'kda-lines',
        bottleneck: 'compute-throughput',
        confidence: 'medium',
        metricCount: 2,
        metrics: [{ name: 'Compute (SM) Throughput', canonicalName: 'compute-throughput', value: 84, unit: '%' }],
        keyMetrics: [{ name: 'Compute (SM) Throughput', canonicalName: 'compute-throughput', value: 84, unit: '%' }],
        topStalls: [],
        kernelNames: ['kernel_a'],
        launchIds: ['1'],
        evidence: ['Compute (SM) Throughput=84 %'],
        observations: [{ kind: 'comparison', summary: 'Compute throughput increased.', evidence: ['compute-throughput'] }],
        diagnosis: 'Compute throughput increased while duration fell.',
        limitations: [],
        recommendations: ['Inspect instruction mix.'],
        nextExperiment: { action: 'Collect source counters.', rationale: 'Attribute the gain.', requiredMetrics: ['source counters'] },
        comparison: {
          referenceCandidate: 'baseline', candidate: 'vector-load-v1', profileContext: 'same-ncu-context', warnings: [],
          metrics: [{
            canonicalName: 'compute-throughput', name: 'Compute (SM) Throughput', unit: '%',
            baselineValue: 70, candidateValue: 84, delta: 14, deltaPercent: 20,
          }],
        },
      },
      mechanismAssessment: {
        verdict: 'supported', expectedMetric: 'compute-throughput', expectedDirection: 'increase',
        evidence: ['Compute throughput increased by 20%.'], limitations: [],
      },
      promotionPolicy: { requireProfile: true, requireMechanism: true },
      decisionGates: [{
        name: 'mechanism', status: 'passed', blocking: true,
        summary: 'Required NCU mechanism verdict is supported.', evidence: ['Compute throughput increased by 20%.'],
      }],
      ncuReportAssessment: ncuAssessment(),
    })
    const runs = projectKdaRuns([node(evaluation, 1)])
    const projected = runs[0]?.evaluations[0]?.result
    expect(projected?.profileAnalysis?.comparison?.metrics[0]?.deltaPercent).toBe(20)
    expect(projected?.profileAnalysis?.diagnosis).toContain('duration fell')
    expect(projected?.mechanismAssessment.verdict).toBe('supported')
    expect(projected?.promotionPolicy).toEqual({ requireProfile: true, requireMechanism: true })
    expect(projected?.decisionGates[0]).toMatchObject({ name: 'mechanism', status: 'passed', blocking: true })
    expect(projected?.ncuReportAssessment).toMatchObject({
      source: 'mit-han-lab/ncu-report-skill',
      primaryDiagnosis: 'The kernel is latency-bound on dependent global loads, not DRAM bandwidth.',
    })
    expect(projected?.ncuReportAssessment?.dimensions).toHaveLength(6)
    expect(projected?.ncuReportAssessment?.patterns[0]).toMatchObject({ id: 'E', estimatedSpeedupPercent: 18 })
    expect(projected?.ncuReportAssessment?.reportMarkdown).toContain('Key metrics')
  })

  it('degrades an incomplete schema-v1 result honestly and rejects every other schema', () => {
    const partial = {
      schemaVersion: 1,
      runId: 'partial',
      candidate: 'candidate',
      decision: 'revise',
      profileAnalysis: { parser: 'ncu-csv', metricCount: 1, metrics: [{ name: 'Duration', value: 8 }] },
    }
    const parsed = parseKdaResult(partial, [])
    expect(parsed).toMatchObject({
      candidateRole: 'experiment', profileStatus: 'not-requested', reason: 'Evaluation result is incomplete.',
      mechanismAssessment: { verdict: 'unverified' },
      decisionGates: [],
    })
    expect(parsed?.profileAnalysis).toMatchObject({ launchIds: [], kernelNames: [], diagnosis: 'Profile analysis is incomplete.' })
    expect(parseKdaResult({ ...partial, schemaVersion: 3 }, [])).toBeUndefined()
  })
})
