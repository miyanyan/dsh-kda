import { describe, expect, it } from 'vitest'
import { evaluateCandidate, parseMetric } from '../src/runner.js'
import type { KdaCommandResult, KdaCommandRunner, KdaStageName } from '../src/types.js'

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

const baseRequest = {
  task: 'vector-add',
  objective: 'Minimize latency while preserving exact output.',
  candidate: 'candidate-1',
  workdir: '/workspace',
  correctnessCommand: 'validate',
  benchmarkCommand: 'benchmark',
  baselineMetric: 10,
  metricUnit: 'us',
  lowerIsBetter: true,
  minimumImprovementPercent: 5,
} as const

describe('parseMetric', () => {
  it('uses the final emitted metric', () => {
    expect(parseMetric('KDA_METRIC=9\nKDA_METRIC=7.5')).toBe(7.5)
  })

  it('supports a named capture group', () => {
    expect(parseMetric('latency: 4.25 us', String.raw`latency:\s*(?<metric>\d+\.\d+)`)).toBe(4.25)
  })
})

describe('evaluateCandidate', () => {
  it('promotes a correct candidate that clears the performance threshold', async () => {
    const output = await evaluateCandidate(baseRequest, runner({
      correctness: result('ok'),
      benchmark: result('KDA_METRIC=8.5'),
    }))
    expect(output.decision).toBe('promote')
    expect(output.improvementPercent).toBeCloseTo(15)
    expect(output.trajectory.map(event => event.type)).toEqual([
      'kda/run-started',
      'kda/candidate-proposed',
      'kda/stage-completed',
      'kda/stage-completed',
      'kda/decision-made',
      'kda/run-finished',
    ])
  })

  it('stops after correctness failure', async () => {
    const output = await evaluateCandidate(baseRequest, runner({ correctness: result('bad', 1) }))
    expect(output.decision).toBe('reject')
    expect(output.stages).toHaveLength(1)
  })

  it('requires a baseline before promotion', async () => {
    const { baselineMetric: _baseline, ...withoutBaseline } = baseRequest
    const output = await evaluateCandidate(withoutBaseline, runner({
      correctness: result('ok'),
      benchmark: result('KDA_METRIC=8.5'),
    }))
    expect(output.decision).toBe('revise')
    expect(output.reason).toContain('baseline')
  })
})
