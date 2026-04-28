/**
 * One-shot historical backfill for the ERC-8004 agent index.
 *
 * Scans every Registered event from block 0 to latest on every configured
 * chain using Etherscan V2 getLogs, paging through all results.
 *
 * Usage:
 *   POST /api/cron/erc8004-backfill
 *   Authorization: Bearer $CRON_SECRET
 *
 * Optional body: { chainIds: [8453, 84532] }  — limit to specific chains.
 * Optional query: ?reset=1  — clear cursors first so the regular cron also
 *   re-scans from block 0 (use with care on prod).
 */

import { id as keccakId, AbiCoder, getAddress } from 'ethers';
import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { CHAINS } from '../_lib/erc8004-chains.js';

const REGISTERED_TOPIC = keccakId('Registered(uint256,string,address)');
const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api';
const ABI_CODER = AbiCoder.defaultAbiCoder();

const PAGE_SIZE = 1000; // Etherscan V2 max offset
const FETCH_TIMEOUT_MS = 12_000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : null;
	if (expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}
	if (!env.ETHERSCAN_API_KEY) {
		return error(res, 500, 'missing_env', 'ETHERSCAN_API_KEY not configured');
	}

	let body = {};
	try {
		if (req.headers['content-type']?.includes('application/json')) {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			body = JSON.parse(Buffer.concat(chunks).toString());
		}
	} catch {
		/* no body — fine */
	}

	const resetCursors = req.query?.reset === '1' || body.reset === true;
	const onlyChains = Array.isArray(body.chainIds) ? new Set(body.chainIds.map(Number)) : null;
	const chains = onlyChains ? CHAINS.filter((c) => onlyChains.has(c.id)) : CHAINS;

	if (chains.length === 0) {
		return error(res, 400, 'bad_request', 'no matching chains');
	}

	if (resetCursors) {
		const ids = chains.map((c) => c.id);
		await sql`DELETE FROM erc8004_crawl_cursor WHERE chain_id = ANY(${ids})`;
	}

	const report = { chains: [], errors: [] };

	for (const chain of chains) {
		try {
			const r = await backfillChain(chain);
			report.chains.push({ chainId: chain.id, name: chain.name, ...r });
		} catch (err) {
			report.errors.push({ chainId: chain.id, name: chain.name, error: err.message || String(err) });
		}
	}

	return json(res, 200, report);
});

async function backfillChain(chain) {
	let page = 1;
	let inserted = 0;
	let lastBlock = 0;
	let hasMore = true;

	while (hasMore) {
		const url = new URL(ETHERSCAN_BASE);
		url.searchParams.set('chainid', String(chain.id));
		url.searchParams.set('module', 'logs');
		url.searchParams.set('action', 'getLogs');
		url.searchParams.set('address', chain.registry);
		url.searchParams.set('topic0', REGISTERED_TOPIC);
		url.searchParams.set('fromBlock', '0');
		url.searchParams.set('toBlock', 'latest');
		url.searchParams.set('page', String(page));
		url.searchParams.set('offset', String(PAGE_SIZE));
		url.searchParams.set('apikey', env.ETHERSCAN_API_KEY);

		const body = await fetchJson(url.toString());

		if (body.status === '0' && /no records/i.test(body.message || '')) {
			break;
		}
		if (body.status !== '1' || !Array.isArray(body.result)) {
			throw new Error(`etherscan ${chain.id} page ${page}: ${body.message || 'unknown'}`);
		}

		for (const log of body.result) {
			try {
				const agentId = BigInt(log.topics[1]).toString();
				const ownerHex = '0x' + log.topics[2].slice(-40);
				const owner = getAddress(ownerHex).toLowerCase();
				const [agentURI] = ABI_CODER.decode(['string'], log.data);
				const blockNumber = Number.parseInt(log.blockNumber, 16);
				const timestamp = Number.parseInt(log.timeStamp, 16);
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
						owner            = excluded.owner,
						agent_uri        = COALESCE(excluded.agent_uri, erc8004_agents_index.agent_uri),
						last_seen_at     = now()
				`;
				inserted += 1;
				if (blockNumber > lastBlock) lastBlock = blockNumber;
			} catch (decodeErr) {
				console.warn('[backfill] decode failed', chain.id, log.transactionHash, decodeErr.message);
			}
		}

		// Fewer results than page size means we've reached the end.
		hasMore = body.result.length === PAGE_SIZE;
		page += 1;
	}

	// Advance the cron cursor so the regular crawler resumes from here.
	if (lastBlock > 0) {
		await sql`
			INSERT INTO erc8004_crawl_cursor (chain_id, last_block, updated_at)
			VALUES (${chain.id}, ${lastBlock}, now())
			ON CONFLICT (chain_id) DO UPDATE SET
				last_block = GREATEST(erc8004_crawl_cursor.last_block, excluded.last_block),
				updated_at = now()
		`;
	}

	return { inserted, pages: page - 1, lastBlock };
}

async function fetchJson(url) {
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(url, { signal: ac.signal });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.json();
	} finally {
		clearTimeout(t);
	}
}
