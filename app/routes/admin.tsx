import { Form, Link } from 'react-router'
import type { Route } from './+types/admin'
import { requireAuth } from '../lib/session'
import { createDb, grantCredits, listUsersWithUsage, setBlocked } from '../db/repo'
import { OWNER_USER_ID } from '../db/schema'
import { starterMicros, toCredits } from '../lib/credits'

async function requireOwner(request: Request, env: Env) {
  if ((await requireAuth(request, env)) !== OWNER_USER_ID) throw new Response('Not found', { status: 404 })
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireOwner(request, env)
  const users = await listUsersWithUsage(createDb(env.DB))
  return { users, topUpCredits: toCredits(starterMicros(env)) }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireOwner(request, env)
  const db = createDb(env.DB)
  const form = await request.formData()
  const userId = Number(form.get('userId'))
  const intent = form.get('intent')
  if (!Number.isInteger(userId) || userId === OWNER_USER_ID) throw new Response('Bad Request', { status: 400 })
  const now = Date.now()
  if (intent === 'grant') {
    await grantCredits(db, userId, starterMicros(env), 'admin', now)
  } else if (intent === 'block' || intent === 'unblock') {
    if (!(await setBlocked(db, userId, intent === 'block' ? now : null))) return { error: `No user #${userId}` }
  } else {
    throw new Response('Bad Request', { status: 400 })
  }
  return { ok: true as const }
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export default function Admin({ loaderData, actionData }: Route.ComponentProps) {
  const { users, topUpCredits } = loaderData
  return (
    <main className="page">
      <h1><Link to="/">←</Link> Users</h1>
      {actionData && 'error' in actionData && <p className="error">{actionData.error}</p>}
      {users.map((u) => (
        <Form method="post" key={u.id} className="request-row">
          <input type="hidden" name="userId" value={u.id} />
          <span>
            {u.email ?? `#${u.id}`}
            <span className="muted">
              {' '}· since {day(u.createdAt)} · spent ${(u.spentMicros / 1e6).toFixed(2)}
              {u.id !== OWNER_USER_ID && ` · ${toCredits(u.balanceMicros)} credits left`}
              {u.blockedAt !== null && ' · Blocked'}
            </span>
          </span>
          {u.id !== OWNER_USER_ID && (
            <span className="request-actions">
              <button type="submit" name="intent" value={u.blockedAt === null ? 'block' : 'unblock'} className="link-button">
                {u.blockedAt === null ? 'Block' : 'Unblock'}
              </button>
              <button type="submit" name="intent" value="grant">+{topUpCredits}</button>
            </span>
          )}
        </Form>
      ))}
    </main>
  )
}
