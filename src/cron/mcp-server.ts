import { BaseMcpServer, type Tool, type CallToolResult } from '../mcp/server'
import type { CronStorage } from './storage'
import { writeFileSync } from 'fs'
import { join } from 'path'

export class CronMcpServer extends BaseMcpServer {
  constructor(private storage: CronStorage) {
    super('friclaw-cron', '1.0.0')
  }

  private notifyMainProcess(): void {
    // 通过写入信号文件通知主进程重新加载任务
    // 使用环境变量传递的工作目录，确保路径一致
    const workDir = process.env.FRICLAW_WORKDIR || process.cwd()
    const signalFile = join(workDir, '.cron-reload')
    writeFileSync(signalFile, Date.now().toString())
    console.log(`[CronMCP] Signal file written: ${signalFile}`)
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
        name: 'cron_create',
        description: '创建定时任务。cronExpression 可以是标准 Cron 表达式（如 "0 9 * * *" 表示每天9点）或 ISO 时间字符串（如 "2026-03-28T00:04:00" 表示一次性任务）。支持时区参数。',
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

          // 从环境变量获取会话上下文
          const platform = process.env.FRICLAW_PLATFORM || 'dashboard'
          const chatId = process.env.FRICLAW_CHAT_ID || 'system'
          const userId = process.env.FRICLAW_USER_ID || 'system'

          const job = this.storage.createJob({
            name: jobName,
            cronExpression,
            prompt,
            timezone,
            platform,
            chatId,
            userId,
            enabled: true,
          })
          this.notifyMainProcess()
          return this.ok(`任务已创建: ${job.id}\n名称: ${job.name}\nCron: ${job.cronExpression}${timezone ? `\n时区: ${timezone}` : ''}`)
        }

        case 'cron_list': {
          const jobs = this.storage.listJobs()
          if (jobs.length === 0) return this.ok('暂无定时任务')
          const text = jobs
            .map(j => `[${j.enabled ? '✓' : '✗'}] ${j.name}\n  ID: ${j.id}\n  Cron: ${j.cronExpression}${j.timezone ? `\n  时区: ${j.timezone}` : ''}\n  提示词: ${j.prompt}`)
            .join('\n\n')
          return this.ok(text)
        }

        case 'cron_delete': {
          const { id } = args as { id: string }
          this.storage.deleteJob(id)
          this.notifyMainProcess()
          return this.ok(`任务已删除: ${id}`)
        }

        case 'cron_update': {
          const { id, enabled, timezone } = args as { id: string; enabled?: boolean; timezone?: string }
          const updated = this.storage.updateJob(id, { enabled, timezone })
          if (!updated) return this.err(`任务不存在: ${id}`)
          this.notifyMainProcess()
          return this.ok(`任务已更新: ${id}`)
        }

        case 'cron_history': {
          const { id, limit } = args as { id: string; limit?: number }
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
