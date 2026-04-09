// src/dispatcher.ts
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { LaneQueue } from './utils/lane-queue'
import { logger } from './utils/logger'
import type { SessionManager } from './session/manager'
import type { Session } from './session/types'
import type { Message } from './types/message'
import type { MemoryManager } from './memory/manager'

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
  private memoryManager?: MemoryManager

  constructor(
    private sessionManager: SessionManager,
    private agent: Agent,
    private onShutdown?: () => Promise<void>,
  ) {}

  setMemoryManager(memoryManager: MemoryManager): void {
    this.memoryManager = memoryManager
    log.info('Memory manager set for session summarization')
  }

  async dispatch(
    message: Message,
    reply?: (content: string) => Promise<string>,
    streamHandler?: StreamHandler
  ): Promise<void> {
    if (!this.accepting) throw new Error('Dispatcher is not accepting new messages')

    log.debug({
      platform: message.platform,
      chatId: message.chatId,
      userId: message.userId,
      messageType: message.type,
      contentLength: message.content?.length ?? 0,
      contentPreview: message.content?.substring(0, 100) ?? '',
      hasStreamHandler: !!streamHandler,
      hasReply: !!reply
    }, 'Dispatcher received message')

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

    log.debug({
      sessionId: session.id,
      workspaceDir: session.workspaceDir
    }, 'Dispatcher routing to agent')

    await this.laneQueue.enqueue(session.id, async () => {
      // 记录用户消息
      this.appendHistory(session.id, session.workspaceDir, 'user', message.content)

      let responseText = ''

      // 如果有 streamHandler，包装它来捕获响应文本
      if (streamHandler) {
        const originalStreamHandler = streamHandler
        const captureStreamHandler: StreamHandler = async (stream) => {
          const capturedStream = (async function* () {
            for await (const event of stream) {
              if (event.type === 'text_delta' && typeof event.text === 'string') {
                responseText += event.text
              }
              if (event.type === 'done' && event.response && typeof (event.response as any).text === 'string') {
                responseText = (event.response as any).text
              }
              yield event
            }
          })()
          await originalStreamHandler(capturedStream)
        }
        await this.agent.handle(session, message, reply, captureStreamHandler)
      } else {
        // 非流式模式，通过 reply 捕获响应
        const originalReply = reply
        const captureReply = async (content: string) => {
          responseText = content
          return originalReply ? originalReply(content) : content
        }
        await this.agent.handle(session, message, captureReply, undefined)
      }

      // 记录助手回复
      if (responseText) {
        log.debug({ sessionId: session.id, responseLength: responseText.length }, 'Recording assistant response to history')
        this.appendHistory(session.id, session.workspaceDir, 'assistant', responseText)
      } else {
        log.warn({ sessionId: session.id, hasStreamHandler: !!streamHandler }, 'No response text captured for history')
      }
    })
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
        // 生成摘要（最佳努力，失败不阻塞）
        if (this.memoryManager) {
          const session = this.sessionManager.get(sessionId)
          if (session) {
            await this.memoryManager
              .summarizeSession(sessionId, session.workspaceDir)
              .catch(err => log.warn({ sessionId, error: err }, 'Failed to summarize session'))
          }
        }
        this.sessionManager.clearSession(sessionId)
        log.info({ sessionId }, 'Session cleared via /clear')
        await reply?.('会话已清除')
        break
      case '/new':
        // 生成摘要（最佳努力，失败不阻塞）
        if (this.memoryManager) {
          const session = this.sessionManager.get(sessionId)
          if (session) {
            await this.memoryManager
              .summarizeSession(sessionId, session.workspaceDir)
              .catch(err => log.warn({ sessionId, error: err }, 'Failed to summarize session'))
          }
        }
        this.sessionManager.newSession(message.platform, message.chatId, message.userId)
        log.info({ sessionId }, 'New session created via /new')
        await reply?.('新会话已创建')
        break
      case '/status':
        const stats = this.sessionManager.stats()
        const statusText = `总会话数: ${stats.total}\n各平台: ${JSON.stringify(stats.byPlatform)}`
        log.info({ stats }, '/status requested')
        await reply?.(statusText)
        break
      default:
        log.warn({ content: message.content }, 'Unknown command, ignoring')
        await reply?.(`未知命令: ${message.content}`)
    }
  }

  /**
   * 记录对话历史到文件
   */
  private appendHistory(
    sessionId: string,
    workspaceDir: string,
    role: 'user' | 'assistant',
    text: string
  ): void {
    try {
      const historyDir = join(workspaceDir, '.firclaw', '.history')
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true })
      }
      const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      const timestamp = new Date().toISOString()
      appendFileSync(
        join(historyDir, `${date}.txt`),
        `[${timestamp}] [${role}] ${text}\n\n`,
        'utf-8'
      )
    } catch (err) {
      log.warn({ sessionId, error: err }, 'Failed to write conversation history')
    }
  }
}
