// Usage: npm run restore -- <backup-file.db.enc> <output.db>   (stop the server, then point WMS_DB_PATH at the output)
import { decryptFile } from '../backup.js'
const [src, dest] = process.argv.slice(2)
if (!src || !dest) { console.error('usage: restore <backup.db.enc> <output.db>'); process.exit(1) }
await decryptFile(src, dest)
console.log('Restored to', dest)
