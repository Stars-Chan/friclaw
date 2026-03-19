# 09 飞书网关

## 目标

实现飞书（Lark）平台的消息收发，支持私聊、群聊、话题群，以及流式卡片输出。

## 飞书消息流

```
飞书服务器
  → WebSocket 长连接推送事件
  → FriClaw 解析消息
  → Dispatcher 处理
  → 流式卡片更新回飞书
```

## 子任务

### 9.1 WebSocket 长连接

飞书支持 WebSocket 长连接接收事件，无需公网服务器：

```typescript
// src/gateway/feishu.ts
export class FeishuGateway implements Gateway {
  readonly kind = 'feishu'
  private client: lark.Client
  private wsClient: lark.WSClient

  async start(handler: MessageHandler): Promise<void> {
    this.client = new lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    })

    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      eventDispatcher: this.buildEventDispatcher(handler),
    })

    await this.wsClient.start()
    logger.info('飞书网关已连接')
  }
}
```

### 9.2 事件解析

处理飞书的消息事件，转换为统一的 `InboundMessage` 格式：

```typescript
private buildEventDispatcher(handler: MessageHandler): lark.EventDispatcher {
  return new lark.EventDispatcher({
    encryptKey: this.config.encryptKey,
    verificationToken: this.config.verificationToken,
  }).register({
    'im.message.receive_v1': async (event) => {
      const msg = this.parseMessage(event)
      if (!msg) return

      const reply = this.buildReplyFn(msg)
      const streamHandler = this.buildStreamHandler(msg)
      await handler(msg, reply, streamHandler)
    },
    'im.message.message_read_v1': async () => {
      // 忽略已读回执
    },
  })
}

private parseMessage(event: any): InboundMessage | null {
  const { message, sender } = event

  // 过滤非文本/图片消息
  if (!['text', 'image'].includes(message.message_type)) return null

  // 群聊需要 @机器人 才触发
  if (message.chat_type === 'group') {
    const content = JSON.parse(message.content)
    const hasMention = content.mentions?.some(
      (m: any) => m.key === '@_user_1' // 机器人自身
    )
    if (!hasMention) return null
  }

  return {
    id: message.message_id,
    text: this.extractText(message),
    chatId: message.chat_id,
    threadRootId: message.root_id || undefined,
    authorId: sender.sender_id.user_id,
    authorName: sender.sender_id.user_id,
    gatewayKind: 'feishu',
    chatType: message.chat_type === 'p2p' ? 'private' : 'group',
    attachments: this.extractAttachments(message),
  }
}
```

### 9.3 流式卡片输出

飞书支持通过更新卡片实现流式输出效果：

```typescript
private buildStreamHandler(msg: InboundMessage): StreamHandler {
  let cardId: string | null = null
  let buffer = ''
  const flush = createDebouncedFlush(async (text: string) => {
    if (!cardId) {
      // 首次：创建卡片
      cardId = await this.createStreamCard(msg.chatId, text, msg.threadRootId)
    } else {
      // 后续：更新卡片内容
      await this.updateStreamCard(cardId, text)
    }
  }, 300) // 300ms 防抖，避免更新过于频繁

  return async (stream) => {
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        buffer += event.text
        flush(buffer)
      } else if (event.type === 'ask_questions') {
        await this.sendInteractiveForm(msg.chatId, event.questions, msg.threadRootId)
      } else if (event.type === 'done') {
        flush.cancel()
        // 最终更新，标记完成状态
        if (cardId) await this.finalizeCard(cardId, buffer)
      }
    }
  }
}
```

### 9.4 卡片模板

流式卡片使用飞书卡片 JSON 格式：

```typescript
private buildCardJson(text: string, isFinished: boolean): object {
  return {
    schema: '2.0',
    body: {
      elements: [{
        tag: 'markdown',
        content: text,
      }]
    },
    header: {
      title: { tag: 'plain_text', content: isFinished ? 'FriClaw' : 'FriClaw ✍️' },
      template: 'blue',
    }
  }
}
```

### 9.5 图片下载

飞书图片需要通过 API 下载后转为 base64 传给 Claude Code：

```typescript
private async extractAttachments(message: any): Promise<Attachment[]> {
  if (message.message_type !== 'image') return []

  const content = JSON.parse(message.content)
  const buffer = await this.client.im.messageResource.get({
    message_id: message.message_id,
    file_key: content.image_key,
    type: 'image',
  })

  return [{ type: 'image', buffer: Buffer.from(buffer) }]
}
```

### 9.6 发送普通消息

```typescript
async send(chatId: string, content: MessageContent): Promise<void> {
  await this.client.im.message.create({
    receive_id_type: 'chat_id',
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: content.text }),
    }
  })
}
```

### 9.7 话题群支持

话题群（Thread）通过 `threadRootId` 区分不同话题，每个话题对应独立会话：

```typescript
// conversationId = chatId + ':' + threadRootId（话题群）
// conversationId = chatId（普通群/私聊）
const conversationId = msg.threadRootId
  ? `${msg.chatId}:${msg.threadRootId}`
  : msg.chatId
```

## 依赖安装

```bash
bun add @larksuiteoapi/node-sdk
```

## 验收标准

- 私聊消息正常收发
- 群聊 @机器人 触发响应
- 话题群不同话题独立会话
- 流式卡片正确更新
- 图片消息正确传递给 Claude Code
