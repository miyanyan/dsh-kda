import type {
  KdaBottleneck,
  KdaMetricComparison,
  KdaNcuMetric,
  KdaProfileAnalysis,
  KdaProfileComparison,
  KdaProfileObservation,
} from './types.js'

const MAX_METRICS = 4_096

const metricPriority = [
  'duration',
  'compute-throughput',
  'dram-throughput',
  'memory-throughput',
  'achieved-occupancy',
  'registers-per-thread',
  'dynamic-shared-memory-per-block',
  'static-shared-memory-per-block',
  'driver-shared-memory-per-block',
  'waves-per-sm',
]

function parseCsvRows(output: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index]
    if (character === '"') {
      if (quoted && output[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (character === ',' && !quoted) {
      row.push(field.trim())
      field = ''
      continue
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && output[index + 1] === '\n') index += 1
      row.push(field.trim())
      field = ''
      if (row.some(value => value !== '')) rows.push(row)
      row = []
      continue
    }
    field += character
  }
  row.push(field.trim())
  if (row.some(value => value !== '')) rows.push(row)
  return rows
}

function numericValue(raw: string): number | undefined {
  const normalized = raw.replaceAll(',', '').replace(/%$/, '').trim()
  if (normalized === '') return undefined
  const value = Number(normalized)
  return Number.isFinite(value) ? value : undefined
}

function normalizedName(name: string): string {
  return name.toLowerCase().replaceAll('_', ' ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Map both raw NCU ids and exported display names to stable semantic keys. */
export function canonicalNcuMetricName(name: string): string | undefined {
  const normalized = normalizedName(name)
  if (/^gpu time duration (sum|avg)$/.test(normalized) || normalized === 'duration' || normalized === 'kernel duration') return 'duration'
  if (/^sm throughput .*pct of peak/.test(normalized) || normalized === 'compute sm throughput' || normalized === 'compute throughput') return 'compute-throughput'
  if (/^dram (throughput|bytes).*pct of peak/.test(normalized) || normalized === 'dram throughput') return 'dram-throughput'
  if (normalized === 'memory throughput') return 'memory-throughput'
  if (normalized === 'l1 tex cache throughput') return 'l1-tex-throughput'
  if (normalized === 'l2 cache throughput') return 'l2-throughput'
  if (/^sm warps active .*pct of peak/.test(normalized) || normalized === 'achieved occupancy') return 'achieved-occupancy'
  if (normalized === 'theoretical occupancy') return 'theoretical-occupancy'
  if (normalized === 'launch registers per thread' || normalized === 'registers per thread') return 'registers-per-thread'
  if (normalized === 'dynamic shared memory per block') return 'dynamic-shared-memory-per-block'
  if (normalized === 'static shared memory per block') return 'static-shared-memory-per-block'
  if (normalized === 'driver shared memory per block') return 'driver-shared-memory-per-block'
  if (/^launch shared mem per block/.test(normalized)) return 'dynamic-shared-memory-per-block'
  if (normalized === 'waves per sm') return 'waves-per-sm'
  if (/warp issue stalled|warp stall/.test(normalized)) return `stall:${normalized}`
  return undefined
}

interface ParsedNcuOutput {
  metrics: KdaNcuMetric[]
  kernelNames: string[]
  launchIds: string[]
}

function parseNcuCsv(output: string): ParsedNcuOutput {
  const metrics: KdaNcuMetric[] = []
  const kernelNames = new Set<string>()
  const launchIds = new Set<string>()
  let columns: { name: number; unit: number; value: number; section: number; kernel: number; launch: number } | undefined
  for (const fields of parseCsvRows(output)) {
    const normalized = fields.map(field => field.toLowerCase().replaceAll('_', ' ').trim())
    const name = normalized.findIndex(field => field === 'metric name')
    const value = normalized.findIndex(field => field === 'metric value')
    if (name >= 0 && value >= 0) {
      columns = {
        name,
        value,
        unit: normalized.findIndex(field => field === 'metric unit'),
        section: normalized.findIndex(field => field === 'section name'),
        kernel: normalized.findIndex(field => field === 'kernel name'),
        launch: normalized.findIndex(field => field === 'id' || field === 'kernel id'),
      }
      continue
    }
    if (columns === undefined) continue
    const metricName = fields[columns.name]?.trim()
    const parsed = numericValue(fields[columns.value] ?? '')
    if (metricName === undefined || metricName === '' || parsed === undefined) continue
    const unit = columns.unit >= 0 ? fields[columns.unit]?.trim() : undefined
    const section = columns.section >= 0 ? fields[columns.section]?.trim() : undefined
    const kernelName = columns.kernel >= 0 ? fields[columns.kernel]?.trim() : undefined
    const launchId = columns.launch >= 0 ? fields[columns.launch]?.trim() : undefined
    if (kernelName !== undefined && kernelName !== '') kernelNames.add(kernelName)
    if (launchId !== undefined && launchId !== '') launchIds.add(launchId)
    const canonicalName = canonicalNcuMetricName(metricName)
    metrics.push({
      name: metricName,
      value: parsed,
      ...(unit !== undefined && unit !== '' ? { unit } : {}),
      ...(canonicalName !== undefined ? { canonicalName } : {}),
      ...(section !== undefined && section !== '' ? { section } : {}),
      ...(kernelName !== undefined && kernelName !== '' ? { kernelName } : {}),
      ...(launchId !== undefined && launchId !== '' ? { launchId } : {}),
    })
    if (metrics.length >= MAX_METRICS) break
  }
  return { metrics, kernelNames: [...kernelNames], launchIds: [...launchIds] }
}

function parseKdaMetricLines(output: string): KdaNcuMetric[] {
  const metrics: KdaNcuMetric[] = []
  const expression = /^KDA_NCU_METRIC\s*=\s*([^|\r\n]+)\|([^|\r\n]+)(?:\|([^\r\n]+))?$/gm
  for (const match of output.matchAll(expression)) {
    const name = match[1]?.trim()
    const value = numericValue(match[2] ?? '')
    const unit = match[3]?.trim()
    if (name === undefined || name === '' || value === undefined) continue
    const canonicalName = canonicalNcuMetricName(name)
    metrics.push({
      name,
      value,
      ...(unit !== undefined && unit !== '' ? { unit } : {}),
      ...(canonicalName !== undefined ? { canonicalName } : {}),
    })
    if (metrics.length >= MAX_METRICS) break
  }
  return metrics
}

function deduplicate(metrics: readonly KdaNcuMetric[]): KdaNcuMetric[] {
  const byName = new Map<string, KdaNcuMetric>()
  for (const metric of metrics) byName.set(`${metric.launchId ?? ''}\u0000${metric.kernelName ?? ''}\u0000${metric.name}`, metric)
  return [...byName.values()]
}

function metricByCanonical(metrics: readonly KdaNcuMetric[], canonicalName: string): KdaNcuMetric | undefined {
  return metrics.find(metric => metric.canonicalName === canonicalName)
}

function metricText(metric: KdaNcuMetric): string {
  return `${metric.name}=${metric.value}${metric.unit === undefined ? '' : ` ${metric.unit}`}`
}

function observation(summary: string, metrics: Array<KdaNcuMetric | undefined>): KdaProfileObservation {
  return {
    kind: 'measurement',
    summary,
    evidence: metrics.filter((metric): metric is KdaNcuMetric => metric !== undefined).map(metricText),
  }
}

function diagnose(
  metrics: readonly KdaNcuMetric[],
  kernelNames: readonly string[],
  launchIds: readonly string[],
): Omit<KdaProfileAnalysis, 'parser' | 'metricCount' | 'metrics' | 'kernelNames' | 'launchIds'> {
  const duration = metricByCanonical(metrics, 'duration')
  const sm = metricByCanonical(metrics, 'compute-throughput')
  const dram = metricByCanonical(metrics, 'dram-throughput')
  const memory = metricByCanonical(metrics, 'memory-throughput')
  const occupancy = metricByCanonical(metrics, 'achieved-occupancy')
  const registers = metricByCanonical(metrics, 'registers-per-thread')
  const dynamicShared = metricByCanonical(metrics, 'dynamic-shared-memory-per-block')
  const staticShared = metricByCanonical(metrics, 'static-shared-memory-per-block')
  const driverShared = metricByCanonical(metrics, 'driver-shared-memory-per-block')
  const sharedMemory = dynamicShared ?? staticShared ?? driverShared
  const waves = metricByCanonical(metrics, 'waves-per-sm')
  const topStalls = metrics
    .filter(metric => metric.canonicalName?.startsWith('stall:') === true)
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
  const longScoreboard = topStalls.find(metric => /long scoreboard/i.test(normalizedName(metric.name)))

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

  const keyMetrics = [duration, sm, dram, memory, occupancy, registers, dynamicShared, staticShared, driverShared, waves]
    .filter((metric): metric is KdaNcuMetric => metric !== undefined)
  const evidence = [...keyMetrics.slice(0, 10), ...topStalls.slice(0, 3)].map(metricText)
  const observations: KdaProfileObservation[] = []
  if (sm !== undefined && dram !== undefined) {
    observations.push(observation(
      `Compute throughput is ${sm.value}${sm.unit ?? ''}; DRAM throughput is ${dram.value}${dram.unit ?? ''}.`,
      [sm, dram],
    ))
  }
  if (occupancy !== undefined) {
    observations.push(observation(`Achieved occupancy is ${occupancy.value}${occupancy.unit ?? ''}.`, [occupancy]))
  }
  if (registers !== undefined || sharedMemory !== undefined) {
    observations.push(observation('Launch-resource usage was recorded for attribution.', [registers, dynamicShared, staticShared, driverShared]))
  }

  const limitations: string[] = []
  if (kernelNames.length > 1) limitations.push(`Profile contains ${kernelNames.length} kernels; aggregate interpretation may be ambiguous.`)
  if (launchIds.length > 1) limitations.push(`Profile contains ${launchIds.length} launches; automatic diagnosis uses only the first aligned metric for each semantic key.`)
  if (topStalls.length === 0) limitations.push('No structured warp-stall metrics were present; the diagnosis is overview-level only.')
  if (sm === undefined || dram === undefined) limitations.push('Compute and DRAM throughput were not both available, limiting bottleneck classification.')

  let diagnosis = 'Structured metrics are insufficient for a bottleneck classification.'
  const recommendations: string[] = []
  let nextExperiment = {
    action: 'Collect a structured full and source-level NCU report.',
    rationale: 'The current overview does not support a specific performance diagnosis.',
    requiredMetrics: ['duration', 'compute-throughput', 'dram-throughput', 'achieved-occupancy', 'top warp stalls'],
  }
  if (bottleneck === 'memory-throughput') {
    diagnosis = 'The current profile is more consistent with memory-throughput pressure than compute saturation.'
    recommendations.push('Inspect coalescing, vectorized loads/stores, cache reuse, and unnecessary memory traffic before changing arithmetic.')
    nextExperiment = {
      action: 'Test one memory-traffic or coalescing change and collect the same profile sections.',
      rationale: 'DRAM throughput dominates compute throughput in the current evidence.',
      requiredMetrics: ['duration', 'dram-throughput', 'l1-tex-throughput', 'l2-throughput', 'long-scoreboard stalls'],
    }
  } else if (bottleneck === 'compute-throughput') {
    diagnosis = 'The current profile is more consistent with compute-throughput saturation than DRAM bandwidth pressure.'
    recommendations.push('Inspect instruction mix, tensor-core eligibility, redundant arithmetic, and fusion opportunities.')
    nextExperiment = {
      action: 'Test one arithmetic or instruction-mix reduction and collect compute workload/source counters.',
      rationale: 'Compute throughput is high while DRAM throughput is materially lower.',
      requiredMetrics: ['duration', 'compute-throughput', 'executed instruction mix', 'source counters'],
    }
  } else if (bottleneck === 'occupancy') {
    diagnosis = 'Low achieved occupancy is a plausible latency-hiding limitation in the current profile.'
    recommendations.push('Check registers, shared memory, block size, and active blocks per SM; change one limiting resource at a time.')
    nextExperiment = {
      action: 'Change one occupancy-limiting launch resource and re-profile.',
      rationale: 'Achieved occupancy is below the conservative classification threshold.',
      requiredMetrics: ['duration', 'achieved-occupancy', 'registers-per-thread', 'dynamic-shared-memory-per-block'],
    }
  } else if (bottleneck === 'latency') {
    diagnosis = 'Long-scoreboard stalls support a latency or load-use-distance limitation rather than saturated DRAM throughput.'
    recommendations.push('Use source-level stall attribution; investigate dependency chains, memory-level parallelism, prefetching, and load-use distance.')
    nextExperiment = {
      action: 'Collect source-level stall attribution before changing one load-use or dependency-chain variable.',
      rationale: 'The top structured stall evidence is latency-related.',
      requiredMetrics: ['duration', 'long-scoreboard stalls', 'source counters', 'memory-level parallelism'],
    }
  } else if (bottleneck === 'balanced') {
    diagnosis = 'Compute and DRAM throughput are both high; overview evidence is near-balanced.'
    recommendations.push('Use source counters and PM sampling to find localized stalls or tail effects.')
    nextExperiment = {
      action: 'Collect source counters or PM sampling for the hottest source region.',
      rationale: 'Overview throughput metrics do not isolate the limiting code region.',
      requiredMetrics: ['duration', 'source counters', 'PM sampling', 'top warp stalls'],
    }
  } else {
    recommendations.push('Collect structured full and source-level NCU reports before proposing a performance fix.')
  }

  return {
    bottleneck,
    confidence: bottleneck === 'unknown' || evidence.length < 2 ? 'low' : 'medium',
    keyMetrics,
    topStalls,
    evidence,
    observations,
    diagnosis,
    limitations,
    recommendations,
    nextExperiment,
  }
}

function comparableKey(metric: KdaNcuMetric): string {
  return metric.canonicalName ?? `raw:${normalizedName(metric.name)}`
}

function preferredMetricMap(metrics: readonly KdaNcuMetric[]): Map<string, KdaNcuMetric> {
  const values = new Map<string, KdaNcuMetric>()
  for (const metric of metrics) {
    const key = comparableKey(metric)
    if (!values.has(key)) values.set(key, metric)
  }
  return values
}

/** Compare two structured profiles captured in the same explicitly named context. */
export function compareNcuProfiles(
  referenceCandidate: string,
  candidate: string,
  profileContext: string,
  reference: KdaProfileAnalysis,
  current: KdaProfileAnalysis,
): KdaProfileComparison {
  if (reference.kernelNames.length > 1 || current.kernelNames.length > 1
    || reference.launchIds.length > 1 || current.launchIds.length > 1) {
    return {
      referenceCandidate,
      candidate,
      profileContext,
      metrics: [],
      warnings: ['Profile comparison is disabled because at least one capture contains multiple kernels or launches. Filter NCU to one target launch.'],
    }
  }
  const baselineMetrics = preferredMetricMap(reference.metrics)
  const candidateMetrics = preferredMetricMap(current.metrics)
  const comparisons: KdaMetricComparison[] = []
  const warnings: string[] = []
  for (const [canonicalName, baseline] of baselineMetrics) {
    const next = candidateMetrics.get(canonicalName)
    if (next === undefined) continue
    if ((baseline.unit ?? '') !== (next.unit ?? '')) {
      warnings.push(`${baseline.name} was not compared because units differ (${baseline.unit ?? 'unitless'} vs ${next.unit ?? 'unitless'}).`)
      continue
    }
    const delta = next.value - baseline.value
    const deltaPercent = baseline.value === 0 ? undefined : delta / Math.abs(baseline.value) * 100
    comparisons.push({
      canonicalName,
      name: next.name,
      ...(next.unit !== undefined ? { unit: next.unit } : {}),
      baselineValue: baseline.value,
      candidateValue: next.value,
      delta,
      ...(deltaPercent !== undefined && Number.isFinite(deltaPercent) ? { deltaPercent } : {}),
    })
  }
  comparisons.sort((left, right) => {
    const leftPriority = metricPriority.indexOf(left.canonicalName)
    const rightPriority = metricPriority.indexOf(right.canonicalName)
    return (leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority)
      - (rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority)
      || left.canonicalName.localeCompare(right.canonicalName)
  })
  if (comparisons.length === 0) warnings.push('No same-unit metrics could be aligned between the reference and candidate profiles.')
  return { referenceCandidate, candidate, profileContext, metrics: comparisons, warnings }
}

/** Attach a durable baseline comparison and its direct observations without changing the absolute diagnosis. */
export function withNcuComparison(analysis: KdaProfileAnalysis, comparison: KdaProfileComparison): KdaProfileAnalysis {
  const changed = [...comparison.metrics]
    .filter(metric => metric.deltaPercent !== undefined)
    .sort((left, right) => Math.abs(right.deltaPercent ?? 0) - Math.abs(left.deltaPercent ?? 0))
    .slice(0, 5)
  const comparisonObservations: KdaProfileObservation[] = changed.map(metric => ({
    kind: 'comparison',
    summary: `${metric.name} changed from ${metric.baselineValue} to ${metric.candidateValue}${metric.unit === undefined ? '' : ` ${metric.unit}`} (${metric.deltaPercent === undefined ? 'delta unavailable' : `${metric.deltaPercent >= 0 ? '+' : ''}${metric.deltaPercent.toFixed(2)}%`}).`,
    evidence: [metric.canonicalName],
  }))
  return {
    ...analysis,
    comparison,
    observations: [...analysis.observations, ...comparisonObservations],
    limitations: [...analysis.limitations, ...comparison.warnings],
  }
}

/** Parse bounded NCU CSV or explicit KDA_NCU_METRIC lines and derive a conservative diagnosis. */
export function analyzeNcuOutput(output: string): KdaProfileAnalysis {
  const csv = parseNcuCsv(output)
  const lineMetrics = parseKdaMetricLines(output)
  const parser = csv.metrics.length > 0 ? 'ncu-csv' : lineMetrics.length > 0 ? 'kda-lines' : 'none'
  const metrics = deduplicate(csv.metrics.length > 0 ? csv.metrics : lineMetrics)
  const diagnosis = diagnose(metrics, csv.kernelNames, csv.launchIds)
  return {
    parser,
    metricCount: metrics.length,
    metrics,
    kernelNames: csv.kernelNames,
    launchIds: csv.launchIds,
    ...diagnosis,
  }
}
