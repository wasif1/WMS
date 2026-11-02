import { defineConfig } from 'vitest/config'
import os from 'node:os'
import path from 'node:path'
export default defineConfig({
  test: { environment: 'node', testTimeout: 30000, env: { WMS_DATA_DIR: path.join(os.tmpdir(), 'wms-test-data'), WMS_BACKUP_DIR: path.join(os.tmpdir(), 'wms-test-backups') } },
})
