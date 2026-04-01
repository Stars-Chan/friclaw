// src/gateway/feishu.ts
import * as lark from '@larksuiteoapi/node-sdk'
import { logger } from '../utils/logger'
import type { Dispatcher, StreamHandler } from '../dispatcher'
import type { Gateway } from './types'
import type { Message, MessageType } from '../types/message'
import { unlinkSync } from 'node:fs'
import type { RunResponseStats } from '../agent/types'
import { formatStats } from './format-stats'
import { sanitizeForFeishuCard } from './format-content'

const log = logger('feishu')

// ── Card Element Types for JSON 2.0 ─────────────────────────────

type MarkdownEl = { tag: 'markdown'; content: string; element_id?: string }
type HrEl = { tag: 'hr'; element_id?: string }
type PlainTextEl = {
  tag: 'plain_text'
  content: string
  text_size?: string
  text_color?: string
}
type StandardIconEl = {
  tag: 'standard_icon'
  token: string
  color?: string
}
type DivEl = {
  tag: 'div'
  element_id?: string
  icon?: StandardIconEl
  text?: PlainTextEl
}
type CollapsiblePanel = {
  tag: 'collapsible_panel'
  element_id?: string
  expanded: boolean
  border?: { color?: string; corner_radius?: string }
  vertical_spacing?: string
  header: {
    title: PlainTextEl
    icon?: StandardIconEl
    icon_position?: string
    icon_expanded_angle?: number
  }
  elements: CardElement[]
}
type CardElement = MarkdownEl | HrEl | CollapsiblePanel | DivEl

// ── Streaming Card Element IDs ─────────────────────────────────

const STREAM_EL = {
  stepsPanel: 'steps_panel',
  mainMd: 'main_md',
  loadingDiv: 'loading_div',
  statsHr: 'stats_hr',
  statsNote: 'stats_note',
} as const

interface FeishuConfig {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
}

export class FeishuGateway implements Gateway {
  readonly kind = 'feishu'
  private client: lark.Client | null = null
  private wsClient: lark.WSClient | null = null
  private dispatcher: Dispatcher | null = null
  private processedMessageIds = new Set<string>()
  private readonly MAX_PROCESSED_IDS = 10000 // 最多缓存10000个message_id

  constructor(private config: FeishuConfig) {}

  async start(dispatcher: Dispatcher): Promise<void> {
    this.dispatcher = dispatcher
    this.client = new lark.Client({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    })

    const eventDispatcher = new lark.EventDispatcher({
      encryptKey: this.config.encryptKey ?? '',
      verificationToken: this.config.verificationToken ?? '',
    }).register({
      'im.message.receive_v1': async (event: unknown) => {
        const msg = await this.parseMessage(event as Record<string, unknown>)
        if (!msg) return

        // 消息去重：检查是否已处理过该message_id
        if (this.processedMessageIds.has(msg.messageId ?? '')) {
          log.debug({ messageId: msg.messageId, conversationId: msg.chatId }, '跳过重复消息')
          return
        }

        // 记录已处理的message_id
        this.processedMessageIds.add(msg.messageId ?? '')

        // 防止内存泄漏：当缓存过大时清理最老的条目
        if (this.processedMessageIds.size > this.MAX_PROCESSED_IDS) {
          const firstToDelete = Array.from(this.processedMessageIds).at(0)
          if (firstToDelete) {
            this.processedMessageIds.delete(firstToDelete)
            log.debug({ size: this.processedMessageIds.size }, '消息去重缓存已清理')
          }
        }

        const reply = (content: string) => {
          log.info({ content, conversationId: msg.chatId }, '飞书回复')
          return this.send(msg.chatId, content)
        }
        const streamHandler = this.buildStreamHandler(msg)
        await dispatcher.dispatch(msg, reply, streamHandler)
      },
      'im.message.message_read_v1': async () => {},
    })

    this.wsClient = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      eventDispatcher,
    } as never)

    await this.wsClient.start({ eventDispatcher })
    log.info('飞书网关已连接')
  }

  async stop(): Promise<void> {
    this.wsClient = null
    this.client = null
    this.dispatcher = null
    log.info('飞书网关已停止')
  }

  async send(chatId: string, content: string): Promise<string> {
    if (!this.client) throw new Error('Client not initialized')

    const res = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    })

    return (res.data as { message_id: string }).message_id
  }

  private async parseMessage(event: Record<string, unknown>): Promise<Message | null> {
    const message = event.message as Record<string, unknown>
    const sender = event.sender as Record<string, unknown>

    if (!['text', 'image'].includes(message.message_type as string)) return null

    let content: Record<string, unknown> = {}
    try {
      content = JSON.parse(message.content as string)
    } catch {
      return null
    }

    // Group chat: only respond when @mentioned
    if (message.chat_type === 'group') {
      const mentions = (content.mentions as Array<{ key: string }>) ?? []
      if (!mentions.some(m => m.key === '@_user_1')) return null
    }

    const messageType = message.message_type as string
    let text = ''
    let attachments: unknown[] = []
    let msgType: MessageType = 'text'

    if (messageType === 'text') {
      text = ((content.text as string) ?? '').trim()
      msgType = text.startsWith('/') ? 'command' : 'text'
    } else if (messageType === 'image') {
      attachments = await this.extractAttachments(message, content)
      msgType = 'image'
    }

    const threadRootId = message.root_id as string | null | undefined
    const chatId = threadRootId
      ? `${message.chat_id}:${threadRootId}`
      : (message.chat_id as string)

    const senderId = (sender.sender_id as Record<string, string>).user_id
    const chatType = message.chat_type === 'group' ? 'group' : 'private'

    return {
      platform: 'feishu',
      chatId,
      userId: senderId,
      type: msgType,
      content: text,
      messageId: message.message_id as string,
      chatType,
      attachments,
    }
  }

  private async extractAttachments(
    message: Record<string, unknown>,
    content: Record<string, unknown>
  ): Promise<unknown[]> {
    if (!this.client) return []

    const imageKey = content.image_key as string
    if (!imageKey) return []

    try {
      const res = await this.client.im.messageResource.get({
        params: { type: 'image' },
        path: {
          message_id: message.message_id as string,
          file_key: imageKey,
        },
      })

      // Handle both mock (string) and real SDK (object with writeFile) responses
      if (typeof res === 'string') {
        // Mock response in tests
        return [{ type: 'image', buffer: Buffer.from(res, 'base64') }]
      } else if (res && typeof res.writeFile === 'function') {
        // Real SDK response - save to temp file and read
        const tmpPath = `/tmp/friclaw_img_${Date.now()}.tmp`
        await res.writeFile(tmpPath)
        const buffer = await Bun.file(tmpPath).arrayBuffer()
        unlinkSync(tmpPath) // Clean up temp file
        return [{ type: 'image', buffer: Buffer.from(buffer) }]
      } else {
        log.warn({ res }, 'Unexpected messageResource response type')
        return []
      }
    } catch (err) {
      log.error({ err }, 'Failed to download Feishu image')
      return []
    }
  }

  private buildStreamHandler(msg: Message): StreamHandler {
    let cardId: string | null = null
    let mainText = ''
    let stepsPanelAdded = false
    let stepCount = 0
    let currentThinkingId: string | null = null
    let currentThinkingText = ''
    let thinkingSegmentCount = 0
    let lastStepId = ''
    let seq = 1
    let lastThinkingFlush = 0
    let lastMainFlush = 0
    const FLUSH_INTERVAL_MS = 300 // 增加到300ms，减少API调用频率，提升性能

    const ensureCard = async (): Promise<string> => {
      if (cardId) return cardId
      cardId = await this.createCardEntity()
      await this.sendCardByRef(msg.chatId, cardId, msg.messageId)
      log.info(`Streaming card ${cardId} sent to ${msg.chatId}`)
      return cardId
    }

    const addStep = async (
      id: string,
      stepDiv: Record<string, unknown>,
      stepId: string
    ): Promise<void> => {
      if (!stepsPanelAdded) {
        await this.insertStepsPanel(id, stepDiv, seq++)
        stepsPanelAdded = true
      } else {
        await this.appendStepToPanel(id, stepDiv, lastStepId, seq++)
      }
      lastStepId = stepId
    }

    const refreshPanelHeader = async (id: string, label: string): Promise<void> => {
      const countText = stepCount + ' ' + (stepCount === 1 ? 'step' : 'steps')
      await this.updatePanelHeader(id, `${label} (${countText})`, seq++).catch((e) =>
        log.debug(`updatePanelHeader failed: ${e}`)
      )
    }

    const finalizeThinking = async (id: string): Promise<void> => {
      if (!currentThinkingId) return
      await this.updateStepText(id, currentThinkingId, currentThinkingText, seq++).catch((e) =>
        log.debug(`final thinking segment flush failed: ${e}`)
      )
      currentThinkingId = null
      currentThinkingText = ''
    }

    return async (stream) => {
      try {
        for await (const event of stream) {
          const now = Date.now()

          if (event.type === 'thinking_delta') {
            currentThinkingText += event.text as string
            const id = await ensureCard()

            if (!currentThinkingId) {
              thinkingSegmentCount++
              stepCount++
              currentThinkingId = `thinking_${thinkingSegmentCount}`
              const thinkingDiv = this.buildStepDiv('', 'robot_outlined', currentThinkingId)
              await addStep(id, thinkingDiv, currentThinkingId).catch((e) =>
                log.debug(`addStep (thinking) failed: ${e}`)
              )
              await refreshPanelHeader(id, 'Working on it')
            }

            if (now - lastThinkingFlush >= FLUSH_INTERVAL_MS) {
              await this.updateStepText(id, currentThinkingId, currentThinkingText, seq++).catch(
                (e) => log.debug(`thinking update failed: ${e}`)
              )
              lastThinkingFlush = now
            }
          } else if (event.type === 'tool_use') {
            const id = await ensureCard()
            await finalizeThinking(id)

            stepCount++
            const { text, icon } = this.formatToolStep(event.name as string, event.input)
            const stepElementId = `step_${stepCount}`
            const stepDiv = this.buildStepDiv(text, icon, stepElementId)

            await addStep(id, stepDiv, stepElementId).catch((e) =>
              log.debug(`addStep (tool) failed: ${e}`)
            )
            await refreshPanelHeader(id, 'Working on it')
          } else if (event.type === 'text_delta') {
            const id = await ensureCard()
            await finalizeThinking(id)

            mainText += event.text as string
            if (now - lastMainFlush >= FLUSH_INTERVAL_MS) {
              await this.updateCardText(id, STREAM_EL.mainMd, mainText, seq++).catch((e) =>
                log.debug(`main update failed: ${e}`)
              )
              lastMainFlush = now
            }
          } else if (event.type === 'ask_questions') {
            const id = await ensureCard()
            await this.sendInteractiveForm(id, event.questions as string[])
            log.info(`Question form appended to card ${id}`)
          } else if (event.type === 'done') {
            const response = event.response as RunResponseStats
            const stats = formatStats(response)
            const id = await ensureCard()

            await finalizeThinking(id)

            mainText = response.text || mainText
            await this.updateCardText(id, STREAM_EL.mainMd, mainText, seq++).catch((e) =>
              log.debug(`final main update failed: ${e}`)
            )

            if (stepsPanelAdded && stepCount > 0) {
              const countText = stepCount + ' ' + (stepCount === 1 ? 'step' : 'steps')
              await this.updatePanelHeader(id, `Show ${countText}`, seq++).catch((e) =>
                log.debug(`final header update failed: ${e}`)
              )
            }

            await this.deleteCardElement(id, STREAM_EL.loadingDiv, seq++).catch((e) =>
              log.debug(`delete loading div failed: ${e}`)
            )

            if (stats) {
              await this.appendCardElements(
                id,
                [
                  { tag: 'hr', element_id: STREAM_EL.statsHr },
                  { tag: 'markdown', element_id: STREAM_EL.statsNote, content: `*${stats}*` },
                ],
                seq++
              ).catch((e) => log.debug(`append stats failed: ${e}`))
            }

            // 过滤外部图片URL后再记录和发送
            const sanitizedMainText = sanitizeForFeishuCard(mainText)
            log.info({ content: sanitizedMainText, conversationId: msg.chatId }, '飞书流式回复完成')
          }
        }
      } finally {
        if (cardId) {
          await this.closeCardStreaming(cardId, seq++).catch((e) =>
            log.debug(`closeCardStreaming failed: ${e}`)
          )
          if (stepsPanelAdded && stepCount > 0) {
            await this.patchCardElement(
              cardId,
              STREAM_EL.stepsPanel,
              { expanded: false },
              seq++
            ).catch((e) => log.debug(`collapse steps panel failed: ${e}`))
          }
        }
      }
    }
  }

  // ── CardKit Helper Methods ─────────────────────────────────────

  private async createCardEntity(): Promise<string> {
    if (!this.client) throw new Error('Client not initialized')
    const card = this.buildStreamingCardJson()
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          card: {
            create: (opts: {
              data: { type: string; data: string }
            }) => Promise<{ code: number; msg?: string; data?: { card_id: string } }>
          }
        }
      }
    }).cardkit.v1.card.create({
      data: { type: 'card_json', data: JSON.stringify(card) },
    })
    if (res.code !== 0) {
      throw new Error(`Failed to create card entity (code ${res.code}): ${res.msg ?? ''}`)
    }
    const cardId = res.data?.card_id
    if (!cardId) throw new Error('Card entity created but no card_id returned')
    return cardId
  }

  private async sendCardByRef(chatId: string, cardId: string, rootId?: string): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    const content = JSON.stringify({ type: 'card', data: { card_id: cardId } })

    if (rootId) {
      await (this.client as any).im.message.reply({
        path: { message_id: rootId },
        data: { msg_type: 'interactive', content },
      })
    } else {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'interactive', content },
      })
    }
  }

  private async insertStepsPanel(
    cardId: string,
    firstElement: Record<string, unknown>,
    sequence: number
  ): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          cardElement: {
            create: (opts: {
              path: { card_id: string }
              data: { type: string; target_element_id: string; elements: string; sequence: number }
            }) => Promise<{ code: number; msg?: string }>
          }
        }
      }
    }).cardkit.v1.cardElement.create({
      path: { card_id: cardId },
      data: {
        type: 'insert_before',
        target_element_id: STREAM_EL.mainMd,
        elements: JSON.stringify([
          {
            tag: 'collapsible_panel',
            element_id: STREAM_EL.stepsPanel,
            expanded: true,
            border: { color: 'grey-300', corner_radius: '6px' },
            vertical_spacing: '2px',
            header: {
              title: {
                tag: 'plain_text',
                text_color: 'grey',
                text_size: 'notation',
                content: 'Working on it',
              },
              icon: { tag: 'standard_icon', token: 'right_outlined', color: 'grey' },
              icon_position: 'right',
              icon_expanded_angle: 90,
            },
            elements: [firstElement],
          },
        ]),
        sequence,
      },
    })
    if (res.code !== 0) {
      throw new Error(`insertStepsPanel failed (code ${res.code}): ${res.msg ?? ''}`)
    }
  }

  private async appendStepToPanel(
    cardId: string,
    step: Record<string, unknown>,
    afterElementId: string,
    sequence: number
  ): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          cardElement: {
            create: (opts: {
              path: { card_id: string }
              data: { type: string; target_element_id: string; elements: string; sequence: number }
            }) => Promise<{ code: number; msg?: string }>
          }
        }
      }
    }).cardkit.v1.cardElement.create({
      path: { card_id: cardId },
      data: {
        type: 'insert_after',
        target_element_id: afterElementId,
        elements: JSON.stringify([step]),
        sequence,
      },
    })
    if (res.code !== 0) {
      throw new Error(`appendStepToPanel failed (code ${res.code}): ${res.msg ?? ''}`)
    }
  }

  private async updatePanelHeader(
    cardId: string,
    headerText: string,
    sequence: number
  ): Promise<void> {
    await this.patchCardElement(
      cardId,
      STREAM_EL.stepsPanel,
      {
        header: {
          title: {
            tag: 'plain_text',
            text_color: 'grey',
            text_size: 'notation',
            content: headerText,
          },
          icon: { tag: 'standard_icon', token: 'right_outlined', color: 'grey' },
          icon_position: 'right',
          icon_expanded_angle: 90,
        },
      },
      sequence
    )
  }

  private async updateStepText(
    cardId: string,
    elementId: string,
    text: string,
    sequence: number
  ): Promise<void> {
    await this.patchCardElement(
      cardId,
      elementId,
      {
        text: {
          tag: 'plain_text',
          text_color: 'grey',
          text_size: 'notation',
          content: text,
        },
      },
      sequence
    )
  }

  private async updateCardText(
    cardId: string,
    elementId: string,
    content: string,
    sequence: number
  ): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    // 过滤外部图片URL，飞书不支持直接使用外部图片
    const sanitizedContent = sanitizeForFeishuCard(content)
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          cardElement: {
            content: (opts: {
              path: { card_id: string; element_id: string }
              data: { content: string; sequence: number }
            }) => Promise<{ code: number; msg?: string }>
          }
        }
      }
    }).cardkit.v1.cardElement.content({
      path: { card_id: cardId, element_id: elementId },
      data: { content: sanitizedContent, sequence },
    })
    if (res.code !== 0) {
      throw new Error(`updateCardText failed (code ${res.code}): ${res.msg ?? ''}`)
    }
  }

  private async deleteCardElement(
    cardId: string,
    elementId: string,
    sequence: number
  ): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          cardElement: {
            delete: (opts: {
              path: { card_id: string; element_id: string }
              data: { sequence: number }
            }) => Promise<{ code: number; msg?: string }>
          }
        }
      }
    }).cardkit.v1.cardElement.delete({
      path: { card_id: cardId, element_id: elementId },
      data: { sequence },
    })
    if (res.code !== 0) {
      throw new Error(`deleteCardElement failed (code ${res.code}): ${res.msg ?? ''}`)
    }
  }

  private async appendCardElements(
    cardId: string,
    elements: Record<string, unknown>[],
    sequence: number,
    afterElementId?: string
  ): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          cardElement: {
            create: (opts: {
              path: { card_id: string }
              data: {
                type: string
                target_element_id?: string
                elements: string
                sequence: number
              }
            }) => Promise<{ code: number; msg?: string }>
          }
        }
      }
    }).cardkit.v1.cardElement.create({
      path: { card_id: cardId },
      data: {
        type: afterElementId ? 'insert_after' : 'append',
        target_element_id: afterElementId,
        elements: JSON.stringify(elements),
        sequence,
      },
    })
    if (res.code !== 0) {
      throw new Error(`appendCardElements failed (code ${res.code}): ${res.msg ?? ''}`)
    }
  }

  private async closeCardStreaming(cardId: string, sequence: number): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          card: {
            settings: (opts: {
              path: { card_id: string }
              data: { settings: string; sequence: number }
            }) => Promise<{ code: number; msg?: string }>
          }
        }
      }
    }).cardkit.v1.card.settings({
      path: { card_id: cardId },
      data: {
        settings: JSON.stringify({ config: { streaming_mode: false } }),
        sequence,
      },
    })
    if (res.code !== 0) {
      throw new Error(`closeCardStreaming failed (code ${res.code}): ${res.msg ?? ''}`)
    }
  }

  private async patchCardElement(
    cardId: string,
    elementId: string,
    partial: Record<string, unknown>,
    sequence: number
  ): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')
    const res = await (this.client as unknown as {
      cardkit: {
        v1: {
          cardElement: {
            patch: (opts: {
              path: { card_id: string; element_id: string }
              data: { partial_element: string; sequence: number }
            }) => Promise<{ code: number; msg?: string }>
          }
        }
      }
    }).cardkit.v1.cardElement.patch({
      path: { card_id: cardId, element_id: elementId },
      data: { partial_element: JSON.stringify(partial), sequence },
    })
    if (res.code !== 0) {
      throw new Error(`patchCardElement failed (code ${res.code}): ${res.msg ?? ''}`)
    }
  }

  private buildStreamingCardJson(): Record<string, unknown> {
    return {
      schema: '2.0',
      config: {
        streaming_mode: true,
        streaming_config: {
          print_frequency_ms: { default: 50 },
          print_step: { default: 5 },
          print_strategy: 'delay',
        },
        enable_forward: true,
        width_mode: 'fill',
      },
      body: {
        elements: [
          { tag: 'markdown', element_id: STREAM_EL.mainMd, content: '' },
          this.buildStepDiv('', 'more_outlined', STREAM_EL.loadingDiv),
        ],
      },
    }
  }

  private buildStepDiv(
    text: string,
    iconToken: string,
    elementId?: string
  ): Record<string, unknown> {
    return {
      tag: 'div',
      ...(elementId ? { element_id: elementId } : {}),
      icon: { tag: 'standard_icon', token: iconToken, color: 'grey' },
      text: {
        tag: 'plain_text',
        text_color: 'grey',
        text_size: 'notation',
        content: text,
      },
    }
  }

  private formatToolStep(name: string, input: unknown): { text: string; icon: string } {
    const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    switch (name) {
      case 'Agent':
      case 'Task':
        return { text: 'Run sub-agent', icon: 'robot_outlined' }
      case 'Bash':
        return {
          text: (inp['description'] as string) ?? (inp['command'] as string) ?? 'Run command',
          icon: 'computer_outlined',
        }
      case 'Edit':
        return { text: `Edit "${inp['file_path'] ?? ''}"`, icon: 'edit_outlined' }
      case 'Glob':
        return {
          text: `Search files by pattern "${inp['pattern'] ?? ''}"`,
          icon: 'card-search_outlined',
        }
      case 'Grep':
        return {
          text: `Search text by pattern "${inp['pattern'] ?? ''}"${inp['glob'] ? ` in "${inp['glob']}"` : ''}`,
          icon: 'doc-search_outlined',
        }
      case 'Read':
        return { text: `Read file "${inp['file_path'] ?? ''}"`, icon: 'file-link-bitable_outlined' }
      case 'Write':
        return { text: `Write file "${inp['file_path'] ?? ''}"`, icon: 'edit_outlined' }
      case 'Skill':
        return { text: `Load skill "${inp['skill'] ?? ''}"`, icon: 'file-link-mindnote_outlined' }
      case 'WebFetch':
        return { text: `Fetch web page from "${inp['url'] ?? ''}"`, icon: 'language_outlined' }
      case 'WebSearch':
        return { text: `Search web for "${inp['query'] ?? ''}"`, icon: 'search_outlined' }
      case 'NotebookEdit':
        return { text: `Edit notebook "${inp['notebook'] ?? ''}"`, icon: 'edit_outlined' }
      case 'TodoRead':
      case 'TodoWrite':
        return { text: name === 'TodoRead' ? 'Read todos' : 'Update todos', icon: 'list_outlined' }
      default:
        return { text: name, icon: 'setting-inter_outlined' }
    }
  }

  private async sendInteractiveForm(cardId: string, questions: unknown[]): Promise<void> {
    if (!this.client) throw new Error('Client not initialized')

    const formEls: Record<string, unknown>[] = [{ tag: 'hr' }]

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i] as Record<string, unknown>
      formEls.push({ tag: 'markdown', content: `**${i + 1}. ${q.question as string}**` })
      formEls.push({
        tag: 'select_static',
        name: `q${i}`,
        required: true,
        width: 'fill',
        placeholder: { tag: 'plain_text', content: '请选择...' },
        options: (q.options as Array<{ label: string; description?: string }>).map((opt) => ({
          text: {
            tag: 'plain_text',
            content: opt.description ? `${opt.label}: ${opt.description}` : opt.label,
          },
          value: opt.label,
        })),
      })
    }

    formEls.push({
      tag: 'button',
      name: 'friclaw_submit',
      type: 'primary_filled',
      width: 'default',
      text: { tag: 'plain_text', content: '提交' },
      form_action_type: 'submit',
    })

    await this.appendCardElements(cardId, formEls, 1)
  }
}
