// src/daemon.ts
import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { logger } from './utils/logger'
import type { Dispatcher } from './dispatcher'

const SHUTDOWN_TIMEOUT_MS = 30_000
const TAKEOVER_TIMEOUT_MS = 5_000
const PROBE_TIMEOUT_MS = 1_000
const DAEMON_CHILD_ENV = 'FRICLAW_DAEMON_CHILD'
const FOREGROUND_ENV = 'FRICLAW_FOREGROUND'
const log = logger('daemon')

export interface DaemonConfig {
  enabled: boolean
  pidFile: string
  takeover: boolean
  disableInContainer: boolean
}

export interface PidRecord {
  pid: number
  startedAt: string
  argv: string[]
  cwd: string
}

export interface FriClawHealth {
  service: 'friclaw'
  kind: 'dashboard-api'
  pid: number
  port: number
  startedAt: string
  status: string
  uptime: number
  sessions: number
}

export interface DaemonDecisionInput {
  command: string
  daemon: DaemonConfig
  env: NodeJS.ProcessEnv
  inContainer?: boolean
}

export interface DaemonDecision {
  shouldDaemonize: boolean
  reason:
    | 'not-start-command'
    | 'daemon-disabled'
    | 'foreground-forced'
    | 'already-daemon-child'
    | 'container-disabled'
    | 'enabled'
}

export interface DaemonStatus {
  mode: 'port' | 'pid'
  owner: 'friclaw' | 'other' | 'none'
  running: boolean
  pid: number | null
  port: number | null
  stalePid: boolean
}

export interface LifecycleTarget {
  dashboardEnabled: boolean
  pidFile: string
  port: number
}

export interface DaemonSpawnOptions {
  argv?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  spawnFn?: typeof spawn
}

interface HealthProbeOptions {
  fetchFn?: typeof fetch
  timeoutMs?: number
}

interface PortProbeOptions {
  timeoutMs?: number
}

interface StopInstanceOptions {
  kill?: typeof process.kill
  isAlive?: (pid: number) => boolean
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  fetchFn?: typeof fetch
  isPortOpenFn?: (port: number, options?: PortProbeOptions) => Promise<boolean>
}

// Exported for testing — takes exit fn as injectable dependency
export function createShutdownHandler(
  dispatcher: Dispatcher,
  exit: (code: number) => void = process.exit,
  cleanup?: () => void | Promise<void>,
) {
  let shuttingDown = false

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    log.info({ signal }, 'Graceful shutdown initiated')

    const timer = setTimeout(() => {
      log.error(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS / 1000}s, forcing exit`)
      exit(1)
    }, SHUTDOWN_TIMEOUT_MS)

    try {
      await dispatcher.shutdown()
      await cleanup?.()
      clearTimeout(timer)
      log.info('Graceful shutdown complete')
      exit(0)
    } catch (err) {
      clearTimeout(timer)
      log.error({ err }, 'Error during shutdown')
      exit(1)
    }
  }
}

export function registerShutdownHandlers(dispatcher: Dispatcher, cleanup?: () => void | Promise<void>): void {
  const shutdown = createShutdownHandler(dispatcher, process.exit, cleanup)
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

export function isContainerEnvironment(): boolean {
  return existsSync('/.dockerenv') || process.env.KUBERNETES_SERVICE_HOST !== undefined
}

export function shouldDaemonize(input: DaemonDecisionInput): DaemonDecision {
  if (input.command !== 'start') {
    return { shouldDaemonize: false, reason: 'not-start-command' }
  }
  if (!input.daemon.enabled) {
    return { shouldDaemonize: false, reason: 'daemon-disabled' }
  }
  if (input.env[FOREGROUND_ENV] === '1') {
    return { shouldDaemonize: false, reason: 'foreground-forced' }
  }
  if (input.env[DAEMON_CHILD_ENV] === '1') {
    return { shouldDaemonize: false, reason: 'already-daemon-child' }
  }

  const inContainer = input.inContainer ?? isContainerEnvironment()
  if (input.daemon.disableInContainer && inContainer) {
    return { shouldDaemonize: false, reason: 'container-disabled' }
  }

  return { shouldDaemonize: true, reason: 'enabled' }
}

export function readPidRecord(pidFile: string): PidRecord | null {
  if (!existsSync(pidFile)) return null

  try {
    const raw = readFileSync(pidFile, 'utf-8').trim()
    const parsed = JSON.parse(raw) as Partial<PidRecord>
    if (typeof parsed.pid !== 'number' || Number.isNaN(parsed.pid)) return null
    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date(0).toISOString(),
      argv: Array.isArray(parsed.argv) ? parsed.argv.filter((value): value is string => typeof value === 'string') : [],
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : '',
    }
  } catch {
    return null
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function clearPidRecord(pidFile: string): void {
  rmSync(pidFile, { force: true })
}

export async function isPortOpen(port: number, options: PortProbeOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS

  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export function isFriClawHealth(payload: unknown): payload is FriClawHealth {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Record<string, unknown>
  return value.service === 'friclaw'
    && value.kind === 'dashboard-api'
    && typeof value.pid === 'number'
    && typeof value.port === 'number'
    && typeof value.startedAt === 'string'
}

export async function fetchFriClawHealth(port: number, options: HealthProbeOptions = {}): Promise<FriClawHealth | null> {
  const fetchFn = options.fetchFn ?? fetch
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFn(`http://127.0.0.1:${port}/health`, { signal: controller.signal })
    if (!response.ok) return null
    const payload = await response.json()
    return isFriClawHealth(payload) ? payload : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function getDaemonStatus(
  target: LifecycleTarget,
  options: {
    fetchFn?: typeof fetch
    isPortOpenFn?: (port: number, options?: PortProbeOptions) => Promise<boolean>
  } = {},
): Promise<DaemonStatus> {
  const pidRecord = readPidRecord(target.pidFile)
  const stalePid = pidRecord ? !isProcessAlive(pidRecord.pid) : false

  if (!target.dashboardEnabled) {
    const running = pidRecord ? isProcessAlive(pidRecord.pid) : false
    return {
      mode: 'pid',
      owner: running ? 'friclaw' : 'none',
      running,
      pid: pidRecord?.pid ?? null,
      port: null,
      stalePid: pidRecord ? !running : false,
    }
  }

  const health = await fetchFriClawHealth(target.port, { fetchFn: options.fetchFn })
  if (health) {
    return {
      mode: 'port',
      owner: 'friclaw',
      running: true,
      pid: health.pid,
      port: target.port,
      stalePid,
    }
  }

  const portOpen = await (options.isPortOpenFn ?? isPortOpen)(target.port)
  return {
    mode: 'port',
    owner: portOpen ? 'other' : 'none',
    running: false,
    pid: pidRecord?.pid ?? null,
    port: target.port,
    stalePid,
  }
}

export function writePidRecord(pidFile: string, record: PidRecord): void {
  mkdirSync(dirname(pidFile), { recursive: true })
  writeFileSync(pidFile, JSON.stringify(record, null, 2))
}

export function removePidRecord(pidFile: string, pid = process.pid): void {
  const existing = readPidRecord(pidFile)
  if (!existing || existing.pid !== pid) return
  clearPidRecord(pidFile)
}

export async function stopExistingProcess(
  pidFile: string,
  options: {
    kill?: typeof process.kill
    isAlive?: (pid: number) => boolean
    sleep?: (ms: number) => Promise<void>
    timeoutMs?: number
  } = {},
): Promise<number | null> {
  const existing = readPidRecord(pidFile)
  if (!existing) return null

  const isAlive = options.isAlive ?? isProcessAlive
  const kill = options.kill ?? process.kill.bind(process)
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms))
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS

  if (!isAlive(existing.pid)) {
    clearPidRecord(pidFile)
    return existing.pid
  }

  log.info({ pid: existing.pid }, 'Stopping existing daemon')
  kill(existing.pid, 'SIGTERM')

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(existing.pid)) {
      clearPidRecord(pidFile)
      return existing.pid
    }
    await sleep(200)
  }

  throw new Error(`Existing FriClaw process did not stop within ${timeoutMs}ms (pid=${existing.pid})`)
}

export async function stopManagedInstance(
  target: LifecycleTarget,
  options: StopInstanceOptions = {},
): Promise<number | null> {
  if (!target.dashboardEnabled) {
    return await stopExistingProcess(target.pidFile, options)
  }

  const status = await getDaemonStatus(target, options)
  if (status.owner === 'other') {
    throw new Error(`Port ${target.port} is occupied by another process`)
  }
  if (status.owner === 'none') {
    if (status.stalePid) clearPidRecord(target.pidFile)
    return null
  }
  if (status.pid === null) {
    throw new Error(`FriClaw is running on port ${target.port}, but no pid was reported`)
  }

  const kill = options.kill ?? process.kill.bind(process)
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms))
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS

  log.info({ pid: status.pid, port: target.port }, 'Stopping FriClaw instance identified by port')
  kill(status.pid, 'SIGTERM')

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = await getDaemonStatus(target, options)
    if (current.owner !== 'friclaw') {
      removePidRecord(target.pidFile, status.pid)
      if (current.stalePid) clearPidRecord(target.pidFile)
      return status.pid
    }
    await sleep(200)
  }

  throw new Error(`FriClaw on port ${target.port} did not stop within ${timeoutMs}ms (pid=${status.pid})`)
}

export async function takeoverExistingProcess(
  target: LifecycleTarget,
  takeover: boolean,
  options: StopInstanceOptions = {},
): Promise<void> {
  if (!target.dashboardEnabled) {
    const existing = readPidRecord(target.pidFile)
    if (!existing) return

    const isAlive = options.isAlive ?? isProcessAlive
    if (!isAlive(existing.pid)) {
      clearPidRecord(target.pidFile)
      return
    }

    if (!takeover) {
      throw new Error(`FriClaw is already running with pid=${existing.pid}`)
    }

    await stopExistingProcess(target.pidFile, options)
    return
  }

  const status = await getDaemonStatus(target, options)
  if (status.owner === 'none') {
    if (status.stalePid) clearPidRecord(target.pidFile)
    return
  }
  if (status.owner === 'other') {
    throw new Error(`Port ${target.port} is occupied by another process`)
  }
  if (!takeover) {
    throw new Error(`FriClaw is already running on port ${target.port}`)
  }

  await stopManagedInstance(target, options)
}

export function spawnDaemonChild(options: DaemonSpawnOptions = {}): number {
  const argv = options.argv ?? process.argv
  const cwd = options.cwd ?? process.cwd()
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...options.env,
    [DAEMON_CHILD_ENV]: '1',
  }
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT

  const child = (options.spawnFn ?? spawn)('bun', argv.slice(1), {
    cwd,
    env,
    detached: true,
    stdio: 'ignore',
  })

  child.unref()
  return child.pid ?? 0
}

export function createPidRecord(argv: string[] = process.argv, cwd = process.cwd(), pid = process.pid): PidRecord {
  return {
    pid,
    startedAt: new Date().toISOString(),
    argv,
    cwd,
  }
}

export const daemonEnv = {
  DAEMON_CHILD_ENV,
  FOREGROUND_ENV,
}
