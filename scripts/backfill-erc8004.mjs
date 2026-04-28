/**
 * One-shot ERC-8004 historical backfill script.
 *
 * Reads DATABASE_URL and ETHERSCAN_API_KEY from .env.local (or process.env).
 * Scans every Registered event from block 0 on every chain and upserts into
 * erc8004_agents_index, then advances the crawl cursor.
 *
 * Usage:
 *   node scripts/backfill-erc8004.mjs
 *   node scripts/backfill-erc8004.mjs 8453 84532   # specific chain IDs only
 *
 * Set ETHERSCAN_API_KEY in .env.local or export it before running.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AbiCoder, getAddress, id as keccakId } from 'ethers';
import { neon } from '@neondatabase/serverless';

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env.local
try {
	const raw = readFileSync(resolve(__dir, '../.env.local'), 'utf8');
	for (const line of raw.split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
	}
} catch {
	/* no .env.local — rely on process.env */
}

const DATABASE_URL = process.env.DATABASE_URL;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

if (!DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }
if (!ETHERSCAN_API_KEY) { console.error('Missing ETHERSCAN_API_KEY'); process.exit(1); }

const sql = neon(DATABASE_URL);

const REGISTERED_TOPIC = keccakId('Registered(uint256,string,address)');
const ABI_CODER = AbiCoder.defaultAbiCoder();
const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api';
const PAGE_SIZE = 1000;

const CHAINS = [
	{ id: 8453,     name: 'Base',              registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 42161,    name: 'Arbitrum One',       registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 56,       name: 'BNB Chain',          registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 1,        name: 'Ethereum',           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 10,       name: 'Optimism',           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 137,      name: 'Polygon',            registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 43114,    name: 'Avalanche',          registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 100,      name: 'Gnosis',             registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 250,      name: 'Fantom',             registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 42220,    name: 'Celo',               registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 59144,    name: 'Linea',              registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 534352,   name: 'Scroll',             registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 5000,     name: 'Mantle',             registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 324,      name: 'zkSync Era',         registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 1284,     name: 'Moonbeam',           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 97,       name: 'BSC Testnet',        registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 84532,    name: 'Base Sepolia',       registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 421614,   name: 'Arbitrum Sepolia',   registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 11155111, name: 'Ethereum Sepolia',   registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 11155420, name: 'Optimism Sepolia',   registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 80002,    name: 'Polygon Amoy',       registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 43113,    name: 'Avalanche Fuji',     registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
];

const onlyIds = process.argv.slice(2).map(Number).filter(Boolean);
const chains = onlyIds.length ? CHAINS.filter((c) => onlyIds.includes(c.id)) : CHAINS;

async function fetchJson(url) {
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

async function backfillChain(chain) {
	let page = 1;
	let inserted = 0;
	let lastBlock = 0;

	while (true) {
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
		url.searchParams.set('apikey', ETHERSCAN_API_KEY);

		const body = await fetchJson(url.toString());

		if (body.status === '0' && /no records/i.test(body.message || '')) break;
		if (body.status !== '1' || !Array.isArray(body.result)) {
			throw new Error(`etherscan ${chain.id} p${page}: ${body.message} — ${String(body.result).slice(0, 80)}`);
		}

		for (const log of body.result) {
			try {
				const agentId = BigInt(log.topics[1]).toString();
				const owner = getAddress('0x' + log.topics[2].slice(-40)).toLowerCase();
				const [agentURI] = ABI_CODER.decode(['string'], log.data);
				const blockNumber = Number.parseInt(log.blockNumber, 16);
				const registeredAt = new Date(Number.parseInt(log.timeStamp, 16) * 1000).toISOString();

				await sql`
					INSERT INTO erc8004_agents_index
						(chain_id, agent_id, owner, registry, agent_uri,
						 registered_block, registered_tx, registered_at, last_seen_at)
					VALUES
						(${chain.id}, ${agentId}, ${owner}, ${chain.registry.toLowerCase()},
						 ${agentURI || null}, ${blockNumber}, ${log.transactionHash},
						 ${registeredAt}, now())
					ON CONFLICT (chain_id, agent_id) DO UPDATE SET
						owner        = excluded.owner,
						agent_uri    = COALESCE(excluded.agent_uri, erc8004_agents_index.agent_uri),
						last_seen_at = now()
				`;
				inserted++;
				if (blockNumber > lastBlock) lastBlock = blockNumber;
			} catch (e) {
				console.warn(`  skip ${log.transactionHash}: ${e.message}`);
			}
		}

		process.stdout.write(`\r  page ${page} — ${inserted} upserted`);

		if (body.result.length < PAGE_SIZE) break;
		page++;
	}

	if (lastBlock > 0) {
		await sql`
			INSERT INTO erc8004_crawl_cursor (chain_id, last_block, updated_at)
			VALUES (${chain.id}, ${lastBlock}, now())
			ON CONFLICT (chain_id) DO UPDATE SET
				last_block = GREATEST(erc8004_crawl_cursor.last_block, excluded.last_block),
				updated_at = now()
		`;
	}

	return { inserted, pages: page, lastBlock };
}

console.log(`Backfilling ${chains.length} chain(s)…\n`);
for (const chain of chains) {
	process.stdout.write(`[${chain.name} (${chain.id})] scanning…`);
	try {
		const { inserted, pages, lastBlock } = await backfillChain(chain);
		console.log(`\r[${chain.name}] done — ${inserted} rows, ${pages} page(s), last block ${lastBlock}`);
	} catch (e) {
		console.error(`\r[${chain.name}] ERROR: ${e.message}`);
	}
}
console.log('\nDone.');
