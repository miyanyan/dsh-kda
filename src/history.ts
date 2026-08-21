import type { KdaCandidateSummary, KdaDecision, KdaEvaluationResult } from './types.js'

interface LegacyResult {
  schemaVersion: 1
  runId: string
  task: string
  candidate: string
  parentCandidate?: string
  baselineMetric?: number
  candidateMetric?: number
  metricUnit?: string
  improvementPercent?: number
  decision: KdaDecision
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDecision(value: unknown): value is KdaDecision {
  return value === 'promote' || value === 'revise' || value === 'reject'
}

function parseResult(value: unknown): KdaEvaluationResult | LegacyResult | undefined {
  if (!isObject(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) return undefined
  if (typeof value.runId !== 'string' || typeof value.task !== 'string' || typeof value.candidate !== 'string') return undefined
  if (!isDecision(value.decision)) return undefined
  return value as unknown as KdaEvaluationResult | LegacyResult
}

function jsonTexts(value: unknown): string[] {
  const texts: string[] = []
  const pending: unknown[] = [value]
  let visited = 0
  while (pending.length > 0 && visited < 512) {
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

function resultsFromEvent(event: unknown): Array<KdaEvaluationResult | LegacyResult> {
  if (!isObject(event) || event.type !== 'tool/result' || !isObject(event.data)) return []
  const results: Array<KdaEvaluationResult | LegacyResult> = []
  const meta = parseResult(event.data.meta)
  if (meta !== undefined) results.push(meta)
  for (const text of jsonTexts(event.data.message)) {
    try {
      const parsed = parseResult(JSON.parse(text))
      if (parsed !== undefined) results.push(parsed)
    } catch {
      // Ordinary text tool results are not KDA records.
    }
  }
  return results
}

function summary(result: KdaEvaluationResult | LegacyResult, fallbackIteration: number): KdaCandidateSummary {
  if (result.schemaVersion === 2) {
    return {
      evaluationId: result.evaluationId,
      candidate: result.candidate,
      ...(result.parentCandidate !== undefined ? { parentCandidate: result.parentCandidate } : {}),
      iteration: result.iteration,
      hypothesis: result.hypothesis,
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
  return {
    evaluationId: result.runId,
    candidate: result.candidate,
    ...(result.parentCandidate !== undefined ? { parentCandidate: result.parentCandidate } : {}),
    iteration: fallbackIteration,
    hypothesis: 'legacy evaluation (no hypothesis recorded)',
    ...(result.baselineMetric !== undefined ? { baselineMetric: result.baselineMetric } : {}),
    ...(result.candidateMetric !== undefined ? { candidateMetric: result.candidateMetric } : {}),
    ...(result.metricUnit !== undefined ? { metricUnit: result.metricUnit } : {}),
    ...(result.improvementPercent !== undefined ? { improvementPercent: result.improvementPercent } : {}),
    decision: result.decision,
  }
}

/** Reconstruct one optimization run from durable prior KDA tool results in the current dsh session. */
export function collectCandidateHistory(
  events: readonly unknown[],
  optimizationRunId: string,
  task: string,
): KdaCandidateSummary[] {
  const history: KdaCandidateSummary[] = []
  const evaluations = new Set<string>()
  for (const event of events) {
    for (const result of resultsFromEvent(event)) {
      const belongs = result.schemaVersion === 2
        ? result.runId === optimizationRunId
        : optimizationRunId === task && result.task === task
      if (!belongs) continue
      const candidate = summary(result, history.length + 1)
      if (evaluations.has(candidate.evaluationId)) continue
      evaluations.add(candidate.evaluationId)
      history.push(candidate)
    }
  }
  return history
}

/** Reject ambiguous lineage before executing commands. */
export function validateCandidateLineage(
  history: readonly KdaCandidateSummary[],
  candidate: string,
  parentCandidate: string | undefined,
): void {
  if (history.some(item => item.candidate === candidate)) {
    throw new Error(`candidate ${JSON.stringify(candidate)} already exists in this optimization run`)
  }
  if (history.length > 0 && parentCandidate === undefined) {
    throw new Error('parentCandidate is required after the first candidate in an optimization run')
  }
  if (history.length > 0 && parentCandidate !== undefined && !history.some(item => item.candidate === parentCandidate)) {
    throw new Error(`parentCandidate ${JSON.stringify(parentCandidate)} is not present in this optimization run`)
  }
}
