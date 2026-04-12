// tests/unit/daemon.test.ts
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, unlinkSync } from 'fs'
import {
  createPidRecord,
  createShutdownHandler,
  daemonEnv,
  fetchFriClawHealth,
  getDaemonStatus,
  removePidRecord,
  shouldDaemonize,
  spawnDaemonChild,
  stopExistingProcess,
  stopManagedInstance,
  takeoverExistingProcess,
  writePidRecord,
} from '../../src/daemon'

const pidFiles: string[] = []
const portTarget = (pidFile: string) => ({
  dashboardEnabled: true,
  pidFile,
  port: 3000,
})
const pidTarget = (pidFile: string) => ({
  dashboardEnabled: false,
  pidFile,
  port: 3000,
})

afterEach(() => {
  pidFiles.splice(0).forEach((file) => {
    try {
      const path = file.replace('file://', '')
      if (existsSync(path)) {
        unlinkSync(path)
      }
    } catch {}
  })
})

describe('createShutdownHandler', () => {
  it('calls dispatcher.shutdown exactly once', async () => {
    const shutdown = mock(async () => {})
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('runs cleanup before exit', async () => {
    const shutdown = mock(async () => {})
    const cleanup = mock(async () => {})
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit, cleanup)
    await handler('SIGTERM')

    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('is idempotent — second call is a no-op', async () => {
    const shutdown = mock(async () => {})
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')
    await handler('SIGINT')

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('exits with code 1 when dispatcher.shutdown throws', async () => {
    const shutdown = mock(async () => { throw new Error('db error') })
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')

    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('shouldDaemonize', () => {
  const daemon = {
    enabled: true,
    pidFile: '/tmp/friclaw.pid',
    takeover: true,
    disableInContainer: true,
  }

  it('daemonizes start on host', () => {
    expect(shouldDaemonize({ command: 'start', daemon, env: {}, inContainer: false })).toEqual({
      shouldDaemonize: true,
      reason: 'enabled',
    })
  })

  it('skips non-start commands', () => {
    expect(shouldDaemonize({ command: 'onboard', daemon, env: {}, inContainer: false }).shouldDaemonize).toBe(false)
  })

  it('skips daemon child process', () => {
    expect(shouldDaemonize({
      command: 'start',
      daemon,
      env: { [daemonEnv.DAEMON_CHILD_ENV]: '1' },
      inContainer: false,
    }).reason).toBe('already-daemon-child')
  })

  it('respects foreground override', () => {
    expect(shouldDaemonize({
      command: 'start',
      daemon,
      env: { [daemonEnv.FOREGROUND_ENV]: '1' },
      inContainer: false,
    }).reason).toBe('foreground-forced')
  })

  it('disables daemon mode in containers by default', () => {
    expect(shouldDaemonize({ command: 'start', daemon, env: {}, inContainer: true }).reason).toBe('container-disabled')
  })
})

describe('port-first lifecycle', () => {
  it('accepts only FriClaw health payloads', async () => {
    const ok = await fetchFriClawHealth(3000, {
      fetchFn: mock(async () => ({
        ok: true,
        json: async () => ({
          service: 'friclaw',
          kind: 'dashboard-api',
          pid: 123,
          port: 3000,
          startedAt: '2026-04-12T00:00:00.000Z',
          status: 'ok',
          uptime: 10,
          sessions: 2,
        }),
      })) as any,
    })

    const invalid = await fetchFriClawHealth(3000, {
      fetchFn: mock(async () => ({
        ok: true,
        json: async () => ({ status: 'ok' }),
      })) as any,
    })

    expect(ok?.pid).toBe(123)
    expect(invalid).toBeNull()
  })

  it('reports FriClaw running from health endpoint even without pid file', async () => {
    const pidFile = `/tmp/friclaw-port-running-${Date.now()}.pid`
    const status = await getDaemonStatus(portTarget(pidFile), {
      fetchFn: mock(async () => ({
        ok: true,
        json: async () => ({
          service: 'friclaw',
          kind: 'dashboard-api',
          pid: 24680,
          port: 3000,
          startedAt: '2026-04-12T00:00:00.000Z',
          status: 'ok',
          uptime: 20,
          sessions: 1,
        }),
      })) as any,
    })

    expect(status).toEqual({
      mode: 'port',
      owner: 'friclaw',
      running: true,
      pid: 24680,
      port: 3000,
      stalePid: false,
    })
  })

  it('reports another process when port is open but health is not FriClaw', async () => {
    const pidFile = `/tmp/friclaw-port-other-${Date.now()}.pid`
    const status = await getDaemonStatus(portTarget(pidFile), {
      fetchFn: mock(async () => ({ ok: false })) as any,
      isPortOpenFn: async () => true,
    })

    expect(status).toEqual({
      mode: 'port',
      owner: 'other',
      running: false,
      pid: null,
      port: 3000,
      stalePid: false,
    })
  })

  it('reports stale auxiliary pid file when port is free', async () => {
    const pidFile = `/tmp/friclaw-port-stale-${Date.now()}.pid`
    pidFiles.push(pidFile)
    writePidRecord(pidFile, createPidRecord(['bun', 'src/index.ts', 'start'], '/tmp', 999999))

    const status = await getDaemonStatus(portTarget(pidFile), {
      fetchFn: mock(async () => ({ ok: false })) as any,
      isPortOpenFn: async () => false,
    })

    expect(status).toEqual({
      mode: 'port',
      owner: 'none',
      running: false,
      pid: 999999,
      port: 3000,
      stalePid: true,
    })
  })

  it('falls back to pid-only mode when dashboard is disabled', async () => {
    const pidFile = `/tmp/friclaw-pid-fallback-${Date.now()}.pid`
    pidFiles.push(pidFile)
    writePidRecord(pidFile, createPidRecord(['bun', 'src/index.ts', 'start'], '/tmp', process.pid))

    const status = await getDaemonStatus(pidTarget(pidFile))

    expect(status).toEqual({
      mode: 'pid',
      owner: 'friclaw',
      running: true,
      pid: process.pid,
      port: null,
      stalePid: false,
    })
  })

  it('stops confirmed FriClaw instance identified by port', async () => {
    const pidFile = `/tmp/friclaw-port-stop-${Date.now()}.pid`
    pidFiles.push(pidFile)
    writePidRecord(pidFile, createPidRecord(['bun', 'src/index.ts', 'start'], '/tmp', 43210))

    const kill = mock((_pid: number, _signal?: string | number) => true)
    let checks = 0
    const stoppedPid = await stopManagedInstance(portTarget(pidFile), {
      kill: kill as any,
      sleep: async () => {},
      timeoutMs: 100,
      fetchFn: mock(async () => {
        if (checks++ === 0) {
          return {
            ok: true,
            json: async () => ({
              service: 'friclaw',
              kind: 'dashboard-api',
              pid: 43210,
              port: 3000,
              startedAt: '2026-04-12T00:00:00.000Z',
              status: 'ok',
              uptime: 5,
              sessions: 1,
            }),
          }
        }
        return { ok: false }
      }) as any,
      isPortOpenFn: async () => false,
    })

    expect(stoppedPid).toBe(43210)
    expect(kill).toHaveBeenCalledWith(43210, 'SIGTERM')
    expect(await Bun.file(pidFile).exists()).toBe(false)
  })

  it('refuses to stop another process occupying the port', async () => {
    const pidFile = `/tmp/friclaw-port-refuse-${Date.now()}.pid`

    await expect(stopManagedInstance(portTarget(pidFile), {
      fetchFn: mock(async () => ({ ok: false })) as any,
      isPortOpenFn: async () => true,
    })).rejects.toThrow('occupied by another process')
  })

  it('removes stale pid file during takeover when port is free', async () => {
    const pidFile = `/tmp/friclaw-port-takeover-stale-${Date.now()}.pid`
    pidFiles.push(pidFile)
    writePidRecord(pidFile, createPidRecord(['bun', 'src/index.ts', 'start'], '/tmp', 12345))

    await takeoverExistingProcess(portTarget(pidFile), true, {
      fetchFn: mock(async () => ({ ok: false })) as any,
      isPortOpenFn: async () => false,
    })

    expect(await Bun.file(pidFile).exists()).toBe(false)
  })

  it('throws when FriClaw already owns the port and takeover is disabled', async () => {
    const pidFile = `/tmp/friclaw-port-takeover-disabled-${Date.now()}.pid`

    await expect(takeoverExistingProcess(portTarget(pidFile), false, {
      fetchFn: mock(async () => ({
        ok: true,
        json: async () => ({
          service: 'friclaw',
          kind: 'dashboard-api',
          pid: 54321,
          port: 3000,
          startedAt: '2026-04-12T00:00:00.000Z',
          status: 'ok',
          uptime: 8,
          sessions: 1,
        }),
      })) as any,
    })).rejects.toThrow('already running on port 3000')
  })
})

describe('pid management', () => {
  it('throws when another process is alive and takeover is disabled in pid fallback mode', async () => {
    const pidFile = `/tmp/friclaw-live-${Date.now()}.pid`
    pidFiles.push(pidFile)
    writePidRecord(pidFile, createPidRecord(['bun', 'src/index.ts', 'start'], '/tmp', 12345))

    await expect(takeoverExistingProcess(pidTarget(pidFile), false, {
      isAlive: () => true,
    })).rejects.toThrow('already running')
  })

  it('signals existing process and removes pid file when stopping', async () => {
    const pidFile = `/tmp/friclaw-stop-${Date.now()}.pid`
    pidFiles.push(pidFile)
    writePidRecord(pidFile, createPidRecord(['bun', 'src/index.ts', 'start'], '/tmp', 54321))

    const kill = mock((_pid: number, _signal?: string | number) => true)
    let aliveChecks = 0

    const stoppedPid = await stopExistingProcess(pidFile, {
      kill: kill as any,
      isAlive: () => aliveChecks++ === 0,
      sleep: async () => {},
      timeoutMs: 100,
    })

    expect(stoppedPid).toBe(54321)
    expect(kill).toHaveBeenCalledWith(54321, 'SIGTERM')
    expect(await Bun.file(pidFile).exists()).toBe(false)
  })

  it('returns null when stopping without pid file', async () => {
    const pidFile = `/tmp/friclaw-missing-${Date.now()}.pid`
    expect(await stopExistingProcess(pidFile, { isAlive: () => false })).toBeNull()
  })

  it('removes pid file only when current pid owns it', async () => {
    const pidFile = `/tmp/friclaw-owned-${Date.now()}.pid`
    pidFiles.push(pidFile)
    writePidRecord(pidFile, createPidRecord(['bun', 'src/index.ts', 'start'], '/tmp', 99999))

    removePidRecord(pidFile, 11111)
    expect(await Bun.file(pidFile).exists()).toBe(true)

    removePidRecord(pidFile, 99999)
    expect(await Bun.file(pidFile).exists()).toBe(false)
  })
})

describe('spawnDaemonChild', () => {
  it('marks child env and detaches process', () => {
    const unref = mock(() => {})
    const spawnFn = mock((_cmd: string, _args: string[], _options: Record<string, unknown>) => ({
      pid: 24680,
      unref,
    }))

    const pid = spawnDaemonChild({
      argv: ['bun', 'src/index.ts', 'start'],
      cwd: '/tmp/friclaw',
      env: { CUSTOM_ENV: '1' },
      spawnFn: spawnFn as any,
    })

    expect(pid).toBe(24680)
    expect(unref).toHaveBeenCalledTimes(1)

    const [command, args, options] = spawnFn.mock.calls[0] as [string, string[], Record<string, any>]
    expect(command).toBe('bun')
    expect(args).toEqual(['src/index.ts', 'start'])
    expect(options.detached).toBe(true)
    expect(options.stdio).toBe('ignore')
    expect(options.env[daemonEnv.DAEMON_CHILD_ENV]).toBe('1')
    expect(options.env.CUSTOM_ENV).toBe('1')
  })
})
