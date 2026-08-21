import { describe, expect, it } from 'vitest'
import { analyzeNcuOutput } from '../src/ncu.js'

describe('analyzeNcuOutput', () => {
  it('parses NCU raw CSV and identifies a memory-throughput bottleneck', () => {
    const output = [
      '"Metric Name","Metric Unit","Metric Value"',
      '"sm__throughput.avg.pct_of_peak_sustained_elapsed","%","52"',
      '"dram__throughput.avg.pct_of_peak_sustained_elapsed","%","88"',
      '"sm__warps_active.avg.pct_of_peak_sustained_active","%","61"',
    ].join('\n')
    const analysis = analyzeNcuOutput(output)
    expect(analysis.parser).toBe('ncu-csv')
    expect(analysis.metricCount).toBe(3)
    expect(analysis.bottleneck).toBe('memory-throughput')
    expect(analysis.evidence).toContain('dram__throughput.avg.pct_of_peak_sustained_elapsed=88 %')
  })

  it('parses explicit KDA metric lines and identifies latency evidence', () => {
    const output = [
      'KDA_NCU_METRIC=dram__throughput.avg.pct_of_peak_sustained_elapsed|31|%',
      'KDA_NCU_METRIC=smsp__warp_issue_stalled_long_scoreboard.per_warp_active.pct|42|%',
    ].join('\n')
    const analysis = analyzeNcuOutput(output)
    expect(analysis.parser).toBe('kda-lines')
    expect(analysis.bottleneck).toBe('latency')
    expect(analysis.topStalls[0]?.value).toBe(42)
  })

  it('does not invent a diagnosis without structured metrics', () => {
    const analysis = analyzeNcuOutput('==PROF== report imported successfully')
    expect(analysis.parser).toBe('none')
    expect(analysis.bottleneck).toBe('unknown')
    expect(analysis.confidence).toBe('low')
  })
})
