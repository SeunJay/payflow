// Rebuilds every balance from ledger entries and exits 1 on drift (spec 0003, AC-10).
// Run: pnpm --filter @payflow/core ledger:verify
import { z } from 'zod';
import { createLogger, loadConfig, logLevel, url } from '@payflow/shared';
import { createDb, runLedgerVerify } from '../src/index.ts';

const config = loadConfig(z.object({ DATABASE_URL: url, LOG_LEVEL: logLevel }));
const logger = createLogger({ name: 'ledger-verify', level: config.LOG_LEVEL });
const handle = createDb({ url: config.DATABASE_URL, logger, max: 1 });

try {
  process.exitCode = await runLedgerVerify(handle.db, logger);
} finally {
  await handle.close();
}
