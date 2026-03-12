# FriClaw 详细设计文档

> 基于 NeoClaw 架构，打造全新的 AI 智能助手项目
>
> **版本**: 1.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-13

---

## 📋 目录

- [1. 项目概述](#1-项目概述)
- [2. 核心架构](#2-核心架构)
- [3. 系统设计](#3-系统设计)
- [4. 技术选型](#4-技术选型)
- [5. 数据模型](#5-数据模型)
- [6. API 设计](#6-api-设计)
- [7. 部署架构](#7-部署架构)
- [8. 开发计划](#8-开发计划)

---

## 1. 项目概述

### 1.1 项目背景

FriClaw (Friday + Claw) 是一个基于 AI 的智能助手系统，参考 NeoClaw 的核心架构设计。项目名称来源于：
- **Friday**: 来自钢铁侠 J.A.R.V.I.S. 的继任者 F.R.I.D.A.Y.，象征智能、冷静、高效的 AI 助手
- **Claw**: 象征强大的工具能力和抓取信息的精准性

### 1.2 核心目标

1. **多平台接入**: 支持飞书、企业微信、Slack 等即时通讯平台
2. **智能对话**: 基于 LLM 的自然语言理解和生成能力
3. **任务自动化**: 支持定时任务、脚本执行、工作流编排
4. **持久记忆**: 三层记忆系统确保长期记忆的完整性和可检索性
5. **可扩展性**: MCP (Model Context Protocol) 支持插件化扩展

### 1.3 目标用户

- **个人用户**: 需要个人助手管理日常任务和信息的用户
- **开发团队**: 需要团队智能助手协助开发和运维的团队
- **企业**: 需要定制化智能客服或内部助手的组织

---

## 2. 核心架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        FriClaw 系统架构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   飞书网关    │  │  企业微信网关  │  │   Slack网关   │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            ▼                                     │
│                 ┌─────────────────────┐                        │
│                 │   网关路由器          │                        │
│                 └──────────┬──────────┘                        │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                │
│         ▼                  ▼                  ▼                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │  会话管理器   │   │  事件分发器   │   │  消息解析器   │           │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘           │
│         │                 │                  │                 │
│         └─────────────────┼──────────────────┘                 │
│                           ▼                                      │
│                  ┌─────────────────┐                            │
│                  │   AI Agent 核心   │                            │
│                  │   (LLM + Tools)   │                            │
│                  └─────────┬───────┘                            │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                │
│         ▼                  ▼                  ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   内存系统     │  │   MCP 服务    │  │   定时任务     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                 │
│         ▼                  ▼                  ▼                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ SQLite + FTS │  │  插件系统      │  │  Cron 调度器  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                    工作空间层 (Per-Session)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Workspace1│  │ Workspace2│  │ Workspace3│  │    ...   │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 分层架构

#### 2.2.1 网关层 (Gateway Layer)

负责与外部平台对接，处理平台特定的消息格式和认证。

```typescript
interface IGateway {
  name: string;
  platform: 'feishu' | 'wecom' | 'slack';
  connect(): Promise<void>;
  send(chatId: string, content: MessageContent): Promise<void>;
  onMessage(handler: MessageHandler): void;
  disconnect(): Promise<void>;
}
```

#### 2.2.2 会话层 (Session Layer)

管理用户会话、上下文维护、工作空间隔离。

```typescript
interface ISessionManager {
  createSession(userId: string, chatId: string): ISession;
  getSession(sessionId: string): ISession | null;
  closeSession(sessionId: string): void;
  listSessions(userId: string): ISession[];
}

interface ISession {
  id: string;
  userId: string;
  chatId: string;
  platform: string;
  context: ConversationContext;
  workspace: Workspace;
}
```

#### 2.2.3 Agent 层 (Agent Layer)

AI 核心引擎，负责理解用户意图、调用工具、生成响应。

```typescript
interface IAgent {
  model: string;
  tools: Tool[];
  process(message: Message): Promise<Response>;
  think(context: ConversationContext): Promise<Thought>;
  execute(toolCall: ToolCall): Promise<ToolResult>;
}
```

#### 2.2.4 内存层 (Memory Layer)

三层记忆系统，确保 AI 的长期记忆能力。

```typescript
interface IMemorySystem {
  // Identity 层 - 只读，系统定义
  identity: IdentityMemory;

  // Knowledge 层 - 读写，用户知识
  knowledge: KnowledgeMemory;

  // Episode 层 - 只读，自动生成
  episodes: EpisodeMemory;

  // 全文搜索
  search(query: string, options?: SearchOptions): Promise<Memory[]>;
}
```

#### 2.2.5 扩展层 (Extension Layer)

MCP 服务器和插件系统，支持功能扩展。

```typescript
interface IMCPServer {
  name: string;
  type: 'stdio' | 'sse' | 'http';
  tools: MCPTool[];
  resources: MCPResource[];
  connect(): Promise<void>;
  callTool(name: string, args: any): Promise<any>;
}
```

---

## 3. 系统设计

### 3.1 网关设计

#### 3.1.1 飞书网关 (Feishu Gateway)

**连接方式**: WebSocket 长连接
**配置参数**:
```typescript
interface FeishuConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  events: string[]; // 订阅的事件类型
}
```

**消息格式**:
```typescript
interface FeishuMessage {
  msg_type: 'text' | 'post' | 'image' | 'interactive';
  content: {
    text?: string;
    post?: PostContent;
    image_key?: string;
  };
  sender: {
    user_id: string;
    union_id: string;
  };
  chat_id: string;
  timestamp: number;
}
```

#### 3.1.2 企业微信网关 (WeCom Gateway)

**连接方式**: WebSocket 长连接
**配置参数**:
```typescript
interface WeComConfig {
  botId: string;
  secret: string;
}
```

**协议格式**:
```typescript
interface WeComSubscribe {
  cmd: 'aibot_subscribe';
  headers: {
    req_id: string;
  };
  body: {
    bot_id: string;
    secret: string;
  };
}

interface WeComMessage {
  msgtype: 'text' | 'image' | 'file';
  text?: { content: string };
  image?: { media_id: string };
  from_user: string;  // 私聊
  chat_id?: string;  // 群聊
  timestamp: number;
}
```

### 3.2 会话管理设计

#### 3.2.1 会话生命周期

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  创建会话  │ -> │  活跃状态  │ -> │  挂起状态  │ -> │  关闭会话  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
     │                │                │                │
     │                │                │                │
     ▼                ▼                ▼                ▼
 初始化工作空间    处理消息       超时未活动      清理资源
 加载内存上下文    更新上下文      保存快照        释放内存
```

#### 3.2.2 工作空间设计

每个会话对应一个独立的工作空间目录：

```
~/.friclaw/workspaces/
├── {session_id}/
│   ├── .friclaw/
│   │   ├── session.json      # 会话元数据
│   │   ├── context.json      # 对话上下文
│   │   └── tools.json        # 可用工具配置
│   ├── memory/
│   │   └── {conversation_id}.md  # 会话记录
│   ├── temp/
│   │   └── {task_id}/        # 临时文件
│   └── cache/
│       └── {key}/            # 缓存数据
```

### 3.3 内存系统设计

#### 3.3.1 三层记忆架构

```
┌─────────────────────────────────────────────────────────┐
│                    FriClaw 内存系统                       │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │  Identity 层 (只读) - AI 身份、性格、价值观         │   │
│  │  - SOUL.md                                        │   │
│  │  - 系统加载时初始化                               │   │
│  └───────────────────────────────────────────────────┘   │
│                           ↑                                │
│                           │ 自动注入到上下文               │
│                           ↓                                │
│  ┌───────────────────────────────────────────────────┐   │
│  │  Knowledge 层 (读写) - 用户知识、偏好、联系人        │   │
│  │  - owner-profile.md                               │   │
│  │  - preferences.md                                 │   │
│  │  - people.md                                      │   │
│  │  - projects.md                                    │   │
│  │  - notes.md                                       │   │
│  └───────────────────────────────────────────────────┘   │
│                           ↑                                │
│                           │ 检索并注入                     │
│                           ↓                                │
│  ┌───────────────────────────────────────────────────┐   │
│  │  Episode 层 (只读) - 会话摘要、历史记录           │   │
│  │  - {date}_episodes.md                             │   │
│  │  - 自动生成，定时更新                               │   │
│  └───────────────────────────────────────────────────┘   │
│                           ↑                                │
│                           │ 语义搜索                       │
│                           ↓                                │
│  ┌───────────────────────────────────────────────────┐   │
│  │  SQLite 全文搜索 (FTS5)                           │   │
│  │  - memory 表                                       │   │
│  │  - memory_fts 全文索引                              │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

#### 3.3.2 数据库 Schema

```sql
-- 内存表
CREATE TABLE memory (
  id TEXT PRIMARY KEY,           -- 唯一标识符
  category TEXT NOT NULL,        -- identity/knowledge/episode
  title TEXT NOT NULL,           -- 标题
  content TEXT NOT NULL,         -- Markdown 内容
  tags TEXT NOT NULL DEFAULT '', -- 标签 (JSON 数组)
  date TEXT NOT NULL             -- 日期 (YYYY-MM-DD)
);

-- 全文搜索索引
CREATE VIRTUAL TABLE memory_fts USING fts5(
  id, category, title, content, tags, date,
  content='memory',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- 触发器保持同步
CREATE TRIGGER memory_ai AFTER INSERT ON memory
  INSERT INTO memory_fts(rowid, id, category, title, content, tags, date)
    VALUES (new.rowid, new.id, new.category, new.title, new.content, new.tags, new.date);

CREATE TRIGGER memory_ad AFTER DELETE ON memory
  INSERT INTO memory_fts(memory_fts, rowid, id, category, title, content, tags, date)
    VALUES ('delete', old.rowid, old.id, old.category, old.title, old.content, old.tags, old.date);

CREATE TRIGGER memory_au AFTER UPDATE ON memory
  INSERT INTO memory_fts(memory_fts, rowid, id, category, title, content, tags, date)
    VALUES ('delete', old.rowid, old.id, old.category, old.title, old.content, old.tags, old.date);
  INSERT INTO memory_fts(rowid, id, category, title, content, tags, date)
    VALUES (new.rowid, new.id, new.category, new.title, new.content, new.tags, new.date);
```

### 3.4 MCP 服务设计

#### 3.4.1 MCP 工具定义

```typescript
interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (args: any) => Promise<any>;
}

interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
  get: () => Promise<ResourceContent>;
}
```

#### 3.4.2 内置 MCP 服务

| 服务名称 | 功能描述 |
|---------|---------|
| `friclaw-memory` | 内存读写、全文搜索 |
| `friclaw-cron` | 定时任务管理 |
| `friclaw-workspace` | 工作空间管理 |
| `friclaw-gateway` | 网关消息发送 |
| `friclaw-diagnostics` | 系统诊断、日志 |

### 3.5 定时任务设计

```typescript
interface CronJob {
  id: string;
  label?: string;
  enabled: boolean;

  // 一次性任务
  runAt?: Date;

  // 循环任务 (cron 表达式)
  cronExpr?: string;

  // 执行配置
  message: string;  // 发送给 AI 的提示词

  // 执行状态
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
}
```

---

## 4. 技术选型

### 4.1 核心技术栈

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| **运行时** | Bun | 高性能 JS 运行时 |
| **语言** | TypeScript | 类型安全、开发效率 |
| **LLM** | GLM-4.7 | 主要模型；支持 Claude 备用 |
| **数据库** | SQLite + FTS5 | 内置、高性能、全文搜索 |
| **协议** | MCP (Model Context Protocol) | 工具调用标准 |
| **网络** | WebSocket | 实时双向通信 |
| **配置** | JSON | 简单易读 |

### 4.2 依赖管理

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^10.0.0",
    "zod": "^3.22.0",
    "ws": "^8.16.0",
    "node-cron": "^3.0.3",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "prettier": "^3.1.0",
    "vitest": "^1.1.0"
  }
}
```

---

## 5. 数据模型

### 5.1 配置模型

```typescript
interface FriClawConfig {
  // AI 配置
  agent: {
    type: 'claude_code' | 'custom';
    model: string;           // glm-4.7, claude-opus-4-6, etc.
    summaryModel?: string;
    allowedTools: string[];
    timeoutSecs: number;
  };

  // 网关配置
  gateways: {
    feishu?: FeishuConfig;
    wecom?: WeComConfig;
    slack?: SlackConfig;
  };

  // 内存配置
  memory: {
    dir: string;              // ~/.friclaw/memory
    searchLimit: number;      // 默认搜索返回数量
  };

  // MCP 配置
  mcpServers: Record<string, MCPServerConfig>;

  // 工作空间配置
  workspaces: {
    dir: string;             // ~/.friclaw/workspaces
    maxSessions: number;      // 最大会话数
    sessionTimeout: number;    // 会话超时 (秒)
  };

  // 定时任务配置
  cron: {
    enabled: boolean;
    scheduler: string;       // node-cron / 自定义
    maxConcurrentJobs: number;
  };

  // 日志配置
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    dir: string;             // ~/.friclaw/logs
    maxSize: string;         // 单个日志文件最大大小
    maxFiles: number;         // 保留的日志文件数量
  };

  // Dashboard 配置
  dashboard: {
    enabled: boolean;
    port: number;
    cors: boolean;
    auth?: {
      enabled: boolean;
      username?: string;
      password?: string;
    };
  };
}
```

### 5.2 消息模型

```typescript
interface Message {
  id: string;
  sessionId: string;
  platform: string;

  // 发送者信息
  from: {
    userId: string;
    userName?: string;
    isBot: boolean;
  };

  // 接收者信息
  to: {
    chatId: string;
    chatType: 'private' | 'group' | 'topic';
  };

  // 消息内容
  type: 'text' | 'image' | 'file' | 'interactive' | 'command';
  content: MessageContent;

  // 元数据
  timestamp: Date;
  messageId?: string;        // 平台原始消息 ID
  replyTo?: string;          // 回复的消息 ID
}

interface MessageContent {
  text?: string;
  image?: { url: string; key: string };
  file?: { url: string; name: string; size: number };
  interactive?: InteractiveContent;
  command?: { name: string; args: Record<string, any> };
}
```

### 5.3 响应模型

```typescript
interface Response {
  sessionId: string;
  platform: string;

  // 回复内容
  content: ResponseContent;

  // 动作
  actions?: ResponseAction[];

  // 元数据
  timestamp: Date;
  replyTo?: string;
  threadId?: string;
}

interface ResponseContent {
  text?: string;
  markdown?: string;
  interactive?: InteractiveContent;
}

interface ResponseAction {
  type: 'send_message' | 'update_message' | 'delete_message' | 'open_url';
  target?: string;
  data: any;
}
```

---

## 6. API 设计

### 6.1 内部 API

#### 6.1.1 会话管理 API

```typescript
// 创建会话
POST /api/sessions
Body: { userId: string, chatId: string, platform: string }
Response: { sessionId: string }

// 获取会话
GET /api/sessions/:sessionId
Response: { session: ISession }

// 关闭会话
DELETE /api/sessions/:sessionId
Response: { success: boolean }

// 列出用户会话
GET /api/users/:userId/sessions
Response: { sessions: ISession[] }
```

#### 6.1.2 内存 API

```typescript
// 搜索记忆
GET /api/memory/search?q={query}&category={category}&limit={limit}
Response: { results: Memory[] }

// 读取记忆
GET /api/memory/:id
Response: { memory: Memory }

// 保存知识
POST /api/memory/knowledge
Body: { id: string, content: string, tags: string[] }
Response: { success: boolean }

// 列出所有记忆
GET /api/memory/list?category={category}
Response: { memories: Memory[] }
```

#### 6.1.3 定时任务 API

```typescript
// 创建任务
POST /api/cron
Body: {
  label?: string,
  runAt?: Date,
  cronExpr?: string,
  message: string
}
Response: { jobId: string }

// 列出任务
GET /api/cron?includeDisabled={boolean}
Response: { jobs: CronJob[] }

// 更新任务
PATCH /api/cron/:jobId
Body: { label?: string, message?: string, enabled?: boolean, ... }
Response: { success: boolean }

// 删除任务
DELETE /api/cron/:jobId
Response: { success: boolean }
```

### 6.2 MCP 协议

#### 6.2.1 工具调用

```typescript
// 工具列表
GET /mcp/tools
Response: { tools: MCPTool[] }

// 调用工具
POST /mcp/tools/:name
Body: { args: any }
Response: { result: any, error?: string }
```

#### 6.2.2 资源访问

```typescript
// 资源列表
GET /mcp/resources
Response: { resources: MCPResource[] }

// 读取资源
GET /mcp/resources/{uri}
Response: { content: ResourceContent }
```

---

## 7. 部署架构

### 7.1 单机部署

```
┌─────────────────────────────────────────────────────────┐
│                      单机部署架构                           │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────┐                                        │
│  │   FriClaw    │  ← 主进程                              │
│  │   Process    │                                        │
│  └───┬──────┬───┘                                        │
│      │      │                                             │
│      │      │                                            │
│      ▼      ▼                                            │
│  ┌───────┐ ┌───────┐                                    │
│  │ Gateway│ │  MCP  │  ← 子进程 / Workers               │
│  │ Workers│ │Servers│                                    │
│  └───────┘ └───────┘                                    │
│                                                           │
│  ┌───────────────────────────────────────────────────┐   │
│  │            文件系统                               │   │
│  │  ~/.friclaw/                                     │   │
│  │    ├── config.json                               │   │
│  │    ├── memory/                                    │   │
│  │    ├── workspaces/                               │   │
│  │    ├── logs/                                      │   │
│  │    └── cache/                                     │   │
│  └───────────────────────────────────────────────────┘   │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Docker 部署

```dockerfile
# FriClaw Dockerfile
FROM oven/bun:1.1 AS base

WORKDIR /app

# 安装依赖
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# 复制源代码
COPY tsconfig.json ./
COPY src ./src

# 构建
RUN bun run build

# 运行时镜像
FROM oven/bun:1.1
WORKDIR /app

COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY package.json ./

# 创建目录
RUN mkdir -p /app/memory /app/workspaces /app/logs /app/cache

VOLUME ["/app/memory", "/app/workspaces", "/app/logs", "/app/cache"]

EXPOSE 3000

CMD ["bun", "run", "dist/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  friclaw:
    build: .
    container_name: friclaw
    restart: unless-stopped
    volumes:
      - ./config:/app/config:ro
      - friclaw_memory:/app/memory
      - friclaw_workspaces:/app/workspaces
      - friclaw_logs:/app/logs
      - friclaw_cache:/app/cache
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info

volumes:
  friclaw_memory:
  friclaw_workspaces:
  friclaw_logs:
  friclaw_cache:
```

### 7.3 配置文件示例

```json
{
  "$schema": "https://friclaw.dev/schema/config.json",
  "agent": {
    "type": "claude_code",
    "model": "glm-4.7",
    "summaryModel": "glm-4.7",
    "allowedTools": [],
    "timeoutSecs": 600
  },
  "gateways": {
    "feishu": {
      "appId": "${FEISHU_APP_ID}",
      "appSecret": "${FEISHU_APP_SECRET}",
      "encryptKey": "${FEISHU_ENCRYPT_KEY}",
      "verificationToken": "${FEISHU_VERIFICATION_TOKEN}",
      "events": ["message", "im.message.receive_v1"]
    },
    "wecom": {
      "botId": "${WECOM_BOT_ID}",
      "secret": "${WECOM_SECRET}"
    }
  },
  "memory": {
    "dir": "~/.friclaw/memory",
    "searchLimit": 5
  },
  "mcpServers": {
    "friclaw-memory": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "dist/mcp/memory-server.js"]
    }
  },
  "workspaces": {
    "dir": "~/.friclaw/workspaces",
    "maxSessions": 1000,
    "sessionTimeout": 3600
  },
  "cron": {
    "enabled": true,
    "scheduler": "node-cron",
    "maxConcurrentJobs": 10
  },
  "logging": {
    "level": "info",
    "dir": "~/.friclaw/logs",
    "maxSize": "100m",
    "maxFiles": 7
  },
  "dashboard": {
    "enabled": true,
    "port": 3000,
    "cors": true
  }
}
```

---

## 8. 开发计划

### 8.1 阶段一：核心功能 (MVP)

| 任务 | 状态 | 优先级 |
|------|------|--------|
| 项目初始化 & 架构搭建 | ✅ 完成 | P0 |
| 配置系统 | ✅ 完成 | P0 |
| 内存系统 (SQLite + FTS) | 🔄 进行中 | P0 |
| MCP 基础框架 | 📋 待开始 | P0 |
| 飞书网关 | 📋 待开始 | P1 |
| 会话管理 | 📋 待开始 | P0 |
| AI Agent 集成 | 📋 待开始 | P0 |

### 8.2 阶段二：平台扩展

| 任务 | 优先级 |
|------|--------|
| 企业微信网关 | P1 |
| Slack 网关 | P2 |
| Discord 网关 | P3 |
| 网关测试 & 文档 | P1 |

### 8.3 阶段三：高级功能

| 任务 | 优先级 |
|------|--------|
| 定时任务系统 | P1 |
| Web Dashboard | P2 |
| 插件系统 | P2 |
| 工作流编排 | P3 |

### 8.4 阶段四：企业级特性

| 任务 | 优先级 |
|------|--------|
| 多租户支持 | P2 |
| 认证授权 | P2 |
| 审计日志 | P2 |
| 监控告警 | P2 |
| 数据备份 | P3 |

---

## 附录

### A. 目录结构

```
friclaw/
├── src/
│   ├── index.ts              # 入口文件
│   ├── config.ts             # 配置加载
│   │
│   ├── gateway/              # 网关层
│   │   ├── index.ts
│   │   ├── base.ts           # 基类
│   │   ├── feishu.ts
│   │   ├── wecom.ts
│   │   └── slack.ts
│   │
│   ├── session/              # 会话层
│   │   ├── index.ts
│   │   ├── manager.ts
│   │   └── context.ts
│   │
│   ├── agent/                # Agent 层
│   │   ├── index.ts
│   │   ├── core.ts
│   │   ├── tools.ts
│   │   └── llm.ts
│   │
│   ├── memory/               # 内存层
│   │   ├── index.ts
│   │   ├── identity.ts
│   │   ├── knowledge.ts
│   │   ├── episode.ts
│   │   ├── database.ts
│   │   └── mcp-server.ts     # MCP 内存服务
│   │
│   ├── mcp/                  # MCP 框架
│   │   ├── index.ts
│   │   ├── client.ts
│   │   └── server.ts
│   │
│   ├── workspace/            # 工作空间
│   │   ├── index.ts
│   │   ├── manager.ts
│   │   └── isolation.ts
│   │
│   ├── cron/                 # 定时任务
│   │   ├── index.ts
│   │   ├── scheduler.ts
│   │   └── jobs.ts
│   │
│   ├── dashboard/            # Web Dashboard
│   │   ├── index.ts
│   │   ├── api.ts
│   │   └── ui/
│   │
│   ├── utils/                # 工具函数
│   │   ├── logger.ts
│   │   ├── retry.ts
│   │   └── cache.ts
│   │
│   └── types/                # 类型定义
│       ├── index.ts
│       ├── gateway.ts
│       ├── agent.ts
│       └── memory.ts
│
├── docs/                     # 文档
│   ├── DESIGN.md
│   ├── API.md
│   └── DEPLOYMENT.md
│
├── tests/                    # 测试
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── scripts/                  # 脚本
│   ├── build.ts
│   ├── dev.ts
│   └── lint.ts
│
├── package.json
├── tsconfig.json
├── bun.lockb
└── README.md
```

### B. 环境变量

```bash
# AI 配置
FRICLAW_MODEL=glm-4.7
FRICLAW_MODEL_API_KEY=xxx

# 飞书配置
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_ENCRYPT_KEY=xxx
FEISHU_VERIFICATION_TOKEN=xxx

# 企业微信配置
WECOM_BOT_ID=xxx
WECOM_SECRET=xxx

# 服务配置
LOG_LEVEL=info
PORT=3000
```

### C. 参考资源

- [NeoClaw 项目](https://github.com/neoclaw/neoclaw)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [飞书开放平台](https://open.feishu.cn/)
- [企业微信 API](https://developer.work.weixin.qq.com/)
- [GLM API](https://open.bigmodel.cn/)
- [Claude API](https://docs.anthropic.com/)

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-13
