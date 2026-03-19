// src/gateway/wecom.ts
import WebSocket from 'ws'
import { logger } from '../utils/logger'
import type { Dispatcher } from '../dispatcher'
import type { Gateway } from './types'
import type { Message } from '../types/message'

interface WecomConfig {
  corpId: string
  agentId: number
  secret: string
}

export class WecomGateway implements Gateway {
  readonly kind = 'wecom'
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private accessToken: string | null = null
  private tokenExpiresAt = 0

  constructor(private config: WecomConfig) {}

  async start(dispatcher: Dispatcher): Promise<void> {
    await this.connect(dispatcher)
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    try { this.ws?.close() } catch {}
    logger.info('企业微信网关已停止')
  }

  private async connect(dispatcher: Dispatcher): Promise<void> {
    const endpoint = await this.getWsEndpoint()
    this.ws = new WebSocket(endpoint)

    this.ws.on('open', () => {
      logger.info('企业微信网关已连接')
      this.startHeartbeat()
    })

    this.ws.on('message', async (data: Buffer) => {
      let event: Record<string, unknown>
      try { event = JSON.parse(data.toString()) } catch { return }
      await this.handleEvent(event, dispatcher)
    })

    this.ws.on('close', () => {
      logger.warn('企业微信连接断开，5秒后重连')
      if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
      this.scheduleReconnect(dispatcher)
    })

    this.ws.on('error', (err: Error) => {
      logger.error({ err }, '企业微信连接错误')
    })
  }

  private async handleEvent(event: Record<string, unknown>, dispatcher: Dispatcher): Promise<void> {
    if (event.MsgType === 'heartbeat') {
      this.ws?.send(JSON.stringify({ MsgType: 'heartbeat_response' }))
      return
    }
    if (event.MsgType !== 'text' && event.MsgType !== 'image') return

    const content = ((event.Content as string) ?? '').trim()
    const userId = event.FromUserName as string

    const msg: Message = {
      platform: 'wecom',
      chatId: userId,
      userId,
      type: content.startsWith('/') ? 'command' : 'text',
      content,
      messageId: event.MsgId as string,
    }
    await dispatcher.dispatch(msg)
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ MsgType: 'heartbeat' }))
      }
    }, 30_000)
  }

  private scheduleReconnect(dispatcher: Dispatcher): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      await this.connect(dispatcher)
    }, 5_000)
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.secret}`
    )
    const data = await res.json() as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
    return this.accessToken
  }

  private async getWsEndpoint(): Promise<string> {
    const token = await this.getAccessToken()
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/appchat/get_ws_url?access_token=${token}`
    )
    const data = await res.json() as { url: string }
    return data.url
  }

  async send(chatId: string, text: string): Promise<string> {
    const token = await this.getAccessToken()
    const res = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        body: JSON.stringify({
          touser: chatId,
          msgtype: 'text',
          agentid: this.config.agentId,
          text: { content: text },
        }),
      }
    )
    const data = await res.json() as { msgid: string }
    return data.msgid
  }
}
