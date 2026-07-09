import type { Route } from './+types/audio'
import { requireAuth } from '../lib/session'
import { createDb, getCard } from '../db/repo'

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const card = await getCard(createDb(env.DB), Number(params.id))
  if (!card?.audioKey) throw new Response('Not found', { status: 404 })
  const object = await env.AUDIO.get(card.audioKey)
  if (!object) throw new Response('Not found', { status: 404 })
  return new Response(object.body, {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=31536000' },
  })
}
