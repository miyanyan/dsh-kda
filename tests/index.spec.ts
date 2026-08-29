import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/index.js'
import { ncuAssessmentJson } from './fixtures.js'

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (definition: ToolDefinition) => definition,
}))

const baselineArgs = {
  optimizationRunId: 'sandbox-policy-smoke',
  task: 'sandbox-policy',
  objective: 'Run candidate commands with the calling session policy.',
  candidate: 'baseline',
  candidateRole: 'baseline',
  hypothesis: 'The unmodified implementation establishes the reference.',
  workdir: 'D:\\workspace',
  correctnessCommand: 'validate',
  benchmarkCommand: 'benchmark',
  benchmarkContext: 'windows-wsl-smoke',
  metricUnit: 'us',
}

describe('kda host integration', () => {
  it('passes the calling session sandbox policy to every evaluator command', async () => {
    const definitions: ToolDefinition[] = []
    const sandboxPolicy = {
      mode: 'danger-full-access' as const,
      workspaceRoot: 'D:\\workspace',
      sessionId: 'session-1',
    }
    const resolvePolicy = vi.fn(() => sandboxPolicy)
    const resolveShell = vi.fn((request: Record<string, unknown>) => ({
      ...request,
      timeoutMs: request.timeoutMs ?? 300_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 1_048_576,
    }))
    const runShell = vi.fn(async (spec: Record<string, unknown>) => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: {
        text: spec.command === 'benchmark' ? 'KDA_METRIC=10' : 'correct',
        truncated: false,
      },
      stderr: { text: '', truncated: false },
    }))
    const session = {
      header: { cwd: 'D:\\workspace' },
      events: [],
      append: vi.fn(),
    }
    const ctx = {
      tools: {
        register(definition: ToolDefinition) {
          definitions.push(definition)
          return () => undefined
        },
      },
      skills: { register: () => () => undefined },
      sandboxPolicy: { resolve: resolvePolicy },
      shell: { resolve: resolveShell, run: runShell },
    } as unknown as Context

    apply(ctx)
    const evaluator = definitions.find(definition => definition.name === 'kda_evaluate_candidate')
    expect(evaluator).toBeDefined()

    const value = await evaluator!.execute(baselineArgs, {
      agent: { session },
      callId: 'call-1',
      rootCallId: 'call-1',
      signal: new AbortController().signal,
    } as never)

    expect(inject).toContain('sandboxPolicy')
    expect(resolvePolicy).toHaveBeenCalledOnce()
    expect(resolvePolicy).toHaveBeenCalledWith({ session })
    expect(resolveShell).toHaveBeenCalledTimes(2)
    for (const [request] of resolveShell.mock.calls) {
      expect(request.sandboxPolicy).toBe(sandboxPolicy)
    }
    expect(JSON.parse(String(value))).toMatchObject({
      candidate: 'baseline',
      candidateMetric: 10,
      decision: 'baseline',
    })
  })

  it('loads and validates the NCU sidecar through the sandbox before candidate commands', async () => {
    const definitions: ToolDefinition[] = []
    const sandboxPolicy = { mode: 'danger-full-access' as const, workspaceRoot: 'D:\\workspace', sessionId: 'session-2' }
    const resolveShell = vi.fn((request: Record<string, unknown>) => ({
      ...request,
      timeoutMs: request.timeoutMs ?? 300_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 1_048_576,
    }))
    const runShell = vi.fn(async (spec: Record<string, unknown>) => ({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: {
        text: spec.command === 'load-assessment' ? ncuAssessmentJson()
          : spec.command === 'benchmark' ? 'KDA_METRIC=10'
            : spec.command === 'profile' ? 'KDA_NCU_METRIC=Duration|10|us'
              : 'correct',
        truncated: false,
      },
      stderr: { text: '', truncated: false },
    }))
    const session = { header: { cwd: 'D:\\workspace' }, events: [], append: vi.fn() }
    const ctx = {
      tools: { register(definition: ToolDefinition) { definitions.push(definition); return () => undefined } },
      skills: { register: () => () => undefined },
      sandboxPolicy: { resolve: () => sandboxPolicy },
      shell: { resolve: resolveShell, run: runShell },
    } as unknown as Context

    apply(ctx)
    const evaluator = definitions.find(definition => definition.name === 'kda_evaluate_candidate')!
    const value = await evaluator.execute({
      ...baselineArgs,
      profileCommand: 'profile',
      profileContext: 'windows-wsl-smoke',
      ncuReportAssessmentCommand: 'load-assessment',
    }, {
      agent: { session }, callId: 'call-2', rootCallId: 'call-2', signal: new AbortController().signal,
    } as never)

    expect(runShell.mock.calls.map(([spec]) => spec.command)).toEqual(['load-assessment', 'validate', 'benchmark', 'profile'])
    expect(resolveShell.mock.calls.every(([request]) => request.sandboxPolicy === sandboxPolicy)).toBe(true)
    expect(JSON.parse(String(value)).ncuReportAssessment.primaryDiagnosis).toContain('latency-bound')
  })

  it('reports the exact invalid sidecar field before running correctness', async () => {
    const definitions: ToolDefinition[] = []
    const runShell = vi.fn(async () => ({
      exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 300_000,
      stdout: { text: JSON.stringify({ source: 'wrong' }), truncated: false },
      stderr: { text: '', truncated: false },
    }))
    const session = { header: { cwd: 'D:\\workspace' }, events: [], append: vi.fn() }
    const ctx = {
      tools: { register(definition: ToolDefinition) { definitions.push(definition); return () => undefined } },
      skills: { register: () => () => undefined },
      sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
      shell: { resolve: (request: Record<string, unknown>) => request, run: runShell },
    } as unknown as Context

    apply(ctx)
    const evaluator = definitions.find(definition => definition.name === 'kda_evaluate_candidate')!
    await expect(evaluator.execute({
      ...baselineArgs,
      profileCommand: 'profile',
      profileContext: 'windows-wsl-smoke',
      ncuReportAssessmentCommand: 'load-invalid-assessment',
    }, {
      agent: { session }, callId: 'call-3', rootCallId: 'call-3', signal: new AbortController().signal,
    } as never)).rejects.toThrow('ncuReportAssessment.source')
    expect(runShell).toHaveBeenCalledOnce()
  })
})
