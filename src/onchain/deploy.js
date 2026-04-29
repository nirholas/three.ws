/**
 * Unified deploy orchestrator.
 *
 * Drives the prep → sign → confirm pipeline against the new unified API
 * (`/api/agents/onchain/prep` + `/api/agents/onchain/confirm`). Family-specific
 * details (EVM ABI calls, Solana tx submission, SIWS linking) live in the
 * WalletAdapter. This module owns:
 *
 *   • Prep idempotency (caches `prepId` per agent + chain so retries don't
 *     re-pin metadata or rebuild a fresh Solana mint keypair).
 *   • Progress callbacks for UI to render step state.
 *   • Error normalization (USER_REJECTED short-circuits cleanly).
 */

import { getAdapter } from './adapters/index.js';
import { toCaip2 } from './chain-ref.js';

const PREP_CACHE_TTL_MS = 50 * 60 * 1000; // server keeps prep 60m

function prepCacheKey(agentId, ref) {
	return `3dagent:onchain-prep:${agentId}:${toCaip2(ref)}`;
}

async function getOrCreatePrep(agent, ref, walletAddress) {
	const key = prepCacheKey(agent.id, ref);
	try {
		const raw = localStorage.getItem(key);
		if (raw) {
			const cached = JSON.parse(raw);
			if (cached?.prepId && cached?.expiresAt > Date.now()) return cached;
		}
	} catch {
		/* fall through */
	}

	const body = {
		agent_id: agent.id,
		chain: toCaip2(ref),
		wallet_address: walletAddress,
		name: agent.name || 'Agent',
		description: agent.description || '',
		avatar_id: agent.avatarId || agent.avatar_id || null,
		skills: Array.isArray(agent.skills) && agent.skills.length ? agent.skills : undefined,
	};
	const resp = await fetch('/api/agents/onchain/prep', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!resp.ok) {
		const data = await resp.json().catch(() => ({}));
		const err = new Error(data.error_description || `prep returned ${resp.status}`);
		err.status = resp.status;
		err.code = data.error;
		throw err;
	}
	const prep = await resp.json();
	const cached = { ...prep, expiresAt: Date.now() + PREP_CACHE_TTL_MS };
	try {
		localStorage.setItem(key, JSON.stringify(cached));
	} catch {
		/* quota — fine */
	}
	return cached;
}

function clearPrepCache(agentId, ref) {
	try {
		localStorage.removeItem(prepCacheKey(agentId, ref));
	} catch {
		/* ignore */
	}
}

/**
 * @param {object} opts
 * @param {{ id: string, name: string, [k: string]: any }} opts.agent
 * @param {import('./chain-ref.js').ChainRef} opts.ref
 * @param {(step: 'connect'|'prep'|'sign'|'confirm'|'save', detail?: object) => void} [opts.onProgress]
 * @returns {Promise<{ ref: import('./chain-ref.js').ChainRef, txHash: string, onchainId: string|null, contractOrMint: string|null, agent: object }>}
 */
export async function deployAgent({ agent, ref, onProgress = () => {} }) {
	if (!agent?.id) throw new Error('agent.id is required');

	const adapter = getAdapter(ref.family);
	if (!adapter.isAvailable()) {
		const err = new Error(`No ${ref.family.toUpperCase()} wallet detected.`);
		err.code = 'NO_PROVIDER';
		err.installUrl = adapter.installUrl();
		throw err;
	}

	onProgress('connect');
	const { address, ref: walletRef } = await adapter.connect({
		ensureLinked: true,
		cluster: ref.family === 'solana' ? ref.cluster : undefined,
	});

	if (ref.family === 'evm' && walletRef.family === 'evm' && walletRef.chainId !== ref.chainId) {
		await adapter.switchTo(ref);
	}

	onProgress('prep');
	const prep = await getOrCreatePrep(agent, ref, address);

	onProgress('sign');
	const sig = await adapter.signAndSend(prep, ref);

	onProgress('confirm');
	const confirmResp = await fetch('/api/agents/onchain/confirm', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			prep_id: prep.prepId,
			tx_hash: sig.txHash,
			onchain_id: sig.onchainId || null,
			wallet_address: address,
		}),
	});
	if (!confirmResp.ok) {
		const data = await confirmResp.json().catch(() => ({}));
		const err = new Error(data.error_description || `confirm returned ${confirmResp.status}`);
		err.status = confirmResp.status;
		err.code = data.error;
		err.txHash = sig.txHash;
		throw err;
	}
	const result = await confirmResp.json();

	onProgress('save');
	clearPrepCache(agent.id, ref);

	return {
		ref,
		txHash: sig.txHash,
		onchainId: sig.onchainId,
		contractOrMint: prep.contractAddress || prep.assetPubkey || null,
		agent: result.agent,
	};
}
