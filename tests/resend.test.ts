import { describe, it, expect, vi, afterEach } from 'vitest'
import { createResendMailer, mailerFromEnv } from '../app/lib/resend'

const msg = { subject: 's', text: 't', html: 'h' }
const ok = () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'e1' })))

afterEach(() => vi.unstubAllGlobals())

describe('createResendMailer', () => {
  it('POSTs the message to the Resend emails endpoint with a Bearer key', async () => {
    const fetchMock = ok()
    vi.stubGlobal('fetch', fetchMock)
    await createResendMailer({ apiKey: 're_k', from: 'AI Cards <cards@2doai.app>', to: 'b@y.com' }).send(msg)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer re_k')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body)).toEqual({
      from: 'AI Cards <cards@2doai.app>',
      to: 'b@y.com',
      subject: 's',
      text: 't',
      html: 'h',
    })
  })

  it('throws with the status and body on 403', async () => {
    const body = '{"statusCode":403,"message":"You can only send testing emails to your own email address"}'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 403 })))
    const send = createResendMailer({ apiKey: 'k', from: 'a@x.com', to: 'b@y.com' }).send(msg)
    await expect(send).rejects.toThrow(/403.*only send testing emails/)
  })

  it('throws with the status on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    await expect(createResendMailer({ apiKey: 'k', from: 'a@x.com', to: 'b@y.com' }).send(msg)).rejects.toThrow(/500/)
  })
})

describe('mailerFromEnv', () => {
  const env = { RESEND_API_KEY: 're_k', REMINDER_FROM: 'a@x.com', REMINDER_TO: 'b@y.com' }

  it('returns null when a secret is empty, blank or missing', () => {
    expect(mailerFromEnv({ ...env, RESEND_API_KEY: '' } as any)).toBeNull()
    expect(mailerFromEnv({ ...env, REMINDER_TO: ' ' } as any)).toBeNull()
    expect(mailerFromEnv({ REMINDER_FROM: 'a@x.com' } as any)).toBeNull()
  })

  it('sends to an explicit recipient instead of REMINDER_TO', async () => {
    const fetchMock = ok()
    vi.stubGlobal('fetch', fetchMock)
    await mailerFromEnv(env as any, 'c@z.com')!.send(msg)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ to: 'c@z.com' })
  })

  it('builds a Resend mailer from the env', async () => {
    const fetchMock = ok()
    vi.stubGlobal('fetch', fetchMock)
    await mailerFromEnv(env as any)!.send(msg)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer re_k')
    expect(JSON.parse(init.body)).toMatchObject({ from: 'a@x.com', to: 'b@y.com' })
  })
})
