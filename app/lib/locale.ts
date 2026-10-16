export type Locale = 'pl' | 'en'

export function toLocale(value: unknown): Locale {
  return value === 'en' || value === 'pl' ? value : 'pl'
}

export function parseLocale(cookieHeader: string | null): Locale {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'locale') return toLocale(rest.join('='))
  }
  return 'pl'
}

export function localeCookie(locale: Locale): string {
  return `locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
}
