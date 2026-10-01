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

describe('multi-user migration', () => {
  it('assigns every existing row to the owner without touching review history', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON') // D1 always enforces them
    for (const f of ['0000_init', '0001_great_professor_monster', '0002_steep_doctor_faustus']) {
      sqlite.exec(readFileSync(`drizzle/${f}.sql`, 'utf8'))
    }
    const { lastInsertRowid: cardId } = sqlite.prepare(`
      INSERT INTO cards (word, status, due_at, interval_days, ease, created_at)
      VALUES ('kept', 'ready', 1, 1, 2.5, 1)
    `).run()
    sqlite.prepare(`INSERT INTO review_log (card_id, reviewed_at, mode, grade) VALUES (?, 2, 'flip', 'good')`).run(cardId)
    sqlite.exec(`INSERT INTO day_log (date) VALUES ('2026-09-30')`)
    sqlite.exec(`INSERT INTO settings (key, value) VALUES ('reminderEnabled', 'false')`)

    sqlite.exec(readFileSync('drizzle/0003_multi_user.sql', 'utf8'))

    expect(sqlite.prepare('SELECT id, email FROM users').all()).toEqual([{ id: 1, email: null }])
    expect(sqlite.prepare('SELECT user_id FROM cards').all()).toEqual([{ user_id: 1 }])
    expect(sqlite.prepare('SELECT count(*) AS n FROM review_log').get()).toEqual({ n: 1 })
    expect(sqlite.prepare('SELECT user_id, date FROM day_log').all()).toEqual([{ user_id: 1, date: '2026-09-30' }])
    expect(sqlite.prepare('SELECT user_id, key, value FROM settings').all())
      .toEqual([{ user_id: 1, key: 'reminderEnabled', value: 'false' }])
  })
})
