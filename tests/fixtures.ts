import { NCU_REPORT_SKILL_COMMIT } from '../src/ncu-report.js'
import type { KdaNcuReportAssessment } from '../src/types.js'

export function ncuAssessment(overrides: Partial<KdaNcuReportAssessment> = {}): KdaNcuReportAssessment {
  return {
    source: 'mit-han-lab/ncu-report-skill',
    sourceCommit: NCU_REPORT_SKILL_COMMIT,
    reportPath: 'profile/run/REPORT.md',
    reportMarkdown: '# NCU Profiling Report\n\n## Executive summary\n\nThe kernel is latency-bound on dependent global loads.\n\n## Key metrics\n\n- Long scoreboard: 45%\n- DRAM throughput: 18%\n',
    fullReportPath: 'profile/run/reports/full.ncu-rep',
    sourceReportPath: 'profile/run/reports/source.ncu-rep',
    analysisPath: 'profile/run/analysis',
    targetHardware: 'NVIDIA B200 / sm_100',
    targetKernel: 'vector_add',
    workload: '1M aligned elements through the production dispatch',
    dimensions: [
      { dimension: 'launch-occupancy', status: 'analyzed', conclusion: 'The grid fills the GPU.', signals: [{ statement: 'Waves per SM is 4.2.', source: 'full report', metric: 'launch__waves_per_multiprocessor', value: 4.2 }], limitations: [] },
      { dimension: 'workload-balance', status: 'analyzed', conclusion: 'No material tail is visible.', signals: [{ statement: 'The PM timeline has a clean drop.', source: 'PM sampling timeline' }], limitations: [] },
      { dimension: 'stall-hotspots', status: 'analyzed', conclusion: 'Long scoreboard dominates source stalls.', signals: [{ statement: 'Long scoreboard is 45% of samples.', source: 'source report line 42', metric: 'smsp__pcsamp_warps_issue_stalled_long_scoreboard', value: 45, unit: '%' }], limitations: [] },
      { dimension: 'tensor-core', status: 'not-applicable', conclusion: 'The elementwise workload is not MMA-shaped.', signals: [], limitations: [] },
      { dimension: 'timeline', status: 'analyzed', conclusion: 'Utilization is flat before a clean drop.', signals: [{ statement: 'No long tail or sawtooth is present.', source: 'PM sampling timeline' }], limitations: [] },
      { dimension: 'memory', status: 'analyzed', conclusion: 'Low DRAM throughput plus long stalls indicates latency, not bandwidth.', signals: [{ statement: 'DRAM throughput is 18%.', source: 'full report', metric: 'dram__bytes_read.sum.pct_of_peak_sustained_elapsed', value: 18, unit: '%' }], limitations: [] },
    ],
    patterns: [{
      id: 'E', name: 'Latency-bound (long-scoreboard-dominated)', confidence: 'high', estimatedSpeedupPercent: 18,
      signals: ['Long scoreboard is 45%; DRAM throughput is 18%.'], cause: 'Dependent global loads expose latency.',
      firstLineFix: 'Issue independent loads before consuming them.', exceptions: [],
    }],
    rules: [{ name: 'Memory latency', severity: 'optimization', message: 'Increase memory-level parallelism.', estimatedSpeedupPercent: 18, evidence: ['NCU details rule'] }],
    primaryDiagnosis: 'The kernel is latency-bound on dependent global loads, not DRAM bandwidth.',
    secondaryFindings: ['Launch geometry and workload balance are healthy.'],
    recommendations: [{ rank: 1, action: 'Unroll to expose four independent loads.', rationale: 'It targets the dominant source stall.', expectedImpact: 'NCU estimates up to 18%.', supportingPatterns: ['E'], requiredMetrics: ['duration', 'long-scoreboard'] }],
    limitations: [],
    ...overrides,
  }
}

export function ncuAssessmentJson(overrides: Partial<KdaNcuReportAssessment> = {}): string {
  return JSON.stringify(ncuAssessment(overrides))
}
