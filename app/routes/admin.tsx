import { Form, Link } from 'react-router'
import type { Route } from './+types/admin'
import { requireAuth } from '../lib/session'
import { createDb, decideAccessRequest, listAccessRequests } from '../db/repo'
import { OWNER_USER_ID } from '../db/schema'
import { mailSenderFromEnv } from '../lib/resend'
import { buildApprovedEmail, normalizeEmail } from '../lib/login'

async function requireOwner(request: Request, env: Env) {
  if ((await requireAuth(request, env)) !== OWNER_USER_ID) throw new Response('Not found', { status: 404 })
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireOwner(request, env)
  return { requests: await listAccessRequests(createDb(env.DB)) }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireOwner(request, env)
  const form = await request.formData()
  const email = normalizeEmail(form.get('email'))
  const intent = form.get('intent')
  if (!email || (intent !== 'approve' && intent !== 'reject')) throw new Response('Bad Request', { status: 400 })
  const status = intent === 'approve' ? 'approved' : 'rejected'
  if (!(await decideAccessRequest(createDb(env.DB), email, status, Date.now()))) return { error: `No request from ${email}` }
  if (status === 'approved') {
    try {
      const origin = new URL(request.url).origin
      await mailSenderFromEnv(env, origin)(email, buildApprovedEmail(`${origin}/login`))
    } catch (err) {
      console.error('admin: approval mail failed', err)
      return { error: `Approved, but the email to ${email} failed — let them know yourself.` }
    }
  }
  return { ok: true as const }
}

const LABEL = { pending: 'Waiting', approved: 'Has access', rejected: 'Rejected' }

export default function Admin({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <main className="page">
      <h1><Link to="/">←</Link> Access requests</h1>
      {actionData && 'error' in actionData && <p className="error">{actionData.error}</p>}
      {loaderData.requests.length === 0 && <p className="muted">No requests yet.</p>}
      {loaderData.requests.map((r) => (
        <Form method="post" key={r.email} className="request-row">
          <input type="hidden" name="email" value={r.email} />
          <span>{r.email} <span className="muted">· {LABEL[r.status]}</span></span>
          <span className="request-actions">
            {r.status !== 'rejected' && (
              <button type="submit" name="intent" value="reject" className="link-button">
                {r.status === 'approved' ? 'Revoke' : 'Reject'}
              </button>
            )}
            {r.status !== 'approved' && <button type="submit" name="intent" value="approve">Approve</button>}
          </span>
        </Form>
      ))}
    </main>
  )
}
