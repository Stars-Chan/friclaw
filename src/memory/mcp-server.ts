import { BaseMcpServer, type Tool, type CallToolResult } from '../mcp/server'
import type { MemoryManager } from './manager'

export class MemoryMcpServer extends BaseMcpServer {
  constructor(private manager: MemoryManager) {
    super('friclaw-memory', '1.0.0')
  }

  tools(): Tool[] {
    return this.getTools()
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.handleToolCall(name, args)
  }

  protected getTools(): Tool[] {
    return [
      {
        name: 'memory_search',
        description: '搜索记忆，支持关键词全文检索',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] },
            limit: { type: 'number', default: 10 },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_save',
        description: '保存或更新记忆',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '记忆内容' },
            id: { type: 'string', description: 'knowledge topic 或 identity（固定为 SOUL）' },
            category: {
              type: 'string',
              enum: ['identity', 'knowledge', 'episode'],
              default: 'knowledge',
            },
            tags: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object' },
          },
          required: ['content'],
        },
      },
      {
        name: 'memory_list',
        description: '列出记忆条目',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] },
            detailed: { type: 'boolean' },
          },
        },
      },
      {
        name: 'memory_read',
        description: '读取单条记忆内容',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'knowledge topic 名称，或 "SOUL" 读取 identity' },
            category: { type: 'string', enum: ['identity', 'knowledge', 'episode'] },
          },
          required: ['id'],
        },
      },
    ]
  }

  protected async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    try {
      switch (name) {
        case 'memory_search': {
          const { query, category, limit } = args as {
            query: string
            category?: 'identity' | 'knowledge' | 'episode'
            limit?: number
          }
          const results = this.manager.search(query, category)
          if (results.length === 0) return this.ok('No results found.')
          const text = results
            .slice(0, limit ?? 10)
            .map(r => `[${r.category}] ${r.title}\n${r.content}`)
            .join('\n\n---\n\n')
          return this.ok(text)
        }

        case 'memory_save': {
          const { content, id, category = 'knowledge', tags, metadata } = args as {
            content: string
            id?: string
            category?: 'identity' | 'knowledge' | 'episode'
            tags?: string[]
            metadata?: Record<string, unknown>
          }
          if (category === 'identity') {
            this.manager.identity.update(content)
            return this.ok('Identity (SOUL.md) updated.')
          }
          if (category === 'episode') {
            const episodeId = this.manager.episode.save(content, tags, metadata as any)
            const candidates = this.manager.collectPromotionCandidates([episodeId])
            this.manager.applyPromotionCandidates(candidates)
            return this.ok(`Episode saved: ${episodeId}`)
          }
          const topic = id ?? 'notes'
          this.manager.knowledge.saveRecord({
            id: topic,
            metadata: {
              ...(metadata ?? {}),
              tags: tags ?? (Array.isArray((metadata ?? {}).tags) ? (metadata as any).tags : []),
            } as any,
            content,
          })
          return this.ok(`Knowledge saved: ${topic}`)
        }

        case 'memory_list': {
          const { category, detailed } = args as { category?: 'identity' | 'knowledge' | 'episode'; detailed?: boolean }
          if (!category || category === 'knowledge') {
            const topics = this.manager.knowledge.listRecords()
            return this.ok(
              topics.length
                ? topics.map(topic => detailed
                  ? JSON.stringify(topic, null, 2)
                  : `${topic.id} [${topic.metadata.tags.join(', ')}]`).join('\n')
                : 'No knowledge entries.'
            )
          }
          if (category === 'episode') {
            const episodes = this.manager.episode.recent(20)
            return this.ok(
              episodes.length
                ? episodes.map(e => detailed
                  ? JSON.stringify(e, null, 2)
                  : `${e.id} [${e.tags.join(', ')}]${e.threadId ? ` thread=${e.threadId}` : ''}`).join('\n')
                : 'No episodes.'
            )
          }
          return this.ok('identity: SOUL.md')
        }

        case 'memory_read': {
          const { id, category } = args as { id: string; category?: 'identity' | 'knowledge' | 'episode' }
          if (id === 'SOUL' || id === 'identity' || category === 'identity') {
            return this.ok(this.manager.identity.read())
          }
          if (category === 'episode') {
            if (id.startsWith('thread:')) {
              const thread = this.manager.episode.readThreadState(id.slice('thread:'.length))
              if (!thread) return this.err(`Not found: ${id}`)
              return this.ok(JSON.stringify(thread, null, 2))
            }
            const record = this.manager.episode.readRecord(id)
            if (!record) return this.err(`Not found: ${id}`)
            return this.ok(JSON.stringify(record, null, 2))
          }
          const record = this.manager.knowledge.readRecord(id)
          if (!record) return this.err(`Not found: ${id}`)
          return this.ok(JSON.stringify(record, null, 2))
        }

        default:
          return this.err(`Unknown tool: ${name}`)
      }
    } catch (e) {
      return this.err((e as Error).message)
    }
  }
}
