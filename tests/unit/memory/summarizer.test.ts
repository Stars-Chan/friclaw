import { describe, test, expect } from 'bun:test'
import { summarizeTranscript } from '../../../src/memory/summarizer'

describe('summarizeTranscript', () => {
  test.skip('should generate summary from transcript (requires Claude CLI)', async () => {
    // 这个测试需要 Claude CLI 可用，跳过以避免 CI 失败
    const transcript = `[user] 你好，我想了解一下如何使用 FriClaw

[assistant] 你好！FriClaw 是一个 AI 助手平台，支持通过飞书、企业微信等平台接入。你可以通过以下方式使用：

1. 配置网关（飞书/企业微信）
2. 启动服务
3. 在对应平台与 FriClaw 对话

[user] 如何配置飞书网关？

[assistant] 配置飞书网关需要以下步骤：

1. 在飞书开放平台创建应用
2. 获取 appId、appSecret、verificationToken、encryptKey
3. 在 ~/.friclaw/config.json 中配置这些参数
4. 启动服务后，飞书会自动连接`

    const summary = await summarizeTranscript(transcript, 'claude-haiku-4-5', 30000)

    expect(summary).toBeTruthy()
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toContain('---')
    expect(summary).toContain('title:')
    expect(summary).toContain('date:')
  }, 60000) // 60s timeout for API call
})
