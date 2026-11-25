import { Link, NavLink, Outlet } from 'react-router'
import type { Route } from './+types/shell'
import { getUserId, requireAuth } from '../lib/session'
import { createDb, countCards, getBalance } from '../db/repo'
import { OWNER_USER_ID } from '../db/schema'
import { toCredits } from '../lib/credits'
import { useT } from '../lib/i18n'
import { Icon } from '../ui/icons'
import { Logo } from '../ui/logo'

// Layout for Today, Cards and Settings. It also wraps the guest branch of `/`, so like the
// home loader it lets a request with no session through (the landing renders without the
// shell); any cookie at all still goes through requireAuth, blocked users included.
// The credits here are the only copy: Today and Settings read them with useRouteLoaderData('routes/shell').
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  if ((await getUserId(request, env)) === null) return null
  const userId = await requireAuth(request, env)
  const db = createDb(env.DB)
  const [total, balance] = await Promise.all([countCards(db, userId), getBalance(db, userId)])
  const isOwner = userId === OWNER_USER_ID
  return {
    total,
    isOwner,
    credits: { left: toCredits(balance.balanceMicros), granted: toCredits(balance.grantedMicros), spentMicros: balance.spentMicros },
    outOfCredits: !isOwner && balance.balanceMicros <= 0,
  }
}

export default function Shell({ loaderData }: Route.ComponentProps) {
  const t = useT()
  if (!loaderData) return <Outlet />
  const { total, isOwner, credits } = loaderData
  return (
    <div className="shell">
      <nav className="shell-nav" aria-label={t.nav.label}>
        <Link to="/" className="shell-logo" aria-label="AI Cards"><Logo /></Link>
        <NavLink to="/" end><Icon name="home" /> {t.nav.today}</NavLink>
        <NavLink to="/cards"><Icon name="cards" /> {t.nav.cards} <span className="shell-count">{total}</span></NavLink>
        <NavLink to="/settings"><Icon name="gear" /> {t.nav.settings}</NavLink>
        <p className="shell-credits">
          {isOwner ? t.home.spent((credits.spentMicros / 1e6).toFixed(2)) : t.home.credits(credits.left, credits.granted)}
        </p>
      </nav>
      <div className="shell-content">
        <Outlet />
      </div>
    </div>
  )
}
