import { describe, expect, it } from 'vitest'
import { collectCandidateHistory } from '../src/history.js'

function evaluation() {
  return {
    schemaVersion: 1,
    runId: 'run-a',
    evaluationId: 'evaluation-a',
    iteration: 1,
    task: 'task-a',
    objective: 'faster',
    candidate: 'baseline',
    candidateRole: 'baseline',
    hypothesis: 'measure the reference',
    workdir: '/workspace',
    benchmarkContext: 'rtx5070ti-shape-a',
    baselineMetric: 10,
    candidateMetric: 10,
    metricUnit: 'us',
    lowerIsBetter: true,
    minimumImprovementPercent: 5,
    decision: 'baseline',
    reason: 'Measured baseline recorded.',
    stages: [],
    profileStatus: 'not-requested',
    mechanismAssessment: { verdict: 'unverified', evidence: [], limitations: ['No profile expected.'] },
    contextWarnings: [],
    candidates: [],
    trajectory: [],
  } as const
}

describe('collectCandidateHistory', () => {
  it('rebuilds schema-v1 candidates without duplicating metadata and rendered JSON', () => {
    const result = evaluation()
    const events = [{
      type: 'tool/result',
      data: {
        meta: result,
        message: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      },
    }]
    const history = collectCandidateHistory(events, 'run-a')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      candidate: 'baseline', candidateRole: 'baseline', hypothesis: 'measure the reference',
      candidateMetric: 10, benchmarkContext: 'rtx5070ti-shape-a', lowerIsBetter: true,
    })
  })

  it('ignores old schemas instead of guessing compatibility', () => {
    const legacy = { ...evaluation(), schemaVersion: 3 }
    const events = [{ type: 'tool/result', data: { meta: legacy } }]
    expect(collectCandidateHistory(events, 'run-a')).toEqual([])
  })
})
