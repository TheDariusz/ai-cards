import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import type { Db } from '../../app/db/repo'

export function testDb(): Db {
  const sqlite = new Database(':memory:')
  for (const f of readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`drizzle/${f}`, 'utf8'))
  }
  // better-sqlite3 drizzle is API-compatible with the D1 drizzle for our usage
  return drizzle(sqlite) as unknown as Db
}
