// Background work outlives the response, so the request's log flush (in the Worker) has already
// run when it logs. Routes get this `ctx` instead of the runtime's: every `waitUntil` task flushes
// the log once it settles, so a new background task can't silently drop its lines.
// A Proxy rather than a hand-built object: every other member of ExecutionContext stays the
// runtime's own, bound to it (its methods throw "Illegal invocation" on any other `this`).
export function flushingContext<C extends { waitUntil(promise: Promise<unknown>): void }>(
  ctx: C,
  flush: () => Promise<void>,
): C {
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'waitUntil') {
        return (promise: Promise<unknown>) => target.waitUntil(promise.finally(flush))
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
