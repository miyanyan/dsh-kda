import type { PtcDispatchEventData, PtcDispatchStartEventData, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { KdaTrajectoryEvent } from './types.js'

interface NativeCall {
  start: PtcDispatchStartEventData
}

function eventArguments(event: KdaTrajectoryEvent): Record<string, unknown> {
  switch (event.type) {
    case 'kda/run-started':
      return { runId: event.runId, task: event.task, objective: event.objective }
    case 'kda/candidate-proposed':
      return {
        runId: event.runId,
        evaluationId: event.evaluationId,
        candidate: event.candidate,
        ...(event.parentCandidate !== undefined ? { parentCandidate: event.parentCandidate } : {}),
        hypothesis: event.hypothesis,
      }
    case 'kda/stage-started':
      return {
        runId: event.runId,
        evaluationId: event.evaluationId,
        candidate: event.candidate,
        stage: event.stage,
        command: event.command,
        ...(event.artifact !== undefined ? { artifact: event.artifact } : {}),
      }
    case 'kda/stage-completed':
      return { stage: event.result.stage, candidate: event.candidate }
    case 'kda/profile-diagnosed':
      return { candidate: event.candidate, metricCount: event.analysis.metricCount }
    case 'kda/mechanism-assessed':
      return {
        candidate: event.candidate,
        verdict: event.assessment.verdict,
        ...(event.assessment.expectedMetric !== undefined ? { expectedMetric: event.assessment.expectedMetric } : {}),
        ...(event.assessment.expectedDirection !== undefined ? { expectedDirection: event.assessment.expectedDirection } : {}),
      }
    case 'kda/decision-made':
      return { candidate: event.candidate, decision: event.decision }
    case 'kda/candidate-finished':
      return { candidate: event.candidate, decision: event.decision }
    case 'kda/run-finished':
      return { runId: event.runId, candidate: event.candidate, decision: event.decision }
  }
}

function eventResult(event: KdaTrajectoryEvent): Record<string, unknown> {
  switch (event.type) {
    case 'kda/run-started':
      return { status: 'started', task: event.task, objective: event.objective }
    case 'kda/candidate-proposed':
      return { status: 'evaluating', hypothesis: event.hypothesis }
    case 'kda/stage-started':
      return { status: 'running', stage: event.stage }
    case 'kda/stage-completed': {
      const result = event.result
      return {
        status: result.ok ? 'passed' : 'failed',
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        aborted: result.aborted,
        ...(result.metric !== undefined ? { metric: result.metric } : {}),
        ...(result.metricUnit !== undefined ? { metricUnit: result.metricUnit } : {}),
        ...(result.artifact !== undefined ? { artifact: result.artifact } : {}),
      }
    }
    case 'kda/profile-diagnosed':
      return {
        bottleneck: event.analysis.bottleneck,
        confidence: event.analysis.confidence,
        evidence: event.analysis.evidence,
        recommendations: event.analysis.recommendations,
      }
    case 'kda/mechanism-assessed':
      return {
        verdict: event.assessment.verdict,
        evidence: event.assessment.evidence,
        limitations: event.assessment.limitations,
        ...(event.assessment.observed !== undefined ? { observed: event.assessment.observed } : {}),
      }
    case 'kda/decision-made':
      return {
        decision: event.decision,
        reason: event.reason,
        ...(event.improvementPercent !== undefined && Number.isFinite(event.improvementPercent)
          ? { improvementPercent: event.improvementPercent }
          : {}),
      }
    case 'kda/candidate-finished':
      return { candidate: event.candidate, decision: event.decision }
    case 'kda/run-finished':
      return { runId: event.runId, candidate: event.candidate, decision: event.decision }
  }
}

function eventName(event: KdaTrajectoryEvent): string {
  switch (event.type) {
    case 'kda/run-started': return 'kda/run-started'
    case 'kda/candidate-proposed': return 'kda/candidate'
    case 'kda/stage-started': return `kda/${event.stage}`
    case 'kda/stage-completed': return `kda/${event.result.stage}`
    case 'kda/profile-diagnosed': return 'kda/profile-diagnosed'
    case 'kda/mechanism-assessed': return 'kda/mechanism-assessed'
    case 'kda/decision-made': return 'kda/decision'
    case 'kda/candidate-finished': return 'kda/candidate'
    case 'kda/run-finished': return 'kda/run-finished'
  }
}

/**
 * Project KDA evaluator events through dsh's native nested-call vocabulary.
 *
 * No custom SessionEventMap member is introduced: the resulting log remains
 * readable by dsh versions that already understand Code Dispatch records.
 */
export class KdaNativeTrajectoryRecorder {
  private readonly session: NonNullable<ToolRunContext['agent']>['session'] | undefined
  private readonly rootCallId: ToolRunContext['rootCallId']
  private readonly parentCallId: ToolRunContext['callId']
  private readonly stageCalls = new Map<string, NativeCall>()
  private candidateCall: NativeCall | undefined
  private nextId = 0

  constructor(exec: Pick<ToolRunContext, 'agent' | 'callId' | 'rootCallId'>) {
    this.session = exec.agent?.session
    this.rootCallId = exec.rootCallId
    this.parentCallId = exec.callId
  }

  observe = (event: KdaTrajectoryEvent): void => {
    if (this.session === undefined) return
    switch (event.type) {
      case 'kda/candidate-proposed':
        this.candidateCall = this.start(eventName(event), eventArguments(event), this.parentCallId)
        return
      case 'kda/stage-started': {
        const parent = this.candidateCall?.start.subCallId ?? this.parentCallId
        this.stageCalls.set(event.stage, this.start(eventName(event), eventArguments(event), parent))
        return
      }
      case 'kda/stage-completed': {
        const call = this.stageCalls.get(event.result.stage)
        if (call === undefined) {
          this.instant(eventName(event), eventArguments(event), eventResult(event), !event.result.ok)
        } else {
          this.finish(call, eventResult(event), !event.result.ok)
          this.stageCalls.delete(event.result.stage)
        }
        return
      }
      case 'kda/candidate-finished':
        if (this.candidateCall === undefined) {
          this.instant(eventName(event), eventArguments(event), eventResult(event), false)
        } else {
          this.finish(this.candidateCall, eventResult(event), false)
          this.candidateCall = undefined
        }
        return
      case 'kda/profile-diagnosed':
      case 'kda/mechanism-assessed':
      case 'kda/decision-made':
      case 'kda/run-finished':
        this.instant(eventName(event), eventArguments(event), eventResult(event), false)
        return
      case 'kda/run-started':
        this.instant(eventName(event), eventArguments(event), eventResult(event), false, this.parentCallId)
    }
  }

  private start(name: string, args: Record<string, unknown>, parentCallId = this.candidateCall?.start.subCallId ?? this.parentCallId): NativeCall {
    const subCallId = `${String(this.parentCallId)}:kda:${this.nextId}` as PtcDispatchStartEventData['subCallId']
    this.nextId += 1
    const start: PtcDispatchStartEventData = {
      rootCallId: this.rootCallId,
      parentCallId,
      subCallId,
      name,
      arguments: args,
    }
    this.session?.append('tool/code-dispatch-start', start)
    return { start }
  }

  private finish(call: NativeCall, result: Record<string, unknown>, isError: boolean): void {
    const settled: PtcDispatchEventData = {
      ...call.start,
      isError,
      content: [{ type: 'text', text: JSON.stringify(result) }],
    }
    this.session?.append('tool/code-dispatch', settled)
  }

  private instant(
    name: string,
    args: Record<string, unknown>,
    result: Record<string, unknown>,
    isError: boolean,
    parentCallId = this.candidateCall?.start.subCallId ?? this.parentCallId,
  ): void {
    this.finish(this.start(name, args, parentCallId), result, isError)
  }
}
