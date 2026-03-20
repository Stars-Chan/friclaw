// src/gateway/feishu.ts
import lark from '@larksuiteoapi/node-sdk'
import { logger } from '../utils/logger'
import type { Dispatcher, StreamHandler } from '../dispatcher'
import type { Gateway } from './types'
import type { Message, MessageType } from '../types/message'
import { unlinkSync } from 'node:fs'

interface FeishuConfig {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
}

export class FeishuGateway implements Gateway {
  readonly kind = 'feishu'
  private client: lark.Client | null = null
  private wsClient: lark.WSClient | null = null
  private dispatcher: Dispatcher | null = null

  constructor(private config: FeishuConfig) {}

  async start(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher
    this.client = new lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    })

    const eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey ?? '',
      verificationToken: this.config.verificationToken ?? '',
    }).register({
      'im.message.receive_v1': async (event: unknown) => {
        const msg = await this.parseMessage(event as Record<string, unknown>)
        if (!msg) return

        const reply = (content: string) => {
          logger.info({ content, conversationId: msg.chatId }, '飞书回复')
          return this.send(msg.chatId, content)
        }
        const streamHandler = this.buildStreamHandler(msg)
        await dispatcher.dispatch(msg, reply, streamHandler)
      },
      'im.message.message_read_v1': async () => {},
    })

    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      eventDispatcher,
    } as never)

    await this.wsClient.start({ eventDispatcher })
    logger.info('飞书网关已连接')
  }

  async stop(): Promise<void> {
    this.wsClient = null
    this.client = null
    this.dispatcher = null
    logger.info('飞书网关已停止')
  }

  async send(chatId: string, content: string): Promise<string> {
    if (!this.client) throw new Error('Client not initialized')

    const res = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    })

    return (res.data as { message_id: string }).message_id
  }

  private async parseMessage(event: Record<string, unknown>): Promise<Message | null> {
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

    const messageType = message.message_type as string
    let text = ''
    let attachments: unknown[] = []
    let msgType: MessageType = 'text'

    if (messageType === 'text') {
      text = ((content.text as string) ?? '').trim()
      msgType = text.startsWith('/') ? 'command' : 'text'
    } else if (messageType === 'image') {
      attachments = await this.extractAttachments(message, content)
      msgType = 'image'
    }

    const threadRootId = message.root_id as string | null | undefined
    const chatId = threadRootId
      ? `${message.chat_id}:${threadRootId}`
      : (message.chat_id as string)

    const senderId = (sender.sender_id as Record<string, string>).user_id
    const chatType = message.chat_type === 'group' ? 'group' : 'private'

    return {
      platform: 'feishu',
      chatId,
      userId: senderId,
      type: msgType,
      content: text,
      messageId: message.message_id as string,
      chatType,
      attachments,
    }
  }

  private async extractAttachments(
    message: Record<string, unknown>,
    content: Record<string, unknown>
  ): Promise<unknown[]> {
    if (!this.client) return []

    const imageKey = content.image_key as string
    if (!imageKey) return []

    try {
      const res = await this.client.im.messageResource.get({
        params: { type: 'image' },
        path: {
          message_id: message.message_id as string,
          file_key: imageKey,
        },
      })

      // Handle both mock (string) and real SDK (object with writeFile) responses
      if (typeof res === 'string') {
        // Mock response in tests
        return [{ type: 'image', buffer: Buffer.from(res, 'base64') }]
      } else if (res && typeof res.writeFile === 'function') {
        // Real SDK response - save to temp file and read
        const tmpPath = `/tmp/friclaw_img_${Date.now()}.tmp`
        await res.writeFile(tmpPath)
        const buffer = await Bun.file(tmpPath).arrayBuffer()
        unlinkSync(tmpPath) // Clean up temp file
        return [{ type: 'image', buffer: Buffer.from(buffer) }]
      } else {
        logger.warn({ res }, 'Unexpected messageResource response type')
        return []
      }
    } catch (err) {
      logger.error({ err }, 'Failed to download Feishu image')
      return []
    }
  }

  private buildStreamHandler(msg: Message): StreamHandler {
    let cardId: string | null = null
    let buffer = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flush = async (text: string) => {
      if (flushTimer) clearTimeout(flushTimer)
      flushTimer = setTimeout(async () => {
        if (!cardId) {
          cardId = await this.createStreamCard(msg.chatId, text, msg.messageId)
        } else {
          await this.updateStreamCard(cardId, text)
        }
        flushTimer = null
      }, 300)
    }

    return async (stream) => {
      for await (const event of stream) {
        if (event.type === 'text_delta') {
          buffer += (event.text as string) ?? ''
          flush(buffer)
        } else if (event.type === 'ask_questions') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
          await this.sendInteractiveForm(msg.chatId, event.questions as string[], msg.messageId)
        } else if (event.type === 'done') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
          logger.info({ content: buffer, conversationId: msg.chatId }, '飞书流式回复完成')
          if (cardId) await this.finalizeCard(cardId, buffer)
        }
      }
    }
  }

  private async createStreamCard(chatId: string, text: string, rootId?: string): Promise<string> {
    if (!this.client) throw new Error('Client not initialized')

    const card = this.buildCardJson(text, false)
    const res = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
        uuid: rootId ?? undefined,
      },
    })

    return (res.data as { message_id: string }).message_id
  }

  private async updateStreamCard(cardId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')

    const card = this.buildCardJson(text, false)
    await this.client.im.message.update({
      path: { message_id: cardId },
      data: {
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    })
  }

  private async finalizeCard(cardId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')

    const card = this.buildCardJson(text, true)
    await this.client.im.message.update({
      path: { message_id: cardId },
      data: {
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    })
  }

  private buildCardJson(text: string, isFinished: boolean): Record<string, unknown> {
    return {
      schema: '2.0',
      body: {
        elements: [
          {
            tag: 'markdown',
            content: text,
          },
        ],
      },
      header: {
        title: {
          tag: 'plain_text',
          content: isFinished ? 'FriClaw' : 'FriClaw ✍️',
        },
        template: 'blue',
      },
    }
  }

  private async sendInteractiveForm(
    chatId: string,
    questions: string[],
    rootId?: string
  ): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')

    const options = questions.map((q, i) => ({
      text: { tag: 'plain_text', content: q },
      value: `option_${i}`,
    }))

    const card = {
      schema: '2.0',
      body: {
        elements: [
          {
            tag: 'action',
            actions: [
              {
                tag: 'static_select',
                placeholder: { tag: 'plain_text', content: '请选择' },
                options,
              },
            ],
          },
        ],
      },
      header: {
        title: { tag: 'plain_text', content: '请回答问题' },
        template: 'blue',
      },
    }

    await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
        uuid: rootId ?? undefined,
      },
    })
  }
}
