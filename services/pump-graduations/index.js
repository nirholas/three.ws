/**
 * pump-graduations worker
 * -----------------------
 * Subscribes to Pump program logs and pushes graduation (bonding-curve →
 * PumpAMM migration) events into Upstash Redis. The Vercel side reads from
 * Redis; this service is the only thing that holds a long-lived WS.
 *
 * Detection: Pump emits a `complete` anchor event when a token graduates.
 * Discriminator (8 bytes) matches @pumpkit/core: COMPLETE_EVENT_DISCRIMINATOR.
 *
 * Env:
 *   SOLANA_RPC_URL              Helius (or any) HTTPS RPC
 *   SOLANA_WS_URL               Helius (or any) WSS endpoint
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *   GRADUATIONS_LIST_KEY        default: pf:graduations
 *   GRADUATIONS_MAX_LEN         default: 500
 *   PUMP_GRADUATIONS_SOURCE     "legacy" (default) | "carbon"
 *                               Selects the graduation event source at startup.
 *                               Both sources emit the same events to Redis.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { Redis } from '@upstash/redis';
import bs58 from 'bs58';
import { CarbonGraduationSource } from './carbon-source.js';

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

// Anchor "event" CPI emit: discriminator is sha256("event:CompleteEvent")[..8].
// Borrowed from @pumpkit/core/monitor/GraduationMonitor — fixed bytes:
const COMPLETE_EVENT_DISCRIMINATOR = Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]);

const RPC = required('SOLANA_RPC_URL');
const WS = required('SOLANA_WS_URL');
const LIST_KEY = process.env.GRADUATIONS_LIST_KEY || 'pf:graduations';
const MAX_LEN = Number(process.env.GRADUATIONS_MAX_LEN || 500);
const SOURCE = process.env.PUMP_GRADUATIONS_SOURCE || 'legacy';

const redis = new Redis({
	url: required('UPSTASH_REDIS_REST_URL'),
	token: required('UPSTASH_REDIS_REST_TOKEN'),
});

const conn = new Connection(RPC, { wsEndpoint: WS, commitment: 'confirmed' });
const seen = new Set();

console.log('[pump-graduations] starting; program=%s source=%s', PUMP_PROGRAM_ID.toBase58(), SOURCE);

if (SOURCE === 'carbon') {
	const src = new CarbonGraduationSource({ connection: conn });
	src.start(async ({ mint, signature, ts }) => {
		try {
			if (seen.has(signature)) return;
			seen.add(signature);
			if (seen.size > 5000) seen.clear();
			const enriched = await enrichToken({ signature, mint, timestamp: ts });
			await pushGraduation(enriched);
			console.log('[pump-graduations] pushed (carbon)', enriched.mint, signature);
		} catch (err) {
			console.error('[pump-graduations] handler error (carbon):', err?.message || err);
		}
	});
} else {
	conn.onLogs(
		PUMP_PROGRAM_ID,
		async (entry) => {
			try {
				if (entry.err) return;
				const sig = entry.signature;
				if (seen.has(sig)) return;
				if (!entry.logs?.some((l) => l.includes('Program data:'))) return;

				const ev = await tryParseGraduation(sig, entry.logs);
				if (!ev) return;
				seen.add(sig);
				if (seen.size > 5000) seen.clear();

				const enriched = await enrichToken(ev);
				await pushGraduation(enriched);
				console.log('[pump-graduations] pushed', enriched.symbol || enriched.mint, sig);
			} catch (err) {
				console.error('[pump-graduations] handler error:', err?.message || err);
			}
		},
		'confirmed',
	);
}

async function tryParseGraduation(sig, logs) {
	for (const line of logs) {
		const m = line.match(/^Program data: (.+)$/);
		if (!m) continue;
		let data;
		try { data = Buffer.from(m[1], 'base64'); } catch { continue; }
		if (data.length < 8) continue;
		if (!data.subarray(0, 8).equals(COMPLETE_EVENT_DISCRIMINATOR)) continue;

		// CompleteEvent layout (per Pump IDL): user(32) mint(32) bondingCurve(32) timestamp(i64)
		if (data.length < 8 + 32 + 32 + 32 + 8) continue;
		let off = 8;
		const user = bs58.encode(data.subarray(off, off + 32)); off += 32;
		const mint = bs58.encode(data.subarray(off, off + 32)); off += 32;
		const bondingCurve = bs58.encode(data.subarray(off, off + 32)); off += 32;
		const timestamp = Number(data.readBigInt64LE(off));

		return { signature: sig, mint, user, bondingCurve, timestamp };
	}
	return null;
}

async function enrichToken(ev) {
	let name, symbol, poolAddress;
	try {
		const tx = await conn.getTransaction(ev.signature, { maxSupportedTransactionVersion: 0 });
		const accounts = tx?.transaction?.message?.staticAccountKeys?.map((k) => k.toBase58()) || [];
		// PumpAMM pool keypair is created in the same tx; we can't reliably pluck it
		// without IDL decode. Leave undefined — the UI tolerates it.
		poolAddress = accounts.find((k) => k !== ev.mint && k !== ev.user) || undefined;
	} catch {}
	return {
		signature: ev.signature,
		mint: ev.mint,
		tokenName: name,
		tokenSymbol: symbol,
		poolAddress,
		timestamp: ev.timestamp || Math.floor(Date.now() / 1000),
	};
}

async function pushGraduation(ev) {
	const json = JSON.stringify(ev);
	await redis.lpush(LIST_KEY, json);
	await redis.ltrim(LIST_KEY, 0, MAX_LEN - 1);
	await redis.publish(`${LIST_KEY}:pub`, json);
}

function required(name) {
	const v = process.env[name];
	if (!v) { console.error(`missing env ${name}`); process.exit(1); }
	return v;
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
