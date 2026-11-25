import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { useLocale, useT } from '../lib/i18n'
import { formatDayLine } from '../lib/today'
import { Icon } from '../ui/icons'
import { LocaleSwitch } from './locale-switch'
import { Logo } from '../ui/logo'

const AUTHOR_SITE = 'https://thedariusz.dev'
const EXTERNAL = { target: '_blank', rel: 'noopener' } as const

// Shown at `/` to visitors without a session. The three screens are static copies of
// the app's own markup (Today, the learn decode step, a checked write-it review): they
// reuse the app's classes and strings, so they stay in step with the real look.
const DECODE: [string, string][] = [
  ['She', 'Ona'],
  ['was', 'była'],
  ['reluctant', 'niechętna'],
  ['to lend', 'pożyczyć'],
  ['her car', 'swój samochód'],
  ['to a stranger', 'obcej osobie'],
]

const WORD = 'reluctant'
// The Today demo's date line: a fixed day, so the server and the browser render the same text.
const DEMO_DAY = '2026-05-12'
// Day 0 typing steps past the letters: Add pressed (card generating), then the card is ready.
const ADDED = WORD.length + 1
const READY = WORD.length + 2

// Set once the intro has played in this tab. Coming back to `/` (Back from /login) remounts
// the landing; it then renders `still`, already finished, instead of replaying everything.
let played = false

// Position of an element in its screen's sequence; app.css turns it into a delay.
const beat = (i: number) => ({ '--i': i }) as CSSProperties

export function Landing({ starterCredits, dailyCardLimit }: { starterCredits: number; dailyCardLimit: number }) {
  const all = useT()
  const t = all.landing
  const locale = useLocale()
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
    // Hydrated once the failsafe had started showing everything (its 5s delay is part of
    // currentTime): leave the page finished rather than cancel it and hide what the visitor
    // is reading. getAnimations is optional: browsers without it just play the intro.
    const failsafe = el.querySelector('[data-reveal]')?.getAnimations?.()
      .find((a) => (a as CSSAnimation).animationName === 'landing-failsafe')
    if (failsafe && Number(failsafe.currentTime) >= 5000) return
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
          <Logo />
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
          <div className="landing-screen today-screen" aria-hidden="true" data-reveal="type">
            <div className="today-head">
              <div>
                <p className="today-date">{formatDayLine(DEMO_DAY, locale)}</p>
                <p className="landing-screen-title">{all.nav.today}</p>
              </div>
              <span className="today-streak"><span><Icon name="flame" />12</span></span>
            </div>
            <div className="add-word">
              <input value={WORD.slice(0, step)} placeholder={all.home.newWord} readOnly tabIndex={-1} />
              <button type="button" tabIndex={-1} data-on={added}>{all.home.add}</button>
            </div>
            <div className="landing-result">
              <p className="pending today-status" data-on={step === ADDED}>{all.home.generating} <span lang="en">{WORD}</span></p>
              <div className="primary-card today-card landing-ready" data-on={step >= READY}>
                <div>
                  <p className="today-eyebrow">{all.home.newWords(1)}</p>
                  <p className="today-word study" lang="en">{WORD}</p>
                  <p>{all.home.learnTomorrow}</p>
                </div>
                <span className="today-action">{all.home.learnNow}</span>
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
          <div className="landing-screen task-screen" aria-hidden="true" data-reveal="">
            <div className="task-head">
              <span className="landing-screen-nav"><Icon name="back" /></span>
              <div className="task-progress"><span style={{ width: '25%' }} /></div>
              <span className="muted">1 / 4</span>
            </div>
            <div className="task-intro">
              <p className="section-label">{all.learn.steps[0]}</p>
              <p className="task-word"><span lang="en">{WORD}</span> {all.learn.remaining(3)}</p>
            </div>
            <p className="study answer task-sentence beat" style={beat(0)} lang="en">She was reluctant to lend her car to a stranger.</p>
            <p className="muted beat" style={beat(2)}>{all.learn.decodeHint}</p>
            <div className="decode-grid">
              {DECODE.map(([en, pl], i) => (
                <div className={en === WORD ? 'decode-pair decode-head beat beat-pop' : 'decode-pair beat beat-pop'} style={beat(4 + i * 1.5)} key={en}>
                  <span lang="en" className="study">{en}</span>
                  <span lang="pl">{pl}</span>
                </div>
              ))}
            </div>
            <div className="surface-card beat" style={beat(14)}>
              <p className="section-label">{all.learn.naturalPolish}</p>
              <p className="study" lang="pl">Niechętnie pożyczała swój samochód obcej osobie.</p>
            </div>
            <button type="button" className="primary-wide beat" style={beat(16)} tabIndex={-1}>{all.learn.seeStructure}</button>
          </div>
        </section>

        <section className="landing-step" aria-labelledby="day2">
          <div data-reveal="">
            <p className="landing-day">{t.day2}</p>
            <h2 id="day2">{t.day2Title}</h2>
            <p className="muted">{t.day2Body}</p>
          </div>
          <div className="landing-screen landing-screen-slow task-screen" aria-hidden="true" data-reveal="">
            <div className="task-head">
              <span className="landing-screen-nav"><Icon name="close" /></span>
              <div className="task-progress"><span style={{ width: '20%' }} /></div>
              <span className="muted">{all.review.left(4)}</span>
            </div>
            <div className="segmented">
              <button type="button" aria-pressed="true" tabIndex={-1}>{all.review.modeWrite}</button>
              <button type="button" aria-pressed="false" tabIndex={-1}>{all.review.modeFlip}</button>
            </div>
            <div className="task-prompt beat" style={beat(0)}>
              <p className="section-label">{all.review.promptWrite}</p>
              <p lang="pl" className="study"><b className="head">Niechętnie</b> pożyczała swój samochód obcej osobie.</p>
            </div>
            <div className="surface-card beat" style={beat(2)}>
              <p className="section-label">{all.review.yourAnswer}</p>
              <p lang="en" className="study typed-answer">She was reluctant to borrow her car to a stranger.</p>
            </div>
            <div className="verdict-block verdict-block-wrong beat beat-pop" style={beat(5)}>
              <p lang="pl" className="verdict verdict-wrong">Nie tym razem: „borrow” odwraca znaczenie zdania.</p>
              <p lang="en" className="study beat" style={beat(7)}>She was <b className="head">reluctant</b> to lend her car to a stranger.</p>
              <ul lang="pl" className="feedback-notes beat" style={beat(9)}>
                <li>„Lend” to dawać komuś, „borrow” to brać od kogoś.</li>
                <li>Reszta zdania jest naturalna.</li>
              </ul>
            </div>
            <div className="surface-card beat" style={beat(11)}>
              <p className="section-label">{all.review.alternative}</p>
              <p lang="en" className="study answer">She was <b className="head">reluctant</b> to lend her car to a stranger.</p>
            </div>
            <div className="landing-grade beat" style={beat(13)}>
              <p className="section-label">{all.review.suggested} {all.review.grades.again.toLowerCase()}</p>
              <div className="grades">
                <button type="button" className="grade-suggested" tabIndex={-1}>{all.review.grades.again}</button>
                <button type="button" tabIndex={-1}>{all.review.grades.good}</button>
                <button type="button" tabIndex={-1}>{all.review.grades.easy}</button>
              </div>
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
      <footer className="landing-footer">
        <div className="landing-author">
          {/* The author's mark in the page's own tokens; the dot is the one brand colour it keeps. The rect
              is inset by half its stroke so the border isn't clipped, and the text is pinned to a width so
              a fallback font can't run it into the edge. */}
          <svg className="author-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="0.5" y="0.5" width="31" height="31" rx="6" />
            <circle cx="5.5" cy="21" r="2" fill="#e11d48" />
            <text x="10" y="23" textLength="19" lengthAdjust="spacingAndGlyphs">TD</text>
          </svg>
          <p>
            <span>{t.footerCredit}</span>
            <strong><a href={AUTHOR_SITE} {...EXTERNAL}>TheDariusz</a> · Dariusz Szczepański</strong>
            <span>{t.footerRole}</span>
          </p>
        </div>
        <nav className="landing-social" aria-label={t.footerLinks}>
          <a href={AUTHOR_SITE} {...EXTERNAL}>thedariusz.dev</a>
          <a href="https://github.com/thedariusz" aria-label="GitHub" {...EXTERNAL}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M12 .5A12 12 0 0 0 8.2 23.9c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
            </svg>
          </a>
          <a href="https://www.linkedin.com/in/dariusz-szczepanski-dev" aria-label="LinkedIn" {...EXTERNAL}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <path d="M20.5 2h-17A1.5 1.5 0 0 0 2 3.5v17A1.5 1.5 0 0 0 3.5 22h17a1.5 1.5 0 0 0 1.5-1.5v-17A1.5 1.5 0 0 0 20.5 2ZM8 19H5v-9h3Zm-1.5-10.3a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5ZM19 19h-3v-4.7c0-1.4-.5-2.1-1.6-2.1-1.2 0-1.9.8-1.9 2.1V19h-3v-9h2.9v1.3a3.4 3.4 0 0 1 3-1.6c2.2 0 3.6 1.3 3.6 4Z" />
            </svg>
          </a>
        </nav>
      </footer>
    </div>
  )
}
