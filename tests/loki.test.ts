import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLokiSink, lokiSinkFromEnv } from '../app/lib/loki'
import type { LogEntry } from '../app/lib/logger'

afterEach(() => vi.unstubAllGlobals())

const opts = { url: 'https://logs.example/loki/api/v1/push', user: 'u', token: 't', env: 'prod' as const }
const entries: LogEntry[] = [
  { ts: 1000, level: 'info', msg: 'a', logger: 'http' },
  { ts: 1001, level: 'error', msg: 'b', logger: 'http', err: 'Error: x' },
  { ts: 1002, level: 'info', msg: 'c', logger: 'cron', event: 'reminders_run', count: 2 },
]

describe('createLokiSink', () => {
  it('posts one streams payload grouped by level with basic auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await createLokiSink(opts).write(entries)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(opts.url)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Basic ' + btoa('u:t'))
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      streams: [
        {
          stream: { service: 'ai-cards', env: 'prod', level: 'info' },
          values: [
            ['1000000000', JSON.stringify({ msg: 'a', logger: 'http' })],
            ['1002000000', JSON.stringify({ msg: 'c', logger: 'cron', event: 'reminders_run', count: 2 })],
          ],
        },
        {
          stream: { service: 'ai-cards', env: 'prod', level: 'error' },
          values: [['1001000000', JSON.stringify({ msg: 'b', logger: 'http', err: 'Error: x' })]],
        },
      ],
    })
  })

  it('does not fetch for an empty batch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await createLokiSink(opts).write([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('swallows a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 500 })))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(createLokiSink(opts).write(entries)).resolves.toBeUndefined()
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })

  it('swallows a thrown fetch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(createLokiSink(opts).write(entries)).resolves.toBeUndefined()
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})

describe('lokiSinkFromEnv', () => {
  const env = { LOKI_PUSH_URL: opts.url, LOKI_USER: 'u', LOKI_TOKEN: 't' }

  it('returns null when any of the three is blank', () => {
    expect(lokiSinkFromEnv({ ...env, LOKI_PUSH_URL: '' })).toBeNull()
    expect(lokiSinkFromEnv({ ...env, LOKI_USER: ' ' })).toBeNull()
    expect(lokiSinkFromEnv({ ...env, LOKI_TOKEN: undefined })).toBeNull()
  })

  it('builds a sink otherwise', () => {
    expect(lokiSinkFromEnv(env)).not.toBeNull()
  })

  it('labels streams with the given env', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await lokiSinkFromEnv(env, 'dev')!.write(entries)
    const { streams } = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(streams.map((s: { stream: { env: string } }) => s.stream.env)).toEqual(['dev', 'dev'])
  })

  it('defaults to dev under vite dev (as vitest runs)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await lokiSinkFromEnv(env)!.write(entries)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).streams[0].stream.env).toBe('dev')
  })
})
