# 05. Agent 层模块

> FriClaw Agent 层详细实现文档
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13
> **状态**: 📋 待实现

---

## 1. 概述

### 1.1 模块职责

Agent 层是 FriClaw 的核心 AI 处理引擎，负责理解用户意图、调用工具、生成响应，并提供智能对话能力。

**核心功能**:
- 意图识别和处理
- 工具调用管理
- LLM 对话管理
- 上下文注入
- 响应生成
- 错误处理和重试

### 1.2 与其他模块的关系

```
Agent 层
    ↑
    ├──> 配置系统（获取配置）
    ├──> 日志系统（输出日志）
    ├──> 内存系统（获取上下文）
    └──> MCP 框架（调用工具）
    ↑
    ├──> 会话层（接收消息）
    └──> 工作空间（管理状态）
```

---

## 2. 架构设计

### 2.1 Agent 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent 层架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                           │
│  ┌───────────────┐                                       │
│  │   Agent 核心   │  ←─ 会话管理                          │
│  │   (LLM + Tools) │                                       │
│  └──────┬────────┘                                       │
│          │                                               │
│          ├─→ ┌───────────────┐                           │
│          │   │  工具调用管理   │                           │
│          │   │ ToolManager   │                           │
│          │   └──────┬────────┘                           │
│          │          │                                     │
│          │          ├─→ ┌───────────────┐                   │
│          │          │   │ MCP 客户端   │                   │
│          │          │   │ MCPClient    │                   │
│          │          │   └───────────────┘                   │
│          │          │                                     │
│          │          ├─→ ┌───────────────┐                   │
│          │          │   │ 上下文管理   │                   │
│          │          │   │ ContextMgr   │                   │
│          │          │   └───────────────┘                   │
│          │          │                                     │
│          │          ├─→ ┌───────────────┐                   │
│          │          │   │  响应生成器   │                   │
│          │          │   │ ResponseGen  │                   │
│          │          │   └───────────────┘                   │
│          │          │                                     │
│          │          ├─→ ┌───────────────┐                   │
│          │          │   │  错误处理     │                   │
│          │          │   │ ErrorHandler  │                   │
│          │          │   └───────────────┘                   │
│          │          │                                     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心接口

```typescript
// Agent 接口
interface IAgent {
  // 核心方法
  process(message: Message): Promise<Response>;
  think(context: ConversationContext): Promise<Thought>;
  execute(toolCall: ToolCall): Promise<ToolResult>;

  // 生命周期
  initialize(): Promise<void>;
  dispose(): Promise<void>;

  // 配置
  getCapabilities(): AgentCapabilities;
  updateConfig(config: AgentConfig): void;
}

// Agent 实现
class Agent implements IAgent {
  private config: AgentConfig;
  private model: ModelClient;
  private toolManager: ToolManager;
  private contextManager: ContextManager;
  private logger: Logger;

  constructor(
    config: AgentConfig,
    private memory: MemoryManager
  ) {
    this.config = config;
    this.model = ModelClientFactory.create(config);
    this.toolManager = new ToolManager(this);
    this.contextManager = new ContextManager(this.memory);
    this.logger = LoggerManager.getInstance().getLogger('agent');
  }

  /**
   * 处理消息
   */
  async process(message: Message): Promise<Response> {
    this.logger.info(`Processing message: ${message.id}`);

    try {
      // 1. 更新上下文
      await this.contextManager.addMessage(message);

      // 2. 意图识别
      const intent = await this.recognizeIntent(message);

      // 3. 生成思考
      const thought = await this.think(intent);

      // 4. 执行动作
      const result = await this.executeAction(thought);

      // 5. 生成响应
      const response = await this.generateResponse(result);

      // 6. 更新历史
      await this.contextManager.addResponse(response);

      return response;
    } catch (error) {
      this.logger.error('Failed to process message', error);
      return this.generateErrorResponse(error);
    }
  }

  /**
   * 识别意图
   */
  private async recognizeIntent(message: Message): Promise<Intent> {
    // 注入记忆上下文
    const context = await this.contextManager.getMemoryContext(message.content);

    // 构建 Prompt
    const prompt = `
${context}

请分析用户的消息，识别其意图。

用户消息：${message.content}

请返回 JSON 格式的意图分析：
{
  "intent": "inquiry|command|question|greeting|other",
  "entities": {
    "command": "命令名（如果有）",
    "args": "参数（如果有）"
  },
  "confidence": 0.0-1.0,
  "reason": "意图分析理由"
}
`;

    // 调用 LLM
    const result = await this.model.generate(prompt, {
      maxTokens: 500,
      temperature: 0.1,
    });

    // 解析意图
    const intentJson = JSON.parse(result.content);
    return {
      intent: intentJson.intent,
      entities: intentJson.entities,
      confidence: intentJson.confidence,
      reason: intentJson.reason,
    };
  }

  /**
   * 执行动作
   */
  private async executeAction(thought: Thought): Promise<ActionResult> {
    // 如果包含工具调用
    if (thought.actions && thought.actions.length > 0) {
      const results: ToolResult[] = [];

      for (const action of thought.actions) {
        const result = await this.execute(action);
        results.push(result);
      }

      return { type: 'tool_results', results };
    }

    // 纯文本回复
    return { type: 'response', content: thought.response };
  }

  /**
   * 生成响应
   */
  private async generateResponse(result: ActionResult): Promise<Response> {
    if (result.type === 'response') {
      return {
        id: this.generateId(),
        content: result.content,
        type: 'text',
      };
    }

    // 合并工具结果
    const toolResults = result.results.map(r => r.content).join('\n');
    const prompt = `
请根据以下工具结果，生成适当的回复：

工具结果：
${toolResults}

请以友好、专业的语气回复用户。
`;

    const result = await this.model.generate(prompt, {
      maxTokens: 500,
      temperature: 0.7,
    });

    return {
      id: this.generateId(),
      content: result.content,
      type: 'text',
    };
  }

  /**
   * 生成错误响应
   */
  private generateErrorResponse(error: any): Response {
    this.logger.error('Error occurred', error);

    let message = '抱歉，我遇到了一些问题。';
    if (error.message) {
      message = `错误：${error.message}`;
    }

    return {
      id: this.generateId(),
      content: message,
      type: 'text',
    };
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 工具调用管理器
class ToolManager {
  private logger: Logger;

  constructor(private agent: Agent) {
    this.logger = LoggerManager.getInstance().getLogger('agent:tools');
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // 获取 MCP 工具
      const tool = await this.findTool(toolCall.name);
      if (!tool) {
        throw new Error(`Tool not found: ${toolCall.name}`);
      }

      // 验证参数
      this.validateParameters(tool.schema, toolCall.arguments);

      // 调用工具
      const result = await agent.getMCPClients().callTool(
        toolCall.name,
        toolCall.arguments
      );

      this.logger.info(`Tool executed successfully`, {
        tool: toolCall.name,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.logger.error(`Tool execution failed`, {
        tool: toolCall.name,
        error,
      });

      return {
        content: `工具调用失败：${error.message}`,
        isError: true,
      };
    }
  }

  async listAvailableTools(): Promise<MCPTool[]> {
    const tools: MCPTool[] = [];

    // 从所有 MCP 客户端获取工具
    for (const client of agent.getMCPClients().all()) {
      tools.push(...client.listTools());
    }

    return tools;
  }

  private async findTool(name: string): Promise<MCPTool | null> {
    for (const client of agent.getMCPClients().all()) {
      const tool = client.listTools().find(t => t.name === name);
      if (tool) return tool;
    }
    return null;
  }

  private validateParameters(schema: JSONSchema7, params: any): void {
    // 使用 JSON Schema 验证
    // ...
  }
}

// 上下文管理器
class ContextManager {
  private logger: Logger;

  constructor(private memory: MemoryManager) {
    this.logger = LoggerManager.getInstance().getLogger('agent:context');
  }

  async addMessage(message: Message): Promise<void> {
    // 保存到会话历史
    // ...
  }

  async addResponse(response: Response): Promise<void> {
    // 保存助手回复
    // ...
  }

  async getMemoryContext(query: string): Promise<string> {
    // 从记忆系统获取相关上下文
    const identity = await this.memory.getIdentity();
    const knowledge = await this.memory.search(query, {
      category: MemoryCategory.KNOWLEDGE,
      limit: 3,
    });
    const episodes = await this.memory.search(query, {
      category: MemoryCategory.EPISODE,
      limit: 2,
    });

    // 构建上下文字符串
    const context: string[] = [];

    context.push('## AI Identity');
    context.push(identity);

    if (knowledge.length > 0) {
      context.push('\n## Relevant Knowledge');
      for (const mem of knowledge) {
        context.push(`### ${mem.title}`);
        context.push(mem.content);
      }
    }

    if (episodes.length > 0) {
      context.push('\n## Previous Context');
      for (const mem of episodes) {
        context.push(`### ${mem.title}`);
        context.push(mem.content);
      }
    }

    return context.join('\n');
  }
}

// 错误处理器
class ErrorHandler {
  private maxRetries = 3;
  private logger: Logger;

  constructor() {
    this.logger = LoggerManager.getInstance().getLogger('agent:error');
  }

  async handleError(error: any, context: string): Promise<ErrorResponse> {
    this.logger.error('Error occurred', { error, context });

    // 检查错误类型
    if (error instanceof ToolError) {
      return {
        type: 'tool_error',
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
      };
    }

    if (error instanceof ValidationError) {
      return {
        type: 'validation_error',
        code: error.code,
        message: error.message,
        recoverable: true,
      };
    }

    // 默认错误
    return {
      type: 'unknown_error',
      code: 'UNKNOWN',
      message: 'An unexpected error occurred',
      recoverable: false,
    };
  }
}

// 模型客户端
interface ModelClient {
  generate(prompt: string, options?: GenerationOptions): Promise<GenerationResult>;
  summarize(context: string, options?: GenerationOptions): Promise<GenerationResult>;
  analyze(messages: Message[], options?: GenerationOptions): Promise<AnalysisResult>;
}

// 模型客户端工厂
class ModelClientFactory {
  static create(config: AgentConfig): ModelClient {
    switch (config.type) {
      case 'claude_code':
        return new ClaudeCodeClient(config);
      case 'custom':
        return new CustomModelClient(config);
      default:
        throw new Error(`Unknown model type: ${config.type}`);
    }
  }
}

// Claude Code 客户端
class ClaudeCodeClient implements ModelClient {
  constructor(private config: AgentConfig) {}

  async generate(prompt: string, options?: GenerationOptions): Promise<GenerationResult> {
    // 调用 Claude Code SDK
    // ...
  }

  // ... 其他方法
}
```

---

## 3. 详细设计

### 3.1 工具调用流程

```typescript
/**
 * 执行工具调用
 */
async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const tool = await toolManager.getTool(toolCall.name);

  // 1. 准备工具参数
  const args = await prepareToolArgs(toolCall.arguments, tool.schema);

  // 2. 检查权限
  if (!checkToolPermission(tool, toolCall)) {
    throw new ToolError(
      'PERMISSION_DENIED',
      'No permission to use this tool'
    );
  }

  // 3. 调用工具
  const result = await callTool(tool, args);

  // 4. 处理结果
  return processToolResult(result);
}

/**
 * 准备工具参数
 */
async function prepareToolArgs(
  rawArgs: any,
  schema: JSONSchema7
): Promise<any> {
  // 1. 验证参数格式
  validateSchema(rawArgs, schema);

  // 2. 处理特殊参数
  const processedArgs = {};

  for (const [key, value] of Object.entries(rawArgs)) {
    // 处理文件引用
    if (value.startsWith('file://')) {
      processedArgs[key] = await readFromWorkspace(value);
    }
    // 处理环境变量
    else if (value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      processedArgs[key] = process.env[envVar] || value;
    }
    // 其他参数直接使用
    else {
      processedArgs[key] = value;
    }
  }

  return processedArgs;
}
```

### 3.2 上下文注入策略

```typescript
/**
 * 上下文管理器
 */
class ContextManager {
  private maxContextLength = 10000; // 字符数
  private maxMessages = 50;

  async buildContext(messages: Message[], userQuery: string): string {
    const parts: string[] = [];

    // 1. AI Identity
    parts.push('## AI Identity');
    parts.push(await this.memory.getIdentity());
    parts.push('\n');

    // 2. Recent Conversation History
    const recentMessages = this.getRecentMessages(messages);
    if (recentMessages.length > 0) {
      parts.push('## Recent Conversation');
      for (const msg of recentMessages) {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        parts.push(`### ${role}`);
        parts.push(msg.content);
      }
      parts.push('\n');
    }

    // 3. Relevant Knowledge
    const knowledge = await this.memory.search(userQuery, {
      category: MemoryCategory.KNOWLEDGE,
      limit: 3,
    });
    if (knowledge.length > 0) {
      parts.push('## Relevant Knowledge');
      for (const mem of knowledge) {
        parts.push(`### ${mem.title}`);
        parts.push(mem.content);
      }
      parts.push('\n');
    }

    // 4. Previous Episodes
    const episodes = await this.memory.search(userQuery, {
      category: MemoryCategory.EPISODE,
      limit: 2,
    });
    if (episodes.length > 0) {
      parts.push('## Previous Episodes');
      for (const mem of episodes) {
        parts.push(`### ${mem.title}`);
        parts.push(mem.content);
      }
      parts.push('\n');
    }

    return this.truncateContext(parts.join(''));
  }

  private getRecentMessages(messages: Message[]): Message[] {
    if (messages.length <= this.maxMessages) {
      return messages;
    }

    // 获取最近的 N 条消息
    return messages.slice(-this.maxMessages);

    // 或者基于相关性选择
    // return this.selectRelevantMessages(messages);
  }

  private truncateContext(context: string): string {
    if (context.length <= this.maxContextLength) {
      return context;
    }

    // 截断时保持对话的完整性
    const lines = context.split('\n');
    const result: string[] = [];
    let length = 0;

    for (const line of lines) {
      if (length + line.length + 1 > this.maxContextLength) {
        break;
      }
      result.push(line);
      length += line.length + 1;
    }

    return result.join('\n') + '\n... [Context truncated]';
  }
}
```

---

## 4. 接口规范

### 4.1 Agent API

```typescript
interface IAgent {
  /**
   * 处理用户消息
   */
  process(message: Message): Promise<Response>;

  /**
   * 思考阶段（可选）
   */
  think(context: ConversationContext): Promise<Thought>;

  /**
   * 执行工具调用
   */
  execute(toolCall: ToolCall): Promise<ToolResult>;

  /**
   * 初始化
   */
  initialize(): Promise<void>;

  /**
   * 清理资源
   */
  dispose(): Promise<void>;

  /**
   * 获取能力描述
   */
  getCapabilities(): AgentCapabilities;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

interface Response {
  id: string;
  content: string;
  type: 'text' | 'tool_result';
  actions?: ResponseAction[];
  timestamp: Date;
}

interface Thought {
  intent: string;
  reasoning: string;
  actions?: ToolCall[];
  response?: string;
}
```

---

## 5. 实现细节

### 5.1 会话状态保持

```typescript
/**
 * 会话状态管理
 */
class SessionStateManager {
  private sessions: Map<string, SessionState> = new Map();
  private maxSessionAge = 24 * 60 * 60 * 1000; // 24小时

  getSession(sessionId: string): SessionState {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new SessionState(sessionId));
    }

    const state = this.sessions.get(sessionId)!;
    state.lastActivity = Date.now();

    return state;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [sessionId, state] of this.sessions.entries()) {
      if (now - state.lastActivity > this.maxSessionAge) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

class SessionState {
  sessionId: string;
  lastActivity: number;
  messages: Message[] = [];
  context: Record<string, any> = {};

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.lastActivity = Date.now();
  }
}
```

### 5.2 并发控制

```typescript
/**
 * 工具调用并发控制
 */
class ToolConcurrencyController {
  private activeCalls = new Map<string, ToolCallPromise>();
  private maxConcurrent = 10;

  async executeWithLock(
    toolName: string,
    args: any,
    executor: () => Promise<any>
  ): Promise<any> {
    // 检查并发限制
    if (this.activeCalls.size >= this.maxConcurrent) {
      throw new Error('Too many concurrent tool calls');
    }

    // 检查同一工具的并发调用
    const key = `${toolName}:${JSON.stringify(args)}`;
    const existing = this.activeCalls.get(key);
    if (existing) {
      return existing.promise;
    }

    // 创建新调用
    const promise = this.createToolCall(key, executor);
    return promise;
  }

  private async createToolCall(
    key: string,
    executor: () => Promise<any>
  ): Promise<any> {
    this.activeCalls.set(key, {
      promise: null as any,
      timeout: setTimeout(() => this.remove(key), 30000), // 30秒超时
    });

    try {
      const result = await executor();
      return result;
    } finally {
      this.remove(key);
    }
  }

  private remove(key: string): void {
    const call = this.activeCalls.get(key);
    if (call) {
      clearTimeout(call.timeout);
      this.activeCalls.delete(key);
    }
  }
}
```

---

## 6. 测试策略

### 6.1 单元测试范围

```typescript
describe('Agent', () => {
  describe('process()', () => {
    it('should process user message and generate response');
    it('should handle tool calls');
    it('should inject memory context');
    it('should handle errors gracefully');
  });

  describe('execute()', () => {
    it('should execute tool calls');
    it('should validate tool arguments');
    it('should handle tool errors');
  });

  describe('think()', () => {
    it('should analyze intent');
    it('should generate reasoning');
  });
});

describe('ToolManager', () => {
  describe('execute()', () => {
    it('should find correct tool');
    it('should pass arguments correctly');
    it('should handle timeouts');
  });
});

describe('ContextManager', () => {
  describe('buildContext()', () => {
    it('should include identity');
    it('should include recent history');
    it('should respect context limits');
  });
});
```

---

## 7. 配置项

### 7.1 Agent 配置

```json
{
  "agent": {
    "type": "claude_code",
    "model": "glm-4.7",
    "summaryModel": "glm-4.7",
    "allowedTools": [],
    "timeoutSecs": 600,
    "maxRetries": 3,
    "contextLength": 10000,
    "maxMessages": 50
  }
}
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `type` | string | `claude_code` | Agent 类型 |
| `model` | string | `glm-4.7` | 主模型 |
| `summaryModel` | string | `glm-4.7` | 摘要模型 |
| `allowedTools` | string[] | `[]` | 允许的工具列表 |
| `timeoutSecs` | number | `600` | 超时时间 |
| `maxRetries` | number | `3` | 最大重试次数 |
| `contextLength` | number | `10000` | 最大上下文长度 |
| `maxMessages` | number | `50` | 最大消息数 |

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
