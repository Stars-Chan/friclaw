# 13 Web Dashboard

## 目标

实现基于 React 的本地 Web 管理界面，通过 WebSocket 与 FriClaw 核心通信，提供实时监控和管理能力。

## 页面结构

```
Dashboard
├── 聊天 (Chat)          ← 直接与 AI 对话
├── 监控 (Monitor)       ← 系统状态、网关状态
├── 记忆 (Memory)        ← 浏览和编辑记忆
├── 定时任务 (Cron)      ← 管理定时任务
└── 设置 (Settings)      ← 配置管理
```

## 子任务

### 13.1 项目初始化

```bash
cd src/dashboard
bun create vite ui --template react-ts
cd ui
bun add tailwindcss lucide-react react-markdown
```

### 13.2 后端 WebSocket 服务

```typescript
// src/dashboard/api.ts
import { WebSocketServer } from 'ws'
import { createServer } from 'node:http'

export function startDashboard(port: number, dispatcher: Dispatcher): void {
  const server = createServer((req, res) => {
    // 生产模式：托管前端静态文件
    if (req.url === '/health') {
      res.writeHead(200)
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }))
      return
    }
    serveStatic(req, res)
  })

  const wss = new WebSocketServer({ server })
  const registry = new ClientRegistry()

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString())
      await handleClientMessage(msg, ws, registry, dispatcher)
    })
    ws.on('close', () => registry.remove(ws))
  })

  server.listen(port, () => {
    logger.info(`Dashboard 运行在 http://localhost:${port}`)
  })
}
```

### 13.3 消息协议

**客户端 → 服务端：**

```typescript
// 握手
{ type: 'hello', clientType: 'webchat' | 'dashboard' }

// 发送消息
{ type: 'message', text: string, conversationId: string }

// 查询记忆
{ type: 'memory_search', query: string, category?: string }

// 创建定时任务
{ type: 'cron_create', name: string, schedule: string, message: string }
```

**服务端 → 客户端：**

```typescript
// 欢迎消息（连接后立即发送）
{ type: 'welcome', state: SystemState }

// 流式响应
{ type: 'stream_delta', text: string, conversationId: string }
{ type: 'stream_done', conversationId: string }

// 系统状态变更
{ type: 'gateway_status', gateway: string, status: 'online' | 'offline' }
{ type: 'cron_triggered', jobId: string, jobName: string }
```

### 13.4 聊天页面

核心功能：
- 会话列表（左侧边栏）
- 消息流（中央，支持 Markdown 渲染）
- 输入框（底部，支持 Shift+Enter 换行）
- 实时流式输出（打字机效果）

```typescript
// src/dashboard/ui/pages/Chat.tsx
function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const { send, stream } = useWebSocket()

  const handleSend = () => {
    send({ type: 'message', text: input, conversationId: 'dashboard' })
    setInput('')
  }

  // 监听流式响应
  useEffect(() => {
    stream.on('stream_delta', ({ text }) => {
      setMessages(prev => appendToLast(prev, text))
    })
  }, [])

  return (/* JSX */)
}
```

### 13.5 监控页面

展示：
- 各网关在线状态（飞书、企业微信）
- 活跃会话数
- 今日消息量
- 路由统计（各模型使用比例）
- 最近错误日志

### 13.6 记忆管理页面

- 分类浏览（Identity / Knowledge / Episode）
- 搜索记忆
- 编辑 Knowledge 条目
- 查看 Episode 历史

### 13.7 定时任务页面

- 任务列表（名称、计划、上次/下次执行时间）
- 启用/禁用开关
- 新建任务表单
- 手动触发按钮
- 执行历史

### 13.8 前后端联调

开发模式：Vite 代理 WebSocket 到后端

```typescript
// vite.config.ts
export default {
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      }
    }
  }
}
```

生产模式：后端直接托管 `dist/` 静态文件。

## 验收标准

- 聊天功能正常，流式输出无卡顿
- 网关状态实时更新
- 记忆可浏览和搜索
- 定时任务可创建和管理
- 生产模式单端口托管
