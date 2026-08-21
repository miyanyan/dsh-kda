import type { KdaBottleneck, KdaNcuMetric, KdaProfileAnalysis } from './types.js'

const MAX_METRICS = 4_096

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      fields.push(field.trim())
      field = ''
    } else {
      field += character
    }
  }
  fields.push(field.trim())
  return fields
}

function numericValue(raw: string): number | undefined {
  const normalized = raw.replaceAll(',', '').replace(/%$/, '').trim()
  if (normalized === '') return undefined
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

function parseNcuCsv(output: string): KdaNcuMetric[] {
  const metrics: KdaNcuMetric[] = []
  let columns: { name: number; unit: number; value: number } | undefined
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const fields = parseCsvLine(line)
    const normalized = fields.map(field => field.toLowerCase().replaceAll('_', ' ').trim())
    const name = normalized.findIndex(field => field === 'metric name')
    const value = normalized.findIndex(field => field === 'metric value')
    if (name >= 0 && value >= 0) {
      columns = { name, value, unit: normalized.findIndex(field => field === 'metric unit') }
      continue
    }
    if (columns === undefined) continue
    const metricName = fields[columns.name]?.trim()
    const parsed = numericValue(fields[columns.value] ?? '')
    if (metricName === undefined || metricName === '' || parsed === undefined) continue
    const unit = columns.unit >= 0 ? fields[columns.unit]?.trim() : undefined
    metrics.push({ name: metricName, value: parsed, ...(unit !== undefined && unit !== '' ? { unit } : {}) })
    if (metrics.length >= MAX_METRICS) break
  }
  return metrics
}

function parseKdaMetricLines(output: string): KdaNcuMetric[] {
  const metrics: KdaNcuMetric[] = []
  const expression = /^KDA_NCU_METRIC\s*=\s*([^|\r\n]+)\|([^|\r\n]+)(?:\|([^\r\n]+))?$/gm
  for (const match of output.matchAll(expression)) {
    const name = match[1]?.trim()
    const value = numericValue(match[2] ?? '')
    const unit = match[3]?.trim()
    if (name === undefined || name === '' || value === undefined) continue
    metrics.push({ name, value, ...(unit !== undefined && unit !== '' ? { unit } : {}) })
    if (metrics.length >= MAX_METRICS) break
  }
  return metrics
}

function deduplicate(metrics: readonly KdaNcuMetric[]): KdaNcuMetric[] {
  const byName = new Map<string, KdaNcuMetric>()
  for (const metric of metrics) byName.set(metric.name, metric)
  return [...byName.values()]
}

function firstMetric(metrics: readonly KdaNcuMetric[], patterns: readonly RegExp[]): KdaNcuMetric | undefined {
  return metrics.find(metric => patterns.some(pattern => pattern.test(metric.name)))
}

function metricText(metric: KdaNcuMetric): string {
  return `${metric.name}=${metric.value}${metric.unit === undefined ? '' : ` ${metric.unit}`}`
}

function diagnose(metrics: readonly KdaNcuMetric[]): {
  bottleneck: KdaBottleneck
  confidence: 'low' | 'medium'
  keyMetrics: KdaNcuMetric[]
  topStalls: KdaNcuMetric[]
  evidence: string[]
  recommendations: string[]
} {
  const duration = firstMetric(metrics, [/^gpu__time_duration\.(?:sum|avg)$/i, /kernel duration/i])
  const sm = firstMetric(metrics, [/^sm__throughput.*pct_of_peak/i, /compute.*throughput.*%/i])
  const dram = firstMetric(metrics, [/^dram__(?:throughput|bytes).*pct_of_peak/i, /dram.*throughput.*%/i])
  const occupancy = firstMetric(metrics, [/^sm__warps_active.*pct_of_peak/i, /achieved occupancy/i])
  const registers = firstMetric(metrics, [/^launch__registers_per_thread$/i, /registers per thread/i])
  const sharedMemory = firstMetric(metrics, [/^launch__shared_mem_per_block/i, /shared memory.*block/i])
  const topStalls = metrics
    .filter(metric => /warp_issue_stalled|warp stall/i.test(metric.name))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
  const longScoreboard = topStalls.find(metric => /long_scoreboard|long scoreboard/i.test(metric.name))

  let bottleneck: KdaBottleneck = 'unknown'
  if (dram !== undefined && sm !== undefined && dram.value >= 70 && dram.value >= sm.value + 10) {
    bottleneck = 'memory-throughput'
  } else if (sm !== undefined && dram !== undefined && sm.value >= 70 && sm.value >= dram.value + 15) {
    bottleneck = 'compute-throughput'
  } else if (occupancy !== undefined && occupancy.value < 35) {
    bottleneck = 'occupancy'
  } else if (longScoreboard !== undefined && longScoreboard.value >= 20 && (dram === undefined || dram.value < 70)) {
    bottleneck = 'latency'
  } else if (sm !== undefined && dram !== undefined && sm.value >= 60 && dram.value >= 60) {
    bottleneck = 'balanced'
  }

  const keyMetrics = [duration, sm, dram, occupancy, registers, sharedMemory]
    .filter((metric): metric is KdaNcuMetric => metric !== undefined)
  const evidence = [...keyMetrics.slice(0, 6), ...topStalls.slice(0, 2)].map(metricText)
  const recommendations: string[] = []
  if (bottleneck === 'memory-throughput') {
    recommendations.push('Inspect coalescing, vectorized loads/stores, cache reuse, and unnecessary memory traffic before changing arithmetic.')
  } else if (bottleneck === 'compute-throughput') {
    recommendations.push('Inspect instruction mix, tensor-core eligibility, redundant arithmetic, and fusion opportunities.')
  } else if (bottleneck === 'occupancy') {
    recommendations.push('Check registers, shared memory, block size, and active blocks per SM; change one limiting resource at a time.')
  } else if (bottleneck === 'latency') {
    recommendations.push('Use source-level stall attribution; investigate dependency chains, memory-level parallelism, prefetching, and load-use distance.')
  } else if (bottleneck === 'balanced') {
    recommendations.push('The overview is near-balanced; use source counters and PM sampling to find localized stalls or tail effects.')
  } else {
    recommendations.push('Collect structured full and source-level NCU reports before proposing a performance fix.')
  }
  return {
    bottleneck,
    confidence: bottleneck === 'unknown' || evidence.length < 2 ? 'low' : 'medium',
    keyMetrics,
    topStalls,
    evidence,
    recommendations,
  }
}

/** Parse bounded NCU CSV or explicit KDA_NCU_METRIC lines and derive a conservative diagnosis. */
export function analyzeNcuOutput(output: string): KdaProfileAnalysis {
  const csvMetrics = parseNcuCsv(output)
  const lineMetrics = parseKdaMetricLines(output)
  const parser = csvMetrics.length > 0 ? 'ncu-csv' : lineMetrics.length > 0 ? 'kda-lines' : 'none'
  const metrics = deduplicate(csvMetrics.length > 0 ? csvMetrics : lineMetrics)
  const diagnosis = diagnose(metrics)
  return { parser, metricCount: metrics.length, ...diagnosis }
}
