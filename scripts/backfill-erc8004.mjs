/**
 * One-shot ERC-8004 historical backfill.
 *
 * Fetches all Registered events from the Identity Registry contract address
 * on each chain via eth_getLogs, then upserts into erc8004_agents_index.
 *
 * Usage:
 *   node scripts/backfill-erc8004.mjs
 *   node scripts/backfill-erc8004.mjs 8453 84532   # specific chain IDs only
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AbiCoder, getAddress, id as keccakId } from 'ethers';
import { neon } from '@neondatabase/serverless';

const __dir = dirname(fileURLToPath(import.meta.url));

try {
	const raw = readFileSync(resolve(__dir, '../.env.local'), 'utf8');
	for (const line of raw.split('\n')) {
		const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
	}
} catch { /* no .env.local */ }

if (!process.env.DATABASE_URL) { console.error('Missing DATABASE_URL'); process.exit(1); }

const sql = neon(process.env.DATABASE_URL);
const REGISTERED_TOPIC = keccakId('Registered(uint256,string,address)');
const ABI_CODER = AbiCoder.defaultAbiCoder();

const CHAINS = [
	{ id: 8453,     name: 'Base',             rpc: 'https://mainnet.base.org',                       registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 42161,    name: 'Arbitrum One',      rpc: 'https://arb1.arbitrum.io/rpc',                   registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 56,       name: 'BNB Chain',         rpc: 'https://bsc-dataseed.bnbchain.org',               registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 1,        name: 'Ethereum',          rpc: 'https://eth.llamarpc.com',                        registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 10,       name: 'Optimism',          rpc: 'https://mainnet.optimism.io',                     registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 137,      name: 'Polygon',           rpc: 'https://polygon-rpc.com',                         registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 43114,    name: 'Avalanche',         rpc: 'https://api.avax.network/ext/bc/C/rpc',           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 100,      name: 'Gnosis',            rpc: 'https://rpc.gnosischain.com',                     registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 250,      name: 'Fantom',            rpc: 'https://rpc.ftm.tools',                           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 42220,    name: 'Celo',              rpc: 'https://forno.celo.org',                          registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 59144,    name: 'Linea',             rpc: 'https://rpc.linea.build',                         registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 534352,   name: 'Scroll',            rpc: 'https://rpc.scroll.io',                           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 5000,     name: 'Mantle',            rpc: 'https://rpc.mantle.xyz',                          registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 324,      name: 'zkSync Era',        rpc: 'https://mainnet.era.zksync.io',                   registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 1284,     name: 'Moonbeam',          rpc: 'https://rpc.api.moonbeam.network',                registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 97,       name: 'BSC Testnet',       rpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 84532,    name: 'Base Sepolia',      rpc: 'https://sepolia.base.org',                        registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 421614,   name: 'Arbitrum Sepolia',  rpc: 'https://sepolia-rollup.arbitrum.io/rpc',           registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 11155111, name: 'Ethereum Sepolia',  rpc: 'https://rpc.sepolia.org',                         registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 11155420, name: 'Optimism Sepolia',  rpc: 'https://sepolia.optimism.io',                     registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 80002,    name: 'Polygon Amoy',      rpc: 'https://rpc-amoy.polygon.technology',             registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 43113,    name: 'Avalanche Fuji',    rpc: 'https://api.avax-test.network/ext/bc/C/rpc',      registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
];

const onlyIds = process.argv.slice(2).map(Number).filter(Boolean);
const chains = onlyIds.length ? CHAINS.filter((c) => onlyIds.includes(c.id)) : CHAINS;

async function getLogs(chain) {
	const res = await fetch(chain.rpc, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0', id: 1,
			method: 'eth_getLogs',
			params: [{ address: chain.registry, topics: [REGISTERED_TOPIC], fromBlock: '0x0', toBlock: 'latest' }],
		}),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = await res.json();
	if (body.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
	return body.result;
}

async function backfillChain(chain) {
	const logs = await getLogs(chain);
	let inserted = 0;
	let lastBlock = 0;

	for (const log of logs) {
		try {
			const agentId = BigInt(log.topics[1]).toString();
			const owner = getAddress('0x' + log.topics[2].slice(-40)).toLowerCase();
			const [agentURI] = ABI_CODER.decode(['string'], log.data);
			const blockNumber = Number(log.blockNumber);
			const registeredAt = new Date(Number(log.timeStamp) * 1000).toISOString();

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

	if (lastBlock > 0) {
		await sql`
			INSERT INTO erc8004_crawl_cursor (chain_id, last_block, updated_at)
			VALUES (${chain.id}, ${lastBlock}, now())
			ON CONFLICT (chain_id) DO UPDATE SET
				last_block = GREATEST(erc8004_crawl_cursor.last_block, excluded.last_block),
				updated_at = now()
		`;
	}

	return { found: logs.length, inserted, lastBlock };
}

console.log(`Backfilling ${chains.length} chain(s)…\n`);
for (const chain of chains) {
	process.stdout.write(`[${chain.name}] fetching logs…`);
	try {
		const { found, inserted, lastBlock } = await backfillChain(chain);
		console.log(`\r[${chain.name}] ${inserted} upserted (${found} events, last block ${lastBlock})`);
	} catch (e) {
		console.error(`\r[${chain.name}] ERROR: ${e.message}`);
	}
}
console.log('\nDone.');
