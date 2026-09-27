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

// Only same-origin paths: '//host' and '/\host' are treated as absolute by browsers
export function safeRedirect(to: FormDataEntryValue | null): string {
  if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\')) return '/'
  return to
}
