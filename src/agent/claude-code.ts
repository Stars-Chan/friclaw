// src/agent/claude-code.ts
import { logger } from '../utils/logger'
import type { Agent, StreamHandler } from '../dispatcher'
import type { Session } from '../session/types'
import type { Message } from '../types/message'
import type { AgentStreamEvent, RunRequest } from './types'
import { readLines, buildContent } from './utils'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

type Subprocess = ReturnType<typeof Bun.spawn>
type SpawnFn = (args: string[], opts?: Parameters<typeof Bun.spawn>[1]) => Subprocess

interface ClaudeCodeAgentOptions {
  spawnFn?: SpawnFn
  soulContent?: string
  model?: string // 默认模型名称
  allowedTools?: string[] // 允许的工具白名单（如果为空则跳过权限检查）
}

/**
 * 计算成本（当 CLI 未返回成本时使用）
 * 输入：1元/百万tokens，输出：2元/百万tokens
 */
const INPUT_COST_PER_MILLION_TOKENS_CNY = 1 // 输入价格：1元/百万tokens
const OUTPUT_COST_PER_MILLION_TOKENS_CNY = 2 // 输出价格：2元/百万tokens

function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCostCny = (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION_TOKENS_CNY
  const outputCostCny = (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION_TOKENS_CNY
  return inputCostCny + outputCostCny // 直接返回人民币
}

interface ProcessState {
  proc: Subprocess
  lastUsedAt: number
  isHealthy: boolean
  sessionContext?: { chatId?: string; platform?: string; userId?: string; chatType?: 'private' | 'group' }
}

export class ClaudeCodeAgent implements Agent {
  readonly kind = 'claude_code'
  private processes = new Map<string, ProcessState>()
  private sessionIds = new Map<string, string>()
  private spawnFn: SpawnFn
  private soulContent: string
  private defaultModel: string // 默认模型名称
  private allowedTools?: string[] // 允许的工具白名单
  private readonly PROCESS_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  constructor(options: ClaudeCodeAgentOptions = {}) {
    this.spawnFn = options.spawnFn ?? ((args, opts) => Bun.spawn(args, opts))
    this.soulContent = options.soulContent ?? ''
    this.defaultModel = options.model ?? 'claude-sonnet-4-6'
    this.allowedTools = options.allowedTools
  }

  async handle(
    session: Session,
    message: Message,
    reply?: (content: string) => Promise<string>,
    streamHandler?: StreamHandler
  ): Promise<void> {
    const request: RunRequest = {
      conversationId: session.id,
      workspaceDir: session.workspaceDir,
      text: message.content,
      chatId: message.chatId,
      platform: message.platform,
      userId: message.userId,
      chatType: message.chatType,
    }

    logger.debug({
      conversationId: session.id,
      workspaceDir: session.workspaceDir,
      messageContent: message.content?.substring(0, 100),
      messageType: message.type,
      hasStreamHandler: !!streamHandler,
      hasReply: !!reply
    }, 'Agent handling message')

    try {
      if (streamHandler) {
        await streamHandler(this.stream(request))
      } else {
        let finalText = ''
        for await (const event of this.stream(request)) {
          if (event.type === 'text_delta') finalText += event.text
          if (event.type === 'done') { finalText = event.response.text; break }
        }
        logger.info({ conversationId: session.id, text: finalText }, 'Agent response')
        await reply?.(finalText)
      }
    } catch (error) {
      // Clean up the process on error to avoid locked streams
      logger.error({ conversationId: session.id, error }, 'Error in agent handle, cleaning up process')
      await this.dispose(session.id)
      throw error
    }
  }

  async *stream(request: RunRequest): AsyncGenerator<AgentStreamEvent> {
    const startTime = Date.now()
    logger.info({
      conversationId: request.conversationId,
      messageText: request.text?.substring(0, 100),
      textLength: request.text?.length
    }, 'Claude Code stream starting')

    const processState = await this.getOrCreateProcess(request)
    const proc = processState.proc
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: buildContent(request) },
    }) + '\n'

    logger.debug({
      conversationId: request.conversationId,
      payloadLength: payload.length
    }, 'Sending payload to Claude Code process')

    const stdin = proc.stdin
    if (!stdin || typeof stdin === 'number') {
      processState.isHealthy = false
      throw new Error('Process stdin is not available')
    }
    stdin.write(payload)
    if ('flush' in stdin) (stdin as { flush(): void }).flush()

    let lineCount = 0
    let eventCount = 0
    let hasResult = false

    try {
      for await (const line of readLines(proc.stdout as ReadableStream<Uint8Array>)) {
        lineCount++
        if (!line.trim()) continue
        let event: Record<string, unknown>
        try {
          event = JSON.parse(line)
          eventCount++
        } catch {
          logger.debug({ conversationId: request.conversationId, line: line.substring(0, 200) }, 'Failed to parse line, skipping')
          continue
        }

        if (event.type === 'system' && event.subtype === 'init') {
          this.sessionIds.set(request.conversationId, event.session_id as string)
          continue
        }
        if (event.type === 'assistant') {
          const content = (event.message as { content: Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown }> }).content
          for (const block of content) {
            if (block.type === 'thinking' && block.thinking) yield { type: 'thinking_delta', text: block.thinking }
            else if (block.type === 'text' && block.text) yield { type: 'text_delta', text: block.text }
            else if (block.type === 'tool_use') {
              if (block.name === 'AskUserQuestion') {
                yield { type: 'ask_questions', questions: (block.input as { questions: string[] }).questions, conversationId: request.conversationId }
              } else {
                yield { type: 'tool_use', name: block.name!, input: block.input }
              }
            }
          }
        }
        if (event.type === 'result') {
          hasResult = true
          const elapsedMs = Date.now() - startTime

          // 从 result 事件中提取统计信息
          const usage = event.usage as { input_tokens?: number; output_tokens?: number } | undefined
          const resultEvt = event as { session_id?: string; cost_usd?: number; model?: string }
          const resultText = event.result as string

          // 计算人民币成本
          const inputTokens = usage?.input_tokens ?? 0
          const outputTokens = usage?.output_tokens ?? 0
          // 如果 CLI 返回了美元成本，转换为人民币；否则使用 calculateCost 计算
          const costCny = resultEvt.cost_usd
            ? resultEvt.cost_usd * 7.2 // 美元转人民币
            : calculateCost(inputTokens, outputTokens)
          // 如果 CLI 没有返回 model，则使用默认值
          const model = resultEvt.model ?? this.defaultModel

          // 使用 info 级别日志打印 result 事件的关键字段
          logger.info({
            conversationId: request.conversationId,
            model,
            costCny,
            inputTokens,
            outputTokens,
            elapsedMs,
            resultTextLength: resultText?.length ?? 0,
            resultTextPreview: resultText?.substring(0, 100) ?? '',
          }, 'Claude Code result event stats')

          // 如果tokens为0，记录警告
          if (inputTokens === 0 && outputTokens === 0) {
            logger.warn({
              conversationId: request.conversationId,
              lineCount,
              eventCount,
              hasResult,
              resultTextLength: resultText?.length ?? 0,
              originalMessage: request.text?.substring(0, 100)
            }, 'Claude Code returned zero tokens - possible issue')
          }

          yield {
            type: 'done',
            response: {
              text: resultText,
              sessionId: resultEvt.session_id ?? '',
              model,
              elapsedMs,
              inputTokens,
              outputTokens,
              costCny,
            }
          }
          break
        }
      }

      // 如果没有收到result事件就结束了，记录警告
      if (!hasResult) {
        logger.warn({
          conversationId: request.conversationId,
          lineCount,
          eventCount,
          originalMessage: request.text?.substring(0, 100)
        }, 'Claude Code stream ended without result event')
      }
    } catch (error) {
      logger.error({ conversationId: request.conversationId, error }, 'Error reading from process stdout')
      processState.isHealthy = false
      throw error
    }
  }

  private async getOrCreateProcess(request: RunRequest): Promise<ProcessState> {
    const { conversationId, workspaceDir, chatId, platform, userId, chatType } = request
    const existing = this.processes.get(conversationId)
    const now = Date.now()

    // Check if session context has changed
    const newContext = { chatId, platform, userId, chatType }
    const contextChanged = existing?.sessionContext &&
      (existing.sessionContext.chatId !== chatId ||
       existing.sessionContext.platform !== platform ||
       existing.sessionContext.userId !== userId)

    if (existing && contextChanged) {
      logger.info({ conversationId }, 'Session context changed, will recreate process')
      this.processes.delete(conversationId)
      existing.proc.kill(9)
    }

    // Check if existing process is healthy and not idle for too long
    const existingAfterCheck = this.processes.get(conversationId)
    if (existingAfterCheck && existingAfterCheck.proc.exitCode === null && existingAfterCheck.isHealthy) {
      const idleTime = now - existingAfterCheck.lastUsedAt
      if (idleTime < this.PROCESS_IDLE_TIMEOUT_MS) {
        existingAfterCheck.lastUsedAt = now
        return existingAfterCheck
      }
      // Process is idle for too long, kill it and create a new one
      logger.info({ conversationId, idleTime }, 'Process idle timeout, killing and recreating')
      existingAfterCheck.proc.kill()
      this.processes.delete(conversationId)
      await existingAfterCheck.proc.exited
    }

    // Create new process
    const args = [
      'claude',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
    ]

    // 工具权限配置：优先使用白名单，否则跳过权限检查
    if (this.allowedTools && this.allowedTools.length > 0) {
      args.push('--allowedTools', this.allowedTools.join(','))
    } else {
      // 必须先允许跳过权限检查，才能使用该参数
      args.push('--allow-dangerously-skip-permissions')
      args.push('--dangerously-skip-permissions')  // 跳过权限检查，因为外层已实现权限控制
    }

    // 禁用内置 cron 工具，使用 MCP 服务器提供的持久化版本
    args.push('--disallowedTools', 'CronCreate,CronDelete,CronList')

    const resumeId = this.sessionIds.get(conversationId)
    if (resumeId) args.push('--resume', resumeId)
    if (this.soulContent) args.push('--system-prompt', this.soulContent)

    // 清除 CLAUDECODE 环境变量，避免嵌套会话检测
    const env = { ...process.env }
    delete env.CLAUDECODE

    // 从 ~/.claude/skills/.env 加载环境变量
    const skillsEnvPath = join(homedir(), '.claude', 'skills', '.env')
    if (existsSync(skillsEnvPath)) {
      try {
        const envContent = readFileSync(skillsEnvPath, 'utf-8')
        for (const line of envContent.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const idx = trimmed.indexOf('=')
          if (idx > 0) {
            const key = trimmed.slice(0, idx).trim()
            let value = trimmed.slice(idx + 1).trim()
            // 移除引号
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1)
            }
            env[key] = value
          }
        }
        logger.debug({ path: skillsEnvPath }, 'Loaded env from skills/.env')
      } catch (error) {
        logger.warn({ error, path: skillsEnvPath }, 'Failed to load skills/.env')
      }
    }

    // 注入会话上下文到环境变量，供 MCP 工具使用
    if (chatId) env.FRICLAW_CHAT_ID = chatId
    if (platform) env.FRICLAW_PLATFORM = platform
    if (userId) env.FRICLAW_USER_ID = userId
    if (chatType) env.FRICLAW_CHAT_TYPE = chatType
    env.FRICLAW_WORKDIR = process.cwd() // 传递主进程工作目录

    logger.debug({ conversationId, chatId, platform, userId }, 'Injecting session context to env')

    const proc = this.spawnFn(args, {
      cwd: workspaceDir,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env
    })

    const processState: ProcessState = {
      proc,
      lastUsedAt: now,
      isHealthy: true,
      sessionContext: newContext,
    }

    this.processes.set(conversationId, processState)

    // 异步读取 stderr，避免缓冲区阻塞
    ;(async () => {
      try {
        for await (const line of readLines(proc.stderr as ReadableStream<Uint8Array>)) {
          if (line.trim()) logger.warn({ conversationId, line }, 'claude stderr')
        }
      } catch (error) {
        logger.error({ conversationId, error }, 'Error reading stderr')
        processState.isHealthy = false
      }
    })()

    return processState
  }

  clearConversation(conversationId: string): void {
    this.sessionIds.delete(conversationId)
  }

  async dispose(conversationId?: string): Promise<void> {
    if (conversationId) {
      const processState = this.processes.get(conversationId)
      if (processState) {
        processState.proc.kill()
        this.processes.delete(conversationId)
        this.sessionIds.delete(conversationId)
      }
    } else {
      for (const processState of this.processes.values()) {
        processState.proc.kill()
      }
      this.processes.clear()
      this.sessionIds.clear()
    }
  }

  async healthCheck(): Promise<boolean> {
    try { return (await Bun.spawn(['claude', '--version']).exited) === 0 } catch { return false }
  }
}
