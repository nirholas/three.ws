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
 *  2. eth_getLogs via the chain's public RPC — Registered events since that block.
 *  3. Decode agentId (topic1), owner (topic2), agentURI (data) and upsert.
 *  4. Advance cursor.
 *
 * Metadata pass: pick the 20 oldest-metadata rows, fetch JSON, extract
 * name/description/image/services/has_3d, write back.
 */

import { id as keccakId, AbiCoder, getAddress } from 'ethers';
import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { CHAINS } from '../_lib/erc8004-chains.js';
import { SERVER_CHAIN_META } from '../_lib/onchain.js';

const REGISTERED_TOPIC = keccakId('Registered(uint256,string,address)');
const ABI_CODER = AbiCoder.defaultAbiCoder();

// Metadata enrichment per invocation.
const METADATA_BATCH = 25;

// Per-request timeout so one stuck chain can't eat the whole cron budget.
const FETCH_TIMEOUT_MS = 8_000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	const report = { chains: [], enriched: 0, errors: [] };

	// 1. Crawl logs chain-by-chain.
	for (const chain of CHAINS) {
		try {
			const r = await crawlChain(chain);
			report.chains.push({ chainId: chain.id, name: chain.name, ...r });
		} catch (err) {
			report.errors.push({ chainId: chain.id, error: err.message || String(err) });
		}
	}

	// 2. Enrich metadata for the oldest-seen rows.
	try {
		report.enriched = await enrichMetadata(METADATA_BATCH);
	} catch (err) {
		report.errors.push({ stage: 'metadata', error: err.message || String(err) });
	}

	return json(res, 200, report);
});

// ─── Log crawl ───────────────────────────────────────────────────────────

async function crawlChain(chain) {
	const meta = SERVER_CHAIN_META[chain.id];
	if (!meta?.rpc) return { inserted: 0, skipped: true, reason: 'no_rpc' };

	const [cursor] = await sql`
		SELECT last_block FROM erc8004_crawl_cursor WHERE chain_id = ${chain.id}
	`;
	const fromBlock = cursor ? Number(cursor.last_block) + 1 : 0;

	const latestHex = await rpc(meta.rpc, 'eth_blockNumber', []);
	const latest = Number(latestHex);
	if (fromBlock > latest) return { inserted: 0, lastBlock: latest, fromBlock };

	const logs = await rpc(meta.rpc, 'eth_getLogs', [{
		address: chain.registry,
		topics: [REGISTERED_TOPIC],
		fromBlock: '0x' + fromBlock.toString(16),
		toBlock: '0x' + latest.toString(16),
	}]);

	let lastBlock = fromBlock - 1;
	let inserted = 0;

	for (const log of logs) {
		try {
			const agentId = BigInt(log.topics[1]).toString();
			const ownerHex = '0x' + log.topics[2].slice(-40);
			const owner = getAddress(ownerHex).toLowerCase();
			const [agentURI] = ABI_CODER.decode(['string'], log.data);
			const blockNumber = Number(log.blockNumber);
			const timestamp = Number(log.timeStamp);
			const registeredAt = new Date(timestamp * 1000).toISOString();

			await sql`
				INSERT INTO erc8004_agents_index
					(chain_id, agent_id, owner, registry, agent_uri,
					 registered_block, registered_tx, registered_at, last_seen_at)
				VALUES
					(${chain.id}, ${agentId}, ${owner}, ${chain.registry.toLowerCase()},
					 ${agentURI || null}, ${blockNumber}, ${log.transactionHash},
					 ${registeredAt}, now())
				ON CONFLICT (chain_id, agent_id) DO UPDATE SET
					owner     = excluded.owner,
					agent_uri = COALESCE(excluded.agent_uri, erc8004_agents_index.agent_uri),
					last_seen_at = now()
			`;
			inserted += 1;
			if (blockNumber > lastBlock) lastBlock = blockNumber;
		} catch (decodeErr) {
			console.warn('[crawl] decode failed', chain.id, log.transactionHash, decodeErr.message);
		}
	}

	const newCursor = Math.max(lastBlock, fromBlock - 1, latest);
	await sql`
		INSERT INTO erc8004_crawl_cursor (chain_id, last_block, updated_at)
		VALUES (${chain.id}, ${newCursor}, now())
		ON CONFLICT (chain_id) DO UPDATE SET
			last_block = GREATEST(erc8004_crawl_cursor.last_block, excluded.last_block),
			updated_at = now()
	`;

	return { inserted, lastBlock: newCursor, fromBlock };
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
					SET metadata_error = 'fetch failed', last_metadata_at = now()
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

async function rpc(url, method, params) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = await res.json();
	if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
	return body.result;
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
