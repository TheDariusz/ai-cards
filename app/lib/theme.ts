export type ThemePref = 'auto' | 'light' | 'dark'

// Page background per theme; mirrors --bg in app/app.css for the theme-color meta
export const THEME_BG: Record<'light' | 'dark', string> = { light: '#f6f7fb', dark: '#111421' }

export function toThemePref(value: unknown): ThemePref {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto'
}

export function parseTheme(cookieHeader: string | null): ThemePref {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'theme') return toThemePref(rest.join('='))
  }
  return 'auto'
}

export function themeCookie(pref: ThemePref): string {
  return `theme=${pref}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
}

// Only same-origin paths. Resolve the way a browser would ('//host', '/\host' and
// '/<tab>/host' all become absolute), and keep it only if the origin didn't change.
export function safeRedirect(to: FormDataEntryValue | null): string {
  if (typeof to !== 'string' || !to.startsWith('/')) return '/'
  const base = 'http://app.invalid'
  const url = new URL(to, base)
  return url.origin === base ? url.pathname + url.search + url.hash : '/'
}
