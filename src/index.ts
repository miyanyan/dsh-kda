import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-shell'
import { evaluateCandidate } from './runner.js'
import type { KdaCommandResult, KdaEvaluationRequest, KdaStageName } from './types.js'

export const name = 'kda'
export const inject = ['tools', 'shell']

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
  task: string
  objective: string
  candidate: string
  parentCandidate?: string
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

function resolveWorkdir(workdir: string | undefined, sessionCwd: string | undefined): string {
  if (workdir === undefined) return sessionCwd ?? process.cwd()
  if (isAbsolute(workdir)) return workdir
  return resolvePath(sessionCwd ?? process.cwd(), workdir)
}

/** Register the model-facing candidate evaluator. */
export function apply(ctx: Context, config: Config = {}): void {
  const timeoutMs = config.timeoutMs ?? 300_000
  const outputMaxBytes = config.outputMaxBytes ?? 1_048_576
  const defaultMinimumImprovementPercent = config.defaultMinimumImprovementPercent ?? 0

  ctx.tools.register(defineTool({
    name: 'kda_evaluate_candidate',
    description: 'Evaluate one implemented CUDA kernel candidate using the Kernel Design Agents workflow. '
      + 'Runs correctness first, then optional benchmark and profiling commands, records structured evidence, '
      + 'and returns promote/revise/reject. Benchmark stdout should contain KDA_METRIC=<number> unless metricPattern is provided.',
    parameters: {
      task: { type: 'string', required: true, description: 'Stable task name.' },
      objective: { type: 'string', required: true, description: 'Optimization objective and correctness constraints.' },
      candidate: { type: 'string', required: true, description: 'Unique candidate id.' },
      parentCandidate: { type: 'string', description: 'Parent candidate id, when this candidate is a revision.' },
      workdir: { type: 'string', description: 'Command working directory; defaults to the session workspace.' },
      correctnessCommand: { type: 'string', required: true, description: 'Command that proves candidate correctness.' },
      benchmarkCommand: { type: 'string', description: 'Command that measures the target metric.' },
      profileCommand: { type: 'string', description: 'Optional profiler command, such as an NCU report analysis command.' },
      profileArtifact: { type: 'string', description: 'Optional path to the profiler artifact, such as a .ncu-rep file.' },
      baselineMetric: { type: 'number', description: 'Baseline target metric used for the promotion decision.' },
      metricPattern: { type: 'string', description: 'Optional JavaScript regular expression; capture group 1 or named group metric must contain the numeric metric.' },
      metricUnit: { type: 'string', description: 'Metric unit displayed in the trajectory, for example us or TFLOP/s.' },
      lowerIsBetter: { type: 'boolean', description: 'Whether a smaller metric is better; defaults to true.' },
      minimumImprovementPercent: { type: 'number', description: 'Required improvement over baseline; defaults to the plugin setting.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args: KdaToolArgs, exec) {
      const workdir = resolveWorkdir(args.workdir, exec.agent?.session.header.cwd)
      const request: KdaEvaluationRequest = {
        task: args.task,
        objective: args.objective,
        candidate: args.candidate,
        ...(args.parentCandidate !== undefined ? { parentCandidate: args.parentCandidate } : {}),
        workdir,
        correctnessCommand: args.correctnessCommand,
        ...(args.benchmarkCommand !== undefined ? { benchmarkCommand: args.benchmarkCommand } : {}),
        ...(args.profileCommand !== undefined ? { profileCommand: args.profileCommand } : {}),
        ...(args.profileArtifact !== undefined ? { profileArtifact: args.profileArtifact } : {}),
        ...(args.baselineMetric !== undefined ? { baselineMetric: args.baselineMetric } : {}),
        ...(args.metricPattern !== undefined ? { metricPattern: args.metricPattern } : {}),
        ...(args.metricUnit !== undefined ? { metricUnit: args.metricUnit } : {}),
        lowerIsBetter: args.lowerIsBetter ?? true,
        minimumImprovementPercent: args.minimumImprovementPercent ?? defaultMinimumImprovementPercent,
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
      return JSON.stringify(await evaluateCandidate(request, runner, exec.signal))
    },
  }))
}

export type {
  KdaCommandResult,
  KdaDecision,
  KdaEvaluationRequest,
  KdaEvaluationResult,
  KdaStageName,
  KdaStageResult,
  KdaTrajectoryEvent,
} from './types.js'
