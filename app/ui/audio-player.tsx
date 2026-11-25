import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { useT } from '../lib/i18n'

// A hidden <audio> driven by our own controls, so the player matches the app instead of the browser.
// `ref` reaches the <audio> element itself, for callers that start playback (review reveals).
export function AudioPlayer({ src, autoPlay, ref }: { src: string; autoPlay?: boolean; ref?: Ref<HTMLAudioElement> }) {
  const t = useT()
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  const setAudio = (el: HTMLAudioElement | null) => {
    audio.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  // a new card swaps the src: start the controls from zero
  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
  }, [src])

  const toggle = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }

  const seek = (value: number) => {
    if (audio.current) audio.current.currentTime = value
    setCurrent(value)
  }

  const total = Number.isFinite(duration) ? duration : 0
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0

  return (
    <div className="audio-player">
      <audio
        ref={setAudio}
        src={src}
        autoPlay={autoPlay}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
      />
      <button type="button" className="audio-toggle" onClick={toggle} aria-label={playing ? t.common.pause : t.common.play}>
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
          {playing
            ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
            : <path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l10.6-6.8a1 1 0 0 0 0-1.72L9.5 4.34A1 1 0 0 0 8 5.2z" />}
        </svg>
      </button>
      <input
        type="range"
        className="audio-seek"
        min={0}
        max={total || 1}
        step={0.01}
        value={Math.min(current, total || 1)}
        onChange={(event) => seek(Number(event.target.value))}
        disabled={total === 0}
        aria-label={t.common.audioPosition}
        aria-valuetext={`${formatTime(current)} / ${formatTime(total)}`}
        style={{ '--pct': `${pct}%` } as CSSProperties}
      />
      <span className="audio-time">{formatTime(current)} / {formatTime(total)}</span>
    </div>
  )
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
