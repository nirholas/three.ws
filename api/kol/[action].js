// Consolidated KOL endpoints dispatcher.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const WALLETS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/kol/wallets.json');

async function loadWallets() {
	try { return JSON.parse(await readFile(WALLETS_PATH, 'utf8')); } catch { return []; }
}

// ── import-gmgn ───────────────────────────────────────────────────────────────

async function handleImportGmgn(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['POST'])) return;
	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const body = await readJson(req);
	if (!body || body.rawJson == null) return error(res, 400, 'validation_error', 'body.rawJson is required');
	const { parseGmgnSmartWallets } = await import('../../src/kol/gmgn-parser.js');
	let parsed;
	try { parsed = parseGmgnSmartWallets(body.rawJson); }
	catch (err) { return error(res, 400, 'validation_error', err.message); }
	const existing = await loadWallets();
	const byWallet = new Map(existing.map((w) => [w.wallet, w]));
	for (const entry of parsed) byWallet.set(entry.wallet, entry);
	const merged = [...byWallet.values()];
	await writeFile(WALLETS_PATH, JSON.stringify(merged, null, '\t') + '\n', 'utf8');
	return json(res, 200, { imported: parsed.length, wallets: merged });
}

// ── leaderboard ───────────────────────────────────────────────────────────────

async function handleLeaderboard(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const url = new URL(req.url, `http://${req.headers.host}`);
	const window = url.searchParams.get('window') || '7d';
	const limitRaw = url.searchParams.get('limit');
	const limit = limitRaw != null ? Number(limitRaw) : 25;
	const { getLeaderboard } = await import('../../src/kol/leaderboard.js');
	let items;
	try { items = await getLeaderboard({ window, limit }); }
	catch (err) { if (err.status === 400) return error(res, 400, err.code || 'validation_error', err.message); throw err; }
	return json(res, 200, { items });
}

// ── trades ────────────────────────────────────────────────────────────────────

async function handleTrades(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const mint = url.searchParams.get('mint');
	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || '20')));
	if (!mint) return error(res, 400, 'validation_error', 'mint is required');
	const { KOL_WALLETS } = await import('../../src/kol/wallets.js');
	return json(res, 200, { mint, trades: [], wallets: KOL_WALLETS.length });
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = {
	'import-gmgn': handleImportGmgn,
	leaderboard:   handleLeaderboard,
	trades:        handleTrades,
};

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown kol action: ${action}`);
	return fn(req, res);
});
