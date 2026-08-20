/** One command stage in a KDA candidate evaluation. */
export type KdaStageName = 'correctness' | 'benchmark' | 'profile'

/** Promotion outcome derived from correctness and performance evidence. */
export type KdaDecision = 'promote' | 'revise' | 'reject'

/** Input accepted by the candidate evaluator. */
export interface KdaEvaluationRequest {
  task: string
  objective: string
  candidate: string
  parentCandidate?: string
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

/** Stable event vocabulary used by the initial trajectory projection. */
export type KdaTrajectoryEvent =
  | { type: 'kda/run-started'; at: string; runId: string; task: string; objective: string }
  | { type: 'kda/candidate-proposed'; at: string; runId: string; candidate: string; parentCandidate?: string }
  | { type: 'kda/stage-completed'; at: string; runId: string; candidate: string; result: KdaStageResult }
  | { type: 'kda/decision-made'; at: string; runId: string; candidate: string; decision: KdaDecision; reason: string; improvementPercent?: number }
  | { type: 'kda/run-finished'; at: string; runId: string; candidate: string; decision: KdaDecision }

/** Complete replayable result persisted as the dsh tool result. */
export interface KdaEvaluationResult {
  schemaVersion: 1
  runId: string
  task: string
  objective: string
  candidate: string
  parentCandidate?: string
  workdir: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  decision: KdaDecision
  reason: string
  stages: KdaStageResult[]
  trajectory: KdaTrajectoryEvent[]
}

/** Adapter used by the pure evaluator to execute one command. */
export interface KdaCommandRunner {
  run(stage: KdaStageName, command: string, workdir: string, signal?: AbortSignal): Promise<KdaCommandResult>
}
