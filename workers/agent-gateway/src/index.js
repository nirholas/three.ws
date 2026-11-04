// agent-gateway: the process behind every three.ws chat gateway.
//
// The webhook receivers (api/gateway/telegram.js, api/gateway/discord.js) verify
// each delivery and queue it in gateway_inbox; notifications for paired chats
// are queued there too (api/_lib/gateway/notify.js). This worker drains that
// inbox: it claims rows one chat at a time under a lease, runs each through the
// shared gateway core with the platform's adapter, and acknowledges, retries
// with backoff, or dead-letters it. It also holds the Discord gateway connection
// (DMs and mentions), expires stale trade previews and prunes finished rows.
//
// Cloud Run runs it as an always-on service (no CPU throttling, one instance is
// enough; more are safe because the claim is exclusive). GET /healthz reports
// the loop, the adapters and the counters. SIGTERM stops claiming, lets running
// rows finish within the grace period, and closes the platform connections.
//
// Local: npm run dev (loads ../../.env and ../../.env.local). README.md has the
// env vars and the deploy command.

import { pathToFileURL } from 'node:url';
import { enqueueInbox } from '../../../api/_lib/gateway/store.js';
import { loadConfig } from './config.js';
import { loadAdapters } from './adapters/index.js';
import { createDrainer } from './drain.js';
import { startHealthServer } from './health.js';
import { errorSummary } from './errors.js';
import { log } from './log.js';

export async function main() {
	const config = loadConfig();
	const { adapters, skipped } = loadAdapters({ config, log });
	for (const s of skipped) log.warn('adapter not loaded', s);
	if (!adapters.size) log.error('no chat platform is configured; set TELEGRAM_BOT_TOKEN and/or DISCORD_BOT_TOKEN + DISCORD_APP_ID');

	const drainer = createDrainer({ adapters, config, log });
	const server = await startHealthServer({ port: config.port, drainer, adapters, skipped });

	const enqueue = async (delivery) => {
		const fresh = await enqueueInbox(delivery);
		log.debug('inbound delivery queued', { platform: delivery.platform, fresh });
		return fresh;
	};
	for (const [platform, adapter] of adapters) {
		if (typeof adapter.start !== 'function') continue;
		try {
			await adapter.start({ enqueue });
		} catch (e) {
			log.error('adapter listener failed to start; queued deliveries still drain', { platform, ...errorSummary(e) });
		}
	}

	log.info('agent gateway started', {
		platforms: [...adapters.keys()],
		concurrency: config.concurrency,
		leaseSeconds: config.leaseSeconds,
		maxAttempts: config.maxAttempts,
		chatKeys: config.chatKeys,
	});
	drainer.start();

	let shuttingDown = false;
	const shutdown = async (signal) => {
		if (shuttingDown) return;
		shuttingDown = true;
		log.info('shutdown requested', { signal, inflight: drainer.inflight.size });
		const { abandoned } = await drainer.stop();
		for (const [platform, adapter] of adapters) {
			if (typeof adapter.stop === 'function') await adapter.stop().catch((e) => log.warn('adapter stop failed', { platform, ...errorSummary(e) }));
		}
		server.close();
		log.info('agent gateway stopped', { abandoned });
		process.exit(0);
	};
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}

// Boot only when run as the process entry point (node src/index.js). Imported,
// the module just exposes main(), so the image build and the tests can prove
// the whole module graph resolves without opening a socket or a database.
const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
	process.on('unhandledRejection', (e) => log.error('unhandled rejection', errorSummary(e)));
	main().catch((e) => {
		log.error('agent gateway failed to start', errorSummary(e));
		process.exit(1);
	});
}
