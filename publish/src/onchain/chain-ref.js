/**
 * ChainRef — a single, comparable, serializable reference to "what chain."
 *
 * Replaces the dual world of (number EVM chainId) vs (sentinel strings like
 * 'solana-devnet'). Every onchain helper takes a ChainRef; family-specific
 * branching happens in adapters, not in the UI.
 *
 * Wire format is CAIP-2-shaped. CAIP-2 references for Solana are the
 * genesis-hash prefix; we use the well-known short prefixes published in the
 * spec so that the same string round-trips through DBs, URLs, and registries.
 *
 * Examples:
 *   'eip155:1'      Ethereum mainnet
 *   'eip155:8453'   Base mainnet
 *   'eip155:84532'  Base Sepolia
 *   'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'  Solana mainnet-beta
 *   'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'  Solana devnet
 */

/** @typedef {{ namespace: 'eip155', chainId: number, family: 'evm' }} EvmChainRef */
/** @typedef {{ namespace: 'solana', cluster: 'mainnet'|'devnet', family: 'solana' }} SolanaChainRef */
/** @typedef {EvmChainRef|SolanaChainRef} ChainRef */

// CAIP-2 references for Solana per https://chainagnostic.org/CAIPs/caip-2.
const SOLANA_REFS = {
	mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
	devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};
const SOLANA_REF_TO_CLUSTER = Object.fromEntries(
	Object.entries(SOLANA_REFS).map(([k, v]) => [v, k]),
);

/** @param {number} chainId @returns {EvmChainRef} */
export function evm(chainId) {
	if (!Number.isInteger(chainId) || chainId <= 0) {
		throw new TypeError(`evm(): chainId must be a positive integer, got ${chainId}`);
	}
	return { namespace: 'eip155', chainId, family: 'evm' };
}

/** @param {'mainnet'|'devnet'} cluster @returns {SolanaChainRef} */
export function solana(cluster) {
	if (cluster !== 'mainnet' && cluster !== 'devnet') {
		throw new TypeError(`solana(): cluster must be 'mainnet' or 'devnet', got ${cluster}`);
	}
	return { namespace: 'solana', cluster, family: 'solana' };
}

/** @param {ChainRef} ref @returns {string} CAIP-2 string */
export function toCaip2(ref) {
	if (ref.family === 'evm') return `eip155:${ref.chainId}`;
	if (ref.family === 'solana') return `solana:${SOLANA_REFS[ref.cluster]}`;
	throw new TypeError(`Unknown ChainRef family: ${ref?.family}`);
}

/** @param {string} caip2 @returns {ChainRef} */
export function fromCaip2(caip2) {
	if (typeof caip2 !== 'string') throw new TypeError('fromCaip2 expects a string');
	const [ns, ref] = caip2.split(':');
	if (ns === 'eip155') return evm(Number(ref));
	if (ns === 'solana') {
		const cluster = SOLANA_REF_TO_CLUSTER[ref];
		if (!cluster) throw new Error(`Unknown solana ref: ${ref}`);
		return solana(cluster);
	}
	throw new Error(`Unsupported namespace: ${ns}`);
}

/** @param {ChainRef} a @param {ChainRef} b */
export function eqRef(a, b) {
	if (!a || !b) return false;
	return toCaip2(a) === toCaip2(b);
}

/** @param {ChainRef} ref */
export function familyOf(ref) {
	return ref.family;
}

// ── Registry of supported chains for the deploy UI ──────────────────────────
//
// This is the source-of-truth list the dropdown reads from. EVM entries point
// at the legacy CHAIN_META + REGISTRY_DEPLOYMENTS tables for backwards compat;
// new chains added here automatically appear in the picker.

/**
 * @typedef {{
 *   ref: ChainRef,
 *   name: string,
 *   shortName: string,
 *   testnet: boolean,
 *   explorerTx: (sigOrHash: string) => string,
 *   explorerAddress: (addr: string) => string,
 * }} ChainEntry
 */

const SOLANA_ENTRIES = {
	mainnet: {
		ref: solana('mainnet'),
		name: 'Solana',
		shortName: 'SOL',
		testnet: false,
		explorerTx: (sig) => `https://solscan.io/tx/${sig}`,
		explorerAddress: (addr) => `https://solscan.io/account/${addr}`,
	},
	devnet: {
		ref: solana('devnet'),
		name: 'Solana Devnet',
		shortName: 'SOLdev',
		testnet: true,
		explorerTx: (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
		explorerAddress: (addr) => `https://explorer.solana.com/address/${addr}?cluster=devnet`,
	},
};

/**
 * Build the registry by combining EVM chains from the legacy meta table with
 * the Solana entries above. Pure function — no I/O.
 *
 * @param {Record<number, { name: string, shortName: string, explorer: string, testnet: boolean }>} evmMeta
 * @param {Record<number, unknown>} evmDeployments  Used as the gate for EVM inclusion
 * @returns {ChainEntry[]}
 */
export function buildRegistry(evmMeta, evmDeployments) {
	const entries = [];
	for (const [idStr, meta] of Object.entries(evmMeta || {})) {
		const id = Number(idStr);
		if (!evmDeployments?.[id]) continue;
		entries.push({
			ref: evm(id),
			name: meta.name,
			shortName: meta.shortName,
			testnet: !!meta.testnet,
			explorerTx: (h) => `${meta.explorer}/tx/${h}`,
			explorerAddress: (a) => `${meta.explorer}/address/${a}`,
		});
	}
	entries.push(SOLANA_ENTRIES.mainnet, SOLANA_ENTRIES.devnet);
	return entries;
}

/** @param {ChainEntry[]} reg @returns {{ mainnets: ChainEntry[], testnets: ChainEntry[] }} */
export function groupRegistry(reg) {
	const mainnets = [];
	const testnets = [];
	for (const e of reg) (e.testnet ? testnets : mainnets).push(e);
	return { mainnets, testnets };
}

/** @param {ChainEntry[]} reg @param {string} caip2 */
export function entryByCaip2(reg, caip2) {
	return reg.find((e) => toCaip2(e.ref) === caip2) || null;
}
