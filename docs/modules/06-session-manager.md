# 06 会话管理

## 目标

管理用户会话的生命周期：创建、维护、超时清理，以及工作空间隔离。

## 核心概念

每个会话对应一个独立的工作空间目录，Claude Code 子进程在该目录下运行，确保不同用户的文件操作互不干扰。

```
~/.friclaw/workspaces/
├── feishu_ou_xxx/          # 飞书用户私聊会话
├── feishu_oc_xxx/          # 飞书群聊会话
└── wecom_xxx/              # 企业微信会话
```

## 子任务

### 6.1 会话数据结构

```typescript
// src/session/types.ts
interface Session {
  id: string              // conversationId（平台:chatId）
  userId: string
  chatId: string
  platform: 'feishu' | 'wecom' | 'dashboard'
  chatType: 'private' | 'group'
  workspaceDir: string    // 工作空间路径
  createdAt: number
  lastActiveAt: number
  agentSessionId?: string // Claude Code 内部 session ID
}
```

### 6.2 SessionManager 实现

```typescript
// src/session/manager.ts
export class SessionManager {
  private sessions = new Map<string, Session>()
  private timeoutMs: number

  // 获取或创建会话
  getOrCreate(platform: string, chatId: string, userId: string): Session {
    const id = `${platform}:${chatId}`
    let session = this.sessions.get(id)
    if (!session) {
      session = this.create(id, platform, chatId, userId)
    }
    session.lastActiveAt = Date.now()
    return session
  }

  private create(id: string, platform: string, chatId: string, userId: string): Session {
    const workspaceDir = path.join(this.workspacesDir, id.replace(':', '_'))
    fs.mkdirSync(workspaceDir, { recursive: true })
    const session: Session = {
      id, userId, chatId,
      platform: platform as Session['platform'],
      chatType: chatId.startsWith('oc_') ? 'group' : 'private',
      workspaceDir,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    }
    this.sessions.set(id, session)
    return session
  }

  // 清除会话（保留工作空间文件）
  clear(id: string): void {
    this.sessions.delete(id)
  }
}
```

### 6.3 超时清理

定期扫描不活跃会话，释放内存（工作空间文件保留）：

```typescript
startCleanupTimer(): void {
  setInterval(() => {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > this.timeoutMs) {
        this.sessions.delete(id)
        // 通知 Agent 释放子进程
        this.onSessionExpired?.(id)
      }
    }
  }, 60_000) // 每分钟检查一次
}
```

### 6.4 工作空间隔离

每个工作空间目录包含：

```
workspaces/feishu_ou_xxx/
├── .mcp.json              # MCP 配置（自动注入）
├── .claude/               # Claude Code 配置
│   └── settings.json
├── .neoclaw/
│   └── .history/          # 对话历史（用于摘要生成）
└── [用户文件]              # Claude Code 操作的文件
```

### 6.5 会话统计

提供给 Dashboard 展示：

```typescript
stats(): SessionStats {
  return {
    total: this.sessions.size,
    byPlatform: {
      feishu: [...this.sessions.values()].filter(s => s.platform === 'feishu').length,
      wecom: [...this.sessions.values()].filter(s => s.platform === 'wecom').length,
    },
    oldest: Math.min(...[...this.sessions.values()].map(s => s.createdAt)),
  }
}
```

### 6.6 /clear 和 /new 命令处理

- `/clear`：清除当前会话上下文，触发摘要生成，保留工作空间文件
- `/new`：同 `/clear`，但同时创建新的工作空间目录

## 验收标准

- 同一 chatId 复用同一会话
- 超时会话自动清理，不影响活跃会话
- 工作空间目录正确创建和隔离
- `/clear` 触发摘要生成
