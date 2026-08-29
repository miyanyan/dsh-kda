import { describe, expect, it } from 'vitest'
import { kdaToolFailure } from '../src/client/index.js'

describe('KDA inline tool failure', () => {
  it('shows the evaluator validation error instead of Result unavailable', () => {
    expect(kdaToolFailure({
      kind: 'tool-result',
      isError: true,
      content: [{ type: 'text', text: 'ncuReportAssessment.rules[0].severity is invalid' }],
    })).toBe('ncuReportAssessment.rules[0].severity is invalid')
  })

  it('does not classify an ordinary partial result as a tool failure', () => {
    expect(kdaToolFailure({ kind: 'tool-result', content: [], isError: false })).toBeUndefined()
  })
})
