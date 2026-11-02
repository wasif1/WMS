import { createApp } from './app.js'
import { scheduleBackups } from './backup.js'
import { config } from './config.js'
import { openDb } from './db.js'

const db = openDb()
const { app, ctx } = createApp(db)
scheduleBackups(db, ctx.audit)
app.listen(config.port, () => console.log(`[wms] API listening on :${config.port}`))
