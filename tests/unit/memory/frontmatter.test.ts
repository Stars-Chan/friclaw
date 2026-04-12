import { describe, it, expect } from 'bun:test'
import { parseFrontmatter, serializeFrontmatter } from '../../../src/memory/frontmatter'

describe('frontmatter helpers', () => {
  it('parses legacy frontmatter', () => {
    const input = `---\ntitle: preferences\ndate: 2026-04-12\ntags: [user, prefs]\n---\n\nlikes Bun`
    const result = parseFrontmatter<{ title?: string; tags?: string[] }>(input)
    expect(result.metadata.title).toBe('preferences')
    expect(result.metadata.tags).toEqual(['user', 'prefs'])
    expect(result.body).toBe('likes Bun')
  })

  it('serializes arrays and body content', () => {
    const output = serializeFrontmatter({ title: 'project', tags: ['memory', 'thread'] }, 'details here')
    expect(output).toContain('tags: ["memory","thread"]')
    expect(output).toContain('details here')
  })

  it('preserves date while updating updatedAt through round-trip serialization', () => {
    const input = `---\ntitle: FriClaw Identity\ndate: 2026-04-12\nupdatedAt: 2026-04-12T00:00:00.000Z\n---\n\nidentity body`
    const parsed = parseFrontmatter<{ title?: string; date?: string; updatedAt?: string }>(input)
    const output = serializeFrontmatter({
      ...parsed.metadata,
      date: parsed.metadata.date,
      updatedAt: '2026-04-13T00:00:00.000Z',
    }, parsed.body)

    expect(output).toContain('date: 2026-04-12')
    expect(output).toContain('updatedAt: "2026-04-13T00:00:00.000Z"')
    expect(output).toContain('identity body')
  })

  it('round-trips multiline strings', () => {
    const output = serializeFrontmatter({
      title: 'project',
      nextStep: 'line one\nline two: keep both',
    }, 'details here')
    const parsed = parseFrontmatter<{ nextStep?: string }>(output)

    expect(parsed.metadata.nextStep).toBe('line one\nline two: keep both')
  })

  it('parses JSON-style arrays containing commas', () => {
    const input = `---\ntags: ["memory,system", "thread"]\n---\n\nbody`
    const parsed = parseFrontmatter<{ tags?: string[] }>(input)

    expect(parsed.metadata.tags).toEqual(['memory,system', 'thread'])
  })
})
