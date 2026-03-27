// src/dashboard/api.ts
import type { Dispatcher } from '../dispatcher'
import { logger } from '../utils/logger'
import { DashboardSessionManager } from './session-manager.js'
import type { ServerMessage } from './types.js'
import type { Message } from '../types/message.js'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

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
const WEB_DIR = join(process.cwd(), 'src/web')

export async function startDashboard(
  port: number,
  dispatcher: Dispatcher,
  workspacesDir: string,
): Promise<void> {
  const sessionManager = new DashboardSessionManager(workspacesDir)
  const clients = new Map<string, any>() // sessionId -> WebSocket

  // Start frontend dev server if web directory exists
  let frontendProcess: ReturnType<typeof spawn> | null = null
  if (existsSync(WEB_DIR)) {
    logger.info('Starting frontend dev server...')
    frontendProcess = spawn('npm', ['run', 'dev'], {
      cwd: WEB_DIR,
      stdio: 'pipe',
      shell: true,
    })

    frontendProcess.stdout?.on('data', (data) => {
      const output = data.toString()
      if (output.includes('Local:') || output.includes('ready')) {
        logger.info(`Frontend: ${output.trim()}`)
      }
    })

    frontendProcess.stderr?.on('data', (data) => {
      logger.error(`Frontend error: ${data.toString()}`)
    })
  }

  Bun.serve({
    port,
    async fetch(req, server) {
      const url = new URL(req.url)

      // Upgrade WebSocket connection
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req)
        if (upgraded) {
          return undefined // Connection upgraded successfully
        }
        return new Response('WebSocket upgrade failed', { status: 400 })
      }

      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders })
      }

      // Health check endpoint
      if (url.pathname === '/health') {
        return Response.json({
          status: 'ok',
          uptime: Math.floor((Date.now() - startTime) / 1000),
          sessions: sessionManager.listAll().length,
        }, { headers: corsHeaders })
      }

      // List sessions endpoint
      if (url.pathname === '/api/sessions') {
        return Response.json({
          sessions: sessionManager.listAll(),
        }, { headers: corsHeaders })
      }

      // Get session history endpoint
      if (url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/history')) {
        const sessionId = url.pathname.split('/')[3]
        return Response.json({
          messages: sessionManager.loadHistory(sessionId),
        }, { headers: corsHeaders })
      }

      // Config endpoint
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

      // Saved configs endpoint
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

      // 404 for other endpoints (frontend dev server handles UI)
      return new Response('Not Found', { status: 404, headers: corsHeaders })
    },
    websocket: {
      message: (ws, message) => handleWebSocketMessage(ws as unknown as ServerWebSocket, message, dispatcher, sessionManager, clients),
      open: (ws) => {
        const wsClientId = Math.random().toString(36).slice(2)
        const serverWs = ws as unknown as ServerWebSocket
        serverWs.data = { clientId: wsClientId }
        logger.debug(`WebSocket client connected: ${wsClientId}`)
      },
      close: (ws) => {
        const serverWs = ws as unknown as ServerWebSocket
        const clientId = serverWs.data?.clientId
        logger.debug(`WebSocket client disconnected: ${clientId}`)

        // Find and remove all sessions associated with this connection
        for (const [sessionId, clientWs] of clients.entries()) {
          if (clientWs === ws) {
            sessionManager.disconnect(sessionId)
            clients.delete(sessionId)
          }
        }
      },
    },
  })

  // Log access URLs
  logger.info(``)
  logger.info(`🚀 FriClaw Dashboard is ready!`)
  logger.info(``)
  logger.info(`   Dashboard:  http://localhost:5173`)
  logger.info(`   WebSocket:  ws://localhost:${port}/ws`)
  logger.info(`   API:        http://localhost:${port}`)
  logger.info(``)
  logger.info(`   Press Ctrl+C to stop`)
  logger.info(``)

  // Cleanup on exit
  process.on('SIGINT', () => {
    if (frontendProcess) {
      frontendProcess.kill('SIGTERM')
    }
    process.exit(0)
  })

  // Keep the server running
  return new Promise(() => {})
}

async function handleWebSocketMessage(
  ws: ServerWebSocket,
  message: string | Buffer,
  dispatcher: Dispatcher,
  sessionManager: DashboardSessionManager,
  clients: Map<string, ServerWebSocket>,
): Promise<void> {
  try {
    const data = JSON.parse(message.toString())
    const clientId = ws.data?.clientId

    if (data.type === 'register') {
      // Session registration
      const sessionId = data.sessionId || 'default'
      logger.debug(`Registering session: ${sessionId}, connection: ${clientId}`)

      // Store WebSocket for this session
      clients.set(sessionId, ws)
      ws.data.sessionId = sessionId

      // Send current sessions list
      sendToClient(ws, {
        type: 'sessions_update',
        sessionId,
        data: { sessions: sessionManager.listAll() },
      })

      // Send history messages if session exists
      const history = await sessionManager.loadHistory(sessionId)
      if (history.length > 0) {
        sendToClient(ws, {
          type: 'history',
          sessionId,
          data: { messages: history },
        })
      }
    } else if (data.type === 'message') {
      const sessionId = data.sessionId || 'default'
      const content = data.content || ''

      if (!content) {
        sendToClient(ws, {
          type: 'error',
          sessionId,
          data: { message: 'Message content is required' },
        })
        return
      }

      // Store WebSocket for this session
      clients.set(sessionId, ws)
      ws.data.sessionId = sessionId

      logger.info(`[Dashboard] Session ${sessionId}: ${content.slice(0, 50)}...`)

      // Handle built-in commands
      if (content === '/new') {
        const newSessionId = `session_${Date.now()}`
        sessionManager.createOrUpdate(newSessionId, 'New session')

        // Broadcast sessions update FIRST so frontend knows about new session
        broadcastSessionsUpdate(sessionManager, clients)

        // Switch client to new session
        clients.set(newSessionId, ws)
        ws.data.sessionId = newSessionId

        // Send switch session command
        sendToClient(ws, {
          type: 'switch_session',
          sessionId,
          data: { newSessionId },
        })

        // Send empty history for new session
        sendToClient(ws, {
          type: 'history',
          sessionId: newSessionId,
          data: { messages: [] },
        })
        return
      }

      if (content === '/clear') {
        await sessionManager.clearHistory(sessionId)

        // Clear Claude conversation context
        const conversationId = `dashboard:${sessionId}`
        dispatcher['sessionManager'].clearSession(conversationId)

        sendToClient(ws, {
          type: 'response',
          sessionId,
          data: { text: '✓ Session history cleared.' },
        })
        sendToClient(ws, {
          type: 'history',
          sessionId,
          data: { messages: [] },
        })
        return
      }

      // Update or create session for normal messages
      sessionManager.createOrUpdate(sessionId, content)

      // Save user message to history
      await sessionManager.saveMessage(sessionId, {
        role: 'user',
        content,
        timestamp: Date.now(),
      })

      // Broadcast sessions update
      broadcastSessionsUpdate(sessionManager, clients)

      // Process message through dispatcher
      let assistantResponse = ''
      const replyFn = async (responseContent: string) => {
        assistantResponse = responseContent
        sendToClient(ws, {
          type: 'response',
          sessionId,
          data: { text: responseContent },
        })
        return responseContent
      }

      const streamFn = async (stream: AsyncGenerator<{ type: string; [key: string]: unknown }>) => {
        sendToClient(ws, {
          type: 'stream_start',
          sessionId,
          data: {},
        })

        let thinkingContent = ''
        let textContent = ''

        for await (const event of stream) {
          if (event.type === 'text_delta' || event.type === 'thinking_delta') {
            const text = String(event.text || '')
            const isThinking = event.type === 'thinking_delta'

            if (isThinking) {
              thinkingContent += text
            } else {
              textContent += text
              assistantResponse += text
            }

            sendToClient(ws, {
              type: 'stream_delta',
              sessionId,
              data: { text, isThinking },
            })
          } else if (event.type === 'done') {
            sendToClient(ws, {
              type: 'stream_stats',
              sessionId,
              data: event.response,
            })
          }
        }

        sendToClient(ws, {
          type: 'stream_end',
          sessionId,
          data: {},
        })

        // Save assistant response to history (without thinking content)
        if (textContent) {
          await sessionManager.saveMessage(sessionId, {
            role: 'assistant',
            content: textContent,
            timestamp: Date.now(),
            thinkingContent: thinkingContent || undefined,
          })
        }
      }

      // Create proper Message object
      const msg: Message = {
        platform: 'dashboard',
        chatId: sessionId,
        userId: 'dashboard_user',
        type: 'text',
        content: content,
        messageId: `dashboard_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        attachments: [],
      }

      await dispatcher.dispatch(msg, replyFn, streamFn)
    }
  } catch (error) {
    logger.error({ err: error }, 'Error handling WebSocket message')
    sendToClient(ws, {
      type: 'error',
      sessionId: ws.data?.sessionId || 'unknown',
      data: { message: 'Failed to process message' },
    })
  }
}

function sendToClient(ws: ServerWebSocket, message: ServerMessage): void {
  if (ws.readyState === 1) { // OPEN
    ws.send(JSON.stringify(message))
  }
}

function broadcastSessionsUpdate(sessionManager: DashboardSessionManager, clients: Map<string, ServerWebSocket>): void {
  const message: ServerMessage = {
    type: 'sessions_update',
    sessionId: 'broadcast',
    data: { sessions: sessionManager.listAll() },
  }

  // Send to all connected clients
  for (const ws of clients.values()) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message))
    }
  }
}
