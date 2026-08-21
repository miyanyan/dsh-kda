/** One command stage in a KDA candidate evaluation. */
export type KdaStageName = 'correctness' | 'benchmark' | 'profile'

/** Promotion outcome derived from correctness and performance evidence. */
export type KdaDecision = 'promote' | 'revise' | 'reject'

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
}

/** Evidence-backed, deliberately conservative NCU diagnosis. */
export interface KdaProfileAnalysis {
  parser: 'ncu-csv' | 'kda-lines' | 'none'
  metricCount: number
  bottleneck: KdaBottleneck
  confidence: 'low' | 'medium'
  keyMetrics: KdaNcuMetric[]
  topStalls: KdaNcuMetric[]
  evidence: string[]
  recommendations: string[]
}

/** Compact candidate record carried forward by later calls in one optimization run. */
export interface KdaCandidateSummary {
  evaluationId: string
  candidate: string
  parentCandidate?: string
  iteration: number
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  decision: KdaDecision
  profileBottleneck?: KdaBottleneck
}

/** Input accepted by the candidate evaluator. */
export interface KdaEvaluationRequest {
  optimizationRunId: string
  task: string
  objective: string
  candidate: string
  parentCandidate?: string
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  workdir: string
  correctnessCommand: string
  benchmarkCommand?: string
  profileCommand?: string
  profileArtifact?: string
  baselineMetric?: number
  metricPattern?: string
  metricUnit?: string
  lowerIsBetter: boolean
  minimumImprovementPercent: number
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
  | { type: 'kda/decision-made'; at: string; runId: string; evaluationId: string; candidate: string; decision: KdaDecision; reason: string; improvementPercent?: number }
  | { type: 'kda/candidate-finished'; at: string; runId: string; evaluationId: string; candidate: string; decision: KdaDecision }
  | { type: 'kda/run-finished'; at: string; runId: string; candidate: string; decision: 'promote' }

/** Synchronous observer used to project evaluator events into the native dsh log. */
export type KdaTrajectoryObserver = (event: KdaTrajectoryEvent) => void

/** Complete replayable result persisted as the dsh tool result and presentation metadata. */
export interface KdaEvaluationResult {
  schemaVersion: 2
  runId: string
  evaluationId: string
  iteration: number
  task: string
  objective: string
  candidate: string
  parentCandidate?: string
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  workdir: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  decision: KdaDecision
  reason: string
  stages: KdaStageResult[]
  profileAnalysis?: KdaProfileAnalysis
  candidates: KdaCandidateSummary[]
  trajectory: KdaTrajectoryEvent[]
}

/** Adapter used by the pure evaluator to execute one command. */
export interface KdaCommandRunner {
  run(stage: KdaStageName, command: string, workdir: string, signal?: AbortSignal): Promise<KdaCommandResult>
}
