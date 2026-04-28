/**
 * One-shot ERC-8004 historical backfill.
 *
 * Fetches all Registered events from the Identity Registry contract on each
 * chain via eth_getLogs. Uses Alchemy when ALCHEMY_API_KEY is set (recommended
 * — no block range limits), falls back to public RPCs otherwise.
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
const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;

// Alchemy network slugs for supported chains. Others fall back to publicRpc.
const ALCHEMY_SLUGS = {
	1:        'eth-mainnet',
	10:       'opt-mainnet',
	137:      'polygon-mainnet',
	324:      'zksync-mainnet',
	8453:     'base-mainnet',
	42161:    'arb-mainnet',
	43114:    'avax-mainnet',
	59144:    'linea-mainnet',
	534352:   'scroll-mainnet',
	11155111: 'eth-sepolia',
	11155420: 'opt-sepolia',
	80002:    'polygon-amoy',
	84532:    'base-sepolia',
	421614:   'arb-sepolia',
};

const CHAINS = [
	{ id: 8453,     name: 'Base',             publicRpc: 'https://base-rpc.publicnode.com',                 registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 42161,    name: 'Arbitrum One',      publicRpc: 'https://arb1.arbitrum.io/rpc',                   registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 56,       name: 'BNB Chain',         publicRpc: 'https://bsc-dataseed.bnbchain.org',               registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 1,        name: 'Ethereum',          publicRpc: 'https://eth.llamarpc.com',                        registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 10,       name: 'Optimism',          publicRpc: 'https://mainnet.optimism.io',                     registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 137,      name: 'Polygon',           publicRpc: 'https://polygon-rpc.com',                         registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 43114,    name: 'Avalanche',         publicRpc: 'https://api.avax.network/ext/bc/C/rpc',           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 100,      name: 'Gnosis',            publicRpc: 'https://rpc.gnosischain.com',                     registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 250,      name: 'Fantom',            publicRpc: 'https://rpc.ftm.tools',                           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 42220,    name: 'Celo',              publicRpc: 'https://forno.celo.org',                          registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 59144,    name: 'Linea',             publicRpc: 'https://rpc.linea.build',                         registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 534352,   name: 'Scroll',            publicRpc: 'https://rpc.scroll.io',                           registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 5000,     name: 'Mantle',            publicRpc: 'https://rpc.mantle.xyz',                          registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 324,      name: 'zkSync Era',        publicRpc: 'https://mainnet.era.zksync.io',                   registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 1284,     name: 'Moonbeam',          publicRpc: 'https://rpc.api.moonbeam.network',                registry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' },
	{ id: 97,       name: 'BSC Testnet',       publicRpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 84532,    name: 'Base Sepolia',      publicRpc: 'https://sepolia.base.org',                        registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 421614,   name: 'Arbitrum Sepolia',  publicRpc: 'https://sepolia-rollup.arbitrum.io/rpc',           registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 11155111, name: 'Ethereum Sepolia',  publicRpc: 'https://rpc.sepolia.org',                         registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 11155420, name: 'Optimism Sepolia',  publicRpc: 'https://sepolia.optimism.io',                     registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 80002,    name: 'Polygon Amoy',      publicRpc: 'https://rpc-amoy.polygon.technology',             registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
	{ id: 43113,    name: 'Avalanche Fuji',    publicRpc: 'https://api.avax-test.network/ext/bc/C/rpc',      registry: '0x8004A818BFB912233c491871b3d84c89A494BD9e' },
];

// Alchemy free tier limits eth_getLogs to 10 blocks — useless for a backfill.
// Use public RPCs for scanning; Alchemy is better suited for the live cron.
function rpcUrl(chain) {
	return chain.publicRpc;
}

async function jsonRpc(url, method, params) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		signal: AbortSignal.timeout(30_000),
	});
	// Always try to parse JSON — some RPCs return a JSON-RPC error body with a non-200 status.
	let body;
	try { body = await res.json(); } catch { throw new Error(`HTTP ${res.status}`); }
	if (body?.error) throw new Error(`RPC ${body.error.code}: ${body.error.message}`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return body.result;
}

function alchemyUrl(chain) {
	if (ALCHEMY_KEY && ALCHEMY_SLUGS[chain.id]) {
		return `https://${ALCHEMY_SLUGS[chain.id]}.g.alchemy.com/v2/${ALCHEMY_KEY}`;
	}
	return chain.publicRpc;
}

async function findDeployBlock(chain) {
	// Use Alchemy for binary search — eth_getCode has no range limit on free tier.
	const url = alchemyUrl(chain);
	const latestHex = await jsonRpc(url, 'eth_blockNumber', []);
	const latest = Number(latestHex);
	const hasCode = async (block) => {
		const code = await jsonRpc(url, 'eth_getCode', [chain.registry, '0x' + block.toString(16)]);
		return code && code !== '0x';
	};
	if (!(await hasCode(latest))) return null;
	let lo = 0, hi = latest;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (await hasCode(mid)) hi = mid; else lo = mid + 1;
	}
	return lo;
}

async function getLogs(chain) {
	const url = chain.publicRpc;

	process.stdout.write(' detecting deploy block…');
	const deployBlock = await findDeployBlock(chain);
	if (deployBlock === null) {
		process.stdout.write(' not deployed, skipping.');
		return [];
	}

	const filter = { address: chain.registry, topics: [REGISTERED_TOPIC], fromBlock: '0x' + deployBlock.toString(16), toBlock: 'latest' };

	try {
		return await jsonRpc(url, 'eth_getLogs', [filter]);
	} catch (e) {
		const isRangeErr = /range|limit/i.test(e.message) && !/HTTP/.test(e.message);
		if (!isRangeErr) throw e;

		// RPC caps block range — chunk from deploy block.
		const match = e.message.match(/([\d,_]+)\s*(?:block|range)/i);
		const chunkSize = match ? parseInt(match[1].replace(/[,_]/g, ''), 10) : 2000;
		const latestHex = await jsonRpc(url, 'eth_blockNumber', []);
		const latest = Number(latestHex);
		const span = latest - deployBlock;
		const logs = [];
		for (let from = deployBlock; from <= latest; from += chunkSize) {
			const to = Math.min(from + chunkSize - 1, latest);
			let retries = 3;
			while (retries-- > 0) {
				try {
					const chunk = await jsonRpc(url, 'eth_getLogs', [{
						...filter,
						fromBlock: '0x' + from.toString(16),
						toBlock: '0x' + to.toString(16),
					}]);
					logs.push(...chunk);
					break;
				} catch (re) {
					if (/rate.limit|429/i.test(re.message) && retries > 0) {
						await new Promise(r => setTimeout(r, 1500));
					} else throw re;
				}
			}
			await new Promise(r => setTimeout(r, 150));
			process.stdout.write(`\r  chunking ${Math.round((from - deployBlock) / span * 100)}%… `);
		}
		return logs;
	}

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
			const blockNumber = Number(log.blockNumber); // hex string from RPC
			const registeredAt = null; // eth_getLogs has no timestamp; cron enriches later

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
			if (blockNumber > lastBlock) lastBlock = blockNumber;  // always track even on skip
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

const onlyIds = process.argv.slice(2).map(Number).filter(Boolean);
const chains = onlyIds.length ? CHAINS.filter((c) => onlyIds.includes(c.id)) : CHAINS;

console.log(`Backfilling ${chains.length} chain(s) ${ALCHEMY_KEY ? '(Alchemy)' : '(public RPCs)'}…\n`);
for (const chain of chains) {
	const via = ALCHEMY_KEY && ALCHEMY_SLUGS[chain.id] ? 'alchemy' : 'public';
	process.stdout.write(`[${chain.name}] fetching via ${via}…`);
	try {
		const { found, inserted, lastBlock } = await backfillChain(chain);
		console.log(`\r[${chain.name}] ${inserted} upserted (${found} events, last block ${lastBlock})        `);
	} catch (e) {
		console.error(`\r[${chain.name}] ERROR: ${e.message}                              `);
	}
}
console.log('\nDone.');
