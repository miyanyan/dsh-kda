import { readdir, stat } from 'node:fs/promises'
import { basename, delimiter, extname, isAbsolute, join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

export interface NsightLauncherConfig {
  ncuUiPath?: string
}

export interface NsightReportReference {
  candidate: string
  iteration?: number
  workdir: string
  reportPath: string
  profileContext?: string
}

/** Presentation is deliberately limited to one report already materialized for this host. */
export type NsightCommandRequest = { action: 'open-report'; report: NsightReportReference }

export interface NsightLaunchResult {
  action: 'open-report'
  launchMode: 'ncu-ui' | 'artifact-only'
  reportCount: 1
  reportPath: string
  executable?: string
}

export type NsightErrorCode = 'invalid-request' | 'invalid-report' | 'report-not-found' | 'launch-failed'

export class NsightLauncherError extends Error {
  constructor(readonly code: NsightErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NsightLauncherError'
  }
}

export interface NsightLauncherDependencies {
  accessFile: (path: string) => Promise<boolean>
  listDirectories: (path: string) => Promise<string[]>
  spawnDetached: (executable: string, args: string[]) => Promise<void>
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function directories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

async function spawnDetached(executable: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    let child: ChildProcess
    try {
      child = spawn(executable, args, {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: false,
      })
    } catch (error) {
      rejectSpawn(error)
      return
    }
    child.once('error', rejectSpawn)
    child.once('spawn', () => {
      child.removeListener('error', rejectSpawn)
      child.unref()
      resolveSpawn()
    })
  })
}

function defaultDependencies(): NsightLauncherDependencies {
  return {
    accessFile: isFile,
    listDirectories: directories,
    spawnDetached,
    env: process.env,
    platform: process.platform,
  }
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function reportReference(value: unknown): NsightReportReference {
  if (typeof value !== 'object' || value === null) {
    throw new NsightLauncherError('invalid-request', 'report must be an object')
  }
  const entry = value as Record<string, unknown>
  if (!nonBlank(entry.candidate)) throw new NsightLauncherError('invalid-request', 'report.candidate is required')
  if (!nonBlank(entry.workdir)) throw new NsightLauncherError('invalid-request', 'report.workdir is required')
  if (!nonBlank(entry.reportPath)) throw new NsightLauncherError('invalid-request', 'report.reportPath is required')
  if (entry.iteration !== undefined && (!Number.isInteger(entry.iteration) || Number(entry.iteration) < 0)) {
    throw new NsightLauncherError('invalid-request', 'report.iteration must be a non-negative integer')
  }
  if (entry.profileContext !== undefined && !nonBlank(entry.profileContext)) {
    throw new NsightLauncherError('invalid-request', 'report.profileContext must be non-empty when provided')
  }
  return {
    candidate: entry.candidate,
    workdir: entry.workdir,
    reportPath: entry.reportPath,
    ...(entry.iteration === undefined ? {} : { iteration: Number(entry.iteration) }),
    ...(entry.profileContext === undefined ? {} : { profileContext: entry.profileContext }),
  }
}

/** Decode the non-recorded internal slash-command payload issued by the KDA view. */
export function parseNsightCommandInput(rawInput: string): NsightCommandRequest {
  const encoded = rawInput.trim()
  if (encoded === '') throw new NsightLauncherError('invalid-request', 'KDA Nsight action payload is missing')
  if (encoded.length > 100_000) throw new NsightLauncherError('invalid-request', 'KDA Nsight action payload is too large')
  let value: unknown
  try {
    value = JSON.parse(decodeURIComponent(encoded))
  } catch (error) {
    throw new NsightLauncherError('invalid-request', 'KDA Nsight action payload is invalid', { cause: error })
  }
  if (typeof value !== 'object' || value === null) {
    throw new NsightLauncherError('invalid-request', 'KDA Nsight action payload must be an object')
  }
  const request = value as Record<string, unknown>
  if (request.action !== 'open-report') throw new NsightLauncherError('invalid-request', 'Unknown KDA Nsight action')
  return { action: 'open-report', report: reportReference(request.report) }
}

function resolveReport(reference: NsightReportReference): string {
  const path = isAbsolute(reference.reportPath)
    ? resolve(reference.reportPath)
    : resolve(reference.workdir, reference.reportPath)
  if (extname(path).toLowerCase() !== '.ncu-rep') {
    throw new NsightLauncherError('invalid-report', `${reference.candidate}: expected a .ncu-rep file, got "${reference.reportPath}"`)
  }
  return path
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  const value = env.PATH ?? env.Path ?? env.path ?? ''
  return value.split(delimiter).map(entry => entry.trim()).filter(Boolean)
}

function configuredCandidate(value: string | undefined): string[] {
  if (!nonBlank(value)) return []
  return [isAbsolute(value) ? resolve(value) : resolve(process.cwd(), value)]
}

function sortInstallNames(names: string[]): string[] {
  return names
    .filter(name => /^Nsight Compute(?:\s|$)/i.test(name))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }))
}

export class NsightLauncher {
  private readonly dependencies: NsightLauncherDependencies

  constructor(
    private readonly config: NsightLauncherConfig = {},
    dependencies: Partial<NsightLauncherDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies(), ...dependencies }
  }

  async execute(request: NsightCommandRequest, signal?: AbortSignal): Promise<NsightLaunchResult> {
    signal?.throwIfAborted()
    const reportPath = resolveReport(request.report)
    if (!await this.dependencies.accessFile(reportPath)) {
      throw new NsightLauncherError('report-not-found', `${request.report.candidate}: report not found at "${reportPath}"`)
    }
    const executable = await this.findNcuUi()
    if (executable === undefined) {
      return { action: 'open-report', launchMode: 'artifact-only', reportCount: 1, reportPath }
    }
    signal?.throwIfAborted()
    try {
      await this.dependencies.spawnDetached(executable, [reportPath])
    } catch (error) {
      throw new NsightLauncherError(
        'launch-failed',
        `Nsight Compute failed to start from "${executable}": ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    return { action: 'open-report', executable, launchMode: 'ncu-ui', reportCount: 1, reportPath }
  }

  private async findNcuUi(): Promise<string | undefined> {
    const candidates = configuredCandidate(this.config.ncuUiPath)
    const executableNames = this.dependencies.platform === 'win32' ? ['ncu-ui.exe'] : ['ncu-ui']
    for (const directory of pathEntries(this.dependencies.env)) {
      for (const name of executableNames) candidates.push(join(directory, name))
    }
    if (this.dependencies.platform === 'win32') {
      const roots = [this.dependencies.env.ProgramW6432, this.dependencies.env.ProgramFiles]
        .filter(nonBlank)
        .map(root => join(root, 'NVIDIA Corporation'))
      for (const root of [...new Set(roots)]) {
        for (const install of sortInstallNames(await this.dependencies.listDirectories(root))) {
          candidates.push(join(root, install, 'host', 'windows-desktop-win7-x64', 'ncu-ui.exe'))
        }
      }
    }
    for (const candidate of candidates) {
      if (await this.dependencies.accessFile(candidate)) return candidate
    }
    return undefined
  }
}

/** Opening is optional; a headless viewer still receives the materialized artifact path. */
export function describeNsightLaunch(result: NsightLaunchResult): string {
  if (result.launchMode === 'ncu-ui') return `Opened ${basename(result.reportPath)} in NVIDIA Nsight Compute.`
  return `Report is ready at ${result.reportPath}. NVIDIA Nsight Compute UI is not available in this environment.`
}
