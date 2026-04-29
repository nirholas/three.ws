/**
 * Agent Solana wallet — provisioning UI + client.
 *
 * Owner-only card on the agent home panel. Two flows:
 *   1. Random wallet     → POST /api/agents/:id/solana with empty body.
 *   2. Vanity wallet     → grind in-browser (or accept a CLI-ground keypair
 *                          via the paste field) then POST { secret_key,
 *                          vanity_prefix }. Server verifies and stores the
 *                          encrypted secret.
 *
 * Existing wallets are non-destructive: a "Replace" button calls DELETE first.
 */

import { openVanityModal } from './erc8004/vanity-modal.js';
import { grindVanity } from './solana/vanity/grinder.js';

const ENDPOINT = (id) => `/api/agents/${encodeURIComponent(id)}/solana`;

/**
 * Provision (or replace) the agent's Solana wallet.
 *
 * @param {object} opts
 * @param {string} opts.agentId
 * @param {string} [opts.vanityPrefix]      — base58 prefix to grind for.
 * @param {Uint8Array} [opts.preGround]     — pre-ground 64-byte secret key.
 * @param {AbortSignal} [opts.signal]
 * @param {(p: { rate: number, attempts: number, eta: string }) => void} [opts.onProgress]
 * @returns {Promise<{ address: string, source: string, vanity_prefix: string|null }>}
 */
export async function provisionAgentSolanaWallet({
	agentId,
	vanityPrefix = '',
	preGround = null,
	signal,
	onProgress,
} = {}) {
	if (!agentId) throw new Error('agentId required');

	let body = null;
	if (preGround) {
		body = {
			secret_key: Array.from(preGround),
			...(vanityPrefix ? { vanity_prefix: vanityPrefix } : {}),
		};
	} else if (vanityPrefix) {
		const ground = await grindVanity({ prefix: vanityPrefix, signal, onProgress });
		body = {
			secret_key: Array.from(ground.secretKey),
			vanity_prefix: vanityPrefix,
		};
	}

	const resp = await fetch(ENDPOINT(agentId), {
		method: 'POST',
		credentials: 'include',
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
		signal,
	});
	const json = await resp.json().catch(() => ({}));
	if (!resp.ok) {
		const msg = json?.error?.message || json?.message || `provision failed (${resp.status})`;
		const err = new Error(msg);
		err.status = resp.status;
		throw err;
	}
	return json.data;
}

export async function deleteAgentSolanaWallet(agentId) {
	const resp = await fetch(ENDPOINT(agentId), { method: 'DELETE', credentials: 'include' });
	if (!resp.ok) {
		const j = await resp.json().catch(() => ({}));
		throw new Error(j?.error?.message || `delete failed (${resp.status})`);
	}
}

// ── UI card ─────────────────────────────────────────────────────────────────

const STYLE = `
.agent-sol-wallet { border: 1px solid #e6e6ea; border-radius: 10px; padding: .85rem 1rem; margin: .85rem 0; font: 13px/1.4 system-ui, sans-serif; background: #fff; }
.agent-sol-wallet h3 { margin: 0 0 .25rem; font-size: .95rem; font-weight: 600; color: #1a1a1a; }
.agent-sol-wallet .sub { color: #666; font-size: .78rem; margin: 0 0 .65rem; }
.agent-sol-wallet .addr { font-family: ui-monospace, monospace; font-size: .8rem; background: #f7f7f8; padding: .4rem .55rem; border-radius: 5px; word-break: break-all; }
.agent-sol-wallet .addr .pfx { background: linear-gradient(90deg,#ffd54f,#ff8a65); color: #1a1a1a; padding: 0 2px; border-radius: 2px; font-weight: 600; }
.agent-sol-wallet .row { display: flex; gap: .5rem; align-items: center; margin-top: .65rem; flex-wrap: wrap; }
.agent-sol-wallet button { font: inherit; padding: .4rem .8rem; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
.agent-sol-wallet button.primary { background: #111; color: #fff; border-color: #111; }
.agent-sol-wallet button:disabled { opacity: .5; cursor: not-allowed; }
.agent-sol-wallet .progress { font-size: .75rem; color: #555; margin-top: .55rem; font-family: ui-monospace, monospace; }
.agent-sol-wallet .err { color: #b71c1c; font-size: .75rem; margin-top: .5rem; }
.agent-sol-wallet .src { font-size: .7rem; color: #888; margin-left: .35rem; }
`;

let _styleInjected = false;
function _injectStyle() {
	if (_styleInjected || typeof document === 'undefined') return;
	const tag = document.createElement('style');
	tag.id = 'agent-sol-wallet-style';
	tag.textContent = STYLE;
	document.head.appendChild(tag);
	_styleInjected = true;
}

function _esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[c]);
}

/**
 * Mount the wallet card into the agent home panel.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {{ id: string, name?: string, meta?: object, solana_address?: string }} opts.identity
 * @param {(data: { address: string, vanity_prefix: string|null, source: string }) => void} [opts.onProvisioned]
 */
export function mountAgentSolanaWalletCard({ panel, identity, onProvisioned }) {
	if (!panel || !identity?.id) return null;
	_injectStyle();

	const root = document.createElement('section');
	root.className = 'agent-sol-wallet';
	panel.appendChild(root);

	let state = {
		address: identity.solana_address || identity.meta?.solana_address || null,
		vanityPrefix: identity.meta?.solana_vanity_prefix || null,
		source: identity.meta?.solana_wallet_source || null,
		busy: false,
		progress: null,
		err: null,
	};
	let abort = null;

	function render() {
		if (state.address) {
			const pfx = state.vanityPrefix || '';
			const rest = state.address.slice(pfx.length);
			root.innerHTML = `
				<h3>Solana wallet${state.source ? `<span class="src">· ${_esc(state.source)}</span>` : ''}</h3>
				<div class="addr"><span class="pfx">${_esc(pfx)}</span>${_esc(rest)}</div>
				<div class="row">
					<button data-act="copy">Copy</button>
					<button data-act="replace">Replace</button>
				</div>
				${state.err ? `<div class="err">${_esc(state.err)}</div>` : ''}
			`;
			root.querySelector('[data-act="copy"]').addEventListener('click', () => {
				navigator.clipboard?.writeText(state.address).catch(() => {});
			});
			root.querySelector('[data-act="replace"]').addEventListener('click', onReplace);
			return;
		}

		root.innerHTML = `
			<h3>Solana wallet</h3>
			<p class="sub">Provision a wallet for this agent. Optionally pick a vanity prefix.</p>
			<div class="row">
				<button class="primary" data-act="vanity" ${state.busy ? 'disabled' : ''}>
					${state.busy ? 'Working…' : 'Choose vanity prefix'}
				</button>
				<button data-act="random" ${state.busy ? 'disabled' : ''}>Random</button>
			</div>
			${state.progress ? `<div class="progress">grinding… ${_esc(formatRate(state.progress.rate))}/s · eta ${_esc(state.progress.eta)} <button data-act="cancel">cancel</button></div>` : ''}
			${state.err ? `<div class="err">${_esc(state.err)}</div>` : ''}
		`;
		root.querySelector('[data-act="vanity"]')?.addEventListener('click', onVanity);
		root.querySelector('[data-act="random"]')?.addEventListener('click', onRandom);
		root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => abort?.abort());
	}

	async function onRandom() {
		state.busy = true; state.err = null; render();
		try {
			const data = await provisionAgentSolanaWallet({ agentId: identity.id });
			state.address = data.address;
			state.vanityPrefix = data.vanity_prefix || null;
			state.source = data.source || 'generated';
			_propagate(identity, data);
			onProvisioned?.(data);
		} catch (e) {
			state.err = e.message;
		} finally {
			state.busy = false; render();
		}
	}

	async function onVanity() {
		const choice = await openVanityModal({
			agentName: identity.name || '',
			initial: state.vanityPrefix || '',
		});
		if (choice == null || choice === '') return; // dismissed or "skip"

		const prefix = typeof choice === 'string' ? choice : choice.prefix;
		const preGround = typeof choice === 'object' ? choice.secretKey : null;

		state.busy = true; state.err = null; state.progress = null; render();
		abort = new AbortController();
		try {
			const data = await provisionAgentSolanaWallet({
				agentId: identity.id,
				vanityPrefix: prefix,
				preGround,
				signal: abort.signal,
				onProgress: (p) => { state.progress = p; render(); },
			});
			state.address = data.address;
			state.vanityPrefix = data.vanity_prefix || prefix || null;
			state.source = data.source || 'imported_vanity';
			state.progress = null;
			_propagate(identity, data);
			onProvisioned?.(data);
		} catch (e) {
			state.err = e.name === 'AbortError' ? 'cancelled' : e.message;
			state.progress = null;
		} finally {
			state.busy = false; abort = null; render();
		}
	}

	async function onReplace() {
		if (!confirm('Replace the existing Solana wallet? The old key will be discarded — funds will be lost if not transferred first.')) return;
		state.busy = true; state.err = null; render();
		try {
			await deleteAgentSolanaWallet(identity.id);
			state.address = null;
			state.vanityPrefix = null;
			state.source = null;
		} catch (e) {
			state.err = e.message;
		} finally {
			state.busy = false; render();
		}
	}

	render();
	return { destroy: () => root.remove() };
}

function _propagate(identity, data) {
	if (!identity || !data) return;
	identity.solana_address = data.address;
	identity.meta = {
		...(identity.meta || {}),
		solana_address: data.address,
		solana_vanity_prefix: data.vanity_prefix || null,
		solana_wallet_source: data.source || null,
	};
}

function formatRate(n) {
	if (!n) return '0';
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
	return Math.round(n).toString();
}
