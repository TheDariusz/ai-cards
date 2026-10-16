import { readCookie } from './cookie'

export type Locale = 'pl' | 'en'

export function toLocale(value: unknown): Locale {
  return value === 'en' || value === 'pl' ? value : 'pl'
}

export function parseLocale(cookieHeader: string | null): Locale {
  return toLocale(readCookie(cookieHeader, 'locale'))
}

export function localeCookie(locale: Locale): string {
  return `locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`
}
