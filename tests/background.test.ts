import { describe, it, expect, vi } from 'vitest'
import { flushingContext } from '../app/lib/background'

// methods reach a private field, so they fail on any `this` but the real object (like workerd's)
class FakeCtx {
  #tasks: Promise<unknown>[] = []
  props = { a: 1 }
  waitUntil(promise: Promise<unknown>) { this.#tasks.push(promise) }
  passThroughOnException() { return this.#tasks.length }
  settle() { return Promise.allSettled(this.#tasks) }
}

describe('flushingContext', () => {
  it('flushes after each background task settles, not before', async () => {
    const ctx = new FakeCtx()
    const flush = vi.fn().mockResolvedValue(undefined)
    let finish!: () => void
    flushingContext(ctx, flush).waitUntil(new Promise<void>((r) => { finish = r }))
    await Promise.resolve()
    expect(flush).not.toHaveBeenCalled()
    finish()
    await ctx.settle()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('flushes after a rejected task and still hands the rejection to the runtime', async () => {
    const ctx = new FakeCtx()
    const flush = vi.fn().mockResolvedValue(undefined)
    flushingContext(ctx, flush).waitUntil(Promise.reject(new Error('boom')))
    const [result] = await ctx.settle()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('rejected')
  })

  it('passes every other member through to the real context', () => {
    const ctx = new FakeCtx()
    const wrapped = flushingContext(ctx, async () => {})
    wrapped.waitUntil(Promise.resolve())
    expect(wrapped.passThroughOnException()).toBe(1)
    expect(wrapped.props).toEqual({ a: 1 })
  })
})
