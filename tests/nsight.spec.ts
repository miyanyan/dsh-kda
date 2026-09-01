import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  NsightLauncher,
  NsightLauncherError,
  parseNsightCommandInput,
  type NsightLauncherDependencies,
} from '../src/nsight.js'

const workdir = resolve('D:/work')
const ncuUi = resolve('D:/tools/ncu-ui.exe')

function dependencies(overrides: Partial<NsightLauncherDependencies> = {}): NsightLauncherDependencies {
  return {
    accessFile: async () => true,
    listDirectories: async () => [],
    spawnDetached: async () => undefined,
    env: {},
    platform: 'win32',
    ...overrides,
  }
}

describe('Nsight Compute launcher', () => {
  it('decodes the non-recorded command payload without losing unicode paths', () => {
    const request = {
      action: 'open-report',
      report: {
        candidate: '候选-v2',
        iteration: 2,
        workdir: resolve('D:/CUDA 项目'),
        reportPath: 'profile/候选-v2.ncu-rep',
        profileContext: 'rtx5070ti-shape-a',
      },
    }
    expect(parseNsightCommandInput(` ${encodeURIComponent(JSON.stringify(request))}`)).toEqual(request)
  })

  it('opens the exact materialized report with ncu-ui and no shell composition', async () => {
    const spawnDetached = vi.fn(async () => undefined)
    const mergedReport = resolve(workdir, 'profile/run-concat.ncu-rep')
    const accessFile = vi.fn(async (path: string) => path === ncuUi || path === mergedReport)
    const launcher = new NsightLauncher(
      { ncuUiPath: ncuUi },
      dependencies({ accessFile, spawnDetached }),
    )

    const result = await launcher.execute({
      action: 'open-report',
      report: { candidate: 'run concat', workdir, reportPath: 'profile/run-concat.ncu-rep' },
    })

    expect(result).toEqual({
      action: 'open-report',
      executable: ncuUi,
      launchMode: 'ncu-ui',
      reportCount: 1,
      reportPath: mergedReport,
    })
    expect(spawnDetached).toHaveBeenCalledWith(ncuUi, [mergedReport])
  })

  it('returns the artifact path successfully when the viewer has no ncu-ui', async () => {
    const mergedReport = resolve(workdir, 'profile/run-concat.ncu-rep')
    const launcher = new NsightLauncher({}, dependencies({
      accessFile: async path => path === mergedReport,
      platform: 'linux',
    }))

    await expect(launcher.execute({
      action: 'open-report',
      report: { candidate: 'run concat', workdir, reportPath: 'profile/run-concat.ncu-rep' },
    })).resolves.toEqual({
      action: 'open-report',
      launchMode: 'artifact-only',
      reportCount: 1,
      reportPath: mergedReport,
    })
  })

  it('rejects obsolete multi-report actions instead of merging on the viewer host', () => {
    const request = { action: 'compare-run', reports: [] }
    expect(() => parseNsightCommandInput(encodeURIComponent(JSON.stringify(request))))
      .toThrowError(expect.objectContaining<Partial<NsightLauncherError>>({ code: 'invalid-request' }))
  })

  it('rejects a non-NCU artifact', async () => {
    const launcher = new NsightLauncher({}, dependencies())
    await expect(launcher.execute({
      action: 'open-report',
      report: { candidate: 'run concat', workdir, reportPath: 'profile/run.json' },
    })).rejects.toMatchObject<Partial<NsightLauncherError>>({ code: 'invalid-report' })
  })

  it('reports when the materialized report is not accessible to the viewer host', async () => {
    const launcher = new NsightLauncher({}, dependencies({ accessFile: async () => false }))
    await expect(launcher.execute({
      action: 'open-report',
      report: { candidate: 'run concat', workdir, reportPath: 'profile/run-concat.ncu-rep' },
    })).rejects.toMatchObject<Partial<NsightLauncherError>>({ code: 'report-not-found' })
  })
})
