import { randomUUID } from 'node:crypto'
import { validateCandidateLineage } from './history.js'
import { analyzeNcuOutput } from './ncu.js'
import type {
  KdaCandidateSummary,
  KdaCommandRunner,
  KdaDecision,
  KdaEvaluationRequest,
  KdaEvaluationResult,
  KdaProfileAnalysis,
  KdaStageName,
  KdaStageResult,
  KdaTrajectoryEvent,
  KdaTrajectoryObserver,
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
    ['optimizationRunId', request.optimizationRunId],
    ['task', request.task],
    ['objective', request.objective],
    ['candidate', request.candidate],
    ['hypothesis', request.hypothesis],
    ['workdir', request.workdir],
    ['correctnessCommand', request.correctnessCommand],
  ] as const) {
    if (value.trim() === '') throw new Error(`${name} must not be empty`)
  }
  if (request.changeSummary?.trim() === '') throw new Error('changeSummary must not be empty when provided')
  if (request.sourceRevision?.trim() === '') throw new Error('sourceRevision must not be empty when provided')
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
  validateCandidateLineage(request.previousCandidates ?? [], request.candidate, request.parentCandidate)
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

function candidateSummary(
  request: KdaEvaluationRequest,
  evaluationId: string,
  iteration: number,
  decision: KdaDecision,
  candidateMetric: number | undefined,
  improvement: number | undefined,
  profile: KdaProfileAnalysis | undefined,
): KdaCandidateSummary {
  return {
    evaluationId,
    candidate: request.candidate,
    ...(request.parentCandidate !== undefined ? { parentCandidate: request.parentCandidate } : {}),
    iteration,
    hypothesis: request.hypothesis,
    ...(request.changeSummary !== undefined ? { changeSummary: request.changeSummary } : {}),
    ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}),
    ...(request.baselineMetric !== undefined ? { baselineMetric: request.baselineMetric } : {}),
    ...(candidateMetric !== undefined ? { candidateMetric } : {}),
    ...(request.metricUnit !== undefined ? { metricUnit: request.metricUnit } : {}),
    ...(improvement !== undefined ? { improvementPercent: improvement } : {}),
    decision,
    ...(profile !== undefined ? { profileBottleneck: profile.bottleneck } : {}),
  }
}

/** Run a correctness-first KDA candidate evaluation and build its replayable run projection. */
export async function evaluateCandidate(
  request: KdaEvaluationRequest,
  runner: KdaCommandRunner,
  signal?: AbortSignal,
  observer?: KdaTrajectoryObserver,
): Promise<KdaEvaluationResult> {
  validateEvaluationRequest(request)
  const runId = request.optimizationRunId
  const evaluationId = randomUUID()
  const previousCandidates = [...(request.previousCandidates ?? [])]
  const iteration = previousCandidates.length + 1
  const trajectory: KdaTrajectoryEvent[] = []
  const emit = (event: KdaTrajectoryEvent): void => {
    trajectory.push(event)
    observer?.(event)
  }
  if (iteration === 1) {
    emit({ type: 'kda/run-started', at: now(), runId, task: request.task, objective: request.objective })
  }
  emit({
    type: 'kda/candidate-proposed',
    at: now(),
    runId,
    evaluationId,
    candidate: request.candidate,
    ...(request.parentCandidate !== undefined ? { parentCandidate: request.parentCandidate } : {}),
    hypothesis: request.hypothesis,
  })
  const stages: KdaStageResult[] = []

  const execute = async (stage: KdaStageName, command: string, artifact?: string): Promise<KdaStageResult> => {
    const startedAt = now()
    emit({
      type: 'kda/stage-started',
      at: startedAt,
      runId,
      evaluationId,
      candidate: request.candidate,
      stage,
      command,
      ...(artifact !== undefined ? { artifact } : {}),
    })
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
    emit({ type: 'kda/stage-completed', at: now(), runId, evaluationId, candidate: request.candidate, result })
    return result
  }

  const correctness = await execute('correctness', request.correctnessCommand)
  if (correctness.ok && request.benchmarkCommand !== undefined) {
    await execute('benchmark', request.benchmarkCommand)
  }
  let profileAnalysis: KdaProfileAnalysis | undefined
  if (correctness.ok && request.profileCommand !== undefined) {
    const profile = await execute('profile', request.profileCommand, request.profileArtifact)
    if (profile.ok) {
      profileAnalysis = analyzeNcuOutput(`${profile.stdout.text}\n${profile.stderr.text}`)
      emit({
        type: 'kda/profile-diagnosed',
        at: now(),
        runId,
        evaluationId,
        candidate: request.candidate,
        analysis: profileAnalysis,
      })
    }
  }

  const outcome = decide(request, stages)
  emit({
    type: 'kda/decision-made',
    at: now(),
    runId,
    evaluationId,
    candidate: request.candidate,
    decision: outcome.decision,
    reason: outcome.reason,
    ...(outcome.improvementPercent !== undefined ? { improvementPercent: outcome.improvementPercent } : {}),
  })
  emit({
    type: 'kda/candidate-finished',
    at: now(),
    runId,
    evaluationId,
    candidate: request.candidate,
    decision: outcome.decision,
  })
  if (outcome.decision === 'promote') {
    emit({ type: 'kda/run-finished', at: now(), runId, candidate: request.candidate, decision: 'promote' })
  }
  const benchmark = stages.find(stage => stage.stage === 'benchmark')
  const current = candidateSummary(
    request,
    evaluationId,
    iteration,
    outcome.decision,
    benchmark?.metric,
    outcome.improvementPercent,
    profileAnalysis,
  )
  return {
    schemaVersion: 2,
    runId,
    evaluationId,
    iteration,
    task: request.task,
    objective: request.objective,
    candidate: request.candidate,
    ...(request.parentCandidate !== undefined ? { parentCandidate: request.parentCandidate } : {}),
    hypothesis: request.hypothesis,
    ...(request.changeSummary !== undefined ? { changeSummary: request.changeSummary } : {}),
    ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}),
    workdir: request.workdir,
    ...(request.baselineMetric !== undefined ? { baselineMetric: request.baselineMetric } : {}),
    ...(benchmark?.metric !== undefined ? { candidateMetric: benchmark.metric } : {}),
    ...(request.metricUnit !== undefined ? { metricUnit: request.metricUnit } : {}),
    ...(outcome.improvementPercent !== undefined ? { improvementPercent: outcome.improvementPercent } : {}),
    decision: outcome.decision,
    reason: outcome.reason,
    stages,
    ...(profileAnalysis !== undefined ? { profileAnalysis } : {}),
    candidates: [...previousCandidates, current],
    trajectory,
  }
}
