# FriClaw

> Friday + Claw — 专属于你的全能 AI 管家

FriClaw 不是一个通用聊天机器人，而是你的私人管家。它了解你的习惯、记住你的偏好、主动提醒你该做的事，并在你需要时调动一切工具帮你完成任务。

## 核心能力

- **随时可达** — 通过飞书、企业微信接入，无需切换工具
- **深度理解** — 基于 Claude Code 的强大推理能力，理解复杂意图，执行多步骤任务
- **长期记忆** — 三层记忆系统持久化你的偏好、知识和历史，越用越懂你
- **会话摘要** — 自动生成会话摘要，在 `/clear` 或 `/new` 时保存对话记录
- **主动服务** — 基于模式识别主动提醒、定时执行任务，而不只是被动响应
- **工具全能** — MCP 协议支持无限扩展工具能力，脚本、文件、API 一手掌控

## 项目状态

🚧 开发中，当前处于 MVP 阶段

## 快速开始

**前置条件**

- [Bun](https://bun.sh/) >= 1.1
- [Claude Code](https://claude.ai/code) 已安装并配置key

**安装**

```bash
git clone git@github.com:Stars-Chan/friclaw.git
cd friclaw
bun install
```

**配置**

```bash
cp config.example.json ~/.friclaw/config.json
# 编辑 config.json，填入飞书 / 企业微信凭证
```

**运行**

```bash
bun run start
```

Dashboard 默认运行在 `http://localhost:3000`。

## 架构概览

```
飞书 / 企业微信  →  Dispatcher  →  Claude Code Agent
                                        ↓
                              内存系统 / MCP / 定时任务
```

详细设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 网关配置

FriClaw 支持通过飞书、企业微信、微信三个平台接入消息。网关配置位于 `~/.friclaw/config.json` 的 `gateways` 字段，也可通过 Dashboard 设置页面管理。

**飞书**

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用 |
| `appId` | 飞书应用 App ID |
| `appSecret` | 飞书应用 App Secret |
| `encryptKey` | 加密密钥 |
| `verificationToken` | 验证 Token |

**企业微信**

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用 |
| `botId` | 机器人 ID |
| `secret` | 应用 Secret |

**微信**

| 字段 | 说明 |
|------|------|
| `enabled` | 是否启用 |
| `token` | Bot Token（通过扫码登录自动获取） |

微信接入需要先完成扫码登录，获取 Bot Token 后才能启用。运行以下命令，扫描终端中显示的二维码：

```bash
bun weixin-login
```

登录成功后，Bot Token 将自动写入 `~/.friclaw/config.json`，无需手动填写。

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript |
| LLM | Claude Code |
| 数据库 | SQLite + FTS5 |
| 协议 | MCP |

## 会话摘要

FriClaw 会自动记录对话历史，并在执行 `/clear` 或 `/new` 命令时生成会话摘要。

**工作原理**

1. 对话历史保存在 `~/.friclaw/workspaces/<session>/.firclaw/.history/` 目录
2. 每次对话都会追加到当天的历史文件中（按日期分文件）
3. 执行 `/clear` 或 `/new` 时，自动调用 Claude 生成结构化摘要
4. 摘要保存到 `~/.friclaw/memory/episodes/` 目录，并建立全文索引

**摘要内容包括**

- 对话主题和标题
- 2-4 句话的简要总结
- 关键话题列表
- 决策与结果
- 重要信息和上下文

**配置选项**

在 `~/.friclaw/config.json` 中可以配置：

```json
{
  "agent": {
    "summaryModel": "claude-haiku-4-5",
    "summaryTimeout": 300
  }
}
```

- `summaryModel`: 用于生成摘要的模型（默认 haiku，速度快成本低）
- `summaryTimeout`: 摘要生成超时时间（秒，默认 300）

## 许可证

Apache License 2.0

## 作者

Stars-Chan

## 参考资源
感谢以下项目的作者
- [NeoClaw 项目](https://github.com/amszuidas/neoclaw)
- [OpenClaw 项目](https://github.com/openclaw/openclaw)