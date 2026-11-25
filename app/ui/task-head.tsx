import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon } from './icons'

// The header of a focused screen: a back or close link, then the title or the progress.
export function TaskHead({ to, label, icon = 'back', children }: {
  to: string
  label: string
  icon?: 'back' | 'close'
  children: ReactNode
}) {
  return (
    <header className="task-head">
      <Link to={to} aria-label={label}><Icon name={icon} /></Link>
      {children}
    </header>
  )
}
