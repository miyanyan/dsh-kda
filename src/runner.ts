import { randomUUID } from 'node:crypto'
import type {
  KdaCommandRunner,
  KdaDecision,
  KdaEvaluationRequest,
  KdaEvaluationResult,
  KdaStageName,
  KdaStageResult,
  KdaTrajectoryEvent,
} from './types.js'

const DEFAULT_METRIC_PATTERN = String.raw`KDA_METRIC\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)`

function now(): string {
  return new Date().toISOString()
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
}

/** Validate model-provided evaluation input before any command executes. */
export function validateEvaluationRequest(request: KdaEvaluationRequest): void {
  for (const [name, value] of [
    ['task', request.task],
    ['objective', request.objective],
    ['candidate', request.candidate],
    ['workdir', request.workdir],
    ['correctnessCommand', request.correctnessCommand],
  ] as const) {
    if (value.trim() === '') throw new Error(`${name} must not be empty`)
  }
  if (request.benchmarkCommand?.trim() === '') throw new Error('benchmarkCommand must not be empty when provided')
  if (request.profileCommand?.trim() === '') throw new Error('profileCommand must not be empty when provided')
  if (request.baselineMetric !== undefined) requireFinite('baselineMetric', request.baselineMetric)
  requireFinite('minimumImprovementPercent', request.minimumImprovementPercent)
  if (request.minimumImprovementPercent < 0) throw new Error('minimumImprovementPercent must be non-negative')
  if (request.metricPattern !== undefined) {
    try {
      void new RegExp(request.metricPattern, 'g')
    } catch (error) {
      throw new Error(`metricPattern is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** Extract the last numeric capture from benchmark output. */
export function parseMetric(output: string, pattern = DEFAULT_METRIC_PATTERN): number | undefined {
  const expression = new RegExp(pattern, 'g')
  let parsed: number | undefined
  for (const match of output.matchAll(expression)) {
    const raw = match.groups?.metric ?? match[1] ?? match[0]
    const value = Number(raw)
    if (Number.isFinite(value)) parsed = value
  }
  return parsed
}

function improvementPercent(baseline: number, candidate: number, lowerIsBetter: boolean): number {
  if (baseline === 0) return candidate === 0 ? 0 : lowerIsBetter ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY
  const delta = lowerIsBetter ? baseline - candidate : candidate - baseline
  return delta / Math.abs(baseline) * 100
}

function decide(
  request: KdaEvaluationRequest,
  stages: readonly KdaStageResult[],
): { decision: KdaDecision; reason: string; improvementPercent?: number } {
  const correctness = stages.find(stage => stage.stage === 'correctness')
  if (correctness?.ok !== true) return { decision: 'reject', reason: 'Correctness validation failed.' }
  const profile = stages.find(stage => stage.stage === 'profile')
  if (profile !== undefined && !profile.ok) return { decision: 'revise', reason: 'Profiling failed; performance evidence is incomplete.' }
  const benchmark = stages.find(stage => stage.stage === 'benchmark')
  if (benchmark === undefined) return { decision: 'revise', reason: 'Correctness passed, but no benchmark command was provided.' }
  if (!benchmark.ok) return { decision: 'reject', reason: 'Benchmark command failed.' }
  if (benchmark.metric === undefined) {
    return { decision: 'revise', reason: 'Benchmark passed, but no metric could be parsed from its output.' }
  }
  if (request.baselineMetric === undefined) {
    return { decision: 'revise', reason: 'Candidate metric was recorded, but no baseline metric was provided.' }
  }
  const improvement = improvementPercent(request.baselineMetric, benchmark.metric, request.lowerIsBetter)
  if (improvement >= request.minimumImprovementPercent) {
    return {
      decision: 'promote',
      reason: `Correctness passed and the target metric improved by ${improvement.toFixed(3)}%.`,
      improvementPercent: improvement,
    }
  }
  return {
    decision: 'revise',
    reason: `Correctness passed, but the target metric improved by only ${improvement.toFixed(3)}%.`,
    improvementPercent: improvement,
  }
}

/** Run a correctness-first KDA candidate evaluation and build its event ledger. */
export async function evaluateCandidate(
  request: KdaEvaluationRequest,
  runner: KdaCommandRunner,
  signal?: AbortSignal,
): Promise<KdaEvaluationResult> {
  validateEvaluationRequest(request)
  const runId = randomUUID()
  const trajectory: KdaTrajectoryEvent[] = [
    { type: 'kda/run-started', at: now(), runId, task: request.task, objective: request.objective },
    {
      type: 'kda/candidate-proposed',
      at: now(),
      runId,
      candidate: request.candidate,
      ...(request.parentCandidate !== undefined ? { parentCandidate: request.parentCandidate } : {}),
    },
  ]
  const stages: KdaStageResult[] = []

  const execute = async (stage: KdaStageName, command: string, artifact?: string): Promise<KdaStageResult> => {
    const startedAt = now()
    const started = performance.now()
    const commandResult = await runner.run(stage, command, request.workdir, signal)
    const result: KdaStageResult = {
      stage,
      command,
      startedAt,
      durationMs: Math.max(0, performance.now() - started),
      ok: commandResult.exitCode === 0 && !commandResult.timedOut && !commandResult.aborted,
      ...commandResult,
      ...(artifact !== undefined ? { artifact } : {}),
    }
    if (stage === 'benchmark' && result.ok) {
      const metric = parseMetric(result.stdout.text, request.metricPattern)
      if (metric !== undefined) result.metric = metric
      if (request.metricUnit !== undefined) result.metricUnit = request.metricUnit
    }
    stages.push(result)
    trajectory.push({ type: 'kda/stage-completed', at: now(), runId, candidate: request.candidate, result })
    return result
  }

  const correctness = await execute('correctness', request.correctnessCommand)
  if (correctness.ok && request.benchmarkCommand !== undefined) {
    await execute('benchmark', request.benchmarkCommand)
  }
  if (correctness.ok && request.profileCommand !== undefined) {
    await execute('profile', request.profileCommand, request.profileArtifact)
  }

  const outcome = decide(request, stages)
  trajectory.push({
    type: 'kda/decision-made',
    at: now(),
    runId,
    candidate: request.candidate,
    decision: outcome.decision,
    reason: outcome.reason,
    ...(outcome.improvementPercent !== undefined ? { improvementPercent: outcome.improvementPercent } : {}),
  })
  trajectory.push({
    type: 'kda/run-finished',
    at: now(),
    runId,
    candidate: request.candidate,
    decision: outcome.decision,
  })
  const benchmark = stages.find(stage => stage.stage === 'benchmark')
  return {
    schemaVersion: 1,
    runId,
    task: request.task,
    objective: request.objective,
    candidate: request.candidate,
    ...(request.parentCandidate !== undefined ? { parentCandidate: request.parentCandidate } : {}),
    workdir: request.workdir,
    ...(request.baselineMetric !== undefined ? { baselineMetric: request.baselineMetric } : {}),
    ...(benchmark?.metric !== undefined ? { candidateMetric: benchmark.metric } : {}),
    ...(request.metricUnit !== undefined ? { metricUnit: request.metricUnit } : {}),
    ...(outcome.improvementPercent !== undefined ? { improvementPercent: outcome.improvementPercent } : {}),
    decision: outcome.decision,
    reason: outcome.reason,
    stages,
    trajectory,
  }
}
