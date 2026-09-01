import { randomUUID } from 'node:crypto'
import { validateCandidateLineage } from './history.js'
import { analyzeNcuOutput, compareNcuProfiles, withNcuComparison } from './ncu.js'
import type {
  KdaCandidateSummary,
  KdaCommandRunner,
  KdaDecision,
  KdaDecisionGate,
  KdaEvaluationRequest,
  KdaEvaluationResult,
  KdaHypothesisAssessment,
  KdaMechanismVerdict,
  KdaMetricComparison,
  KdaProfileAnalysis,
  KdaProfileStatus,
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
    ['benchmarkCommand', request.benchmarkCommand],
    ['benchmarkContext', request.benchmarkContext],
    ['metricUnit', request.metricUnit],
  ] as const) {
    if (value.trim() === '') throw new Error(`${name} must not be empty`)
  }
  if (request.candidateRole !== undefined && request.candidateRole !== 'baseline' && request.candidateRole !== 'experiment') {
    throw new Error('candidateRole must be baseline or experiment')
  }
  if (request.changeSummary?.trim() === '') throw new Error('changeSummary must not be empty when provided')
  if (request.sourceRevision?.trim() === '') throw new Error('sourceRevision must not be empty when provided')
  if (request.profileCommand?.trim() === '') throw new Error('profileCommand must not be empty when provided')
  if (request.profileContext?.trim() === '') throw new Error('profileContext must not be empty when provided')
  if (request.expectedProfileMetric?.trim() === '') throw new Error('expectedProfileMetric must not be empty when provided')
  requireFinite('minimumImprovementPercent', request.minimumImprovementPercent)
  if (request.minimumImprovementPercent < 0) throw new Error('minimumImprovementPercent must be non-negative')
  if (request.expectedProfileMinimumChangePercent !== undefined) {
    requireFinite('expectedProfileMinimumChangePercent', request.expectedProfileMinimumChangePercent)
    if (request.expectedProfileMinimumChangePercent < 0) throw new Error('expectedProfileMinimumChangePercent must be non-negative')
  }
  const hasExpectedMetric = request.expectedProfileMetric !== undefined
  const hasExpectedDirection = request.expectedProfileDirection !== undefined
  if (hasExpectedMetric !== hasExpectedDirection) {
    throw new Error('expectedProfileMetric and expectedProfileDirection must be provided together')
  }
  if (request.expectedProfileDirection !== undefined
    && request.expectedProfileDirection !== 'increase'
    && request.expectedProfileDirection !== 'decrease'
    && request.expectedProfileDirection !== 'stable') {
    throw new Error('expectedProfileDirection must be increase, decrease, or stable')
  }
  if ((hasExpectedMetric || request.requireProfileForPromotion || request.requireMechanismForPromotion)
    && request.profileCommand === undefined) {
    throw new Error('profileCommand is required when profiler evidence is part of the candidate contract')
  }
  if (request.profileCommand !== undefined && request.profileContext === undefined) {
    throw new Error('profileContext is required when profileCommand is provided')
  }
  if (request.profileCommand !== undefined && request.ncuReportAssessment === undefined) {
    throw new Error('a validated original NCU assessment is required when profileCommand is provided; run the bundled original ncu-report-skill workflow first')
  }
  if (request.profileCommand === undefined && request.ncuReportAssessment !== undefined) {
    throw new Error('an original NCU assessment requires profileCommand')
  }
  if (request.metricPattern !== undefined) {
    try {
      void new RegExp(request.metricPattern, 'g')
    } catch (error) {
      throw new Error(`metricPattern is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const previousCandidates = request.previousCandidates ?? []
  if (request.candidateRole === 'baseline') {
    if (previousCandidates.length > 0) throw new Error('the baseline candidate must be the first candidate in an optimization run')
    if (request.parentCandidate !== undefined) throw new Error('a baseline candidate must not have parentCandidate')
  } else if (previousCandidates.length === 0) {
    throw new Error('the first candidate in an optimization run must have candidateRole=baseline')
  } else {
    const baseline = previousCandidates.find(candidate => candidate.candidateRole === 'baseline')
    if (baseline === undefined) throw new Error('the optimization run has no measured baseline candidate')
    if (baseline.benchmarkContext !== request.benchmarkContext) {
      throw new Error(`benchmarkContext must match the baseline (${baseline.benchmarkContext})`)
    }
    if (baseline.metricUnit !== request.metricUnit) {
      throw new Error(`metricUnit must match the baseline (${baseline.metricUnit})`)
    }
    if (baseline.lowerIsBetter !== request.lowerIsBetter) {
      throw new Error('lowerIsBetter must match the baseline task contract')
    }
    if (baseline.minimumImprovementPercent !== request.minimumImprovementPercent) {
      throw new Error('minimumImprovementPercent must match the baseline task contract')
    }
  }
  validateCandidateLineage(previousCandidates, request.candidate, request.parentCandidate)
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

function improvementPercent(baseline: number, candidate: number, lowerIsBetter: boolean): number | undefined {
  if (baseline === 0) return candidate === 0 ? 0 : undefined
  const delta = lowerIsBetter ? baseline - candidate : candidate - baseline
  const improvement = delta / Math.abs(baseline) * 100
  return Number.isFinite(improvement) ? improvement : undefined
}

function findProfileReference(request: KdaEvaluationRequest): KdaCandidateSummary | undefined {
  const history = request.previousCandidates ?? []
  if (request.parentCandidate !== undefined) {
    const parent = history.find(candidate => candidate.candidate === request.parentCandidate && candidate.profileAnalysis !== undefined)
    if (parent !== undefined) return parent
  }
  return history.find(candidate => candidate.candidateRole === 'baseline' && candidate.profileAnalysis !== undefined)
}

function measuredBaseline(request: KdaEvaluationRequest): number | undefined {
  return request.previousCandidates?.find(candidate => candidate.candidateRole === 'baseline')?.candidateMetric
}

function limitation(analysis: KdaProfileAnalysis, summary: string): KdaProfileAnalysis {
  return {
    ...analysis,
    observations: [...analysis.observations, { kind: 'limitation', summary, evidence: [] }],
    limitations: [...analysis.limitations, summary],
    nextExperiment: {
      action: 'Collect the reference and candidate profiles in the same explicitly named context.',
      rationale: summary,
      requiredMetrics: analysis.keyMetrics.map(metric => metric.canonicalName ?? metric.name),
    },
  }
}

function attachComparison(
  request: KdaEvaluationRequest,
  analysis: KdaProfileAnalysis,
): KdaProfileAnalysis {
  const reference = findProfileReference(request)
  if (reference?.profileAnalysis === undefined) {
    return limitation(analysis, 'No profiled reference candidate is available, so the performance mechanism cannot be compared.')
  }
  if (request.profileContext === undefined || reference.profileContext === undefined) {
    return limitation(analysis, 'Profile context was not recorded for both candidates; cross-environment metric comparison is disabled.')
  }
  if (request.profileContext !== reference.profileContext) {
    return limitation(
      analysis,
      `Profile contexts differ (${reference.profileContext} vs ${request.profileContext}); metrics are shown without a causal delta.`,
    )
  }
  const comparison = compareNcuProfiles(
    reference.candidate,
    request.candidate,
    request.profileContext,
    reference.profileAnalysis,
    analysis,
  )
  if (comparison.metrics.length === 0) {
    return limitation(withNcuComparison(analysis, comparison), 'Reference and candidate profiles contain no aligned same-unit metrics.')
  }
  return withNcuComparison(analysis, comparison)
}

function profileStatus(
  request: KdaEvaluationRequest,
  stage: KdaStageResult | undefined,
  analysis: KdaProfileAnalysis | undefined,
): KdaProfileStatus {
  if (request.profileCommand === undefined) return 'not-requested'
  if (stage === undefined) return 'skipped'
  if (!stage.ok) return 'failed'
  if (analysis === undefined || analysis.parser === 'none' || analysis.metricCount === 0) return 'no-parseable-metrics'
  if (analysis.comparison !== undefined && analysis.comparison.metrics.length > 0) return 'comparable'
  return 'current-only'
}

function matchingComparison(analysis: KdaProfileAnalysis, expectedMetric: string): KdaMetricComparison | undefined {
  const normalized = expectedMetric.toLowerCase().trim()
  return analysis.comparison?.metrics.find(metric =>
    metric.canonicalName.toLowerCase() === normalized || metric.name.toLowerCase() === normalized)
}

function assessHypothesis(
  request: KdaEvaluationRequest,
  status: KdaProfileStatus,
  analysis: KdaProfileAnalysis | undefined,
): KdaHypothesisAssessment {
  const expectedMetric = request.expectedProfileMetric
  const expectedDirection = request.expectedProfileDirection
  const threshold = request.expectedProfileMinimumChangePercent ?? 1
  const base = {
    ...(expectedMetric !== undefined ? { expectedMetric } : {}),
    ...(expectedDirection !== undefined ? { expectedDirection } : {}),
    ...(expectedMetric !== undefined ? { expectedMinimumChangePercent: threshold } : {}),
  }
  if (expectedMetric === undefined || expectedDirection === undefined) {
    return {
      verdict: 'unverified',
      evidence: [],
      limitations: ['No expected profiler metric and direction were declared before evaluating the candidate.'],
      ...base,
    }
  }
  if (status !== 'comparable' || analysis === undefined) {
    return {
      verdict: 'unverified',
      evidence: [],
      limitations: [`Profiler evidence is ${status}; a same-context reference comparison is required.`],
      ...base,
    }
  }
  const observed = matchingComparison(analysis, expectedMetric)
  if (observed === undefined) {
    return {
      verdict: 'unverified',
      evidence: [],
      limitations: [`Expected metric ${expectedMetric} was not aligned between the reference and candidate profiles.`],
      ...base,
    }
  }
  const percent = observed.deltaPercent
  if (percent === undefined) {
    return {
      verdict: 'unverified',
      observed,
      evidence: [],
      limitations: [`Expected metric ${expectedMetric} has a zero reference value, so a percentage direction cannot be verified.`],
      ...base,
    }
  }
  let verdict: KdaMechanismVerdict
  if (expectedDirection === 'stable') {
    verdict = Math.abs(percent) <= threshold ? 'supported' : 'contradicted'
  } else {
    const signed = expectedDirection === 'increase' ? percent : -percent
    verdict = signed >= threshold ? 'supported' : signed > 0 ? 'partially-supported' : signed <= -threshold ? 'contradicted' : 'unverified'
  }
  const directionText = percent >= 0 ? `increased by ${percent.toFixed(2)}%` : `decreased by ${Math.abs(percent).toFixed(2)}%`
  return {
    verdict,
    observed,
    evidence: [`${observed.name} ${directionText} (${observed.baselineValue} → ${observed.candidateValue}${observed.unit === undefined ? '' : ` ${observed.unit}`}).`],
    limitations: analysis.limitations,
    ...base,
  }
}

function decide(
  request: KdaEvaluationRequest,
  stages: readonly KdaStageResult[],
  status: KdaProfileStatus,
  mechanism: KdaHypothesisAssessment,
  baselineMetric: number | undefined,
): { decision: KdaDecision; reason: string; improvementPercent?: number } {
  const correctness = stages.find(stage => stage.stage === 'correctness')
  if (correctness?.ok !== true) return { decision: 'reject', reason: 'Correctness validation failed.' }
  const benchmark = stages.find(stage => stage.stage === 'benchmark')
  if (benchmark === undefined) return { decision: 'reject', reason: 'The required benchmark stage did not run.' }
  if (!benchmark.ok) return { decision: 'reject', reason: 'Benchmark command failed.' }
  if (benchmark.metric === undefined) {
    return { decision: 'revise', reason: 'Benchmark passed, but no metric could be parsed from its output.' }
  }
  if (request.candidateRole === 'baseline') {
    return { decision: 'baseline', reason: 'Correctness passed and the measured baseline was recorded.' }
  }
  if (baselineMetric === undefined) {
    return { decision: 'revise', reason: 'Candidate metric was recorded, but the measured baseline has no benchmark metric.' }
  }
  const improvement = improvementPercent(baselineMetric, benchmark.metric, request.lowerIsBetter)
  if (improvement === undefined) {
    return { decision: 'revise', reason: 'The zero baseline cannot produce a finite improvement percentage.' }
  }
  if (improvement < request.minimumImprovementPercent) {
    return {
      decision: 'revise',
      reason: `Correctness passed, but the target metric improved by only ${improvement.toFixed(3)}%.`,
      improvementPercent: improvement,
    }
  }
  if (request.requireProfileForPromotion === true && status !== 'current-only' && status !== 'comparable') {
    return {
      decision: 'revise',
      reason: `The performance threshold passed, but required profiler evidence is ${status}.`,
      improvementPercent: improvement,
    }
  }
  if (request.requireMechanismForPromotion === true
    && mechanism.verdict !== 'supported'
    && mechanism.verdict !== 'partially-supported') {
    return {
      decision: 'revise',
      reason: `The performance threshold passed, but the declared mechanism is ${mechanism.verdict}.`,
      improvementPercent: improvement,
    }
  }
  return {
    decision: 'promote',
    reason: `Correctness passed and the target metric improved by ${improvement.toFixed(3)}%.`,
    improvementPercent: improvement,
  }
}

function decisionGates(
  request: KdaEvaluationRequest,
  stages: readonly KdaStageResult[],
  status: KdaProfileStatus,
  mechanism: KdaHypothesisAssessment,
  baselineMetric: number | undefined,
): KdaDecisionGate[] {
  const correctness = stages.find(stage => stage.stage === 'correctness')
  const benchmark = stages.find(stage => stage.stage === 'benchmark')
  const correctnessPassed = correctness?.ok === true

  let benchmarkStatus: KdaDecisionGate['status'] = 'unavailable'
  let benchmarkSummary = 'The benchmark did not produce a usable promotion metric.'
  const benchmarkEvidence: string[] = []
  if (benchmark !== undefined) {
    benchmarkEvidence.push(`command exit=${benchmark.exitCode ?? 'none'}; parsed metric=${benchmark.metric ?? 'none'} ${request.metricUnit}`)
    if (!benchmark.ok || benchmark.metric === undefined) {
      benchmarkStatus = 'failed'
      benchmarkSummary = benchmark.ok ? 'The benchmark completed but its promotion metric was not parsed.' : 'The benchmark command failed.'
    } else if (request.candidateRole === 'baseline') {
      benchmarkStatus = 'passed'
      benchmarkSummary = `Recorded the measured baseline at ${benchmark.metric} ${request.metricUnit}.`
    } else if (baselineMetric === undefined) {
      benchmarkStatus = 'failed'
      benchmarkSummary = 'A candidate metric exists, but no measured baseline metric is available.'
    } else {
      const improvement = improvementPercent(baselineMetric, benchmark.metric, request.lowerIsBetter)
      if (improvement === undefined) {
        benchmarkStatus = 'failed'
        benchmarkSummary = 'The zero baseline cannot produce a finite improvement percentage.'
      } else {
        benchmarkStatus = improvement >= request.minimumImprovementPercent ? 'passed' : 'failed'
        benchmarkSummary = `${improvement.toFixed(3)}% improvement versus a ${request.minimumImprovementPercent}% promotion threshold.`
        benchmarkEvidence.push(`${baselineMetric} → ${benchmark.metric} ${request.metricUnit}; ${request.lowerIsBetter ? 'lower' : 'higher'} is better`)
      }
    }
  }

  const profileRequired = request.requireProfileForPromotion === true
  const profileUsable = status === 'current-only' || status === 'comparable'
  const mechanismRequired = request.requireMechanismForPromotion === true
  const mechanismSupported = mechanism.verdict === 'supported' || mechanism.verdict === 'partially-supported'
  return [
    {
      name: 'correctness',
      status: correctness === undefined ? 'unavailable' : correctnessPassed ? 'passed' : 'failed',
      blocking: true,
      summary: correctness === undefined ? 'Correctness validation did not run.' : correctnessPassed ? 'Correctness validation passed.' : 'Correctness validation failed.',
      evidence: correctness === undefined ? [] : [`command exit=${correctness.exitCode ?? 'none'}; duration=${correctness.durationMs.toFixed(0)} ms`],
    },
    {
      name: 'benchmark',
      status: benchmarkStatus,
      blocking: true,
      summary: benchmarkSummary,
      evidence: benchmarkEvidence,
    },
    {
      name: 'profile',
      status: profileRequired ? profileUsable ? 'passed' : 'failed' : 'advisory',
      blocking: profileRequired,
      summary: profileRequired
        ? profileUsable ? `Required profiler evidence is ${status}.` : `Required profiler evidence is ${status}; promotion is blocked.`
        : `Profiler evidence is advisory (${status}); it explains the result but does not independently block promotion.`,
      evidence: [`profile status=${status}`],
    },
    {
      name: 'mechanism',
      status: mechanismRequired ? mechanismSupported ? 'passed' : 'failed' : 'advisory',
      blocking: mechanismRequired,
      summary: mechanismRequired
        ? mechanismSupported ? `Required NCU mechanism verdict is ${mechanism.verdict}.` : `Required NCU mechanism verdict is ${mechanism.verdict}; promotion is blocked.`
        : `NCU mechanism verdict is advisory (${mechanism.verdict}); it guides the next experiment.`,
      evidence: [...mechanism.evidence, ...mechanism.limitations].slice(0, 6),
    },
  ]
}

function compactProfile(profile: KdaProfileAnalysis | undefined): KdaProfileAnalysis | undefined {
  if (profile === undefined) return undefined
  const keep = new Map<string, typeof profile.metrics[number]>()
  for (const metric of [...profile.keyMetrics, ...profile.topStalls]) {
    keep.set(`${metric.canonicalName ?? ''}\u0000${metric.name}`, metric)
  }
  for (const comparison of profile.comparison?.metrics ?? []) {
    const metric = profile.metrics.find(item =>
      item.canonicalName === comparison.canonicalName || item.name === comparison.name)
    if (metric !== undefined) keep.set(`${metric.canonicalName ?? ''}\u0000${metric.name}`, metric)
  }
  return { ...profile, metrics: [...keep.values()] }
}

function candidateSummary(
  request: KdaEvaluationRequest,
  evaluationId: string,
  iteration: number,
  decision: KdaDecision,
  effectiveBaseline: number | undefined,
  candidateMetric: number | undefined,
  improvement: number | undefined,
  status: KdaProfileStatus,
  mechanism: KdaHypothesisAssessment,
  profile: KdaProfileAnalysis | undefined,
): KdaCandidateSummary {
  const compact = compactProfile(profile)
  return {
    evaluationId,
    candidate: request.candidate,
    candidateRole: request.candidateRole,
    ...(request.parentCandidate !== undefined ? { parentCandidate: request.parentCandidate } : {}),
    iteration,
    hypothesis: request.hypothesis,
    ...(request.changeSummary !== undefined ? { changeSummary: request.changeSummary } : {}),
    ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}),
    ...(effectiveBaseline !== undefined ? { baselineMetric: effectiveBaseline } : {}),
    ...(candidateMetric !== undefined ? { candidateMetric } : {}),
    metricUnit: request.metricUnit,
    ...(improvement !== undefined ? { improvementPercent: improvement } : {}),
    lowerIsBetter: request.lowerIsBetter,
    minimumImprovementPercent: request.minimumImprovementPercent,
    decision,
    benchmarkContext: request.benchmarkContext,
    ...(request.profileContext !== undefined ? { profileContext: request.profileContext } : {}),
    profileStatus: status,
    mechanismVerdict: mechanism.verdict,
    ...(profile !== undefined ? { profileBottleneck: profile.bottleneck } : {}),
    ...(compact !== undefined ? { profileAnalysis: compact } : {}),
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
  const ncuReportAssessment = request.ncuReportAssessment
  const runId = request.optimizationRunId
  const evaluationId = randomUUID()
  const previousCandidates = [...(request.previousCandidates ?? [])]
    .sort((left, right) => left.iteration - right.iteration)
    .map((candidate, index) => ({ ...candidate, iteration: index }))
  const iteration = previousCandidates.length
  const trajectory: KdaTrajectoryEvent[] = []
  const emit = (event: KdaTrajectoryEvent): void => {
    trajectory.push(event)
    observer?.(event)
  }
  if (iteration === 0) {
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
  if (correctness.ok) await execute('benchmark', request.benchmarkCommand)

  let profileAnalysis: KdaProfileAnalysis | undefined
  let profileStage: KdaStageResult | undefined
  if (correctness.ok
    && stages.find(stage => stage.stage === 'benchmark')?.ok === true
    && request.profileCommand !== undefined) {
    profileStage = await execute('profile', request.profileCommand, request.profileArtifact)
    if (profileStage.ok) {
      profileAnalysis = analyzeNcuOutput(`${profileStage.stdout.text}\n${profileStage.stderr.text}`)
      if (profileAnalysis.parser !== 'none' && profileAnalysis.metricCount > 0) {
        profileAnalysis = attachComparison(request, profileAnalysis)
      }
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

  const status = profileStatus(request, profileStage, profileAnalysis)
  const mechanism = assessHypothesis(request, status, profileAnalysis)
  emit({
    type: 'kda/mechanism-assessed',
    at: now(),
    runId,
    evaluationId,
    candidate: request.candidate,
    assessment: mechanism,
  })
  const baselineMetric = request.candidateRole === 'baseline'
    ? stages.find(stage => stage.stage === 'benchmark')?.metric
    : measuredBaseline(request)
  const outcome = decide(request, stages, status, mechanism, baselineMetric)
  const gates = decisionGates(request, stages, status, mechanism, baselineMetric)
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
  const effectiveBaseline = request.candidateRole === 'baseline' ? benchmark?.metric : baselineMetric
  const contextWarnings: string[] = []
  if (request.profileContext !== undefined && request.benchmarkContext !== request.profileContext) {
    contextWarnings.push(`Benchmark and profile contexts differ (${request.benchmarkContext} vs ${request.profileContext}); profile duration is not directly comparable to the promotion metric.`)
  }
  const current = candidateSummary(
    request,
    evaluationId,
    iteration,
    outcome.decision,
    effectiveBaseline,
    benchmark?.metric,
    outcome.improvementPercent,
    status,
    mechanism,
    profileAnalysis,
  )
  return {
    schemaVersion: 1,
    runId,
    evaluationId,
    iteration,
    task: request.task,
    objective: request.objective,
    candidate: request.candidate,
    candidateRole: request.candidateRole,
    ...(request.parentCandidate !== undefined ? { parentCandidate: request.parentCandidate } : {}),
    hypothesis: request.hypothesis,
    ...(request.changeSummary !== undefined ? { changeSummary: request.changeSummary } : {}),
    ...(request.sourceRevision !== undefined ? { sourceRevision: request.sourceRevision } : {}),
    workdir: request.workdir,
    benchmarkContext: request.benchmarkContext,
    ...(request.profileContext !== undefined ? { profileContext: request.profileContext } : {}),
    ...(effectiveBaseline !== undefined ? { baselineMetric: effectiveBaseline } : {}),
    ...(benchmark?.metric !== undefined ? { candidateMetric: benchmark.metric } : {}),
    metricUnit: request.metricUnit,
    ...(outcome.improvementPercent !== undefined ? { improvementPercent: outcome.improvementPercent } : {}),
    lowerIsBetter: request.lowerIsBetter,
    minimumImprovementPercent: request.minimumImprovementPercent,
    decision: outcome.decision,
    reason: outcome.reason,
    stages,
    profileStatus: status,
    ...(profileAnalysis !== undefined ? { profileAnalysis } : {}),
    mechanismAssessment: mechanism,
    ...(ncuReportAssessment === undefined ? {} : { ncuReportAssessment }),
    promotionPolicy: {
      requireProfile: request.requireProfileForPromotion === true,
      requireMechanism: request.requireMechanismForPromotion === true,
    },
    decisionGates: gates,
    contextWarnings,
    candidates: [...previousCandidates, current],
    trajectory,
  }
}
