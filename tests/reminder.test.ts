import { describe, it, expect } from 'vitest'
import { isReminderHour, shouldRemind, pluralKarty, pluralNowa, buildReminder, type ReminderState } from '../app/lib/reminder'

const at = (iso: string) => Date.parse(iso)

describe('isReminderHour', () => {
  it('17:00 UTC in July is 19:00 CEST', () => expect(isReminderHour(at('2026-07-15T17:00:00Z'))).toBe(true))
  it('18:00 UTC in July is not', () => expect(isReminderHour(at('2026-07-15T18:00:00Z'))).toBe(false))
  it('18:00 UTC in January is 19:00 CET', () => expect(isReminderHour(at('2026-01-15T18:00:00Z'))).toBe(true))
  it('17:00 UTC in January is not', () => expect(isReminderHour(at('2026-01-15T17:00:00Z'))).toBe(false))
  it('switch to CEST on 2026-03-29', () => {
    expect(isReminderHour(at('2026-03-29T17:00:00Z'))).toBe(true)
    expect(isReminderHour(at('2026-03-29T18:00:00Z'))).toBe(false)
  })
  it('switch to CET on 2026-10-25', () => {
    expect(isReminderHour(at('2026-10-25T18:00:00Z'))).toBe(true)
    expect(isReminderHour(at('2026-10-25T17:00:00Z'))).toBe(false)
  })
})

describe('shouldRemind', () => {
  const base: ReminderState = { enabled: true, today: '2026-09-27', lastSent: null, dayDone: false, due: 3, fresh: 0 }
  it('sends when the day is open and cards are due', () => expect(shouldRemind(base)).toEqual({ send: true }))
  it('skips when disabled', () => expect(shouldRemind({ ...base, enabled: false })).toEqual({ send: false, reason: 'disabled' }))
  it('skips when already sent today', () =>
    expect(shouldRemind({ ...base, lastSent: '2026-09-27' })).toEqual({ send: false, reason: 'already-sent' }))
  it('still sends when last sent yesterday', () => expect(shouldRemind({ ...base, lastSent: '2026-09-26' })).toEqual({ send: true }))
  it('skips when the day is done', () => expect(shouldRemind({ ...base, dayDone: true })).toEqual({ send: false, reason: 'day-done' }))
  it('skips when nothing to do', () =>
    expect(shouldRemind({ ...base, due: 0, fresh: 0 })).toEqual({ send: false, reason: 'nothing-to-do' }))
  it('sends for new cards only', () => expect(shouldRemind({ ...base, due: 0, fresh: 2 })).toEqual({ send: true }))
  it('disabled wins over day-done', () =>
    expect(shouldRemind({ ...base, enabled: false, dayDone: true })).toEqual({ send: false, reason: 'disabled' }))
})

describe('Polish plurals', () => {
  it('pluralKarty', () =>
    expect([1, 2, 4, 5, 12, 14, 21, 22, 25].map(pluralKarty))
      .toEqual(['karta', 'karty', 'karty', 'kart', 'kart', 'kart', 'kart', 'karty', 'kart']))
  it('pluralNowa', () => expect([1, 3, 5, 22].map(pluralNowa)).toEqual(['nowa', 'nowe', 'nowych', 'nowe']))
})

describe('buildReminder', () => {
  const url = 'https://x.dev'
  it('due cards with a streak', () => {
    const m = buildReminder({ due: 12, fresh: 0, streak: 7, appUrl: url })
    expect(m.subject).toBe('12 kart do powtórki · streak 7 dni')
    expect(m.text).toContain('Twoja seria: 7 dni — nie przerywaj jej dziś.')
    expect(m.text).toContain('https://x.dev/review')
  })
  it('due and new cards, streak of one day', () => {
    const m = buildReminder({ due: 2, fresh: 3, streak: 1, appUrl: url })
    expect(m.subject).toBe('2 karty do powtórki · streak 1 dzień')
    expect(m.text).toContain('Masz dziś 2 karty do powtórki i 3 nowe karty do nauki.')
  })
  it('no streak suffix at 0', () => {
    const m = buildReminder({ due: 5, fresh: 0, streak: 0, appUrl: url })
    expect(m.subject).toBe('5 kart do powtórki')
    expect(m.text).not.toContain('seria')
  })
  it('new cards only link to /learn with agreeing verb', () => {
    const m = buildReminder({ due: 0, fresh: 3, streak: 0, appUrl: url })
    expect(m.subject).toBe('3 nowe karty czekają na naukę')
    expect(m.html).toContain('href="https://x.dev/learn"')
    expect(m.html).not.toContain('/review')
    expect(buildReminder({ due: 0, fresh: 1, streak: 0, appUrl: url }).subject).toBe('1 nowa karta czeka na naukę')
    expect(buildReminder({ due: 0, fresh: 5, streak: 0, appUrl: url }).subject).toBe('5 nowych kart czeka na naukę')
  })
  it('nothing to do links home', () => {
    const m = buildReminder({ due: 0, fresh: 0, streak: 0, appUrl: url })
    expect(m.subject).toBe('Brak kart na dziś')
    expect(m.html).toContain('href="https://x.dev/"')
  })
  it('trims a trailing slash', () => {
    const m = buildReminder({ due: 1, fresh: 0, streak: 0, appUrl: 'https://x.dev/' })
    expect(m.text).toContain('https://x.dev/review')
    expect(m.text).not.toContain('//review')
  })
  it('escapes appUrl in HTML', () => {
    const m = buildReminder({ due: 1, fresh: 0, streak: 0, appUrl: 'https://x.dev/?a=1&b="2"' })
    expect(m.html).toContain('&amp;b=&quot;2&quot;')
    expect(m.html).not.toContain('b="2"')
  })
})
