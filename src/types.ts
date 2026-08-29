/** One command stage in a KDA candidate evaluation. */
export type KdaStageName = 'correctness' | 'benchmark' | 'profile'

/** Promotion outcome derived from correctness and performance evidence. */
export type KdaDecision = 'baseline' | 'promote' | 'revise' | 'reject'

/** Whether an evaluation records the unmodified reference or an experiment. */
export type KdaCandidateRole = 'baseline' | 'experiment'

/** Whether profiler evidence verifies the mechanism claimed by the hypothesis. */
export type KdaMechanismVerdict = 'supported' | 'partially-supported' | 'contradicted' | 'unverified'

/** One visible input to the final promotion decision. */
export type KdaDecisionGateName = 'correctness' | 'benchmark' | 'profile' | 'mechanism'
export type KdaDecisionGateStatus = 'passed' | 'failed' | 'advisory' | 'unavailable'

export interface KdaDecisionGate {
  name: KdaDecisionGateName
  status: KdaDecisionGateStatus
  blocking: boolean
  summary: string
  evidence: string[]
}

export interface KdaPromotionPolicy {
  requireProfile: boolean
  requireMechanism: boolean
}

/** The six mandatory lenses in the bundled MIT HAN Lab ncu-report-skill. */
export type KdaNcuDimensionName =
  | 'launch-occupancy'
  | 'workload-balance'
  | 'stall-hotspots'
  | 'tensor-core'
  | 'timeline'
  | 'memory'

export type KdaNcuDimensionStatus = 'analyzed' | 'missing-evidence' | 'not-applicable'
export type KdaNcuPatternId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N'

export interface KdaNcuReportSignal {
  statement: string
  source: string
  metric?: string
  value?: number
  unit?: string
}

export interface KdaNcuDimensionAssessment {
  dimension: KdaNcuDimensionName
  status: KdaNcuDimensionStatus
  conclusion: string
  signals: KdaNcuReportSignal[]
  limitations: string[]
}

export interface KdaNcuPatternMatch {
  id: KdaNcuPatternId
  name: string
  confidence: 'low' | 'medium' | 'high'
  estimatedSpeedupPercent?: number
  signals: string[]
  cause: string
  firstLineFix: string
  exceptions: string[]
}

export interface KdaNcuRuleFinding {
  name: string
  severity: 'info' | 'warning' | 'optimization'
  message: string
  estimatedSpeedupPercent?: number
  evidence: string[]
}

export interface KdaNcuRankedRecommendation {
  rank: number
  action: string
  rationale: string
  expectedImpact: string
  supportingPatterns: KdaNcuPatternId[]
  requiredMetrics: string[]
}

/** Structured projection authored only after the original ncu-report-skill workflow completes. */
export interface KdaNcuReportAssessment {
  source: 'mit-han-lab/ncu-report-skill'
  sourceCommit: string
  reportPath: string
  /** Verbatim REPORT.md content, persisted so recovered sessions retain the full report. */
  reportMarkdown: string
  fullReportPath?: string
  sourceReportPath?: string
  analysisPath?: string
  targetHardware: string
  targetKernel: string
  workload: string
  dimensions: KdaNcuDimensionAssessment[]
  patterns: KdaNcuPatternMatch[]
  rules: KdaNcuRuleFinding[]
  primaryDiagnosis: string
  secondaryFindings: string[]
  recommendations: KdaNcuRankedRecommendation[]
  limitations: string[]
}

/** Honest completeness state for the optional profiler stage. */
export type KdaProfileStatus =
  | 'not-requested'
  | 'skipped'
  | 'failed'
  | 'no-parseable-metrics'
  | 'current-only'
  | 'comparable'

export type KdaExpectedProfileDirection = 'increase' | 'decrease' | 'stable'

/** Coarse diagnosis derived from structured Nsight Compute evidence. */
export type KdaBottleneck =
  | 'memory-throughput'
  | 'compute-throughput'
  | 'occupancy'
  | 'latency'
  | 'balanced'
  | 'unknown'

/** One finite metric extracted from profiler output. */
export interface KdaNcuMetric {
  name: string
  value: number
  unit?: string
  canonicalName?: string
  section?: string
  kernelName?: string
  launchId?: string
}

/** One baseline-to-candidate profiler metric comparison. Positive delta means the raw value increased. */
export interface KdaMetricComparison {
  canonicalName: string
  name: string
  unit?: string
  baselineValue: number
  candidateValue: number
  delta: number
  deltaPercent?: number
}

export interface KdaProfileComparison {
  referenceCandidate: string
  candidate: string
  profileContext: string
  metrics: KdaMetricComparison[]
  warnings: string[]
}

export interface KdaProfileObservation {
  kind: 'measurement' | 'comparison' | 'limitation'
  summary: string
  evidence: string[]
}

export interface KdaNextExperiment {
  action: string
  rationale: string
  requiredMetrics: string[]
}

export interface KdaHypothesisAssessment {
  verdict: KdaMechanismVerdict
  expectedMetric?: string
  expectedDirection?: KdaExpectedProfileDirection
  expectedMinimumChangePercent?: number
  observed?: KdaMetricComparison
  evidence: string[]
  limitations: string[]
}

/** Evidence-backed, deliberately conservative NCU diagnosis. */
export interface KdaProfileAnalysis {
  parser: 'ncu-csv' | 'kda-lines' | 'none'
  metricCount: number
  bottleneck: KdaBottleneck
  confidence: 'low' | 'medium'
  metrics: KdaNcuMetric[]
  keyMetrics: KdaNcuMetric[]
  topStalls: KdaNcuMetric[]
  kernelNames: string[]
  launchIds: string[]
  evidence: string[]
  observations: KdaProfileObservation[]
  diagnosis: string
  limitations: string[]
  recommendations: string[]
  nextExperiment: KdaNextExperiment
  comparison?: KdaProfileComparison
}

/** Compact candidate record carried forward by later calls in one optimization run. */
export interface KdaCandidateSummary {
  evaluationId: string
  candidate: string
  candidateRole: KdaCandidateRole
  parentCandidate?: string
  iteration: number
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit: string
  improvementPercent?: number
  lowerIsBetter: boolean
  minimumImprovementPercent: number
  decision: KdaDecision
  benchmarkContext: string
  profileContext?: string
  profileStatus: KdaProfileStatus
  mechanismVerdict: KdaMechanismVerdict
  profileBottleneck?: KdaBottleneck
  profileAnalysis?: KdaProfileAnalysis
}

/** Input accepted by the candidate evaluator. */
export interface KdaEvaluationRequest {
  optimizationRunId: string
  task: string
  objective: string
  candidate: string
  candidateRole: KdaCandidateRole
  parentCandidate?: string
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  workdir: string
  correctnessCommand: string
  benchmarkCommand: string
  profileCommand?: string
  profileArtifact?: string
  benchmarkContext: string
  profileContext?: string
  metricPattern?: string
  metricUnit: string
  lowerIsBetter: boolean
  minimumImprovementPercent: number
  requireProfileForPromotion?: boolean
  requireMechanismForPromotion?: boolean
  expectedProfileMetric?: string
  expectedProfileDirection?: KdaExpectedProfileDirection
  expectedProfileMinimumChangePercent?: number
  ncuReportAssessment?: KdaNcuReportAssessment
  previousCandidates?: readonly KdaCandidateSummary[]
}

/** Bounded output captured from one command. */
export interface KdaCapturedStream {
  text: string
  truncated: boolean
  spillPath?: string
}

/** Normalized result returned by a command adapter. */
export interface KdaCommandResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  stdout: KdaCapturedStream
  stderr: KdaCapturedStream
}

/** Evidence produced by one evaluator stage. */
export interface KdaStageResult extends KdaCommandResult {
  stage: KdaStageName
  command: string
  startedAt: string
  durationMs: number
  ok: boolean
  metric?: number
  metricUnit?: string
  artifact?: string
}

/** Stable event vocabulary projected inside the durable dsh tool result. */
export type KdaTrajectoryEvent =
  | { type: 'kda/run-started'; at: string; runId: string; task: string; objective: string }
  | { type: 'kda/candidate-proposed'; at: string; runId: string; evaluationId: string; candidate: string; parentCandidate?: string; hypothesis: string }
  | { type: 'kda/stage-started'; at: string; runId: string; evaluationId: string; candidate: string; stage: KdaStageName; command: string; artifact?: string }
  | { type: 'kda/stage-completed'; at: string; runId: string; evaluationId: string; candidate: string; result: KdaStageResult }
  | { type: 'kda/profile-diagnosed'; at: string; runId: string; evaluationId: string; candidate: string; analysis: KdaProfileAnalysis }
  | { type: 'kda/mechanism-assessed'; at: string; runId: string; evaluationId: string; candidate: string; assessment: KdaHypothesisAssessment }
  | { type: 'kda/decision-made'; at: string; runId: string; evaluationId: string; candidate: string; decision: KdaDecision; reason: string; improvementPercent?: number }
  | { type: 'kda/candidate-finished'; at: string; runId: string; evaluationId: string; candidate: string; decision: KdaDecision }
  | { type: 'kda/run-finished'; at: string; runId: string; candidate: string; decision: 'promote' }

/** Synchronous observer used to project evaluator events into the native dsh log. */
export type KdaTrajectoryObserver = (event: KdaTrajectoryEvent) => void

/** Complete replayable result persisted as the dsh tool result and presentation metadata. */
export interface KdaEvaluationResult {
  schemaVersion: 1
  runId: string
  evaluationId: string
  iteration: number
  task: string
  objective: string
  candidate: string
  candidateRole: KdaCandidateRole
  parentCandidate?: string
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  workdir: string
  benchmarkContext: string
  profileContext?: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit: string
  improvementPercent?: number
  lowerIsBetter: boolean
  minimumImprovementPercent: number
  decision: KdaDecision
  reason: string
  stages: KdaStageResult[]
  profileStatus: KdaProfileStatus
  profileAnalysis?: KdaProfileAnalysis
  mechanismAssessment: KdaHypothesisAssessment
  ncuReportAssessment?: KdaNcuReportAssessment
  promotionPolicy: KdaPromotionPolicy
  decisionGates: KdaDecisionGate[]
  contextWarnings: string[]
  candidates: KdaCandidateSummary[]
  trajectory: KdaTrajectoryEvent[]
}

/** Adapter used by the pure evaluator to execute one command. */
export interface KdaCommandRunner {
  run(stage: KdaStageName, command: string, workdir: string, signal?: AbortSignal): Promise<KdaCommandResult>
}
