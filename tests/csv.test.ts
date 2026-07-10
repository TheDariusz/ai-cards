import { describe, it, expect } from 'vitest'
import { toCsv } from '../app/lib/csv'

describe('toCsv', () => {
  it('joins rows with commas and CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })
  it('quotes fields containing commas, quotes, or newlines', () => {
    expect(toCsv([['he said "hi"', 'a,b', 'x\ny']])).toBe('"he said ""hi""","a,b","x\ny"')
  })
})
