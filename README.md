# FriClaw

> Friday + Claw — 专属于你的全能 AI 管家

FriClaw 不是一个通用聊天机器人，而是你的私人管家。它了解你的习惯、记住你的偏好、主动提醒你该做的事，并在你需要时调动一切工具帮你完成任务。

## 核心能力

- **随时可达** — 通过飞书、企业微信接入，无需切换工具
- **深度理解** — 基于 Claude Code 的强大推理能力，理解复杂意图，执行多步骤任务
- **长期记忆** — 三层记忆系统持久化你的偏好、知识和历史，越用越懂你
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

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript |
| LLM | Claude Code |
| 数据库 | SQLite + FTS5 |
| 协议 | MCP |

## 许可证

Apache License 2.0

## 作者

Stars-Chan

### B. 参考资源
- [NeoClaw 项目](https://github.com/amszuidas/neoclaw)
- [OpenClaw 项目](https://github.com/openclaw/openclaw)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [飞书开放平台](https://open.feishu.cn/)
- [企业微信 API](https://developer.work.weixin.qq.com/)
- [Claude API](https://docs.anthropic.com/)