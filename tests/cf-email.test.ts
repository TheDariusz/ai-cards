import { describe, it, expect, vi } from 'vitest'
import { createCfMailer, mailerFromEnv } from '../app/lib/cf-email'

const msg = { subject: 's', text: 't', html: 'h' }
const stub = () => ({ send: vi.fn(async (_m: unknown) => ({ messageId: 'm1' })) })

describe('createCfMailer', () => {
  it('passes exactly from, to, subject, text and html to the binding', async () => {
    const binding = stub()
    await createCfMailer(binding, 'a@x.com', 'b@y.com').send(msg)
    expect(binding.send).toHaveBeenCalledTimes(1)
    expect(binding.send).toHaveBeenCalledWith({ from: 'a@x.com', to: 'b@y.com', subject: 's', text: 't', html: 'h' })
  })

  it('propagates a rejection', async () => {
    const binding = { send: vi.fn(async () => { throw new Error('destination address not verified') }) }
    await expect(createCfMailer(binding, 'a@x.com', 'b@y.com').send(msg)).rejects.toThrow('destination address not verified')
  })
})

describe('mailerFromEnv', () => {
  it('returns null when a secret is empty or blank', () => {
    const binding = stub()
    expect(mailerFromEnv({ EMAIL: binding, REMINDER_FROM: '', REMINDER_TO: 'b@y.com' } as any)).toBeNull()
    expect(mailerFromEnv({ EMAIL: binding, REMINDER_FROM: 'a@x.com', REMINDER_TO: ' ' } as any)).toBeNull()
    expect(mailerFromEnv({ EMAIL: binding } as any)).toBeNull()
  })

  it('builds a mailer over the binding when both secrets are set', async () => {
    const binding = stub()
    await mailerFromEnv({ EMAIL: binding, REMINDER_FROM: 'a@x.com', REMINDER_TO: 'b@y.com' } as any)!.send(msg)
    expect(binding.send).toHaveBeenCalledWith(expect.objectContaining({ from: 'a@x.com', to: 'b@y.com' }))
  })
})
