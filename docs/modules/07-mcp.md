# 07. MCP 框架模块

> FriClaw MCP (Model Context Protocol) 框架详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

MCP 框架负责实现 Model Context Protocol，为 AI Agent 提供工具和资源的统一接口，支持插件化扩展。

**核心功能**:
- MCP 客户端（连接外部 MCP 服务器）
- MCP 服务器（暴露内部能力）
- 工具调用管理
- 资源访问管理
- 插件生命周期管理
- 连接池管理

### 1.2 与其他模块的关系

```
MCP 框架
    ↑
    ├──> 配置系统（获取配置）
    ├──> 日志系统（输出日志）
    ↑
    ├──> Agent 层（提供工具能力）
    ├──> 内存系统（作为 MCP 服务）
    └──> 定时任务（作为 MCP 服务）
```

---

## 2. 架构设计

### 2.1 MCP 协议概述

MCP (Model Context Protocol) 是 Anthropic 提出的标准化协议，用于 AI Agent 与外部工具/资源的交互。

**核心概念**:
- **Server**: 提供 Tools 和 Resources 的服务
- **Client**: 调用 Server 提供的 Tools 和访问 Resources
- **Tool**: 可执行的函数，由 LLM 调用
- **Resource**: 可访问的数据/文件

### 2.2 传输方式

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP 传输方式                          │
├─────────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐                                       │
│  │   STDIO      │  ←──  进程间通信                       │
│  │  标准输入输出  │                                        │
│  └──────────────┘                                       │
│                                                           │
│  ┌──────────────┐                                       │
│  │    SSE       │  ←──  服务器发送事件                     │
│  │  HTTP + SSE   │                                        │
│  └──────────────┘                                       │
│                                                           │
│  ┌──────────────┐                                       │
│  │   HTTP       │  ←──  RESTful API                      │
│  │  HTTP/HTTPS   │                                       │
│  └──────────────┘                                       │
│                                                           │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 核心组件

```typescript
// MCP 客户端管理器
class MCPClientManager {
  private clients: Map<string, MCPClient>;
  private config: MCPServersConfig;

  // 初始化
  async initialize(config: MCPServersConfig): Promise<void>;

  // 连接服务器
  async connect(name: string): Promise<void>;

  // 断开连接
  async disconnect(name: string): Promise<void>;

  // 列出所有工具
  listTools(): MCPTool[];

  // 调用工具
  async callTool(name: string, args: any): Promise<MCPToolResult>;

  // 列出所有资源
  listResources(): MCPResource[];

  // 读取资源
  async readResource(uri: string): Promise<MCPResourceContent>;

  // 关闭所有连接
  close(): Promise<void>;
}

// MCP 客户端
class MCPClient {
  private name: string;
  private transport: MCPTransport;
  private capabilities: MCPServerCapabilities;
  private tools: Map<string, MCPTool>;
  private resources: Map<string, MCPResource>;

  constructor(config: MCPServerConfig);

  // 连接
  async connect(): Promise<void>;

  // 断开
  async disconnect(): Promise<void>;

  // 调用工具
  async callTool(name: string, args: any): Promise<MCPToolResult>;

  // 读取资源
  async readResource(uri: string): Promise<MCPResourceContent>;

  // 获取能力
  getCapabilities(): MCPServerCapabilities;
}

// MCP 服务器管理器
class MCPServerManager {
  private servers: Map<string, MCPServer>;

  // 注册服务器
  register(name: string, server: MCPServer): void;

  // 注销服务器
  unregister(name: string): void;

  // 启动所有服务器
  async start(): Promise<void>;

  // 停止所有服务器
  async stop(): Promise<void>;

  // 列出服务器
  list(): MCPServer[];
}

// MCP 服务器基类
abstract class MCPServer {
  abstract name: string;
  abstract version: string;

  // 工具
  abstract listTools(): MCPTool[];
  abstract callTool(name: string, args: any): Promise<MCPToolResult>;

  // 资源
  abstract listResources(): MCPResource[];
  abstract readResource(uri: string): Promise<MCPResourceContent>;

  // 生命周期
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

// 传输接口
interface MCPTransport {
  // 发送请求
  send(request: MCPRequest): Promise<MCPResponse>;

  // 监听通知
  onNotification(handler: (notification: MCPNotification) => void): void;

  // 关闭
  close(): void | Promise<void>;
}

// STDIO 传输
class StdioTransport implements MCPTransport {
  private process: ChildProcess;
  private messageQueue: MCPRequest[] = [];

  constructor(config: MCPServerConfig);

  send(request: MCPRequest): Promise<MCPResponse>;
  close(): void;
}

// HTTP 传输
class HttpTransport implements MCPTransport {
  private baseUrl: string;

  constructor(url: string);

  send(request: MCPRequest): Promise<MCPResponse>;
  close(): void {}
}
```

---

## 3. 详细设计

### 3.1 数据结构

```typescript
// MCP 服务器配置
interface MCPServerConfig {
  type: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxRetries?: number;
}

// MCP 服务器能力
interface MCPServerCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: MCPCapabilityLogging;
}

interface MCPCapabilityLogging {
  level?: 'debug' | 'info' | 'warn' | 'error';
}

// MCP 工具
interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema7;
}

// MCP 工具调用
interface MCPToolCall {
  name: string;
  arguments: Record<string, any>;
}

// MCP 工具结果
interface MCPToolResult {
  content: MCPToolContent[];
  isError?: boolean;
}

interface MCPToolContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

// MCP 资源
interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// MCP 资源内容
interface MCPResourceContent {
  uri: string;
  contents: MCPResourceItem[];
}

interface MCPResourceItem {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

// MCP 请求
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

// MCP 响应
interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: MCPError;
}

// MCP 错误
interface MCPError {
  code: number;
  message: string;
  data?: any;
}

// MCP 通知
interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}
```

### 3.2 STDIO 传输实现

```typescript
class StdioTransport implements MCPTransport {
  private process: ChildProcess | null = null;
  private messageQueue: Map<string, (response: MCPResponse) => void> = new Map();
  private nextId: number = 1;

  constructor(private config: MCPServerConfig) {}

  /**
   * 启动子进程
   */
  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const { command, args = [], env = {} } = this.config;
    if (!command) {
      throw new Error('Command is required for stdio transport');
    }

    // 启动子进程
    this.process = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 监听 stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleResponse(data.toString());
    });

    // 监听 stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      LoggerManager.getInstance()
        .getLogger('mcp:stdio')
        .warn(`Stderr: ${data}`);
    });

    // 监听进程退出
    this.process.on('exit', (code, signal) => {
      LoggerManager.getInstance()
        .getLogger('mcp:stdio')
        .warn(`Process exited: ${code} (${signal})`);
    });
  }

  /**
   * 发送请求
   */
  async send(request: MCPRequest): Promise<MCPResponse> {
    await this.start();

    const id = this.nextId++;
    request.id = id;

    return new Promise((resolve, reject) => {
      this.messageQueue.set(id.toString(), (response) => {
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response);
        }
      });

      // 设置超时
      const timeout = setTimeout(() => {
        this.messageQueue.delete(id.toString());
        reject(new Error('Request timeout'));
      }, this.config.timeout || 30000);

      // 发送到 stdin
      const json = JSON.stringify(request);
      this.process?.stdin?.write(json + '\n');

      // 清理超时
      request.id = id;
      this.messageQueue.get(id.toString())?.((_) => clearTimeout(timeout!));
    });
  }

  /**
   * 处理响应
   */
  private handleResponse(data: string): void {
    const lines = data.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const response: MCPResponse = JSON.parse(line);
        const handler = this.messageQueue.get(response.id.toString());
        if (handler) {
          handler(response);
          this.messageQueue.delete(response.id.toString());
        }
      } catch (error) {
        LoggerManager.getInstance()
          .getLogger('mcp:stdio')
          .error('Failed to parse response', error);
      }
    }
  }

  /**
   * 关闭
   */
  close(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.messageQueue.clear();
  }
}
```

### 3.3 HTTP 传输实现

```typescript
class HttpTransport implements MCPTransport {
  private baseUrl: string;
  private fetch: typeof fetch;

  constructor(url: string, fetchImpl: typeof fetch = global.fetch) {
    this.baseUrl = url;
    this.fetch = fetchImpl;
  }

  /**
   * 发送请求
   */
  async send(request: MCPRequest): Promise<MCPResponse> {
    const response = await this.fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    return data as MCPResponse;
  }

  /**
   * 关闭
   */
  close(): void {
    // HTTP 是无状态的，无需关闭
  }
}
```

### 3.4 MCP 客户端实现

```typescript
class MCPClient {
  private name: string;
  private transport: MCPTransport;
  private capabilities: MCPServerCapabilities | null = null;
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private initialized: boolean = false;

  constructor(
    name: string,
    private config: MCPServerConfig,
    private logger: Logger
  ) {
    this.name = name;
    this.transport = this.createTransport();
  }

  /**
   * 创建传输
   */
  private createTransport(): MCPTransport {
    switch (this.config.type) {
      case 'stdio':
        return new StdioTransport(this.config);
      case 'http':
      case 'sse':
        return new HttpTransport(this.config.url!);
      default:
        throw new Error(`Unknown transport type: ${this.config.type}`);
    }
  }

  /**
   * 连接
   */
  async connect(): Promise<void> {
    this.logger.info(`Connecting to MCP server: ${this.name}`);

    // 初始化握手
    const response = await this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: {
            listChanged: true,
          },
          sampling: {},
        },
        clientInfo: {
          name: 'friclaw',
          version: '1.0.0',
        },
      },
    });

    if (response.error) {
      throw new Error(`Failed to initialize: ${response.error.message}`);
    }

    this.capabilities = response.result.capabilities;

    // 列出工具
    if (this.capabilities.tools) {
      const toolsResponse = await this.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      for (const tool of toolsResponse.result.tools) {
        this.tools.set(tool.name, tool);
      }
      this.logger.info(`Loaded ${this.tools.size} tools`);
    }

    // 列出资源
    if (this.capabilities.resources) {
      const resourcesResponse = await this.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/list',
      });
      for (const resource of resourcesResponse.result.resources) {
        this.resources.set(resource.uri, resource);
      }
      this.logger.info(`Loaded ${this.resources.size} resources`);
    }

    // 通知初始化完成
    await this.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    this.initialized = true;
  }

  /**
   * 断开
   */
  async disconnect(): Promise<void> {
    this.logger.info(`Disconnecting from MCP server: ${this.name}`);
    this.transport.close();
    this.initialized = false;
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: any): Promise<MCPToolResult> {
    if (!this.initialized) {
      throw new Error('Not connected');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    this.logger.debug(`Calling tool: ${name}`, args);

    const response = await this.send({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    });

    if (response.error) {
      throw new Error(`Tool error: ${response.error.message}`);
    }

    return response.result as MCPToolResult;
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<MCPResourceContent> {
    if (!this.initialized) {
      throw new Error('Not connected');
    }

    const resource = this.resources.get(uri);
    if (!resource) {
      throw new Error(`Resource not found: ${uri}`);
    }

    this.logger.debug(`Reading resource: ${uri}`);

    const response = await this.send({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'resources/read',
      params: {
        uri,
      },
    });

    if (response.error) {
      throw new Error(`Resource error: ${response.error.message}`);
    }

    return response.result as MCPResourceContent;
  }

  /**
   * 获取能力
   */
  getCapabilities(): MCPServerCapabilities | null {
    return this.capabilities;
  }

  /**
   * 列出工具
   */
  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 列出资源
   */
  listResources(): MCPResource[] {
    return Array.from(this.resources.values());
  }

  /**
   * 发送请求
   */
  private async send(request: MCPRequest): Promise<MCPResponse> {
    return await this.transport.send(request);
  }
}
```

---

## 4. 内置 MCP 服务器

### 4.1 Memory MCP 服务器

```typescript
class MemoryMCPServer extends MCPServer {
  name = 'friclaw-memory';
  version = '1.0.0';

  constructor(private memory: MemoryManager) {
    super();
  }

  listTools(): MCPTool[] {
    return [
      {
        name: 'memory_list',
        description: '列出所有存储的记忆条目',
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
      {
        name: 'memory_read',
        description: '读取特定的记忆条目',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
      },
      {
        name: 'memory_search',
        description: '搜索记忆条目',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            category: {
              type: 'string',
              enum: ['identity', 'knowledge', 'episode'],
            },
            limit: { type: 'number', default: 5 },
          },
          required: ['query'],
        },
      },
    ];
  }

  async callTool(name: string, args: any): Promise<MCPToolResult> {
    switch (name) {
      case 'memory_list':
        return this.listMemories(args.category);
      case 'memory_read':
        return this.readMemory(args.id);
      case 'memory_search':
        return this.searchMemories(args.query, args.category, args.limit);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async listMemories(category?: string): Promise<MCPToolResult> {
    const memories = await this.memory.list(category as MemoryCategory);
    const content = JSON.stringify(memories, null, 2);
    return {
      content: [{ type: 'text', text: content }],
    };
  }

  private async readMemory(id: string): Promise<MCPToolResult> {
    const memory = await this.memory.getMemory(id);
    if (!memory) {
      throw new Error(`Memory not found: ${id}`);
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(memory, null, 2) }],
    };
  }

  private async searchMemories(
    query: string,
    category?: string,
    limit = 5
  ): Promise<MCPToolResult> {
    const memories = await this.memory.search(query, {
      category: category as MemoryCategory,
      limit,
    });
    const content = JSON.stringify(memories, null, 2);
    return {
      content: [{ type: 'text', text: content }],
    };
  }

  listResources(): MCPResource[] {
    return [
      {
        uri: 'memory://identity',
        name: 'Identity',
        description: 'AI 身份定义',
        mimeType: 'text/markdown',
      },
      {
        uri: 'memory://knowledge',
        name: 'Knowledge',
        description: '用户知识库',
        mimeType: 'application/json',
      },
    ];
  }

  async readResource(uri: string): Promise<MCPResourceContent> {
    switch (uri) {
      case 'memory://identity':
        return {
          uri,
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: this.memory.getIdentity(),
            },
          ],
        };
      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }
}
```

### 4.2 Cron MCP 服务器

```typescript
class CronMCPServer extends MCPServer {
  name = 'friclaw-cron';
  version = '1.0.0';

  constructor(private cronManager: CronManager) {
    super();
  }

  listTools(): MCPTool[] {
    return [
      {
        name: 'cron_create',
        description: '创建定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            runAt: { type: 'string', format: 'date-time' },
            cronExpr: { type: 'string' },
            label: { type: 'string' },
          },
          required: ['message'],
        },
      },
      {
        name: 'cron_list',
        description: '列出所有定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            includeDisabled: { type: 'boolean', default: false },
          },
        },
      },
      {
        name: 'cron_update',
        description: '更新定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            enabled: { type: 'boolean' },
            message: { type: 'string' },
          },
          required: ['jobId'],
        },
      },
      {
        name: 'cron_delete',
        description: '删除定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
          },
          required: ['jobId'],
        },
      },
    ];
  }

  async callTool(name: string, args: any): Promise<MCPToolResult> {
    switch (name) {
      case 'cron_create':
        return this.createJob(args);
      case 'cron_list':
        return this.listJobs(args.includeDisabled);
      case 'cron_update':
        return this.updateJob(args.jobId, args);
      case 'cron_delete':
        return this.deleteJob(args.jobId);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ... 具体实现方法
}
```

---

## 5. 接口规范

### 5.1 公共 API

```typescript
interface IMCPClientManager {
  /**
   * 初始化所有 MCP 客户端
   */
  initialize(config: MCPServersConfig): Promise<void>;

  /**
   * 连接到指定的 MCP 服务器
   */
  connect(name: string): Promise<void>;

  /**
   * 断开连接
   */
  disconnect(name: string): Promise<void>;

  /**
   * 列出所有可用工具
   */
  listTools(): MCPTool[];

  /**
   * 调用工具
   */
  callTool(name: string, args: any): Promise<MCPToolResult>;

  /**
   * 列出所有可用资源
   */
  listResources(): MCPResource[];

  /**
   * 读取资源
   */
  readResource(uri: string): Promise<MCPResourceContent>;

  /**
   * 关闭所有连接
   */
  close(): Promise<void>;
}

interface IMCPServerManager {
  /**
   * 注册 MCP 服务器
   */
  register(name: string, server: MCPServer): void;

  /**
   * 注销 MCP 服务器
   */
  unregister(name: string): void;

  /**
   * 启动所有服务器
   */
  start(): Promise<void>;

  /**
   * 停止所有服务器
   */
  stop(): Promise<void>;

  /**
   * 列出已注册的服务器
   */
  list(): MCPServer[];
}
```

---

## 6. 测试策略

### 6.1 单元测试范围

```typescript
describe('StdioTransport', () => {
  describe('send()', () => {
    it('should send request and receive response');
    it('should handle timeout');
    it('should handle process exit');
  });

  describe('start()', () => {
    it('should spawn child process');
    it('should use custom env variables');
    it('should handle spawn error');
  });
});

describe('MCPClient', () => {
  describe('connect()', () => {
    it('should initialize handshake');
    it('should load tools');
    it('should load resources');
    it('should send initialized notification');
  });

  describe('callTool()', () => {
    it('should call tool and return result');
    it('should throw for unknown tool');
    it('should throw for tool error');
  });

  describe('readResource()', () => {
    it('should read resource and return content');
    it('should throw for unknown resource');
  });
});

describe('MCPClientManager', () => {
  describe('initialize()', () => {
    it('should connect to all configured servers');
    it('should handle connection errors');
  });

  describe('callTool()', () => {
    it('should route to correct client');
    it('should aggregate tools from all clients');
  });
});
```

### 6.2 集成测试场景

1. 完整的 MCP 服务器生命周期
2. 跨进程的 STDIO 通信
3. 工具调用的完整流程
4. 资源读取的完整流程

### 6.3 性能测试指标

- 工具调用延迟: < 100ms (STDIO), < 50ms (HTTP)
- 工具发现时间: < 500ms
- 并发连接数: 10+ 服务器

---

## 7. 依赖关系

### 7.1 外部依赖

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.16.0"
  }
}
```

### 7.2 内部模块依赖

```
MCP 框架
    ↑
    ├──> 配置系统（获取配置）
    ├──> 日志系统（输出日志）
    └──> 内存系统（作为 MCP 服务）
```

### 7.3 启动顺序

```
1. 配置系统
2. 日志系统
3. 内存系统
4. MCP 框架 ← 第四个启动
5. 其他模块...
```

---

## 8. 配置项

### 8.1 MCP 服务器配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 传输类型：stdio/sse/http |
| `command` | string | 否 (stdio 时必填) | 可执行文件路径 |
| `args` | string[] | 否 | 命令行参数 |
| `url` | string | 否 (http/sse 时必填) | 服务器 URL |
| `env` | object | 否 | 环境变量 |
| `timeout` | number | 否 | 请求超时（毫秒），默认 30000 |
| `maxRetries` | number | 否 | 最大重试次数，默认 3 |

### 8.2 配置示例

```json
{
  "mcpServers": {
    "memory": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "dist/mcp/memory-server.js"]
    },
    "filesystem": {
      "type": "stdio",
      "command": "mcp-server-filesystem",
      "args": ["/path/to/allowed/directory"]
    },
    "remote-server": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "timeout": 5000
    }
  }
}
```

---

## 9. 监控和日志

### 9.1 关键指标

- MCP 服务器连接数
- 工具调用次数/成功率
- 平均工具调用延迟
- 资源访问次数

### 9.2 日志级别

| 级别 | 用途 |
|------|------|
| `debug` | 工具调用详情 |
| `info` | 连接/断开事件 |
| `warn` | 重试、超时 |
| `error` | 连接失败、工具错误 |

---

## 10. 安全考虑

### 10.1 工具调用权限

```typescript
/**
 * 工具权限配置
 */
interface ToolPermissions {
  allow: string[];      // 允许的工具名（支持通配符）
  deny: string[];       // 禁止的工具名（支持通配符）
  maxExecTime: number;  // 最大执行时间（秒）
}

/**
 * 检查工具是否允许调用
 */
function checkToolPermission(
  toolName: string,
  permissions: ToolPermissions
): boolean {
  // 检查禁止列表
  for (const pattern of permissions.deny) {
    if (matchesPattern(toolName, pattern)) {
      return false;
    }
  }

  // 检查允许列表
  if (permissions.allow.length > 0) {
    for (const pattern of permissions.allow) {
      if (matchesPattern(toolName, pattern)) {
        return true;
      }
    }
    return false;
  }

  return true;
}

/**
 * 匹配通配符模式
 */
function matchesPattern(text: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(text);
}
```

### 10.2 资源访问控制

```typescript
/**
 * 资源 URI 白名单
 */
const ALLOWED_RESOURCE_PATTERNS = [
  'memory://*',
  'config://*',
];

/**
 * 检查资源是否可访问
 */
function checkResourceAccess(uri: string): boolean {
  for (const pattern of ALLOWED_RESOURCE_PATTERNS) {
    if (matchesPattern(uri, pattern)) {
      return true;
    }
  }
  return false;
}
```

### 10.3 STDIO 进程安全

```typescript
/**
 * 验证可执行文件路径
 */
function validateExecutablePath(path: string): void {
  // 防止路径遍历
  const resolved = path.resolve(path);
  if (!resolved.startsWith('/usr/bin') &&
      !resolved.startsWith('/usr/local/bin') &&
      !resolved.startsWith(process.cwd())) {
    throw new Error(`Invalid executable path: ${path}`);
  }

  // 检查文件是否存在且可执行
  try {
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) {
      throw new Error('Not a file');
    }
    if (!(stats.mode & 0o111)) {
      throw new Error('Not executable');
    }
  } catch (error) {
    throw new Error(`Cannot execute ${path}: ${error}`);
  }
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
