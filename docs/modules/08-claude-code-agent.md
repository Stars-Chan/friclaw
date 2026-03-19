# 07 Claude Code Agent 集成

## 目标

实现与 Claude Code CLI 的子进程通信，每个会话对应一个长驻 claude 子进程，通过 stdin/stdout JSONL 协议交互。

## 通信协议

```
FriClaw → claude stdin:  {"type":"user","message":{"role":"user","content":"..."}}
claude stdout → FriClaw: {"type":"assistant","message":{"role":"assistant","content":[...]}}
                         {"type":"result","subtype":"success","result":"...","session_id":"..."}
```

流式事件类型：
- `system/init` — 子进程初始化完成，携带 session_id
- `assistant` — AI 响应内容块（thinking / text / tool_use）
- `result` — 本轮对话结束

## 子任务

### 7.1 子进程管理

```typescript
// src/agent/claude-code.ts
export class ClaudeCodeAgent implements Agent {
  readonly kind = 'claude_code'
  // conversationId → 子进程
  private processes = new Map<string, Subprocess>()
  // conversationId → Claude session_id
  private sessionIds = new Map<string, string>()

  private async getOrCreateProcess(conversationId: string, workspaceDir: string): Promise<Subprocess> {
    let proc = this.processes.get(conversationId)
    if (proc && proc.exitCode === null) return proc

    const sessionId = this.sessionIds.get(conversationId)
    const args = ['--output-format', 'stream-json', '--verbose']
    if (sessionId) args.push('--resume', sessionId)

    proc = Bun.spawn(['claude', ...args], {
      cwd: workspaceDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    this.processes.set(conversationId, proc)
    return proc
  }
}
```

### 7.2 流式响应处理

```typescript
async *stream(request: RunRequest): AsyncGenerator<AgentStreamEvent> {
  const proc = await this.getOrCreateProcess(
    request.conversationId,
    request.workspaceDir
  )

  // 发送消息
  const payload = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: buildContent(request) }
  }) + '\n'
  proc.stdin.write(payload)

  // 读取流式响应
  for await (const line of readLines(proc.stdout)) {
    if (!line.trim()) continue
    const event = JSON.parse(line)

    if (event.type === 'system' && event.subtype === 'init') {
      this.sessionIds.set(request.conversationId, event.session_id)
      continue
    }

    if (event.type === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'thinking') {
          yield { type: 'thinking_delta', text: block.thinking }
        } else if (block.type === 'text') {
          yield { type: 'text_delta', text: block.text }
        } else if (block.type === 'tool_use') {
          yield { type: 'tool_use', name: block.name, input: block.input }
        }
      }
    }

    if (event.type === 'result') {
      yield { type: 'done', response: { text: event.result, sessionId: event.session_id } }
      break
    }
  }
}
```

### 7.3 多模态支持（图片）

```typescript
function buildContent(request: RunRequest): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text: request.text }]

  for (const attachment of request.attachments ?? []) {
    if (attachment.type === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: detectMime(attachment.buffer),
          data: attachment.buffer.toString('base64'),
        }
      })
    }
  }

  return blocks
}
```

### 7.4 AskUserQuestion 工具处理

Claude Code 可能调用 `AskUserQuestion` 工具请求用户澄清，需要特殊处理：

```typescript
if (event.type === 'assistant') {
  for (const block of event.message.content) {
    if (block.type === 'tool_use' && block.name === 'AskUserQuestion') {
      yield {
        type: 'ask_questions',
        questions: block.input.questions,
        conversationId: request.conversationId
      }
    }
  }
}
```

网关层收到 `ask_questions` 事件后，渲染为平台原生的交互表单（飞书卡片按钮等）。

### 7.5 子进程生命周期管理

```typescript
// 清除会话（不销毁子进程，保留 session_id 用于恢复）
clearConversation(conversationId: string): void {
  this.sessionIds.delete(conversationId)
}

// 销毁子进程（会话超时或服务关闭时）
async dispose(conversationId?: string): Promise<void> {
  if (conversationId) {
    const proc = this.processes.get(conversationId)
    proc?.kill()
    this.processes.delete(conversationId)
    this.sessionIds.delete(conversationId)
  } else {
    // 销毁所有子进程
    for (const proc of this.processes.values()) proc.kill()
    this.processes.clear()
    this.sessionIds.clear()
  }
}
```

### 7.6 健康检查

```typescript
async healthCheck(): Promise<boolean> {
  try {
    const result = await Bun.spawn(['claude', '--version']).exited
    return result === 0
  } catch {
    return false
  }
}
```

### 7.7 系统提示注入

启动子进程时通过 `--system-prompt` 注入身份信息：

```typescript
const soulContent = memoryManager.identity.read()
args.push('--system-prompt', soulContent)
```

## 验收标准

- 子进程正常启动，能收发 JSONL 消息
- 流式响应正确转发给网关层
- 图片附件正确编码传递
- 子进程异常退出后自动重建
- 会话超时后子进程正确销毁
