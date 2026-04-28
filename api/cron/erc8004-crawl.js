/**
 * ERC-8004 directory crawler — indexes every `Registered` event from every
 * chain in CHAINS into the `erc8004_agents_index` table, then enriches a
 * batch of rows with their agentURI metadata (name, image, GLB, services).
 *
 * Runs on Vercel Cron every 15 minutes (see vercel.json crons). Also callable
 * manually via `POST /api/cron/erc8004-crawl` with `Authorization: Bearer
 * $CRON_SECRET` for on-demand refreshes.
 *
 * Flow per chain:
 *  1. Read last scanned block from erc8004_crawl_cursor.
 *  2. eth_getLogs over the next BLOCK_CHUNK blocks via the chain's public RPC.
 *  3. Decode agentId (topic1), owner (topic2), agentURI (data) and upsert.
 *  4. Fetch block timestamps for events found (eth_getBlockByNumber).
 *  5. Advance cursor to end of scanned range.
 *
 * Metadata pass: pick the 20 oldest-metadata rows, fetch JSON, extract
 * name/description/image/services/has_3d, write back.
 */

import { id as keccakId, AbiCoder, getAddress } from 'ethers';
import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { CHAINS } from '../_lib/erc8004-chains.js';

const REGISTERED_TOPIC = keccakId('Registered(uint256,string,address)');
const ABI_CODER = AbiCoder.defaultAbiCoder();

// Blocks scanned per chain per cron invocation. Public RPCs typically allow
// 2000-block ranges; lower this if a chain's RPC rejects with "block range".
const BLOCK_CHUNK = 2_000;

// On first run (no cursor), scan this many recent blocks. Set
// ERC8004_CRAWL_LOOKBACK env var to override (e.g. larger for backfill).
const DEFAULT_LOOKBACK = parseInt(process.env.ERC8004_CRAWL_LOOKBACK || '50000', 10);

// Metadata enrichment per invocation.
const METADATA_BATCH = 25;

const FETCH_TIMEOUT_MS = 10_000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	const report = { chains: [], enriched: 0, errors: [] };

	for (const chain of CHAINS) {
		try {
			const r = await crawlChain(chain);
			report.chains.push({ chainId: chain.id, name: chain.name, ...r });
		} catch (err) {
			report.errors.push({ chainId: chain.id, error: err.message || String(err) });
		}
	}

	try {
		report.enriched = await enrichMetadata(METADATA_BATCH);
	} catch (err) {
		report.errors.push({ stage: 'metadata', error: err.message || String(err) });
	}

	return json(res, 200, report);
});

// ─── Log crawl ───────────────────────────────────────────────────────────

async function crawlChain(chain) {
	const [cursor] = await sql`
		SELECT last_block FROM erc8004_crawl_cursor WHERE chain_id = ${chain.id}
	`;

	const latestHex = await rpcCall(chain.rpcUrl, 'eth_blockNumber', []);
	const latestBlock = Number.parseInt(latestHex, 16);

	const fromBlock = cursor
		? Number(cursor.last_block) + 1
		: Math.max(0, latestBlock - DEFAULT_LOOKBACK);

	if (fromBlock > latestBlock) {
		return { inserted: 0, scanned: 0, lastBlock: latestBlock, fromBlock };
	}

	const toBlock = Math.min(fromBlock + BLOCK_CHUNK - 1, latestBlock);

	const logs = await rpcCall(chain.rpcUrl, 'eth_getLogs', [
		{
			address: chain.registry,
			topics: [REGISTERED_TOPIC],
			fromBlock: '0x' + fromBlock.toString(16),
			toBlock: '0x' + toBlock.toString(16),
		},
	]);

	// Fetch block timestamps for any blocks that produced events.
	const blockTimes = {};
	if (logs.length > 0) {
		const uniqueBlockHexes = [...new Set(logs.map((l) => l.blockNumber))];
		await Promise.all(
			uniqueBlockHexes.map(async (bn) => {
				try {
					const block = await rpcCall(chain.rpcUrl, 'eth_getBlockByNumber', [bn, false]);
					blockTimes[bn] = block ? Number.parseInt(block.timestamp, 16) : null;
				} catch {
					// registered_at will be null for this block
				}
			}),
		);
	}

	let inserted = 0;
	for (const log of logs) {
		try {
			const agentId = BigInt(log.topics[1]).toString();
			const ownerHex = '0x' + log.topics[2].slice(-40);
			const owner = getAddress(ownerHex).toLowerCase();
			const [agentURI] = ABI_CODER.decode(['string'], log.data);
			const blockNumber = Number.parseInt(log.blockNumber, 16);
			const ts = blockTimes[log.blockNumber];
			const registeredAt = ts ? new Date(ts * 1000).toISOString() : null;

			await sql`
				INSERT INTO erc8004_agents_index
					(chain_id, agent_id, owner, registry, agent_uri,
					 registered_block, registered_tx, registered_at, last_seen_at)
				VALUES
					(${chain.id}, ${agentId}, ${owner}, ${chain.registry.toLowerCase()},
					 ${agentURI || null}, ${blockNumber}, ${log.transactionHash},
					 ${registeredAt}, now())
				ON CONFLICT (chain_id, agent_id) DO UPDATE SET
					owner = excluded.owner,
					agent_uri = COALESCE(excluded.agent_uri, erc8004_agents_index.agent_uri),
					last_seen_at = now()
			`;
			inserted += 1;
		} catch (decodeErr) {
			console.warn('[crawl] decode failed', chain.id, log.transactionHash, decodeErr.message);
		}
	}

	// Always advance cursor to toBlock so the next run continues from here.
	await sql`
		INSERT INTO erc8004_crawl_cursor (chain_id, last_block, updated_at)
		VALUES (${chain.id}, ${toBlock}, now())
		ON CONFLICT (chain_id) DO UPDATE SET
			last_block = GREATEST(erc8004_crawl_cursor.last_block, ${toBlock}),
			updated_at = now()
	`;

	return { inserted, scanned: toBlock - fromBlock + 1, lastBlock: toBlock, fromBlock };
}

// ─── Metadata enrichment ─────────────────────────────────────────────────

async function enrichMetadata(limit) {
	const rows = await sql`
		SELECT chain_id, agent_id, agent_uri
		FROM erc8004_agents_index
		WHERE agent_uri IS NOT NULL
		  AND (last_metadata_at IS NULL OR last_metadata_at < now() - interval '7 days')
		ORDER BY last_metadata_at NULLS FIRST, registered_at DESC NULLS LAST
		LIMIT ${limit}
	`;

	let done = 0;
	for (const row of rows) {
		try {
			const meta = await fetchAgentMetadata(row.agent_uri);
			if (!meta) {
				await sql`
					UPDATE erc8004_agents_index
					SET metadata_error = 'fetch failed',
					    last_metadata_at = now()
					WHERE chain_id = ${row.chain_id} AND agent_id = ${row.agent_id}
				`;
				continue;
			}
			const name = truncate(meta.name || '', 200);
			const description = truncate(meta.description || '', 1000);
			const image = resolveGateway(meta.image || '');
			const services = Array.isArray(meta.services) ? meta.services : [];
			const avatarSvc = services.find(
				(s) => String(s?.name || '').toLowerCase() === 'avatar' && s?.endpoint,
			);
			const glbUrl = avatarSvc ? resolveGateway(avatarSvc.endpoint) : null;
			const has3d = !!glbUrl;
			const active = meta.active !== false;
			const x402 = !!(meta.x402Support || meta.x402);

			await sql`
				UPDATE erc8004_agents_index
				SET name = ${name || null},
				    description = ${description || null},
				    image = ${image || null},
				    glb_url = ${glbUrl},
				    services = ${JSON.stringify(services)}::jsonb,
				    has_3d = ${has3d},
				    active = ${active},
				    x402_support = ${x402},
				    metadata_error = null,
				    last_metadata_at = now()
				WHERE chain_id = ${row.chain_id} AND agent_id = ${row.agent_id}
			`;
			done += 1;
		} catch (err) {
			await sql`
				UPDATE erc8004_agents_index
				SET metadata_error = ${truncate(err.message || String(err), 500)},
				    last_metadata_at = now()
				WHERE chain_id = ${row.chain_id} AND agent_id = ${row.agent_id}
			`;
		}
	}
	return done;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function rpcCall(url, method, params) {
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			signal: ac.signal,
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		if (data.error) throw new Error(`RPC ${data.error.code}: ${data.error.message}`);
		return data.result;
	} finally {
		clearTimeout(t);
	}
}

async function fetchAgentMetadata(uri) {
	const url = resolveGateway(uri);
	if (!url) return null;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

function resolveGateway(uri) {
	if (!uri || typeof uri !== 'string') return '';
	if (uri.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + uri.slice(7);
	if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
	if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
	return '';
}

function truncate(s, max) {
	if (!s) return '';
	return s.length > max ? s.slice(0, max) : s;
}
