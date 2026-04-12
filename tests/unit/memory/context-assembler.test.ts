import { describe, it, expect } from 'bun:test'
import { assembleMemoryContext } from '../../../src/memory/runtime/context-assembler'

describe('assembleMemoryContext', () => {
  it('returns empty prompt block when nothing is retrieved', () => {
    const result = assembleMemoryContext({ knowledge: [] })
    expect(result.promptBlock).toBe('')
  })

  it('renders knowledge and episode sections', () => {
    const result = assembleMemoryContext({
      knowledge: [
        {
          id: 'knowledge/project',
          title: 'project',
          content: 'Important background for current work.',
          tags: ['work'],
          score: 5,
        },
      ],
      episode: {
        id: 'episode/1',
        title: 'episode-1',
        summary: 'Previous session decided to continue implementation.',
        tags: ['memory'],
        score: 4,
      },
    })

    expect(result.promptBlock).toContain('[Memory Context]')
    expect(result.promptBlock).toContain('[Relevant Knowledge]')
    expect(result.promptBlock).toContain('[Relevant Episode]')
  })
})
