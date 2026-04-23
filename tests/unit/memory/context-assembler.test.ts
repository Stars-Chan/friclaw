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

  it('clips by layer and prompt budgets deterministically', () => {
    const result = assembleMemoryContext({
      knowledge: [
        {
          id: 'knowledge/1',
          title: 'knowledge-1',
          content: 'A'.repeat(120),
          tags: ['memory'],
          score: 5,
        },
        {
          id: 'knowledge/2',
          title: 'knowledge-2',
          content: 'B'.repeat(120),
          tags: ['memory'],
          score: 4,
        },
      ],
      episode: {
        id: 'episode/1',
        title: 'episode-1',
        summary: 'C'.repeat(200),
        tags: ['memory'],
        score: 3,
      },
      budget: {
        knowledgeItems: 1,
        knowledgeChars: 40,
        episodeChars: 60,
        promptChars: 180,
        recentEpisodes: 5,
        threadEpisodes: 3,
      },
      diagnostics: {
        requestIntent: 'continue',
        keywords: ['memory'],
        entities: [],
        knowledge: { queries: ['memory'], considered: 2, selectedIds: ['knowledge/1'], clipped: false, candidates: [] },
        episode: { queries: ['memory'], considered: 1, selectedIds: ['episode/1'], clipped: false, candidates: [] },
        budget: {
          config: {
            knowledgeItems: 1,
            knowledgeChars: 40,
            episodeChars: 60,
            promptChars: 180,
            recentEpisodes: 5,
            threadEpisodes: 3,
          },
          usage: { knowledgeItems: 0, knowledgeChars: 0, episodeChars: 0, promptChars: 0 },
          clippedLayers: [],
        },
      },
    })

    expect(result.knowledge).toHaveLength(1)
    expect(result.knowledge[0].content.length).toBeLessThanOrEqual(40)
    expect(result.episode?.summary.length).toBeLessThanOrEqual(60)
    expect(result.promptBlock.length).toBeLessThanOrEqual(180)
    expect(result.diagnostics?.budget.clippedLayers).toEqual(expect.arrayContaining(['knowledge', 'episode', 'prompt']))
  })
})
