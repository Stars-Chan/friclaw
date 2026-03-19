# 05 MCP 基础框架

## 目标

实现 MCP（Model Context Protocol）服务端和客户端框架，支持工具注册、热重载和多服务管理。

## 背景

MCP 是 Claude Code 的插件协议。FriClaw 通过 MCP 向 Claude Code 暴露自定义工具（如记忆系统、定时任务），同时也可以作为 MCP 客户端连接外部 MCP 服务。

```
Claude Code Agent
    ↓ 调用工具
MCP Server (stdio)
    ↓ 实现工具
FriClaw 内部服务（记忆、定时任务等）
```

## 子任务

### 5.1 MCP Server 基础框架

每个 MCP Server 是一个独立的 stdio 进程，通过标准输入输出与 Claude Code 通信。

```typescript
// src/mcp/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

export abstract class BaseMcpServer {
  protected server: Server

  constructor(name: string, version: string) {
    this.server = new Server({ name, version }, {
      capabilities: { tools: {} }
    })
    this.registerTools()
  }

  // 子类实现工具注册
  protected abstract registerTools(): void

  async start(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
  }
}
```

### 5.2 记忆 MCP Server

```typescript
// src/memory/mcp-server.ts
export class MemoryMcpServer extends BaseMcpServer {
  private manager: MemoryManager

  protected registerTools(): void {
    // memory_search
    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      switch (req.params.name) {
        case 'memory_search':
          return this.handleSearch(req.params.arguments)
        case 'memory_save':
          return this.handleSave(req.params.arguments)
        case 'memory_list':
          return this.handleList(req.params.arguments)
        case 'memory_read':
          return this.handleRead(req.params.arguments)
        default:
          throw new Error(`Unknown tool: ${req.params.name}`)
      }
    })

    // 注册工具列表
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'memory_search',
          description: '搜索记忆，支持关键词和语义搜索',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
              category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] },
              limit: { type: 'number', default: 10 }
            },
            required: ['query']
          }
        },
        {
          name: 'memory_save',
          description: '保存或更新记忆',
          inputSchema: {
            type: 'object',
            properties: {
              content: { type: 'string' },
              topic: { type: 'string', description: '知识主题（knowledge 类型必填）' },
              category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] }
            },
            required: ['content', 'category']
          }
        },
        {
          name: 'memory_list',
          description: '列出记忆条目',
          inputSchema: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] }
            }
          }
        },
        {
          name: 'memory_read',
          description: '读取单条记忆文件',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '记忆文件路径或 ID' }
            },
            required: ['id']
          }
        }
      ]
    }))
  }
}
```

### 5.3 MCP Client 管理器

管理多个外部 MCP 服务的连接，支持热重载。

```typescript
// src/mcp/client.ts
export class McpClientManager {
  private clients = new Map<string, McpClient>()

  // 从配置加载所有 MCP 服务
  async loadFromConfig(servers: Record<string, McpServerConfig>): Promise<void> {
    for (const [name, config] of Object.entries(servers)) {
      await this.connect(name, config)
    }
  }

  // 连接单个 MCP 服务
  async connect(name: string, config: McpServerConfig): Promise<void> {
    const client = config.type === 'stdio'
      ? new StdioMcpClient(config)
      : new HttpMcpClient(config)
    await client.connect()
    this.clients.set(name, client)
  }

  // 热重载：断开旧连接，建立新连接
  async reload(name: string, config: McpServerConfig): Promise<void> {
    await this.disconnect(name)
    await this.connect(name, config)
  }

  // 列出所有可用工具
  async listTools(): Promise<Tool[]> {
    const tools: Tool[] = []
    for (const client of this.clients.values()) {
      tools.push(...await client.listTools())
    }
    return tools
  }
}
```

### 5.4 工作空间 MCP 配置注入

每个 Claude Code 子进程启动时，自动写入 `.mcp.json`：

```typescript
// src/agent/claude-code.ts
function writeMcpConfig(workspaceDir: string, servers: Record<string, McpServerConfig>): void {
  const mcpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, cfg]) => [
        name,
        cfg.type === 'stdio'
          ? { command: cfg.command, args: cfg.args, env: cfg.env }
          : { url: cfg.url, headers: cfg.headers }
      ])
    )
  }
  fs.writeFileSync(
    path.join(workspaceDir, '.mcp.json'),
    JSON.stringify(mcpConfig, null, 2)
  )
}
```

### 5.5 内置 MCP 服务列表

FriClaw 默认注入以下 MCP 服务：

| 服务名 | 类型 | 说明 |
|--------|------|------|
| `friclaw-memory` | stdio | 记忆系统工具 |
| `friclaw-cron` | stdio | 定时任务管理 |

用户可在 `config.json` 中追加自定义 MCP 服务。

### 5.6 热重载机制

Claude Code 子进程启动时读取 `.mcp.json`，因此热重载的实现是：

1. 用户通过 Dashboard 修改 MCP 配置
2. FriClaw 更新 `~/.friclaw/config.json`
3. 下一次新建会话时，自动使用新配置写入 `.mcp.json`
4. 已有会话不受影响（避免中断进行中的任务）

## 依赖安装

```bash
bun add @modelcontextprotocol/sdk
```

## 验收标准

- `friclaw-memory` MCP Server 能被 Claude Code 正常调用
- 四个记忆工具（search/save/list/read）功能正常
- 新会话自动注入 MCP 配置
- 用户自定义 MCP 服务能正常连接
