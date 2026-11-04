// GET /healthz (also /): the worker's only HTTP surface, read by Cloud Run's
// startup and liveness probes and by an operator through `gcloud run services
// proxy`. It answers 200 when the drain loop is turning and at least one chat
// adapter loaded, 503 otherwise, and always carries the reason: which adapters
// run, which platforms were skipped and why, the drain counters, and the open
// inbox backlog. Never a message body, never a credential.

import http from 'node:http';
import { inboxBacklog } from '../../../api/_lib/gateway/store.js';
import { errorSummary } from './errors.js';
import { log as defaultLog } from './log.js';

/**
 * The health report for one probe.
 * @returns {Promise<{ status:number, body:object }>}
 */
export async function healthReport({ drainer, adapters, skipped, backlog = inboxBacklog, log = defaultLog }) {
	const h = drainer.health();
	let queue = null;
	try {
		queue = await backlog();
	} catch (e) {
		log.warn('health: inbox backlog unreadable', errorSummary(e));
	}
	const body = {
		...h,
		ok: h.ok && adapters.size > 0,
		adapters: Object.fromEntries([...adapters].map(([p, a]) => [p, a.describe ? a.describe() : {}])),
		skipped,
		backlog: queue,
	};
	return { status: body.ok ? 200 : 503, body };
}

/**
 * Listen on `port` (0 picks a free one). Resolves with the listening server.
 * @returns {Promise<http.Server>}
 */
export function startHealthServer({ port, drainer, adapters, skipped, backlog = inboxBacklog, log = defaultLog }) {
	const server = http.createServer(async (req, res) => {
		const path = new URL(req.url, 'http://localhost').pathname;
		if (req.method !== 'GET' || (path !== '/' && path !== '/healthz')) {
			res.writeHead(404, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: 'not_found' }));
			return;
		}
		const { status, body } = await healthReport({ drainer, adapters, skipped, backlog, log });
		res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
		res.end(JSON.stringify(body));
	});
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, () => {
			server.off('error', reject);
			log.info('health endpoint listening', { port: server.address().port });
			resolve(server);
		});
	});
}
