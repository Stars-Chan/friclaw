# FriClaw

Friday + Claw —— 致力于让每个人都能拥有《钢铁侠》里的 AI 管家 F.R.I.D.A.Y.

FriClaw基于 Claude Code 构建，在其上补齐了多平台消息接入、会话调度、长期记忆、线程续接、Dashboard 管理和定时任务能力。

## 核心能力

- 多平台接入：支持飞书、企业微信、微信和本地 Dashboard
- 会话级执行：同一会话尽量复用同一执行上下文，保持连续性
- 串行调度：同一会话严格串行，不同会话并行执行
- 三层记忆：Identity / Knowledge / Episode 分层管理上下文
- 线程续接：支持会话摘要、上下文压缩后的恢复与继续工作
- Dashboard：提供 Web 管理界面、会话查看、记忆查看、配置管理
- 定时任务：内置 CronScheduler，可将任务定时投递回指定会话

## 整体架构

FriClaw 的主链路如下：

```text
企业微信 / 飞书 / 微信 / Dashboard
                ↓
             Gateway
                ↓
     Dispatcher / Lane Queue
                ↓
          SessionManager
                ↓
        Claude Code Agent
         ↙       ↓       ↘
    Memory     Skill     MCP
                ↓
          返回到消息平台
```

系统各层职责：

- Gateway：负责不同平台的消息接入与格式适配
- Dispatcher：负责将平台消息纳入系统内部调度流程
- Lane Queue：保证同一会话内消息串行执行
- SessionManager：管理会话、工作空间与上下文生命周期
- Claude Code Agent：负责理解任务、调用工具、输出结果
- Memory：提供三层记忆与运行时上下文拼装
- Dashboard：提供可视化管理、会话查看和配置入口

## 三层记忆设计

FriClaw 将长期上下文拆成三层：

### 1. Identity

定义系统长期稳定的行为基线，通常通过 `SOUL.md` 常驻注入。

它回答的是：

- 我是谁
- 我应该怎么协作
- 我在风险和边界问题上怎么判断

### 2. Knowledge

沉淀用户、项目、偏好、约束等长期稳定事实。

它回答的是：

- 我对用户和其现实世界知道什么
- 哪些稳定事实会影响后续决策

### 3. Episode

保存线程级阶段摘要，用于中断后恢复、跨会话续接和上下文压缩后继续工作。

它回答的是：

- 这条事情做到哪里了
- 已形成什么结论
- 下次该从哪里继续

这三层组合起来，让 FriClaw 不只是“记住聊天记录”，而是能在长期运行中持续供给正确上下文。

## 目录结构

```text
src/
  index.ts                # 程序入口
  onboard.ts              # 初始化向导
  dispatcher.ts           # 调度入口
  session/                # 会话管理
  memory/                 # 三层记忆与检索
  gateway/                # 飞书 / 企业微信 / 微信网关
  dashboard/              # Dashboard API
  cron/                   # 定时任务调度
  web/                    # Dashboard 前端

docs/
  Friclaw探索分享/        # 项目架构分享文档
  三层记忆方案详解.md      # 三层记忆详细设计
```

## 环境要求

- Bun
- Claude Code 可用运行环境
- 可选：Qdrant（用于向量检索）
- 至少配置一种消息网关，或仅使用本地 Dashboard

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 初始化配置

```bash
bun run init
```

初始化后会在 `~/.friclaw/` 下生成：

- `config.json`：主配置文件
- `memory/`：记忆目录
- `workspaces/`：会话工作空间
- `logs/`：日志目录

### 3. 平台接入配置

编辑 `~/.friclaw/config.json`，按需开启：

- `gateways.feishu`
- `gateways.wecom`
- `gateways.weixin`

各平台接入所需配置如下：

- 飞书：需要配置 `appId`、`appSecret`，如需事件加密与校验，还需要配置 `encryptKey`、`verificationToken`
- 企业微信：需要配置 `botId`、`secret`，[企业微信配置指南](./docs/企业微信配置指南.md)
- 微信：执行下面命令后扫码登录，会自动获取 token 写入到配置项：

```bash
bun run weixin-login
```

主要配置项：

```json
{
  "agent": {
    "model": "claude-sonnet-4-6",
    "summaryModel": "claude-haiku-4-5"
  },
  "memory": {
    "dir": "~/.friclaw/memory",
    "searchLimit": 10,
    "vectorEnabled": false,
    "vectorEndpoint": "http://localhost:6333"
  },
  "workspaces": {
    "dir": "~/.friclaw/workspaces",
    "sessionTimeout": 3600
  },
  "dashboard": {
    "enabled": true,
    "port": 3000
  },
  "gateways": {
    "feishu": {
      "enabled": false,
      "appId": "",
      "appSecret": "",
      "encryptKey": "",
      "verificationToken": ""
    },
    "wecom": {
      "enabled": false,
      "botId": "",
      "secret": ""
    },
    "weixin": {
      "enabled": false,
      "token": ""
    }
  }
}
```

环境变量可覆盖部分配置，例如：

- `PORT`
- `LOG_LEVEL`
- `FRICLAW_VECTOR_ENABLED`
- `FRICLAW_VECTOR_ENDPOINT`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_ENCRYPT_KEY`
- `FEISHU_VERIFICATION_TOKEN`
- `WECOM_BOT_ID`
- `WECOM_SECRET`
- `WEIXIN_BASE_URL`
- `WEIXIN_CDN_BASE_URL`
- `WEIXIN_TOKEN`

### 4. 启动 FriClaw

```bash
bun run start
```

如果未传入命令，默认也是 `start`。

### 5. 打开 Dashboard

默认情况下：

- Dashboard 前端：`http://localhost:5173`
- Dashboard API：`http://localhost:3000`
- WebSocket：`ws://localhost:3000/ws`

## 配置说明

配置文件默认路径：

```text
~/.friclaw/config.json
```

## 运行机制

### 会话与调度

- 外部消息先进入 Gateway
- Dispatcher 根据消息归属定位或创建会话
- 每个会话进入独立泳道，确保会话内串行
- Claude Code Agent 在该会话上下文中执行任务
- 执行结果通过原网关返回到用户

### 上下文续接

FriClaw 会尽量复用同一会话的执行上下文。

当上下文过大、会话过期或进程重启时，系统会先生成工作续接摘要，再基于摘要恢复到新的执行上下文中，避免任务中断。

### Dashboard

Dashboard 提供以下能力：

- 查看会话列表与历史消息
- 查看和编辑 `SOUL.md`
- 浏览 Knowledge / Episode 条目
- 管理 Cron 定时任务
- 管理网关配置
- 查看 token 统计

## 向量检索（可选）

如果希望增强记忆召回能力，可以启用向量检索。

1. 启动 Qdrant：

```bash
docker run -p 6333:6333 qdrant/qdrant
```

2. 在 `config.json` 中设置：

```json
{
  "memory": {
    "vectorEnabled": true,
    "vectorEndpoint": "http://localhost:6333"
  }
}
```

## 相关文档

- [架构探索分享](docs/Friclaw探索分享/FriClaw探索分享.md)
- [三层记忆方案详解](docs/三层记忆方案详解.md)

## 参考资源

感谢以下项目带来的启发：

- [NeoClaw 项目](https://github.com/amszuidas/neoclaw)
- [OpenClaw 项目](https://github.com/openclaw/openclaw)

## 许可证

Apache License 2.0
