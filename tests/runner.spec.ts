import { describe, expect, it } from 'vitest'
import { evaluateCandidate, parseMetric } from '../src/runner.js'
import type { KdaCommandResult, KdaCommandRunner, KdaEvaluationRequest, KdaStageName } from '../src/types.js'
import { ncuAssessment } from './fixtures.js'

function result(stdout: string, exitCode = 0): KdaCommandResult {
  return {
    exitCode,
    signal: null,
    timedOut: false,
    aborted: false,
    stdout: { text: stdout, truncated: false },
    stderr: { text: '', truncated: false },
  }
}

function runner(outputs: Partial<Record<KdaStageName, KdaCommandResult>>): KdaCommandRunner {
  return {
    async run(stage) {
      const value = outputs[stage]
      if (value === undefined) throw new Error(`unexpected stage ${stage}`)
      return value
    },
  }
}

const baselineRequest: KdaEvaluationRequest = {
  optimizationRunId: 'vector-add-smoke',
  task: 'vector-add',
  objective: 'Minimize latency while preserving exact output.',
  candidate: 'baseline',
  candidateRole: 'baseline',
  hypothesis: 'The unmodified implementation establishes the measured reference.',
  changeSummary: 'No source change.',
  workdir: '/workspace',
  correctnessCommand: 'validate',
  benchmarkCommand: 'benchmark',
  benchmarkContext: 'rtx5070ti-driver-590-shape-1m',
  metricUnit: 'us',
  lowerIsBetter: true,
  minimumImprovementPercent: 5,
}

async function measuredBaseline(profile = false) {
  return evaluateCandidate({
    ...baselineRequest,
    ...(profile ? { profileCommand: 'profile', profileContext: 'wsl-rtx5070ti-ncu2026-shape-1m', ncuReportAssessment: ncuAssessment() } : {}),
  }, runner({
    correctness: result('ok'),
    benchmark: result('KDA_METRIC=10'),
    ...(profile ? {
      profile: result([
        'KDA_NCU_METRIC=Compute (SM) Throughput|70|%',
        'KDA_NCU_METRIC=DRAM Throughput|20|%',
        'KDA_NCU_METRIC=Duration|10|ms',
      ].join('\n')),
    } : {}),
  }))
}

function experiment(previousCandidates: KdaEvaluationRequest['previousCandidates']): KdaEvaluationRequest {
  return {
    ...baselineRequest,
    candidate: 'vectorized-load-v1',
    candidateRole: 'experiment',
    parentCandidate: 'baseline',
    hypothesis: 'Vectorized loads increase compute throughput at the same workload.',
    changeSummary: 'Replace scalar loads with one aligned vector load.',
    previousCandidates,
  }
}

describe('parseMetric', () => {
  it('uses the final emitted metric', () => {
    expect(parseMetric('KDA_METRIC=9\nKDA_METRIC=7.5')).toBe(7.5)
  })

  it('supports a named capture group', () => {
    expect(parseMetric('latency: 4.25 us', String.raw`latency:\s*(?<metric>\d+\.\d+)`)).toBe(4.25)
  })
})

describe('evaluateCandidate', () => {
  it('records the first measured candidate as the explicit baseline', async () => {
    const output = await measuredBaseline()
    expect(output.schemaVersion).toBe(1)
    expect(output.decision).toBe('baseline')
    expect(output.baselineMetric).toBe(10)
    expect(output.candidateMetric).toBe(10)
    expect(output.profileStatus).toBe('not-requested')
    expect(output.mechanismAssessment.verdict).toBe('unverified')
    expect(output.candidates[0]).toMatchObject({
      candidate: 'baseline', candidateRole: 'baseline', candidateMetric: 10, baselineMetric: 10,
      benchmarkContext: baselineRequest.benchmarkContext,
    })
  })

  it('keeps the performance decision separate from a supported profiler mechanism', async () => {
    const baseline = await measuredBaseline(true)
    const output = await evaluateCandidate({
      ...experiment(baseline.candidates),
      profileCommand: 'profile',
      profileContext: 'wsl-rtx5070ti-ncu2026-shape-1m',
      expectedProfileMetric: 'compute-throughput',
      expectedProfileDirection: 'increase',
      expectedProfileMinimumChangePercent: 10,
      ncuReportAssessment: ncuAssessment(),
    }, runner({
      correctness: result('ok'),
      benchmark: result('KDA_METRIC=8.5'),
      profile: result([
        'KDA_NCU_METRIC=sm__throughput.avg.pct_of_peak_sustained_elapsed|84|%',
        'KDA_NCU_METRIC=DRAM Throughput|18|%',
        'KDA_NCU_METRIC=Duration|8|ms',
      ].join('\n')),
    }))

    expect(output.decision).toBe('promote')
    expect(output.improvementPercent).toBeCloseTo(15)
    expect(output.profileStatus).toBe('comparable')
    expect(output.mechanismAssessment.verdict).toBe('supported')
    expect(output.promotionPolicy).toEqual({ requireProfile: false, requireMechanism: false })
    expect(output.decisionGates).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'profile', status: 'advisory', blocking: false }),
      expect.objectContaining({ name: 'mechanism', status: 'advisory', blocking: false }),
    ]))
    expect(output.mechanismAssessment.observed).toMatchObject({ baselineValue: 70, candidateValue: 84 })
    expect(output.profileAnalysis?.comparison?.referenceCandidate).toBe('baseline')
    expect(output.ncuReportAssessment?.primaryDiagnosis).toContain('latency-bound')
    expect(output.contextWarnings[0]).toContain('Benchmark and profile contexts differ')
  })

  it('disables causal profiler deltas when profile contexts differ', async () => {
    const baseline = await measuredBaseline(true)
    const output = await evaluateCandidate({
      ...experiment(baseline.candidates),
      profileCommand: 'profile',
      profileContext: 'different-wsl-context',
      expectedProfileMetric: 'compute-throughput',
      expectedProfileDirection: 'increase',
      ncuReportAssessment: ncuAssessment(),
    }, runner({
      correctness: result('ok'),
      benchmark: result('KDA_METRIC=8.5'),
      profile: result('KDA_NCU_METRIC=Compute (SM) Throughput|84|%'),
    }))

    expect(output.decision).toBe('promote')
    expect(output.profileStatus).toBe('current-only')
    expect(output.profileAnalysis?.comparison).toBeUndefined()
    expect(output.mechanismAssessment.verdict).toBe('unverified')
    expect(output.profileAnalysis?.limitations.join(' ')).toContain('Profile contexts differ')
  })

  it('can promote measured performance while explicitly leaving the mechanism unverified', async () => {
    const baseline = await measuredBaseline()
    const output = await evaluateCandidate({
      ...experiment(baseline.candidates),
      profileCommand: 'profile',
      profileContext: 'wsl-rtx5070ti-ncu2026-shape-1m',
      ncuReportAssessment: ncuAssessment(),
    }, runner({
      correctness: result('ok'),
      benchmark: result('KDA_METRIC=8'),
      profile: result('==PROF== report imported successfully'),
    }))

    expect(output.decision).toBe('promote')
    expect(output.profileStatus).toBe('no-parseable-metrics')
    expect(output.mechanismAssessment.verdict).toBe('unverified')
  })

  it('revises when mechanism evidence is required but contradicted', async () => {
    const baseline = await measuredBaseline(true)
    const output = await evaluateCandidate({
      ...experiment(baseline.candidates),
      profileCommand: 'profile',
      profileContext: 'wsl-rtx5070ti-ncu2026-shape-1m',
      expectedProfileMetric: 'compute-throughput',
      expectedProfileDirection: 'increase',
      expectedProfileMinimumChangePercent: 5,
      requireMechanismForPromotion: true,
      ncuReportAssessment: ncuAssessment(),
    }, runner({
      correctness: result('ok'),
      benchmark: result('KDA_METRIC=8'),
      profile: result('KDA_NCU_METRIC=Compute (SM) Throughput|60|%'),
    }))

    expect(output.decision).toBe('revise')
    expect(output.mechanismAssessment.verdict).toBe('contradicted')
    expect(output.reason).toContain('mechanism is contradicted')
    expect(output.promotionPolicy.requireMechanism).toBe(true)
    expect(output.decisionGates).toContainEqual(expect.objectContaining({ name: 'mechanism', status: 'failed', blocking: true }))
  })

  it('stops after correctness failure', async () => {
    const output = await evaluateCandidate(baselineRequest, runner({ correctness: result('bad', 1) }))
    expect(output.decision).toBe('reject')
    expect(output.stages).toHaveLength(1)
  })

  it('rejects a failed benchmark and marks the requested profile as skipped', async () => {
    const output = await evaluateCandidate({
      ...baselineRequest,
      profileCommand: 'profile',
      profileContext: 'wsl-rtx5070ti-ncu2026-shape-1m',
      ncuReportAssessment: ncuAssessment(),
    }, runner({
      correctness: result('ok'),
      benchmark: result('benchmark failed', 1),
    }))
    expect(output.decision).toBe('reject')
    expect(output.profileStatus).toBe('skipped')
    expect(output.stages.map(stage => stage.stage)).toEqual(['correctness', 'benchmark'])
  })

  it('rejects profiling without the original skill assessment before running commands', async () => {
    await expect(evaluateCandidate({
      ...baselineRequest,
      profileCommand: 'profile',
      profileContext: 'wsl-rtx5070ti-ncu2026-shape-1m',
    }, runner({ correctness: result('should not run') }))).rejects.toThrow('validated original NCU assessment is required')
  })

  it('rejects a first candidate that is not an explicit baseline', async () => {
    await expect(evaluateCandidate({
      ...baselineRequest,
      candidate: 'candidate-1',
      candidateRole: 'experiment',
    }, runner({ correctness: result('ok') }))).rejects.toThrow('must have candidateRole=baseline')
  })

  it('rejects task-contract drift from the measured baseline', async () => {
    const baseline = await measuredBaseline()
    await expect(evaluateCandidate({
      ...experiment(baseline.candidates),
      benchmarkContext: 'another-machine',
    }, runner({ correctness: result('ok') }))).rejects.toThrow('benchmarkContext must match')
  })

  it('continues a run without emitting a second run-started event', async () => {
    const baseline = await measuredBaseline()
    const output = await evaluateCandidate(experiment(baseline.candidates), runner({
      correctness: result('ok'),
      benchmark: result('KDA_METRIC=8'),
    }))
    expect(output.iteration).toBe(2)
    expect(output.candidates.map(candidate => candidate.candidate)).toEqual(['baseline', 'vectorized-load-v1'])
    expect(output.trajectory.some(event => event.type === 'kda/run-started')).toBe(false)
  })
})
