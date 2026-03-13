# FriClaw Agent 层模块设计

> 基于 NeoClaw Agent 架构，为 FriClaw 设计的详细 AI Agent 模块文档
>
> **版本**: 1.0.0
> **参考**: NeoClaw Agent Implementation
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 模块概述](#1-模块概述)
- [2. 核心接口设计](#2-核心接口设计)
- [3. Claude Code Agent](#3-claude-code-agent)
- [4. GLM Agent（新增）](#4-glm-agent新增)
- [5. 工具调用系统](#5-工具调用系统)
- [6. 流式响应](#6-流式响应)
- [7. 上下文管理](#7-上下文管理)
- [8. 文件访问控制](#8-文件访问控制)

---

## 1. 模块概述

### 1.1 设计目标

Agent 层是 FriClaw 的 AI 核心引擎，负责：

- **模型适配**: 支持多种 LLM（Claude, GLM, GPT 等）
- **工具调用**: 暴露 MCP 工具给 Agent 使用
- **流式输出**: 实时返回生成的内容
- **上下文管理**: 维护多轮对话的上下文
- **会话隔离**: 每个会话独立的对话上下文

### 1.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   FriClaw Agent 层架构                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Claude Code  │  │  GLM Agent   │  │  GPT Agent   │      │
│  │  Agent      │  │  (新增)     │  │  (预留)     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                    │                     │                │
│         └─────────┬──────────┘                                 │
│                   ▼                                            │
│         ┌──────────────────┐                                    │
│         │ Agent Interface  │                                    │
│         │    (抽象层)     │                                    │
│         └────────┬─────────┘                                    │
│                  │                                             │
│         ┌────────┴────────┐                                    │
│         ▼                 ▼                                   │
│  ┌─────────────┐   ┌─────────────┐                           │
│  │  Tool Call   │   │   Context    │                           │
│  │  Manager     │   │   Manager    │                           │
│  └──────┬──────┘   └──────┬──────┘                           │
│         │                  │                                   │
│         ▼                  ▼                                   │
│  ┌──────────────────────────┐                                 │
│  │    MCP Servers           │                                 │
│  │  - Memory              │                                 │
│  │  - Workspace           │                                 │
│  │  - Cron               │                                 │
│  └──────────────────────────┘                                 │
│                                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心接口设计

### 2.1 Agent 接口

```typescript
/**
 * Agent — AI 后端接口
 *
 * 一个 Agent 是一个处理消息并返回响应的 AI 后端
 */
export interface Agent {
  /**
   * 此 Agent 类型的短标识符（如 "claude_code"）
   * 用于注册和日志记录
   */
  readonly kind: string;

  /**
   * 处理消息并返回完整响应
   */
  run(request: RunRequest): Promise<RunResponse>;

  /**
   * 渐进式流式响应，产生增量事件
   *
   * 实现应产生 thinking_delta 和 text_delta 事件，
   * 后跟一个包含完整 RunResponse 的 done 事件
   */
  stream?(request: RunRequest): AsyncGenerator<AgentStreamEvent>;

  /**
   * 如果 agent 二进制/服务可达，返回 true
   */
  healthCheck(): Promise<boolean>;

  /**
   * 清除指定 conversationId 的对话上下文
   */
  clearConversation(conversationId: string): Promise<void>;

  /**
   * 关闭此 Agent 管理的所有后台进程
   */
  dispose(): Promise<void>;
}
```

### 2.2 RunRequest 类型

```typescript
/**
 * RunRequest — Agent 运行请求
 */
export interface RunRequest {
  /** 用户消息文本 */
  text: string;

  /**
   * 对话的稳定标识符（如 chatId 或 chatId_thread_threadId）
   * 用于路由消息到 Agent 池中的正确进程
   */
  conversationId: string;

  /** 源自入站消息的聊天室 ID */
  chatId: string;

  /** 源自入站消息的网关类型 */
  gatewayKind: string;

  /** 来自源消息的二进制附件（图片、文件等） */
  attachments?: Attachment[];

  /** 从通道传递的不透明元数据 */
  extra?: Record<string, unknown>;
}

/**
 * Attachment — 二进制附件
 */
export interface Attachment {
  /** 原始二进制内容 */
  buffer: Buffer;

  /**
   * 从源平台推断的媒体类别
   * （如 'image', 'file', 'audio', 'video', 'sticker'）
   */
  mediaType: string;

  /** 原始文件名（如果可用） */
  fileName?: string;
}
```

### 2.3 RunResponse 类型

```typescript
/**
 * RunResponse — Agent 响应
 */
export interface RunResponse {
  /** 响应文本 */
  text: string;

  /** 思考内容（可选） */
  thinking?: string | null;

  /** 会话 ID（可选） */
  sessionId?: string | null;

  /** 成本（美元） */
  costUsd?: number | null;

  /** 输入 token 数 */
  inputTokens?: number | null;

  /** 输出 token 数 */
  outputTokens?: number | null;

  /** 经过时间（毫秒） */
  elapsedMs?: number | null;

  /** 使用的模型 */
  model?: string | null;
}
```

### 2.4 AgentStreamEvent 类型

```typescript
/**
 * AskQuestion — Claude Code 的 AskUserQuestion 工具的单个问题项
 */
export type AskQuestion = {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

/**
 * AgentStreamEvent — Agent.stream() 期间发出的增量事件
 */
export type AgentStreamEvent =
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'text_delta'; text: string }
  /**
   * 当 Claude Code 使用 AskUserQuestion 且网关应渲染交互表单时发出
   */
  | { type: 'ask_questions'; questions: AskQuestion[]; conversationId: string }
  | { type: 'done'; response: RunResponse };
```

---

## 3. Claude Code Agent

### 3.1 配置接口

```typescript
/**
 * ClaudeCodeAgentConfig — Claude Code Agent 配置
 */
export interface ClaudeCodeAgentConfig {
  /** 模型名称（如 'claude-opus-4-6', 'sonnet'） */
  model?: string;

  /** 系统提示（可选，附加到默认提示） */
  systemPrompt?: string;

  /** 允许的工具列表（空 = 所有工具） */
  allowedTools?: string[];

  /** Agent 工作目录 */
  cwd: string;

  /** MCP 服务器配置 */
  mcpServers?: Record<string, MCPServerConfig>;

  /** 技能目录 */
  skillsDir?: string;

  /** 超时时间（秒） */
  timeoutSecs?: number;
}
```

### 3.2 类设计

```typescript
/**
 * ClaudeCodeAgent — Claude Code Agent 实现
 *
 * 使用 Claude Code CLI 作为后端，通过 MCP 暴露工具
 */
export class ClaudeCodeAgent implements Agent {
  readonly kind = 'claude_code';

  private _config: ClaudeCodeAgentConfig;
  private _mcpClients: Map<string, MCPClient> = new Map();
  private _healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ClaudeCodeAgentConfig) {
    this._config = {
      model: config.model || 'sonnet',
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools || [],
      cwd: config.cwd,
      mcpServers: config.mcpServers || {},
      skillsDir: config.skillsDir,
      timeoutSecs: config.timeoutSecs || 600,
    };
  }

  async run(request: RunRequest): Promise<RunResponse> {
    // 使用 Claude Code CLI 处理请求
    // 返回完整响应
  }

  stream?(request: RunRequest): AsyncGenerator<AgentStreamEvent> {
    // 使用 Claude Code CLI 流式处理请求
    // 产生增量事件
  }

  async healthCheck(): Promise<boolean> {
    // 检查 Claude Code CLI 是否可用
  }

  async clearConversation(conversationId: string): Promise<void> {
    // 清除指定会话的上下文
  }

  async dispose(): Promise<void> {
    // 停止所有 MCP 客户端
  }
}
```

### 3.3 MCP 客户端管理

```typescript
class ClaudeCodeAgent {
  /**
   * 初始化 MCP 客户端
   */
  private async _initMCP(): Promise<void> {
    const { MCPClient } = await import('@modelcontextprotocol/sdk');

    for (const [name, config] of Object.entries(this._config.mcpServers)) {
      let client: MCPClient;

      switch (config.type) {
        case 'stdio':
          client = new MCPClient({
            name,
            transport: {
              type: 'stdio',
              command: config.command,
              args: config.args,
              env: config.env,
            },
          });
          break;

        case 'http':
          client = new MCPClient({
            name,
            transport: {
              type: 'http',
              url: config.url!,
              headers: config.headers,
            },
          });
          break;

        case 'sse':
          client = new MCPClient({
            name,
            transport: {
              type: 'sse',
              url: config.url!,
            },
          });
          break;
      }

      this._mcpClients.set(name, client);
    }
  }

  /**
   * 获取所有可用的工具
   */
  private async _getAvailableTools(): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];

    for (const client of this._mcpClients.values()) {
      const clientTools = await client.listTools();
      tools.push(...clientTools);
    }

    return tools;
  }
}
```

---

## 4. GLM Agent（新增）

### 4.1 配置接口

```typescript
/**
 * GLMAgentConfig — GLM Agent 配置
 */
export interface GLMAgentConfig {
  /** 模型名称（如 'glm-4.7', 'glm-4.6'） */
  model?: string;

  /** API Key */
  apiKey: string;

  /** API 端点 URL */
  apiEndpoint?: string;

  /** 系统提示（可选） */
  systemPrompt?: string;

  /** 允许的工具列表 */
  allowedTools?: string[];

  /** 超时时间（秒） */
  timeoutSecs?: number;

  /** 最大 tokens */
  maxTokens?: number;

  /** 温度 */
  temperature?: number;
}
```

### 4.2 类设计

```typescript
/**
 * GLMAgent — 智谱 GLM Agent 实现
 *
 * 直接调用智谱 API，支持流式输出
 */
export class GLMAgent implements Agent {
  readonly kind = 'glm';

  private _config: GLMAgentConfig;
  private _httpClient: HttpClient;

  constructor(config: GLMAgentConfig) {
    this._config = {
      model: config.model || 'glm-4.7',
      apiKey: config.apiKey,
      apiEndpoint: config.apiEndpoint || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      systemPrompt: config.systemPrompt,
      allowedTools: config.allowedTools || [],
      timeoutSecs: config.timeoutSecs || 600,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature || 0.7,
    };
    this._httpClient = new HttpClient();
  }

  async run(request: RunRequest): Promise<RunResponse> {
    const startTime = Date.now();

    const response = await this._httpClient.post(this._config.apiEndpoint, {
      model: this._config.model,
      messages: this._buildMessages(request),
      stream: false,
    });

    const elapsedMs = Date.now() - startTime;

    return {
      text: response.choices[0].message.content,
      model: this._config.model,
      elapsedMs,
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    };
  }

  async *stream(request: RunRequest): AsyncGenerator<AgentStreamEvent> {
    const response = await this._httpClient.post(
      this._config.apiEndpoint,
      {
        model: this._config.model,
        messages: this._buildMessages(request),
        stream: true,
      },
      { responseType: 'stream' }
    );

    let thinkingContent = '';

    for await (const chunk of response) {
      const delta = JSON.parse(chunk);
      const content = delta.choices[0].delta.content;

      if (content) {
        yield { type: 'text_delta', text: content };
      }
    }

    yield {
      type: 'done',
      response: {
        text: '',  // 由增量文本组合
        model: this._config.model,
      },
    };
  }

  private _buildMessages(request: RunRequest): Array<{ role: string; content: string }> {
    // 构建消息历史
    return [
      { role: 'system', content: this._config.systemPrompt || 'You are a helpful assistant.' },
      { role: 'user', content: request.text },
    ];
  }
}
```

---

## 5. 工具调用系统

### 5.1 MCP 工具定义

```typescript
/**
 * MCPTool — MCP 工具定义
 */
export interface MCPTool {
  /** 工具名称 */
  name: string;

  /** 工具描述 */
  description: string;

  /** JSON Schema 定义输入 */
  inputSchema: JSONSchema;

  /** 输出是否可能较长 */
  slow?: boolean;
}

/**
 * MCPResource — MCP 资源定义
 */
export interface MCPResource {
  /** 资源 URI */
  uri: string;

  /** 资源名称 */
  name: string;

  /** 资源描述 */
  description: string;

  /** MIME 类型 */
  mimeType?: string;

  /** 获取资源内容 */
  get: () => Promise<ResourceContent>;
}

/**
 * ResourceContent — 资源内容
 */
export interface ResourceContent {
  /** URI */
  uri: string;

  /** 内容 */
  content: string | Uint8Array;

  /** MIME 类型 */
  mimeType?: string;
}
```

### 5.2 内置工具

| 工具名 | 功能 | 类别 |
|--------|------|------|
| `memory_read` | 读取记忆 | 内存 |
| `memory_search` | 搜索记忆 | 内存 |
| `memory_save` | 保存记忆 | 内存 |
| `memory_list` | 列出记忆 | 内存 |
| `cron_create` | 创建定时任务 | 调度 |
| `cron_list` | 列出定时任务 | 调度 |
| `cron_delete` | 删除定时任务 | 调度 |
| `cron_update` | 更新定时任务 | 调度 |

### 5.3 工具调用流程

```
┌─────────────────────────────────────────────────────────────┐
│              工具调用流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────┐                                          │
│  │  Agent    │                                          │
│  │  Decide   │                                          │
│  └────┬────┘                                          │
│       │                                                │
│       ▼                                                │
│  ┌──────────────────────────┐                               │
│  │  Need Tool?         │                               │
│  └──────┬───────────────┘                               │
│         │                                              │
│   ┌─────┴─────┐                                       │
│   ▼             ▼                                       │
│  ┌─────────┐   ┌─────────┐                              │
│  │  Yes     │   │  No      │                              │
│  └────┬────┘   └────┬────┘                              │
│       │              │                                     │
│       ▼              ▼                                     │
│  ┌─────────┐   ┌──────────────────┐                        │
│  │  Tool    │   │  Generate       │                        │
│  │  Call    │   │  Response       │                        │
│  └────┬────┘   └────────┬─────────┘                        │
│       │                │                                  │
│       ▼                ▼                                  │
│  ┌──────────────────────────┐                               │
│  │  MCP Client        │                               │
│  │  Execute Tool     │                               │
│  └────────┬───────────┘                               │
│          │                                            │
│          ▼                                            │
│  ┌──────────────────────────┐                               │
│  │  Tool Result      │                               │
│  │  Return to Agent  │                               │
│  └────────┬───────────┘                               │
│          │                                            │
│          ▼                                            │
│  ┌──────────────────────────┐                               │
│  │  Agent Continue   │                               │
│  │  Generate Final   │                               │
│  └────────┬───────────┘                               │
│          │                                            │
│          ▼                                            │
│     Return Response                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 流式响应

### 6.1 流式事件类型

| 事件类型 | 触发时机 | 数据 |
|---------|---------|------|
| `thinking_delta` | 思考增量 | 文本片段 |
| `tool_use` | 工具调用 | 工具名称、输入 |
| `text_delta` | 响应增量 | 文本片段 |
| `ask_questions` | 需要用户输入 | 问题列表 |
| `done` | 完成 | 完整响应 |

### 6.2 流式处理模式

```typescript
/**
 * StreamProcessor — 流式处理器
 *
 * 处理来自 Agent 的流式事件，产生标准化输出
 */
export class StreamProcessor {
  private _accumulatedText = '';
  private _accumulatedThinking = '';
  private _currentTool: ToolCall | null = null;

  /**
   * 处理流式事件
   */
  *process(events: Iterable<AgentStreamEvent>): Generator<ProcessedEvent> {
    for (const event of events) {
      switch (event.type) {
        case 'thinking_delta':
          this._accumulatedThinking += event.text;
          yield {
            type: 'thinking',
            content: this._accumulatedThinking,
          };
          break;

        case 'tool_use':
          if (this._currentTool) {
            yield {
              type: 'tool_complete',
              tool: this._currentTool,
            };
          }
          this._currentTool = {
            name: event.name,
            input: event.input,
            startTime: Date.now(),
          };
          yield {
            type: 'tool_start',
            tool: this._currentTool,
          };
          break;

        case 'text_delta':
          if (this._currentTool) {
            yield {
              type: 'tool_complete',
              tool: this._currentTool,
            };
            this._currentTool = null;
          }
          this._accumulatedText += event.text;
          yield {
            type: 'text',
            content: this._accumulatedText,
          };
          break;

        case 'ask_questions':
          yield {
            type: 'questions',
            questions: event.questions,
            conversationId: event.conversationId,
          };
          break;

        case 'done':
          if (this._currentTool) {
            yield {
              type: 'tool_complete',
              tool: this._currentTool,
            };
            this._currentTool = null;
          }
          yield {
            type: 'done',
            response: event.response,
          };
          break;
      }
    }
  }
}

interface ProcessedEvent {
  type: 'thinking' | 'text' | 'tool_start' | 'tool_complete' | 'questions' | 'done';
  content?: string;
  tool?: ToolCall;
  questions?: AskQuestion[];
  conversationId?: string;
  response?: RunResponse;
}
```

---

## 7. 上下文管理

### 7.1 上下文存储

```typescript
/**
 * ContextManager — 对话上下文管理器
 *
 * 维护每个会话的对话历史和上下文
 */
export class ContextManager {
  private _contexts = new Map<string, ConversationContext>();

  /**
   * 获取会话上下文
   */
  getContext(conversationId: string): ConversationContext {
    let ctx = this._contexts.get(conversationId);

    if (!ctx) {
      ctx = {
        conversationId,
        messages: [],
        metadata: {},
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      this._contexts.set(conversationId, ctx);
    }

    ctx.lastAccessedAt = Date.now();
    return ctx;
  }

  /**
   * 添加消息到上下文
   */
  addMessage(conversationId: string, message: ChatMessage): void {
    const ctx = this.getContext(conversationId);
    ctx.messages.push(message);

    // 限制上下文大小
    const MAX_MESSAGES = 100;
    if (ctx.messages.length > MAX_MESSAGES) {
      ctx.messages = ctx.messages.slice(-MAX_MESSAGES);
    }
  }

  /**
   * 清除会话上下文
   */
  clearContext(conversationId: string): void {
    this._contexts.delete(conversationId);
  }

  /**
   * 获取所有活跃会话
   */
  getActiveConversations(): Array<ConversationContext> {
    const now = Date.now();
    const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    return [...this._contexts.values()].filter(
      ctx => now - ctx.lastAccessedAt < SESSION_TIMEOUT
    );
  }
}

interface ConversationContext {
  conversationId: string;
  messages: ChatMessage[];
  metadata: Record<string, unknown>;
  createdAt: number;
  lastAccessedAt: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
```

### 7.2 Token 预算

```typescript
/**
 * TokenEstimator — Token 估算器
 *
 * 估算文本的 token 数量，用于上下文管理
 */
export class TokenEstimator {
  private static readonly TOKENS_PER_WORD = 1.3;
  private static readonly TOKENS_PER_CHAR = 0.25;

  /**
   * 估算文本的 token 数量
   */
  static estimate(text: string): number {
    if (!text) return 0;

    // 按词估算
    const words = text.split(/\s+/).filter(Boolean).length;
    const byWords = words * this.TOKENS_PER_WORD;

    // 按字符估算
    const byChars = text.length * this.TOKENS_PER_CHAR;

    // 取较大值（保守估计）
    return Math.ceil(Math.max(byWords, byChars));
  }

  /**
   * 估算消息列表的 token 数量
   */
  static estimateMessages(messages: ChatMessage[]): number {
    let total = 0;

    for (const msg of messages) {
      total += this.estimate(msg.content);
      total += 10; // 元数据开销
    }

    return total;
  }
}
```

---

## 8. 文件访问控制

### 8.1 黑名单实现

```typescript
/**
 * FileBlockedAgent — 文件访问受限的 Agent 包装器
 *
 * 阻止 Agent 访问敏感文件和目录
 */
export function createFileBlockedAgent(
  agent: Agent,
  blacklist: string[],
  workspacesDir: string
): Agent {
  return new FileBlockedAgent(agent, blacklist, workspacesDir);
}

class FileBlockedAgent implements Agent {
  readonly kind = 'claude_code_blocked';

  constructor(
    private _innerAgent: Agent,
    private _blacklist: string[],
    private _workspacesDir: string
  ) {}

  async run(request: RunRequest): Promise<RunResponse> {
    // 检查请求中是否包含敏感路径
    this._validatePaths(request.text);

    // 调用内部 Agent
    return this._innerAgent.run(request);
  }

  async *stream(request: RunRequest): AsyncGenerator<AgentStreamEvent> {
    // 检查请求中是否包含敏感路径
    this._validatePaths(request.text);

    yield* this._innerAgent.stream!(request);
  }

  private _validatePaths(text: string): void {
    for (const pattern of this._blacklist) {
      // 检查文本中是否提及黑名单路径
      if (text.includes(pattern)) {
        // 阻止访问
        throw new Error(
          `Access to "${pattern}" is not allowed. This path contains sensitive information.`
        );
      }
    }
  }
}
```

### 8.2 黑名单模式

| 模式 | 原因 |
|------|------|
| `~/.claude/**` | Claude Code 配置 |
| `~/.config/claude/**` | Claude 配置 |
| `/etc/shadow` | 系统密码文件 |
| `/etc/passwd` | 系统用户文件 |
| `**/.env` | 环境变量 |
| `**/credentials.json` | 凭证文件 |
| `**/secrets/**` | 密钥目录 |
| `~/.friclaw/config.json` | FriClaw 配置（保护黑名单本身） |

---

## 附录

### A. Agent 工厂

```typescript
/**
 * AgentFactory — Agent 工厂
 *
 * 根据配置创建合适的 Agent 实例
 */
export class AgentFactory {
  /**
   * 创建 Agent
   */
  static create(config: FriClawConfig): Agent {
    const agentType = config.agent.type;

    switch (agentType) {
      case 'claude_code':
        return new ClaudeCodeAgent({
          model: config.agent.model,
          systemPrompt: config.agent.systemPrompt,
          allowedTools: config.agent.allowedTools,
          cwd: config.workspacesDir,
          mcpServers: config.mcpServers,
          skillsDir: config.skillsDir,
          timeoutSecs: config.agent.timeoutSecs,
        });

      case 'glm':
        return new GLMAgent({
          model: config.agent.model,
          apiKey: process.env['GLM_API_KEY'] || '',
          systemPrompt: config.agent.systemPrompt,
          allowedTools: config.agent.allowedTools,
          timeoutSecs: config.agent.timeoutSecs,
        });

      default:
        throw new Error(`Unknown agent type: "${agentType}"`);
    }
  }
}
```

### B. 性能指标

```typescript
/**
 * AgentMetrics — Agent 性能指标
 */
export class AgentMetrics {
  private _requestCount = 0;
  private _totalLatency = 0;
  private _totalTokens = 0;
  private _totalCost = 0;

  recordRequest(response: RunResponse): void {
    this._requestCount++;

    if (response.elapsedMs) {
      this._totalLatency += response.elapsedMs;
    }

    if (response.inputTokens && response.outputTokens) {
      this._totalTokens += response.inputTokens + response.outputTokens;
    }

    if (response.costUsd) {
      this._totalCost += response.costUsd;
    }
  }

  getStats(): {
    requestCount: number;
    avgLatencyMs: number;
    totalTokens: number;
    totalCostUsd: number;
  } {
    return {
      requestCount: this._requestCount,
      avgLatencyMs: this._requestCount > 0
        ? this._totalLatency / this._requestCount
        : 0,
      totalTokens: this._totalTokens,
      totalCostUsd: this._totalCost,
    };
  }
}
```

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
