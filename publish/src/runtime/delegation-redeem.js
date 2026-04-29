/**
 * Delegation Redeem Hook
 * ----------------------
 * Runtime adapter: skills call redeemFromSkill() and this module handles
 * delegation lookup, path selection (client vs relayer), pre-flight validation,
 * protocol bus events, and a per-tab rate limiter.
 *
 * Does NOT import viewer or three.js modules.
 * Does NOT use localStorage — cache is in-memory only.
 */

import { protocol, ACTION_TYPES } from '../agent-protocol.js';

// ── Rate limiter (token bucket, per tab) ──────────────────────────────────────

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

/** @type {{ timestamps: number[] }} */
const _rateState = { timestamps: [] };

function _checkRateLimit() {
	const now = Date.now();
	const cutoff = now - RATE_LIMIT_WINDOW_MS;
	_rateState.timestamps = _rateState.timestamps.filter((t) => t > cutoff);
	if (_rateState.timestamps.length >= RATE_LIMIT_MAX) {
		throw new Error('rate_limited');
	}
	_rateState.timestamps.push(now);
}

// ── Delegation cache (memory-only, 60s TTL) ───────────────────────────────────

const CACHE_TTL_MS = 60_000;

/** @type {Map<string, { envelopes: any[], ts: number }>} */
const _delegationCache = new Map();

// Invalidate on successful revoke events from the bus
protocol.on('permissions.revoke', (action) => {
	const { agentId, chainId } = action.payload || {};
	if (agentId && chainId) {
		_delegationCache.delete(`${agentId}:${chainId}`);
	}
});

// ── Delegation selection ──────────────────────────────────────────────────────

/**
 * @param {any[]} envelopes
 * @param {{ token?: string, maxAmount?: string | bigint } | undefined} scopeHint
 */
function _pickBestDelegation(envelopes, scopeHint) {
	if (!envelopes?.length) return null;
	if (!scopeHint) return envelopes[0];

	const { token, maxAmount } = scopeHint;
	const scored = envelopes
		.map((env) => {
			const scope = env.scope || {};
			const tokenMatch = !token || scope.token === token;
			let amountOk = true;
			if (maxAmount && scope.maxAmount) {
				try {
					amountOk = BigInt(scope.maxAmount) >= BigInt(maxAmount);
				} catch {
					amountOk = false;
				}
			}
			return { env, rank: (tokenMatch ? 2 : 0) + (amountOk ? 1 : 0) };
		})
		.sort((a, b) => b.rank - a.rank);

	return scored[0].rank > 0 ? scored[0].env : null;
}

// ── Public: getActiveDelegation ───────────────────────────────────────────────

/**
 * Fetch the best matching delegation for an agent, with 60s cache.
 * @param {{ agentId: string, chainId: string|number, scopeHint?: { token?: string, maxAmount?: string } }} opts
 * @returns {Promise<object|null>}
 */
export async function getActiveDelegation({ agentId, chainId, scopeHint } = {}) {
	const key = `${agentId}:${chainId}`;
	const cached = _delegationCache.get(key);
	if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
		return _pickBestDelegation(cached.envelopes, scopeHint);
	}

	const url = `/api/permissions/metadata?agentId=${encodeURIComponent(agentId)}&chainId=${encodeURIComponent(chainId)}`;
	let res;
	try {
		res = await fetch(url);
	} catch (err) {
		return null;
	}
	if (!res.ok) return null;

	const data = await res.json().catch(() => null);
	if (!data) return null;

	const envelopes = Array.isArray(data) ? data : (data.delegations ?? []);
	_delegationCache.set(key, { envelopes, ts: Date.now() });
	return _pickBestDelegation(envelopes, scopeHint);
}

// ── Pre-flight scope validation ───────────────────────────────────────────────

/**
 * Returns an error string if any call violates the delegation scope, else null.
 * @param {any[]} calls
 * @param {object | undefined} scope
 */
function _validateCallsAgainstScope(calls, scope) {
	if (!scope || !calls?.length) return null;

	const { targets, maxAmount } = scope;
	for (const call of calls) {
		if (targets?.length && call.to && !targets.includes(call.to)) {
			return `Call target ${call.to} not in allowed scope targets`;
		}
		if (maxAmount && call.value != null) {
			try {
				if (BigInt(call.value) > BigInt(maxAmount)) {
					return `Call value ${call.value} exceeds scope maxAmount ${maxAmount}`;
				}
			} catch {
				// non-parseable — skip amount check
			}
		}
	}
	return null;
}

// ── Relayer token resolution ──────────────────────────────────────────────────

function _getRelayerToken(agentId) {
	if (typeof window === 'undefined') return null;
	return (
		window.__AGENT_RUNTIME_CONFIG__?.[agentId]?.relayerToken ??
		window.__AGENT_RUNTIME_CONFIG__?.relayerToken ??
		null
	);
}

// ── Client-mode redemption ────────────────────────────────────────────────────

async function _redeemClient(delegation, calls, chainId) {
	if (!delegation.signature) {
		// Metadata endpoint returns a public view without the signature.
		// Client-mode redemption requires the full signed delegation object.
		throw new Error('no_redemption_path');
	}

	const { ensureWallet } = await import('../erc8004/agent-registry.js');
	const { signer } = await ensureWallet();

	const { redeemDelegation } = await import('../permissions/toolkit.js');
	const { txHash } = await redeemDelegation({ delegation, calls, signer, chainId });
	return txHash;
}

// ── Relayer-mode redemption ───────────────────────────────────────────────────

async function _redeemRelayer(delegation, calls, agentId, chainId, skillId) {
	const token = _getRelayerToken(agentId);
	if (!token) throw new Error('no_relayer_token');

	const res = await fetch('/api/permissions/redeem', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ delegation, calls, agentId, chainId, skillId }),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({ message: res.statusText }));
		throw new Error(body.message || `Relayer returned ${res.status}`);
	}

	const data = await res.json();
	if (!data.txHash) throw new Error('Relayer response missing txHash');
	return data.txHash;
}

// ── Public: redeemFromSkill ───────────────────────────────────────────────────

/**
 * The main entrypoint for skills. Handles path selection, pre-flight, events, and errors.
 * @param {{
 *   agentId: string,
 *   chainId: string|number,
 *   calls: Array<{ to: string, value?: bigint, data?: string }>,
 *   skillId: string,
 *   mode?: 'client' | 'relayer' | 'auto',
 * }} opts
 * @returns {Promise<{ ok: true, txHash: string } | { ok: false, code: string, message: string }>}
 */
export async function redeemFromSkill({ agentId, chainId, calls, skillId, mode = 'auto' } = {}) {
	// Rate limit — never hits the network when exceeded
	try {
		_checkRateLimit();
	} catch {
		const code = 'rate_limited';
		const message = 'Too many redemption attempts — max 5 per minute per tab';
		protocol.emit({
			type: ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
			payload: { code, message, skillId },
			agentId,
			sourceSkill: skillId,
		});
		return { ok: false, code, message };
	}

	// Pre-flight: delegation existence
	const delegation = await getActiveDelegation({ agentId, chainId });
	if (!delegation) {
		const code = 'no_delegation';
		const message = 'No active delegation found for this agent/chain';
		protocol.emit({
			type: ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
			payload: { code, message, skillId },
			agentId,
			sourceSkill: skillId,
		});
		return { ok: false, code, message };
	}

	// Pre-flight: scope validation (cheap, prevents wasted gas)
	const scopeErr = _validateCallsAgainstScope(calls, delegation.scope);
	if (scopeErr) {
		const code = 'scope_violation';
		protocol.emit({
			type: ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
			payload: { code, message: scopeErr, skillId },
			agentId,
			sourceSkill: skillId,
		});
		return { ok: false, code, message: scopeErr };
	}

	// Resolve auto mode
	let resolvedMode = mode;
	if (mode === 'auto') {
		const hasWallet =
			typeof window !== 'undefined' && !!window.ethereum && !!delegation.signature;
		const hasToken = !!_getRelayerToken(agentId);
		if (hasWallet) resolvedMode = 'client';
		else if (hasToken) resolvedMode = 'relayer';
		else {
			const code = 'no_redemption_path';
			const message = 'No wallet connected and no relayer token available';
			protocol.emit({
				type: ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
				payload: { code, message, skillId },
				agentId,
				sourceSkill: skillId,
			});
			return { ok: false, code, message };
		}
	}

	if (resolvedMode === 'client' && (typeof window === 'undefined' || !window.ethereum)) {
		const code = 'no_wallet';
		const message = 'client mode requires a connected wallet';
		protocol.emit({
			type: ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
			payload: { code, message, skillId },
			agentId,
			sourceSkill: skillId,
		});
		return { ok: false, code, message };
	}

	if (resolvedMode === 'relayer' && !_getRelayerToken(agentId)) {
		const code = 'no_relayer_token';
		const message = 'relayer mode requires a bearer token in runtime config';
		protocol.emit({
			type: ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
			payload: { code, message, skillId },
			agentId,
			sourceSkill: skillId,
		});
		return { ok: false, code, message };
	}

	protocol.emit({
		type: ACTION_TYPES.PERMISSIONS_REDEEM_START,
		payload: {
			agentId,
			chainId,
			skillId,
			mode: resolvedMode,
			delegationHash: delegation.hash,
		},
		agentId,
		sourceSkill: skillId,
	});

	try {
		let txHash;
		if (resolvedMode === 'client') {
			txHash = await _redeemClient(delegation, calls, chainId);
		} else {
			txHash = await _redeemRelayer(delegation, calls, agentId, chainId, skillId);
		}

		// Invalidate cache — balance has changed
		_delegationCache.delete(`${agentId}:${chainId}`);

		protocol.emit({
			type: ACTION_TYPES.PERMISSIONS_REDEEM_SUCCESS,
			payload: { txHash, skillId, delegationHash: delegation.hash },
			agentId,
			sourceSkill: skillId,
		});

		return { ok: true, txHash };
	} catch (err) {
		const code = err.message || 'unknown_error';
		protocol.emit({
			type: ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
			payload: { code, message: err.message, skillId },
			agentId,
			sourceSkill: skillId,
		});
		return { ok: false, code, message: err.message };
	}
}

// ── Public: subscribeRedeemEvents ─────────────────────────────────────────────

/**
 * Subscribe to all redemption lifecycle events. Returns an unsubscribe function.
 * @param {(action: import('../agent-protocol.js').ActionPayload) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeRedeemEvents(handler) {
	const types = [
		ACTION_TYPES.PERMISSIONS_REDEEM_START,
		ACTION_TYPES.PERMISSIONS_REDEEM_SUCCESS,
		ACTION_TYPES.PERMISSIONS_REDEEM_ERROR,
	];
	// Use addEventListener directly to avoid __protocolWrapped collision across types
	const wrapped = (e) => handler(e.detail);
	types.forEach((t) => protocol.addEventListener(t, wrapped));
	return () => types.forEach((t) => protocol.removeEventListener(t, wrapped));
}
