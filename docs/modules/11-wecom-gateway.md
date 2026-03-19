# 10 企业微信网关

## 目标

实现企业微信智能助手的消息收发，通过 WebSocket 长连接接收消息，支持流式分块输出。

## 企业微信消息流

```
企业微信服务器
  → WebSocket 长连接（长连接模式）
  → FriClaw 解析消息
  → Dispatcher 处理
  → 分块消息模拟流式输出
```

## 子任务

### 10.1 WebSocket 长连接

企业微信智能助手支持 WebSocket 长连接，无需公网服务器：

```typescript
// src/gateway/wecom.ts
export class WecomGateway implements Gateway {
  readonly kind = 'wecom'
  private ws: WebSocket | null = null
  private reconnectTimer: Timer | null = null

  async start(handler: MessageHandler): Promise<void> {
    await this.connect(handler)
  }

  private async connect(handler: MessageHandler): Promise<void> {
    // 获取 WebSocket 连接地址
    const endpoint = await this.getWsEndpoint()

    this.ws = new WebSocket(endpoint)

    this.ws.on('open', () => {
      logger.info('企业微信网关已连接')
      this.startHeartbeat()
    })

    this.ws.on('message', async (data) => {
      const event = JSON.parse(data.toString())
      await this.handleEvent(event, handler)
    })

    this.ws.on('close', () => {
      logger.warn('企业微信连接断开，5秒后重连')
      this.scheduleReconnect(handler)
    })

    this.ws.on('error', (err) => {
      logger.error('企业微信连接错误', err)
    })
  }
}
```

### 10.2 获取 WebSocket 端点

```typescript
private async getWsEndpoint(): Promise<string> {
  const token = await this.getAccessToken()
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/appchat/get_ws_url?access_token=${token}`
  )
  const data = await res.json()
  return data.url
}
```

### 10.3 消息解析

```typescript
private async handleEvent(event: any, handler: MessageHandler): Promise<void> {
  // 心跳响应
  if (event.MsgType === 'heartbeat') {
    this.ws?.send(JSON.stringify({ MsgType: 'heartbeat_response' }))
    return
  }

  // 普通消息
  if (event.MsgType === 'text' || event.MsgType === 'image') {
    const msg: InboundMessage = {
      id: event.MsgId,
      text: event.Content || '',
      chatId: event.FromUserName,
      authorId: event.FromUserName,
      gatewayKind: 'wecom',
      chatType: 'private',
      attachments: event.MsgType === 'image'
        ? await this.downloadImage(event.MediaId)
        : [],
    }

    const reply = this.buildReplyFn(msg)
    const streamHandler = this.buildStreamHandler(msg)
    await handler(msg, reply, streamHandler)
  }
}
```

### 10.4 流式输出（分块模拟）

企业微信不支持原生流式卡片，通过分块发送消息模拟流式效果：

```typescript
private buildStreamHandler(msg: InboundMessage): StreamHandler {
  let buffer = ''
  let lastSentLength = 0
  let messageId: string | null = null

  const flush = createDebouncedFlush(async (text: string) => {
    const newContent = text.slice(lastSentLength)
    if (!newContent) return

    if (!messageId) {
      // 首次发送
      messageId = await this.sendMessage(msg.chatId, text)
    } else {
      // 更新消息（企业微信支持消息撤回+重发模拟更新）
      await this.updateMessage(msg.chatId, messageId, text)
    }
    lastSentLength = text.length
  }, 500)

  return async (stream) => {
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        buffer += event.text
        flush(buffer)
      } else if (event.type === 'done') {
        flush.cancel()
        // 发送最终完整内容
        await this.sendMessage(msg.chatId, buffer)
      }
    }
  }
}
```

### 10.5 发送消息

```typescript
async send(chatId: string, content: MessageContent): Promise<string> {
  const token = await this.getAccessToken()
  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
    {
      method: 'POST',
      body: JSON.stringify({
        touser: chatId,
        msgtype: 'text',
        agentid: this.config.agentId,
        text: { content: content.text },
      })
    }
  )
  const data = await res.json()
  return data.msgid
}
```

### 10.6 心跳保活

```typescript
private startHeartbeat(): void {
  this.heartbeatTimer = setInterval(() => {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ MsgType: 'heartbeat' }))
    }
  }, 30_000) // 每 30 秒发送心跳
}
```

### 10.7 自动重连

```typescript
private scheduleReconnect(handler: MessageHandler): void {
  if (this.reconnectTimer) return
  this.reconnectTimer = setTimeout(async () => {
    this.reconnectTimer = null
    await this.connect(handler)
  }, 5_000)
}
```

### 10.8 与飞书网关的差异

| 特性 | 飞书 | 企业微信 |
|------|------|---------|
| 流式输出 | 原生卡片更新 | 分块消息模拟 |
| 话题群 | 支持 | 不支持 |
| 图片发送 | 支持 | 支持 |
| 交互表单 | 卡片按钮 | Markdown 选项 |

## 验收标准

- 消息正常收发
- 断线自动重连
- 流式分块输出正常
- 图片消息正确处理
