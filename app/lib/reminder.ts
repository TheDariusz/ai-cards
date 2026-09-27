import type { MailMessage } from './mailer'

export function isReminderHour(nowMs: number, hour = 19): boolean {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date(nowMs))
  return Number(h) === hour
}

export type SkipReason = 'disabled' | 'already-sent' | 'day-done' | 'nothing-to-do'
export type ReminderState = {
  enabled: boolean
  today: string
  lastSent: string | null
  dayDone: boolean
  due: number
  fresh: number
}

export function shouldRemind(s: ReminderState): { send: true } | { send: false; reason: SkipReason } {
  if (!s.enabled) return { send: false, reason: 'disabled' }
  if (s.lastSent === s.today) return { send: false, reason: 'already-sent' }
  if (s.dayDone) return { send: false, reason: 'day-done' }
  if (s.due + s.fresh === 0) return { send: false, reason: 'nothing-to-do' }
  return { send: true }
}

type PluralForm = 'one' | 'few' | 'many'

function plForm(n: number): PluralForm {
  if (n === 1) return 'one'
  const last = n % 10
  const lastTwo = n % 100
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'few' : 'many'
}

export function pluralKarty(n: number): 'karta' | 'karty' | 'kart' {
  return ({ one: 'karta', few: 'karty', many: 'kart' } as const)[plForm(n)]
}

export function pluralNowa(n: number): 'nowa' | 'nowe' | 'nowych' {
  return ({ one: 'nowa', few: 'nowe', many: 'nowych' } as const)[plForm(n)]
}

const karty = (n: number) => `${n} ${pluralKarty(n)}`
const noweKarty = (n: number) => `${n} ${pluralNowa(n)} ${pluralKarty(n)}`
const dni = (n: number) => `${n} ${n === 1 ? 'dzień' : 'dni'}`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function buildReminder(input: { due: number; fresh: number; streak: number; appUrl: string }): MailMessage {
  const { due, fresh, streak } = input
  const base = input.appUrl.replace(/\/$/, '')

  let subject: string
  let status: string
  let button: { label: string; url: string }
  if (due > 0) {
    subject = `${karty(due)} do powtórki` + (streak >= 1 ? ` · streak ${dni(streak)}` : '')
    status = fresh > 0
      ? `Masz dziś ${karty(due)} do powtórki i ${noweKarty(fresh)} do nauki.`
      : `Masz dziś ${karty(due)} do powtórki.`
    button = { label: 'Zacznij review', url: `${base}/review` }
  } else if (fresh > 0) {
    subject = `${noweKarty(fresh)} ${plForm(fresh) === 'few' ? 'czekają' : 'czeka'} na naukę`
    status = `Masz dziś ${noweKarty(fresh)} do nauki.`
    button = { label: 'Zacznij naukę', url: `${base}/learn` }
  } else {
    subject = 'Brak kart na dziś'
    status = 'Nie masz dziś kart do powtórki ani nowych kart.'
    button = { label: 'Otwórz aplikację', url: `${base}/` }
  }
  const streakLine = streak >= 1 ? `Twoja seria: ${dni(streak)} — nie przerywaj jej dziś.` : null
  const footer = 'Przypomnienia wyłączysz na stronie głównej aplikacji.'
  const homeUrl = `${base}/`

  const text = [
    status,
    ...(streakLine ? [streakLine] : []),
    '',
    `${button.label}: ${button.url}`,
    '',
    `${footer} ${homeUrl}`,
  ].join('\n')

  const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
  const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f7fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;font-family:${font};color:#1d2233;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;">
<tr><td style="padding:28px 24px;">
<p style="margin:0 0 6px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#4b5bdc;font-weight:600;">AI Cards</p>
<p style="margin:0 0 12px;font-size:18px;line-height:1.45;font-weight:600;">${escapeHtml(status)}</p>
${streakLine ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">🔥 ${escapeHtml(streakLine)}</p>` : ''}
<p style="margin:20px 0 4px;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#4b5bdc;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:12px;">${escapeHtml(button.label)}</a></p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#1d2233;opacity:0.7;"><a href="${escapeHtml(homeUrl)}" style="color:#1d2233;">${escapeHtml(footer)}</a></p>
</td></tr>
</table>
</body></html>`

  return { subject, text, html }
}
