# Claude Code Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 ClaudeCodeAgent，通过 Bun.spawn 为每个会话启动持久 claude 子进程，经 stdin/stdout JSONL 通信，收集完整文本响应并记录日志。

**Architecture:** ClaudeCodeAgent 实现 src/dispatcher.ts 的 Agent 接口。内部维护 Map<conversationId, Subprocess> 复用进程，Map<conversationId, claudeSessionId> 支持 --resume 续接。handle() 调用 stream() 生成器消费事件，提取最终文本并 log。MemoryManager.identity.read() 提供系统提示通过 --system-prompt 注入。spawnFn 作为依赖注入，便于测试 mock。

**Tech Stack:** Bun, TypeScript, bun:test

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/agent/types.ts` | AgentStreamEvent, RunRequest, ContentBlock 类型 |
| `src/agent/utils.ts` | readLines(), buildContent(), detectMime() |
| `src/agent/claude-code.ts` | ClaudeCodeAgent 核心实现 |
| `tests/unit/agent/claude-code.test.ts` | 单元测试（fake spawn） |
| `src/index.ts` | 替换 agent stub |

---

### Task 1: 类型定义

**Files:**
- Create: `src/agent/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
// src/agent/types.ts
export interface RunRequest {
  conversationId: string
  workspaceDir: string
  text: string
  attachments?: Array<{ type: 'image'; buffer: Buffer }>
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

export type AgentStreamEvent =
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'ask_questions'; questions: string[]; conversationId: string }
  | { type: 'done'; response: { text: string; sessionId: string } }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/agent/types.ts && git commit -m "feat(agent): add AgentStreamEvent and RunRequest types"
```

---

### Task 2: 工具函数

**Files:**
- Create: `src/agent/utils.ts`

- [ ] **Step 1: 创建 utils**

```typescript
// src/agent/utils.ts
import type { ContentBlock } from './types'

export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) yield line
    }
    if (buf) yield buf
  } finally {
    reader.releaseLock()
  }
}

export function detectMime(buffer: Buffer): string {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif'
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

export function buildContent(request: { text: string; attachments?: Array<{ type: 'image'; buffer: Buffer }> }): ContentBlock[] {
  const blocks: ContentBlock[] = [{ type: 'text', text: request.text }]
  for (const att of request.attachments ?? []) {
    if (att.type === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: detectMime(att.buffer),
          data: att.buffer.toString('base64'),
        },
      })
    }
  }
  return blocks
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/agent/utils.ts && git commit -m "feat(agent): add readLines, buildContent, detectMime utils"
```

---

### Task 3: ClaudeCodeAgent — TDD

**Files:**
- Create: `tests/unit/agent/claude-code.test.ts`
- Create: `src/agent/claude-code.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/agent/claude-code.test.ts
import { describe, it, expect } from 'bun:test'
import { ClaudeCodeAgent } from '../../../src/agent/claude-code'
import type { Session } from '../../../src/session/types'
import type { Message } from '../../../src/types/message'

function makeFakeSpawn(lines: string[]) {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stdout = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })
  Promise.resolve().then(() => {
    for (const line of lines) controller.enqueue(encoder.encode(line + '\n'))
    controller.close()
  })
  return {
    stdin: {
      written: [] as string[],
      write(data: string) { this.written.push(data) },
      flush() {},
    },
    stdout,
    stderr: new ReadableStream({ start(c) { c.close() } }),
    exitCode: null as number | null,
    kill() { this.exitCode = 1 },
  }
}

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'feishu:ou_abc', userId: 'user1', chatId: 'ou_abc',
  platform: 'feishu', chatType: 'private', workspaceDir: '/tmp/ws',
  createdAt: Date.now(), lastActiveAt: Date.now(), ...overrides,
})

const makeMessage = (overrides: Partial<Message> = {}): Message => ({
  platform: 'feishu', chatId: 'ou_abc', userId: 'user1',
  type: 'text', content: 'hello', ...overrides,
})

describe('ClaudeCodeAgent', () => {
  it('handle() sends user message to stdin and resolves', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_001' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'Hi', session_id: 'sess_001' }),
    ]
    const fakeProc = makeFakeSpawn(lines)
    const agent = new ClaudeCodeAgent({ spawnFn: () => fakeProc as never })
    await expect(agent.handle(makeSession(), makeMessage())).resolves.toBeUndefined()
    const payload = JSON.parse(fakeProc.stdin.written[0])
    expect(payload.type).toBe('user')
    expect(payload.message.role).toBe('user')
  })

  it('stores session_id and uses --resume on next spawn', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_resume' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_resume' }),
    ]
    const spawnCalls: string[][] = []
    const spawnFn = (args: string[]) => { spawnCalls.push(args); return makeFakeSpawn(lines) as never }
    const agent = new ClaudeCodeAgent({ spawnFn })
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCalls[0]).not.toContain('--resume')
    // simulate process exit
    ;(agent as never)['processes'].get('feishu:ou_abc').exitCode = 0
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCalls[1]).toContain('--resume')
    expect(spawnCalls[1]).toContain('sess_resume')
  })

  it('reuses existing process when still alive', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_x' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_x' }),
    ]
    let spawnCount = 0
    const agent = new ClaudeCodeAgent({ spawnFn: () => { spawnCount++; return makeFakeSpawn(lines) as never } })
    await agent.handle(makeSession(), makeMessage())
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCount).toBe(1)
  })

  it('dispose() kills all processes', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_d' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_d' }),
    ]
    const fakeProc = makeFakeSpawn(lines)
    const agent = new ClaudeCodeAgent({ spawnFn: () => fakeProc as never })
    await agent.handle(makeSession(), makeMessage())
    await agent.dispose()
    expect(fakeProc.exitCode).toBe(1)
  })

  it('injects --system-prompt when soulContent provided', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess_soul' }),
      JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', session_id: 'sess_soul' }),
    ]
    const spawnCalls: string[][] = []
    const agent = new ClaudeCodeAgent({
      spawnFn: (args) => { spawnCalls.push(args); return makeFakeSpawn(lines) as never },
      soulContent: 'I am FriClaw',
    })
    await agent.handle(makeSession(), makeMessage())
    expect(spawnCalls[0]).toContain('--system-prompt')
    expect(spawnCalls[0]).toContain('I am FriClaw')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/agent/claude-code.test.ts 2>&1 | tail -10
```

Expected: FAIL

- [ ] **Step 3: 实现 ClaudeCodeAgent**

```typescript
// src/agent/claude-code.ts
import { logger } from '../utils/logger'
import type { Agent } from '../dispatcher'
import type { Session } from '../session/types'
import type { Message } from '../types/message'
import type { AgentStreamEvent, RunRequest } from './types'
import { readLines, buildContent } from './utils'

type Subprocess = ReturnType<typeof Bun.spawn>
type SpawnFn = (args: string[], opts?: Parameters<typeof Bun.spawn>[1]) => Subprocess

interface ClaudeCodeAgentOptions {
  spawnFn?: SpawnFn
  soulContent?: string
}

export class ClaudeCodeAgent implements Agent {
  readonly kind = 'claude_code'
  private processes = new Map<string, Subprocess>()
  private sessionIds = new Map<string, string>()
  private spawnFn: SpawnFn
  private soulContent: string

  constructor(options: ClaudeCodeAgentOptions = {}) {
    this.spawnFn = options.spawnFn ?? ((args, opts) => Bun.spawn(args, opts))
    this.soulContent = options.soulContent ?? ''
  }

  async handle(session: Session, message: Message): Promise<void> {
    const request: RunRequest = {
      conversationId: session.id,
      workspaceDir: session.workspaceDir,
      text: message.content,
    }
    let finalText = ''
    for await (const event of this.stream(request)) {
      if (event.type === 'text_delta') finalText += event.text
      if (event.type === 'done') { finalText = event.response.text; break }
    }
    logger.info({ conversationId: session.id, text: finalText }, 'Agent response')
  }

  async *stream(request: RunRequest): AsyncGenerator<AgentStreamEvent> {
    const proc = await this.getOrCreateProcess(request.conversationId, request.workspaceDir)
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: buildContent(request) },
    }) + '\n'
    proc.stdin.write(payload)
    if ('flush' in proc.stdin) (proc.stdin as { flush(): void }).flush()

    for await (const line of readLines(proc.stdout as ReadableStream<Uint8Array>)) {
      if (!line.trim()) continue
      let event: Record<string, unknown>
      try { event = JSON.parse(line) } catch { continue }

      if (event.type === 'system' && event.subtype === 'init') {
        this.sessionIds.set(request.conversationId, event.session_id as string)
        continue
      }
      if (event.type === 'assistant') {
        const content = (event.message as { content: Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown }> }).content
        for (const block of content) {
          if (block.type === 'thinking' && block.thinking) yield { type: 'thinking_delta', text: block.thinking }
          else if (block.type === 'text' && block.text) yield { type: 'text_delta', text: block.text }
          else if (block.type === 'tool_use') {
            if (block.name === 'AskUserQuestion') {
              yield { type: 'ask_questions', questions: (block.input as { questions: string[] }).questions, conversationId: request.conversationId }
            } else {
              yield { type: 'tool_use', name: block.name!, input: block.input }
            }
          }
        }
      }
      if (event.type === 'result') {
        yield { type: 'done', response: { text: event.result as string, sessionId: event.session_id as string } }
        break
      }
    }
  }

  private async getOrCreateProcess(conversationId: string, workspaceDir: string): Promise<Subprocess> {
    const existing = this.processes.get(conversationId)
    if (existing && existing.exitCode === null) return existing
    const args = ['claude', '--output-format', 'stream-json', '--verbose']
    const resumeId = this.sessionIds.get(conversationId)
    if (resumeId) args.push('--resume', resumeId)
    if (this.soulContent) args.push('--system-prompt', this.soulContent)
    const proc = this.spawnFn(args, { cwd: workspaceDir, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    this.processes.set(conversationId, proc)
    return proc
  }

  clearConversation(conversationId: string): void {
    this.sessionIds.delete(conversationId)
  }

  async dispose(conversationId?: string): Promise<void> {
    if (conversationId) {
      const proc = this.processes.get(conversationId)
      if (proc) { proc.kill(); this.processes.delete(conversationId); this.sessionIds.delete(conversationId) }
    } else {
      for (const proc of this.processes.values()) proc.kill()
      this.processes.clear(); this.sessionIds.clear()
    }
  }

  async healthCheck(): Promise<boolean> {
    try { return (await Bun.spawn(['claude', '--version']).exited) === 0 } catch { return false }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/agent/claude-code.test.ts 2>&1 | tail -10
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/agent/claude-code.ts src/agent/utils.ts src/agent/types.ts tests/unit/agent/claude-code.test.ts && git commit -m "feat(agent): implement ClaudeCodeAgent with subprocess management and JSONL streaming"
```

---

### Task 4: 更新 src/index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: 替换 agent stub**

将 index.ts 中的 agent stub 替换为：

```typescript
import { ClaudeCodeAgent } from './agent/claude-code'

// inside main(), after memory.init():
const agent = new ClaudeCodeAgent({
  soulContent: memory.identity.read(),
})

const dispatcher = new Dispatcher(sessionManager, agent, async () => {
  await agent.dispose()
  await memory.shutdown()
})
```

- [ ] **Step 2: Commit**

```bash
cd /Users/chen/workspace/ai/friclaw && git add src/index.ts && git commit -m "feat(agent): wire ClaudeCodeAgent into main entry, replace stub"
```

---

### Task 5: 全量测试验证

- [ ] **Step 1: 运行全量测试**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/ 2>&1 | tail -5
```

Expected: all pass，0 fail

- [ ] **Step 2: Push**

```bash
cd /Users/chen/workspace/ai/friclaw && git push origin main
```
