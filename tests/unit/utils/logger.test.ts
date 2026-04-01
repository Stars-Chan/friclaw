// tests/unit/utils/logger.test.ts
import { describe, it, expect } from 'bun:test'
import { logger } from '../../../src/utils/logger'

describe('logger', () => {
  it('exports a logger factory function', () => {
    expect(logger).toBeDefined()
    const log = logger('test')
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.warn).toBe('function')
  })
})
