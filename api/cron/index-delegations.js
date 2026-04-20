/**
 * Delegation event indexer — polls each supported chain for DelegationDisabled
 * and DelegationRedeemed events, reconciles against agent_delegations, and
 * updates status / redemption_count / last_redeemed_at.
 *
 * Also sweeps expired rows (expires_at < NOW()) in a single idempotent UPDATE.
 *
 * Runs on Vercel Cron every 5 minutes (see vercel.json). Also callable manually
 * via `POST /api/cron/index-delegations` with `Authorization: Bearer $CRON_SECRET`.
 *
 * Protocol-bus note: a future enhancement can emit a lightweight DB NOTIFY after
 * a revoke sync so that task-13's runtime cache (src/runtime/delegation-redeem.js)
 * invalidates without waiting for the next cron tick. Today the cache TTL covers
 * the gap. Plumbing: NOTIFY would fire here → a LISTEN connection in a persistent
 * worker picks it up → invalidates the in-memory delegation map keyed by agentId.
 */

import { id as keccakId } from 'ethers';
import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { DELEGATION_MANAGER_DEPLOYMENTS } from '../../src/erc7710/abi.js';

const DISABLED_TOPIC = keccakId('DelegationDisabled(address,bytes32)');
const REDEEMED_TOPIC = keccakId('DelegationRedeemed(address,bytes32)');

// Max blocks per eth_getLogs call. Public RPCs 429 above ~2000.
const BLOCK_CAP = 2000;
const RPC_TIMEOUT_MS = 10_000;

// Approximate blocks per day, used only to seed the cursor on first run.
const BLOCKS_PER_DAY = {
	84532: 43200, // Base Sepolia ~2 s/block
	11155111: 7200, // Sepolia ~12 s/block
};

// Public RPC fallbacks — override per chain via env RPC_<chainId>.
const PUBLIC_RPC = {
	1: 'https://cloudflare-eth.com',
	8453: 'https://mainnet.base.org',
	84532: 'https://sepolia.base.org',
	11155111: 'https://rpc.sepolia.org',
	421614: 'https://sepolia-rollup.arbitrum.io/rpc',
	11155420: 'https://sepolia.optimism.io',
};

function rpcUrl(chainId) {
	return process.env[`RPC_${chainId}`] ?? PUBLIC_RPC[chainId] ?? null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	const started = Date.now();
	const report = { chains: [], expiredSwept: 0, errors: [] };

	// Index each chain independently — one chain's RPC failure must not abort others.
	for (const [chainIdStr, contract] of Object.entries(DELEGATION_MANAGER_DEPLOYMENTS)) {
		const chainId = Number(chainIdStr);
		const t0 = Date.now();
		try {
			const r = await indexChain(chainId, contract);
			const summary = { chainId, ...r, elapsedMs: Date.now() - t0 };
			report.chains.push(summary);
			console.error(JSON.stringify({ stage: 'index-delegations', ...summary }));
		} catch (err) {
			const entry = { chainId, error: err.message || String(err) };
			report.errors.push(entry);
			console.error(JSON.stringify({ stage: 'index-delegations', ...entry }));
		}
	}

	// Expiry sweep — idempotent, catches expirations missed between grant and indexer.
	try {
		const swept = await sql`
			UPDATE agent_delegations
			SET status = 'expired'
			WHERE status = 'active' AND expires_at < NOW()
			RETURNING id
		`;
		report.expiredSwept = swept.length;
	} catch (err) {
		report.errors.push({ stage: 'expiry-sweep', error: err.message || String(err) });
		console.error(JSON.stringify({ stage: 'expiry-sweep', error: err.message }));
	}

	// Emit summary to usage_events (best-effort — non-fatal if table shape differs).
	try {
		await sql`
			INSERT INTO usage_events (kind, tool, status, latency_ms)
			VALUES ('permissions.indexer.tick', 'index-delegations', 'ok', ${Date.now() - started})
		`;
	} catch { /* non-fatal */ }

	return json(res, 200, report);
});

// ─── Chain indexer ────────────────────────────────────────────────────────────

async function indexChain(chainId, contract) {
	const url = rpcUrl(chainId);
	if (!url) throw new Error(`no RPC URL configured for chain ${chainId}`);

	const latestHex = await rpc(url, 'eth_blockNumber', []);
	const latestBlock = parseInt(latestHex, 16);

	const [cursor] = await sql`
		SELECT last_indexed_block FROM indexer_state
		WHERE contract = ${contract.toLowerCase()} AND chain_id = ${chainId}
	`;
	const initialFrom = cursor
		? Number(cursor.last_indexed_block) + 1
		: Math.max(0, latestBlock - (BLOCKS_PER_DAY[chainId] ?? 7200));

	let fromBlock = initialFrom;
	let toBlock = latestBlock; // updated each iteration; reflects final processed range
	let revokedCount = 0;
	let redeemedCount = 0;

	while (fromBlock <= latestBlock) {
		toBlock = Math.min(fromBlock + BLOCK_CAP - 1, latestBlock);

		const logs = await rpc(url, 'eth_getLogs', [
			{
				address: contract,
				topics: [[DISABLED_TOPIC, REDEEMED_TOPIC]],
				fromBlock: '0x' + fromBlock.toString(16),
				toBlock: '0x' + toBlock.toString(16),
			},
		]);

		if (logs.length > 0) {
			// Fetch block timestamps only for blocks that have events.
			const uniqueBlocks = [...new Set(logs.map((l) => l.blockNumber))];
			const blockTs = {};
			for (const bn of uniqueBlocks) {
				const block = await rpc(url, 'eth_getBlockByNumber', [bn, false]);
				blockTs[bn] = new Date(parseInt(block.timestamp, 16) * 1000).toISOString();
			}

			for (const log of logs) {
				// topics[2] is the bytes32 delegationHash (indexed param, 0x-prefixed, 64 hex chars).
				const delegationHash = log.topics[2];
				const ts = blockTs[log.blockNumber];

				if (log.topics[0] === DISABLED_TOPIC) {
					const rows = await sql`
						UPDATE agent_delegations
						SET status = 'revoked',
						    revoked_at = ${ts}::timestamptz,
						    tx_hash_revoke = ${log.transactionHash}
						WHERE delegation_hash = ${delegationHash} AND status = 'active'
						RETURNING id
					`;
					revokedCount += rows.length;
				} else {
					const rows = await sql`
						UPDATE agent_delegations
						SET redemption_count = redemption_count + 1,
						    last_redeemed_at = ${ts}::timestamptz
						WHERE delegation_hash = ${delegationHash}
						RETURNING id
					`;
					redeemedCount += rows.length;
				}
			}
		}

		// Advance cursor after each batch so a timeout preserves partial progress.
		await sql`
			INSERT INTO indexer_state (contract, chain_id, last_indexed_block, updated_at)
			VALUES (${contract.toLowerCase()}, ${chainId}, ${toBlock}, NOW())
			ON CONFLICT (contract, chain_id) DO UPDATE SET
				last_indexed_block = GREATEST(indexer_state.last_indexed_block, excluded.last_indexed_block),
				updated_at = NOW()
		`;

		fromBlock = toBlock + 1;
	}

	return { fromBlock: initialFrom, toBlock, revokedCount, redeemedCount };
}

// ─── RPC helper ──────────────────────────────────────────────────────────────

async function rpc(url, method, params) {
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), RPC_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			signal: ac.signal,
		});
		if (!res.ok) throw new Error(`RPC HTTP ${res.status} from ${url}`);
		const data = await res.json();
		if (data.error) {
			throw new Error(`RPC ${method} error: ${data.error.message ?? JSON.stringify(data.error)}`);
		}
		return data.result;
	} finally {
		clearTimeout(t);
	}
}
