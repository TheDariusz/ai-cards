import { describe, it, expect } from 'vitest'
import { localeCookie, parseLocale, toLocale } from '../app/lib/locale'

describe('parseLocale', () => {
  it('defaults to pl without a cookie', () => expect(parseLocale(null)).toBe('pl'))
  it('reads en', () => expect(parseLocale('locale=en')).toBe('en'))
  it('reads en among other cookies', () => expect(parseLocale('__session=a; locale=en; x=1')).toBe('en'))
  it('treats an unknown value as pl', () => expect(parseLocale('locale=de')).toBe('pl'))
  it('does not match a cookie merely ending in locale', () => expect(parseLocale('mylocale=en')).toBe('pl'))
})

describe('toLocale', () => {
  it('accepts the two locales', () => expect(['pl', 'en'].map(toLocale)).toEqual(['pl', 'en']))
  it('maps anything else to pl', () => {
    expect(toLocale(null)).toBe('pl')
    expect(toLocale('EN')).toBe('pl')
    expect(toLocale('<b>')).toBe('pl')
  })
})

describe('localeCookie', () => {
  it('builds a year-long lax secure cookie', () => {
    const c = localeCookie('en')
    for (const part of ['locale=en', 'Path=/', 'Max-Age=31536000', 'SameSite=Lax', 'Secure']) expect(c).toContain(part)
    expect(c).not.toContain('HttpOnly')
  })
})
