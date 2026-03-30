// src/agent/file-guard.ts
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { logger } from '../utils/logger'

const log = logger('file-guard')

const BLOCKED_PATHS = new Set([
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.config', 'gcloud'),
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hosts',
])

const BLOCKED_PATTERNS = [
  /\.env$/,
  /\.env\./,
  /credentials$/,
  /id_rsa/,
  /id_ed25519/,
  /\.pem$/,
  /\.key$/,
  /secret/i,
  /password/i,
  /token/i,
]

export function isPathBlocked(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  for (const blocked of BLOCKED_PATHS) {
    if (resolved === blocked || resolved.startsWith(blocked + path.sep)) return true
  }
  const basename = path.basename(resolved)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(basename)) return true
  }
  return false
}

export function isOutsideWorkspace(filePath: string, workspaceDir: string): boolean {
  const resolved = path.resolve(filePath)
  const workspace = path.resolve(workspaceDir)
  return !resolved.startsWith(workspace + path.sep) && resolved !== workspace
}

export class FileGuard {
  constructor(private workspaceDir: string) {}

  check(filePath: string): { allowed: boolean; reason?: string } {
    if (isPathBlocked(filePath)) {
      return { allowed: false, reason: `路径被安全策略阻止: ${filePath}` }
    }
    if (isOutsideWorkspace(filePath, this.workspaceDir)) {
      return { allowed: false, reason: `路径超出工作空间范围: ${filePath}` }
    }
    return { allowed: true }
  }

  checkAll(paths: string[]): { blocked: string[]; allowed: string[] } {
    const blocked: string[] = []
    const allowed: string[] = []
    for (const p of paths) {
      this.check(p).allowed ? allowed.push(p) : blocked.push(p)
    }
    return { blocked, allowed }
  }
}

export function logBlockedAccess(filePath: string, reason: string, conversationId: string): void {
  log.warn({
    event: 'file_access_blocked',
    filePath,
    reason,
    conversationId,
    timestamp: new Date().toISOString(),
  })
}

export function writeClaudeSettings(workspaceDir: string): void {
  const settings = {
    permissions: {
      allow: [`${workspaceDir}/**`],
      deny: [
        `${os.homedir()}/.ssh/**`,
        `${os.homedir()}/.aws/**`,
        `${os.homedir()}/.env`,
        '**/.env',
        '**/.env.*',
        '**/*.pem',
        '**/*.key',
      ],
    },
  }
  const settingsDir = path.join(workspaceDir, '.claude')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2))
}
