import { Link } from 'react-router'

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

export function Landing() {
  return (
    <div className="landing">
      <header className="landing-header">
        <Link to="/" aria-label="AI Cards">
          <img className="logo-light" src="/logo-light.png" alt="" width="400" height="162" />
          <img className="logo-dark" src="/logo-dark.png" alt="" width="400" height="162" />
        </Link>
        <Link to="/login" className="landing-login">Log in</Link>
      </header>

      <main>
        <h1 className="landing-title">Three days from a word you heard to a word you own.</h1>
        <p className="landing-pitch">
          English flashcards for Polish speakers. You type the word, AI writes the card, spaced repetition decides when you see it again.
        </p>
        <div className="landing-actions">
          <Link to="/login" className="landing-cta">Start free</Link>
          <a href="#how" className="landing-login">How it works</a>
        </div>

        <section className="landing-step" id="how" aria-labelledby="day0">
          <div>
            <p className="landing-day">Day 0</p>
            <h2 id="day0">Type the word</h2>
            <p className="muted">Three seconds, right when you hear it. The card is ready a moment later: Polish meaning, a plain explanation, a simple example sentence with its translation, and audio.</p>
          </div>
          <div className="landing-screen" aria-hidden="true">
            <h3>AI Cards <span className="streak-chip">🔥 12</span></h3>
            <div className="quick-add">
              <input value="reluctant" readOnly tabIndex={-1} />
              <button type="button" tabIndex={-1}>Add</button>
            </div>
            <p className="pending">⏳ Generating: reluctant</p>
          </div>
        </section>

        <section className="landing-step" aria-labelledby="day1">
          <div>
            <p className="landing-day">Day 1</p>
            <h2 id="day1">Learn it once</h2>
            <p className="muted">A literal word-by-word decode, the audio to shadow, and a check that you really follow the sentence before it enters your reviews.</p>
          </div>
          <div className="landing-screen" aria-hidden="true">
            <h3>← reluctant <span className="muted">(3 new)</span></h3>
            <p className="step-progress">Step 1 of 4 · Decode</p>
            <div className="card-face">
              <p className="study answer" lang="en">She was reluctant to lend her car to a stranger.</p>
              <p>Read from left to right. The Polish line stays deliberately literal.</p>
              <div className="decode-grid">
                {DECODE.map(([en, pl]) => (
                  <div className="decode-pair" key={en}>
                    <span lang="en" className="study">{en}</span>
                    <span lang="pl">{pl}</span>
                  </div>
                ))}
              </div>
              <p className="muted">Natural Polish: Niechętnie pożyczała swój samochód obcej osobie.</p>
            </div>
            <button type="button" className="primary-wide" tabIndex={-1}>I see the structure</button>
          </div>
        </section>

        <section className="landing-step" aria-labelledby="day2">
          <div>
            <p className="landing-day">Day 2 onward</p>
            <h2 id="day2">Review it</h2>
            <p className="muted">Write the sentence from the Polish. AI checks meaning, grammar and naturalness, explains in Polish, and suggests a grade. You still pick.</p>
          </div>
          <div className="landing-screen" aria-hidden="true">
            <h3>← Review <span className="muted">· 4 left · 🔥 12</span></h3>
            <div className="card-face"><p lang="pl" className="study">Niechętnie pożyczała swój samochód obcej osobie.</p></div>
            <div className="card-face">
              <div className="feedback">
                <p lang="en" className="typed-answer">She was reluctant to borrow her car to a stranger.</p>
                <p lang="pl" className="verdict verdict-minor">Prawie dobrze – jeden czasownik do poprawy.</p>
                <p lang="en" className="study">She was reluctant to <b className="head">lend</b> her car to a stranger.</p>
                <ul lang="pl" className="feedback-notes">
                  <li>„Lend” to dawać komuś, „borrow” to brać od kogoś.</li>
                  <li>Reszta zdania jest naturalna.</li>
                </ul>
                <p className="alt-label">Another correct version</p>
              </div>
              <p lang="en" className="study answer">She was <b className="head">reluctant</b> to lend her car to a stranger.</p>
              <p className="muted">suggested: <b>good</b></p>
            </div>
            <div className="grades">
              <button type="button" tabIndex={-1}>Again</button>
              <button type="button" className="grade-suggested" tabIndex={-1}>Good</button>
              <button type="button" tabIndex={-1}>Easy</button>
            </div>
          </div>
        </section>

        <p className="landing-facts">
          <span><b>Email link</b>, no password</span>
          <span><b>500 free credits</b> to start</span>
          <span><b>20 new cards</b> a day</span>
          <span><b>Export</b> to Anki any time</span>
        </p>

        <section className="landing-closing">
          <h2>Start with the next word you hear.</h2>
          <Link to="/login" className="landing-cta">Start free</Link>
        </section>
      </main>
      <footer className="landing-footer muted">AI Cards · English flashcards for Polish speakers</footer>
    </div>
  )
}
