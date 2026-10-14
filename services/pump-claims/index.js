/**
 * pump-claims listener
 * ---------------------
 * Long-lived process: subscribes to PumpFees program logs, decodes and
 * attributes each GitHub social-fee-PDA claim, and writes it to
 * `pump_fee_claims`. Backs api/_lib/pump-claims.js's table-first read path so
 * the claims feed no longer depends on PUMPFUN_BOT_URL for GitHub claims.
 *
 * Env:
 *   SOLANA_RPC_URL        Mainnet HTTPS RPC endpoint (required).
 *   SOLANA_RPC_WS_URL     Optional dedicated WSS endpoint override; otherwise
 *                         derived from SOLANA_RPC_URL (same convention as
 *                         api/_lib/solana/connection.js's resolveWsEndpoint).
 *   DATABASE_URL          Neon Postgres connection string (required).
 *   PORT                  Health server port (default 8080).
 *
 * This process holds a long-lived WebSocket subscription, so it is NOT
 * deployable as a request/response serverless function. Run it on Cloud Run
 * with --min-instances=1 --no-cpu-throttling (see cloudbuild.yaml).
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import { normalizeRpcUrl, resolveWsEndpoint } from '../../api/_lib/solana/connection.js';
import { PUMP_FEE_PROGRAM_ID } from '../../api/_lib/solana/programs.js';
import { isSocialClaimLog } from '../../api/_lib/pump-events.js';
import { ClaimListener } from './listener.js';
import { processLogEntry } from './pipeline.js';
import { makeStore } from './store.js';
import { SeenSignatures } from './dedupe.js';
import { sleep, getParsedTransactionWithBackoff, withRpcBackoff } from './rpc-pace.js';

const GAP_FILL_SIG_LIMIT = 100;
const GAP_FILL_PACE_MS = Number(process.env.PUMP_CLAIMS_GAPFILL_PACE_MS) || 150;

function required(name) {
	const v = process.env[name];
	if (!v) {
		console.error(`[pump-claims] missing env ${name}`);
		process.exit(1);
	}
	return v;
}

export function buildConnection() {
	const rpcUrl = normalizeRpcUrl(required('SOLANA_RPC_URL'));
	if (!rpcUrl) {
		console.error('[pump-claims] SOLANA_RPC_URL is not a usable http(s) endpoint');
		process.exit(1);
	}
	const wsEndpoint = resolveWsEndpoint(rpcUrl, 'mainnet');
	return new Connection(rpcUrl, { wsEndpoint, commitment: 'confirmed' });
}

export function createHealthServer(state) {
	return createServer((req, res) => {
		if (req.url !== '/health') {
			res.writeHead(404, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: 'not_found' }));
			return;
		}
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(
			JSON.stringify({
				ok: true,
				uptime: process.uptime(),
				claimsSeen: state.claimsSeen,
				claimsStored: state.claimsStored,
				lastClaimAt: state.lastClaimAt,
				reconnects: state.reconnects,
				missedHeartbeats: state.listener?.missedHeartbeats ?? 0,
			}),
		);
	});
}

/**
 * Wires one signature's logs through decode -> attribute -> store. Shared by
 * the live listener callback and gap-fill so neither path can double-count:
 * both the in-memory `seen` set and the table's `on conflict (signature) do
 * nothing` make a replay of the same signature a no-op.
 */
export function createClaimHandler({ connection, store, seen, state }) {
	return async function maybeProcess(signature, logs, err, { slot, blockTime } = {}) {
		if (!seen.add(signature)) return;
		const claim = await processLogEntry(connection, { signature, logs, err }, { blockTime });
		if (!claim) return;
		state.claimsSeen += 1;
		const row = store.toRow(claim, { slot });
		const inserted = await store.insertClaim(row);
		if (inserted) {
			state.claimsStored += 1;
			state.lastClaimAt = new Date().toISOString();
			console.log(
				'[pump-claims] stored claim %s mint=%s label=%s',
				signature,
				claim.mint || '(unresolved)',
				claim.attribution?.label,
			);
		}
	};
}

/**
 * Walk the PumpFees program's recent signature history and process any
 * GitHub claim this process hasn't seen yet. Covers the gap behind a dropped
 * WS subscription (called on every forced reconnect) and fills the table
 * immediately on cold start, before the first live claim arrives.
 */
export async function gapFill({ connection, seen, maybeProcess }) {
	try {
		const sigs = await withRpcBackoff(() =>
			connection.getSignaturesForAddress(new PublicKey(PUMP_FEE_PROGRAM_ID), {
				limit: GAP_FILL_SIG_LIMIT,
			}),
		);
		for (const s of sigs) {
			if (s.err || seen.has(s.signature)) continue;
			const tx = await getParsedTransactionWithBackoff(connection, s.signature, {
				maxSupportedTransactionVersion: 1,
				commitment: 'confirmed',
			});
			await sleep(GAP_FILL_PACE_MS);
			const logs = tx?.meta?.logMessages;
			if (!logs || tx?.meta?.err || !isSocialClaimLog(logs)) continue;
			await maybeProcess(s.signature, logs, null, { blockTime: s.blockTime ?? undefined });
		}
	} catch (err) {
		console.error('[pump-claims] gap-fill failed:', err?.message || err);
	}
}

async function main() {
	const databaseUrl = required('DATABASE_URL');
	const connection = buildConnection();
	const store = makeStore(databaseUrl);
	const seen = new SeenSignatures();
	const state = {
		claimsSeen: 0,
		claimsStored: 0,
		lastClaimAt: null,
		reconnects: 0,
		listener: null,
	};

	const maybeProcess = createClaimHandler({ connection, store, seen, state });
	const runGapFill = () => gapFill({ connection, seen, maybeProcess }).catch(() => {});

	const listener = new ClaimListener({ connection });
	state.listener = listener;
	listener.start(
		(entry, context) => {
			maybeProcess(entry.signature, entry.logs, entry.err, { slot: context?.slot }).catch((err) =>
				console.error('[pump-claims] handle entry failed:', err?.message || err),
			);
		},
		() => {
			state.reconnects += 1;
			console.warn('[pump-claims] resubscribed after missed heartbeats, gap-filling');
			runGapFill();
		},
	);

	console.log('[pump-claims] listener started, program=%s', PUMP_FEE_PROGRAM_ID);
	runGapFill();

	const server = createHealthServer(state);
	const port = parseInt(process.env.PORT ?? '8080', 10);
	server.listen(port, () => console.log(`[pump-claims] health server on :${port}`));

	function shutdown(signal) {
		console.log(`[pump-claims] ${signal} received, shutting down`);
		listener.stop();
		server.close(() => process.exit(0));
		setTimeout(() => process.exit(0), 5_000).unref?.();
	}
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
