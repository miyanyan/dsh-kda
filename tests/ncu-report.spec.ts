import { describe, expect, it } from 'vitest'
import { parseNcuReportAssessmentJson } from '../src/ncu-report.js'
import { ncuAssessment, ncuAssessmentJson } from './fixtures.js'

describe('original ncu-report-skill assessment', () => {
  it('accepts one durable entry for every original analysis dimension', () => {
    const parsed = parseNcuReportAssessmentJson(ncuAssessmentJson())
    expect(parsed?.dimensions.map(item => item.dimension)).toEqual([
      'launch-occupancy', 'workload-balance', 'stall-hotspots', 'tensor-core', 'timeline', 'memory',
    ])
    expect(parsed?.patterns[0]).toMatchObject({ id: 'E', estimatedSpeedupPercent: 18 })
    expect(parsed?.recommendations[0]?.rank).toBe(1)
    expect(parsed?.reportMarkdown).toContain('NCU Profiling Report')
  })

  it('rejects missing dimensions instead of inventing coverage', () => {
    const value = ncuAssessment()
    value.dimensions = value.dimensions.slice(0, 5)
    expect(() => parseNcuReportAssessmentJson(JSON.stringify(value))).toThrow('six original analysis dimensions')
  })

  it('rejects assessments attributed to another skill revision', () => {
    expect(() => parseNcuReportAssessmentJson(ncuAssessmentJson({ sourceCommit: 'another' }))).toThrow('sourceCommit')
  })

  it('requires the complete durable report body for the detail drawer', () => {
    expect(() => parseNcuReportAssessmentJson(ncuAssessmentJson({ reportMarkdown: '' }))).toThrow('reportMarkdown')
  })
})
