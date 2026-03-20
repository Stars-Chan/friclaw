# File Guard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现文件安全机制，防止 Claude Code 访问工作空间以外的敏感文件，包括路径黑名单、工作空间边界检查、FileGuard 类、安全日志和 Claude 权限配置写入。

**Architecture:** 纯函数 isPathBlocked / isOutsideWorkspace 作为底层原语，FileGuard 类封装两者提供统一的 check / checkAll 接口。writeClaudeSettings 在会话创建时写入 .claude/settings.json，通过 Claude Code 原生权限机制双重防护。logBlockedAccess 复用 src/utils/logger.ts 的 pino 实例。

**Tech Stack:** Bun, TypeScript, bun:test, Node.js fs/path/os

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/agent/file-guard.ts` | 核心实现：黑名单、isPathBlocked、isOutsideWorkspace、FileGuard、logBlockedAccess、writeClaudeSettings |
| `tests/unit/agent/file-guard.test.ts` | 单元测试 |

---

### Task 1: 写失败测试

**Files:**
- Create: `tests/unit/agent/file-guard.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/agent/file-guard.test.ts 2>&1 | tail -10
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: Commit 测试文件**

```bash
cd /Users/chen/workspace/ai/friclaw && git add tests/unit/agent/file-guard.test.ts && git commit -m "test(agent): add failing tests for FileGuard"
```

---

### Task 2: 实现 file-guard.ts

**Files:**
- Create: `src/agent/file-guard.ts`

- [ ] **Step 1: 创建实现文件**

```typescript
// src/agent/file-guard.ts
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { logger } from '../utils/logger'

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
  logger.warn({
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
```

- [ ] **Step 2: 运行测试，确认通过**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/agent/file-guard.test.ts 2>&1 | tail -10
```

Expected: all pass

- [ ] **Step 3: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/agent/file-guard.ts tests/unit/agent/file-guard.test.ts && git commit -m "feat(agent): implement FileGuard with path blocklist, workspace boundary, and Claude settings"
```

---

### Task 3: 全量测试验证

- [ ] **Step 1: 运行全量测试**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/ 2>&1 | tail -5
```

Expected: all pass，0 fail

- [ ] **Step 2: Push**

```bash
cd /Users/chen/workspace/ai/friclaw && git push origin main
```
