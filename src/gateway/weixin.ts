// src/gateway/weixin.ts
import { logger } from '../utils/logger'
import type { Dispatcher } from '../dispatcher'
import type { Gateway } from './types'
import type { Message } from '../types/message'
import type { GetUpdatesResp, SendMessageReq, WeixinMessage } from './weixin-types'

const log = logger('weixin')

const MESSAGE_TYPE = {
  TEXT: 1,
  REPLY: 2,
} as const

const ITEM_TYPE = {
  TEXT: 1,
} as const

interface WeixinConfig {
  baseUrl: string
  cdnBaseUrl: string
  token: string
  uin?: string
  maxContextTokens?: number
}

export class WeixinGateway implements Gateway {
  readonly kind = 'weixin'
  private dispatcher: Dispatcher | null = null
  private abortController: AbortController | null = null
  private contextTokens = new Map<string, string>()
  private contextTokensOrder: string[] = []
  private maxContextTokens: number
  private retryCount = 0
  private readonly maxRetries = 10

  constructor(private config: WeixinConfig) {
    this.maxContextTokens = config.maxContextTokens ?? 1000
  }

  async start(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher
    this.abortController = new AbortController()

    log.info('微信 gateway 启动')
    await this.longPoll()
  }

  async stop(): Promise<void> {
    this.abortController?.abort()
    log.info('微信 gateway 停止')
  }

  async send(chatId: string, content: string): Promise<string> {
    await this.sendMessage(chatId, content)
    return 'ok'
  }

  private async longPoll(): Promise<void> {
    let buf = ''
    while (!this.abortController?.signal.aborted) {
      try {
        const resp = await fetch(`${this.config.baseUrl}/ilink/bot/getupdates`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify({ get_updates_buf: buf }),
          signal: this.abortController?.signal,
        })

        if (!resp.ok) {
          log.error({ status: resp.status, statusText: resp.statusText }, 'HTTP 请求失败')
          await this.backoff()
          continue
        }

        const data = await resp.json() as GetUpdatesResp

        // 检查是否有错误码
        if (data.ret !== undefined && data.ret !== 0) {
          log.error({ errcode: data.errcode, errmsg: data.errmsg, ret: data.ret }, '获取消息失败')
          await this.backoff()
          continue
        }

        this.retryCount = 0
        buf = data.get_updates_buf ?? buf
        for (const msg of data.msgs ?? []) {
          await this.handleMessage(msg)
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') break
        log.error({ err }, '长轮询错误')
        await this.backoff()
      }
    }
  }

  private async backoff(): Promise<void> {
    if (this.retryCount >= this.maxRetries) {
      log.error('达到最大重试次数，停止长轮询')
      this.abortController?.abort()
      return
    }
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 60000)
    this.retryCount++
    await new Promise(r => setTimeout(r, delay))
  }

  private async handleMessage(msg: WeixinMessage): Promise<void> {
    if (!msg.from_user_id) return

    if (msg.message_type !== MESSAGE_TYPE.TEXT) return

    const text = msg.item_list?.find(i => i.type === ITEM_TYPE.TEXT)?.text_item?.text
    if (!text) return

    const fromUserId = msg.from_user_id

    if (msg.context_token) {
      const existingIndex = this.contextTokensOrder.indexOf(fromUserId)
      if (existingIndex !== -1) {
        this.contextTokensOrder.splice(existingIndex, 1)
      }

      this.contextTokens.set(fromUserId, msg.context_token)
      this.contextTokensOrder.push(fromUserId)

      if (this.contextTokens.size > this.maxContextTokens) {
        const oldestKey = this.contextTokensOrder.shift()
        if (oldestKey) {
          this.contextTokens.delete(oldestKey)
        }
      }
    }

    const message: Message = {
      platform: 'weixin',
      messageId: String(msg.message_id ?? Date.now()),
      chatId: fromUserId,
      userId: fromUserId,
      content: text,
      type: 'text',
    }

    await this.dispatcher?.dispatch(message, async (content) => {
      await this.sendMessage(fromUserId, content)
      return 'ok'
    })
  }

  private async sendMessage(toUserId: string, content: string): Promise<void> {
    const contextToken = this.contextTokens.get(toUserId)
    const req: SendMessageReq = {
      msg: {
        to_user_id: toUserId,
        ...(contextToken && { context_token: contextToken }),
        message_type: MESSAGE_TYPE.REPLY,
        message_state: 2,
        item_list: [{ type: ITEM_TYPE.TEXT, text_item: { text: content }, is_completed: true }],
        client_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      },
    }

    const resp = await fetch(`${this.config.baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(req),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      log.error({ status: resp.status, toUserId, errorText }, '发送消息失败')
      throw new Error(`发送消息失败: ${resp.status}`)
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${this.config.token}`,
    }
    if (this.config.uin) {
      headers['X-WECHAT-UIN'] = this.config.uin
    }
    return headers
  }
}
