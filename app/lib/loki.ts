import type { LogEntry, LogSink } from './logger'

// The only file that knows Loki. Labels are fixed by the central-logging contract:
// service, env and level, nothing else; every other field rides in the JSON line.
const SERVICE = 'ai-cards'
const TIMEOUT_MS = 5_000

export type LokiEnv = 'prod' | 'dev'

export function createLokiSink(opts: { url: string; user: string; token: string; env: LokiEnv; fetchImpl?: typeof fetch }): LogSink {
  return {
    async write(entries) {
      if (entries.length === 0) return
      const byLevel = new Map<string, [string, string][]>()
      for (const { ts, level, ...line } of entries) {
        const values = byLevel.get(level) ?? []
        values.push([String(ts * 1_000_000), JSON.stringify(line)])
        byLevel.set(level, values)
      }
      const streams = [...byLevel].map(([level, values]) => ({ stream: { service: SERVICE, env: opts.env, level }, values }))
      // a Loki outage must never fail a request or the cron: one console line, then move on
      try {
        const res = await (opts.fetchImpl ?? fetch)(opts.url, {
          method: 'POST',
          headers: { Authorization: `Basic ${btoa(`${opts.user}:${opts.token}`)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ streams }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (!res.ok) console.error(`loki: push ${res.status}: ${(await res.text()).slice(0, 300)}`)
      } catch (err) {
        console.error(`loki: push failed ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}

// The URL and user are committed, so the token alone turns shipping on; a blank token (CI, most
// local setups) ships nothing. `vite dev` labels its lines env=dev so they never feed prod alerts.
export function lokiSinkFromEnv(
  env: { LOKI_PUSH_URL?: string; LOKI_USER?: string; LOKI_TOKEN?: string },
  label: LokiEnv = import.meta.env.DEV ? 'dev' : 'prod',
): LogSink | null {
  const url = env.LOKI_PUSH_URL?.trim()
  const user = env.LOKI_USER?.trim()
  const token = env.LOKI_TOKEN?.trim()
  if (!url || !user || !token) return null
  return createLokiSink({ url, user, token, env: label })
}
