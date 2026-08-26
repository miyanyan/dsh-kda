import type { KdaCandidateSummary, KdaDecision, KdaEvaluationResult } from './types.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isDecision(value: unknown): value is KdaDecision {
  return value === 'baseline' || value === 'promote' || value === 'revise' || value === 'reject'
}

function parseResult(value: unknown): KdaEvaluationResult | undefined {
  if (!isObject(value) || value.schemaVersion !== 1) return undefined
  if (typeof value.runId !== 'string' || typeof value.task !== 'string' || typeof value.candidate !== 'string') return undefined
  if (value.candidateRole !== 'baseline' && value.candidateRole !== 'experiment') return undefined
  if (typeof value.evaluationId !== 'string' || typeof value.iteration !== 'number') return undefined
  if (typeof value.hypothesis !== 'string' || typeof value.benchmarkContext !== 'string' || typeof value.metricUnit !== 'string') return undefined
  if (typeof value.lowerIsBetter !== 'boolean' || typeof value.minimumImprovementPercent !== 'number') return undefined
  if (!isObject(value.mechanismAssessment) || typeof value.profileStatus !== 'string') return undefined
  if (!isDecision(value.decision)) return undefined
  return value as unknown as KdaEvaluationResult
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

function resultsFromEvent(event: unknown): KdaEvaluationResult[] {
  if (!isObject(event) || event.type !== 'tool/result' || !isObject(event.data)) return []
  const results: KdaEvaluationResult[] = []
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

function summary(result: KdaEvaluationResult): KdaCandidateSummary {
  return {
    evaluationId: result.evaluationId,
    candidate: result.candidate,
    candidateRole: result.candidateRole,
    ...(result.parentCandidate !== undefined ? { parentCandidate: result.parentCandidate } : {}),
    iteration: result.iteration,
    hypothesis: result.hypothesis,
    ...(result.changeSummary !== undefined ? { changeSummary: result.changeSummary } : {}),
    ...(result.sourceRevision !== undefined ? { sourceRevision: result.sourceRevision } : {}),
    ...(result.baselineMetric !== undefined ? { baselineMetric: result.baselineMetric } : {}),
    ...(result.candidateMetric !== undefined ? { candidateMetric: result.candidateMetric } : {}),
    metricUnit: result.metricUnit,
    ...(result.improvementPercent !== undefined ? { improvementPercent: result.improvementPercent } : {}),
    lowerIsBetter: result.lowerIsBetter,
    minimumImprovementPercent: result.minimumImprovementPercent,
    decision: result.decision,
    benchmarkContext: result.benchmarkContext,
    ...(result.profileContext !== undefined ? { profileContext: result.profileContext } : {}),
    profileStatus: result.profileStatus,
    mechanismVerdict: result.mechanismAssessment.verdict,
    ...(result.profileAnalysis !== undefined ? {
      profileBottleneck: result.profileAnalysis.bottleneck,
      profileAnalysis: result.profileAnalysis,
    } : {}),
  }
}

/** Reconstruct one optimization run from durable prior KDA tool results in the current dsh session. */
export function collectCandidateHistory(
  events: readonly unknown[],
  optimizationRunId: string,
): KdaCandidateSummary[] {
  const history: KdaCandidateSummary[] = []
  const evaluations = new Set<string>()
  for (const event of events) {
    for (const result of resultsFromEvent(event)) {
      if (result.runId !== optimizationRunId || evaluations.has(result.evaluationId)) continue
      evaluations.add(result.evaluationId)
      history.push(summary(result))
    }
  }
  return history.sort((left, right) => left.iteration - right.iteration)
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
