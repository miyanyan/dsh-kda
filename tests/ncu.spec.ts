import { describe, expect, it } from 'vitest'
import { analyzeNcuOutput, compareNcuProfiles, withNcuComparison } from '../src/ncu.js'

describe('analyzeNcuOutput', () => {
  it('parses real NCU display names and exposes the metrics that drive its diagnosis', () => {
    const output = [
      '"Kernel Name","Section Name","Metric Name","Metric Unit","Metric Value"',
      '"squared_epsilon","GPU Speed Of Light Throughput","Compute (SM) Throughput","%","91.60"',
      '"squared_epsilon","GPU Speed Of Light Throughput","DRAM Throughput","%","0.34"',
      '"squared_epsilon","GPU Speed Of Light Throughput","Duration","ms","76.30"',
      '"squared_epsilon","Occupancy","Achieved Occupancy","%","96.38"',
      '"squared_epsilon","Launch Statistics","Registers Per Thread","register/thread","34"',
      '"squared_epsilon","Launch Statistics","Dynamic Shared Memory Per Block","Kbyte/block","4.10"',
      '"squared_epsilon","Launch Statistics","Driver Shared Memory Per Block","Kbyte/block","1.02"',
    ].join('\n')
    const analysis = analyzeNcuOutput(output)

    expect(analysis.parser).toBe('ncu-csv')
    expect(analysis.metricCount).toBe(7)
    expect(analysis.bottleneck).toBe('compute-throughput')
    expect(analysis.kernelNames).toEqual(['squared_epsilon'])
    expect(analysis.launchIds).toEqual([])
    expect(analysis.keyMetrics.map(metric => [metric.canonicalName, metric.value])).toEqual([
      ['duration', 76.3],
      ['compute-throughput', 91.6],
      ['dram-throughput', 0.34],
      ['achieved-occupancy', 96.38],
      ['registers-per-thread', 34],
      ['dynamic-shared-memory-per-block', 4.1],
      ['driver-shared-memory-per-block', 1.02],
    ])
    expect(analysis.diagnosis).toContain('compute-throughput saturation')
    expect(analysis.observations[0]?.evidence).toEqual([
      'Compute (SM) Throughput=91.6 %',
      'DRAM Throughput=0.34 %',
    ])
  })

  it('parses raw NCU ids and identifies latency evidence', () => {
    const output = [
      'KDA_NCU_METRIC=dram__throughput.avg.pct_of_peak_sustained_elapsed|31|%',
      'KDA_NCU_METRIC=smsp__warp_issue_stalled_long_scoreboard.per_warp_active.pct|42|%',
    ].join('\n')
    const analysis = analyzeNcuOutput(output)
    expect(analysis.parser).toBe('kda-lines')
    expect(analysis.bottleneck).toBe('latency')
    expect(analysis.topStalls[0]).toMatchObject({ value: 42 })
  })

  it('does not invent a diagnosis without structured metrics', () => {
    const analysis = analyzeNcuOutput('==PROF== report imported successfully')
    expect(analysis.parser).toBe('none')
    expect(analysis.bottleneck).toBe('unknown')
    expect(analysis.confidence).toBe('low')
    expect(analysis.metrics).toEqual([])
  })

  it('reports multi-kernel ambiguity', () => {
    const output = [
      '"Kernel Name","Metric Name","Metric Unit","Metric Value"',
      '"kernel_a","Compute (SM) Throughput","%","80"',
      '"kernel_b","Compute (SM) Throughput","%","30"',
    ].join('\n')
    const analysis = analyzeNcuOutput(output)
    expect(analysis.kernelNames).toEqual(['kernel_a', 'kernel_b'])
    expect(analysis.limitations).toContain('Profile contains 2 kernels; aggregate interpretation may be ambiguous.')
  })

  it('retains launch ids and reports repeated-launch ambiguity', () => {
    const output = [
      '"ID","Kernel Name","Metric Name","Metric Unit","Metric Value"',
      '"1","kernel_a","Duration","us","10"',
      '"2","kernel_a","Duration","us","12"',
    ].join('\n')
    const analysis = analyzeNcuOutput(output)
    expect(analysis.launchIds).toEqual(['1', '2'])
    expect(analysis.metrics).toHaveLength(2)
    expect(analysis.limitations.join(' ')).toContain('2 launches')
  })
})

describe('compareNcuProfiles', () => {
  it('aligns canonical same-unit metrics and records raw deltas', () => {
    const baseline = analyzeNcuOutput([
      'KDA_NCU_METRIC=Compute (SM) Throughput|70|%',
      'KDA_NCU_METRIC=Duration|10|ms',
    ].join('\n'))
    const candidate = analyzeNcuOutput([
      'KDA_NCU_METRIC=sm__throughput.avg.pct_of_peak_sustained_elapsed|84|%',
      'KDA_NCU_METRIC=Duration|8|ms',
    ].join('\n'))
    const comparison = compareNcuProfiles('baseline', 'candidate-a', 'rtx5070ti-shape-a', baseline, candidate)
    const attached = withNcuComparison(candidate, comparison)

    expect(comparison.metrics.map(metric => metric.canonicalName)).toEqual(['duration', 'compute-throughput'])
    expect(comparison.metrics[0]).toMatchObject({ baselineValue: 10, candidateValue: 8, delta: -2, deltaPercent: -20 })
    expect(comparison.metrics[1]).toMatchObject({ baselineValue: 70, candidateValue: 84, deltaPercent: 20 })
    expect(attached.observations.some(item => item.kind === 'comparison')).toBe(true)
  })

  it('refuses to compare metrics whose units differ', () => {
    const baseline = analyzeNcuOutput('KDA_NCU_METRIC=Duration|1000|us')
    const candidate = analyzeNcuOutput('KDA_NCU_METRIC=Duration|1|ms')
    const comparison = compareNcuProfiles('baseline', 'candidate-a', 'same-context', baseline, candidate)
    expect(comparison.metrics).toEqual([])
    expect(comparison.warnings.join(' ')).toContain('units differ')
  })
})
