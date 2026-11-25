import { Link } from 'react-router'
import { useT } from '../lib/i18n'
import { Icon } from './icons'

// The closing moment of Learn and Review: what was achieved, the streak once today counts, and the way back.
export function TaskFinish({ kind, title, line, streak }: {
  kind: 'learn' | 'review'
  title: string
  line: string | null
  streak: number | null
}) {
  const t = useT()
  return (
    <section className="task-finish" data-finish={kind}>
      <span className="task-finish-mark"><Icon name="check" /></span>
      <h2>{title}</h2>
      {line && <p>{line}</p>}
      {streak !== null && (
        <p className="task-finish-streak">
          {t.streak.dayCounted}
          <span><Icon name="flame" />{streak} {t.streak.inARow(streak)}</span>
        </p>
      )}
      <Link to="/" className="finish-action">{t.common.backToToday}</Link>
    </section>
  )
}
