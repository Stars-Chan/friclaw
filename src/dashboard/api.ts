// src/dashboard/api.ts
import type { Dispatcher, StreamHandler } from '../dispatcher'
import { logger } from '../utils/logger'
import { DashboardSessionManager } from './session-manager.js'
import type { ClientMessage, ServerMessage } from './types.js'
import type { Message } from '../types/message.js'
import type { CronScheduler } from '../cron/scheduler'
import { TokenStatsManager } from './token-stats.js'
import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseFrontmatter, normalizeStringArray, serializeFrontmatter } from '../memory/frontmatter'
import { isEpisodeRecord } from '../memory/episode'
import { toValidatedKnowledgeRecord } from '../memory/knowledge'
import type { EpisodeMetadata, KnowledgeMetadata } from '../memory/types'

const log = logger('dashboard')

interface WebSocketData {
  clientId: string
  sessionId?: string
}

interface ServerWebSocket {
  data: WebSocketData
  readyState: number
  send(data: string): void
}

const startTime = Date.now()
const startedAt = new Date(startTime).toISOString()
const WEB_DIR = join(process.cwd(), 'src/web')

export interface DashboardPushFn {
  (sessionId: string, content: string): Promise<void>
}

function listThreadFiles(memoryDir: string): string[] {
  try {
    return readdirSync(join(memoryDir, 'episodes', 'threads'))
      .filter((f: string) => f.endsWith('.md'))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function parseKnowledgeSummary(id: string, raw: string) {
  const parsed = parseFrontmatter<KnowledgeMetadata>(raw)
  return {
    id,
    title: parsed.metadata.title ?? id,
    tags: normalizeStringArray(parsed.metadata.tags),
    domain: typeof parsed.metadata.domain === 'string' ? parsed.metadata.domain : '',
    status: typeof parsed.metadata.status === 'string' ? parsed.metadata.status : '',
    confidence: typeof parsed.metadata.confidence === 'string' ? parsed.metadata.confidence : '',
    updatedAt: typeof parsed.metadata.updatedAt === 'string' ? parsed.metadata.updatedAt : '',
  }
}

function parseEpisodeSummary(id: string, raw: string) {
  if (!isEpisodeRecord(raw)) return null
  const parsed = parseFrontmatter<EpisodeMetadata>(raw)
  return {
    id,
    date: parsed.metadata.date ?? '',
    tags: normalizeStringArray(parsed.metadata.tags),
    summary: parsed.body,
    threadId: typeof parsed.metadata.threadId === 'string' ? parsed.metadata.threadId : '',
    status: typeof parsed.metadata.status === 'string' ? parsed.metadata.status : '',
    nextStep: typeof parsed.metadata.nextStep === 'string' ? parsed.metadata.nextStep : '',
    blockers: normalizeStringArray(parsed.metadata.blockers),
  }
}

function sendToClient(ws: ServerWebSocket, message: ServerMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message))
  }
}

function sendHistory(ws: ServerWebSocket, sessionId: string, messages: Awaited<ReturnType<DashboardSessionManager['loadHistory']>>): void {
  sendToClient(ws, {
    type: 'history',
    sessionId,
    data: { messages },
  })
}

function sendSessionsUpdate(ws: ServerWebSocket, sessionId: string, sessionManager: DashboardSessionManager): void {
  sendToClient(ws, {
    type: 'sessions_update',
    sessionId,
    data: { sessions: sessionManager.listAll() },
  })
}

function toInternalMessage(sessionId: string, content: string): Message {
  const trimmed = content.trim()
  return {
    platform: 'dashboard',
    chatId: sessionId,
    userId: 'dashboard_user',
    type: trimmed.startsWith('/') ? 'command' : 'text',
    content,
    messageId: `dashboard_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    attachments: [],
  }
}

function updateFrontmatterContent<T extends object>(content: string, defaults: Partial<T> = {}): string {
  const parsed = parseFrontmatter<T>(content)
  const now = new Date().toISOString()
  const date = typeof (parsed.metadata as Record<string, unknown>).date === 'string'
    ? (parsed.metadata as Record<string, unknown>).date as string
    : now.slice(0, 10)

  return serializeFrontmatter({
    ...defaults,
    ...parsed.metadata,
    date,
    updatedAt: now,
  }, parsed.body)
}

function toKnowledgeRecord(topic: string, content: string) {
  const parsed = parseFrontmatter<KnowledgeMetadata>(content)
  return toValidatedKnowledgeRecord(topic, {
    content: parsed.body,
    metadata: parsed.metadata,
  })
}

export async function startDashboard(
  port: number,
  dispatcher: Dispatcher,
  workspacesDir: string,
  cronScheduler: CronScheduler,
  memoryManager?: any,
  options: { startFrontendDevServer?: boolean } = {},
): Promise<DashboardPushFn> {
  const sessionManager = new DashboardSessionManager(workspacesDir)
  const tokenStats = new TokenStatsManager(workspacesDir)
  const clients = new Map<string, ServerWebSocket>()

  let frontendProcess: ReturnType<typeof spawn> | null = null
  if (options.startFrontendDevServer !== false && existsSync(WEB_DIR)) {
    log.info('Starting frontend dev server...')
    frontendProcess = spawn('bun', ['run', 'dev'], {
      cwd: WEB_DIR,
      stdio: 'pipe',
      shell: true,
    })

    frontendProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      if (output.includes('Local:') || output.includes('ready')) {
        log.info(`Frontend: ${output.trim()}`)
      }
    })

    frontendProcess.stderr?.on('data', (data) => {
      log.error(`Frontend error: ${data.toString()}`)
    })
  }

  Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req)
        if (upgraded) {
          return undefined
        }
        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders })
      }

      if (url.pathname === '/health') {
        return Response.json({
          service: 'friclaw',
          kind: 'dashboard-api',
          pid: process.pid,
          port,
          startedAt,
          status: 'ok',
          uptime: Math.floor((Date.now() - startTime) / 1000),
          sessions: sessionManager.listAll().length,
        }, { headers: corsHeaders })
      }

      if (url.pathname === '/api/sessions') {
        return Response.json({
          sessions: sessionManager.listAll(),
        }, { headers: corsHeaders })
      }

      if (url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/history')) {
        const sessionId = url.pathname.split('/')[3]
        const messages = await sessionManager.loadHistory(sessionId)
        return Response.json({
          messages,
        }, { headers: corsHeaders })
      }

      if (url.pathname === '/api/config') {
        const settingsPath = join(process.env.HOME || '', '.claude', 'settings.json')

        if (req.method === 'POST') {
          try {
            const { env } = await req.json()
            const file = Bun.file(settingsPath)
            const settings = await file.json()
            settings.env = env
            await Bun.write(settingsPath, JSON.stringify(settings, null, 2))
            return Response.json({ success: true }, { headers: corsHeaders })
          } catch {
            return Response.json({ success: false }, { status: 500, headers: corsHeaders })
          }
        }

        try {
          const file = Bun.file(settingsPath)
          const settings = await file.json()
          const savedConfigsPath = join(process.env.HOME || '', '.claude', 'saved-configs.json')
          const savedFile = Bun.file(savedConfigsPath)
          let saved = []
          try {
            saved = await savedFile.json()
          } catch {}
          return Response.json({ env: settings.env || {}, saved }, { headers: corsHeaders })
        } catch {
          return Response.json({ env: {}, saved: [] }, { headers: corsHeaders })
        }
      }

      if (url.pathname === '/api/config/saved') {
        const savedConfigsPath = join(process.env.HOME || '', '.claude', 'saved-configs.json')

        if (req.method === 'POST') {
          try {
            const { saved } = await req.json()
            await Bun.write(savedConfigsPath, JSON.stringify(saved, null, 2))
            return Response.json({ success: true }, { headers: corsHeaders })
          } catch {
            return Response.json({ success: false }, { status: 500, headers: corsHeaders })
          }
        }
      }

      if (url.pathname === '/api/stats/tokens') {
        const days = parseInt(url.searchParams.get('days') || '7')
        const stats = await tokenStats.getStats(days)
        return Response.json({ stats }, { headers: corsHeaders })
      }

      if (url.pathname === '/api/memory/identity') {
        const memoryDir = join(process.env.HOME || '', '.friclaw', 'memory')
        const soulPath = join(memoryDir, 'SOUL.md')

        if (req.method === 'GET') {
          try {
            const file = Bun.file(soulPath)
            const content = await file.exists() ? await file.text() : ''
            return Response.json({ content, threadFiles: listThreadFiles(memoryDir) }, { headers: corsHeaders })
          } catch {
            return Response.json({ content: '', threadFiles: [] }, { headers: corsHeaders })
          }
        }

        if (req.method === 'POST') {
          try {
            const { content } = await req.json()
            const updatedContent = updateFrontmatterContent(content, { title: 'FriClaw Identity' })
            if (memoryManager?.identity) {
              memoryManager.identity.update(updatedContent, { source: 'manual_update' })
            } else {
              await Bun.write(soulPath, updatedContent)
            }
            return Response.json({ success: true }, { headers: corsHeaders })
          } catch {
            return Response.json({ success: false }, { status: 500, headers: corsHeaders })
          }
        }
      }

      if (url.pathname === '/api/memory/identity/review' && req.method === 'POST') {
        try {
          const { id, decision, reviewer, rationale } = await req.json()
          const reviewed = memoryManager?.reviewIdentityCandidate?.(id, { decision, reviewer, rationale })
          if (!reviewed) {
            return Response.json({ success: false }, { status: 404, headers: corsHeaders })
          }
          return Response.json({ success: true, candidate: reviewed }, { headers: corsHeaders })
        } catch {
          return Response.json({ success: false }, { status: 500, headers: corsHeaders })
        }
      }

      if (url.pathname === '/api/memory/knowledge') {
        const memoryDir = join(process.env.HOME || '', '.friclaw', 'memory')
        const knowledgeDir = join(memoryDir, 'knowledge')

        if (req.method === 'GET') {
          try {
            const { readdirSync, readFileSync } = await import('fs')
            const list = readdirSync(knowledgeDir)
              .filter(f => f.endsWith('.md'))
              .map(f => parseKnowledgeSummary(f.replace('.md', ''), readFileSync(join(knowledgeDir, f), 'utf-8')))
            return Response.json({ list }, { headers: corsHeaders })
          } catch {
            return Response.json({ list: [] }, { headers: corsHeaders })
          }
        }
      }

      if (url.pathname.match(/^\/api\/memory\/knowledge\/.+$/)) {
        const memoryDir = join(process.env.HOME || '', '.friclaw', 'memory')
        const knowledgeDir = join(memoryDir, 'knowledge')
        const topic = decodeURIComponent(url.pathname.split('/').pop()!)
        const filePath = join(knowledgeDir, `${topic}.md`)

        if (req.method === 'GET') {
          try {
            const file = Bun.file(filePath)
            const content = await file.exists() ? await file.text() : ''
            return Response.json({ content }, { headers: corsHeaders })
          } catch {
            return Response.json({ content: '' }, { headers: corsHeaders })
          }
        }
        if (req.method === 'POST') {
          try {
            const { content } = await req.json()
            const updatedContent = updateFrontmatterContent<KnowledgeMetadata>(content)
            if (memoryManager?.knowledge) {
              memoryManager.knowledge.saveRecord(toKnowledgeRecord(topic, updatedContent))
            } else {
              await Bun.write(filePath, updatedContent)
            }
            return Response.json({ success: true }, { headers: corsHeaders })
          } catch {
            return Response.json({ success: false }, { status: 500, headers: corsHeaders })
          }
        }
      }

      if (url.pathname === '/api/memory/episodes') {
        const memoryDir = join(process.env.HOME || '', '.friclaw', 'memory')
        const episodesDir = join(memoryDir, 'episodes')

        try {
          const { readdirSync, readFileSync } = await import('fs')
          const episodes = readdirSync(episodesDir)
            .filter(f => f.endsWith('.md'))
            .sort()
            .reverse()
            .flatMap((f) => {
              const raw = readFileSync(join(episodesDir, f), 'utf-8')
              const parsed = parseEpisodeSummary(f.replace('.md', ''), raw)
              return parsed ? [parsed] : []
            })
            .slice(0, 50)

          return Response.json({ episodes }, { headers: corsHeaders })
        } catch {
          return Response.json({ episodes: [] }, { headers: corsHeaders })
        }
      }

      if (url.pathname === '/api/cron/jobs') {
        if (req.method === 'GET') {
          return Response.json({ jobs: cronScheduler.list() }, { headers: corsHeaders })
        }
        if (req.method === 'POST') {
          try {
            const body = await req.json()
            const job = cronScheduler.create(body)
            return Response.json({ job }, { headers: corsHeaders })
          } catch (err) {
            return Response.json({ error: err instanceof Error ? err.message : 'Failed to create job' }, { status: 500, headers: corsHeaders })
          }
        }
      }

      if (url.pathname === '/api/cron/targets') {
        const platform = url.searchParams.get('platform') || 'dashboard'
        const targets: Array<{ chatId: string; userId: string; label: string }> = []

        if (platform === 'dashboard') {
          const sessions = sessionManager.listAll()
          sessions.forEach(s => {
            targets.push({
              chatId: s.id,
              userId: 'dashboard_user',
              label: s.id,
            })
          })
        }

        return Response.json({ targets }, { headers: corsHeaders })
      }

      if (url.pathname.match(/^\/api\/cron\/jobs\/[^/]+$/)) {
        const id = url.pathname.split('/').pop()!

        if (req.method === 'PUT') {
          try {
            const body = await req.json()
            const job = cronScheduler.update(id, body)
            return Response.json({ job }, { headers: corsHeaders })
          } catch (err) {
            return Response.json({ error: err instanceof Error ? err.message : 'Failed to update job' }, { status: 500, headers: corsHeaders })
          }
        }

        if (req.method === 'DELETE') {
          try {
            cronScheduler.delete(id)
            return Response.json({ success: true }, { headers: corsHeaders })
          } catch (err) {
            return Response.json({ error: err instanceof Error ? err.message : 'Failed to delete job' }, { status: 500, headers: corsHeaders })
          }
        }
      }

      if (url.pathname === '/api/gateways') {
        const friclawConfigPath = join(process.env.HOME || '', '.friclaw', 'config.json')

        if (req.method === 'GET') {
          try {
            const file = Bun.file(friclawConfigPath)
            const config = await file.json()
            return Response.json({ gateways: config.gateways || {} }, { headers: corsHeaders })
          } catch {
            return Response.json({ gateways: {} }, { headers: corsHeaders })
          }
        }

        if (req.method === 'POST') {
          try {
            const { gateways } = await req.json()
            const file = Bun.file(friclawConfigPath)
            const config = await file.json()
            config.gateways = gateways
            await Bun.write(friclawConfigPath, JSON.stringify(config, null, 2))
            return Response.json({ success: true }, { headers: corsHeaders })
          } catch {
            return Response.json({ success: false }, { status: 500, headers: corsHeaders })
          }
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders })
    },
    websocket: {
      message: (ws, message) => handleWebSocketMessage(
        ws as unknown as ServerWebSocket,
        message,
        dispatcher,
        sessionManager,
        clients,
        tokenStats,
        workspacesDir,
        memoryManager,
      ),
      open: (ws) => {
        const wsClientId = Math.random().toString(36).slice(2)
        const serverWs = ws as unknown as ServerWebSocket
        serverWs.data = { clientId: wsClientId }
        log.debug(`WebSocket client connected: ${wsClientId}`)
      },
      close: (ws) => {
        const serverWs = ws as unknown as ServerWebSocket
        const clientId = serverWs.data?.clientId
        const sessionId = serverWs.data?.sessionId
        log.debug(`WebSocket client disconnected: ${clientId}`)

        if (sessionId) {
          clients.delete(sessionId)
          sessionManager.disconnect(sessionId)
        }
      },
    },
  })

  log.info(``)
  log.info(`🚀 FriClaw Dashboard is ready!`)
  log.info(``)
  log.info(`   Dashboard:  http://localhost:5173`)
  log.info(`   WebSocket:  ws://localhost:${port}/ws`)
  log.info(`   API:        http://localhost:${port}`)
  log.info(``)
  log.info(`   Press Ctrl+C to stop`)
  log.info(``)

  return async (sessionId: string, content: string) => {
    const ws = clients.get(sessionId)
    if (ws && ws.readyState === 1) {
      sendToClient(ws, {
        type: 'response',
        sessionId,
        data: { text: content },
      })
      sessionManager.saveMessageSync(sessionId, {
        role: 'assistant',
        content,
        timestamp: Date.now(),
      })
    }
  }
}

export async function handleWebSocketMessage(
  ws: ServerWebSocket,
  data: string | Buffer,
  dispatcher: Dispatcher,
  sessionManager: DashboardSessionManager,
  clients: Map<string, ServerWebSocket>,
  tokenStats: TokenStatsManager,
  workspacesDir: string,
  memoryManager?: any,
): Promise<void> {
  try {
    const message = JSON.parse(data.toString()) as ClientMessage
    const sessionId = message.sessionId || 'default'

    ws.data.sessionId = sessionId
    clients.set(sessionId, ws)

    if (message.type === 'register') {
      sendSessionsUpdate(ws, sessionId, sessionManager)
      const history = await sessionManager.loadHistory(sessionId)
      sendHistory(ws, sessionId, history)
      return
    }

    const content = message.content || ''
    if (!content) {
      sendToClient(ws, {
        type: 'error',
        sessionId,
        data: { message: 'Message content is required' },
      })
      return
    }

    if (content === '/new') {
      const previousSession = sessionManager.get(sessionId)
      if (previousSession && memoryManager?.startBackgroundSummary) {
        memoryManager.startBackgroundSummary({
          sessionId: `dashboard:${sessionId}`,
          workspaceDir: join(workspacesDir, `dashboard_${sessionId}`),
          chatKey: `dashboard:${sessionId}`,
        })
      }

      const newSessionId = `session_${Date.now()}`
      sessionManager.createOrUpdate(newSessionId, 'New session')

      if (memoryManager?.ensureThread) {
        memoryManager.ensureThread({
          sessionId: `dashboard:${newSessionId}`,
          platform: 'dashboard',
          chatId: newSessionId,
          workspaceDir: join(workspacesDir, `dashboard_${newSessionId}`),
        })
      }

      clients.set(newSessionId, ws)
      ws.data.sessionId = newSessionId
      sendSessionsUpdate(ws, newSessionId, sessionManager)
      sendToClient(ws, {
        type: 'switch_session',
        sessionId,
        data: { newSessionId },
      })
      sendHistory(ws, newSessionId, [])
      return
    }

    sessionManager.createOrUpdate(sessionId, content)
    sessionManager.saveMessageSync(sessionId, {
      role: 'user',
      content,
      timestamp: Date.now(),
    })
    sendSessionsUpdate(ws, sessionId, sessionManager)

    let textContent = ''
    let thinkingContent = ''

    const reply = async (replyContent: string) => {
      textContent = replyContent
      sessionManager.saveMessageSync(sessionId, {
        role: 'assistant',
        content: replyContent,
        timestamp: Date.now(),
      })
      sendToClient(ws, {
        type: 'response',
        sessionId,
        data: { text: replyContent },
      })
      return replyContent
    }

    const streamHandler: StreamHandler = async (stream) => {
      sendToClient(ws, {
        type: 'stream_start',
        sessionId,
        data: {},
      })

      for await (const event of stream) {
        if ((event.type === 'text_delta' || event.type === 'thinking_delta') && typeof event.text === 'string') {
          if (event.type === 'thinking_delta') {
            thinkingContent += event.text
          } else {
            textContent += event.text
          }
          sendToClient(ws, {
            type: 'stream_delta',
            sessionId,
            data: {
              text: event.text,
              ...(event.type === 'thinking_delta' ? { isThinking: true } : {}),
            },
          })
          continue
        }

        if (event.type === 'done') {
          const response = event.response as {
            model?: string
            inputTokens?: number
            outputTokens?: number
            costCny?: number
            elapsedMs?: number
          }
          if (response.inputTokens !== undefined && response.outputTokens !== undefined) {
            await tokenStats.record({
              timestamp: Date.now(),
              sessionId,
              inputTokens: response.inputTokens,
              outputTokens: response.outputTokens,
              model: response.model || 'unknown',
              costCny: response.costCny,
            })
          }
          sendToClient(ws, {
            type: 'stream_stats',
            sessionId,
            data: {
              model: response.model,
              inputTokens: response.inputTokens,
              outputTokens: response.outputTokens,
              costCny: response.costCny,
              elapsedMs: response.elapsedMs,
            },
          })
        }
      }

      sendToClient(ws, {
        type: 'stream_end',
        sessionId,
        data: {},
      })

      if (textContent) {
        sessionManager.saveMessageSync(sessionId, {
          role: 'assistant',
          content: textContent,
          timestamp: Date.now(),
          thinkingContent: thinkingContent || undefined,
        })
      }
    }

    await dispatcher.dispatch(toInternalMessage(sessionId, content), reply, streamHandler)
  } catch (err) {
    log.error({ error: err }, 'Failed to handle WebSocket message')
    const sessionId = ws.data?.sessionId || 'unknown'
    sendToClient(ws, {
      type: 'error',
      sessionId,
      data: { message: '消息处理失败' },
    })
  }
}
