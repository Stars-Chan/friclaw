// src/dispatcher.ts
import { LaneQueue } from './utils/lane-queue'
import { logger } from './utils/logger'
import type { SessionManager } from './session/manager'
import type { Session } from './session/types'
import type { Message } from './types/message'

export interface Agent {
  handle(session: Session, message: Message): Promise<void>
}

export class Dispatcher {
  private laneQueue = new LaneQueue()
  private accepting = true

  constructor(
    private sessionManager: SessionManager,
    private agent: Agent,
    private onShutdown?: () => Promise<void>,
  ) {}

  async dispatch(message: Message): Promise<void> {
    if (!this.accepting) throw new Error('Dispatcher is not accepting new messages')

    if (message.type === 'command') {
      await this.handleCommand(message)
      return
    }

    const session = this.sessionManager.getOrCreate(
      message.platform,
      message.chatId,
      message.userId,
    )

    await this.laneQueue.enqueue(session.id, () => this.agent.handle(session, message))
  }

  stopAccepting(): void {
    this.accepting = false
    logger.info('Dispatcher stopped accepting new messages')
  }

  async drainQueues(): Promise<void> {
    // Poll until all lanes are drained. LaneQueue deletes lane entries on completion,
    // so activeLanes() reaching 0 is the correct termination condition.
    while (this.laneQueue.activeLanes() > 0) {
      await new Promise(r => setTimeout(r, 10))
    }
    logger.info('Lane queues drained')
  }

  activeLanes(): number {
    return this.laneQueue.activeLanes()
  }

  async shutdown(): Promise<void> {
    this.stopAccepting()
    await this.drainQueues()
    await this.onShutdown?.()
    logger.info('Dispatcher shutdown complete')
  }

  private async handleCommand(message: Message): Promise<void> {
    const sessionId = `${message.platform}:${message.chatId}`
    switch (message.content) {
      case '/clear':
        this.sessionManager.clearSession(sessionId)
        logger.info({ sessionId }, 'Session cleared via /clear')
        break
      case '/new':
        this.sessionManager.newSession(message.platform, message.chatId, message.userId)
        logger.info({ sessionId }, 'New session created via /new')
        break
      case '/status':
        logger.info({ stats: this.sessionManager.stats() }, '/status requested')
        break
      default:
        logger.warn({ content: message.content }, 'Unknown command, ignoring')
    }
  }
}
