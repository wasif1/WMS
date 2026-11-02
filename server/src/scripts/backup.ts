import { openDb } from '../db.js'
import { runBackup } from '../backup.js'
console.log(await runBackup(openDb()))
