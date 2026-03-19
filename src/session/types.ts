// src/session/types.ts
export interface Session {
  id: string              // `${platform}:${chatId}`
  userId: string
  chatId: string
  platform: 'feishu' | 'wecom' | 'dashboard'
  chatType: 'private' | 'group'
  workspaceDir: string
  createdAt: number
  lastActiveAt: number
  agentSessionId?: string
}

export interface SessionStats {
  total: number
  byPlatform: Record<string, number>
  oldest: number | null
}
