/**
 * Agent ETH-CREATE2 vanity card — sibling of agent-vanity-grinder.js.
 *
 * Surfaces the CREATE2 vanity record stored under
 * /api/agents/:id/eth-vanity. Lifecycle states:
 *
 *   none         → form to pick deployer + raw initCode + prefix/suffix,
 *                  grind locally (Web Workers), POST to save
 *   saved        → show predicted address + Deploy button (Arachnid only)
 *                  + Replace and Remove
 *   deployed     → show address + chain id + tx link, no Deploy button
 *
 * Deploy uses the connected EVM signer via ethers BrowserProvider and
 * targets the **Arachnid deterministic-deployment-proxy** at
 * 0x4e59b44847b379578588920cA78FbF26c0B4956C. That proxy's interface is
 * a raw fallback: send tx with `data = salt(32) ‖ initCode` and the
 * contract is created at the predicted address.
 *
 * Other factory presets (Safe / CreateX / Coinbase Smart Wallet) save
 * fine but show "Use your factory tooling to deploy" — those need
 * factory-specific ABIs we don't bundle here.
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { grindCreate2Vanity } from './eth/vanity/grinder.js';
import {
	validatePattern, validateAddress, validateInitCodeHash, MAX_PATTERN_LENGTH,
} from './eth/vanity/validation.js';

const ARACHNID_PROXY = '0x4e59b44847b379578588920ca78fbf26c0b4956c';

const PRESETS = [
	{ addr: ARACHNID_PROXY,                                 label: 'Arachnid proxy', deployable: true },
	{ addr: '0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed',   label: 'CreateX',        deployable: false },
	{ addr: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',   label: 'Safe v1.4.1',    deployable: false },
	{ addr: '0x0ba5ed0c6aa8c49038f819e587e2633c4a9f428a',   label: 'Coinbase SW',    deployable: false },
];

const STYLE = `
.agent-eth-vanity-details { margin: .85rem 0; }
.agent-eth-vanity-summary { font: 11px/1.4 system-ui, sans-serif; color: rgba(230,230,234,0.4); cursor: pointer; list-style: none; padding: .2rem 0; user-select: none; }
.agent-eth-vanity-summary::-webkit-details-marker { display: none; }
.agent-eth-vanity-summary::before { content: '▸ '; font-size: .65rem; }
.agent-eth-vanity-details[open] .agent-eth-vanity-summary::before { content: '▾ '; }
.agent-eth-vanity { border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: .85rem 1rem; margin: .4rem 0 0; font: 13px/1.4 system-ui, sans-serif; background: rgba(255,255,255,0.03); color: #e6e6ea; }
.agent-eth-vanity h3 { margin: 0 0 .2rem; font-size: .85rem; font-weight: 600; color: #f2f2f5; display:flex; align-items:center; gap:.4rem; }
.agent-eth-vanity h3 .badge { font-size: .65rem; font-weight: 600; padding: .1rem .45rem; border-radius: 999px; background: linear-gradient(90deg, rgba(167,139,250,0.2), rgba(99,102,241,0.2)); color: #c4b5fd; border: 1px solid rgba(167,139,250,0.25); letter-spacing: .03em; }
.agent-eth-vanity .sub { color: rgba(230,230,234,0.6); font-size: .78rem; margin: 0 0 .55rem; }
.agent-eth-vanity .row { display: flex; gap: .5rem; align-items: center; margin-top: .35rem; flex-wrap: wrap; }
.agent-eth-vanity .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
@media (max-width: 480px) { .agent-eth-vanity .grid2 { grid-template-columns: 1fr; } }
.agent-eth-vanity input, .agent-eth-vanity textarea, .agent-eth-vanity select { font: inherit; font-family: ui-monospace, monospace; padding: .35rem .55rem; border-radius: 5px; border: 1px solid rgba(255,255,255,0.12); background: #1a1a1a; color: #e6e6ea; width: 100%; }
.agent-eth-vanity input:focus, .agent-eth-vanity textarea:focus { outline: none; border-color: rgba(255,255,255,0.3); }
.agent-eth-vanity input.invalid, .agent-eth-vanity textarea.invalid { border-color: #ff8a80; }
.agent-eth-vanity textarea { resize: vertical; min-height: 3em; }
.agent-eth-vanity label { display: block; font-size: .7rem; color: rgba(230,230,234,0.55); margin: .55rem 0 .15rem; }
.agent-eth-vanity button { font: inherit; padding: .35rem .75rem; border-radius: 5px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: #e6e6ea; cursor: pointer; font-size: .8rem; }
.agent-eth-vanity button:hover:not(:disabled) { background: rgba(255,255,255,0.08); }
.agent-eth-vanity button.primary { background: linear-gradient(90deg,#a78bfa,#6366f1); color: #fff; border-color: transparent; font-weight: 600; }
.agent-eth-vanity button.primary:hover:not(:disabled) { filter: brightness(1.1); }
.agent-eth-vanity button.danger { color: #ff8a80; }
.agent-eth-vanity button:disabled { opacity: .45; cursor: not-allowed; }
.agent-eth-vanity .preset-row { display: flex; gap: .3rem; flex-wrap: wrap; margin-top: .3rem; }
.agent-eth-vanity .preset { padding: .2rem .55rem; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); font-size: .7rem; cursor: pointer; }
.agent-eth-vanity .preset.active { background: linear-gradient(90deg, rgba(167,139,250,0.18), rgba(99,102,241,0.18)); border-color: rgba(167,139,250,0.35); color: #c4b5fd; }
.agent-eth-vanity .progress { font-size: .72rem; color: rgba(230,230,234,0.7); margin-top: .55rem; font-family: ui-monospace, monospace; }
.agent-eth-vanity .err { color: #ff8a80; font-size: .72rem; margin-top: .4rem; }
.agent-eth-vanity .ok { color: #4ade80; font-size: .72rem; margin-top: .4rem; }
.agent-eth-vanity .addr { font-family: ui-monospace, monospace; font-size: .75rem; color: rgba(230,230,234,0.85); margin-top: .35rem; word-break: break-all; padding: .35rem .5rem; background: #0e0e10; border-radius: 5px; border: 1px solid rgba(255,255,255,0.06); }
.agent-eth-vanity .addr .pfx, .agent-eth-vanity .addr .sfx { background: linear-gradient(90deg,#a78bfa,#6366f1); color: #fff; padding: 0 2px; border-radius: 2px; font-weight: 700; }
.agent-eth-vanity .meta-line { font-size: .68rem; color: rgba(230,230,234,0.5); margin-top: .4rem; font-family: ui-monospace, monospace; }
.agent-eth-vanity a { color: #a78bfa; text-decoration: none; }
.agent-eth-vanity a:hover { text-decoration: underline; }
`;

let _styleInjected = false;
function _injectStyle() {
	if (_styleInjected || typeof document === 'undefined') return;
	const tag = document.createElement('style');
	tag.id = 'agent-eth-vanity-style';
	tag.textContent = STYLE;
	document.head.appendChild(tag);
	_styleInjected = true;
}

function _esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
function _hexToBytes(hex) {
	const h = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substring(i*2, i*2+2), 16);
	return out;
}
function _bytesToHex(b) { let s=''; for (let i=0;i<b.length;i++) s += b[i].toString(16).padStart(2,'0'); return s; }
function _isHex(s) { return typeof s === 'string' && /^0x[0-9a-f]*$/i.test(s) && s.length % 2 === 0; }

const EXPLORERS = {
	1:     'https://etherscan.io',
	8453:  'https://basescan.org',
	10:    'https://optimistic.etherscan.io',
	42161: 'https://arbiscan.io',
	137:   'https://polygonscan.com',
	11155111: 'https://sepolia.etherscan.io',
	84532: 'https://sepolia.basescan.org',
};

/**
 * @param {object} opts
 * @param {HTMLElement} opts.panel
 * @param {{ id: string, name?: string, isOwner?: boolean }} opts.identity
 * @param {() => void} [opts.onAssigned]
 */
export function mountAgentEthVanityCard({ panel, identity, onAssigned }) {
	if (!panel || !identity?.id) return null;
	if (identity.isOwner === false) return null;
	_injectStyle();

	const wrapper = document.createElement('details');
	wrapper.className = 'agent-eth-vanity-details';
	wrapper.hidden = true;
	const summary = document.createElement('summary');
	summary.className = 'agent-eth-vanity-summary';
	summary.textContent = 'Vanity address (ETH · CREATE2)';
	wrapper.appendChild(summary);
	panel.appendChild(wrapper);

	const root = document.createElement('section');
	root.className = 'agent-eth-vanity';
	wrapper.appendChild(root);

	const state = {
		loaded: false,
		record: null,        // null when no record exists
		mode: 'view',        // view | form
		busy: false,
		progress: null,
		err: null,
		ok: null,
		form: {
			deployer: ARACHNID_PROXY,
			deployerLabel: 'Arachnid proxy',
			rawInitCode: '',
			prefix: '',
			suffix: '',
		},
	};
	let abort = null;

	async function load() {
		try {
			const r = await fetch(`/api/agents/${encodeURIComponent(identity.id)}/eth-vanity`, { credentials: 'include' });
			if (r.status === 403) { wrapper.remove(); return; }
			wrapper.hidden = false;
			if (r.status === 404) {
				state.record = null;
			} else if (r.ok) {
				const data = await r.json();
				state.record = data.data || data;
			} else {
				state.err = `load failed (${r.status})`;
			}
		} catch (e) {
			state.err = e.message || 'load failed';
		} finally {
			state.loaded = true;
			render();
		}
	}

	function render() {
		if (!state.loaded) {
			root.innerHTML = `<div class="sub">Loading…</div>`;
			return;
		}

		if (state.mode === 'form' || (!state.record && state.busy)) return renderForm();
		if (state.record)  return renderSaved();
		return renderEmpty();
	}

	function renderEmpty() {
		root.innerHTML = `
			<h3>Vanity address <span class="badge">CREATE2</span></h3>
			<p class="sub">
				Predict and assign a smart-contract address whose hex digits start (or end) with characters you choose.
				No keys involved — you grind a salt and deploy from a factory with your own EVM signer.
			</p>
			<div class="row">
				<button class="primary" data-act="new">Set up CREATE2 vanity</button>
				<a href="/eth-vanity" target="_blank" rel="noopener" style="font-size:.72rem">open full grinder ↗</a>
			</div>
			${state.err ? `<div class="err">${_esc(state.err)}</div>` : ''}
		`;
		root.querySelector('[data-act="new"]').addEventListener('click', () => { state.mode = 'form'; state.err = null; render(); });
	}

	function renderForm() {
		const canDeploy = PRESETS.find((p) => p.addr === state.form.deployer.toLowerCase())?.deployable;
		const presets = PRESETS.map((p) =>
			`<button class="preset ${state.form.deployer.toLowerCase() === p.addr ? 'active' : ''}" data-preset="${p.addr}" data-label="${_esc(p.label)}" type="button">${_esc(p.label)}</button>`
		).join('');

		root.innerHTML = `
			<h3>Set up CREATE2 vanity <span class="badge">CREATE2</span></h3>
			<p class="sub">Pick the factory you'll deploy through, paste its init code, choose a pattern, and grind.</p>

			<label>Deployer / factory</label>
			<input data-field="deployer" type="text" value="${_esc(state.form.deployer)}" spellcheck="false" />
			<div class="preset-row">${presets}</div>
			${canDeploy
				? `<div class="meta-line">✓ Arachnid proxy supports one-click deploy from this card.</div>`
				: `<div class="meta-line">Note: this factory requires its own deploy ABI — saving works, but you'll deploy from your own tooling.</div>`}

			<label>Init code (raw deploy bytecode + ABI-encoded args)</label>
			<textarea data-field="initcode" rows="3" placeholder="0x…" spellcheck="false">${_esc(state.form.rawInitCode)}</textarea>

			<div class="grid2">
				<div>
					<label>Prefix (hex, after 0x)</label>
					<input data-field="prefix" type="text" maxlength="${MAX_PATTERN_LENGTH}" value="${_esc(state.form.prefix)}" placeholder="beef" />
				</div>
				<div>
					<label>Suffix (hex)</label>
					<input data-field="suffix" type="text" maxlength="${MAX_PATTERN_LENGTH}" value="${_esc(state.form.suffix)}" placeholder="cafe" />
				</div>
			</div>

			<div class="row">
				<button class="primary" data-act="grind" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Grinding…' : 'Grind & assign'}</button>
				${state.busy ? '<button data-act="cancel">cancel</button>' : '<button data-act="back">back</button>'}
			</div>
			${state.progress ? `<div class="progress">${state.progress.attempts.toLocaleString()} tries · ${Math.round(state.progress.rate).toLocaleString()}/s · eta ${_esc(state.progress.eta)}</div>` : ''}
			${state.err ? `<div class="err">${_esc(state.err)}</div>` : ''}
		`;

		root.querySelector('[data-field="deployer"]').addEventListener('input', (e) => {
			state.form.deployer = e.target.value.trim();
			const p = PRESETS.find((x) => x.addr === state.form.deployer.toLowerCase());
			state.form.deployerLabel = p ? p.label : null;
		});
		root.querySelector('[data-field="initcode"]').addEventListener('input', (e) => { state.form.rawInitCode = e.target.value.trim(); });
		root.querySelector('[data-field="prefix"]').addEventListener('input', (e) => { state.form.prefix = e.target.value.trim().replace(/^0x/i, '').toLowerCase(); });
		root.querySelector('[data-field="suffix"]').addEventListener('input', (e) => { state.form.suffix = e.target.value.trim().toLowerCase(); });
		root.querySelectorAll('[data-preset]').forEach((b) => {
			b.addEventListener('click', () => {
				state.form.deployer = b.dataset.preset;
				state.form.deployerLabel = b.dataset.label;
				render();
			});
		});
		root.querySelector('[data-act="back"]')?.addEventListener('click', () => { state.mode = 'view'; state.err = null; render(); });
		root.querySelector('[data-act="cancel"]')?.addEventListener('click', () => abort?.abort());
		root.querySelector('[data-act="grind"]')?.addEventListener('click', onGrindAndAssign);
	}

	function renderSaved() {
		const r = state.record;
		const addr = r.predicted_address;
		const noPrefix = addr.slice(2);
		const pLen = (r.prefix || '').length;
		const sLen = (r.suffix || '').length;
		const mid = noPrefix.slice(pLen, noPrefix.length - sLen);
		const isArachnid = r.deployer.toLowerCase() === ARACHNID_PROXY;
		const canDeploy = isArachnid && !!r.init_code && !r.deployed;
		const explorer = r.deployed ? EXPLORERS[r.deployed.chain_id] : null;

		root.innerHTML = `
			<h3>Vanity address <span class="badge">CREATE2</span></h3>
			<p class="sub">
				Deterministic contract address — same on every chain that has the factory at <code style="font-family:ui-monospace,monospace">${_esc(r.deployer.slice(0,8))}…${_esc(r.deployer.slice(-4))}</code>${r.deployer_label ? ` (${_esc(r.deployer_label)})` : ''}.
			</p>
			<div class="addr">
				0x${r.prefix ? `<span class="pfx">${_esc(r.prefix)}</span>` : ''}${_esc(mid)}${r.suffix ? `<span class="sfx">${_esc(r.suffix)}</span>` : ''}
			</div>
			${r.deployed ? `
				<div class="ok">
					✓ Deployed on chain ${r.deployed.chain_id}
					${explorer ? `· <a href="${explorer}/tx/${_esc(r.deployed.tx_hash)}" target="_blank" rel="noopener">view tx</a>` : `· tx ${_esc(r.deployed.tx_hash.slice(0,12))}…`}
				</div>
			` : ''}
			<div class="meta-line">
				salt ${_esc(r.salt.slice(0, 14))}…${_esc(r.salt.slice(-4))}${r.init_code ? ' · init code stored' : ' · init code hash only'}
			</div>
			<div class="row">
				${canDeploy ? `<button class="primary" data-act="deploy" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Deploying…' : 'Deploy via Arachnid'}</button>` : ''}
				<button data-act="copy">Copy address</button>
				<button data-act="json">Download JSON</button>
				<button data-act="replace">Replace</button>
				<button class="danger" data-act="remove">Remove</button>
			</div>
			${state.ok  ? `<div class="ok">${_esc(state.ok)}</div>` : ''}
			${state.err ? `<div class="err">${_esc(state.err)}</div>` : ''}
		`;
		root.querySelector('[data-act="copy"]').addEventListener('click', async () => {
			try { await navigator.clipboard.writeText(r.predicted_address); state.ok = 'address copied'; render(); setTimeout(() => { state.ok = null; render(); }, 1500); } catch {}
		});
		root.querySelector('[data-act="json"]').addEventListener('click', () => {
			const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url; a.download = `agent-${identity.id}-vanity.json`;
			document.body.appendChild(a); a.click(); a.remove();
			URL.revokeObjectURL(url);
		});
		root.querySelector('[data-act="replace"]').addEventListener('click', async () => {
			if (!confirm('Replace the saved CREATE2 vanity record? The address above will no longer be associated with this agent.')) return;
			try {
				await fetch(`/api/agents/${encodeURIComponent(identity.id)}/eth-vanity`, { method: 'DELETE', credentials: 'include' });
				state.record = null; state.mode = 'form'; state.err = null; render();
			} catch (e) { state.err = e.message; render(); }
		});
		root.querySelector('[data-act="remove"]').addEventListener('click', async () => {
			if (!confirm('Remove the saved CREATE2 vanity record?')) return;
			try {
				await fetch(`/api/agents/${encodeURIComponent(identity.id)}/eth-vanity`, { method: 'DELETE', credentials: 'include' });
				state.record = null; state.err = null; render();
			} catch (e) { state.err = e.message; render(); }
		});
		root.querySelector('[data-act="deploy"]')?.addEventListener('click', onDeploy);
	}

	async function onGrindAndAssign() {
		state.err = null;
		const f = state.form;
		const dv = validateAddress(f.deployer);
		if (!dv.valid) { state.err = `deployer: ${dv.error}`; render(); return; }
		if (!_isHex(f.rawInitCode)) { state.err = 'init code must be 0x-prefixed even-length hex'; render(); return; }
		if (!f.prefix && !f.suffix) { state.err = 'pick a prefix or suffix'; render(); return; }
		if (f.prefix) {
			const v = validatePattern(f.prefix);
			if (!v.valid) { state.err = `prefix: ${v.errors.join('; ')}`; render(); return; }
		}
		if (f.suffix) {
			const v = validatePattern(f.suffix);
			if (!v.valid) { state.err = `suffix: ${v.errors.join('; ')}`; render(); return; }
		}

		const initCode = f.rawInitCode.toLowerCase();
		const initCodeHash = '0x' + _bytesToHex(keccak_256(_hexToBytes(initCode)));
		const ich = validateInitCodeHash(initCodeHash);
		if (!ich.valid) { state.err = `init code: ${ich.error}`; render(); return; }

		state.busy = true; state.progress = null; render();
		abort = new AbortController();
		try {
			const result = await grindCreate2Vanity({
				deployer:     dv.normalized,
				initCodeHash: ich.normalized,
				prefix:       f.prefix || undefined,
				suffix:       f.suffix || undefined,
				signal:       abort.signal,
				onProgress:   (p) => { state.progress = p; render(); },
			});

			// Save to server.
			const res = await fetch(`/api/agents/${encodeURIComponent(identity.id)}/eth-vanity`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					deployer:          result.deployer,
					salt:              result.salt,
					init_code_hash:    result.initCodeHash,
					init_code:         initCode,
					predicted_address: result.address,
					prefix:            f.prefix || null,
					suffix:            f.suffix || null,
					deployer_label:    f.deployerLabel || null,
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (res.status === 409) {
					// Already has a record; delete and retry once.
					await fetch(`/api/agents/${encodeURIComponent(identity.id)}/eth-vanity`, { method: 'DELETE', credentials: 'include' });
					return onGrindAndAssign();
				}
				throw new Error(data.error_description || `save failed (${res.status})`);
			}
			state.record  = data.data || data;
			state.mode    = 'view';
			state.progress = null;
			onAssigned?.(state.record);
		} catch (e) {
			state.err = e.name === 'AbortError' ? 'cancelled' : (e.message || 'failed');
			state.progress = null;
		} finally {
			state.busy = false; abort = null; render();
		}
	}

	async function onDeploy() {
		const r = state.record;
		if (!r || !r.init_code) { state.err = 'no init code stored — cannot deploy from this card'; render(); return; }
		if (r.deployer.toLowerCase() !== ARACHNID_PROXY) { state.err = 'one-click deploy only supported for the Arachnid proxy'; render(); return; }

		state.busy = true; state.err = null; state.ok = null; render();
		try {
			const { BrowserProvider } = await import('ethers');
			if (!window.ethereum) throw new Error('no EVM wallet detected — install MetaMask or another EIP-1193 wallet');
			const provider = new BrowserProvider(window.ethereum);
			await provider.send('eth_requestAccounts', []);
			const signer = await provider.getSigner();
			const network = await provider.getNetwork();
			const chainId = Number(network.chainId);

			// Arachnid proxy: send tx with data = salt(32) ‖ initCode → CREATE2.
			const data = r.salt + r.init_code.slice(2);

			const tx = await signer.sendTransaction({ to: r.deployer, data });
			state.ok = `submitted ${tx.hash.slice(0, 10)}…  waiting for inclusion`;
			render();
			const receipt = await tx.wait();
			if (receipt?.status !== 1) throw new Error('deploy reverted');

			// Persist deployment metadata.
			const mark = await fetch(`/api/agents/${encodeURIComponent(identity.id)}/eth-vanity/deployed`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ chain_id: chainId, tx_hash: tx.hash }),
			});
			if (mark.ok) {
				const md = await mark.json().catch(() => ({}));
				state.record = md.data || { ...r, deployed: { chain_id: chainId, tx_hash: tx.hash, at: new Date().toISOString() } };
			} else {
				state.record = { ...r, deployed: { chain_id: chainId, tx_hash: tx.hash, at: new Date().toISOString() } };
			}
			state.ok = `deployed on chain ${chainId}`;
		} catch (e) {
			state.err = e.shortMessage || e.message || 'deploy failed';
		} finally {
			state.busy = false; render();
		}
	}

	render();
	load();

	return {
		destroy: () => { abort?.abort(); wrapper.remove(); },
		refresh: () => load(),
	};
}
