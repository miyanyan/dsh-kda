import { describe, expect, it } from 'vitest'
import { collectCandidateHistory } from '../src/history.js'

describe('collectCandidateHistory', () => {
  it('rebuilds candidates from presentation metadata without duplicating rendered JSON', () => {
    const result = {
      schemaVersion: 2,
      runId: 'run-a',
      evaluationId: 'evaluation-a',
      iteration: 1,
      task: 'task-a',
      objective: 'faster',
      candidate: 'candidate-a',
      hypothesis: 'coalescing',
      workdir: '/workspace',
      decision: 'revise',
      reason: 'not enough',
      stages: [],
      candidates: [],
      trajectory: [],
    }
    const events = [{
      type: 'tool/result',
      data: {
        meta: result,
        message: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      },
    }]
    const history = collectCandidateHistory(events, 'run-a', 'task-a')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ candidate: 'candidate-a', hypothesis: 'coalescing' })
  })
})
