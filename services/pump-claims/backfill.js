/**
 * One-off backfill: walks the PumpFees program's signature history back
 * `--days` (default 7) and stores every GitHub social-fee-PDA claim found, so
 * the claims feed isn't empty on day one of the listener's deployment. Safe
 * to re-run: insertClaim is idempotent on signature, and a page's signatures
 * are also deduped in-memory before the RPC fetch that would otherwise repeat.
 *
 *   DATABASE_URL=... SOLANA_RPC_URL=... node backfill.js [--days=7]
 */

import { pathToFileURL } from 'node:url';
import { PublicKey } from '@solana/web3.js';
import { PUMP_FEE_PROGRAM_ID } from '../../api/_lib/solana/programs.js';
import { isSocialClaimLog } from '../../api/_lib/pump-events.js';
import { buildConnection, createClaimHandler } from './index.js';
import { makeStore } from './store.js';
import { SeenSignatures } from './dedupe.js';
import { sleep, getParsedTransactionWithBackoff, withRpcBackoff } from './rpc-pace.js';

const PAGE_LIMIT = 200;
// Safety cap: ~100 pages. The PumpFees program is a single shared account, so
// an unbounded backward walk could run indefinitely on a busy chain; this caps
// one backfill run's RPC cost regardless of how far `--days` reaches.
const MAX_SIGNATURES_SCANNED = 20_000;
// Per-call pace between getParsedTransaction fetches; see rpc-pace.js. A paid
// lane set via SOLANA_RPC_URL tolerates a shorter pace, so this is overridable.
const RPC_PACE_MS = Number(process.env.PUMP_CLAIMS_BACKFILL_PACE_MS) || 150;

function requiredEnv(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`[pump-claims backfill] missing env ${name}`);
		process.exit(1);
	}
	return v;
}

function parseDays(argv) {
	const arg = argv.find((a) => a.startsWith('--days='));
	const days = arg ? Number(arg.split('=')[1]) : 7;
	return Number.isFinite(days) && days > 0 ? days : 7;
}

/**
 * @param {{days?: number, connection?: object, store?: object}} [opts]
 *   `connection`/`store` are injectable for tests; production calls with no
 *   overrides, which builds the real RPC connection and Neon store.
 */
export async function backfill({ days = 7, connection: conn, store: st } = {}) {
	const connection = conn || buildConnection();
	const store = st || makeStore(requiredEnv('DATABASE_URL'));
	const seen = new SeenSignatures(MAX_SIGNATURES_SCANNED + 1);
	const state = { claimsSeen: 0, claimsStored: 0, lastClaimAt: null, reconnects: 0, listener: null };
	const maybeProcess = createClaimHandler({ connection, store, seen, state });

	const lookbackTs = Math.floor(Date.now() / 1000) - days * 86400;
	const programKey = new PublicKey(PUMP_FEE_PROGRAM_ID);

	let before;
	let scanned = 0;
	let reachedWindow = false;

	while (scanned < MAX_SIGNATURES_SCANNED) {
		const sigs = await withRpcBackoff(() =>
			connection.getSignaturesForAddress(programKey, {
				limit: PAGE_LIMIT,
				...(before ? { before } : {}),
			}),
		);
		await sleep(RPC_PACE_MS);
		if (!sigs.length) break;
		scanned += sigs.length;

		for (const s of sigs) {
			if (s.blockTime != null && s.blockTime < lookbackTs) {
				reachedWindow = true;
				break;
			}
			if (s.err || seen.has(s.signature)) continue;
			const tx = await getParsedTransactionWithBackoff(connection, s.signature, {
				maxSupportedTransactionVersion: 1,
				commitment: 'confirmed',
			});
			await sleep(RPC_PACE_MS);
			const logs = tx?.meta?.logMessages;
			if (!logs || tx?.meta?.err || !isSocialClaimLog(logs)) continue;
			await maybeProcess(s.signature, logs, null, { blockTime: s.blockTime ?? undefined });
		}

		if (reachedWindow || sigs.length < PAGE_LIMIT) break;
		before = sigs[sigs.length - 1].signature;
	}

	console.log(
		'[pump-claims backfill] scanned=%d stored=%d days=%d reachedWindow=%s',
		scanned,
		state.claimsStored,
		days,
		reachedWindow,
	);
	return state;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	backfill({ days: parseDays(process.argv.slice(2)) })
		.then(() => process.exit(0))
		.catch((err) => {
			console.error('[pump-claims backfill] failed:', err?.message || err);
			process.exit(1);
		});
}
