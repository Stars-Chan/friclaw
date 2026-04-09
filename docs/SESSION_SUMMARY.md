# 会话摘要功能

FriClaw 实现了自动会话摘要功能，参考了 [NeoClaw](https://github.com/amszuidas/neoclaw) 项目的设计。

## 功能概述

会话摘要功能会自动记录你与 FriClaw 的对话历史，并在会话结束时生成结构化摘要，帮助你回顾和检索过往对话内容。

## 工作流程

### 1. 对话历史记录

每次对话都会自动保存到工作空间的历史目录：

```
~/.friclaw/workspaces/<session_id>/.firclaw/.history/
├── 2024-01-01.txt
├── 2024-01-02.txt
└── .last-summarized-offset
```

- 历史文件按日期分割（`YYYY-MM-DD.txt`）
- 每条消息包含时间戳、角色（user/assistant）和内容
- `.last-summarized-offset` 记录已摘要的位置，避免重复处理

### 2. 触发摘要生成

执行以下命令时会自动生成摘要：

- `/clear` - 清除当前会话并生成摘要
- `/new` - 创建新会话并为旧会话生成摘要

### 3. 摘要生成过程

1. **读取历史**：从历史文件中读取未摘要的对话内容
2. **内容过滤**：
   - 跳过少于 100 字符的对话
   - 截断超过 20,000 字符的对话（保留最后部分）
3. **调用 Claude**：使用配置的模型生成结构化摘要
4. **保存摘要**：保存到 `~/.friclaw/memory/episodes/` 目录
5. **建立索引**：更新 SQLite FTS5 全文索引

### 4. 摘要格式

生成的摘要采用 Markdown 格式，包含以下部分：

```markdown
---
title: "对话主题"
date: 2024-01-01
tags: [标签1, 标签2]
---

## 摘要
简要总结对话内容（2-4句话）

## 关键话题
- 话题 1
- 话题 2

## 决策与结果
- 决策或结果 1
- 决策或结果 2

## 重要信息
- 值得记住的重要事实、偏好或上下文
```

## 配置选项

在 `~/.friclaw/config.json` 中配置：

```json
{
  "agent": {
    "summaryModel": "claude-haiku-4-5",
    "summaryTimeout": 300
  }
}
```

### 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `summaryModel` | 用于生成摘要的模型 | `claude-haiku-4-5` |
| `summaryTimeout` | 摘要生成超时时间（秒） | `300` |

**模型选择建议**：
- `claude-haiku-4-5`：速度快、成本低，适合日常使用
- `claude-sonnet-4-6`：质量更高，适合重要对话

## 使用示例

### 基本使用

```
用户: 你好，帮我分析一下这个项目的架构
FriClaw: [详细分析...]

用户: 有什么改进建议吗？
FriClaw: [提供建议...]

用户: /clear
FriClaw: 会话已清除
```

此时会自动生成摘要并保存到 episodes 目录。

### 查看摘要

摘要保存在 `~/.friclaw/memory/episodes/` 目录，文件名格式：

```
2024-01-01_dashboard_chat123_1704096000000.md
```

你可以：
1. 直接查看文件内容
2. 通过 MCP 工具搜索：`memory_search` 查询相关内容
3. 使用 `memory_list` 列出所有摘要

## 技术实现

### 核心组件

1. **Summarizer** (`src/memory/summarizer.ts`)
   - 调用 Claude CLI 生成摘要
   - 使用 `--print` 模式（单次调用，无持久进程）

2. **EpisodeMemory** (`src/memory/episode.ts`)
   - 管理历史文件读取
   - 跟踪摘要偏移量
   - 保存摘要到文件系统

3. **Dispatcher** (`src/dispatcher.ts`)
   - 记录对话历史
   - 在 `/clear` 和 `/new` 时触发摘要生成

### 增量摘要

使用 `.last-summarized-offset` 文件跟踪每个历史文件的已摘要位置：

```json
{
  "2024-01-01.txt": 1234,
  "2024-01-02.txt": 5678
}
```

这样可以：
- 避免重复摘要相同内容
- 支持多次 `/clear` 操作
- 只处理新增的对话内容

## 故障处理

### 摘要生成失败

如果摘要生成失败（超时、API 错误等），系统会：
1. 记录警告日志
2. 不阻塞 `/clear` 或 `/new` 命令
3. 不更新偏移标记（下次会重试）

### 历史文件过大

对于超过 20,000 字符的对话：
- 自动截断，只保留最后 20,000 字符
- 确保摘要生成不会超时
- 在日志中记录截断信息

## 最佳实践

1. **定期清理会话**：使用 `/clear` 或 `/new` 结束长对话，生成摘要
2. **合理设置超时**：根据对话长度调整 `summaryTimeout`
3. **选择合适模型**：日常使用 haiku，重要对话使用 sonnet
4. **定期备份**：备份 `~/.friclaw/memory/episodes/` 目录

## 与 NeoClaw 的差异

FriClaw 的实现参考了 NeoClaw，但有以下改进：

1. **配置更灵活**：支持独立配置摘要模型和超时
2. **错误处理更健壮**：摘要失败不影响命令执行
3. **日志更详细**：记录摘要生成的详细信息
4. **类型安全**：完整的 TypeScript 类型定义

## 参考资源

- [NeoClaw 项目](https://github.com/amszuidas/neoclaw)
- [Claude Code 文档](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
