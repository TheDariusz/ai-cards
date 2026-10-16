import { dict } from './i18n'
import type { Locale } from './locale'
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function warsawTime(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(ms))
}

export function buildReminder(input: {
  due: number; fresh: number; streak: number; appUrl: string; later?: { count: number; from: number }; locale: Locale
}): MailMessage {
  const { due, fresh, streak, locale } = input
  const t = dict[locale].mail
  const base = input.appUrl.replace(/\/$/, '')

  let subject: string
  let status: string
  let button: { label: string; url: string }
  if (due > 0) {
    subject = t.dueSubject(due, streak)
    status = t.dueStatus(due, fresh)
    // `later` = the part of `due` that is not in /review yet, and when the first of it gets there
    if (input.later && input.later.count > 0) status += ` ${t.timing(due, input.later.count, warsawTime(input.later.from))}`
    button = { label: t.startReview, url: `${base}/review` }
  } else if (fresh > 0) {
    subject = t.freshSubject(fresh)
    status = t.freshStatus(fresh)
    button = { label: t.startLearning, url: `${base}/learn` }
  } else {
    subject = t.noneSubject
    status = t.noneStatus
    button = { label: t.openApp, url: `${base}/` }
  }
  // only reviews complete a day, so the streak is at stake only when cards are due
  const streakLine = due > 0 && streak >= 1 ? t.streakLine(streak) : null
  const footer = t.footer
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
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
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
