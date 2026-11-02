import type { Db } from './db.js'
import type { User } from './models.js'
import { Mailer } from './mailer.js'
import { Audit } from './audit.js'

export interface Ctx {
  db: Db
  mailer: Mailer
  audit: Audit
}
export type AuthedUser = User
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User
      sessionId?: number
      csrf?: string
    }
  }
}
