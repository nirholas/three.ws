/**
 * Read-only queries against the Identity Registry.
 *
 * Used by the tabbed registration UI (My Agents / Search / History).
 *
 * All queries use a read-only provider (wallet provider preferred; public RPC
 * fallback from CHAIN_META). We deliberately avoid backend state for these —
 * the chain is the source of truth.
 */

import { BrowserProvider, Contract, JsonRpcProvider } from 'ethers';
import { IDENTITY_REGISTRY_ABI, REGISTRY_DEPLOYMENTS } from './abi.js';
import { CHAIN_META } from './chain-meta.js';

/**
 * Return a read-only ethers provider. Uses the connected wallet provider if
 * `ethProvider` is given, else falls back to the public RPC from CHAIN_META.
 *
 * @param {number} chainId
 * @param {any} [ethProvider]  EIP-1193 provider (window.ethereum / Privy)
 */
export function getReadProvider(chainId, ethProvider) {
	if (ethProvider) return new BrowserProvider(ethProvider);
	const meta = CHAIN_META[chainId];
	if (!meta) throw new Error(`No RPC configured for chainId ${chainId}`);
	return new JsonRpcProvider(meta.rpcUrl, chainId);
}

/** @param {number} chainId @param {any} [ethProvider] */
export function getReadRegistry(chainId, ethProvider) {
	const deployment = REGISTRY_DEPLOYMENTS[chainId];
	if (!deployment || !deployment.identityRegistry) {
		throw new Error(`No Identity Registry for chainId ${chainId}`);
	}
	const provider = getReadProvider(chainId, ethProvider);
	return new Contract(deployment.identityRegistry, IDENTITY_REGISTRY_ABI, provider);
}

/**
 * Verify the registry's on-chain version. Non-throwing — returns null on error.
 * @param {number} chainId @param {any} [ethProvider]
 * @returns {Promise<string|null>}
 */
export async function getRegistryVersion(chainId, ethProvider) {
	try {
		const registry = getReadRegistry(chainId, ethProvider);
		return await registry.getVersion();
	} catch {
		return null;
	}
}

/**
 * @param {number} chainId @param {any} [ethProvider]
 * @returns {Promise<bigint>}
 */
export async function getTotalSupply(chainId, ethProvider) {
	const registry = getReadRegistry(chainId, ethProvider);
	return await registry.totalSupply();
}

/**
 * List agent IDs owned by `address`. Strategy:
 *
 *   1. Try ERC-721 Enumerable: balanceOf → tokenOfOwnerByIndex.
 *   2. If that reverts, fall back to a Registered-event scan over the last
 *      `eventScanBlocks` blocks (default 500k ~= 1 week on 12s chains, cheap
 *      on most public RPCs), filtered by owner topic.
 *   3. If neither path yields full detail, return `{ ids: [...], partial: true }`
 *      so the UI can render the count + a "check explorer" fallback.
 *
 * @param {object} opts
 * @param {number} opts.chainId
 * @param {string} opts.owner
 * @param {any}    [opts.ethProvider]
 * @param {number} [opts.eventScanBlocks]
 * @returns {Promise<{ ids: bigint[], count: number, partial: boolean, mode: 'enumerable'|'events'|'count-only' }>}
 */
export async function listAgentsByOwner({ chainId, owner, ethProvider, eventScanBlocks = 500000 }) {
	const registry = getReadRegistry(chainId, ethProvider);
	const balance = await registry.balanceOf(owner);
	const count = Number(balance);
	if (count === 0) return { ids: [], count: 0, partial: false, mode: 'enumerable' };

	// 1. Enumerable path
	try {
		const ids = [];
		for (let i = 0; i < count; i++) {
			const id = await registry.tokenOfOwnerByIndex(owner, i);
			ids.push(id);
		}
		return { ids, count, partial: false, mode: 'enumerable' };
	} catch { /* fall through */ }

	// 2. Event-scan fallback
	try {
		const provider = registry.runner.provider || registry.runner;
		const latest = await provider.getBlockNumber();
		const fromBlock = Math.max(0, latest - eventScanBlocks);
		const filter = registry.filters.Registered(null, null, owner);
		const events = await registry.queryFilter(filter, fromBlock, latest);
		const idsFromEvents = [];
		for (const ev of events) {
			const id = ev.args?.agentId;
			if (id === undefined) continue;
			// Confirm still owned (transfers could have moved it)
			try {
				const currentOwner = await registry.ownerOf(id);
				if (currentOwner.toLowerCase() === owner.toLowerCase()) idsFromEvents.push(id);
			} catch { /* ignore burned/missing */ }
		}
		return {
			ids:     idsFromEvents,
			count,
			partial: idsFromEvents.length < count,
			mode:    'events',
		};
	} catch { /* fall through */ }

	// 3. Count-only
	return { ids: [], count, partial: true, mode: 'count-only' };
}

/**
 * Fetch recent Registered events for display in the History tab.
 * Optionally filter to a specific owner.
 *
 * @param {object} opts
 * @param {number}  opts.chainId
 * @param {string}  [opts.owner]
 * @param {any}     [opts.ethProvider]
 * @param {number}  [opts.blocks]  Scan depth (default 500k)
 * @param {number}  [opts.limit]   Max events returned (newest first)
 * @returns {Promise<Array<{ agentId: bigint, agentURI: string, owner: string, blockNumber: number, txHash: string }>>}
 */
export async function listRegisteredEvents({ chainId, owner, ethProvider, blocks = 500000, limit = 100 }) {
	const registry = getReadRegistry(chainId, ethProvider);
	const provider = registry.runner.provider || registry.runner;
	const latest = await provider.getBlockNumber();
	const fromBlock = Math.max(0, latest - blocks);
	const filter = owner
		? registry.filters.Registered(null, null, owner)
		: registry.filters.Registered();
	const events = await registry.queryFilter(filter, fromBlock, latest);

	const out = events
		.slice()
		.reverse()
		.slice(0, limit)
		.map((ev) => ({
			agentId:     ev.args.agentId,
			agentURI:    ev.args.agentURI,
			owner:       ev.args.owner,
			blockNumber: ev.blockNumber,
			txHash:      ev.transactionHash,
		}));
	return out;
}

/**
 * Fetch on-chain detail for a single agent: owner + tokenURI.
 * Does NOT fetch the off-chain metadata JSON — callers do that via fetchAgentMetadata.
 *
 * @param {object} opts
 * @param {number}      opts.chainId
 * @param {bigint|number|string} opts.agentId
 * @param {any}         [opts.ethProvider]
 */
export async function getAgentOnchain({ chainId, agentId, ethProvider }) {
	const registry = getReadRegistry(chainId, ethProvider);
	const [owner, uri] = await Promise.all([
		registry.ownerOf(agentId).catch(() => null),
		registry.tokenURI(agentId).catch(() => null),
	]);
	return { agentId: BigInt(agentId), owner, uri };
}

/**
 * Resolve any IPFS/Arweave/data/https URI to a fetchable URL and parse JSON.
 *
 * @param {string} uri
 * @returns {Promise<{ ok: boolean, data?: any, error?: string, resolvedUrl?: string }>}
 */
export async function fetchAgentMetadata(uri) {
	if (!uri) return { ok: false, error: 'empty uri' };

	// data:application/json;base64,...  (inline)
	if (uri.startsWith('data:')) {
		try {
			const match = uri.match(/^data:application\/json(?:;base64)?,(.*)$/);
			if (!match) return { ok: false, error: 'unsupported data URI' };
			const payload = /;base64,/.test(uri) ? atob(match[1]) : decodeURIComponent(match[1]);
			return { ok: true, data: JSON.parse(payload), resolvedUrl: uri };
		} catch (err) {
			return { ok: false, error: 'data URI parse failed: ' + err.message };
		}
	}

	let url = uri;
	if (uri.startsWith('ipfs://')) url = 'https://ipfs.io/ipfs/' + uri.slice(7);
	else if (uri.startsWith('ar://')) url = 'https://arweave.net/' + uri.slice(5);

	try {
		const res = await fetch(url);
		if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, resolvedUrl: url };
		const data = await res.json();
		return { ok: true, data, resolvedUrl: url };
	} catch (err) {
		return { ok: false, error: err.message, resolvedUrl: url };
	}
}
