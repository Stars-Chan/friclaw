import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Database } from 'bun:sqlite'
import { initDatabase, search } from '../../../src/memory/database'
import { EpisodeMemory } from '../../../src/memory/episode'

let tmpDir: string
let db: Database
let episode: EpisodeMemory

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'friclaw-test-'))
  mkdirSync(join(tmpDir, 'episodes'), { recursive: true })
  db = initDatabase(join(tmpDir, 'index.sqlite'))
  episode = new EpisodeMemory(db, tmpDir)
})

afterEach(() => {
  db.close()
  rmSync(tmpDir, { recursive: true })
})

describe('EpisodeMemory', () => {
  it('save() returns an id string', () => {
    const id = episode.save('user asked about weather')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('save() writes markdown file to episodes dir', () => {
    const id = episode.save('user asked about weather', ['weather'])
    const files = readdirSync(join(tmpDir, 'episodes'))
    expect(files.some(f => f.includes(id))).toBe(true)
  })

  it('recent() returns saved episodes in reverse order', () => {
    episode.save('first summary')
    episode.save('second summary')
    const episodes = episode.recent(10)
    expect(episodes.length).toBe(2)
    expect(episodes[0].summary).toContain('second summary')
  })

  it('recent() ignores thread state markdown in episodes root', () => {
    episode.save('real summary')
    writeFileSync(join(tmpDir, 'episodes', 'misplaced-thread.md'), `---\nthreadId: dashboard:test:1\nchatKey: dashboard:test\nstatus: dormant\nstartedAt: 2026-04-12T00:00:00.000Z\nupdatedAt: 2026-04-12T00:00:00.000Z\n---\n`, 'utf-8')

    const episodes = episode.recent(10)
    expect(episodes).toHaveLength(1)
    expect(episodes[0].summary).toBe('real summary')
  })

  it('normalizes paused thread state to dormant when saving a linked episode', () => {
    const thread = episode.createThread({
      platform: 'feishu',
      chatId: 'ou_abc',
      sessionId: 'feishu:ou_abc',
      workspaceDir: '/tmp/workspace',
    })

    const id = episode.save('Pending follow-up', ['memory'], {
      threadId: thread.threadId,
      chatKey: thread.chatKey,
      status: 'paused' as any,
      nextStep: 'Resume tomorrow',
    })

    expect(episode.read(id)?.status).toBe('paused')
    expect(episode.readThreadState(thread.threadId)?.status).toBe('dormant')
  })

  it('does not reactivate a dormant thread when status is omitted on later saves', () => {
    const thread = episode.createThread({
      platform: 'feishu',
      chatId: 'ou_abc',
      sessionId: 'feishu:ou_abc',
      workspaceDir: '/tmp/workspace',
    })

    episode.updateThreadState(thread.threadId, { status: 'dormant' })
    episode.save('Additional note', ['memory'], {
      threadId: thread.threadId,
      chatKey: thread.chatKey,
    })

    expect(episode.readThreadState(thread.threadId)?.status).toBe('dormant')
  })

  it('listThreadPreviews() returns linked summary previews', () => {
    const thread = episode.createThread({
      platform: 'feishu',
      chatId: 'ou_abc',
      sessionId: 'feishu:ou_abc',
      workspaceDir: '/tmp/workspace',
      title: 'memory work',
    })
    episode.save('Need to continue memory implementation with preview text', ['memory'], {
      threadId: thread.threadId,
      chatKey: thread.chatKey,
      nextStep: 'Finish retrieval',
    })

    const previews = episode.listThreadPreviews()
    expect(previews).toHaveLength(1)
    expect(previews[0].threadId).toBe(thread.threadId)
    expect(previews[0].summaryPreview).toContain('Need to continue memory implementation')
  })
})
