// POST /api/kol/import-gmgn
// body: { rawJson: <string|object> }
// → { imported: <number>, wallets: [...] }
//
// Merges parsed wallets into src/kol/wallets.json by wallet address (latest wins).
// No auth required; rate-limited by IP.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parseGmgnSmartWallets } from '../../src/kol/gmgn-parser.js';

const WALLETS_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../src/kol/wallets.json',
);

async function loadWallets() {
	try {
		return JSON.parse(await readFile(WALLETS_PATH, 'utf8'));
	} catch {
		return [];
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const body = await readJson(req);
	if (!body || body.rawJson == null) {
		return error(res, 400, 'validation_error', 'body.rawJson is required');
	}

	let parsed;
	try {
		parsed = parseGmgnSmartWallets(body.rawJson);
	} catch (err) {
		return error(res, 400, 'validation_error', err.message);
	}

	const existing = await loadWallets();
	const byWallet = new Map(existing.map((w) => [w.wallet, w]));
	for (const entry of parsed) {
		byWallet.set(entry.wallet, entry);
	}
	const merged = [...byWallet.values()];

	await writeFile(WALLETS_PATH, JSON.stringify(merged, null, '\t') + '\n', 'utf8');

	return json(res, 200, { imported: parsed.length, wallets: merged });
});
