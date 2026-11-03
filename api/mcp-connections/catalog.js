// GET /api/mcp-connections/catalog: the vetted catalog of external MCP servers
// (data/mcp-catalog.json), each entry with whether it can be connected on this
// deployment. Public and cacheable: it holds no account data.

import { cors, json, method, wrap } from '../_lib/http.js';
import { loadCatalog, presentEntry } from '../_lib/mcp-connections/catalog.js';

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET, OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const doc = loadCatalog();
	return json(res, 200, { updated: doc.updated, categories: doc.categories, servers: doc.servers.map((s) => presentEntry(s)) }, { 'cache-control': 'public, max-age=300' });
});
