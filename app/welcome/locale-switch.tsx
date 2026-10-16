import { Form, useLocation, useRouteLoaderData } from 'react-router'
import { useT } from '../lib/i18n'
import type { loader as rootLoader } from '../root'

export function LocaleSwitch() {
  const location = useLocation()
  const t = useT()
  const locale = useRouteLoaderData<typeof rootLoader>('root')?.locale ?? 'pl'
  return (
    <Form method="post" action="/locale" className="locale-switch">
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
