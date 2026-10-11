// Pulse entry point: one process runs the archive migrations, the Solana
// firehose, the collection loop and the dashboard API. `--once` runs a single
// collection cycle and exits, which is what `npm run collect` does.
import { config } from './lib/env.ts';
import { logger } from './lib/log.ts';
import { migrate } from './db/migrate.ts';
import { db } from './db/client.ts';
import { SolanaStream } from './collector/solana-stream.ts';
import { collectCycle, periodicJobs, runForever } from './collector/scheduler.ts';
import { startServer } from './server/app.ts';

const log = logger('pulse');
const args = new Set(process.argv.slice(2));
const once = args.has('--once');
const migrateOnly = args.has('--migrate');
const withStream = config.streams && !args.has('--no-stream') && !once;
const withServer = !args.has('--no-server') && !once;

await migrate();
if (migrateOnly) {
  log.info('schema up to date');
  await (await db()).close();
  process.exit(0);
}
const stream = withStream ? new SolanaStream() : null;
if (stream) await stream.start();
if (withServer) startServer({ stream });

const shutdown = async (signal: string) => {
  log.info(`${signal}: flushing and closing`);
  await stream?.stop();
  await (await db()).close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

if (once) {
  const result = await collectCycle(null);
  await periodicJobs(null, args.has('--jobs'));
  log.info(`done: ${JSON.stringify(result)}`);
  await (await db()).close();
  process.exit(0);
}

await runForever(stream);
