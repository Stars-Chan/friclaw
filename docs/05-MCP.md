# FriClaw MCP 服务模块设计

> 基于 NeoClaw MCP 架构，为 FriClaw 设计的详细 MCP 模块文档
>
> **版本**: 1.0.0
> **参考**: Model Context Protocol (MCP)
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 模块概述](#1-模块概述)
- [2. MCP 协议基础](#2-mcp-协议基础)
- [3. 客户端实现](#3-客户端实现)
- [4. 服务器实现](#4-服务器实现)
- [5. 传输层](#5-传输层)
- [6. 内置 MCP 服务](#6-内置-mcp-服务)
- [7. 工具管理](#7-工具管理)
- [8. 资源管理](#8-资源管理)

---

## 1. 模块概述

### 1.1 设计目标

MCP (Model Context Protocol) 模块为 FriClaw 提供可扩展的工具和资源系统：

- **协议标准化**: 使用标准 MCP 协议
- **多传输支持**: 支持 stdio、HTTP、SSE 传输
- **热插拔**: 支持运行时动态加载/卸载 MCP 服务
- **类型安全**: 完整的 TypeScript 类型定义
- **错误处理**: 完善的错误处理和重试机制

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FriClaw MCP 服务架构                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌───────────────────────────────────────────────┐                │
│  │          MCP Client Manager              │                │
│  └────────────────────┬────────────────────────────────┘                │
│                       │                                     │
│    ┌──────────────────┼──────────────────┐                      │
│    ▼                  ▼                  ▼                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Memory    │  │   Cron    │  │ Workspace  │              │
│  │Server     │  │   Server   │  │   Server   │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │             │             │                     │
│       └─────────────┼─────────────┘                     │
│                     ▼                                    │
│         ┌──────────────────┐                               │
│         │ Transport Layer │                               │
│         │  - stdio        │                               │
│         │  - HTTP         │                               │
│         │  - SSE          │                               │
│         └────────┬─────────┘                               │
│                  │                                      │
│    ┌─────────────┼─────────────┐                         │
│    ▼             ▼             ▼                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │External   │  │External   │  │External   │              │
│  │Server 1   │  │Server 2   │  │Server 3   │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. MCP 协议基础

### 2.1 协议版本

```typescript
/**
 * MCP 协议版本
 */
export const MCP_VERSION = '2024-11-05';

/**
 * MCP capabilities — MCP 服务器能力
 */
export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
}
```

### 2.2 JSON-RPC 基础

```typescript
/**
 * JSONRPC Request
 */
interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

/**
 * JSONRPC Response
 */
interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: JSONRPCError;
}

/**
 * JSONRPC Error
 */
interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}
```

### 2.3 MCP 核心类型

```typescript
/**
 * MCPTool — MCP 工具定义
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
}

/**
 * MCPResource — MCP 资源定义
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCPPrompt — MCP 提示模板
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: JSONSchema;
}
```

---

## 3. 客户端实现

### 3.1 MCPClient 类

```typescript
/**
 * MCPClient — MCP 客户端
 *
 * 与 MCP 服务器通信，调用工具和获取资源
 */
export class MCPClient {
  private _transport: MCPTransport;
  private _capabilities: MCPCapabilities | null = null;
  private _requestId = 0;

  constructor(config: {
    name: string;
    transport: MCPTransport;
  }) {
    this._transport = config.transport;
  }

  /**
   * 初始化连接
   */
  async initialize(): Promise<void> {
    // 发送初始化请求
    const response = await this._send({
      method: 'initialize',
      params: {
        protocolVersion: MCP_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'friclaw',
          version: '1.0.0',
        },
      },
    });

    this._capabilities = response.result?.capabilities || null;
  }

  /**
   * 列出可用工具
   */
  async listTools(): Promise<MCPTool[]> {
    const response = await this._send({
      method: 'tools/list',
    });

    return response.result?.tools || [];
  }

  /**
   * 调用工具
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<any> {
    const response = await this._send({
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    });

    if (response.error) {
      throw new MCPError(
        `Tool "${name}" call failed: ${response.error.message}`,
        response.error.code,
        response.error.data
      );
    }

    return response.result;
  }

  /**
   * 列出可用资源
   */
  async listResources(): Promise<MCPResource[]> {
    const response = await this._send({
      method: 'resources/list',
    });

    return response.result?.resources || [];
  }

  /**
   * 读取资源内容
   */
  async readResource(uri: string): Promise<ResourceContent> {
    const response = await this._send({
      method: 'resources/read',
      params: { uri },
    });

    if (response.error) {
      throw new MCPError(
        `Resource "${uri}" read failed: ${response.error.message}`,
        response.error.code,
        response.error.data
      );
    }

    return response.result;
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private async _send(request: {
    method: string;
    params?: any;
  }): Promise<JSONRPCResponse> {
    this._requestId++;
    const jsonRpcRequest: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: this._requestId,
      method: request.method,
      params: request.params,
    };

    return this._transport.send(jsonRpcRequest);
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    return this._transport.close();
  }
}

/**
 * MCPError — MCP 错误
 */
export class MCPError extends Error {
  constructor(
    message: string,
    public code?: number,
    public data?: any
  ) {
    super(message);
    this.name = 'MCPError';
  }
}
```

---

## 4. 服务器实现

### 4.1 MCPServer 类

```typescript
/**
 * MCPServer — MCP 服务器
 *
 * 实现标准 MCP 协议，向客户端暴露工具和资源
 */
export abstract class MCPServer {
  protected _transport: MCPTransport;

  constructor(transport: MCPTransport) {
    this._transport = transport;
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    await this._transport.start((request) => this._handleRequest(request));
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    return this._transport.stop();
  }

  /**
   * 处理传入的 JSON-RPC 请求
   */
  private async _handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    try {
      let result: any;

      switch (request.method) {
        case 'initialize':
          result = await this._handleInitialize(request.params);
          break;

        case 'tools/list':
          result = await this._handleToolsList();
          break;

        case 'tools/call':
          result = await this._handleToolCall(request.params);
          break;

        case 'resources/list':
          result = await this._handleResourcesList();
          break;

        case 'resources/read':
          result = await this._handleResourceRead(request.params);
          break;

        default:
          throw new Error(`Unknown method: ${request.method}`);
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603, // Internal error
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // 抽象方法，子类实现

  protected abstract _handleInitialize(params: any): Promise<MCPCapabilities>;
  protected abstract _handleToolsList(): Promise<{ tools: MCPTool[] }>;
  protected abstract _handleToolCall(params: any): Promise<any>;
  protected abstract _handleResourcesList(): Promise<{ resources: MCPResource[] }>;
  protected abstract _handleResourceRead(params: any): Promise<ResourceContent>;
}
```

---

## 5. 传输层

### 5.1 传输接口

```typescript
/**
 * MCPTransport — MCP 传输接口
 */
export interface MCPTransport {
  /**
   * 启动传输
   */
  start(
    handler: (request: JSONRPCRequest) => Promise<JSONRPCResponse>
  ): Promise<void>;

  /**
   * 停止传输
   */
  stop(): Promise<void>;

  /**
   * 发送请求
   */
  send(request: JSONRPCRequest): Promise<JSONRPCResponse>;
}
```

### 5.2 Stdio 传输

```typescript
/**
 * StdioTransport — 标准 I/O 传输
 *
 * 通过 stdin/stdout 与子进程通信
 */
export class StdioTransport implements MCPTransport {
  private _process: ChildProcess | null = null;
  private _handler: ((request: JSONRPCRequest) => Promise<JSONRPCResponse>) | null = null;

  constructor(private readonly config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }) {}

  async start(
    handler: (request: JSONRPCRequest) => Promise<JSONRPCResponse>
  ): Promise<void> {
    this._handler = handler;

    this._process = spawn(this.config.command, this.config.args || [], {
      env: { ...process.env, ...this.config.env },
      stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
    });

    if (!this._process.stdout) {
      throw new Error('Failed to spawn process');
    }

    // 处理 stdout 响应
    this._process.stdout.on('data', (data: Buffer) => {
      const response = JSON.parse(data.toString());
      const pendingRequest = this._pendingRequests.shift();
      if (pendingRequest && this._handler) {
        pendingRequest.resolve(response);
      }
    });

    // 处理进程错误
    this._process.on('error', (error) => {
      const pendingRequest = this._pendingRequests.shift();
      if (pendingRequest && this._handler) {
        pendingRequest.reject(error);
      }
    });
  }

  async send(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    return new Promise((resolve, reject) => {
      this._pendingRequests.push({ resolve, reject });
      this._process?.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  async stop(): Promise<void> {
    if (this._process) {
      this._process.kill();
      this._process = null;
    }
  }
}
```

### 5.3 HTTP 传输

```typescript
/**
 * HTTPTransport — HTTP 传输
 *
 * 通过 HTTP 与服务器通信
 */
export class HTTPTransport implements MCPTransport {
  private _fetch: typeof fetch;
  private _url: string;
  private _headers: Record<string, string>;

  constructor(config: {
    url: string;
    headers?: Record<string, string>;
  }) {
    this._url = config.url;
    this._headers = config.headers || {
      'Content-Type': 'application/json',
    };
    // 动态导入 fetch
    this._fetch = fetch;
  }

  async start(
    handler: (request: JSONRPCRequest) => Promise<JSONRPCResponse>
  ): Promise<void> {
    this._handler = handler;
    // HTTP 传输是无状态的，不需要启动逻辑
  }

  async send(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const response = await this._fetch(this._url, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify(request),
    });

    const text = await response.text();
    return JSON.parse(text);
  }

  async stop(): Promise<void> {
    // HTTP 传输不需要停止逻辑
  }
}
```

### 5.4 SSE 传输

```typescript
/**
 * SSETransport — Server-Sent Events 传输
 *
 * 通过 SSE 与服务器通信
 */
export class SSETransport implements MCPTransport {
  private _eventSource: EventSource | null = null;
  private _handler: ((request: JSONRPCRequest) => Promise<JSONRPCResponse>) | null = null;

  constructor(config: {
    url: string;
    headers?: Record<string, string>;
  }) {
    // 在浏览器中使用 EventSource，在 Node.js 中使用 SSE 客户端
  }

  async start(
    handler: (request: JSONRPCRequest) => Promise<JSONRPCResponse>
  ): Promise<void> {
    this._handler = handler;
    // SSE 连接建立后才能发送请求
  }

  async send(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    // SSE 需要通过 HTTP POST 发送请求
    const response = await fetch(this._url + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    const text = await response.text();
    return JSON.parse(text);
  }

  async stop(): Promise<void> {
    this._eventSource?.close();
    this._eventSource = null;
  }
}
```

---

## 6. 内置 MCP 服务

### 6.1 内存 MCP 服务

```typescript
/**
 * MemoryMCPServer — 内存 MCP 服务器
 *
 * 通过 MCP 协议暴露内存操作
 */
export class MemoryMCPServer extends MCPServer {
  constructor(
    private readonly store: MemoryStore,
    transport: MCPTransport
  ) {
    super(transport);
  }

  protected async _handleInitialize(params: any): Promise<MCPCapabilities> {
    return {
      tools: {
        listChanged: false,
      },
    };
  }

  protected async _handleToolsList(): Promise<{ tools: MCPTool[] }> {
    return {
      tools: [
        {
          name: 'memory_read',
          description: 'Read a memory entry by ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Memory ID to read' },
            },
            required: ['id'],
          },
        },
        {
          name: 'memory_search',
          description: 'Search memory by query',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query text' },
              category: {
                type: 'string',
                enum: ['identity', 'knowledge', 'episode'],
              },
              limit: { type: 'number', description: 'Max results (default: 5)' },
            },
            required: ['query'],
          },
        },
        {
          name: 'memory_save',
          description: 'Save knowledge memory',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                enum: ['owner-profile', 'preferences', 'people', 'projects', 'notes'],
              },
              content: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'content'],
          },
        },
        {
          name: 'memory_list',
          description: 'List all memories',
          inputSchema: {
            type: 'object',
            properties: {
              category: {
                type: 'string',
                enum: ['identity', 'knowledge', 'episode'],
              },
            },
          },
        },
      ],
    };
  }

  protected async _handleToolCall(params: any): Promise<any> {
    const { name, arguments: args } = params;

    switch (name) {
      case 'memory_read':
        return this._handleRead(args);
      case 'memory_search':
        return this._handleSearch(args);
      case 'memory_save':
        return this._handleSave(args);
      case 'memory_list':
        return this._handleList(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async _handleRead(args: { id: string }): Promise<string> {
    const entry = this.store.get(args.id);
    return entry ? formatEntry(entry) : 'Not found';
  }

  private async _handleSearch(args: {
    query: string;
    category?: string;
    limit?: number;
  }): Promise<string> {
    const results = this.store.search(args.query, {
      category: args.category as any,
      limit: args.limit || 5,
    });
    return results.map(formatEntry).join('\n\n---\n\n');
  }

  private async _handleSave(args: {
    id: string;
    content: string;
    tags?: string[];
  }): Promise<string> {
    // 保存逻辑...
    return 'Saved successfully';
  }

  private async _handleList(args: { category?: string }): Promise<string> {
    const items = this.store.list({ category: args.category as any });
    return items.map(formatEntry).join('\n');
  }

  protected async _handleResourcesList(): Promise<{ resources: MCPResource[] }> {
    return { resources: [] };
  }

  protected async _handleResourceRead(params: any): Promise<ResourceContent> {
    throw new Error('Resource read not supported');
  }
}
```

### 6.2 Cron MCP 服务

```typescript
/**
 * CronMCPServer — 定时任务 MCP 服务器
 *
 * 通过 MCP 协议暴露定时任务管理
 */
export class CronMCPServer extends MCPServer {
  constructor(
    private readonly scheduler: CronScheduler,
    transport: MCPTransport
  ) {
    super(transport);
  }

  protected async _handleToolsList(): Promise<{ tools: MCPTool[] }> {
    return {
      tools: [
        {
          name: 'cron_create',
          description: 'Create a new cron job',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Prompt to send' },
              runAt: { type: 'string', description: 'One-time run time (ISO 8601)' },
              cronExpr: { type: 'string', description: 'Cron expression' },
              label: { type: 'string', description: 'Job label' },
            },
            required: ['message'],
          },
        },
        {
          name: 'cron_list',
          description: 'List all cron jobs',
          inputSchema: {
            type: 'object',
            properties: {
              includeDisabled: { type: 'boolean', description: 'Include disabled jobs' },
            },
          },
        },
        {
          name: 'cron_delete',
          description: 'Delete a cron job',
          inputSchema: {
            type: 'object',
            properties: {
              jobId: { type: 'string', description: 'Job ID to delete' },
            },
            required: ['jobId'],
          },
        },
        {
          name: 'cron_update',
          description: 'Update a cron job',
          inputSchema: {
            type: 'object',
            properties: {
              jobId: { type: 'string', description: 'Job ID' },
              message: { type: 'string', description: 'Prompt to send' },
              label: { type: 'string', description: 'Job label' },
              enabled: { type: 'boolean', description: 'Enable/disable job' },
              runAt: { type: 'string', description: 'One-time run time' },
              cronExpr: { type: 'string', description: 'Cron expression' },
            },
            required: ['jobId'],
          },
        },
      ],
    };
  }

  protected async _handleToolCall(params: any): Promise<any> {
    const { name, arguments: args } = params;

    switch (name) {
      case 'cron_create':
        return this.scheduler.createJob(args);
      case 'cron_list':
        return this.scheduler.listJobs(args.includeDisabled);
      case 'cron_delete':
        return this.scheduler.deleteJob(args.jobId);
      case 'cron_update':
        return this.scheduler.updateJob(args.jobId, args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
```

---

## 7. 工具管理

### 7.1 工具注册表

```typescript
/**
 * ToolRegistry — 工具注册表
 *
 * 管理所有可用的 MCP 工具
 */
export class ToolRegistry {
  private _tools = new Map<string, RegisteredTool>();
  private _clients = new Map<string, MCPClient>();

  /**
   * 注册 MCP 客户端
   */
  registerClient(name: string, client: MCPClient): void {
    this._clients.set(name, client);

    // 异步加载工具列表
    client.listTools().then((tools) => {
      for (const tool of tools) {
        this._tools.set(tool.name, {
          tool,
          clientName: name,
        });
      }
    }).catch((err) => {
      console.error(`Failed to load tools from ${name}:`, err);
    });
  }

  /**
   * 获取所有工具
   */
  getAllTools(): Map<string, RegisteredTool> {
    return new Map(this._tools);
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: any): Promise<any> {
    const tool = this._tools.get(name);

    if (!tool) {
      throw new Error(`Tool "${name}" not found`);
    }

    const client = this._clients.get(tool.clientName);
    if (!client) {
      throw new Error(`Client "${tool.clientName}" not found`);
    }

    return client.callTool(name, args);
  }
}

interface RegisteredTool {
  tool: MCPTool;
  clientName: string;
}
```

---

## 8. 资源管理

### 8.1 资源类型

```typescript
/**
 * ResourceType — 资源类型
 */
export enum ResourceType {
  File = 'file',
  Directory = 'directory',
  URL = 'url',
  Custom = 'custom',
}

/**
 * MCPResourceWrapper — 资源包装器
 */
export interface MCPResourceWrapper {
  uri: string;
  type: ResourceType;
  metadata: {
    name: string;
    description?: string;
    mimeType?: string;
    size?: number;
    modifiedAt?: string;
  };
}
```

### 8.2 资源缓存

```typescript
/**
 * ResourceCache — 资源缓存
 *
 * 缓存资源内容以减少重复访问
 */
export class ResourceCache {
  private _cache = new Map<string, CachedResource>();
  private readonly DEFAULT_TTL = 60_000; // 60 秒

  /**
   * 获取资源
   */
  async get(uri: string): Promise<ResourceContent | null> {
    const cached = this._cache.get(uri);

    if (cached) {
      if (Date.now() - cached.timestamp < this.DEFAULT_TTL) {
        return cached.content;
      }
      this._cache.delete(uri);
    }

    return null;
  }

  /**
   * 设置资源
   */
  set(uri: string, content: ResourceContent, ttl?: number): void {
    this._cache.set(uri, {
      content,
      timestamp: Date.now(),
    });

    if (ttl) {
      setTimeout(() => {
        this._cache.delete(uri);
      }, ttl);
    }
  }

  /**
   * 清除缓存
   */
  clear(): void {
    this._cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    hitRate: number;
  } {
    // 实现统计逻辑
    return {
      size: this._cache.size,
      hitRate: 0, // 需要实际统计
    };
  }
}

interface CachedResource {
  content: ResourceContent;
  timestamp: number;
}
```

---

## 附录

### A. MCP 配置格式

```typescript
/**
 * MCPServerConfig — MCP 服务器配置
 */
export interface MCPServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

/**
 * MCPClientConfig — MCP 客户端配置
 */
export interface MCPClientConfig {
  name: string;
  servers: Record<string, MCPServerConfig>;
}
```

### B. 错误代码

| 代码 | 描述 |
|------|------|
| -32600 | 服务器错误 |
| -32601 | 客户端错误 |
| -32602 | 无效的请求 |
| -32603 | 内部错误 |
| -32700 | 工具执行错误 |

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
