// src/agent/claude-code.ts
import { logger } from '../utils/logger'
import type { Agent } from '../dispatcher'
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

export class ClaudeCodeAgent implements Agent {
  readonly kind = 'claude_code'
  private processes = new Map<string, Subprocess>()
  private sessionIds = new Map<string, string>()
  private spawnFn: SpawnFn
  private soulContent: string

  constructor(options: ClaudeCodeAgentOptions = {}) {
    this.spawnFn = options.spawnFn ?? ((args, opts) => Bun.spawn(args, opts))
    this.soulContent = options.soulContent ?? ''
  }

  async handle(session: Session, message: Message): Promise<void> {
    const request: RunRequest = {
      conversationId: session.id,
      workspaceDir: session.workspaceDir,
      text: message.content,
    }
    let finalText = ''
    for await (const event of this.stream(request)) {
      if (event.type === 'text_delta') finalText += event.text
      if (event.type === 'done') { finalText = event.response.text; break }
    }
    logger.info({ conversationId: session.id, text: finalText }, 'Agent response')
  }

  async *stream(request: RunRequest): AsyncGenerator<AgentStreamEvent> {
    const proc = await this.getOrCreateProcess(request.conversationId, request.workspaceDir)
    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: buildContent(request) },
    }) + '\n'
    proc.stdin.write(payload)
    if ('flush' in proc.stdin) (proc.stdin as { flush(): void }).flush()

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
  }

  private async getOrCreateProcess(conversationId: string, workspaceDir: string): Promise<Subprocess> {
    const existing = this.processes.get(conversationId)
    if (existing && existing.exitCode === null) return existing
    const args = ['claude', '--output-format', 'stream-json', '--verbose']
    const resumeId = this.sessionIds.get(conversationId)
    if (resumeId) args.push('--resume', resumeId)
    if (this.soulContent) args.push('--system-prompt', this.soulContent)
    const proc = this.spawnFn(args, { cwd: workspaceDir, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    this.processes.set(conversationId, proc)
    return proc
  }

  clearConversation(conversationId: string): void {
    this.sessionIds.delete(conversationId)
  }

  async dispose(conversationId?: string): Promise<void> {
    if (conversationId) {
      const proc = this.processes.get(conversationId)
      if (proc) { proc.kill(); this.processes.delete(conversationId); this.sessionIds.delete(conversationId) }
    } else {
      for (const proc of this.processes.values()) proc.kill()
      this.processes.clear(); this.sessionIds.clear()
    }
  }

  async healthCheck(): Promise<boolean> {
    try { return (await Bun.spawn(['claude', '--version']).exited) === 0 } catch { return false }
  }
}
