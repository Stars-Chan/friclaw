// tests/unit/agent/file-guard.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import {
  isPathBlocked,
  isOutsideWorkspace,
  FileGuard,
  writeClaudeSettings,
} from '../../../src/agent/file-guard'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-guard-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('isPathBlocked', () => {
  it('blocks ~/.ssh directory', () => {
    expect(isPathBlocked(join(homedir(), '.ssh'))).toBe(true)
  })
  it('blocks file inside ~/.ssh', () => {
    expect(isPathBlocked(join(homedir(), '.ssh', 'id_rsa'))).toBe(true)
  })
  it('blocks ~/.aws directory', () => {
    expect(isPathBlocked(join(homedir(), '.aws'))).toBe(true)
  })
  it('blocks ~/.gnupg directory', () => {
    expect(isPathBlocked(join(homedir(), '.gnupg'))).toBe(true)
  })
  it('blocks ~/.config/gcloud', () => {
    expect(isPathBlocked(join(homedir(), '.config', 'gcloud'))).toBe(true)
  })
  it('blocks /etc/passwd', () => {
    expect(isPathBlocked('/etc/passwd')).toBe(true)
  })
  it('blocks /etc/shadow', () => {
    expect(isPathBlocked('/etc/shadow')).toBe(true)
  })
  it('blocks /etc/hosts', () => {
    expect(isPathBlocked('/etc/hosts')).toBe(true)
  })
  it('blocks .env file', () => {
    expect(isPathBlocked('/some/project/.env')).toBe(true)
  })
  it('blocks .env.local file', () => {
    expect(isPathBlocked('/some/project/.env.local')).toBe(true)
  })
  it('blocks credentials file', () => {
    expect(isPathBlocked('/some/dir/credentials')).toBe(true)
  })
  it('blocks id_rsa file by pattern', () => {
    expect(isPathBlocked('/some/dir/id_rsa')).toBe(true)
  })
  it('blocks id_ed25519 file', () => {
    expect(isPathBlocked('/some/dir/id_ed25519')).toBe(true)
  })
  it('blocks .pem file', () => {
    expect(isPathBlocked('/some/dir/cert.pem')).toBe(true)
  })
  it('blocks .key file', () => {
    expect(isPathBlocked('/some/dir/server.key')).toBe(true)
  })
  it('blocks file with secret in name (case-insensitive)', () => {
    expect(isPathBlocked('/some/dir/mySecret.txt')).toBe(true)
    expect(isPathBlocked('/some/dir/SECRET_KEY')).toBe(true)
  })
  it('blocks file with password in name (case-insensitive)', () => {
    expect(isPathBlocked('/some/dir/password.txt')).toBe(true)
  })
  it('blocks file with token in name (case-insensitive)', () => {
    expect(isPathBlocked('/some/dir/auth_token')).toBe(true)
  })
  it('allows normal source file', () => {
    expect(isPathBlocked('/some/project/src/index.ts')).toBe(false)
  })
  it('allows README.md', () => {
    expect(isPathBlocked('/some/project/README.md')).toBe(false)
  })
  it('allows package.json', () => {
    expect(isPathBlocked('/some/project/package.json')).toBe(false)
  })
})

describe('isOutsideWorkspace', () => {
  it('returns false for path inside workspace', () => {
    expect(isOutsideWorkspace(join(tmpDir, 'src', 'index.ts'), tmpDir)).toBe(false)
  })
  it('returns false for workspace root itself', () => {
    expect(isOutsideWorkspace(tmpDir, tmpDir)).toBe(false)
  })
  it('returns true for path outside workspace', () => {
    expect(isOutsideWorkspace('/etc/passwd', tmpDir)).toBe(true)
  })
  it('returns true for sibling directory', () => {
    const sibling = join(tmpDir, '..', 'other-workspace')
    expect(isOutsideWorkspace(sibling, tmpDir)).toBe(true)
  })
  it('prevents path traversal attack', () => {
    const traversal = join(tmpDir, '..', '..', 'etc', 'passwd')
    expect(isOutsideWorkspace(traversal, tmpDir)).toBe(true)
  })
})

describe('FileGuard', () => {
  it('allows normal file inside workspace', () => {
    const guard = new FileGuard(tmpDir)
    const result = guard.check(join(tmpDir, 'src', 'index.ts'))
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })
  it('blocks sensitive path with reason', () => {
    const guard = new FileGuard(tmpDir)
    const result = guard.check(join(homedir(), '.ssh', 'id_rsa'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('安全策略')
  })
  it('blocks path outside workspace with reason', () => {
    const guard = new FileGuard(tmpDir)
    const result = guard.check('/tmp/other/file.txt')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('工作空间')
  })
  it('checkAll splits paths into blocked and allowed', () => {
    const guard = new FileGuard(tmpDir)
    const paths = [
      join(tmpDir, 'src', 'index.ts'),
      join(homedir(), '.ssh', 'id_rsa'),
      join(tmpDir, 'README.md'),
      '/etc/passwd',
    ]
    const result = guard.checkAll(paths)
    expect(result.allowed).toHaveLength(2)
    expect(result.blocked).toHaveLength(2)
  })
})

describe('writeClaudeSettings', () => {
  it('creates .claude/settings.json in workspace', () => {
    writeClaudeSettings(tmpDir)
    expect(existsSync(join(tmpDir, '.claude', 'settings.json'))).toBe(true)
  })
  it('settings.json contains allow rule for workspace', () => {
    writeClaudeSettings(tmpDir)
    const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'))
    expect(settings.permissions.allow).toContain(`${tmpDir}/**`)
  })
  it('settings.json contains deny rules for sensitive paths', () => {
    writeClaudeSettings(tmpDir)
    const settings = JSON.parse(readFileSync(join(tmpDir, '.claude', 'settings.json'), 'utf-8'))
    const deny: string[] = settings.permissions.deny
    expect(deny.some((d: string) => d.includes('.ssh'))).toBe(true)
    expect(deny.some((d: string) => d.includes('.aws'))).toBe(true)
    expect(deny.some((d: string) => d.includes('.env'))).toBe(true)
    expect(deny.some((d: string) => d.includes('.pem'))).toBe(true)
    expect(deny.some((d: string) => d.includes('.key'))).toBe(true)
  })
  it('is idempotent — calling twice does not throw', () => {
    expect(() => { writeClaudeSettings(tmpDir); writeClaudeSettings(tmpDir) }).not.toThrow()
  })
})
