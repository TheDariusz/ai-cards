# Polish / English interface — design

## Intent

AI Cards is for Polish speakers learning English, but the interface is in English. That's a barrier for exactly the people the app is for. The whole interface should be available in Polish (default) and English, with a switch anyone can use at any time.

## Goals

- Every piece of interface text exists in Polish and English: landing page, login, home, add/retry, review, learn, cards list, card detail, admin, error page, `<title>`/meta.
- Polish is the default for anyone who hasn't chosen (no browser `Accept-Language` sniffing).
- A visible switch (PL / EN) on the landing page, the login page, and home (next to the theme switch). The choice is remembered.
- Both emails come in both languages: the magic-link email and the daily reminder.

## Non-goals

- Study content is not translated or changed: card sentences, Polish/English answers, and explanations stay exactly as generated.
- AI review feedback (`verdict`, notes) stays in its current language whatever the interface language is. No prompt changes: the pipeline, `AiProvider` and `app/lib/openrouter.ts` are untouched.
- Text-to-speech generation is untouched.
- No third language, no translation library (no i18next/lingui), no URL prefixes (`/pl/...`).
- Landing-page demo cards keep their mixed `lang="en"` / `lang="pl"` sample content; only the surrounding copy is translated.

## Anti-goals

- Missing strings silently falling back to the other language. A dictionary key present in one language and missing in the other must be a type error.
- A user who chose English getting Polish emails, or vice versa.

## Decided

- **Mechanism mirrors the theme switch.** `app/lib/locale.ts` exports `type Locale = 'pl' | 'en'`, `toLocale` (unknown → `'pl'`), `parseLocale(cookieHeader)`, and `localeCookie(locale)`, the same as `app/lib/theme.ts`. The root loader returns `locale` alongside `theme`; `<html lang>` uses it.
- **Switch route.** `POST /locale` sets the cookie and redirects with `safeRedirect`, like `/theme`, but it is **public** (the landing and login pages need it). If a session exists, it also saves the choice to the user's account.
- **Dictionaries.** Plain typed objects, `pl` and `en`, where `en` is typed as `typeof pl` (or both satisfy one shared type) so a missing key fails `npm run typecheck`. Components read the current locale from the root loader data through a small `useT()` hook. Strings with numbers (plurals: "3 karty / 5 kart", "1 card / 2 cards") are functions in the dictionary. The existing Polish plural helpers in `app/lib/reminder.ts` are reused.
- **Per-user language.** New column `users.locale text NOT NULL DEFAULT 'pl'` (Drizzle migration). The reminder cron reads it. Switching language while logged in updates both the cookie and the column.
- **Magic-link email** uses the locale of the login request (cookie, default `pl`). `buildLoginEmail(link, locale)`.
- **Reminder email.** `buildReminder` takes `locale`. The current Polish copy stays as `pl`; English copy is written to match it. `<html lang>` in the email follows.
- **Server-produced messages.** Error and status text returned from actions (e.g. "out of credits", login errors) is translated too: actions return a key or code, and the component renders it through the dictionary. Alternatively, the action reads the cookie and returns translated text. Builder picks one approach and applies it consistently.

## Calls I made (flagged for review)

- Existing users get `pl` via the column default. Their emails are already Polish today, so nothing changes there, but their interface (the owner's included) flips from English to Polish until they switch once.
- The cookie wins for the interface. The column only drives emails, and gets synced whenever a logged-in user switches. Logging in does not overwrite the cookie from the column. On a new device you'd see Polish until you switch.
- **New accounts take the language they signed up in.** The login form sends the current locale. The magic link carries it (e.g. `&lang=en`, validated with `toLocale`) because the link often opens in a mail-app browser without the cookie. Verify passes it to account creation, so `users.locale` is set at creation, and verify also sets the cookie from it. For existing accounts, login leaves the column alone. Only the switch changes it.
- The switch is labelled `PL` / `EN`. No flags.

## Left to the builder

- Exact English copy for the reminder and Polish copy for every UI screen (natural Polish, informal "Ty", matching the tone of the existing Polish email copy).
- File layout for the dictionaries (one file vs. per-screen sections).
- Tests: `locale.ts` parsing, both email builders in both languages, the repo function that sets `users.locale`. UI is verified manually (no UI test infra, per CLAUDE.md).
