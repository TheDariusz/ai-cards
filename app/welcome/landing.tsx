import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useT } from '../lib/i18n'
import { LocaleSwitch } from './locale-switch'

// Shown at `/` to visitors without a session. The three screens are static copies of
// the app's own markup (home quick-add, learn decode step, write-it review), so they
// reuse the app classes and stay in step with the real look.
const DECODE: [string, string][] = [
  ['She', 'Ona'],
  ['was', 'była'],
  ['reluctant', 'niechętna'],
  ['to lend', 'pożyczyć'],
  ['her car', 'swój samochód'],
  ['to a stranger', 'obcej osobie'],
]

const WORD = 'reluctant'
// Day 0 typing steps past the letters: Add pressed (card generating), then the card is ready.
const ADDED = WORD.length + 1
const READY = WORD.length + 2

// Set once the intro has played in this tab. Coming back to `/` (Back from /login) remounts
// the landing; it then renders `still`, already finished, instead of replaying everything.
let played = false

// Position of an element in its screen's sequence; app.css turns it into a delay.
const beat = (i: number) => ({ '--i': i }) as CSSProperties

export function Landing({ starterCredits, dailyCardLimit }: { starterCredits: number; dailyCardLimit: number }) {
  const t = useT().landing
  const fact = ([bold, rest]: [string, string]) => <span><b>{bold}</b>{rest}</span>
  const root = useRef<HTMLDivElement>(null)
  // Day 0 progress: 0 = empty, WORD.length = fully typed, then ADDED, then READY.
  const [step, setStep] = useState(READY)
  const [still] = useState(() => played)

  // Marks each [data-reveal] element `seen` the first time it scrolls into view (app.css
  // does the rest) and types the word into the Day 0 screen. Server markup is the finished
  // state; `live` tells app.css this effect ran, which cancels its show-everything failsafe.
  useEffect(() => {
    const el = root.current
    if (still || !el || !('IntersectionObserver' in window)) return
    played = true
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // Hydrated after the failsafe already showed everything: leave the page finished rather
    // than cancel it and hide what the visitor is reading.
    const failsafeDone = el.querySelector('[data-reveal]')?.getAnimations()
      .some((a) => a instanceof CSSAnimation && a.animationName === 'landing-failsafe' && a.playState === 'finished')
    if (failsafeDone) return
    el.classList.add('live')
    setStep(0)
    const timers: number[] = []
    const type = () => {
      // One letter every 95ms, a short pause before Add presses, then the card arrives.
      for (let i = 1; i <= WORD.length; i++) timers.push(window.setTimeout(() => setStep(i), 500 + i * 95))
      const addAt = 500 + ADDED * 95 + 300
      timers.push(window.setTimeout(() => setStep(ADDED), addAt))
      timers.push(window.setTimeout(() => setStep(READY), addAt + 1500))
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('seen')
        if ((entry.target as HTMLElement).dataset.reveal === 'type') type()
        io.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.2 })
    el.querySelectorAll('[data-reveal]').forEach((node) => io.observe(node))
    return () => {
      io.disconnect()
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [still])

  const added = step >= ADDED

  return (
    <div className={still ? 'landing still' : 'landing'} ref={root}>
      <div className="landing-glow" aria-hidden="true" />
      <header className="landing-header">
        <Link to="/" aria-label="AI Cards">
          <img className="logo-light" src="/logo-light.png" alt="" width="400" height="162" />
          <img className="logo-dark" src="/logo-dark.png" alt="" width="400" height="162" />
        </Link>
        <div className="landing-header-actions">
          <LocaleSwitch />
          <Link to="/login" className="landing-login">{t.logIn}</Link>
        </div>
      </header>

      <main>
        <div className="landing-hero">
          <div>
            <h1 className="landing-title landing-rise">{t.title} <em>{t.titleAccent}</em></h1>
            <p className="landing-pitch landing-rise" style={beat(1)}>
              {t.pitch}
            </p>
            <div className="landing-actions landing-rise" style={beat(2)}>
              <Link to="/login?new=1" className="landing-cta">{t.startFree}</Link>
              <Link to="#how" className="landing-login">{t.howItWorks}</Link>
            </div>
            <p className="landing-reassure landing-rise" style={beat(3)}>{t.reassure}</p>
          </div>
          {/* The review check from Day 2, condensed: the moment that sells the product, up front. */}
          <div className="landing-hero-card landing-rise" style={beat(4)} aria-hidden="true">
            <p className="landing-hero-label">{t.heroPrompt}</p>
            <p lang="pl" className="study landing-hero-prompt">Niechętnie pożyczała swój samochód obcej osobie.</p>
            <p lang="en" className="study landing-hero-answer">She was reluctant to <del>borrow</del> <ins>lend</ins> her car to a stranger.</p>
            <p lang="pl" className="landing-hero-note">„Lend” to dawać komuś, „borrow” to brać od kogoś.</p>
          </div>
        </div>

        <section className="landing-step" id="how" aria-labelledby="day0">
          <div data-reveal="">
            <p className="landing-day">{t.day0}</p>
            <h2 id="day0">{t.day0Title}</h2>
            <p className="muted">{t.day0Body}</p>
          </div>
          <div className="landing-screen" aria-hidden="true" data-reveal="type">
            <h3>AI Cards <span className="streak-chip">🔥 12</span></h3>
            <div className="quick-add">
              <input value={WORD.slice(0, step)} readOnly tabIndex={-1} />
              <button type="button" tabIndex={-1} data-on={added}>{t.demoAdd}</button>
            </div>
            <div className="landing-result">
              <p className="pending" data-on={step === ADDED}>⏳ {t.demoGenerating} reluctant</p>
              <div className="card-face landing-ready" data-on={step >= READY}>
                <p><b className="head" lang="en">reluctant</b> <span lang="pl">· niechętny</span></p>
                <p className="muted" lang="en">not wanting to do something, so you hold back</p>
                <p className="study" lang="en">She was reluctant to lend her car to a stranger.</p>
                <p className="muted" lang="pl">Niechętnie pożyczała swój samochód obcej osobie.</p>
                <p className="landing-audio">
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor" /></svg>
                  <span className="landing-audio-bar" />
                  <span className="muted">0:03</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-step" aria-labelledby="day1">
          <div data-reveal="">
            <p className="landing-day">{t.day1}</p>
            <h2 id="day1">{t.day1Title}</h2>
            <p className="muted">{t.day1Body}</p>
          </div>
          <div className="landing-screen" aria-hidden="true" data-reveal="">
            <h3>← reluctant <span className="muted">{t.demoNew}</span></h3>
            <p className="step-progress">{t.demoStep}</p>
            <div className="card-face">
              <p className="study answer beat" style={beat(0)} lang="en">She was reluctant to lend her car to a stranger.</p>
              <p className="beat" style={beat(2)}>{t.demoDecodeHint}</p>
              <div className="decode-grid">
                {DECODE.map(([en, pl], i) => (
                  <div className="decode-pair beat beat-pop" style={beat(4 + i * 1.5)} key={en}>
                    <span lang="en" className="study">{en}</span>
                    <span lang="pl">{pl}</span>
                  </div>
                ))}
              </div>
              <p className="muted beat" style={beat(14)}>{t.demoNaturalPolish} Niechętnie pożyczała swój samochód obcej osobie.</p>
            </div>
            <button type="button" className="primary-wide beat" style={beat(16)} tabIndex={-1}>{t.demoSeeStructure}</button>
          </div>
        </section>

        <section className="landing-step" aria-labelledby="day2">
          <div data-reveal="">
            <p className="landing-day">{t.day2}</p>
            <h2 id="day2">{t.day2Title}</h2>
            <p className="muted">{t.day2Body}</p>
          </div>
          <div className="landing-screen landing-screen-slow" aria-hidden="true" data-reveal="">
            <h3>← {t.demoReview} <span className="muted">· {t.demoLeft} · 🔥 12</span></h3>
            <div className="card-face beat" style={beat(0)}><p lang="pl" className="study"><b className="head">Niechętnie</b> pożyczała swój samochód obcej osobie.</p></div>
            <div className="card-face beat" style={beat(2)}>
              <div className="feedback">
                <p lang="en" className="typed-answer">She was reluctant to borrow her car to a stranger.</p>
                <p lang="pl" className="verdict verdict-wrong beat beat-pop" style={beat(5)}>Nie tym razem: „borrow” odwraca znaczenie zdania.</p>
                <p lang="en" className="study beat" style={beat(7)}>She was <b className="head">reluctant</b> to lend her car to a stranger.</p>
                <ul lang="pl" className="feedback-notes beat" style={beat(9)}>
                  <li>„Lend” to dawać komuś, „borrow” to brać od kogoś.</li>
                  <li>Reszta zdania jest naturalna.</li>
                </ul>
                <p className="alt-label beat" style={beat(11)}>{t.demoAlternative}</p>
              </div>
              <p lang="en" className="study answer beat" style={beat(11)}>She was <b className="head">reluctant</b> to lend her car to a stranger.</p>
              <p className="muted beat" style={beat(13)}>{t.demoSuggested} <b>{t.demoAgain.toLowerCase()}</b></p>
            </div>
            <div className="grades beat" style={beat(13)}>
              <button type="button" className="grade-suggested" tabIndex={-1}>{t.demoAgain}</button>
              <button type="button" tabIndex={-1}>{t.demoGood}</button>
              <button type="button" tabIndex={-1}>{t.demoEasy}</button>
            </div>
          </div>
        </section>

        <p className="landing-facts" data-reveal="">
          {fact(t.factEmail)}
          {fact(t.factCredits(starterCredits))}
          {fact(t.factDaily(dailyCardLimit))}
          {fact(t.factExport)}
        </p>

        <section className="landing-closing" data-reveal="">
          <h2>{t.closing}</h2>
          <Link to="/login?new=1" className="landing-cta">{t.startFree}</Link>
        </section>
      </main>
      <footer className="landing-footer muted">{t.footer}</footer>
    </div>
  )
}
