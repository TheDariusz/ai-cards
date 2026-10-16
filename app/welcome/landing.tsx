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

export function Landing({ starterCredits, dailyCardLimit }: { starterCredits: number; dailyCardLimit: number }) {
  const t = useT().landing
  const fact = ([bold, rest]: [string, string]) => <span><b>{bold}</b>{rest}</span>
  return (
    <div className="landing">
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
        <h1 className="landing-title">{t.title}</h1>
        <p className="landing-pitch">
          {t.pitch}
        </p>
        <div className="landing-actions">
          <Link to="/login" className="landing-cta">{t.startFree}</Link>
          <Link to="#how" className="landing-login">{t.howItWorks}</Link>
        </div>

        <section className="landing-step" id="how" aria-labelledby="day0">
          <div>
            <p className="landing-day">{t.day0}</p>
            <h2 id="day0">{t.day0Title}</h2>
            <p className="muted">{t.day0Body}</p>
          </div>
          <div className="landing-screen" aria-hidden="true">
            <h3>AI Cards <span className="streak-chip">🔥 12</span></h3>
            <div className="quick-add">
              <input value="reluctant" readOnly tabIndex={-1} />
              <button type="button" tabIndex={-1}>{t.demoAdd}</button>
            </div>
            <p className="pending">⏳ {t.demoGenerating} reluctant</p>
          </div>
        </section>

        <section className="landing-step" aria-labelledby="day1">
          <div>
            <p className="landing-day">{t.day1}</p>
            <h2 id="day1">{t.day1Title}</h2>
            <p className="muted">{t.day1Body}</p>
          </div>
          <div className="landing-screen" aria-hidden="true">
            <h3>← reluctant <span className="muted">{t.demoNew}</span></h3>
            <p className="step-progress">{t.demoStep}</p>
            <div className="card-face">
              <p className="study answer" lang="en">She was reluctant to lend her car to a stranger.</p>
              <p>{t.demoDecodeHint}</p>
              <div className="decode-grid">
                {DECODE.map(([en, pl]) => (
                  <div className="decode-pair" key={en}>
                    <span lang="en" className="study">{en}</span>
                    <span lang="pl">{pl}</span>
                  </div>
                ))}
              </div>
              <p className="muted">{t.demoNaturalPolish} Niechętnie pożyczała swój samochód obcej osobie.</p>
            </div>
            <button type="button" className="primary-wide" tabIndex={-1}>{t.demoSeeStructure}</button>
          </div>
        </section>

        <section className="landing-step" aria-labelledby="day2">
          <div>
            <p className="landing-day">{t.day2}</p>
            <h2 id="day2">{t.day2Title}</h2>
            <p className="muted">{t.day2Body}</p>
          </div>
          <div className="landing-screen" aria-hidden="true">
            <h3>← {t.demoReview} <span className="muted">· {t.demoLeft} · 🔥 12</span></h3>
            <div className="card-face"><p lang="pl" className="study"><b className="head">Niechętnie</b> pożyczała swój samochód obcej osobie.</p></div>
            <div className="card-face">
              <div className="feedback">
                <p lang="en" className="typed-answer">She was reluctant to borrow her car to a stranger.</p>
                <p lang="pl" className="verdict verdict-wrong">Nie tym razem: „borrow” odwraca znaczenie zdania.</p>
                <p lang="en" className="study">She was <b className="head">reluctant</b> to lend her car to a stranger.</p>
                <ul lang="pl" className="feedback-notes">
                  <li>„Lend” to dawać komuś, „borrow” to brać od kogoś.</li>
                  <li>Reszta zdania jest naturalna.</li>
                </ul>
                <p className="alt-label">{t.demoAlternative}</p>
              </div>
              <p lang="en" className="study answer">She was <b className="head">reluctant</b> to lend her car to a stranger.</p>
              <p className="muted">{t.demoSuggested} <b>{t.demoAgain.toLowerCase()}</b></p>
            </div>
            <div className="grades">
              <button type="button" className="grade-suggested" tabIndex={-1}>{t.demoAgain}</button>
              <button type="button" tabIndex={-1}>{t.demoGood}</button>
              <button type="button" tabIndex={-1}>{t.demoEasy}</button>
            </div>
          </div>
        </section>

        <p className="landing-facts">
          {fact(t.factEmail)}
          {fact(t.factCredits(starterCredits))}
          {fact(t.factDaily(dailyCardLimit))}
          {fact(t.factExport)}
        </p>

        <section className="landing-closing">
          <h2>{t.closing}</h2>
          <Link to="/login" className="landing-cta">{t.startFree}</Link>
        </section>
      </main>
      <footer className="landing-footer muted">{t.footer}</footer>
    </div>
  )
}
