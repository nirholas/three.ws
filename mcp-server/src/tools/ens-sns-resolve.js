// `ens_sns_resolve` — paid MCP tool that resolves a human-readable name
// to one or more on-chain addresses across ENS (Ethereum) and SNS (Solana).
//
// Pricing: $0.0005 USDC, settled `exact` in USDC on Solana mainnet.
//
// Resolution paths:
//   - ENS  (foo.eth, sub.foo.eth) → Ethereum mainnet via the configured
//     RPC (MAINNET_RPC_URL or MCP_ENS_RPC_URL), with a 3-second timeout.
//     Falls back to ethers' default public provider rotation.
//   - SNS  (foo.sol)              → Solana via Bonfida sns-api.bonfida.com
//     (the same source the three.ws site uses). Returns the owner wallet
//     plus reverse-lookup of any other domains the wallet holds.
//
// Inputs accepting "foo" or "foo.eth/.sol" disambiguate via the suffix.
// Inputs ending in neither are tried against both — whichever resolves wins.

import { z } from 'zod';

import { paid, toolError } from '../payments.js';
import { jsonSchemaFromZod } from './_shared.js';
import { resilientFetch } from '../lib/resilient-fetch.js';
import { makeEvmProvider } from '../lib/evm-rpc.js';

const TOOL_NAME = 'ens_sns_resolve';
const TOOL_DESCRIPTION =
	"Resolve a human-readable name to addresses across ENS (Ethereum) and SNS (Solana). For .eth: returns Ethereum address via ethers. For .sol: returns Solana owner wallet via Bonfida SNS plus the wallet's other owned .sol domains. Names without a suffix are tried against both registries. Use this to turn a .sol or .eth name into a wallet address before looking that wallet up or paying it. Paid: $0.0005 USDC.";

const ENS_RE = /^(?:[a-z0-9-]+\.)*[a-z0-9-]+\.eth$/i;
const SOL_RE = /^[a-z0-9-]{1,63}(?:\.sol)?$/i;
const SNS_API = 'https://sns-api.bonfida.com';

function env(k, def) {
	const v = process.env[k];
	return v && String(v).trim() ? String(v).trim() : def;
}

async function withTimeout(promise, ms, label) {
	const timeout = new Promise((_, rej) =>
		setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms),
	);
	return Promise.race([promise, timeout]);
}

async function resolveEns(name) {
	// Ethereum mainnet (chainId 1) with endpoint failover: any operator override
	// is tried first, then the built-in redundant public endpoints. Every RPC
	// call is timeout-bounded inside the provider, and the outer withTimeout
	// races the whole resolution as a final guard.
	const overrides = [env('MCP_ENS_RPC_URL'), env('MAINNET_RPC_URL')].filter(Boolean);
	const provider = makeEvmProvider(1, { overrides, timeoutMs: 8000 });
	const rpcUrl = overrides[0] || 'failover:ethereum';
	const address = await withTimeout(provider.resolveName(name), 4000, 'ens');
	if (!address) return null;
	let reverseName = null;
	try {
		reverseName = await withTimeout(provider.lookupAddress(address), 3000, 'ens-reverse');
	} catch {
		// reverse lookup is best-effort
	}
	return { network: 'ethereum', name, address, reverseName, rpc: rpcUrl || 'ethers-default' };
}

async function resolveSns(name) {
	const bare = name.toLowerCase().replace(/\.sol$/, '');
	if (!/^[a-z0-9-]{1,63}$/.test(bare)) return null;
	const lookup = await resilientFetch(
		`${SNS_API}/v2/domain/lookup/${bare}.sol`,
		{},
		{ timeoutMs: 6000, retries: 2, label: 'sns-lookup' },
	).catch(() => null);
	if (!lookup || !lookup.ok) return null;
	const data = await lookup.json().catch(() => null);
	const owner = data?.owner || data?.[bare + '.sol']?.owner || data?.data?.owner || null;
	if (!owner) return null;

	// Reverse fetch: other domains the owner holds.
	let allDomains = [];
	try {
		const r = await resilientFetch(
			`${SNS_API}/v2/user/domains/${owner}`,
			{},
			{ timeoutMs: 6000, retries: 1, label: 'sns-domains' },
		);
		if (r.ok) {
			const body = await r.json();
			const list = body?.[owner] || body?.data?.[owner] || [];
			if (Array.isArray(list)) {
				allDomains = list
					.map((d) => (typeof d === 'string' ? d : d?.domain || d?.name))
					.filter(Boolean);
			}
		}
	} catch {
		// best effort
	}

	let favoriteDomain = null;
	try {
		const r = await resilientFetch(
			`${SNS_API}/v2/user/fav-domains/${owner}`,
			{},
			{ timeoutMs: 6000, retries: 1, label: 'sns-fav' },
		);
		if (r.ok) {
			const body = await r.json();
			favoriteDomain = body?.[owner] || body?.data?.[owner] || null;
		}
	} catch {
		// best effort
	}

	return {
		network: 'solana',
		name: `${bare}.sol`,
		address: owner,
		favoriteDomain,
		allDomains,
		source: `${SNS_API}/v2/domain/lookup/${bare}.sol`,
	};
}

// Single source of truth: Zod shape with description + bounds; JSON Schema derived.
const inputZodShape = {
	name: z
		.string()
		.min(1)
		.max(253)
		.describe(
			'Name to resolve (e.g. "vitalik.eth", "bonfida.sol", or bare "vitalik" which is tried in both).',
		),
};

const inputJsonSchema = jsonSchemaFromZod(inputZodShape);

export async function buildEnsSnsResolveTool() {
	const handler = await paid(
		{
			toolName: TOOL_NAME,
			description: TOOL_DESCRIPTION,
			scheme: 'exact',
			priceUsd: '$0.0005',
			inputSchema: inputJsonSchema,
			example: { name: 'vitalik.eth' },
			outputExample: {
				ok: true,
				input: 'vitalik.eth',
				ens: {
					network: 'ethereum',
					name: 'vitalik.eth',
					address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
					reverseName: 'vitalik.eth',
				},
				sns: null,
			},
		},
		async ({ name }) => {
			const trimmed = String(name || '')
				.trim()
				.toLowerCase();
			const isEns = ENS_RE.test(trimmed);
			const isSol = /\.sol$/.test(trimmed) || (!isEns && SOL_RE.test(trimmed));

			const tasks = [];
			if (isEns)
				tasks.push([
					'ens',
					resolveEns(trimmed).catch((e) => ({ error: e?.message || 'ens failed' })),
				]);
			if (isSol)
				tasks.push([
					'sns',
					resolveSns(trimmed).catch((e) => ({ error: e?.message || 'sns failed' })),
				]);
			if (!isEns && !isSol) {
				return toolError(
					'invalid_name',
					'name does not look like a .eth, .sol, or bare label',
				);
			}
			const results = await Promise.all(tasks.map((t) => t[1]));
			const out = { ok: false, input: trimmed, ens: null, sns: null };
			tasks.forEach(([key], i) => {
				out[key] = results[i] || null;
			});
			if (out.ens && !out.ens.error) out.ok = true;
			if (out.sns && !out.sns.error) out.ok = true;
			if (!out.ok) {
				out.error = 'not_found';
				out.message = 'name did not resolve in either ENS or SNS';
			}
			out.fetchedAt = new Date().toISOString();
			return out;
		},
	);
	return {
		name: TOOL_NAME,
		title: 'ENS + SNS resolve ($0.0005)',
		description: TOOL_DESCRIPTION,
		inputSchema: inputZodShape,
		// Read-only external lookup. Not idempotent: name → address records can
		// be re-pointed between calls.
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		},
		handler,
	};
}
