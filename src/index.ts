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

const skillUrl = new URL('../skills/kda/SKILL.md', import.meta.url)
const skillPath = fileURLToPath(skillUrl)
const skillContent = readFileSync(skillUrl, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
const skillDescription = 'Run evidence-driven CUDA, Triton, CuTe, or CUTLASS kernel optimization loops with correctness checks, repeatable benchmarks, Nsight Compute profiling, candidate lineage, and promotion decisions.'
const skillWhenToUse = 'Use for requests to optimize or profile a GPU kernel, diagnose why a kernel is slow, analyze NCU evidence, compare kernel candidates, or continue an existing kernel optimization run, including Chinese requests such as “优化 kernel”, “看 NCU 报告”, “为什么慢”, and “继续迭代”.'

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
  parentCandidate?: string
  hypothesis: string
  changeSummary?: string
  sourceRevision?: string
  workdir?: string
  correctnessCommand: string
  benchmarkCommand?: string
  profileCommand?: string
  profileArtifact?: string
  baselineMetric?: number
  metricPattern?: string
  metricUnit?: string
  lowerIsBetter?: boolean
  minimumImprovementPercent?: number
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
    name: 'kda',
    description: skillDescription,
    whenToUse: skillWhenToUse,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'bundled',
    resourceBase: { kind: 'directory', path: dirname(skillPath) },
    path: skillPath,
    content: skillContent,
  })

  ctx.tools.register(defineTool({
    name: 'kda_evaluate_candidate',
    description: 'Evaluate one implemented CUDA kernel candidate inside a persistent Kernel Design Agents optimization run. '
      + 'Reconstructs prior candidates from the durable dsh session, runs correctness first, then benchmark and optional NCU profiling, '
      + 'and returns a replayable candidate graph with promote/revise/reject plus evidence-backed profiler guidance. '
      + 'Reuse optimizationRunId across iterations. Benchmark stdout should contain KDA_METRIC=<number> unless metricPattern is provided.',
    parameters: {
      optimizationRunId: { type: 'string', required: true, description: 'Stable id shared by every candidate in this optimization run.' },
      task: { type: 'string', required: true, description: 'Stable task name.' },
      objective: { type: 'string', required: true, description: 'Optimization objective and correctness constraints.' },
      candidate: { type: 'string', required: true, description: 'Unique candidate id.' },
      parentCandidate: { type: 'string', description: 'Parent candidate id, required after the first candidate.' },
      hypothesis: { type: 'string', required: true, description: 'One testable performance hypothesis for this candidate.' },
      changeSummary: { type: 'string', description: 'Short description of the single meaningful change made for this candidate.' },
      sourceRevision: { type: 'string', description: 'Git commit, tree hash, or other source revision identifying the evaluated code.' },
      workdir: { type: 'string', description: 'Command working directory; defaults to the session workspace.' },
      correctnessCommand: { type: 'string', required: true, description: 'Command that proves candidate correctness.' },
      benchmarkCommand: { type: 'string', description: 'Command that measures the target metric.' },
      profileCommand: { type: 'string', description: 'Optional command that emits NCU CSV or KDA_NCU_METRIC=name|value|unit lines.' },
      profileArtifact: { type: 'string', description: 'Optional path to the profiler artifact, such as a .ncu-rep file.' },
      baselineMetric: { type: 'number', description: 'Stable run baseline; later candidates inherit it from prior durable results.' },
      metricPattern: { type: 'string', description: 'Optional JavaScript regular expression; capture group 1 or named group metric must contain the numeric metric.' },
      metricUnit: { type: 'string', description: 'Metric unit displayed in the trajectory, for example us or TFLOP/s.' },
      lowerIsBetter: { type: 'boolean', description: 'Whether a smaller metric is better; defaults to true.' },
      minimumImprovementPercent: { type: 'number', description: 'Required improvement over baseline; defaults to the plugin setting.' },
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
        args.task,
      )
      const inheritedBaseline = previousCandidates.find(candidate => candidate.baselineMetric !== undefined)?.baselineMetric
      const request: KdaEvaluationRequest = {
        optimizationRunId: args.optimizationRunId,
        task: args.task,
        objective: args.objective,
        candidate: args.candidate,
        ...(args.parentCandidate !== undefined ? { parentCandidate: args.parentCandidate } : {}),
        hypothesis: args.hypothesis,
        ...(args.changeSummary !== undefined ? { changeSummary: args.changeSummary } : {}),
        ...(args.sourceRevision !== undefined ? { sourceRevision: args.sourceRevision } : {}),
        workdir,
        correctnessCommand: args.correctnessCommand,
        ...(args.benchmarkCommand !== undefined ? { benchmarkCommand: args.benchmarkCommand } : {}),
        ...(args.profileCommand !== undefined ? { profileCommand: args.profileCommand } : {}),
        ...(args.profileArtifact !== undefined ? { profileArtifact: args.profileArtifact } : {}),
        ...(args.baselineMetric !== undefined
          ? { baselineMetric: args.baselineMetric }
          : inheritedBaseline !== undefined ? { baselineMetric: inheritedBaseline } : {}),
        ...(args.metricPattern !== undefined ? { metricPattern: args.metricPattern } : {}),
        ...(args.metricUnit !== undefined ? { metricUnit: args.metricUnit } : {}),
        lowerIsBetter: args.lowerIsBetter ?? true,
        minimumImprovementPercent: args.minimumImprovementPercent ?? defaultMinimumImprovementPercent,
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
  KdaCandidateSummary,
  KdaCommandResult,
  KdaDecision,
  KdaEvaluationRequest,
  KdaEvaluationResult,
  KdaNcuMetric,
  KdaProfileAnalysis,
  KdaStageName,
  KdaStageResult,
  KdaTrajectoryEvent,
  KdaTrajectoryObserver,
} from './types.js'
export { analyzeNcuOutput } from './ncu.js'
