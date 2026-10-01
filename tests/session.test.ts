import { describe, it, expect } from 'vitest'
import { sessionUserId, sha256Hex } from '../app/lib/session'

describe('sha256Hex', () => {
  it('hashes to lowercase hex', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('sessionUserId', () => {
  it('reads the user id', () => {
    expect(sessionUserId({ userId: 7 })).toBe(7)
  })

  it('maps a pre-multi-user cookie to the owner', () => {
    expect(sessionUserId({ authed: true })).toBe(1)
  })

  it('rejects missing or malformed sessions', () => {
    expect(sessionUserId({})).toBeNull()
    expect(sessionUserId({ userId: '1' })).toBeNull()
    expect(sessionUserId({ userId: 0 })).toBeNull()
    expect(sessionUserId({ userId: 1.5 })).toBeNull()
  })
})
