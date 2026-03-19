# 08 文件安全机制

## 目标

防止 Claude Code 访问工作空间以外的敏感文件，保护系统安全和用户隐私。

## 背景

Claude Code 有完整的文件系统访问能力，如果不加限制，可能读取 `~/.ssh/`、`~/.aws/`、环境变量文件等敏感内容。文件安全机制通过黑名单和路径限制来防范这类风险。

## 子任务

### 8.1 路径黑名单

```typescript
// src/agent/file-guard.ts

// 绝对路径黑名单（精确匹配）
const BLOCKED_PATHS = new Set([
  path.join(os.homedir(), '.ssh'),
  path.join(os.homedir(), '.aws'),
  path.join(os.homedir(), '.gnupg'),
  path.join(os.homedir(), '.config/gcloud'),
  '/etc/passwd',
  '/etc/shadow',
  '/etc/hosts',
])

// 文件名黑名单（模糊匹配）
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
```

### 8.2 路径检查函数

```typescript
export function isPathBlocked(filePath: string): boolean {
  const resolved = path.resolve(filePath)

  // 检查绝对路径黑名单
  for (const blocked of BLOCKED_PATHS) {
    if (resolved === blocked || resolved.startsWith(blocked + path.sep)) {
      return true
    }
  }

  // 检查文件名模式
  const basename = path.basename(resolved)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(basename)) {
      return true
    }
  }

  return false
}
```

### 8.3 工作空间边界检查

Claude Code 的文件操作应限制在工作空间目录内：

```typescript
export function isOutsideWorkspace(filePath: string, workspaceDir: string): boolean {
  const resolved = path.resolve(filePath)
  const workspace = path.resolve(workspaceDir)
  return !resolved.startsWith(workspace + path.sep) && resolved !== workspace
}
```

### 8.4 FileGuard 类

```typescript
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

  // 批量检查
  checkAll(paths: string[]): { blocked: string[]; allowed: string[] } {
    const blocked: string[] = []
    const allowed: string[] = []
    for (const p of paths) {
      this.check(p).allowed ? allowed.push(p) : blocked.push(p)
    }
    return { blocked, allowed }
  }
}
```

### 8.5 与 Claude Code 集成

通过 Claude Code 的 `--disallowed-tools` 和工作空间配置限制文件访问：

```typescript
// 写入工作空间 settings
function writeClaudeSettings(workspaceDir: string): void {
  const settings = {
    permissions: {
      allow: [`${workspaceDir}/**`],
      deny: [
        `${os.homedir()}/.ssh/**`,
        `${os.homedir()}/.aws/**`,
        `${os.homedir()}/.env`,
        '**/.env',
        '**/*.pem',
        '**/*.key',
      ]
    }
  }
  const settingsDir = path.join(workspaceDir, '.claude')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.writeFileSync(
    path.join(settingsDir, 'settings.json'),
    JSON.stringify(settings, null, 2)
  )
}
```

### 8.6 安全日志

记录所有被拦截的访问尝试：

```typescript
export function logBlockedAccess(filePath: string, reason: string, conversationId: string): void {
  logger.warn({
    event: 'file_access_blocked',
    filePath,
    reason,
    conversationId,
    timestamp: new Date().toISOString(),
  })
}
```

### 8.7 白名单例外

某些场景需要访问工作空间外的文件（如读取用户指定的项目目录），通过配置白名单支持：

```typescript
// config.json
{
  "security": {
    "allowedPaths": [
      "~/projects",
      "~/Documents"
    ]
  }
}
```

## 验收标准

- 访问 `~/.ssh/` 等敏感路径被拦截并记录日志
- `.env` 文件访问被拦截
- 工作空间内的正常文件操作不受影响
- 白名单路径可正常访问
