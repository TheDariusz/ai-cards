import type { Logger } from './logger'
import { runAllReminders, type AllRemindersDeps } from './reminder-job'

// The daily reminder run as the cron sees it: one `reminders_run` line per real run (alert A4
// counts these, so the off-hour trigger must return before calling this), one error line per
// failed user, and one Loki push at the end. Never throws.
export async function runReminderCron(deps: AllRemindersDeps & { log: Logger }, now: number): Promise<void> {
  const { log } = deps
  try {
    const results = await runAllReminders(deps, now)
    let count = 0
    let failed = 0
    for (const r of results) {
      if (r.error) {
        failed++
        console.error(`reminder: user ${r.userId} failed ${r.error}`)
        log.error('reminder failed', { user_id: r.userId }, r.error)
      } else {
        console.log(`reminder: user ${r.userId} ${JSON.stringify(r.result)}`) // Workers Logs stays the fallback
        if (r.result?.send) count++
      }
    }
    log.info('reminders run', { event: 'reminders_run', count, failed, users: results.length })
  } catch (err) {
    console.error(`reminder: run failed ${err instanceof Error ? err.message : String(err)}`)
    log.error('reminder run failed', {}, err)
  } finally {
    await log.flush()
  }
}
