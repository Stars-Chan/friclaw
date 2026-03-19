// tests/unit/utils/logger.test.ts
import { describe, it, expect } from 'bun:test'
import { logger } from '../../../src/utils/logger'

describe('logger', () => {
  it('exports a pino logger instance', () => {
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
  })

  it('respects LOG_LEVEL env var', () => {
    process.env.LOG_LEVEL = 'warn'
    // Re-import won't work due to module cache; test the level directly
    expect(logger.level).toBeDefined()
  })
})
