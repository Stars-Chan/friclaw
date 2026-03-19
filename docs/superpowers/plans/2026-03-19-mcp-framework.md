# MCP Framework Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 MCP 服务端框架，将记忆系统封装为 `friclaw-memory` MCP Server，并实现 `.mcp.json` 自动注入机制供 Claude Code 子进程使用。

**Architecture:** 新增 `src/mcp/server.ts` 提供 `BaseMcpServer` 抽象基类；`src/memory/mcp-server.ts` 继承基类实现四个记忆工具（search/save/list/read）；`src/mcp/config-writer.ts` 负责向工作空间写入 `.mcp.json`；入口脚本 `src/mcp/memory-entry.ts` 作为独立 stdio 进程启动。

**Tech Stack:** Bun, TypeScript, @modelcontextprotocol/sdk, bun:test

---

## 现状说明

| 现有内容 | 说明 |
|---------|------|
| `src/mcp/` | 目录存在但为空 |
| `src/memory/manager.ts` | MemoryManager 已完整实现（module 04） |
| `src/config.ts` | 无 MCP server 配置 schema |
| `@modelcontextprotocol/sdk` | 未安装 |

缺少：

| 缺失项 | 说明 |
|--------|------|
| `src/mcp/server.ts` | BaseMcpServer 抽象基类 |
| `src/memory/mcp-server.ts` | 记忆工具 MCP Server 实现 |
| `src/mcp/config-writer.ts` | 写入 .mcp.json 工具函数 |
| `src/mcp/memory-entry.ts` | 独立进程入口 |
| 单元测试 | 工具 handler 逻辑测试 |

---

## 设计偏差说明

| 规格定义 | 本计划实现 | 原因 |
|---------|-----------|------|
| McpClientManager（5.3） | 本模块不实现 | 当前无外部 MCP 服务需求，留给后续模块按需引入 |
| config.json 中追加自定义 MCP 服务 | 本模块不实现 | 依赖 Dashboard（module 12），超出本模块范围 |
| `memory_save` category 参数必填 | 改为可选，默认 `knowledge` | 更符合实际使用习惯，identity 直接用 `memory_read` 读取后覆盖 |

---

## File Structure

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `src/mcp/server.ts` | BaseMcpServer 抽象基类 |
| Create | `src/memory/mcp-server.ts` | 记忆工具 MCP Server（4 个工具） |
| Create | `src/mcp/config-writer.ts` | 写入 .mcp.json 工具函数 |
| Create | `src/mcp/memory-entry.ts` | friclaw-memory 独立进程入口 |
| Create | `tests/unit/memory/mcp-server.test.ts` | 记忆工具 handler 单元测试 |
| Create | `tests/unit/mcp/config-writer.test.ts` | .mcp.json 写入测试 |

---

## Task 1: 安装依赖

**Files:** `package.json`

- [ ] **Step 1: 安装 MCP SDK**

```bash
cd /Users/chen/workspace/ai/friclaw && bun add @modelcontextprotocol/sdk
```

- [ ] **Step 2: 确认安装成功**

```bash
ls node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js
```

Expected: 文件存在，无报错

---

## Task 2: BaseMcpServer 抽象基类

**Files:**
- Create: `src/mcp/server.ts`

无需单独测试（抽象类，通过子类测试覆盖）。

- [ ] **Step 1: 实现 BaseMcpServer**

```typescript
// src/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'

export { CallToolRequestSchema, ListToolsRequestSchema, type Tool, type CallToolResult }

export abstract class BaseMcpServer {
  protected server: Server

  constructor(name: string, version: string) {
    this.server = new Server(
      { name, version },
      { capabilities: { tools: {} } }
    )
    this.registerTools()
  }

  protected abstract getTools(): Tool[]
  protected abstract handleToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult>

  protected registerTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }))

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>
      return this.handleToolCall(req.params.name, args)
    })
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
  }

  protected ok(text: string): CallToolResult {
    return { content: [{ type: 'text', text }] }
  }

  protected err(message: string): CallToolResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
}
```

---

## Task 3: MemoryMcpServer 实现

**Files:**
- Create: `src/memory/mcp-server.ts`
- Create: `tests/unit/memory/mcp-server.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/memory/mcp-server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoryManager } from '../../../src/memory/manager'
import { MemoryMcpServer } from '../../../src/memory/mcp-server'

let tmpDir: string
let manager: MemoryManager
let mcpServer: MemoryMcpServer

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  manager = new MemoryManager({
    dir: tmpDir,
    searchLimit: 10,
    vectorEnabled: false,
    vectorEndpoint: '',
  })
  await manager.init()
  mcpServer = new MemoryMcpServer(manager)
})

afterEach(async () => {
  await manager.shutdown()
  rmSync(tmpDir, { recursive: true })
})

describe('MemoryMcpServer tools', () => {
  it('getTools() returns 4 tools', () => {
    const tools = mcpServer.tools()
    expect(tools).toHaveLength(4)
    expect(tools.map(t => t.name)).toEqual([
      'memory_search', 'memory_save', 'memory_list', 'memory_read'
    ])
  })

  it('memory_save + memory_read roundtrip', async () => {
    const saveResult = await mcpServer.call('memory_save', {
      content: 'user prefers dark mode',
      id: 'preferences',
      category: 'knowledge',
    })
    expect(saveResult.isError).toBeFalsy()

    const readResult = await mcpServer.call('memory_read', { id: 'preferences' })
    expect(readResult.content[0].text).toContain('user prefers dark mode')
  })

  it('memory_search returns matching results', async () => {
    await mcpServer.call('memory_save', {
      content: 'friclaw project is awesome',
      id: 'projects',
      category: 'knowledge',
    })
    const result = await mcpServer.call('memory_search', { query: 'friclaw' })
    expect(result.content[0].text).toContain('friclaw')
  })

  it('memory_list returns saved topics', async () => {
    await mcpServer.call('memory_save', { content: 'A', id: 'preferences', category: 'knowledge' })
    await mcpServer.call('memory_save', { content: 'B', id: 'projects', category: 'knowledge' })
    const result = await mcpServer.call('memory_list', { category: 'knowledge' })
    expect(result.content[0].text).toContain('preferences')
    expect(result.content[0].text).toContain('projects')
  })

  it('memory_read returns error for unknown id', async () => {
    const result = await mcpServer.call('memory_read', { id: 'nonexistent' })
    expect(result.isError).toBe(true)
  })

  it('handleToolCall returns error for unknown tool', async () => {
    const result = await mcpServer.call('unknown_tool', {})
    expect(result.isError).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/memory/mcp-server.test.ts 2>&1 | head -20
```

Expected: FAIL（MemoryMcpServer 不存在）

- [ ] **Step 3: 实现 MemoryMcpServer**

```typescript
// src/memory/mcp-server.ts
import { BaseMcpServer, type Tool, type CallToolResult } from '../mcp/server'
import type { MemoryManager } from './manager'

export class MemoryMcpServer extends BaseMcpServer {
  constructor(private manager: MemoryManager) {
    super('friclaw-memory', '1.0.0')
  }

  // 暴露给测试直接调用
  tools(): Tool[] {
    return this.getTools()
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.handleToolCall(name, args)
  }

  protected getTools(): Tool[] {
    return [
      {
        name: 'memory_search',
        description: '搜索记忆，支持关键词全文检索',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] },
            limit: { type: 'number', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_save',
        description: '保存或更新记忆',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '记忆内容' },
            id: { type: 'string', description: 'knowledge topic 或 identity（固定为 SOUL）' },
            category: {
              type: 'string',
              enum: ['identity', 'knowledge', 'episode'],
              default: 'knowledge',
            },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['content'],
        },
      },
      {
        name: 'memory_list',
        description: '列出记忆条目',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] },
          },
        },
      },
      {
        name: 'memory_read',
        description: '读取单条记忆内容',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'knowledge topic 名称，或 "SOUL" 读取 identity' },
          },
          required: ['id'],
        },
      },
    ]
  }

  protected async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    try {
      switch (name) {
        case 'memory_search': {
          const { query, category, limit } = args as {
            query: string
            category?: 'identity' | 'knowledge' | 'episode'
            limit?: number
          }
          const results = this.manager.search(query, category)
          if (results.length === 0) return this.ok('No results found.')
          const text = results
            .slice(0, limit ?? 10)
            .map(r => `[${r.category}] ${r.title}\n${r.content}`)
            .join('\n\n---\n\n')
          return this.ok(text)
        }

        case 'memory_save': {
          const { content, id, category = 'knowledge', tags } = args as {
            content: string
            id?: string
            category?: 'identity' | 'knowledge' | 'episode'
            tags?: string[]
          }
          if (category === 'identity') {
            this.manager.identity.update(content)
            return this.ok('Identity (SOUL.md) updated.')
          }
          if (category === 'episode') {
            const episodeId = this.manager.episode.save(content, tags)
            return this.ok(`Episode saved: ${episodeId}`)
          }
          // knowledge
          const topic = id ?? 'notes'
          this.manager.knowledge.save(topic, content, tags)
          return this.ok(`Knowledge saved: ${topic}`)
        }

        case 'memory_list': {
          const { category } = args as { category?: 'identity' | 'knowledge' | 'episode' }
          if (!category || category === 'knowledge') {
            const topics = this.manager.knowledge.list()
            return this.ok(topics.length ? topics.join('\n') : 'No knowledge entries.')
          }
          if (category === 'episode') {
            const episodes = this.manager.episode.recent(20)
            return this.ok(
              episodes.length
                ? episodes.map(e => `${e.id} [${e.tags.join(', ')}]`).join('\n')
                : 'No episodes.'
            )
          }
          return this.ok('identity: SOUL.md')
        }

        case 'memory_read': {
          const { id } = args as { id: string }
          if (id === 'SOUL' || id === 'identity') {
            return this.ok(this.manager.identity.read())
          }
          const content = this.manager.knowledge.read(id)
          if (!content) return this.err(`Not found: ${id}`)
          return this.ok(content)
        }

        default:
          return this.err(`Unknown tool: ${name}`)
      }
    } catch (e) {
      return this.err((e as Error).message)
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test tests/unit/memory/mcp-server.test.ts
```

Expected: 6 pass, 0 fail

---

## Task 4: .mcp.json 配置写入

**Files:**
- Create: `src/mcp/config-writer.ts`
- Create: `tests/unit/mcp/config-writer.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/mcp/config-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeMcpConfig } from '../../../src/mcp/config-writer'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true })
})

describe('writeMcpConfig', () => {
  it('creates .mcp.json in workspace dir', () => {
    writeMcpConfig(tmpDir, {
      'friclaw-memory': {
        type: 'stdio',
        command: 'bun',
        args: ['run', '/path/to/memory-entry.ts'],
      },
    })
    expect(existsSync(join(tmpDir, '.mcp.json'))).toBe(true)
  })

  it('writes correct mcpServers structure', () => {
    writeMcpConfig(tmpDir, {
      'friclaw-memory': {
        type: 'stdio',
        command: 'bun',
        args: ['run', '/path/to/memory-entry.ts'],
      },
    })
    const config = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers['friclaw-memory'].command).toBe('bun')
    expect(config.mcpServers['friclaw-memory'].args).toEqual(['run', '/path/to/memory-entry.ts'])
  })

  it('supports http type servers', () => {
    writeMcpConfig(tmpDir, {
      'external-svc': {
        type: 'http',
        url: 'https://example.com/mcp',
      },
    })
    const config = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers['external-svc'].url).toBe('https://example.com/mcp')
  })

  it('overwrites existing .mcp.json', () => {
    writeMcpConfig(tmpDir, { 'svc-a': { type: 'stdio', command: 'a', args: [] } })
    writeMcpConfig(tmpDir, { 'svc-b': { type: 'stdio', command: 'b', args: [] } })
    const config = JSON.parse(readFileSync(join(tmpDir, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers['svc-a']).toBeUndefined()
    expect(config.mcpServers['svc-b'].command).toBe('b')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/mcp/config-writer.test.ts 2>&1 | head -10
```

Expected: FAIL（writeMcpConfig 不存在）

- [ ] **Step 3: 实现 config-writer.ts**

```typescript
// src/mcp/config-writer.ts
import { writeFileSync } from 'fs'
import { join } from 'path'

export interface StdioMcpServerConfig {
  type: 'stdio'
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface HttpMcpServerConfig {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

export type McpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig

export function writeMcpConfig(
  workspaceDir: string,
  servers: Record<string, McpServerConfig>
): void {
  const mcpServers: Record<string, unknown> = {}

  for (const [name, cfg] of Object.entries(servers)) {
    if (cfg.type === 'stdio') {
      mcpServers[name] = {
        command: cfg.command,
        args: cfg.args,
        ...(cfg.env ? { env: cfg.env } : {}),
      }
    } else {
      mcpServers[name] = {
        url: cfg.url,
        ...(cfg.headers ? { headers: cfg.headers } : {}),
      }
    }
  }

  writeFileSync(
    join(workspaceDir, '.mcp.json'),
    JSON.stringify({ mcpServers }, null, 2),
    'utf-8'
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
bun test tests/unit/mcp/config-writer.test.ts
```

Expected: 4 pass, 0 fail

---

## Task 5: memory-entry.ts 进程入口

**Files:**
- Create: `src/mcp/memory-entry.ts`

无需单独测试（进程入口，集成测试覆盖）。

- [ ] **Step 1: 实现进程入口**

```typescript
// src/mcp/memory-entry.ts
import { loadConfig } from '../config'
import { MemoryManager } from '../memory/manager'
import { MemoryMcpServer } from '../memory/mcp-server'

async function main() {
  const config = await loadConfig()
  const manager = new MemoryManager(config.memory)
  await manager.init()

  const server = new MemoryMcpServer(manager)
  await server.start()
}

main().catch((e) => {
  process.stderr.write(`friclaw-memory MCP server error: ${e.message}\n`)
  process.exit(1)
})
```

- [ ] **Step 2: 验证可启动（dry run）**

```bash
cd /Users/chen/workspace/ai/friclaw && timeout 2 bun run src/mcp/memory-entry.ts 2>&1 || true
```

Expected: 进程启动后等待 stdio 输入（无报错退出）

---

## Task 6: 运行全部测试

- [ ] **Step 1: 运行所有新增测试**

```bash
cd /Users/chen/workspace/ai/friclaw && bun test tests/unit/memory/mcp-server.test.ts tests/unit/mcp/config-writer.test.ts
```

Expected: 10 pass, 0 fail

- [ ] **Step 2: 运行全量测试确认无回归**

```bash
bun test tests/unit/
```

Expected: 全部通过

---

## 验收标准

- [ ] `@modelcontextprotocol/sdk` 安装成功
- [ ] 四个记忆工具（search/save/list/read）单元测试通过
- [ ] `.mcp.json` 写入测试通过
- [ ] `src/mcp/memory-entry.ts` 可作为独立进程启动
- [ ] 全量测试无回归（`bun test tests/unit/`）
