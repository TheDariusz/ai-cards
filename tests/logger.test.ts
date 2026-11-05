import { describe, it, expect, vi } from 'vitest'
import { createLogger, formatErr, type LogEntry, type LogSink } from '../app/lib/logger'

function fakeSink() {
  const writes: LogEntry[][] = []
  const sink: LogSink = { write: vi.fn(async (entries) => { writes.push([...entries]) }) }
  return { sink, writes }
}

describe('createLogger', () => {
  it('buffers entries and flushes them once to the sink', async () => {
    const { sink, writes } = fakeSink()
    let t = 1000
    const log = createLogger(sink, 'http', () => t++)
    log.info('a', { event: 'x' })
    log.warn('b')
    log.error('c', { user_id: 7 })
    expect(sink.write).not.toHaveBeenCalled()
    await log.flush()
    expect(sink.write).toHaveBeenCalledTimes(1)
    expect(writes[0]).toEqual([
      { ts: 1000, level: 'info', msg: 'a', logger: 'http', event: 'x' },
      { ts: 1001, level: 'warn', msg: 'b', logger: 'http' },
      { ts: 1002, level: 'error', msg: 'c', logger: 'http', user_id: 7 },
    ])
  })

  it('child shares the buffer and overrides logger name', async () => {
    const { sink, writes } = fakeSink()
    const log = createLogger(sink, 'http', () => 1)
    log.child('pipeline').info('inner')
    log.info('outer')
    await log.flush()
    expect(writes[0].map((e) => e.logger)).toEqual(['pipeline', 'http'])
  })

  it('error formats err into the err field', async () => {
    const { sink, writes } = fakeSink()
    const log = createLogger(sink, 'http', () => 1)
    log.error('x', {}, new TypeError('boom'))
    await log.flush()
    expect(writes[0][0].err).toBe('TypeError: boom')
  })

  it('with a null sink flush resolves and drops entries', async () => {
    const log = createLogger(null, 'http')
    log.info('a')
    await expect(log.flush()).resolves.toBeUndefined()
  })

  it('flush is idempotent', async () => {
    const { sink } = fakeSink()
    const log = createLogger(sink, 'http')
    log.info('a')
    await log.flush()
    await log.flush()
    expect(sink.write).toHaveBeenCalledTimes(1)
  })
})

describe('formatErr', () => {
  it('names an Error and stringifies anything else', () => {
    expect(formatErr(new RangeError('r'))).toBe('RangeError: r')
    expect(formatErr('plain')).toBe('plain')
  })
})
