import type {
  KdaNcuDimensionAssessment,
  KdaNcuDimensionName,
  KdaNcuPatternId,
  KdaNcuPatternMatch,
  KdaNcuRankedRecommendation,
  KdaNcuReportAssessment,
  KdaNcuReportSignal,
  KdaNcuRuleFinding,
} from './types.js'

export const NCU_REPORT_SKILL_COMMIT = '1cf238d6b41c79bd35041192506c4d45e765a3f1'
export const NCU_DIMENSIONS: readonly KdaNcuDimensionName[] = [
  'launch-occupancy',
  'workload-balance',
  'stall-hotspots',
  'tensor-core',
  'timeline',
  'memory',
]

const MAX_ASSESSMENT_BYTES = 512 * 1_024
const patternIds = new Set('ABCDEFGHIJKLMN'.split(''))

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path)
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be finite`)
  return value
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  if (value.length > 128) throw new Error(`${path} exceeds 128 entries`)
  return value.map((item, index) => string(item, `${path}[${index}]`))
}

function patternId(value: unknown, path: string): KdaNcuPatternId {
  if (typeof value !== 'string' || !patternIds.has(value)) throw new Error(`${path} must be one of A-N`)
  return value as KdaNcuPatternId
}

function signal(value: unknown, path: string): KdaNcuReportSignal {
  const item = object(value, path)
  const metric = optionalString(item.metric, `${path}.metric`)
  const unit = optionalString(item.unit, `${path}.unit`)
  const metricValue = item.value === undefined ? undefined : finite(item.value, `${path}.value`)
  return {
    statement: string(item.statement, `${path}.statement`),
    source: string(item.source, `${path}.source`),
    ...(metric === undefined ? {} : { metric }),
    ...(metricValue === undefined ? {} : { value: metricValue }),
    ...(unit === undefined ? {} : { unit }),
  }
}

function dimension(value: unknown, path: string): KdaNcuDimensionAssessment {
  const item = object(value, path)
  if (!NCU_DIMENSIONS.includes(item.dimension as KdaNcuDimensionName)) throw new Error(`${path}.dimension is invalid`)
  if (item.status !== 'analyzed' && item.status !== 'missing-evidence' && item.status !== 'not-applicable') {
    throw new Error(`${path}.status is invalid`)
  }
  if (!Array.isArray(item.signals) || item.signals.length > 128) throw new Error(`${path}.signals must contain at most 128 entries`)
  return {
    dimension: item.dimension as KdaNcuDimensionName,
    status: item.status,
    conclusion: string(item.conclusion, `${path}.conclusion`),
    signals: item.signals.map((entry, index) => signal(entry, `${path}.signals[${index}]`)),
    limitations: stringArray(item.limitations, `${path}.limitations`),
  }
}

function pattern(value: unknown, path: string): KdaNcuPatternMatch {
  const item = object(value, path)
  if (item.confidence !== 'low' && item.confidence !== 'medium' && item.confidence !== 'high') throw new Error(`${path}.confidence is invalid`)
  const estimated = item.estimatedSpeedupPercent === undefined ? undefined : finite(item.estimatedSpeedupPercent, `${path}.estimatedSpeedupPercent`)
  return {
    id: patternId(item.id, `${path}.id`),
    name: string(item.name, `${path}.name`),
    confidence: item.confidence,
    ...(estimated === undefined ? {} : { estimatedSpeedupPercent: estimated }),
    signals: stringArray(item.signals, `${path}.signals`),
    cause: string(item.cause, `${path}.cause`),
    firstLineFix: string(item.firstLineFix, `${path}.firstLineFix`),
    exceptions: stringArray(item.exceptions, `${path}.exceptions`),
  }
}

function rule(value: unknown, path: string): KdaNcuRuleFinding {
  const item = object(value, path)
  if (item.severity !== 'info' && item.severity !== 'warning' && item.severity !== 'optimization') throw new Error(`${path}.severity is invalid`)
  const estimated = item.estimatedSpeedupPercent === undefined ? undefined : finite(item.estimatedSpeedupPercent, `${path}.estimatedSpeedupPercent`)
  return {
    name: string(item.name, `${path}.name`),
    severity: item.severity,
    message: string(item.message, `${path}.message`),
    ...(estimated === undefined ? {} : { estimatedSpeedupPercent: estimated }),
    evidence: stringArray(item.evidence, `${path}.evidence`),
  }
}

function recommendation(value: unknown, path: string): KdaNcuRankedRecommendation {
  const item = object(value, path)
  const rank = finite(item.rank, `${path}.rank`)
  if (!Number.isInteger(rank) || rank < 1) throw new Error(`${path}.rank must be a positive integer`)
  if (!Array.isArray(item.supportingPatterns)) throw new Error(`${path}.supportingPatterns must be an array`)
  return {
    rank,
    action: string(item.action, `${path}.action`),
    rationale: string(item.rationale, `${path}.rationale`),
    expectedImpact: string(item.expectedImpact, `${path}.expectedImpact`),
    supportingPatterns: item.supportingPatterns.map((entry, index) => patternId(entry, `${path}.supportingPatterns[${index}]`)),
    requiredMetrics: stringArray(item.requiredMetrics, `${path}.requiredMetrics`),
  }
}

function boundedArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error(`${path} must contain at most 128 entries`)
  return value
}

/** Parse and strictly validate the durable sidecar authored from the original skill report. */
export function parseNcuReportAssessmentJson(value: string | undefined): KdaNcuReportAssessment | undefined {
  if (value === undefined) return undefined
  if (Buffer.byteLength(value, 'utf8') > MAX_ASSESSMENT_BYTES) throw new Error('ncuReportAssessmentJson exceeds 512 KiB')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`ncuReportAssessmentJson is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const item = object(parsed, 'ncuReportAssessmentJson')
  if (item.source !== 'mit-han-lab/ncu-report-skill') throw new Error('ncuReportAssessmentJson.source must identify mit-han-lab/ncu-report-skill')
  if (item.sourceCommit !== NCU_REPORT_SKILL_COMMIT) throw new Error(`ncuReportAssessmentJson.sourceCommit must be ${NCU_REPORT_SKILL_COMMIT}`)
  const dimensions = boundedArray(item.dimensions, 'ncuReportAssessmentJson.dimensions').map((entry, index) => dimension(entry, `ncuReportAssessmentJson.dimensions[${index}]`))
  const names = new Set(dimensions.map(entry => entry.dimension))
  if (dimensions.length !== NCU_DIMENSIONS.length || NCU_DIMENSIONS.some(name => !names.has(name))) {
    throw new Error('ncuReportAssessmentJson.dimensions must contain each of the six original analysis dimensions exactly once')
  }
  const patterns = boundedArray(item.patterns, 'ncuReportAssessmentJson.patterns').map((entry, index) => pattern(entry, `ncuReportAssessmentJson.patterns[${index}]`))
  if (new Set(patterns.map(entry => entry.id)).size !== patterns.length) throw new Error('ncuReportAssessmentJson.patterns contains duplicate ids')
  const rules = boundedArray(item.rules, 'ncuReportAssessmentJson.rules').map((entry, index) => rule(entry, `ncuReportAssessmentJson.rules[${index}]`))
  const recommendations = boundedArray(item.recommendations, 'ncuReportAssessmentJson.recommendations')
    .map((entry, index) => recommendation(entry, `ncuReportAssessmentJson.recommendations[${index}]`))
    .sort((left, right) => left.rank - right.rank)
  if (new Set(recommendations.map(entry => entry.rank)).size !== recommendations.length) throw new Error('ncuReportAssessmentJson.recommendations contains duplicate ranks')
  const fullReportPath = optionalString(item.fullReportPath, 'ncuReportAssessmentJson.fullReportPath')
  const sourceReportPath = optionalString(item.sourceReportPath, 'ncuReportAssessmentJson.sourceReportPath')
  const analysisPath = optionalString(item.analysisPath, 'ncuReportAssessmentJson.analysisPath')
  return {
    source: 'mit-han-lab/ncu-report-skill',
    sourceCommit: NCU_REPORT_SKILL_COMMIT,
    reportPath: string(item.reportPath, 'ncuReportAssessmentJson.reportPath'),
    reportMarkdown: string(item.reportMarkdown, 'ncuReportAssessmentJson.reportMarkdown'),
    ...(fullReportPath === undefined ? {} : { fullReportPath }),
    ...(sourceReportPath === undefined ? {} : { sourceReportPath }),
    ...(analysisPath === undefined ? {} : { analysisPath }),
    targetHardware: string(item.targetHardware, 'ncuReportAssessmentJson.targetHardware'),
    targetKernel: string(item.targetKernel, 'ncuReportAssessmentJson.targetKernel'),
    workload: string(item.workload, 'ncuReportAssessmentJson.workload'),
    dimensions,
    patterns,
    rules,
    primaryDiagnosis: string(item.primaryDiagnosis, 'ncuReportAssessmentJson.primaryDiagnosis'),
    secondaryFindings: stringArray(item.secondaryFindings, 'ncuReportAssessmentJson.secondaryFindings'),
    recommendations,
    limitations: stringArray(item.limitations, 'ncuReportAssessmentJson.limitations'),
  }
}
