// Usage: npm run create-admin -- you@example.com "Your Name"     (prints a one-time password)
import { openDb } from '../db.js'
import { blindIndex, hashPassword, randomToken } from '../crypto.js'

const [email, name = 'Super Admin'] = process.argv.slice(2)
if (!email) { console.error('usage: create-admin <email> [name]'); process.exit(1) }
const db = openDb()
if (db.users.byIdx('email_idx', blindIndex(email, 'email'))) { console.error('User already exists'); process.exit(1) }
const pw = process.env.WMS_ADMIN_PASSWORD ?? `${randomToken(9)}-${Math.floor(1000 + Math.random() * 9000)}`
db.users.insert({ name, email: email.toLowerCase(), role: 'super_admin', permissions: [], passwordHash: await hashPassword(pw), active: true, mustChangePassword: true, failedLogins: 0, createdAt: new Date().toISOString() }, { email_idx: blindIndex(email, 'email') })
console.log(`Super admin created.\n  email:    ${email}\n  password: ${pw}\n(you must change it at first login)`)
