import { BaseMcpServer, type Tool, type CallToolResult } from '../mcp/server'
import type { CronStorage, CronJob } from './storage'
import { DateTime } from 'luxon'

export class CronMcpServer extends BaseMcpServer {
  private readonly platform: string

  constructor(private storage: CronStorage) {
    super('friclaw-cron', '1.0.0')
    this.platform = process.env.FRICLAW_PLATFORM || 'dashboard'
  }

  private notifyMainProcess(): void {
    // 主进程会通过轮询检测数据库变更，无需额外通知
  }

  private checkJobPermission(id: string): CronJob {
    const job = this.storage.getJob(id)
    if (!job) throw new Error(`任务不存在: ${id}`)
    if (job.platform !== this.platform) throw new Error(`无权限操作其他平台的任务`)
    return job
  }

  tools(): Tool[] {
    return this.getTools()
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.handleToolCall(name, args)
  }

  protected getTools(): Tool[] {
    const now = DateTime.now().setZone('Asia/Shanghai')
    const exampleTime = now.plus({ minutes: 2 }).toISO({ includeOffset: false, suppressMilliseconds: true })
    return [
      {
        name: 'cron_create',
        description: `创建定时任务。cronExpression 可以是标准 Cron 表达式（如 "0 9 * * *" 表示每天9点）或 ISO 时间字符串（如 "2026-03-28T14:30:00" 表示一次性任务）。

**当前 Asia/Shanghai 时间：${now.toFormat('yyyy-MM-dd HH:mm:ss')}**

生成 ISO 时间字符串时，必须基于上述 Asia/Shanghai 时间计算，而不是 UTC 时间。例如：如果要设置"2分钟后"，应该是 "${exampleTime}"`,
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '任务名称' },
            cronExpression: { type: 'string', description: 'Cron 表达式或 ISO 时间字符串' },
            prompt: { type: 'string', description: '触发时执行的提示词' },
            timezone: { type: 'string', description: '时区（如 Asia/Shanghai），可选' },
          },
          required: ['name', 'cronExpression', 'prompt'],
        },
      },
      {
        name: 'cron_list',
        description: '列出所有定时任务',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'cron_delete',
        description: '删除定时任务',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', description: '任务 ID' } },
          required: ['id'],
        },
      },
      {
        name: 'cron_update',
        description: '更新定时任务',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '任务 ID' },
            enabled: { type: 'boolean', description: '是否启用' },
            timezone: { type: 'string', description: '时区' },
          },
          required: ['id'],
        },
      },
      {
        name: 'cron_history',
        description: '查询任务执行历史',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '任务 ID' },
            limit: { type: 'number', description: '返回记录数，默认 50' },
          },
          required: ['id'],
        },
      },
    ]
  }

  protected async handleToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      switch (name) {
        case 'cron_create': {
          const { name: jobName, cronExpression, prompt, timezone } = args as {
            name: string
            cronExpression: string
            prompt: string
            timezone?: string
          }

          const chatId = process.env.FRICLAW_CHAT_ID || 'system'
          const userId = process.env.FRICLAW_USER_ID || 'system'
          const chatType = (process.env.FRICLAW_CHAT_TYPE as 'private' | 'group') || 'private'

          const job = this.storage.createJob({
            name: jobName,
            cronExpression,
            prompt,
            timezone,
            platform: this.platform,
            chatId,
            userId,
            chatType,
            enabled: true,
          })
          this.notifyMainProcess()
          return this.ok(`任务已创建: ${job.id}\n名称: ${job.name}\nCron: ${job.cronExpression}${timezone ? `\n时区: ${timezone}` : ''}`)
        }

        case 'cron_list': {
          const jobs = this.storage.listJobs(this.platform)
          if (jobs.length === 0) return this.ok('暂无定时任务')
          const text = jobs
            .map(j => `[${j.enabled ? '✓' : '✗'}] ${j.name}\n  ID: ${j.id}\n  Cron: ${j.cronExpression}${j.timezone ? `\n  时区: ${j.timezone}` : ''}\n  提示词: ${j.prompt}`)
            .join('\n\n')
          return this.ok(text)
        }

        case 'cron_delete': {
          const { id } = args as { id: string }
          this.checkJobPermission(id)
          this.storage.deleteJob(id)
          this.notifyMainProcess()
          return this.ok(`任务已删除: ${id}`)
        }

        case 'cron_update': {
          const { id, enabled, timezone } = args as { id: string; enabled?: boolean; timezone?: string }
          this.checkJobPermission(id)
          this.storage.updateJob(id, { enabled, timezone })
          this.notifyMainProcess()
          return this.ok(`任务已更新: ${id}`)
        }

        case 'cron_history': {
          const { id, limit } = args as { id: string; limit?: number }
          this.checkJobPermission(id)
          const history = this.storage.getExecutionHistory(id, limit)
          if (history.length === 0) return this.ok('暂无执行历史')
          const text = history
            .map(h => `[${h.status}] ${h.executedAt}\n  计划时间: ${h.scheduledTime}${h.errorMessage ? `\n  错误: ${h.errorMessage}` : ''}`)
            .join('\n\n')
          return this.ok(text)
        }

        default:
          return this.err(`Unknown tool: ${name}`)
      }
    } catch (e) {
      return this.err((e as Error).message)
    }
  }
}
