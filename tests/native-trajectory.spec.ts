import { describe, expect, it } from 'vitest'
import { KdaNativeTrajectoryRecorder } from '../src/native-trajectory.js'
import { evaluateCandidate } from '../src/runner.js'
import type { KdaCommandResult, KdaCommandRunner } from '../src/types.js'

interface AppendedEvent {
  type: string
  data: Record<string, unknown>
}

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

function commandRunner(correctnessExitCode = 0): KdaCommandRunner {
  return {
    async run(stage) {
      return stage === 'correctness'
        ? result('correct', correctnessExitCode)
        : result('KDA_METRIC=8.5')
    },
  }
}

function recorder(events: AppendedEvent[]): KdaNativeTrajectoryRecorder {
  return new KdaNativeTrajectoryRecorder({
    callId: 'call-1',
    rootCallId: 'call-1',
    agent: {
      session: {
        append(type: string, data: Record<string, unknown>) {
          events.push({ type, data })
          return { type, data, seq: events.length - 1, time: Date.now() }
        },
      },
    },
  } as unknown as ConstructorParameters<typeof KdaNativeTrajectoryRecorder>[0])
}

const request = {
  optimizationRunId: 'native-trajectory-run',
  task: 'vector-add',
  objective: 'Reduce latency without changing output.',
  candidate: 'candidate-1',
  hypothesis: 'Vectorized loads reduce instruction count.',
  workdir: '/workspace',
  correctnessCommand: 'validate',
  benchmarkCommand: 'benchmark',
  baselineMetric: 10,
  metricUnit: 'us',
  lowerIsBetter: true,
  minimumImprovementPercent: 5,
} as const

describe('KdaNativeTrajectoryRecorder', () => {
  it('writes only known native dispatch events with a collision-free namespace', async () => {
    const events: AppendedEvent[] = []
    const native = recorder(events)
    await evaluateCandidate(request, commandRunner(), undefined, native.observe)

    expect(new Set(events.map(event => event.type))).toEqual(new Set([
      'tool/code-dispatch-start',
      'tool/code-dispatch',
    ]))
    const starts = events.filter(event => event.type === 'tool/code-dispatch-start')
    const settlements = events.filter(event => event.type === 'tool/code-dispatch')
    expect(starts).toHaveLength(6)
    expect(settlements).toHaveLength(6)
    expect(starts.every(event => String(event.data.subCallId).startsWith('call-1:kda:'))).toBe(true)
    expect(new Set(starts.map(event => event.data.subCallId)).size).toBe(starts.length)
    expect(new Set(settlements.map(event => event.data.subCallId))).toEqual(
      new Set(starts.map(event => event.data.subCallId)),
    )
  })

  it('nests stages and the decision below the candidate node', async () => {
    const events: AppendedEvent[] = []
    const native = recorder(events)
    await evaluateCandidate(request, commandRunner(), undefined, native.observe)

    const starts = events.filter(event => event.type === 'tool/code-dispatch-start')
    const candidate = starts.find(event => event.data.name === 'kda/candidate')
    expect(candidate).toBeDefined()
    const candidateId = candidate?.data.subCallId
    for (const name of ['kda/correctness', 'kda/benchmark', 'kda/decision']) {
      expect(starts.find(event => event.data.name === name)?.data.parentCallId).toBe(candidateId)
    }
    expect(starts.find(event => event.data.name === 'kda/run-started')?.data.parentCallId).toBe('call-1')
    expect(starts.find(event => event.data.name === 'kda/run-finished')?.data.parentCallId).toBe('call-1')
  })

  it('marks a failed correctness stage as an error without adding later stages', async () => {
    const events: AppendedEvent[] = []
    const native = recorder(events)
    await evaluateCandidate(request, commandRunner(1), undefined, native.observe)

    const settled = events.filter(event => event.type === 'tool/code-dispatch')
    const correctness = settled.find(event => event.data.name === 'kda/correctness')
    expect(correctness?.data.isError).toBe(true)
    expect(events.some(event => event.data.name === 'kda/benchmark')).toBe(false)
  })

  it('projects profiling and its evidence-backed diagnosis as separate native nodes', async () => {
    const events: AppendedEvent[] = []
    const native = recorder(events)
    await evaluateCandidate({
      ...request,
      profileCommand: 'profile',
      profileArtifact: 'candidate-1.ncu-rep',
    }, commandRunner(), undefined, native.observe)

    const starts = events.filter(event => event.type === 'tool/code-dispatch-start')
    const profile = starts.find(event => event.data.name === 'kda/profile')
    const diagnosis = starts.find(event => event.data.name === 'kda/profile-diagnosed')
    expect(profile).toBeDefined()
    expect((profile?.data.arguments as Record<string, unknown>).artifact).toBe('candidate-1.ncu-rep')
    expect(diagnosis).toBeDefined()
    expect(diagnosis?.data.parentCallId).toBe(
      starts.find(event => event.data.name === 'kda/candidate')?.data.subCallId,
    )
  })
})
