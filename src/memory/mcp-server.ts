import { BaseMcpServer, type Tool, type CallToolResult } from '../mcp/server'
import type { MemoryManager } from './manager'
import { toValidatedKnowledgeRecord } from './knowledge'

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
      {
        name: 'memory_candidate_list',
        description: '列出 promotion candidates',
        inputSchema: {
          type: 'object',
          properties: {
            targetCategory: { type: 'string', enum: ['knowledge', 'identity'] },
          },
        },
      },
      {
        name: 'memory_candidate_review',
        description: '审批或合并 promotion candidate',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'candidate id' },
            decision: { type: 'string', enum: ['approve', 'reject', 'defer', 'merge'] },
            reviewer: { type: 'string' },
            rationale: { type: 'string' },
            targetId: { type: 'string', description: 'merge target knowledge id' },
          },
          required: ['id', 'decision'],
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
          this.manager.knowledge.saveRecord(toValidatedKnowledgeRecord(topic, {
            content,
            metadata: metadata as any,
            tags,
          }))
          return this.ok(`Knowledge saved: ${topic}`)
        }

        case 'memory_list': {
          const { category, detailed } = args as { category?: 'identity' | 'knowledge' | 'episode'; detailed?: boolean }
          const shared = this.manager.getSharedMemoryModels()
          if (!category || category === 'knowledge') {
            const topics = this.manager.knowledge.listRecords()
            return this.ok(
              topics.length
                ? topics.map(topic => detailed
                  ? JSON.stringify({ ...topic, shared }, null, 2)
                  : `${topic.id} [${topic.metadata.tags.join(', ')}]`).join('\n')
                : 'No knowledge entries.'
            )
          }
          if (category === 'episode') {
            const episodes = this.manager.episode.recent(20)
            return this.ok(
              episodes.length
                ? episodes.map(e => detailed
                  ? JSON.stringify({ ...e, shared }, null, 2)
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

        case 'memory_candidate_list': {
          const { targetCategory } = args as { targetCategory?: 'knowledge' | 'identity' }
          const candidates = this.manager.listCandidates(targetCategory)
          return this.ok(candidates.length ? JSON.stringify(candidates, null, 2) : 'No candidates.')
        }

        case 'memory_candidate_review': {
          const { id, decision, reviewer, rationale, targetId } = args as {
            id: string
            decision: 'approve' | 'reject' | 'defer' | 'merge'
            reviewer?: string
            rationale?: string
            targetId?: string
          }
          const candidate = this.manager.listCandidates().find(item => item.id === id)
          if (!candidate) return this.err(`Not found: ${id}`)

          if (candidate.targetCategory === 'identity') {
            if (decision === 'merge') return this.err('Identity candidate does not support merge decision')
            const reviewed = this.manager.reviewIdentityCandidate(id, { decision, reviewer, rationale })
            if (!reviewed) return this.err(`Not found: ${id}`)
            return this.ok(JSON.stringify(reviewed, null, 2))
          }

          if (decision === 'merge') {
            if (!targetId) return this.err('targetId is required for merge decision')
            const merged = this.manager.mergeKnowledge(targetId, [candidate.sourceId])
            if (!merged) return this.err('Merge failed')
            const updated = this.manager.knowledge.saveIdentityCandidate({
              ...candidate,
              status: 'merged',
              review: {
                decision: 'merge',
                reviewer,
                rationale,
                reviewedAt: new Date().toISOString(),
              },
              applied: true,
              appliedTargetId: targetId,
              auditTrail: [
                ...(candidate.auditTrail ?? []),
                ...merged.auditTrail,
              ],
              lineage: [
                ...(candidate.lineage ?? []),
                ...merged.lineage,
              ],
            })
            return this.ok(JSON.stringify(updated, null, 2))
          }

          const applied = decision === 'approve'
          if (applied) {
            const appliedCandidates = this.manager.applyPromotionCandidates([candidate])
            return this.ok(JSON.stringify(appliedCandidates[0], null, 2))
          }

          const updated = this.manager.knowledge.saveIdentityCandidate({
            ...candidate,
            status: decision === 'reject' ? 'rejected' : 'deferred',
            review: {
              decision,
              reviewer,
              rationale,
              reviewedAt: new Date().toISOString(),
            },
          })
          return this.ok(JSON.stringify(updated, null, 2))
        }

        case 'identity_candidate_review': {
          const { id, decision, reviewer, rationale } = args as {
            id: string
            decision: 'approve' | 'reject' | 'defer'
            reviewer?: string
            rationale?: string
          }
          const candidate = this.manager.reviewIdentityCandidate(id, { decision, reviewer, rationale })
          if (!candidate) return this.err(`Not found: ${id}`)
          return this.ok(JSON.stringify(candidate, null, 2))
        }

        default:
          return this.err(`Unknown tool: ${name}`)
      }
    } catch (e) {
      return this.err((e as Error).message)
    }
  }
}
