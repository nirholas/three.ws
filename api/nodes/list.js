// GET /api/nodes/list: public view of the open inference network.
//
// Registered nodes with label, capabilities, last seen, online flag, jobs
// completed/failed and the count of verified (settled) earnings. Never returns
// secrets or network addresses. Cached 15 seconds in-process and at the CDN.

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { listNodes } from '../_lib/inference-nodes.js';

const TTL_MS = 15_000;
let cache = { at: 0, nodes: null };

export default wrap(async (req, res) => {
	cors(req, res);
	if (!method(req, res, ['GET'])) return;
	if (!cache.nodes || Date.now() - cache.at > TTL_MS) {
		try {
			cache = { at: Date.now(), nodes: await listNodes() };
		} catch (err) {
			console.error('[nodes/list]', err.message);
			return error(res, 503, 'nodes_unavailable', 'The node registry is unreachable. Retry shortly.');
		}
	}
	res.setHeader('cache-control', 'public, max-age=15, s-maxage=15');
	return json(res, 200, { nodes: cache.nodes, online: cache.nodes.filter((n) => n.online).length, generatedAt: new Date(cache.at).toISOString() });
});
