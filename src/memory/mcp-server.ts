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
          const { content, id, category = 'knowledge', tags } = args as {
            content: string
            id?: string
            category?: 'identity' | 'knowledge' | 'episode'
            tags?: string[]
          }
          if (category === 'identity') {
            this.manager.identity.update(content)
            return this.ok('Identity (SOUL.md) updated.')
          }
          if (category === 'episode') {
            const episodeId = this.manager.episode.save(content, tags)
            return this.ok(`Episode saved: ${episodeId}`)
          }
          const topic = id ?? 'notes'
          this.manager.knowledge.save(topic, content, tags)
          return this.ok(`Knowledge saved: ${topic}`)
        }

        case 'memory_list': {
          const { category } = args as { category?: 'identity' | 'knowledge' | 'episode' }
          if (!category || category === 'knowledge') {
            const topics = this.manager.knowledge.list()
            return this.ok(topics.length ? topics.join('\n') : 'No knowledge entries.')
          }
          if (category === 'episode') {
            const episodes = this.manager.episode.recent(20)
            return this.ok(
              episodes.length
                ? episodes.map(e => `${e.id} [${e.tags.join(', ')}]`).join('\n')
                : 'No episodes.'
            )
          }
          return this.ok('identity: SOUL.md')
        }

        case 'memory_read': {
          const { id } = args as { id: string }
          if (id === 'SOUL' || id === 'identity') {
            return this.ok(this.manager.identity.read())
          }
          const content = this.manager.knowledge.read(id)
          if (!content) return this.err(`Not found: ${id}`)
          return this.ok(content)
        }

        default:
          return this.err(`Unknown tool: ${name}`)
      }
    } catch (e) {
      return this.err((e as Error).message)
    }
  }
}
