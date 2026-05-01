/**
 * Agent vanity grinder — standalone card for picking & grinding a custom
 * Solana address prefix. Lives next to the wallet card on the agent home
 * panel; uses the wallet provisioning API to apply the ground keypair.
 *
 * On mount:
 *   - GET /api/agents/:id/solana to know if a wallet already exists.
 *   - 403 → hide (owner-only). 404 → show "generate vanity wallet" affordance.
 *   - 200 → show "regrind" affordance. Click confirms a destructive replace.
 */

import { openVanityModal } from './erc8004/vanity-modal.js';
import {
	fetchAgentSolanaWallet,
	provisionAgentSolanaWallet,
	deleteAgentSolanaWallet,
} from './agent-solana-wallet.js';

const STYLE = `
.agent-vanity-grinder-details { margin: .85rem 0; }
.agent-vanity-grinder-summary { font: 11px/1.4 system-ui, sans-serif; color: rgba(230,230,234,0.4); cursor: pointer; list-style: none; padding: .2rem 0; user-select: none; }
.agent-vanity-grinder-summary::-webkit-details-marker { display: none; }
.agent-vanity-grinder-summary::before { content: '▸ '; font-size: .65rem; }
.agent-vanity-grinder-details[open] .agent-vanity-grinder-summary::before { content: '▾ '; }
.agent-vanity-grinder { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: .85rem 1rem; margin: .4rem 0 0; font: 13px/1.4 system-ui, sans-serif; background: rgba(255,255,255,0.03); color: #e6e6ea; }
.agent-vanity-grinder h3 { margin: 0 0 .25rem; font-size: .85rem; font-weight: 600; color: #f2f2f5; }
.agent-vanity-grinder .sub { color: rgba(230,230,234,0.6); font-size: .78rem; margin: 0 0 .65rem; }
.agent-vanity-grinder .row { display: flex; gap: .5rem; align-items: center; margin-top: .2rem; flex-wrap: wrap; }
.agent-vanity-grinder button { font: inherit; padding: .4rem .8rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #e6e6ea; cursor: pointer; }
.agent-vanity-grinder button:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
.agent-vanity-grinder button.primary { background: #f2f2f5; color: #111; border-color: #f2f2f5; }
.agent-vanity-grinder button.primary:hover:not(:disabled) { background: #fff; }
.agent-vanity-grinder button:disabled { opacity: .5; cursor: not-allowed; }
.agent-vanity-grinder .progress { font-size: .75rem; color: rgba(230,230,234,0.7); margin-top: .55rem; font-family: ui-monospace, monospace; }
.agent-vanity-grinder .err { color: #ff8a80; font-size: .75rem; margin-top: .5rem; }
.agent-vanity-grinder .current { font-family: ui-monospace, monospace; font-size: .75rem; color: rgba(230,230,234,0.6); margin-top: .35rem; word-break: break-all; }
.agent-vanity-grinder .current .pfx { background: linear-gradient(90deg,#ffd54f,#ff8a65); color: #1a1a1a; padding: 0 2px; border-radius: 2px; font-weight: 600; }
`;

let _styleInjected = false;
function _injectStyle() {
	if (_styleInjected || typeof document === 'undefined') return;
	const tag = document.createElement('style');
	tag.id = 'agent-vanity-grinder-style';
	tag.textContent = STYLE;
	document.head.appendChild(tag);
	_styleInjected = true;
}

function _esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[c]);
}

function _formatRate(n) {
	if (!n) return '0';
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
	return Math.round(n).toString();
}

/**
 * Mount the vanity grinder card.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {{ id: string, name?: string }} opts.identity
 * @param {() => void} [opts.onProvisioned] — called after a successful grind+provision.
 */
export function mountAgentVanityGrinderCard({ panel, identity, onProvisioned }) {
	if (!panel || !identity?.id) return null;
	_injectStyle();

	const wrapper = document.createElement('details');
	wrapper.className = 'agent-vanity-grinder-details';
	wrapper.hidden = true;
	const summary = document.createElement('summary');
	summary.className = 'agent-vanity-grinder-summary';
	summary.textContent = 'Vanity address';
	wrapper.appendChild(summary);
	panel.appendChild(wrapper);

	const root = document.createElement('section');
	root.className = 'agent-vanity-grinder';
	wrapper.appendChild(root);

	const state = {
		loaded: false,
		hasWallet: false,
		address: null,
		vanityPrefix: null,
		busy: false,
		progress: null,
		err: null,
	};
	let abort = null;

	async function loadFromServer() {
		const r = await fetchAgentSolanaWallet(identity.id, 'mainnet');
		if (r.status === 'forbidden') {
			wrapper.remove();
			return false;
		}
		wrapper.hidden = false;
		if (r.status === 'ok') {
			state.hasWallet = true;
			state.address = r.data.address;
			state.vanityPrefix = r.data.vanity_prefix || null;
		} else {
			state.hasWallet = false;
			state.address = null;
			state.vanityPrefix = null;
		}
		state.loaded = true;
		render();
		return true;
	}

	function render() {
		if (!state.loaded) {
			root.innerHTML = `<div class="sub">Loading…</div>`;
			return;
		}
		const btnLabel = state.hasWallet ? 'Regrind with new prefix' : 'Grind vanity wallet';
		const sub = state.hasWallet
			? 'Replace the current wallet with one whose address starts with characters you choose.'
			: 'Generate a wallet whose address starts with characters you choose.';

		const current = state.hasWallet && state.address
			? `<div class="current"><span class="pfx">${_esc(state.vanityPrefix || '')}</span>${_esc(state.address.slice((state.vanityPrefix || '').length))}</div>`
			: '';

		root.innerHTML = `
			<h3>Vanity address</h3>
			<p class="sub">${_esc(sub)}</p>
			${current}
			<div class="row">
				<button class="primary" data-act="grind" ${state.busy ? 'disabled' : ''}>
					${state.busy ? 'Working…' : _esc(btnLabel)}
				</button>
			</div>
			${state.progress ? `<div class="progress">grinding… ${_esc(_formatRate(state.progress.rate))}/s · eta ${_esc(state.progress.eta)} <button data-act="cancel">cancel</button></div>` : ''}
			${state.err ? `<div class="err">${_esc(state.err)}</div>` : ''}
		`;
		root.querySelector('[data-act="grind"]')?.addEventListener('click', onGrind);
		root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => abort?.abort());
	}

	async function onGrind() {
		const choice = await openVanityModal({
			agentName: identity.name || '',
			initial: state.vanityPrefix || '',
		});
		if (choice == null || choice === '') return;

		const prefix = typeof choice === 'string' ? choice : choice.prefix;
		const preGround = typeof choice === 'object' ? choice.secretKey : null;

		if (state.hasWallet) {
			if (!confirm('Replace the existing Solana wallet with a vanity-ground one? The old key will be discarded — funds will be lost if not transferred first.')) return;
		}

		state.busy = true; state.err = null; state.progress = null; render();
		abort = new AbortController();
		try {
			if (state.hasWallet) {
				await deleteAgentSolanaWallet(identity.id);
			}
			const data = await provisionAgentSolanaWallet({
				agentId: identity.id,
				vanityPrefix: prefix,
				preGround,
				signal: abort.signal,
				onProgress: (p) => { state.progress = p; render(); },
			});
			state.hasWallet = true;
			state.address = data.address;
			state.vanityPrefix = data.vanity_prefix || prefix || null;
			state.progress = null;
			onProvisioned?.(data);
		} catch (e) {
			state.err = e.name === 'AbortError' ? 'cancelled' : e.message;
			state.progress = null;
		} finally {
			state.busy = false; abort = null; render();
		}
	}

	render();
	loadFromServer().catch((e) => {
		state.err = e.message || 'failed to load';
		state.loaded = true;
		wrapper.hidden = false;
		render();
	});

	return {
		destroy: () => {
			abort?.abort();
			wrapper.remove();
		},
		refresh: () => loadFromServer().catch(() => {}),
	};
}
