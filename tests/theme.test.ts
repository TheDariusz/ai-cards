import { describe, it, expect } from 'vitest'
import { parseTheme, safeRedirect, themeCookie, toThemePref } from '../app/lib/theme'

describe('parseTheme', () => {
  it('defaults to auto without a cookie', () => expect(parseTheme(null)).toBe('auto'))
  it('reads light', () => expect(parseTheme('theme=light')).toBe('light'))
  it('reads dark among other cookies', () => expect(parseTheme('__session=abc; theme=dark; x=1')).toBe('dark'))
  it('treats an unknown value as auto', () => expect(parseTheme('theme=blue')).toBe('auto'))
  it('does not match a cookie merely ending in theme', () => expect(parseTheme('mytheme=dark')).toBe('auto'))
})

describe('toThemePref', () => {
  it('accepts the three prefs', () => expect(['auto', 'light', 'dark'].map(toThemePref)).toEqual(['auto', 'light', 'dark']))
  it('maps anything else to auto', () => expect(toThemePref(null)).toBe('auto'))
})

describe('themeCookie', () => {
  it('builds a year-long lax secure cookie', () => {
    const c = themeCookie('dark')
    for (const part of ['theme=dark', 'Path=/', 'Max-Age=31536000', 'SameSite=Lax', 'Secure']) expect(c).toContain(part)
    expect(c).not.toContain('HttpOnly')
  })
})

describe('safeRedirect', () => {
  it('keeps an in-app path with its query', () => expect(safeRedirect('/review?mode=flip')).toBe('/review?mode=flip'))
  it.each([null, '', 'https://x.com', '//x.com', '/\\x.com', 'review'])('rejects %s', (to) => {
    expect(safeRedirect(to)).toBe('/')
  })
})
