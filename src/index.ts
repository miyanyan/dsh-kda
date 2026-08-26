import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-shell'
import { collectCandidateHistory } from './history.js'
import { KdaNativeTrajectoryRecorder } from './native-trajectory.js'
import { evaluateCandidate } from './runner.js'
import type { KdaCommandResult, KdaEvaluationRequest, KdaStageName } from './types.js'

export const name = 'kda'
export const inject = ['tools', 'shell', 'skills']

function bundledSkill(relativePath: string): { path: string; content: string } {
  const path = fileURLToPath(new URL(relativePath, import.meta.url))
  return {
    path,
    content: readFileSync(path, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''),
  }
}

const ncuReportSkill = bundledSkill('../skills/ncu-report-skill/SKILL.md')
const recorderSkill = bundledSkill('../skills/kda/SKILL.md')
const ncuReportDescription = 'Profile CUDA kernels with Nsight Compute on B200 / sm_100. Use when the user asks to profile a kernel, analyze its performance, diagnose bottlenecks, read an ncu report, or write an optimization plan.'
const ncuReportWhenToUse = 'Use for CUDA kernel profiling, bottleneck diagnosis, NCU report analysis, and evidence-ranked optimization planning, including “profile 一下”, “为什么慢”, “ncu 报告”, and “下一步怎么优化”.'
const recorderDescription = 'Record a completed kernel candidate evaluation as a durable KDA semantic trajectory without replacing the original ncu-report-skill diagnosis.'
const recorderWhenToUse = 'Use after the ncu-report-skill workflow has collected and analyzed evidence, when correctness, benchmark, profiler artifact, candidate lineage, and the final mechanism expectation should be recorded in the KDA view.'

/** Deployment limits for KDA evidence commands. */
export interface Config {
  timeoutMs?: number
  outputMaxBytes?: number
  defaultMinimumImprovementPercent?: number
}

/** Runtime validation for deployment-owned KDA limits. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().min(1).default(300_000),
  outputMaxBytes: z.number().min(1_024).default(1_048_576),
  defaultMinimumImprovementPercent: z.number().min(0).default(0),
})

interface KdaToolArgs {
  optimizationRunId: string
  task: string
  objective: string
  candidate: string
  candidateRole: 'baseline' | 'experiment'
  parentCandidate?: string
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  workdir?: string
  correctnessCommand: string
  benchmarkCommand: string
  profileCommand?: string
  profileArtifact?: string
  benchmarkContext: string
  profileContext?: string
  metricPattern?: string
  metricUnit: string
  lowerIsBetter?: boolean
  minimumImprovementPercent?: number
  requireProfileForPromotion?: boolean
  requireMechanismForPromotion?: boolean
  expectedProfileMetric?: string
  expectedProfileDirection?: 'increase' | 'decrease' | 'stable'
  expectedProfileMinimumChangePercent?: number
  ncuReportAssessmentJson?: string
}

interface KdaSkillRegistry {
  register(skill: {
    name: string
    description: string
    whenToUse: string
    invocation: { modelInvocable: boolean, userInvocable: boolean }
    source: string
    resourceBase: { kind: 'directory', path: string }
    path: string
    content: string
  }): () => void
}

function resolveWorkdir(workdir: string | undefined, sessionCwd: string | undefined): string {
  if (workdir === undefined) return sessionCwd ?? process.cwd()
  if (isAbsolute(workdir)) return workdir
  return resolvePath(sessionCwd ?? process.cwd(), workdir)
}

/** Register the model-facing, session-reconstructing candidate evaluator. */
export function apply(ctx: Context, config: Config = {}): void {
  const timeoutMs = config.timeoutMs ?? 300_000
  const outputMaxBytes = config.outputMaxBytes ?? 1_048_576
  const defaultMinimumImprovementPercent = config.defaultMinimumImprovementPercent ?? 0

  const skills = (ctx as Context & { skills: KdaSkillRegistry }).skills
  skills.register({
    name: 'ncu-report-skill',
    description: ncuReportDescription,
    whenToUse: ncuReportWhenToUse,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    resourceBase: { kind: 'directory', path: dirname(ncuReportSkill.path) },
    path: ncuReportSkill.path,
    content: ncuReportSkill.content,
  })

  skills.register({
    name: 'kda-recorder',
    description: recorderDescription,
    whenToUse: recorderWhenToUse,
    invocation: { modelInvocable: true, userInvocable: false },
    source: 'bundled',
    resourceBase: { kind: 'directory', path: dirname(recorderSkill.path) },
    path: recorderSkill.path,
    content: recorderSkill.content,
  })

  ctx.tools.register(defineTool({
    name: 'kda_evaluate_candidate',
    description: 'Evaluate one implemented CUDA kernel candidate inside a persistent Kernel Design Agents optimization run. '
      + 'Reconstructs prior candidates from the durable dsh session, runs correctness first, then benchmark and optional NCU profiling, '
      + 'and returns a replayable candidate graph with a separate performance decision and profiler-backed mechanism verdict. '
      + 'Record the unmodified implementation first with candidateRole=baseline, then reuse optimizationRunId and parentCandidate. '
      + 'Benchmark stdout should contain KDA_METRIC=<number> unless metricPattern is provided.',
    parameters: {
      optimizationRunId: { type: 'string', required: true, description: 'Stable id shared by every candidate in this optimization run.' },
      task: { type: 'string', required: true, description: 'Stable task name.' },
      objective: { type: 'string', required: true, description: 'Optimization objective and correctness constraints.' },
      candidate: { type: 'string', required: true, description: 'Unique candidate id.' },
      candidateRole: { type: 'string', required: true, enum: ['baseline', 'experiment'], description: 'Use baseline for the first unmodified reference and experiment for every later candidate.' },
      parentCandidate: { type: 'string', description: 'Parent candidate id, required after the first candidate.' },
      hypothesis: { type: 'string', required: true, description: 'One testable performance hypothesis for this candidate.' },
      changeSummary: { type: 'string', description: 'Short description of the single meaningful change made for this candidate.' },
      sourceRevision: { type: 'string', description: 'Git commit, tree hash, or other source revision identifying the evaluated code.' },
      workdir: { type: 'string', description: 'Command working directory; defaults to the session workspace.' },
      correctnessCommand: { type: 'string', required: true, description: 'Command that proves candidate correctness.' },
      benchmarkCommand: { type: 'string', required: true, description: 'Command that measures the target metric.' },
      profileCommand: { type: 'string', description: 'Optional command that emits NCU CSV or KDA_NCU_METRIC=name|value|unit lines.' },
      profileArtifact: { type: 'string', description: 'Optional path to the profiler artifact, such as a .ncu-rep file.' },
      benchmarkContext: { type: 'string', required: true, description: 'Stable environment/workload label for the promotion benchmark, for example win-rtx5070ti-s1024.' },
      profileContext: { type: 'string', description: 'Stable environment/workload label used to prove that two profiler captures are comparable.' },
      metricPattern: { type: 'string', description: 'Optional JavaScript regular expression; capture group 1 or named group metric must contain the numeric metric.' },
      metricUnit: { type: 'string', required: true, description: 'Metric unit displayed in the trajectory, for example us or TFLOP/s.' },
      lowerIsBetter: { type: 'boolean', description: 'Whether a smaller metric is better; defaults to true.' },
      minimumImprovementPercent: { type: 'number', description: 'Required improvement over baseline; defaults to the plugin setting.' },
      requireProfileForPromotion: { type: 'boolean', description: 'Require parseable profiler metrics before promotion.' },
      requireMechanismForPromotion: { type: 'boolean', description: 'Require the declared metric mechanism to be supported or partially supported before promotion.' },
      expectedProfileMetric: { type: 'string', description: 'Canonical metric key or exact NCU metric name expected to change, for example compute-throughput.' },
      expectedProfileDirection: { type: 'string', enum: ['increase', 'decrease', 'stable'], description: 'Expected direction for expectedProfileMetric.' },
      expectedProfileMinimumChangePercent: { type: 'number', description: 'Minimum absolute percentage change used to verify the expected profiler direction; defaults to 1.' },
      ncuReportAssessmentJson: { type: 'string', description: 'Required with profileCommand. JSON sidecar derived from the bundled original ncu-report-skill REPORT.md, including the complete reportMarkdown text, all six dimensions, matched playbook patterns, NCU rules, primary diagnosis, and ranked recommendations. Follow skills/kda/references/ncu-assessment-schema.md exactly.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
      presentationMeta: (_args, value) => {
        try {
          return JSON.parse(value) as Record<string, unknown>
        } catch {
          return null
        }
      },
    },
    async execute(args: KdaToolArgs, exec) {
      const workdir = resolveWorkdir(args.workdir, exec.agent?.session.header.cwd)
      const previousCandidates = collectCandidateHistory(
        exec.agent?.session.events ?? [],
        args.optimizationRunId,
      )
      const request: KdaEvaluationRequest = {
        optimizationRunId: args.optimizationRunId,
        task: args.task,
        objective: args.objective,
        candidate: args.candidate,
        candidateRole: args.candidateRole,
        ...(args.parentCandidate !== undefined ? { parentCandidate: args.parentCandidate } : {}),
        hypothesis: args.hypothesis,
        ...(args.changeSummary !== undefined ? { changeSummary: args.changeSummary } : {}),
        ...(args.sourceRevision !== undefined ? { sourceRevision: args.sourceRevision } : {}),
        workdir,
        correctnessCommand: args.correctnessCommand,
        benchmarkCommand: args.benchmarkCommand,
        ...(args.profileCommand !== undefined ? { profileCommand: args.profileCommand } : {}),
        ...(args.profileArtifact !== undefined ? { profileArtifact: args.profileArtifact } : {}),
        benchmarkContext: args.benchmarkContext,
        ...(args.profileContext !== undefined ? { profileContext: args.profileContext } : {}),
        ...(args.metricPattern !== undefined ? { metricPattern: args.metricPattern } : {}),
        metricUnit: args.metricUnit,
        lowerIsBetter: args.lowerIsBetter ?? true,
        minimumImprovementPercent: args.minimumImprovementPercent ?? defaultMinimumImprovementPercent,
        ...(args.requireProfileForPromotion !== undefined ? { requireProfileForPromotion: args.requireProfileForPromotion } : {}),
        ...(args.requireMechanismForPromotion !== undefined ? { requireMechanismForPromotion: args.requireMechanismForPromotion } : {}),
        ...(args.expectedProfileMetric !== undefined ? { expectedProfileMetric: args.expectedProfileMetric } : {}),
        ...(args.expectedProfileDirection !== undefined ? { expectedProfileDirection: args.expectedProfileDirection } : {}),
        ...(args.expectedProfileMinimumChangePercent !== undefined
          ? { expectedProfileMinimumChangePercent: args.expectedProfileMinimumChangePercent }
          : {}),
        ...(args.ncuReportAssessmentJson !== undefined ? { ncuReportAssessmentJson: args.ncuReportAssessmentJson } : {}),
        previousCandidates,
      }
      const runner = {
        async run(_stage: KdaStageName, command: string, commandWorkdir: string, signal?: AbortSignal): Promise<KdaCommandResult> {
          const result = await ctx.shell.run(ctx.shell.resolve({
            command,
            workdir: commandWorkdir,
            timeoutMs,
            stdoutMaxBytes: outputMaxBytes,
            ...(signal !== undefined ? { signal } : {}),
          }))
          return {
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            aborted: result.aborted,
            stdout: {
              text: result.stdout.text,
              truncated: result.stdout.truncated,
              ...(result.stdout.spillPath !== undefined ? { spillPath: result.stdout.spillPath } : {}),
            },
            stderr: {
              text: result.stderr.text,
              truncated: result.stderr.truncated,
              ...(result.stderr.spillPath !== undefined ? { spillPath: result.stderr.spillPath } : {}),
            },
          }
        },
      }
      const nativeTrajectory = new KdaNativeTrajectoryRecorder(exec)
      return JSON.stringify(await evaluateCandidate(request, runner, exec.signal, nativeTrajectory.observe))
    },
  }))
}

export type {
  KdaBottleneck,
  KdaCandidateRole,
  KdaCandidateSummary,
  KdaCommandResult,
  KdaDecision,
  KdaDecisionGate,
  KdaDecisionGateName,
  KdaDecisionGateStatus,
  KdaEvaluationRequest,
  KdaEvaluationResult,
  KdaExpectedProfileDirection,
  KdaHypothesisAssessment,
  KdaNcuMetric,
  KdaMechanismVerdict,
  KdaNcuDimensionAssessment,
  KdaNcuDimensionName,
  KdaNcuDimensionStatus,
  KdaNcuPatternId,
  KdaNcuPatternMatch,
  KdaNcuRankedRecommendation,
  KdaNcuReportAssessment,
  KdaNcuReportSignal,
  KdaNcuRuleFinding,
  KdaMetricComparison,
  KdaProfileAnalysis,
  KdaProfileComparison,
  KdaProfileObservation,
  KdaNextExperiment,
  KdaProfileStatus,
  KdaPromotionPolicy,
  KdaStageName,
  KdaStageResult,
  KdaTrajectoryEvent,
  KdaTrajectoryObserver,
} from './types.js'
export { analyzeNcuOutput, canonicalNcuMetricName, compareNcuProfiles, withNcuComparison } from './ncu.js'
export { NCU_DIMENSIONS, NCU_REPORT_SKILL_COMMIT, parseNcuReportAssessmentJson } from './ncu-report.js'
