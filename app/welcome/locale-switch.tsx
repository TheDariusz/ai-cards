import { Form, useLocation } from 'react-router'
import { useLocale, useT } from '../lib/i18n'

export function LocaleSwitch() {
  const location = useLocation()
  const t = useT()
  const locale = useLocale()
  return (
    // Switching language re-renders the same page; keep the reader where they were.
    <Form method="post" action="/locale" className="locale-switch" preventScrollReset>
      <input type="hidden" name="redirectTo" value={location.pathname + location.search} />
      <div role="group" aria-label={t.common.language}>
        {(['pl', 'en'] as const).map((value) => (
          <button key={value} type="submit" name="locale" value={value} aria-pressed={locale === value}>
            {value.toUpperCase()}
          </button>
        ))}
      </div>
    </Form>
  )
}
