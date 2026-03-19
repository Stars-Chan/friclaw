// src/agent/router.ts
import type { Agent } from '../dispatcher'
import type { Session } from '../session/types'
import type { Message } from '../types/message'

type Middleware = (session: Session, message: Message, next: () => Promise<void>) => Promise<void>

interface RouterAgents {
  default: Agent
  image?: Agent
  file?: Agent
  group?: Agent
  feishu?: Agent
  wecom?: Agent
  dashboard?: Agent
}

export class Router implements Agent {
  private middleware: Middleware[] = []

  constructor(private agents: RouterAgents) {}

  use(mw: Middleware): this {
    this.middleware.push(mw)
    return this
  }

  async handle(session: Session, message: Message): Promise<void> {
    const dispatch = async () => {
      const agent = this.resolve(session, message)
      await agent.handle(session, message)
    }

    // build middleware chain
    let index = 0
    const run = async (): Promise<void> => {
      if (index < this.middleware.length) {
        const mw = this.middleware[index++]
        await mw(session, message, run)
      } else {
        await dispatch()
      }
    }

    await run()
  }

  private resolve(session: Session, message: Message): Agent {
    // 1. platform-specific agent (highest priority)
    const platformAgent = this.agents[message.platform]
    if (platformAgent) return platformAgent

    // 2. group chat agent
    if (session.chatType === 'group' && this.agents.group) return this.agents.group

    // 3. message-type agent
    if (message.type === 'image' && this.agents.image) return this.agents.image
    if (message.type === 'file' && this.agents.file) return this.agents.file

    // 4. default
    return this.agents.default
  }
}
