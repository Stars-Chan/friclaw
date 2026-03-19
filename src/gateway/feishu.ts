// src/gateway/feishu.ts
import lark from '@larksuiteoapi/node-sdk'
import { logger } from '../utils/logger'
import type { Dispatcher } from '../dispatcher'
import type { Gateway } from './types'
import type { Message } from '../types/message'

interface FeishuConfig {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
}

export class FeishuGateway implements Gateway {
  readonly kind = 'feishu'

  constructor(private config: FeishuConfig) {}

  async start(dispatcher: Dispatcher): Promise<void> {
    const eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey ?? '',
      verificationToken: this.config.verificationToken ?? '',
    }).register({
      'im.message.receive_v1': async (event: unknown) => {
        const msg = this.parseMessage(event as Record<string, unknown>)
        if (!msg) return
        await dispatcher.dispatch(msg)
      },
      'im.message.message_read_v1': async () => {},
    })

    const wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      eventDispatcher,
    } as never)

    await wsClient.start()
    logger.info('飞书网关已连接')
  }

  async stop(): Promise<void> {
    logger.info('飞书网关已停止')
  }

  private parseMessage(event: Record<string, unknown>): Message | null {
    const message = event.message as Record<string, unknown>
    const sender = event.sender as Record<string, unknown>

    if (!['text', 'image'].includes(message.message_type as string)) return null

    let content: Record<string, unknown> = {}
    try {
      content = JSON.parse(message.content as string)
    } catch {
      return null
    }

    // Group chat: only respond when @mentioned
    if (message.chat_type === 'group') {
      const mentions = (content.mentions as Array<{ key: string }>) ?? []
      if (!mentions.some(m => m.key === '@_user_1')) return null
    }

    const text = ((content.text as string) ?? '').trim()
    const threadRootId = message.root_id as string | null | undefined
    const chatId = threadRootId
      ? `${message.chat_id}:${threadRootId}`
      : (message.chat_id as string)

    const senderId = (sender.sender_id as Record<string, string>).user_id

    return {
      platform: 'feishu',
      chatId,
      userId: senderId,
      type: text.startsWith('/') ? 'command' : 'text',
      content: text,
      messageId: message.message_id as string,
    }
  }
}
