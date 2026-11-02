import nodemailer from 'nodemailer'
import type { Db } from './db.js'
import { config } from './config.js'

/** Stores every message in the encrypted outbox, then delivers over SMTP if WMS_SMTP_URL is configured. Plain text only. */
export class Mailer {
  private transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null
  constructor(private db: Db) {}
  send(to: string[], subject: string, text: string) {
    const recipients = [...new Set(to.map((t) => t.trim()).filter(Boolean))]
    if (!recipients.length) return
    const rec = this.db.outbox.insert({ to: recipients, subject, text, at: new Date().toISOString(), status: this.transport ? 'queued' : 'not_configured' })
    if (!this.transport) return
    this.transport
      .sendMail({ from: config.mailFrom, to: recipients, subject, text })
      .then(() => this.db.outbox.update(rec.id, { ...rec, status: 'sent' }))
      .catch((e) => this.db.outbox.update(rec.id, { ...rec, status: 'failed', error: String(e?.message ?? e).slice(0, 200) }))
  }
}
