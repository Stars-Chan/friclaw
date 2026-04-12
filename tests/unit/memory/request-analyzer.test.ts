import { describe, it, expect } from 'bun:test'
import { analyzeRequest } from '../../../src/memory/runtime/request-analyzer'

describe('analyzeRequest', () => {
  it('detects continue intent and extracts keywords', () => {
    const result = analyzeRequest('继续上次的 FriClaw memory 方案')
    expect(result.intent).toBe('continue')
    expect(result.keywords).toContain('FriClaw')
    expect(result.keywords).toContain('memory')
  })

  it('detects question intent', () => {
    const result = analyzeRequest('这个方案怎么做？')
    expect(result.intent).toBe('question')
  })

  it('extracts inline code and path-like entities', () => {
    const result = analyzeRequest('请看 `MemoryManager` 和 src/memory/manager.ts')
    expect(result.entities).toContain('MemoryManager')
    expect(result.entities).toContain('src/memory/manager.ts')
  })
})
