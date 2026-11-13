# Landing page living demo — design

Linear: DEV-61

## Intent

The public landing page looks dated: nothing moves, nothing has a gradient. It should feel like a current product page, and the motion should explain the app instead of decorating it.

## Goals

- The three demo screens act out the product, once each, when the visitor scrolls to them.
  - **Day 0:** "reluctant" types itself into the quick-add box, the Add button presses, the "generating" line appears.
  - **Day 1:** the sentence appears, then the decode pairs pop in one by one, then the natural Polish line and the button.
  - **Day 2:** the Polish prompt, then the typed answer, the red verdict, the corrected sentence, the notes, and last the suggested grade lights up.
- Hero: a soft, slowly drifting gradient glow behind the header and headline; the last phrase of the headline ("a word you own." / "słowa, które naprawdę znasz.") in gradient text; a gradient on the call-to-action button.
- Hero text and buttons rise in on load. Each step's text column fades and rises in on scroll. Facts row and closing section too.
- Hover: the call-to-action lifts and brightens; demo screens lift slightly.
- Works in light and dark themes.

## Non-goals

- Layout, copy and the day-by-day story do not change.
- The signed-in app is untouched. New styles are scoped under `.landing`.
- No animation library, no new dependencies, no Tailwind utilities, no UI test infrastructure.
- No looping demo: each screen plays once per page load. Only the hero glow keeps moving.

## Anti-goals

- Content hidden for someone without JavaScript, or before hydration. The server-rendered page must show every screen in its finished state.
- Motion for visitors who asked for reduced motion. They get the finished screens, a still glow, and no transitions.
- Layout shift while a screen plays. Elements keep their space and only change opacity/transform.
- Slower first paint from heavy effects (no large blurred fixed layers that repaint on scroll, no video, no canvas).

## Approaches

1. **Living demo (picked).** Demo screens animate through the product flow; gradients in the hero. Picked because the motion carries meaning: a visitor sees what the app does without reading.
2. **Atmosphere only.** Drifting gradient background, scroll reveals, hover states; screens stay frozen. About a third of the work, but the page still doesn't show the product working.
3. **Animation library (Motion / GSAP).** Dropped: a new dependency for what CSS keyframes and one observer can do.

## Decided

- **Mechanism.** One small hook in `app/welcome/` uses `IntersectionObserver` to add a `seen` class to an element the first time it enters the viewport. On mount the landing root gets a `motion` class; the "hidden before seen" styles only apply under `.landing.motion`, so without JavaScript everything is visible.
- **Choreography lives in CSS.** `@keyframes` in `app/app.css`, staggered with a `--i` custom property set inline on each element (`animation-delay: calc(var(--i) * …)`).
- **Typing** is the one piece done in JavaScript: a short effect fills the read-only input character by character once the Day 0 screen is seen.
- **Headline gradient** needs the title split in two dictionary keys (`title` + `titleAccent`) in both `pl` and `en`.
- **Colour.** The glow and gradients are built from the existing `--accent` plus one new warmer companion token, defined for light and dark alongside the others.
- **Reduced motion.** One `@media (prefers-reduced-motion: reduce)` block switches off every animation and transition under `.landing`; the hook skips the typing effect.

## Calls I made (flagged for review)

- Screens play once and stay finished; scrolling back up does not replay them.
- The whole Day 2 sequence runs in about 3 seconds, Day 1 in about 2, so nobody waits to read.
- The second gradient colour is a violet-to-pink neighbour of the current indigo, not a new brand colour.

## Verification

No UI tests (by project rule). Checked by hand in the browser preview: light and dark, Polish and English, phone width, reduced motion, and JavaScript disabled. `npm run typecheck` and `npm test` stay green.
