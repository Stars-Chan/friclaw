// src/agent/claude-code.ts
import { logger } from '../utils/logger'
import type { Agent, StreamHandler } from '../dispatcher'
import type { Session } from '../session/types'
import type { Message } from '../types/message'
import type { AgentStreamEvent, RunRequest } from './types'
import { readLines, buildContent } from './utils'

type Subprocess = ReturnType<typeof Bun.spawn>
type SpawnFn = (args: string[], opts?: Parameters<typeof Bun.spawn>[1]) => Subprocess

interface ClaudeCodeAgentOptions {
  spawnFn?: SpawnFn
  soulContent?: string
}

interface ProcessState {
  proc: Subprocess
  lastUsedAt: number
  isHealthy: boolean
}

export class ClaudeCodeAgent implements Agent {
  readonly kind = 'claude_code'
  private processes = new Map<string, ProcessState>()
  private sessionIds = new Map<string, string>()
  private spawnFn: SpawnFn
  private soulContent: string
  private readonly PROCESS_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

  constructor(options: ClaudeCodeAgentOptions = {}) {
    this.spawnFn = options.spawnFn ?? ((args, opts) => Bun.spawn(args, opts))
    this.soulContent = options.soulContent ?? ''
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
    }

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
    const processState = await this.getOrCreateProcess(request.conversationId, request.workspaceDir)
    const proc = processState.proc
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: buildContent(request) },
    }) + '\n'
    const stdin = proc.stdin
    if (!stdin || typeof stdin === 'number') {
      processState.isHealthy = false
      throw new Error('Process stdin is not available')
    }
    stdin.write(payload)
    if ('flush' in stdin) (stdin as { flush(): void }).flush()

    try {
      for await (const line of readLines(proc.stdout as ReadableStream<Uint8Array>)) {
        if (!line.trim()) continue
        let event: Record<string, unknown>
        try { event = JSON.parse(line) } catch { continue }

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
          yield { type: 'done', response: { text: event.result as string, sessionId: event.session_id as string } }
          break
        }
      }
    } catch (error) {
      logger.error({ conversationId: request.conversationId, error }, 'Error reading from process stdout')
      processState.isHealthy = false
      throw error
    }
  }

  private async getOrCreateProcess(conversationId: string, workspaceDir: string): Promise<ProcessState> {
    const existing = this.processes.get(conversationId)
    const now = Date.now()

    // Check if existing process is healthy and not idle for too long
    if (existing && existing.proc.exitCode === null && existing.isHealthy) {
      const idleTime = now - existing.lastUsedAt
      if (idleTime < this.PROCESS_IDLE_TIMEOUT_MS) {
        existing.lastUsedAt = now
        return existing
      }
      // Process is idle for too long, kill it and create a new one
      logger.info({ conversationId, idleTime }, 'Process idle timeout, killing and recreating')
      existing.proc.kill()
      this.processes.delete(conversationId)
    }

    // Create new process
    const args = ['claude', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
    const resumeId = this.sessionIds.get(conversationId)
    if (resumeId) args.push('--resume', resumeId)
    if (this.soulContent) args.push('--system-prompt', this.soulContent)
    const proc = this.spawnFn(args, { cwd: workspaceDir, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    const processState: ProcessState = {
      proc,
      lastUsedAt: now,
      isHealthy: true,
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
