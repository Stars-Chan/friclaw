# FriClaw 详细设计文档

> **版本**: 2.0.0
> **作者**: Stars-Chan
> **日期**: 2026-03-19

---

## 目录

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

FriClaw (Friday + Claw) 是一个以"全能 AI 管家"为定位的私人智能助手系统。项目名称来源于：
- **Friday**: 来自钢铁侠 F.R.I.D.A.Y.，象征随时待命、主动感知、深度理解主人需求的智能管家
- **Claw**: 象征强大的工具执行能力，能精准抓取信息、驱动工具、完成复杂任务

FriClaw 不是一个通用聊天机器人，而是专属于你的私人管家——它了解你的习惯、记住你的偏好、主动提醒你该做的事，并在你需要时调动一切工具帮你完成任务。

### 1.2 核心目标

1. **随时可达**: 通过飞书、企业微信等日常工作平台接入，无需切换工具
2. **深度理解**: 基于 Claude Code 的强大推理能力，理解复杂意图，执行多步骤任务
3. **长期记忆**: 三层记忆系统持久化你的偏好、知识和历史，越用越懂你（可选向量检索增强）
4. **主动服务**: 基于模式识别主动提醒、定时执行任务，而不只是被动响应
5. **工具全能**: MCP 协议支持无限扩展工具能力，脚本、文件、API 一手掌控

---

## 2. 核心架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        FriClaw 系统架构                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │   飞书网关    │  │  企业微信网关  │  ← 外部平台 WebSocket        │
│  └──────┬───────┘  └──────┬───────┘                              │
│         └──────────────────┘                                      │
│                    ▼                                              │
│         ┌─────────────────────┐                                  │
│         │   消息路由器 (Dispatcher) │                             │
│         └──────────┬──────────┘                                  │
│                    │                                              │
│         ┌──────────┼──────────┐                                  │
│         ▼          ▼          ▼                                  │
│    会话管理器    Lane Queue   消息解析器                            │
│         └──────────┼──────────┘                                  │
│                    ▼                                              │
│         ┌─────────────────────┐                                  │
│         │  Claude Code Agent  │                                  │
│         └──────────┬──────────┘                                  │
│                    │                                              │
│         ┌──────────┼──────────┐                                  │
│         ▼          ▼          ▼                                  │
│      内存系统    MCP 服务    定时任务                               │
│    (三层记忆)   (热重载)   (Cron调度)                              │
│                                                                   │
├─────────────────────────────────────────────────────────────────┤
│                    工作空间层 (Per-Session)                        │
│         Workspace1   Workspace2   Workspace3   ...               │
├─────────────────────────────────────────────────────────────────┤
│                    Dashboard (ws://127.0.0.1:3000)                 │
│                        Web Dashboard                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 分层架构

#### 2.2.1 网关层 (Gateway Layer)

负责与外部平台对接，处理平台特定的消息格式和认证。每个平台对应一个独立的网关实现，统一抽象为标准的消息收发接口。支持 WebSocket 长连接保持实时通信。

#### 2.2.2 会话层 (Session Layer)

管理用户会话、上下文维护、工作空间隔离。每个会话拥有独立的工作空间目录和 Lane Queue，确保同一会话的消息严格串行处理，不同会话之间完全并行。

#### 2.2.3 Agent 层 (Agent Layer)

AI 核心引擎，负责理解用户意图、调用工具、生成响应。通过 stdin/stdout 与 Claude Code CLI 子进程通信，每个 conversationId 对应一个长驻子进程，支持流式事件输出（thinking_delta、text_delta、tool_use、done）。

#### 2.2.4 内存层 (Memory Layer)

三层记忆系统 + 向量检索，确保 AI 的长期记忆能力。Identity 层定义 AI 身份，Knowledge 层存储用户知识，Episode 层记录历史摘要。混合检索结合 SQLite FTS5 关键词搜索和 Qdrant 语义搜索，提供高准确率的记忆召回。

#### 2.2.5 扩展层 (Extension Layer)

MCP 服务器和插件系统，支持功能扩展。支持热重载，每次启动新子进程时重新读取配置，无需重启主进程即可生效新的 MCP 服务。

---

## 3. 系统设计

### 3.1 并发控制设计

#### Lane Queue 机制

FriClaw 采用 Lane Queue 代替 Mutex，实现串行消息处理。

Lane Queue 是一个任务队列，调用方将任务 enqueue 后等待执行完成，队列内部自动按 FIFO 顺序依次执行，无需手动管理锁的获取和释放。

相比 Mutex 的优势：
- 语义更清晰（队列 vs 锁）
- 无需 try-finally 包裹，自动处理异常
- 严格保证 FIFO 执行顺序
- 调用方代码更简洁

每个会话拥有独立的 Lane Queue，会话间完全并行，会话内严格串行。

### 3.2 网关设计

#### 飞书网关 (Feishu Gateway)

- 连接方式：WebSocket 长连接
- 认证：AppID + AppSecret，支持消息加密验证
- 消息类型：text、post（富文本）、image、interactive（卡片）
- 流式响应：使用 Feishu Card JSON 2.0 + cardkit API，懒创建卡片后增量更新，支持 thinking 状态展示

#### 企业微信网关 (WeCom Gateway)

- 连接方式：WebSocket 长连接
- 认证：BotID + Secret
- 消息类型：text、image、file
- 流式响应：通过分块消息更新模拟流式效果，使用 debounced flush 减少更新频率

### 3.3 会话管理设计

#### 会话生命周期

```
创建会话 → 活跃状态 → 挂起状态 → 关闭会话
   │           │           │           │
初始化工作空间  Lane Queue  超时未活动   清理资源
加载内存上下文  处理消息    保存快照     释放内存
```

#### 工作空间设计

每个会话对应一个独立的工作空间目录，包含：
- 会话元数据（session.json）
- 对话上下文（context.json）
- 可用工具配置（tools.json）
- Skills 符号链接（.claude/skills/）
- MCP 配置（.mcp.json）
- 会话记录（memory/）
- 临时文件（temp/）
- 缓存数据（cache/）

### 3.4 内存系统设计

#### 三层记忆架构

```
┌─────────────────────────────────────────────────────────┐
│                    FriClaw 内存系统                       │
├─────────────────────────────────────────────────────────┤
│  Identity 层 (只读) - AI 身份、性格、价值观                │
│  SOUL.md，系统启动时加载，注入所有对话上下文               │
├─────────────────────────────────────────────────────────┤
│  Knowledge 层 (读写) - 用户知识、偏好、联系人              │
│  owner-profile.md / preferences.md / people.md          │
│  projects.md / notes.md，按需检索注入                    │
├─────────────────────────────────────────────────────────┤
│  Episode 层 (只读) - 会话摘要、历史记录                   │
│  {date}_episodes.md，自动生成，定时更新                   │
├─────────────────────────────────────────────────────────┤
│  混合检索系统                                             │
│  ├─ SQLite FTS5 - 关键词全文搜索                         │
│  └─ Qdrant 向量检索 - 语义相似度搜索                      │
└─────────────────────────────────────────────────────────┘
```

#### 数据库设计

内存表存储所有记忆条目，字段包括：id、category（identity/knowledge/episode）、title、content（Markdown）、tags（JSON 数组）、date、embedding（向量，可选）。

FTS5 虚拟表与内存表通过触发器保持同步，支持 INSERT/UPDATE/DELETE 的实时索引更新，使用 unicode61 分词器支持中文。

#### 向量检索设计

向量检索采用混合搜索策略：
1. FTS5 关键词搜索召回候选集（limit × 2）
2. Qdrant 向量搜索召回候选集（limit × 2）
3. 对两个候选集进行 Rerank 重排序，取 top-N 返回

Embedding 模型优先使用 `text-embedding-3-large`（云端）或 `bge-large-zh-v1.5`（本地，降低成本）。

### 3.5 MCP 服务设计

#### 内置 MCP 服务

| 服务名称 | 功能描述 |
|---------|---------|
| `friclaw-memory` | 内存读写、全文搜索、向量检索 |
| `friclaw-cron` | 定时任务管理 |
| `friclaw-workspace` | 工作空间管理 |
| `friclaw-gateway` | 网关消息发送 |
| `friclaw-diagnostics` | 系统诊断、日志 |

#### MCP 热重载机制

每次为 conversationId 启动新的 Claude Code 子进程时，重新从磁盘读取配置（不使用缓存），将内置 MCP 服务与用户配置的 MCP 服务合并，写入工作空间的 `.mcp.json`。这样修改 MCP 配置后，下一个新会话即可生效，无需重启主进程。

### 3.6 定时任务设计

CronJob 支持两种模式：
- **一次性任务**：指定 `runAt` 时间点执行一次
- **循环任务**：指定 cron 表达式周期执行

每个任务携带一条发送给 AI 的提示词 `message`，触发时由调度器以该用户身份发起对话。记录 lastRun、nextRun、runCount 等执行状态。

### 3.7 智能路由设计

根据请求复杂度自动选择合适的模型，降低成本：

| 复杂度 | 判断依据 | 模型 |
|--------|---------|------|
| simple | 短文本、无代码、无多步骤 | claude-haiku-4-5 |
| medium | 中等长度、有代码 | claude-sonnet-4-6 |
| complex | 多步骤推理、分析评估 | claude-opus-4-6 |

判断依据包括：文本长度、是否含代码块、是否含多步骤关键词、是否含推理分析关键词。

### 3.8 控制面板设计

Dashboard 是 FriClaw 的**统一管理入口**，通过 WebSocket 接口连接，提供实时状态和会话管理能力。

#### Dashboard 架构

```
FriClaw Core (ws://127.0.0.1:3000)
  └─ Web Dashboard    ← 可视化管理界面

注：飞书 / 企业微信是外部平台网关，通过各自平台的 WebSocket 协议
连接，不经过 Dashboard 端点。
```

所有客户端连接到同一个 WebSocket 端点，通过 `clientType` 字段区分身份。服务端广播的状态变更（网关上线/下线、任务触发、配置变更）会实时推送给所有已连接的客户端，保持多端状态同步。

#### 连接模型

每个客户端连接后发送 `hello` 握手，声明自己的类型和能力。服务端维护连接注册表，按 clientType 分组管理。断线后自动从注册表移除，支持客户端自动重连。

客户端类型：
- `webchat`：Web 聊天界面，需要流式响应
- `dashboard`：控制面板，需要系统状态推送

#### 消息协议

**客户端 → 服务端：**

| 消息类型 | 说明 |
|---------|------|
| `hello` | 握手，声明 clientType |
| `chat.send` | 发送聊天消息，携带 sessionId 和 content |
| `session.create` | 创建新会话 |
| `session.clear` | 清空会话历史 |
| `cron.create` | 创建定时任务 |
| `cron.toggle` | 启停定时任务 |
| `cron.delete` | 删除定时任务 |
| `memory.search` | 搜索记忆 |
| `memory.save` | 保存知识 |
| `memory.delete` | 删除记忆条目 |
| `config.get` | 获取当前配置 |
| `config.update` | 更新配置（热重载） |
| `log.subscribe` | 订阅实时日志流 |

**服务端 → 客户端：**

| 消息类型 | 说明 |
|---------|------|
| `welcome` | 握手响应，返回服务端版本和当前状态 |
| `chat.stream_start` | 流式响应开始 |
| `chat.stream_delta` | 增量内容（thinking_delta / text_delta） |
| `chat.stream_end` | 流式响应结束，携带完整统计信息 |
| `system.status` | 系统状态快照（主动推送或响应查询） |
| `gateway.event` | 网关状态变更（连接/断开/消息统计更新） |
| `cron.fired` | 定时任务触发通知 |
| `config.changed` | 配置变更广播 |
| `log.line` | 实时日志行 |
| `error` | 错误信息 |

#### 功能模块

**聊天模块（Chat）**

直接与 FriClaw AI 对话，等同于飞书/企业微信中的交互体验。支持：
- 多会话管理，左侧边栏展示会话列表
- 流式响应实时渲染，Markdown + 代码高亮
- 可折叠的 AI 思考过程（thinking）面板
- 每条消息展示模型、耗时、token 用量、成本

**控制模块（Control）**

系统运行状态的实时监控，数据通过 WebSocket 推送自动更新：
- 概览：活跃会话数、消息总量、模型调用成本、系统健康状态
- 频道：各平台网关的连接状态和消息统计
- 会话：当前所有活跃会话列表，支持强制关闭
- 定时任务：Cron 任务的创建、启停、执行历史
- 用量：按时间维度的 token 消耗和成本统计

**记忆模块（Memory）**

三层记忆的可视化管理：
- 浏览 Identity / Knowledge / Episode 各层条目
- 支持关键词 + 语义混合搜索
- Knowledge 层支持在线编辑和删除
- Episode 层展示历史会话摘要时间线

**设置模块（Settings）**

- 配置：在线查看和修改 config.json，保存后热重载生效
- MCP：管理已连接的 MCP 服务，查看可用工具列表
- 日志：实时日志流，支持级别过滤

#### 数据持久化

会话列表和消息历史存储在浏览器 localStorage，无需后端额外存储。系统状态（网关连接、任务列表）由服务端内存维护，客户端连接时通过 `welcome` 消息获取完整快照。

#### 技术栈

| 层 | 技术 |
|----|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite |
| 样式 | Tailwind CSS |
| 图标 | Lucide React |
| Markdown 渲染 | react-markdown + react-syntax-highlighter |
| 通信 | WebSocket（Dashboard 统一接口） |

---

## 4. 技术选型

### 4.1 核心技术栈

| 组件 | 技术选型 | 说明 |
|------|---------|------|
| 运行时 | Bun | 高性能 JS 运行时，内置 SQLite |
| 语言 | TypeScript | 类型安全、开发效率 |
| LLM | Claude Code | 支持模型切换（Opus/Sonnet/Haiku） |
| 数据库 | SQLite + FTS5 | 内置、高性能、全文搜索 |
| 向量数据库 | Qdrant | 语义搜索（可选） |
| 协议 | MCP | 工具调用标准 |
| 网络 | WebSocket | 实时双向通信 |
| 并发控制 | Lane Queue | 串行执行队列 |

### 4.2 主要依赖

| 依赖 | 用途 |
|------|------|
| `@anthropic-ai/sdk` | Claude API 调用 |
| `@modelcontextprotocol/sdk` | MCP 协议实现 |
| `@qdrant/js-client-rest` | 向量数据库客户端 |
| `better-sqlite3` | SQLite 操作 |
| `zod` | 配置和数据校验 |
| `ws` | WebSocket 客户端 |
| `node-cron` | 定时任务调度 |
| `winston` | 日志系统 |

---

## 5. 数据模型

### 5.1 配置模型

FriClawConfig 包含以下配置域：

- **agent**: AI 类型（claude_code）、模型选择、摘要模型、允许的工具列表、超时时间
- **gateways**: 飞书、企业微信各自的认证配置
- **memory**: 记忆目录、搜索返回数量、是否启用向量检索、向量数据库地址
- **mcpServers**: 用户自定义 MCP 服务配置（stdio/http/sse）
- **skillsDir**: Skills 目录路径
- **workspaces**: 工作空间目录、最大会话数、会话超时时间
- **cron**: 是否启用、最大并发任务数
- **logging**: 日志级别、目录、文件大小和数量限制
- **dashboard**: 是否启用、端口、CORS、认证配置

### 5.2 消息模型

Message 包含：
- 会话标识（sessionId、platform）
- 发送者信息（userId、userName、isBot）
- 接收者信息（chatId、chatType：private/group/topic）
- 消息内容（type：text/image/file/interactive/command，content）
- 元数据（timestamp、messageId、replyTo）

### 5.3 响应模型

Response 包含：
- 会话标识（sessionId、platform）
- 回复内容（text、markdown、interactive）
- 动作列表（send_message/update_message/delete_message/open_url）
- 元数据（timestamp、replyTo、threadId）

---

## 6. API 设计

FriClaw 不提供独立的 REST HTTP API。所有客户端操作（会话管理、记忆读写、定时任务、配置变更）统一通过 3.8 节定义的 Dashboard WebSocket 协议完成。

唯一的 HTTP 端点是健康检查：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 返回服务运行状态和版本信息 |

---

## 7. 部署架构

### 7.1 单机部署

主进程管理所有网关 Worker 和 Claude Code 子进程池。文件系统布局：

```
~/.friclaw/
├── config.json       # 主配置文件
├── memory/           # 记忆数据库
├── workspaces/       # 会话工作空间
├── logs/             # 日志文件
└── cache/            # 缓存数据
```

### 7.2 Docker 部署

基于 `oven/bun:1.1` 镜像，多阶段构建。memory、workspaces、logs、cache 四个目录挂载为 Volume 持久化数据，暴露 3000 端口供 Dashboard 访问。

### 7.3 配置文件结构

配置文件为 JSON 格式，支持环境变量占位符（如 `${FEISHU_APP_ID}`）。关键配置项：

- agent.model：默认 `claude-sonnet-4-6`
- agent.summaryModel：默认 `claude-haiku-4-5`（用于生成摘要，降低成本）
- memory.vectorEnabled：是否启用 Qdrant 向量检索
- workspaces.sessionTimeout：会话超时时间（秒）

### 7.4 环境变量

| 变量 | 说明 |
|------|------|
| FEISHU_APP_ID / APP_SECRET | 飞书应用凭证 |
| FEISHU_ENCRYPT_KEY / VERIFICATION_TOKEN | 飞书消息加密 |
| WECOM_BOT_ID / SECRET | 企业微信凭证 |
| OPENAI_API_KEY | 向量 Embedding 密钥（仅启用 Qdrant 时需要） |
| FRICLAW_VECTOR_ENABLED | 是否启用向量检索 |
| FRICLAW_VECTOR_ENDPOINT | Qdrant 服务地址 |
| LOG_LEVEL | 日志级别 |
| PORT | Dashboard 端口 |

> Claude API Key 由 Claude Code 自身管理（存储在 `~/.claude/`），FriClaw 无需单独配置。

---

## 8. 开发计划

### 阶段一：核心功能 (MVP)

| 任务 | 状态 | 优先级 |
|------|------|--------|
| 项目初始化 & 架构搭建 | ✅ 完成 | P0 |
| 配置系统 | ✅ 完成 | P0 |
| Lane Queue 实现 | 🔄 进行中 | P0 |
| 内存系统 (SQLite + FTS5) | 🔄 进行中 | P0 |
| MCP 基础框架 | 📋 待开始 | P0 |
| 会话管理 | 📋 待开始 | P0 |
| 消息路由器 (Dispatcher) | 📋 待开始 | P0 |
| Claude Code Agent 集成 | 📋 待开始 | P0 |
| 文件安全机制 | 📋 待开始 | P0 |
| 飞书网关 | 📋 待开始 | P0 |

### 阶段二：平台扩展

| 任务 | 优先级 |
|------|--------|
| 企业微信网关 | P1 |
| 网关测试 & 文档 | P1 |
| Web Dashboard | P1 |
| 部署架构 (Docker + 单机) | P1 |

### 阶段三：高级功能

| 任务 | 优先级 |
|------|--------|
| 向量检索 (Qdrant) | P2 |
| 定时任务系统 | P2 |
| 智能路由 | P2 |

### 阶段四：智能增强

| 任务 | 优先级 |
|------|--------|
| 主动服务能力 | P3 |
| 深度个性化 | P3 |

---

## 附录

### A. 目录结构

```
friclaw/
├── src/
│   ├── index.ts              # 入口文件
│   ├── config.ts             # 配置加载
│   ├── dispatcher.ts         # 消息路由
│   ├── daemon.ts             # 守护进程
│   ├── gateway/              # 网关层
│   │   ├── base.ts
│   │   ├── feishu.ts
│   │   └── wecom.ts
│   ├── session/              # 会话层
│   │   ├── manager.ts
│   │   └── context.ts
│   ├── agent/                # Agent 层
│   │   ├── claude-code.ts
│   │   ├── file-guard.ts
│   │   └── types.ts
│   ├── memory/               # 内存层
│   │   ├── identity.ts
│   │   ├── knowledge.ts
│   │   ├── episode.ts
│   │   ├── database.ts
│   │   ├── vector-store.ts
│   │   ├── manager.ts
│   │   └── mcp-server.ts
│   ├── mcp/                  # MCP 框架
│   │   ├── client.ts
│   │   └── server.ts
│   ├── utils/                # 工具函数
│   │   ├── lane-queue.ts
│   │   ├── logger.ts
│   │   └── cache.ts
│   ├── cron/                 # 定时任务
│   │   ├── scheduler.ts
│   │   └── types.ts
│   ├── dashboard/            # Web Dashboard
│   │   ├── api.ts
│   │   └── ui/
│   └── types/                # 类型定义
│       ├── gateway.ts
│       ├── agent.ts
│       └── memory.ts
├── docs/
│   ├── DESIGN.md
│   ├── API.md
│   ├── DEPLOYMENT.md
│   └── design/
│       ├── MUTEX_VS_LANE_QUEUE.md
│       ├── OPENCLAW_LEARNINGS.md
│       ├── OPTIMIZATION_PLAN.md
│       ├── NEOCLAW_ANALYSIS.md
│       └── STRATEGY.md
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── package.json
├── tsconfig.json
└── README.md
```

### B. 参考资源

- [NeoClaw 项目](https://github.com/neoclaw/neoclaw)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [飞书开放平台](https://open.feishu.cn/)
- [企业微信 API](https://developer.work.weixin.qq.com/)
- [Claude API](https://docs.anthropic.com/)
- [Qdrant 向量数据库](https://qdrant.tech/)

---

**文档版本**: 2.0.0
**最后更新**: 2026-03-19
