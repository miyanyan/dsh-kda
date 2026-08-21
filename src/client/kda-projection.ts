export type KdaDecisionView = 'promote' | 'revise' | 'reject'

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

export interface KdaCandidateView {
  evaluationId?: string
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
  decision: KdaDecisionView
  profileBottleneck?: string
}

export interface KdaProfileView {
  parser?: string
  bottleneck: string
  confidence: 'low' | 'medium'
  metricCount: number
  evidence: string[]
  recommendations: string[]
  keyMetrics?: Array<{ name: string; value: number; unit?: string }>
  topStalls?: Array<{ name: string; value: number; unit?: string }>
}

export interface KdaResultView {
  schemaVersion: 1 | 2
  runId: string
  evaluationId?: string
  iteration?: number
  task?: string
  objective?: string
  candidate: string
  parentCandidate?: string
  hypothesis?: string
  changeSummary?: string
  sourceRevision?: string
  workdir?: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  decision: KdaDecisionView
  reason: string
  stages: KdaStageView[]
  candidates?: KdaCandidateView[]
  profileAnalysis?: KdaProfileView
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
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDecision(value: unknown): value is KdaDecisionView {
  return value === 'promote' || value === 'revise' || value === 'reject'
}

function validResult(value: unknown): KdaResultView | undefined {
  if (!isObject(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) return undefined
  if (typeof value.runId !== 'string' || typeof value.candidate !== 'string') return undefined
  if (!isDecision(value.decision) || typeof value.reason !== 'string' || !Array.isArray(value.stages)) return undefined
  return value as unknown as KdaResultView
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

/** Parse the structured KDA presentation metadata or its JSON text fallback. */
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
    ...(result.parentCandidate !== undefined ? { parentCandidate: result.parentCandidate } : {}),
    iteration: result.iteration ?? index + 1,
    hypothesis: result.hypothesis ?? 'No hypothesis recorded',
    ...(result.changeSummary !== undefined ? { changeSummary: result.changeSummary } : {}),
    ...(result.sourceRevision !== undefined ? { sourceRevision: result.sourceRevision } : {}),
    ...(result.baselineMetric !== undefined ? { baselineMetric: result.baselineMetric } : {}),
    ...(result.candidateMetric !== undefined ? { candidateMetric: result.candidateMetric } : {}),
    ...(result.metricUnit !== undefined ? { metricUnit: result.metricUnit } : {}),
    ...(result.improvementPercent !== undefined ? { improvementPercent: result.improvementPercent } : {}),
    decision: result.decision,
    ...(result.profileAnalysis !== undefined ? { profileBottleneck: result.profileAnalysis.bottleneck } : {}),
  }
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
    runs.push({
      runId,
      ...(latest.result.task !== undefined ? { task: latest.result.task } : {}),
      ...(latest.result.objective !== undefined ? { objective: latest.result.objective } : {}),
      updatedAt: Math.max(...runEvaluations.map(item => item.time)),
      evaluations: runEvaluations,
      lineage,
    })
  }
  return runs.sort((left, right) => right.updatedAt - left.updatedAt)
}
