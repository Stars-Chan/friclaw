// tests/unit/daemon.test.ts
import { describe, it, expect, mock, afterEach } from 'bun:test'

// We test the shutdown logic directly, not via process signals
// to avoid process.exit() terminating the test runner.
import { createShutdownHandler } from '../../src/daemon'

describe('createShutdownHandler', () => {
  it('calls dispatcher.shutdown exactly once', async () => {
    const shutdown = mock(async () => {})
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')

    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('is idempotent — second call is a no-op', async () => {
    const shutdown = mock(async () => {})
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')
    await handler('SIGINT') // second call

    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it('exits with code 1 when dispatcher.shutdown throws', async () => {
    const shutdown = mock(async () => { throw new Error('db error') })
    const exit = mock((_code: number) => {})
    const dispatcher = { shutdown } as any

    const handler = createShutdownHandler(dispatcher, exit)
    await handler('SIGTERM')

    expect(exit).toHaveBeenCalledWith(1)
  })
})
