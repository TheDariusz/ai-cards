import { Link, useFetcher, useSearchParams } from 'react-router'
import { useEffect, useRef, useState } from 'react'
import type { Route } from './+types/review'
import { requireAuth } from '../lib/session'
import { createDb, getDueCards, applyReview } from '../db/repo'
import type { Grade } from '../lib/srs'

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const due = await getDueCards(createDb(env.DB), Date.now())
  return { due }
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env
  await requireAuth(request, env)
  const form = await request.formData()
  await applyReview(
    createDb(env.DB),
    Number(form.get('cardId')),
    String(form.get('grade')) as Grade,
    form.get('mode') === 'write' ? 'write' : 'flip',
    form.get('typed') ? String(form.get('typed')) : null,
    Date.now(),
  )
  return { ok: true }
}

// useFetcher (not a navigating Form) so a network failure keeps the revealed card
// on screen — the grade is "held in memory" (spec) and the user just taps again.
function GradeButtons({ cardId, mode, typed }: { cardId: number; mode: string; typed?: string }) {
  const fetcher = useFetcher()
  const failed = fetcher.state === 'idle' && fetcher.data === undefined && fetcher.formData !== undefined
  return (
    <fetcher.Form method="post" className="grades">
      <input type="hidden" name="cardId" value={cardId} />
      <input type="hidden" name="mode" value={mode} />
      {typed !== undefined && <input type="hidden" name="typed" value={typed} />}
      <button name="grade" value="again" className="grade-again">Again</button>
      <button name="grade" value="good">Good</button>
      <button name="grade" value="easy" className="grade-easy">Easy</button>
      {failed && <p className="error">Didn’t reach the server — tap your grade again.</p>}
    </fetcher.Form>
  )
}

function FlipCard({ card }: { card: Route.ComponentProps['loaderData']['due'][number] }) {
  const [revealed, setRevealed] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    if (revealed) audioRef.current?.play().catch(() => {}) // autoplay may need a tap on iOS
  }, [revealed])

  return (
    <>
      <div className="card-face"><p lang="pl">{card.sentencePl}</p></div>
      {!revealed ? (
        <button onClick={() => setRevealed(true)}>Show answer</button>
      ) : (
        <>
          <div className="card-face">
            <p lang="en"><b>{card.sentenceEn}</b></p>
            <p className="muted">{card.word} = {card.wordPl} — {card.explanationEn}</p>
            {card.audioKey && <audio ref={audioRef} controls src={`/audio/${card.id}`} />}
          </div>
          <GradeButtons cardId={card.id} mode="flip" />
        </>
      )}
    </>
  )
}

export default function Review({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'write' ? 'write' : 'flip'
  const card = loaderData.due[0] // action revalidates the loader → next card appears

  if (!card) {
    return (
      <main className="page">
        <h1><Link to="/">←</Link> Review</h1>
        <p className="ok">All done for today 🎉</p>
      </main>
    )
  }

  return (
    <main className="page">
      <h1><Link to="/">←</Link> Review <span className="muted">({loaderData.due.length} left)</span></h1>
      <button
        className="muted-toggle"
        onClick={() => setParams({ mode: mode === 'flip' ? 'write' : 'flip' })}
      >
        Mode: {mode === 'flip' ? 'Flip' : 'Write it'}
      </button>
      {mode === 'flip'
        ? <FlipCard key={card.id} card={card} />
        : <p className="muted">Write mode arrives in the next task.</p>}
    </main>
  )
}
