// src/gateway/wecom.ts
import { logger } from '../utils/logger'
import type { Dispatcher, StreamHandler } from '../dispatcher'
import type { Gateway } from './types'
import type { Message } from '../types/message'
import { WeworkWsClient, type MessageCallback } from './wecom-ws-client'

interface WecomConfig {
  botId: string
  secret: string
  websocketUrl?: string
}

const STREAM_EXPIRY_MS = 5.5 * 60 * 1000
const STREAM_THROTTLE_MS = 500
const DEBOUNCE_MS = 2000
const MAX_SEEN_MSG_IDS = 10000
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

function generateStreamId(): string {
  return `stream_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
}

interface MessageBuffer {
  messages: MessageCallback[]
  timer: ReturnType<typeof setTimeout>
}

interface StreamEntry {
  streamId: string
  lastUsed: number
}

export class WecomGateway implements Gateway {
  readonly kind = 'wecom'

  private _client: WeworkWsClient
  private _dispatcher: Dispatcher | null = null

  private readonly messageBuffers = new Map<string, MessageBuffer>()
  private readonly seenMsgIds = new Set<string>()
  private readonly activeStreams = new Map<string, StreamEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: WecomConfig) {
    this._client = new WeworkWsClient({
      botId: config.botId,
      secret: config.secret,
      url: config.websocketUrl,
    })
  }

  async start(dispatcher: Dispatcher): Promise<void> {
    this._dispatcher = dispatcher

    this._client.on('open', () => logger.info('企业微信网关已连接'))
    this._client.on('subscribed', () => logger.info('企业微信订阅成功'))
    this._client.on('close', (code: number, reason: string) =>
      logger.warn({ code, reason }, '企业微信连接断开'))
    this._client.on('error', (err: Error) =>
      logger.error({ err }, '企业微信连接错误'))
    this._client.on('message', (msg: unknown) => {
      const m = msg as MessageCallback
      if ('eventType' in (msg as object)) return
      this._handleInboundMessage(m).catch((err) =>
        logger.error({ err }, '企业微信消息处理失败'))
    })

    this._client.connect()
    this._startCleanupTimer()
    // 不阻塞，连接在后台维持
  }

  async stop(): Promise<void> {
    this._dispatcher = null
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    for (const [, buf] of this.messageBuffers) clearTimeout(buf.timer)
    this.messageBuffers.clear()
    this.seenMsgIds.clear()
    this.activeStreams.clear()
    this._client.disconnect()
    logger.info('企业微信网关已停止')
  }

  private _startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, value] of this.activeStreams.entries()) {
        if (now - value.lastUsed > STREAM_EXPIRY_MS) {
          this.activeStreams.delete(key)
        }
      }
    }, CLEANUP_INTERVAL_MS)
  }

  async send(chatId: string, text: string): Promise<string> {
    const streamEntry = this.activeStreams.get(chatId)
    const reqId = streamEntry?.streamId ?? ''
    this._client.sendText({ reqId, text })
    return ''
  }

  private async _handleInboundMessage(wsMsg: MessageCallback): Promise<void> {
    if (this.seenMsgIds.has(wsMsg.msgId)) return
    this.seenMsgIds.add(wsMsg.msgId)
    if (this.seenMsgIds.size > MAX_SEEN_MSG_IDS) {
      const first = this.seenMsgIds.values().next().value
      if (first) this.seenMsgIds.delete(first)
    }

    const streamKey = wsMsg.chatType === 'group' ? wsMsg.chatId : wsMsg.fromUser
    const isCommand = wsMsg.msgType === 'text' && wsMsg.content?.trim().startsWith('/')

    if (isCommand) {
      this._processMessage(wsMsg, streamKey)
      return
    }

    const existing = this.messageBuffers.get(streamKey)
    if (existing) {
      existing.messages.push(wsMsg)
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => this._flushBuffer(streamKey), DEBOUNCE_MS)
    } else {
      this.messageBuffers.set(streamKey, {
        messages: [wsMsg],
        timer: setTimeout(() => this._flushBuffer(streamKey), DEBOUNCE_MS),
      })
    }
  }

  private _flushBuffer(streamKey: string): void {
    const buffer = this.messageBuffers.get(streamKey)
    if (!buffer) return
    this.messageBuffers.delete(streamKey)

    const { messages } = buffer
    const primary = messages[0]
    if (!primary) return

    if (messages.length > 1) {
      const merged = messages
        .map(m => (m.msgType === 'text' || m.msgType === 'mixed') ? (m.content ?? '') : '')
        .filter(Boolean)
        .join('\n')
      if (primary.msgType === 'text' || primary.msgType === 'mixed') {
        primary.content = merged
      }
      const allImageUrls = messages.flatMap(m =>
        m.msgType === 'image' ? (m.imageUrl ? [m.imageUrl] : []) : (m.imageUrls ?? [])
      )
      if (allImageUrls.length > 0) {
        primary.msgType = 'mixed'
        primary.imageUrls = allImageUrls
      }
    }

    this._processMessage(primary, streamKey)
  }

  private _processMessage(wsMsg: MessageCallback, streamKey: string): void {
    if (!this._dispatcher) return

    this.activeStreams.set(streamKey, { streamId: wsMsg.reqId, lastUsed: Date.now() })

    const chatId = wsMsg.chatType === 'group' ? wsMsg.chatId : wsMsg.fromUser
    const content = (wsMsg.msgType === 'text' || wsMsg.msgType === 'mixed')
      ? (wsMsg.content ?? '')
      : ''

    const msg: Message = {
      platform: 'wecom',
      chatId,
      userId: wsMsg.fromUser,
      type: wsMsg.msgType === 'image' ? 'image'
        : content.startsWith('/') ? 'command'
        : 'text',
      content,
      messageId: wsMsg.msgId,
      chatType: wsMsg.chatType === 'group' ? 'group' : 'private',
      attachments: wsMsg.msgType === 'image' && wsMsg.imageUrl
        ? [{ type: 'image', url: wsMsg.imageUrl }]
        : wsMsg.msgType === 'mixed' && wsMsg.imageUrls
        ? wsMsg.imageUrls.map(url => ({ type: 'image', url }))
        : [],
    }

    const reply = (text: string) => {
      logger.info({ content: text, conversationId: msg.chatId }, '企业微信回复')
      this._client.sendText({ reqId: wsMsg.reqId, text })
      this.activeStreams.delete(streamKey)
      return Promise.resolve('')
    }

    const streamHandler: StreamHandler = async (stream) => {
      let accText = ''
      let currentStreamId = generateStreamId()
      let streamStartedAt = Date.now()
      let dirty = false
      let flushTimer: ReturnType<typeof setTimeout> | null = null

      const ensureActiveStream = (): string => {
        if (Date.now() - streamStartedAt >= STREAM_EXPIRY_MS) {
          this._client.sendStream({ reqId: wsMsg.reqId, streamId: currentStreamId, content: accText || '...', finish: true })
          currentStreamId = generateStreamId()
          streamStartedAt = Date.now()
        }
        return currentStreamId
      }

      const flushDelta = (): void => {
        flushTimer = null
        if (!dirty) return
        dirty = false
        this._client.sendStream({ reqId: wsMsg.reqId, streamId: ensureActiveStream(), content: accText, finish: false })
      }

      const scheduleDelta = (): void => {
        dirty = true
        if (!flushTimer) flushTimer = setTimeout(flushDelta, STREAM_THROTTLE_MS)
      }

      for await (const evt of stream) {
        if (evt.type === 'text_delta') {
          accText += (evt.text as string) ?? ''
          scheduleDelta()
        } else if (evt.type === 'done') {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
          logger.info({ content: accText, conversationId: msg.chatId }, '企业微信流式回复完成')
          this._client.sendStream({ reqId: wsMsg.reqId, streamId: ensureActiveStream(), content: accText, finish: true })
          this.activeStreams.delete(streamKey)
        }
      }
    }

    this._dispatcher.dispatch(msg, reply, streamHandler).catch((err) => {
      logger.error({ err }, '企业微信 dispatch 失败')
      this._client.sendText({ reqId: wsMsg.reqId, text: '处理消息时出错，请稍后再试。' })
      this.activeStreams.delete(streamKey)
    })
  }
}
