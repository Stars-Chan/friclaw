# 会话摘要功能验证指南

## 1. 重启服务

```bash
# 停止当前服务（如果正在运行）
pkill -f "bun.*friclaw"

# 启动服务
cd /Volumes/ZHITAI/worksplace/claw/friclaw
bun run start
```

## 2. 测试对话历史记录

### 发送几条消息

在 Dashboard 或飞书中发送几条消息，例如：

```
你好，我想测试会话摘要功能
请帮我解释一下这个功能是如何工作的
```

### 检查历史文件

```bash
# 查找最新的会话目录
ls -lt ~/.friclaw/workspaces/ | head -5

# 查看历史文件（替换为你的会话目录）
ls -lh ~/.friclaw/workspaces/dashboard_session_*/. firclaw/.history/

# 查看历史内容
cat ~/.friclaw/workspaces/dashboard_session_*/.firclaw/.history/*.txt
```

你应该看到类似这样的内容：

```
[2026-04-10T00:50:00.000Z] [user] 你好，我想测试会话摘要功能

[2026-04-10T00:50:05.000Z] [assistant] 你好！会话摘要功能会自动记录...

[2026-04-10T00:50:30.000Z] [user] 请帮我解释一下这个功能是如何工作的

[2026-04-10T00:50:35.000Z] [assistant] 这个功能的工作流程是...
```

## 3. 测试摘要生成

### 执行 /clear 或 /new 命令

```
/clear
```

或

```
/new
```

### 检查摘要文件

```bash
# 查看 episodes 目录
ls -lh ~/.friclaw/memory/episodes/

# 查看最新的摘要
cat ~/.friclaw/memory/episodes/*.md | tail -50
```

你应该看到类似这样的摘要：

```markdown
---
title: "测试会话摘要功能"
date: 2026-04-10
tags: [测试, 功能验证]
---

## 摘要
用户测试了会话摘要功能，询问了功能的工作原理和使用方法。

## 关键话题
- 会话摘要功能测试
- 功能工作原理

## 决策与结果
- 确认功能正常工作

## 重要信息
- 用户对会话摘要功能感兴趣
```

## 4. 查看日志

如果遇到问题，查看日志：

```bash
# 查看最新日志
tail -100 ~/.friclaw/logs/*.log | grep -E "(history|summariz|episode)"
```

## 5. 常见问题

### 问题：历史文件没有创建

**可能原因：**
- 服务没有重启，还在运行旧代码
- 消息没有正确路由到 dispatcher

**解决方法：**
```bash
# 确保服务已重启
pkill -f "bun.*friclaw"
bun run start

# 检查日志
tail -f ~/.friclaw/logs/*.log
```

### 问题：摘要没有生成

**可能原因：**
- 对话内容太短（少于 100 字符）
- Claude CLI 不可用
- 摘要生成超时

**解决方法：**
```bash
# 检查 Claude CLI
claude --version

# 查看摘要生成日志
tail -100 ~/.friclaw/logs/*.log | grep summariz
```

### 问题：摘要生成失败但不影响 /clear

这是正常的！摘要生成采用"最佳努力"策略，失败不会阻塞命令执行。

## 6. 调试模式

如果需要更详细的日志，修改配置：

```json
{
  "logging": {
    "level": "debug"
  }
}
```

然后重启服务。

## 7. 手动测试摘要生成

```bash
# 创建测试历史文件
mkdir -p /tmp/test-workspace/.firclaw/.history
cat > /tmp/test-workspace/.firclaw/.history/2026-04-10.txt << 'EOF'
[2026-04-10T00:00:00Z] [user] 你好，我想了解 FriClaw 的功能

[2026-04-10T00:00:05Z] [assistant] FriClaw 是一个 AI 助手平台，主要功能包括：
1. 多平台接入
2. 长期记忆
3. 会话摘要
4. 定时任务

[2026-04-10T00:01:00Z] [user] 会话摘要是如何工作的？

[2026-04-10T00:01:10Z] [assistant] 会话摘要会在你执行 /clear 或 /new 时自动生成，使用 Claude 分析对话内容并生成结构化摘要。
EOF

# 使用 Claude CLI 测试摘要生成
claude --model claude-haiku-4-5 -p "分析以下对话并生成摘要：$(cat /tmp/test-workspace/.firclaw/.history/2026-04-10.txt)"
```

## 8. 验证完整流程

1. ✅ 重启服务
2. ✅ 发送 3-5 条消息
3. ✅ 检查历史文件是否创建
4. ✅ 执行 `/clear` 或 `/new`
5. ✅ 检查 episodes 目录是否有新摘要
6. ✅ 查看摘要内容是否正确

如果所有步骤都通过，说明功能正常工作！
