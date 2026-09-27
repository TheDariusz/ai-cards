// Port for outgoing mail. Addresses are adapter configuration, not part of a message.
export type MailMessage = { subject: string; text: string; html: string }

export interface Mailer {
  send(msg: MailMessage): Promise<void>
}
