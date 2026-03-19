# 01 项目初始化 & 架构搭建

## 目标

搭建 FriClaw 的基础骨架：目录结构、TypeScript 配置、入口文件、进程管理框架。

## 子任务

### 1.1 初始化 Bun 项目

```bash
bun init -y
```

修改 `package.json`：

```json
{
  "name": "friclaw",
  "version": "0.1.0",
  "scripts": {
    "start": "bun run src/index.ts",
    "dev": "bun --watch src/index.ts"
  }
}
```

### 1.2 配置 TypeScript

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### 1.3 创建目录结构

```
src/
├── index.ts          # 入口：启动所有子系统
├── config.ts         # 配置加载
├── dispatcher.ts     # 消息路由
├── daemon.ts         # 守护进程 & 优雅退出
├── gateway/          # 网关层
├── session/          # 会话管理
├── agent/            # Claude Code Agent
├── memory/           # 三层记忆
├── mcp/              # MCP 框架
├── cron/             # 定时任务
├── dashboard/        # Web Dashboard
└── utils/            # 工具函数
```

### 1.4 实现入口文件

`src/index.ts` 负责按顺序启动各子系统：

1. 加载配置 (`config.ts`)
2. 初始化内存系统
3. 启动 MCP 服务
4. 启动网关 Worker
5. 启动 Dashboard WebSocket 服务
6. 注册进程信号处理（SIGTERM / SIGINT）

```typescript
// src/index.ts 骨架
import { loadConfig } from './config'
import { MemoryManager } from './memory/manager'
import { Dispatcher } from './dispatcher'
import { startDashboard } from './dashboard/api'

async function main() {
  const config = await loadConfig()
  const memory = new MemoryManager(config.memory)
  await memory.init()

  const dispatcher = new Dispatcher(config, memory)
  await dispatcher.start()

  await startDashboard(config.port, dispatcher)

  process.on('SIGTERM', () => dispatcher.shutdown())
  process.on('SIGINT', () => dispatcher.shutdown())
}

main().catch(console.error)
```

### 1.5 实现守护进程 (daemon.ts)

负责优雅退出：
- 收到 SIGTERM/SIGINT 后，先停止接收新消息
- 等待所有 Lane Queue 中的任务处理完毕（最多 30s）
- 关闭数据库连接
- 退出进程

### 1.6 安装核心依赖

```bash
bun add better-sqlite3 @anthropic-ai/sdk zod pino
bun add -d @types/better-sqlite3
```

## 验收标准

- `bun run start` 能正常启动，打印启动日志
- SIGTERM 能触发优雅退出，日志显示各子系统关闭顺序
- TypeScript 编译无报错
