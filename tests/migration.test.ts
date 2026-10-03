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

describe('open sign-up + credits migrations', () => {
  it('blocks rejected addresses, grants existing users the starter pool, drops access_requests', () => {
    const sqlite = new Database(':memory:')
    const files = ['0000_init', '0001_great_professor_monster', '0002_steep_doctor_faustus', '0003_multi_user', '0004_login_tokens', '0005_access_requests']
    for (const f of files) sqlite.exec(readFileSync(`drizzle/${f}.sql`, 'utf8'))
    sqlite.exec(`
      UPDATE users SET email = 'owner@example.com' WHERE id = 1;
      INSERT INTO users (email, created_at) VALUES ('friend@example.com', 10), ('revoked@example.com', 11);
      INSERT INTO access_requests (email, status, requested_at, decided_at) VALUES
        ('friend@example.com', 'approved', 1, 2),
        ('revoked@example.com', 'rejected', 1, 5),
        ('spammer@example.com', 'rejected', 3, 4),
        ('waiting@example.com', 'pending', 6, NULL);
    `)

    sqlite.exec(readFileSync('drizzle/0006_open_signup.sql', 'utf8'))
    sqlite.exec(readFileSync('drizzle/0007_credits.sql', 'utf8'))

    const blocked = sqlite.prepare('SELECT email, blocked_at FROM users ORDER BY id').all()
    expect(blocked).toEqual([
      { email: 'owner@example.com', blocked_at: null },
      { email: 'friend@example.com', blocked_at: null },
      { email: 'revoked@example.com', blocked_at: 5 },
      { email: 'spammer@example.com', blocked_at: 4 },
    ])
    const grants = sqlite.prepare(`
      SELECT u.email, g.amount_micros, g.reason FROM credit_grants g JOIN users u ON u.id = g.user_id ORDER BY u.id
    `).all()
    expect(grants.map((g: any) => g.email)).toEqual(['friend@example.com', 'revoked@example.com', 'spammer@example.com'])
    expect(grants.every((g: any) => g.amount_micros === 500_000 && g.reason === 'starter')).toBe(true)
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'access_requests'").all()).toEqual([])
  })
})
