export type KdaDecisionView = 'baseline' | 'promote' | 'revise' | 'reject'
export type KdaProfileStatusView = 'not-requested' | 'skipped' | 'failed' | 'no-parseable-metrics' | 'current-only' | 'comparable'
export type KdaMechanismVerdictView = 'supported' | 'partially-supported' | 'contradicted' | 'unverified'
export type KdaDecisionGateStatusView = 'passed' | 'failed' | 'advisory' | 'unavailable'

export interface KdaDecisionGateView {
  name: 'correctness' | 'benchmark' | 'profile' | 'mechanism'
  status: KdaDecisionGateStatusView
  blocking: boolean
  summary: string
  evidence: string[]
}

export type KdaNcuDimensionNameView = 'launch-occupancy' | 'workload-balance' | 'stall-hotspots' | 'tensor-core' | 'timeline' | 'memory'
export type KdaNcuDimensionStatusView = 'analyzed' | 'missing-evidence' | 'not-applicable'
export type KdaNcuPatternIdView = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N'

export interface KdaNcuReportSignalView {
  statement: string
  source: string
  metric?: string
  value?: number
  unit?: string
}

export interface KdaNcuDimensionAssessmentView {
  dimension: KdaNcuDimensionNameView
  status: KdaNcuDimensionStatusView
  conclusion: string
  signals: KdaNcuReportSignalView[]
  limitations: string[]
}

export interface KdaNcuPatternMatchView {
  id: KdaNcuPatternIdView
  name: string
  confidence: 'low' | 'medium' | 'high'
  estimatedSpeedupPercent?: number
  signals: string[]
  cause: string
  firstLineFix: string
  exceptions: string[]
}

export interface KdaNcuRuleFindingView {
  name: string
  severity: 'info' | 'warning' | 'optimization'
  message: string
  estimatedSpeedupPercent?: number
  evidence: string[]
}

export interface KdaNcuRankedRecommendationView {
  rank: number
  action: string
  rationale: string
  expectedImpact: string
  supportingPatterns: KdaNcuPatternIdView[]
  requiredMetrics: string[]
}

export interface KdaNcuReportAssessmentView {
  source: 'mit-han-lab/ncu-report-skill'
  sourceCommit: string
  reportPath: string
  reportMarkdown: string
  fullReportPath?: string
  sourceReportPath?: string
  analysisPath?: string
  targetHardware: string
  targetKernel: string
  workload: string
  dimensions: KdaNcuDimensionAssessmentView[]
  patterns: KdaNcuPatternMatchView[]
  rules: KdaNcuRuleFindingView[]
  primaryDiagnosis: string
  secondaryFindings: string[]
  recommendations: KdaNcuRankedRecommendationView[]
  limitations: string[]
}

export interface KdaStageView {
  stage: 'correctness' | 'benchmark' | 'profile'
  command?: string
  startedAt?: string
  ok: boolean
  durationMs: number
  exitCode?: number | null
  timedOut?: boolean
  aborted?: boolean
  metric?: number
  metricUnit?: string
  artifact?: string
  stdout?: { text?: string; truncated?: boolean; spillPath?: string }
  stderr?: { text?: string; truncated?: boolean; spillPath?: string }
}

export interface KdaMetricView {
  name: string
  value: number
  unit?: string
  canonicalName?: string
  section?: string
  kernelName?: string
  launchId?: string
}

export interface KdaMetricComparisonView {
  canonicalName: string
  name: string
  unit?: string
  baselineValue: number
  candidateValue: number
  delta: number
  deltaPercent?: number
}

export interface KdaCandidateView {
  evaluationId?: string
  candidate: string
  candidateRole?: 'baseline' | 'experiment'
  parentCandidate?: string
  iteration: number
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  lowerIsBetter?: boolean
  minimumImprovementPercent?: number
  decision: KdaDecisionView
  benchmarkContext?: string
  profileContext?: string
  profileStatus?: KdaProfileStatusView
  mechanismVerdict?: KdaMechanismVerdictView
  profileBottleneck?: string
}

export interface KdaProfileView {
  parser: 'ncu-csv' | 'kda-lines' | 'none'
  bottleneck: string
  confidence: 'low' | 'medium'
  metricCount: number
  metrics: KdaMetricView[]
  evidence: string[]
  observations: Array<{ kind: 'measurement' | 'comparison' | 'limitation'; summary: string; evidence: string[] }>
  diagnosis: string
  limitations: string[]
  recommendations: string[]
  keyMetrics: KdaMetricView[]
  topStalls: KdaMetricView[]
  kernelNames: string[]
  launchIds: string[]
  nextExperiment: { action: string; rationale: string; requiredMetrics: string[] }
  comparison?: {
    referenceCandidate: string
    candidate: string
    profileContext: string
    metrics: KdaMetricComparisonView[]
    warnings: string[]
  }
}

export interface KdaMechanismAssessmentView {
  verdict: KdaMechanismVerdictView
  expectedMetric?: string
  expectedDirection?: 'increase' | 'decrease' | 'stable'
  expectedMinimumChangePercent?: number
  observed?: KdaMetricComparisonView
  evidence: string[]
  limitations: string[]
}

export interface KdaResultView {
  schemaVersion: 1
  runId: string
  evaluationId?: string
  iteration?: number
  task?: string
  objective?: string
  candidate: string
  candidateRole: 'baseline' | 'experiment'
  parentCandidate?: string
  hypothesis?: string
  changeSummary?: string
  sourceRevision?: string
  workdir?: string
  benchmarkContext?: string
  profileContext?: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  lowerIsBetter?: boolean
  minimumImprovementPercent?: number
  decision: KdaDecisionView
  reason: string
  stages: KdaStageView[]
  candidates?: KdaCandidateView[]
  profileStatus: KdaProfileStatusView
  profileAnalysis?: KdaProfileView
  mechanismAssessment: KdaMechanismAssessmentView
  ncuReportAssessment?: KdaNcuReportAssessmentView
  promotionPolicy?: { requireProfile: boolean; requireMechanism: boolean }
  decisionGates: KdaDecisionGateView[]
  contextWarnings: string[]
}

export interface KdaEvaluationView {
  id: string
  callId: string
  seq: number
  time: number
  result: KdaResultView
}

export interface KdaRunView {
  runId: string
  task?: string
  objective?: string
  updatedAt: number
  evaluations: KdaEvaluationView[]
  lineage: KdaCandidateView[]
  baseline?: KdaCandidateView
  best?: KdaCandidateView
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDecision(value: unknown): value is KdaDecisionView {
  return value === 'baseline' || value === 'promote' || value === 'revise' || value === 'reject'
}

function isProfileStatus(value: unknown): value is KdaProfileStatusView {
  return value === 'not-requested' || value === 'skipped' || value === 'failed' || value === 'no-parseable-metrics'
    || value === 'current-only' || value === 'comparable'
}

function isMechanismVerdict(value: unknown): value is KdaMechanismVerdictView {
  return value === 'supported' || value === 'partially-supported' || value === 'contradicted' || value === 'unverified'
}

function isDecisionGateStatus(value: unknown): value is KdaDecisionGateStatusView {
  return value === 'passed' || value === 'failed' || value === 'advisory' || value === 'unavailable'
}

function isNcuDimension(value: unknown): value is KdaNcuDimensionNameView {
  return value === 'launch-occupancy' || value === 'workload-balance' || value === 'stall-hotspots'
    || value === 'tensor-core' || value === 'timeline' || value === 'memory'
}

function isNcuDimensionStatus(value: unknown): value is KdaNcuDimensionStatusView {
  return value === 'analyzed' || value === 'missing-evidence' || value === 'not-applicable'
}

function isNcuPatternId(value: unknown): value is KdaNcuPatternIdView {
  return typeof value === 'string' && /^[A-N]$/.test(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function metrics(value: unknown): KdaMetricView[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is KdaMetricView =>
    isObject(item) && typeof item.name === 'string' && typeof item.value === 'number' && Number.isFinite(item.value))
}

function comparisonMetrics(value: unknown): KdaMetricComparisonView[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is KdaMetricComparisonView =>
    isObject(item)
    && typeof item.canonicalName === 'string'
    && typeof item.name === 'string'
    && typeof item.baselineValue === 'number'
    && typeof item.candidateValue === 'number'
    && typeof item.delta === 'number')
}

function profile(value: unknown): KdaProfileView | undefined {
  if (!isObject(value)) return undefined
  const parser = value.parser === 'ncu-csv' || value.parser === 'kda-lines' ? value.parser : 'none'
  const next = isObject(value.nextExperiment) ? value.nextExperiment : {}
  const rawComparison = isObject(value.comparison) ? value.comparison : undefined
  const comparison = rawComparison !== undefined
    && typeof rawComparison.referenceCandidate === 'string'
    && typeof rawComparison.candidate === 'string'
    && typeof rawComparison.profileContext === 'string'
    ? {
        referenceCandidate: rawComparison.referenceCandidate,
        candidate: rawComparison.candidate,
        profileContext: rawComparison.profileContext,
        metrics: comparisonMetrics(rawComparison.metrics),
        warnings: strings(rawComparison.warnings),
      }
    : undefined
  const observations = Array.isArray(value.observations)
    ? value.observations.filter((item): item is KdaProfileView['observations'][number] =>
        isObject(item)
        && (item.kind === 'measurement' || item.kind === 'comparison' || item.kind === 'limitation')
        && typeof item.summary === 'string'
        && Array.isArray(item.evidence))
    : []
  return {
    parser,
    bottleneck: typeof value.bottleneck === 'string' ? value.bottleneck : 'unknown',
    confidence: value.confidence === 'medium' ? 'medium' : 'low',
    metricCount: typeof value.metricCount === 'number' ? value.metricCount : 0,
    metrics: metrics(value.metrics),
    keyMetrics: metrics(value.keyMetrics),
    topStalls: metrics(value.topStalls),
    kernelNames: strings(value.kernelNames),
    launchIds: strings(value.launchIds),
    evidence: strings(value.evidence),
    observations,
    diagnosis: typeof value.diagnosis === 'string' ? value.diagnosis : 'Profile analysis is incomplete.',
    limitations: strings(value.limitations),
    recommendations: strings(value.recommendations),
    nextExperiment: {
      action: typeof next.action === 'string' ? next.action : 'Collect a complete structured profile.',
      rationale: typeof next.rationale === 'string' ? next.rationale : 'The stored profile analysis is incomplete.',
      requiredMetrics: strings(next.requiredMetrics),
    },
    ...(comparison !== undefined ? { comparison } : {}),
  }
}

function stages(value: unknown): KdaStageView[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> =>
    isObject(item) && (item.stage === 'correctness' || item.stage === 'benchmark' || item.stage === 'profile'))
    .map(item => ({
      ...item as unknown as KdaStageView,
      stage: item.stage as KdaStageView['stage'],
      ok: item.ok === true,
      durationMs: typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? item.durationMs : 0,
    }))
}

function candidates(value: unknown): KdaCandidateView[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> =>
    isObject(item) && typeof item.candidate === 'string' && isDecision(item.decision))
    .map((item, index) => ({
      ...item as unknown as KdaCandidateView,
      candidate: item.candidate as string,
      candidateRole: item.candidateRole === 'baseline' ? 'baseline' : 'experiment',
      iteration: typeof item.iteration === 'number' ? item.iteration : index + 1,
      hypothesis: typeof item.hypothesis === 'string' ? item.hypothesis : 'No hypothesis recorded',
      decision: item.decision as KdaDecisionView,
      ...(isProfileStatus(item.profileStatus) ? { profileStatus: item.profileStatus } : {}),
      ...(isMechanismVerdict(item.mechanismVerdict) ? { mechanismVerdict: item.mechanismVerdict } : {}),
    }))
}

function decisionGates(value: unknown): KdaDecisionGateView[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> =>
    isObject(item)
    && (item.name === 'correctness' || item.name === 'benchmark' || item.name === 'profile' || item.name === 'mechanism')
    && isDecisionGateStatus(item.status))
    .map(item => ({
      name: item.name as KdaDecisionGateView['name'],
      status: item.status as KdaDecisionGateStatusView,
      blocking: item.blocking === true,
      summary: typeof item.summary === 'string' ? item.summary : 'Decision gate details are incomplete.',
      evidence: strings(item.evidence),
    }))
}

function ncuReportAssessment(value: unknown): KdaNcuReportAssessmentView | undefined {
  if (!isObject(value) || value.source !== 'mit-han-lab/ncu-report-skill') return undefined
  if (typeof value.sourceCommit !== 'string' || typeof value.reportPath !== 'string' || typeof value.reportMarkdown !== 'string'
    || typeof value.targetHardware !== 'string' || typeof value.targetKernel !== 'string'
    || typeof value.workload !== 'string' || typeof value.primaryDiagnosis !== 'string') return undefined
  const dimensions = Array.isArray(value.dimensions)
    ? value.dimensions.filter((item): item is Record<string, unknown> =>
        isObject(item) && isNcuDimension(item.dimension) && isNcuDimensionStatus(item.status) && typeof item.conclusion === 'string')
      .map(item => ({
        dimension: item.dimension as KdaNcuDimensionNameView,
        status: item.status as KdaNcuDimensionStatusView,
        conclusion: item.conclusion as string,
        signals: Array.isArray(item.signals)
          ? item.signals.filter((signal): signal is Record<string, unknown> =>
              isObject(signal) && typeof signal.statement === 'string' && typeof signal.source === 'string')
            .map(signal => ({
              statement: signal.statement as string,
              source: signal.source as string,
              ...(typeof signal.metric === 'string' ? { metric: signal.metric } : {}),
              ...(typeof signal.value === 'number' && Number.isFinite(signal.value) ? { value: signal.value } : {}),
              ...(typeof signal.unit === 'string' ? { unit: signal.unit } : {}),
            }))
          : [],
        limitations: strings(item.limitations),
      }))
    : []
  const patterns = Array.isArray(value.patterns)
    ? value.patterns.filter((item): item is Record<string, unknown> =>
        isObject(item) && isNcuPatternId(item.id) && typeof item.name === 'string'
        && (item.confidence === 'low' || item.confidence === 'medium' || item.confidence === 'high')
        && typeof item.cause === 'string' && typeof item.firstLineFix === 'string')
      .map(item => ({
        id: item.id as KdaNcuPatternIdView,
        name: item.name as string,
        confidence: item.confidence as KdaNcuPatternMatchView['confidence'],
        ...(typeof item.estimatedSpeedupPercent === 'number' && Number.isFinite(item.estimatedSpeedupPercent)
          ? { estimatedSpeedupPercent: item.estimatedSpeedupPercent }
          : {}),
        signals: strings(item.signals),
        cause: item.cause as string,
        firstLineFix: item.firstLineFix as string,
        exceptions: strings(item.exceptions),
      }))
    : []
  const rules = Array.isArray(value.rules)
    ? value.rules.filter((item): item is Record<string, unknown> =>
        isObject(item) && typeof item.name === 'string' && typeof item.message === 'string'
        && (item.severity === 'info' || item.severity === 'warning' || item.severity === 'optimization'))
      .map(item => ({
        name: item.name as string,
        severity: item.severity as KdaNcuRuleFindingView['severity'],
        message: item.message as string,
        ...(typeof item.estimatedSpeedupPercent === 'number' && Number.isFinite(item.estimatedSpeedupPercent)
          ? { estimatedSpeedupPercent: item.estimatedSpeedupPercent }
          : {}),
        evidence: strings(item.evidence),
      }))
    : []
  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations.filter((item): item is Record<string, unknown> =>
        isObject(item) && typeof item.rank === 'number' && typeof item.action === 'string'
        && typeof item.rationale === 'string' && typeof item.expectedImpact === 'string')
      .map(item => ({
        rank: item.rank as number,
        action: item.action as string,
        rationale: item.rationale as string,
        expectedImpact: item.expectedImpact as string,
        supportingPatterns: Array.isArray(item.supportingPatterns) ? item.supportingPatterns.filter(isNcuPatternId) : [],
        requiredMetrics: strings(item.requiredMetrics),
      })).sort((left, right) => left.rank - right.rank)
    : []
  return {
    source: 'mit-han-lab/ncu-report-skill',
    sourceCommit: value.sourceCommit,
    reportPath: value.reportPath,
    reportMarkdown: value.reportMarkdown,
    ...(typeof value.fullReportPath === 'string' ? { fullReportPath: value.fullReportPath } : {}),
    ...(typeof value.sourceReportPath === 'string' ? { sourceReportPath: value.sourceReportPath } : {}),
    ...(typeof value.analysisPath === 'string' ? { analysisPath: value.analysisPath } : {}),
    targetHardware: value.targetHardware,
    targetKernel: value.targetKernel,
    workload: value.workload,
    dimensions,
    patterns,
    rules,
    primaryDiagnosis: value.primaryDiagnosis,
    secondaryFindings: strings(value.secondaryFindings),
    recommendations,
    limitations: strings(value.limitations),
  }
}

function validResult(value: unknown): KdaResultView | undefined {
  if (!isObject(value) || value.schemaVersion !== 1) return undefined
  if (typeof value.runId !== 'string' || typeof value.candidate !== 'string' || !isDecision(value.decision)) return undefined
  const profileStatus = isProfileStatus(value.profileStatus) ? value.profileStatus : 'not-requested'
  const normalizedProfile = profile(value.profileAnalysis)
  const assessment = isObject(value.mechanismAssessment) && isMechanismVerdict(value.mechanismAssessment.verdict)
    ? {
        ...value.mechanismAssessment as unknown as KdaMechanismAssessmentView,
        verdict: value.mechanismAssessment.verdict,
        evidence: strings(value.mechanismAssessment.evidence),
        limitations: strings(value.mechanismAssessment.limitations),
      }
    : { verdict: 'unverified' as const, evidence: [], limitations: ['Mechanism assessment is missing from this partial result.'] }
  const { profileAnalysis: _profileAnalysis, ...base } = value
  const rawPolicy = isObject(value.promotionPolicy) ? value.promotionPolicy : undefined
  const normalizedNcuReport = ncuReportAssessment(value.ncuReportAssessment)
  return {
    ...base as unknown as KdaResultView,
    candidateRole: value.candidateRole === 'baseline' ? 'baseline' : 'experiment',
    reason: typeof value.reason === 'string' ? value.reason : 'Evaluation result is incomplete.',
    stages: stages(value.stages),
    candidates: candidates(value.candidates),
    profileStatus,
    mechanismAssessment: assessment,
    ...(normalizedNcuReport === undefined ? {} : { ncuReportAssessment: normalizedNcuReport }),
    ...(rawPolicy === undefined ? {} : {
      promotionPolicy: {
        requireProfile: rawPolicy.requireProfile === true,
        requireMechanism: rawPolicy.requireMechanism === true,
      },
    }),
    decisionGates: decisionGates(value.decisionGates),
    contextWarnings: Array.isArray(value.contextWarnings)
      ? value.contextWarnings.filter((item): item is string => typeof item === 'string')
      : [],
    ...(normalizedProfile !== undefined ? { profileAnalysis: normalizedProfile } : {}),
  }
}

function textBlocks(content: unknown): string[] {
  const texts: string[] = []
  const pending: unknown[] = [content]
  let visited = 0
  while (pending.length > 0 && visited < 256) {
    visited += 1
    const current = pending.pop()
    if (Array.isArray(current)) {
      pending.push(...current)
      continue
    }
    if (!isObject(current)) continue
    if (typeof current.text === 'string') texts.push(current.text)
    for (const [key, child] of Object.entries(current)) {
      if (key !== 'text') pending.push(child)
    }
  }
  return texts
}

/** Parse schema-v1 structured presentation metadata or its JSON text fallback. */
export function parseKdaResult(meta: unknown, content: unknown): KdaResultView | undefined {
  const fromMeta = validResult(meta)
  if (fromMeta !== undefined) return fromMeta
  for (const text of textBlocks(content)) {
    try {
      const parsed = validResult(JSON.parse(text))
      if (parsed !== undefined) return parsed
    } catch {
      // Ordinary tool output is not a KDA evaluation record.
    }
  }
  return undefined
}

function fallbackCandidate(evaluation: KdaEvaluationView, index: number): KdaCandidateView {
  const result = evaluation.result
  return {
    ...(result.evaluationId !== undefined ? { evaluationId: result.evaluationId } : {}),
    candidate: result.candidate,
    candidateRole: result.candidateRole,
    ...(result.parentCandidate !== undefined ? { parentCandidate: result.parentCandidate } : {}),
    iteration: result.iteration ?? index + 1,
    hypothesis: result.hypothesis ?? 'No hypothesis recorded',
    ...(result.changeSummary !== undefined ? { changeSummary: result.changeSummary } : {}),
    ...(result.sourceRevision !== undefined ? { sourceRevision: result.sourceRevision } : {}),
    ...(result.baselineMetric !== undefined ? { baselineMetric: result.baselineMetric } : {}),
    ...(result.candidateMetric !== undefined ? { candidateMetric: result.candidateMetric } : {}),
    ...(result.metricUnit !== undefined ? { metricUnit: result.metricUnit } : {}),
    ...(result.improvementPercent !== undefined ? { improvementPercent: result.improvementPercent } : {}),
    ...(result.lowerIsBetter !== undefined ? { lowerIsBetter: result.lowerIsBetter } : {}),
    ...(result.minimumImprovementPercent !== undefined ? { minimumImprovementPercent: result.minimumImprovementPercent } : {}),
    decision: result.decision,
    ...(result.benchmarkContext !== undefined ? { benchmarkContext: result.benchmarkContext } : {}),
    ...(result.profileContext !== undefined ? { profileContext: result.profileContext } : {}),
    profileStatus: result.profileStatus,
    mechanismVerdict: result.mechanismAssessment.verdict,
    ...(result.profileAnalysis !== undefined ? { profileBottleneck: result.profileAnalysis.bottleneck } : {}),
  }
}

function bestCandidate(lineage: readonly KdaCandidateView[]): KdaCandidateView | undefined {
  return [...lineage]
    .filter(candidate => candidate.candidateRole !== 'baseline' && candidate.candidateMetric !== undefined)
    .sort((left, right) => (right.improvementPercent ?? Number.NEGATIVE_INFINITY) - (left.improvementPercent ?? Number.NEGATIVE_INFINITY))[0]
}

/** Project ordinary conversation tool-result nodes into KDA optimization runs. */
export function projectKdaRuns(nodes: readonly unknown[]): KdaRunView[] {
  const evaluations: KdaEvaluationView[] = []
  const seen = new Set<string>()
  for (const item of nodes) {
    if (!isObject(item) || item.kind !== 'tool-result') continue
    const call = isObject(item.call) ? item.call : undefined
    const toolName = typeof call?.name === 'string' ? call.name : undefined
    if (toolName !== undefined && toolName !== 'kda_evaluate_candidate') continue
    const result = parseKdaResult(item.meta, item.content)
    if (result === undefined) continue
    const callId = typeof item.callId === 'string' ? item.callId : `kda-call-${evaluations.length + 1}`
    const seq = typeof item.seq === 'number' ? item.seq : evaluations.length
    const time = typeof item.time === 'number' ? item.time : 0
    const id = result.evaluationId ?? `${result.runId}:${result.candidate}:${seq}`
    if (seen.has(id)) continue
    seen.add(id)
    evaluations.push({ id, callId, seq, time, result })
  }

  const grouped = new Map<string, KdaEvaluationView[]>()
  for (const evaluation of evaluations) {
    const run = grouped.get(evaluation.result.runId) ?? []
    run.push(evaluation)
    grouped.set(evaluation.result.runId, run)
  }

  const runs: KdaRunView[] = []
  for (const [runId, runEvaluations] of grouped) {
    runEvaluations.sort((left, right) =>
      (left.result.iteration ?? Number.MAX_SAFE_INTEGER) - (right.result.iteration ?? Number.MAX_SAFE_INTEGER)
      || left.time - right.time
      || left.seq - right.seq)
    const latest = runEvaluations.at(-1) as KdaEvaluationView
    const lineage = latest.result.candidates?.length
      ? [...latest.result.candidates].sort((left, right) => left.iteration - right.iteration)
      : runEvaluations.map(fallbackCandidate)
    const baseline = lineage.find(candidate => candidate.candidateRole === 'baseline')
    const best = bestCandidate(lineage)
    runs.push({
      runId,
      ...(latest.result.task !== undefined ? { task: latest.result.task } : {}),
      ...(latest.result.objective !== undefined ? { objective: latest.result.objective } : {}),
      updatedAt: Math.max(...runEvaluations.map(item => item.time)),
      evaluations: runEvaluations,
      lineage,
      ...(baseline !== undefined ? { baseline } : {}),
      ...(best !== undefined ? { best } : {}),
    })
  }
  return runs.sort((left, right) => right.updatedAt - left.updatedAt)
}
