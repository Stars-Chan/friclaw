// src/types/message.ts
export type MessageType = 'text' | 'command' | 'file' | 'image'

export interface Message {
  platform: 'feishu' | 'wecom' | 'dashboard'
  chatId: string
  userId: string
  type: MessageType
  content: string
  messageId?: string
  chatType?: 'private' | 'group'
  attachments?: unknown[]
}
