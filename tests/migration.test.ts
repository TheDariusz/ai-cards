import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Birkenbihl migration', () => {
  it('backfills historical cards as already learned without inventing a decode', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(readFileSync('drizzle/0000_init.sql', 'utf8'))
    sqlite.prepare(`
      INSERT INTO cards (word, status, due_at, interval_days, ease, created_at)
      VALUES (?, 'ready', ?, 1, 2.5, ?)
    `).run('historical', 1_750_086_400_000, 1_750_000_000_000)

    sqlite.exec(readFileSync('drizzle/0001_great_professor_monster.sql', 'utf8'))

    const row = sqlite.prepare(
      'SELECT decode_parts, first_learned_at, created_at FROM cards WHERE word = ?',
    ).get('historical') as { decode_parts: string | null; first_learned_at: number; created_at: number }
    expect(row.decode_parts).toBeNull()
    expect(row.first_learned_at).toBe(row.created_at)
  })
})
