// src/dispatcher.ts
import { LaneQueue } from './utils/lane-queue'
import { logger } from './utils/logger'
import type { SessionManager } from './session/manager'
import type { Session } from './session/types'
import type { Message } from './types/message'

const log = logger('dispatcher')

export interface StreamHandler {
  (stream: AsyncGenerator<{ type: string; [key: string]: unknown }>): Promise<void>
}

export interface Agent {
  handle(session: Session, message: Message, reply?: (content: string) => Promise<string>, streamHandler?: StreamHandler): Promise<void>
  dispose(conversationId: string): Promise<void>
}

export class Dispatcher {
  private laneQueue = new LaneQueue()
  private accepting = true

  constructor(
    private sessionManager: SessionManager,
    private agent: Agent,
    private onShutdown?: () => Promise<void>,
  ) {}

  async dispatch(
    message: Message,
    reply?: (content: string) => Promise<string>,
    streamHandler?: StreamHandler
  ): Promise<void> {
    if (!this.accepting) throw new Error('Dispatcher is not accepting new messages')

    log.debug('Dispatcher received message', {
      platform: message.platform,
      chatId: message.chatId,
      userId: message.userId,
      messageType: message.type,
      contentLength: message.content?.length ?? 0,
      contentPreview: message.content?.substring(0, 100) ?? '',
      hasStreamHandler: !!streamHandler,
      hasReply: !!reply
    })

    if (message.type === 'command') {
      const isBuiltinCommand = ['/clear', '/new', '/status'].includes(message.content)
      if (isBuiltinCommand) {
        await this.handleCommand(message, reply)
        return
      }
      // 其他 / 开头的命令作为普通消息传给 agent 处理（支持 Claude skills）
    }

    const session = this.sessionManager.getOrCreate(
      message.platform,
      message.chatId,
      message.userId,
    )

    log.debug('Dispatcher routing to agent', {
      sessionId: session.id,
      workspaceDir: session.workspaceDir
    })

    await this.laneQueue.enqueue(session.id, () =>
      this.agent.handle(session, message, reply, streamHandler)
    )
  }

  stopAccepting(): void {
    this.accepting = false
    log.info('Dispatcher stopped accepting new messages')
  }

  async drainQueues(): Promise<void> {
    // Poll until all lanes are drained. LaneQueue deletes lane entries on completion,
    // so activeLanes() reaching 0 is correct termination condition.
    while (this.laneQueue.activeLanes() > 0) {
      await new Promise(r => setTimeout(r, 10))
    }
    log.info('Lane queues drained')
  }

  activeLanes(): number {
    return this.laneQueue.activeLanes()
  }

  clearSession(conversationId: string): void {
    this.sessionManager.clearSession(conversationId)
  }

  async shutdown(): Promise<void> {
    this.stopAccepting()
    await this.drainQueues()
    await this.onShutdown?.()
    log.info('Dispatcher shutdown complete')
  }

  private async handleCommand(
    message: Message,
    reply?: (content: string) => Promise<string>
  ): Promise<void> {
    const sessionId = `${message.platform}:${message.chatId}`
    switch (message.content) {
      case '/clear':
        this.sessionManager.clearSession(sessionId)
        log.info('Session cleared via /clear', { sessionId })
        await reply?.('会话已清除')
        break
      case '/new':
        this.sessionManager.newSession(message.platform, message.chatId, message.userId)
        log.info('New session created via /new', { sessionId })
        await reply?.('新会话已创建')
        break
      case '/status':
        const stats = this.sessionManager.stats()
        const statusText = `总会话数: ${stats.total}\n各平台: ${JSON.stringify(stats.byPlatform)}`
        log.info('/status requested', { stats })
        await reply?.(statusText)
        break
      default:
        log.warn('Unknown command, ignoring', { content: message.content })
        await reply?.(`未知命令: ${message.content}`)
    }
  }
}
