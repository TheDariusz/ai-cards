// Port for structured logs. Entries are buffered per request (or cron run) and written once
// by `flush()`, which the Worker hands to `ctx.waitUntil` so the response never waits on it.
// Lines are English and machine-read: never an email address, a name or card text.
export type Level = 'debug' | 'info' | 'warn' | 'error'

export type LogEntry = {
  ts: number
  level: Level
  msg: string
  logger: string
  event?: string
  user_id?: number
  err?: string
} & Record<string, unknown>

export type LogSink = { write: (entries: readonly LogEntry[]) => Promise<void> }

type Fields = Record<string, unknown>

export type Logger = {
  info(msg: string, fields?: Fields): void
  warn(msg: string, fields?: Fields): void
  error(msg: string, fields?: Fields, err?: unknown): void
  child(logger: string): Logger
  flush(): Promise<void>
}

export function formatErr(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

// `sink` null (no Loki config) keeps the same API and drops everything on flush.
export function createLogger(sink: LogSink | null, logger: string, now: () => number = Date.now): Logger {
  const buffer: LogEntry[] = []
  const make = (name: string): Logger => {
    const push = (level: Level, msg: string, fields?: Fields) => {
      buffer.push({ ts: now(), level, msg, logger: name, ...fields })
    }
    return {
      info: (msg, fields) => push('info', msg, fields),
      warn: (msg, fields) => push('warn', msg, fields),
      error: (msg, fields, err) => push('error', msg, err === undefined ? fields : { ...fields, err: formatErr(err) }),
      child: (child) => make(child),
      async flush() {
        const entries = buffer.splice(0)
        if (sink && entries.length > 0) await sink.write(entries)
      },
    }
  }
  return make(logger)
}
