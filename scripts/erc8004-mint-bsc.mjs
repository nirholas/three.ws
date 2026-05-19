#!/usr/bin/env node
// scripts/erc8004-mint-bsc.mjs
//
// Mint ERC-8004 agent identities on BNB Smart Chain (chain 56) using the
// canonical IdentityRegistry deployment at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432.
// Pairs with the BSC x402 work in api/_lib/x402-bsc-direct.js — every mint here
// is a real tx on the same chain that the /pay demo settles payments on.
//
// One-off mode:
//   node scripts/erc8004-mint-bsc.mjs \
//     --name "Three.ws Aria"        \
//     --description "Lead community agent — onboards new visitors." \
//     --image  https://three.ws/agents/aria/avatar.png   \
//     --website https://three.ws/m/aria
//
// Bulk mode (queries agent_identities via DATABASE_URL):
//   node scripts/erc8004-mint-bsc.mjs --from-db --limit 50
//
// Required env:
//   BSC_OPERATOR_KEY        hex private key (0x… or raw) of the EOA that signs
//                            register() — must hold BNB for gas. The minted
//                            NFTs are owned by this address until transferred.
// Optional env:
//   RPC_URL_56               BSC RPC; defaults to https://bsc-dataseed.binance.org
//   PUBLIC_APP_ORIGIN        used to build agentURI links; defaults to https://three.ws
//   DATABASE_URL             required for --from-db
//   DRY_RUN=1                same as --dry-run

import process from 'node:process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ethers } from 'ethers';

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const CHAIN_ID = 56;

const IDENTITY_REGISTRY_ABI = [
	'function register(string agentURI) external returns (uint256 agentId)',
	'function totalSupply() external view returns (uint256)',
	'function tokenURI(uint256 tokenId) external view returns (string)',
	'function ownerOf(uint256 tokenId) external view returns (address)',
	'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const LEDGER_PATH = resolve(REPO_ROOT, 'data/erc8004-bsc-mint-ledger.json');

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') args.dryRun = true;
		else if (a === '--from-db') args.fromDb = true;
		else if (a === '--yes') args.yes = true;
		else if (a.startsWith('--')) {
			const key = a.slice(2);
			const val = argv[i + 1];
			if (val !== undefined && !val.startsWith('--')) {
				args[key] = val;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

function loadEnv() {
	// Best-effort .env loader — used so the script picks up the same vars the
	// Vite dev proxy uses without making @vercel/cli or dotenv a hard dep.
	const path = resolve(REPO_ROOT, '.env');
	if (!existsSync(path)) return;
	const text = readFileSync(path, 'utf8');
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		let val = line.slice(eq + 1).trim();
		if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
			val = val.slice(1, -1);
		}
		if (process.env[key] === undefined) process.env[key] = val;
	}
}

function loadLedger() {
	if (!existsSync(LEDGER_PATH)) return { mints: [] };
	try {
		return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
	} catch {
		return { mints: [] };
	}
}

function appendLedger(entry) {
	const ledger = loadLedger();
	ledger.mints.push({ ...entry, at: new Date().toISOString() });
	mkdirSync(dirname(LEDGER_PATH), { recursive: true });
	writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
}

function ledgerHas({ chainId, sourceId }) {
	if (!sourceId) return false;
	const ledger = loadLedger();
	return ledger.mints.some((m) => m.chainId === chainId && m.sourceId === sourceId);
}

function buildAgentURI(agent) {
	// ERC-8004 agentURI must resolve to a metadata JSON. Order of preference:
	//   1. --uri/agent.uri  → caller-supplied URL (ipfs://, ar://, https://…)
	//   2. agent.website   → for one-off mints with a stable HTML page that
	//                         also serves JSON via content-negotiation
	//   3. data:application/json;base64,<…>  → inline, fully self-contained;
	//      heavier calldata (~16 gas/byte) but no external dependency. Used
	//      until /api/agents/<id>/erc8004 ships as a canonical resolver.
	if (agent.uri) return agent.uri;
	if (agent.website) return agent.website;
	const origin = (process.env.PUBLIC_APP_ORIGIN || 'https://three.ws').replace(/\/$/, '');
	const meta = {
		name: agent.name,
		description: agent.description || '',
		image: agent.image || '',
		website: agent.sourceId ? `${origin}/m/agent/${agent.sourceId}` : origin,
		schema: 'erc-8004',
	};
	const b64 = Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');
	return `data:application/json;base64,${b64}`;
}

async function fetchAgentsFromDb(limit) {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('--from-db requires DATABASE_URL');
	const { neon } = await import('@neondatabase/serverless').catch(async () => {
		// Fallback to postgres.js — already a dep of the project.
		const pg = await import('postgres');
		const sql = pg.default(url, { ssl: 'require' });
		return {
			neon: () => async (strings, ...values) => {
				return sql(strings, ...values);
			},
		};
	});
	const sql = typeof neon === 'function' ? neon(url) : neon;
	const rows = await sql`
		SELECT ai.id, ai.name, ai.description, ai.category, av.thumbnail_key
		FROM agent_identities ai
		LEFT JOIN avatars av ON av.id = ai.avatar_id AND av.deleted_at IS NULL
		WHERE ai.is_published = true
		  AND ai.deleted_at IS NULL
		ORDER BY ai.published_at DESC NULLS LAST
		LIMIT ${limit}
	`;
	const publicDomain = (process.env.S3_PUBLIC_DOMAIN || '').replace(/\/$/, '');
	return rows.map((r) => ({
		sourceId: r.id,
		name: r.name,
		description: r.description,
		image: r.thumbnail_key && publicDomain ? `${publicDomain}/${r.thumbnail_key}` : '',
	}));
}

async function mintOne(contract, wallet, agent, opts) {
	const agentURI = buildAgentURI(agent);
	if (ledgerHas({ chainId: CHAIN_ID, sourceId: agent.sourceId })) {
		console.log(`[skip] ${agent.name} — already in ledger for chain ${CHAIN_ID}`);
		return null;
	}

	console.log(`[mint] ${agent.name}`);
	console.log(`        agentURI: ${agentURI.length > 80 ? agentURI.slice(0, 77) + '…' : agentURI}`);

	const fn = contract.getFunction('register(string)');
	if (opts.dryRun) {
		const gas = await fn.estimateGas(agentURI);
		console.log(`        [dry-run] est. gas = ${gas.toString()}`);
		return { dryRun: true, gas: gas.toString() };
	}

	const tx = await fn.send(agentURI);
	console.log(`        tx: https://bscscan.com/tx/${tx.hash}`);
	const receipt = await tx.wait();
	if (!receipt || receipt.status !== 1) {
		throw new Error(`tx ${tx.hash} did not succeed (status ${receipt?.status})`);
	}

	const iface = contract.interface;
	let agentId = null;
	let owner = null;
	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
		try {
			const parsed = iface.parseLog(log);
			if (parsed.name === 'Registered') {
				agentId = parsed.args.agentId.toString();
				owner = parsed.args.owner;
				break;
			}
		} catch {
			// not our event
		}
	}
	if (!agentId) throw new Error(`Registered event not found in tx ${tx.hash}`);

	const gasUsed = receipt.gasUsed?.toString?.() ?? null;
	const effectiveGasPrice = receipt.gasPrice?.toString?.() ?? receipt.effectiveGasPrice?.toString?.() ?? null;
	const gasCostWei =
		gasUsed && effectiveGasPrice ? (BigInt(gasUsed) * BigInt(effectiveGasPrice)).toString() : null;

	console.log(`        agentId: ${agentId}  owner: ${owner}  gas: ${gasUsed}`);

	appendLedger({
		chainId: CHAIN_ID,
		sourceId: agent.sourceId || null,
		agentId,
		owner,
		agentURI,
		txHash: tx.hash,
		blockNumber: receipt.blockNumber,
		gasUsed,
		gasCostWei,
	});

	return { agentId, owner, txHash: tx.hash, gasUsed, gasCostWei };
}

async function main() {
	loadEnv();
	const args = parseArgs(process.argv);
	const dryRun = !!args.dryRun || process.env.DRY_RUN === '1';

	const pk = process.env.BSC_OPERATOR_KEY;
	if (!pk) {
		console.error('error: BSC_OPERATOR_KEY env var is required (hex private key of the operator EOA).');
		process.exit(1);
	}
	const rpc = process.env.RPC_URL_56 || 'https://bsc-dataseed.binance.org';
	const provider = new ethers.JsonRpcProvider(rpc, CHAIN_ID);
	const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk, provider);
	const contract = new ethers.Contract(REGISTRY, IDENTITY_REGISTRY_ABI, wallet);

	const bnb = await provider.getBalance(wallet.address);
	const bnbStr = ethers.formatEther(bnb);
	console.log(`operator: ${wallet.address}`);
	console.log(`balance:  ${bnbStr} BNB`);
	console.log(`registry: ${REGISTRY}  (chain ${CHAIN_ID})`);
	console.log(`mode:     ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

	let agents;
	if (args.fromDb) {
		const limit = Number(args.limit || 50);
		console.log(`loading up to ${limit} published agents from DB…`);
		agents = await fetchAgentsFromDb(limit);
		console.log(`found ${agents.length} agents\n`);
	} else {
		if (!args.name) {
			console.error('error: one-off mint requires --name "Agent Name". Use --from-db to mint from the marketplace.');
			process.exit(1);
		}
		agents = [
			{
				name: args.name,
				description: args.description || '',
				image: args.image || '',
				website: args.website || '',
				uri: args.uri || '',
			},
		];
	}

	if (!dryRun && !args.yes && agents.length > 1) {
		console.log(`about to send ${agents.length} live mint transactions on BSC mainnet.`);
		console.log('re-run with --yes to confirm.');
		process.exit(0);
	}

	let ok = 0;
	let failed = 0;
	for (const a of agents) {
		try {
			await mintOne(contract, wallet, a, { dryRun });
			ok++;
		} catch (err) {
			failed++;
			console.error(`        [fail] ${err.shortMessage || err.message}`);
		}
		// brief pause to avoid nonce races on slow RPCs
		if (!dryRun) await new Promise((r) => setTimeout(r, 1500));
	}

	console.log(`\ndone. ok=${ok} failed=${failed}`);
	if (!dryRun) console.log(`ledger: ${LEDGER_PATH}`);
}

main().catch((err) => {
	console.error('fatal:', err.shortMessage || err.message || err);
	process.exit(1);
});
