// src/dispatcher.ts
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { LaneQueue } from './utils/lane-queue'
import { getWorkspaceDailyHistoryFile, getWorkspaceHistoryDir } from './session/history-paths'
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
    log.info('Memory manager set for session summarization and runtime context')
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
      const isBuiltinCommand = ['/new', '/status'].includes(message.content)
      if (isBuiltinCommand) {
        await this.handleCommand(message, reply)
        return
      }
    }

    const session = this.sessionManager.getOrCreate(
      message.platform,
      message.chatId,
      message.userId,
    )

    this.ensureSessionThread(session)

    log.debug({
      sessionId: session.id,
      workspaceDir: session.workspaceDir,
      threadId: session.threadId,
    }, 'Dispatcher routing to agent')

    await this.laneQueue.enqueue(session.id, async () => {
      this.appendHistory(session.id, session.workspaceDir, 'user', message.content)

      const enhancedMessage = this.enhanceMessageWithMemory(message, session)
      let responseText = ''

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
        await this.agent.handle(session, enhancedMessage, reply, captureStreamHandler)
      } else {
        const originalReply = reply
        const captureReply = async (content: string) => {
          responseText = content
          return originalReply ? originalReply(content) : content
        }
        await this.agent.handle(session, enhancedMessage, captureReply, undefined)
      }

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
      case '/new': {
        if (this.memoryManager) {
          const session = this.sessionManager.get(sessionId)
          if (session) {
            await this.memoryManager
              .summarizeSession(sessionId, session.workspaceDir, {
                threadId: session.threadId,
                chatKey: `${session.platform}:${session.chatId}`,
                status: 'closed',
              })
              .catch(err => log.warn({ sessionId, error: err }, 'Failed to summarize session'))
            if (session.threadId) {
              this.memoryManager.closeThread(session.threadId)
            }
          }
        }
        await this.agent.dispose(sessionId)
        const newSession = this.sessionManager.newSession(message.platform, message.chatId, message.userId)
        this.ensureSessionThread(newSession)
        log.info({ sessionId }, 'New session created via /new')
        await reply?.('新会话已创建')
        break
      }
      case '/status': {
        const stats = this.sessionManager.stats()
        const statusText = `总会话数: ${stats.total}\n各平台: ${JSON.stringify(stats.byPlatform)}`
        log.info({ stats }, '/status requested')
        await reply?.(statusText)
        break
      }
      default:
        log.warn({ content: message.content }, 'Unknown command, ignoring')
        await reply?.(`未知命令: ${message.content}`)
    }
  }

  private ensureSessionThread(session: Session): void {
    if (!this.memoryManager || session.threadId) return
    const threadId = this.memoryManager.ensureThread({
      sessionId: session.id,
      platform: session.platform,
      chatId: session.chatId,
      workspaceDir: session.workspaceDir,
    })
    this.sessionManager.attachThread(session.id, threadId)
    session.threadId = threadId
  }

  private enhanceMessageWithMemory(message: Message, session: Session): Message {
    if (!this.memoryManager) return message

    try {
      const context = this.memoryManager.buildRuntimeContext({
        messageText: message.content,
        session: {
          sessionId: session.id,
          platform: session.platform,
          chatId: session.chatId,
          workspaceDir: session.workspaceDir,
          activeThreadId: session.threadId,
        },
      })
      if (!context.promptBlock) return message

      return {
        ...message,
        content: `${context.promptBlock}\n\n[User Request]\n${message.content}`,
      }
    } catch (error) {
      log.warn({ error }, 'Failed to build runtime memory context')
      return message
    }
  }

  private appendHistory(
    sessionId: string,
    workspaceDir: string,
    role: 'user' | 'assistant',
    text: string
  ): void {
    try {
      const historyDir = getWorkspaceHistoryDir(workspaceDir)
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true })
      }
      const date = new Date().toISOString().slice(0, 10)
      const timestamp = new Date().toISOString()
      appendFileSync(
        getWorkspaceDailyHistoryFile(workspaceDir, date),
        `[${timestamp}] [${role}] ${text}\n\n`,
        'utf-8'
      )
    } catch (err) {
      log.warn({ sessionId, error: err }, 'Failed to write conversation history')
    }
  }
}
