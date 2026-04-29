/**
 * VanityModal — focused mini-modal for picking a Solana vanity prefix.
 *
 * Surfaces:
 *   - Live address preview ("AGNT9k4mPq3X…fT2H") that updates as the user types
 *   - Suggestion chips seeded from the agent name + curated short prefixes
 *   - Difficulty meter with per-tier (Free/Pro) callouts
 *   - Estimated grind time + paid-plan badge for >=5 chars
 *   - Mobile warning when hardwareConcurrency <= 2
 *
 * Returns the chosen prefix via `await openVanityModal({ agentName })`,
 * or `null` if the user dismisses.
 *
 * Persistence is the caller's job (see deploy-button.js).
 */

const FREE_THRESHOLD = 5;
const MAX_LENGTH = 6;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const RATE_PER_CORE = 5000; // empirical lower bound for JS Keypair.generate()
const CURATED_CHIPS = ['AGNT', 'BOT', 'NPC', 'AI', 'GOOD', 'WISE'];

function _esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[c]);
}

function _coreCount() {
	if (typeof navigator === 'undefined') return 4;
	return Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
}

function _estimateSeconds(prefixLen) {
	if (prefixLen <= 0) return 0;
	const attempts = Math.pow(58, prefixLen);
	return attempts / (RATE_PER_CORE * _coreCount());
}

function _formatTime(seconds) {
	if (seconds < 1)    return '<1s';
	if (seconds < 60)   return `~${Math.round(seconds)}s`;
	if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
	if (seconds < 86400) return `~${Math.round(seconds / 3600)}h`;
	return '>1d';
}

/** Sample base58 string (deterministic-ish — not crypto). For preview only. */
function _sampleAddress(prefix = '') {
	const len = 44 - prefix.length;
	let out = prefix;
	for (let i = 0; i < len; i++) {
		out += BASE58_ALPHABET[Math.floor(Math.random() * BASE58_ALPHABET.length)];
	}
	return out;
}

function _suggestionsFor(agentName) {
	const seeded = [];
	if (agentName) {
		// First 3-4 base58-valid chars of the name, capitalized.
		const cleaned = agentName.replace(/[^1-9A-HJ-NP-Za-km-z]/g, '');
		if (cleaned.length >= 3) seeded.push(cleaned.slice(0, 4));
	}
	const all = [...new Set([...seeded, ...CURATED_CHIPS])].slice(0, 6);
	return all;
}

const STYLE = `
.vm-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1rem; }
.vm-modal { background: #fff; border-radius: 12px; max-width: 460px; width: 100%; padding: 1.25rem 1.4rem; box-shadow: 0 20px 60px rgba(0,0,0,.3); font: 14px/1.4 system-ui, sans-serif; color: #111; }
.vm-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 .25rem; }
.vm-sub { color: #666; font-size: .8rem; margin: 0 0 1rem; }
.vm-input { font: inherit; font-family: ui-monospace, monospace; padding: .5rem .65rem; width: 100%; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; text-transform: none; }
.vm-input.invalid { border-color: #c33; background: #fff8f8; }
.vm-preview { font-family: ui-monospace, monospace; font-size: .85rem; padding: .55rem .65rem; background: #f7f7f8; border-radius: 6px; margin-top: .55rem; word-break: break-all; }
.vm-preview .pfx { background: linear-gradient(90deg,#ffd54f,#ff8a65); color: #1a1a1a; padding: 0 2px; border-radius: 2px; font-weight: 600; }
.vm-preview .rest { color: #888; }
.vm-meter { display: flex; gap: 3px; margin-top: .6rem; }
.vm-meter .seg { flex: 1; height: 6px; border-radius: 3px; background: #eee; }
.vm-meter .seg.lit-1, .vm-meter .seg.lit-2, .vm-meter .seg.lit-3, .vm-meter .seg.lit-4 { background: #4caf50; }
.vm-meter .seg.lit-5 { background: #fb8c00; }
.vm-meter .seg.lit-6 { background: #d32f2f; }
.vm-row { display: flex; justify-content: space-between; align-items: center; margin-top: .5rem; font-size: .78rem; color: #666; }
.vm-paid { background: linear-gradient(90deg,#ffd54f,#ff8a65); color: #1a1a1a; font-weight: 600; padding: .1rem .5rem; border-radius: 999px; font-size: .7rem; }
.vm-chips { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .85rem; }
.vm-chip { background: #f0f0f2; border: 1px solid #ddd; border-radius: 999px; padding: .25rem .65rem; cursor: pointer; font-family: ui-monospace, monospace; font-size: .75rem; color: #333; }
.vm-chip:hover { background: #e6e6e8; }
.vm-chip-est { color: #888; margin-left: .35rem; font-family: system-ui, sans-serif; }
.vm-warn { background: #fff3cd; color: #855008; padding: .5rem .65rem; border-radius: 6px; margin-top: .85rem; font-size: .75rem; }
.vm-actions { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1.1rem; }
.vm-btn { font: inherit; padding: .45rem .9rem; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
.vm-btn.primary { background: #111; color: #fff; border-color: #111; }
.vm-btn:disabled { opacity: .4; cursor: not-allowed; }
.vm-skip { background: none; border: none; color: #666; font-size: .75rem; cursor: pointer; margin-top: .5rem; padding: 0; }
`;

let _styleInjected = false;
function _injectStyle() {
	if (_styleInjected || typeof document === 'undefined') return;
	const tag = document.createElement('style');
	tag.id = 'vanity-modal-style';
	tag.textContent = STYLE;
	document.head.appendChild(tag);
	_styleInjected = true;
}

/**
 * Open the vanity prefix picker.
 *
 * @param {object} opts
 * @param {string} [opts.agentName]  Used to seed suggestion chips.
 * @param {string} [opts.initial]    Pre-fill (e.g. from localStorage).
 * @returns {Promise<string|null>}   Selected prefix, or null on dismiss.
 */
export function openVanityModal({ agentName = '', initial = '' } = {}) {
	_injectStyle();

	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'vm-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-labelledby', 'vm-title');

		const suggestions = _suggestionsFor(agentName);
		const isMobile = _coreCount() <= 2;
		overlay.innerHTML = `
			<div class="vm-modal">
				<h2 class="vm-title" id="vm-title">Customize your agent's address</h2>
				<p class="vm-sub">Pick characters your agent's Solana address should start with.</p>

				<label for="vm-input" style="font-size:.8rem;color:#444;">Prefix (Base58, max ${MAX_LENGTH})</label>
				<input id="vm-input" class="vm-input" type="text" maxlength="${MAX_LENGTH}"
					placeholder="e.g. AGNT" autocomplete="off" spellcheck="false"
					value="${_esc(initial)}" />

				<div class="vm-preview" aria-live="polite" id="vm-preview"></div>

				<div class="vm-meter" aria-hidden="true">
					${[1, 2, 3, 4, 5, 6].map((i) => `<div class="seg" data-seg="${i}"></div>`).join('')}
				</div>

				<div class="vm-row">
					<span id="vm-est">enter a prefix above</span>
					<span id="vm-tier"></span>
				</div>

				<div class="vm-chips" aria-label="Suggested prefixes">
					${suggestions.map((s) => `
						<button class="vm-chip" data-prefix="${_esc(s)}" type="button">
							${_esc(s)}<span class="vm-chip-est">${_formatTime(_estimateSeconds(s.length))}</span>
						</button>`).join('')}
				</div>

				${isMobile ? `<div class="vm-warn">⚠️ Vanity addresses work best on desktop — your device has limited CPU cores.</div>` : ''}

				<div class="vm-actions">
					<button class="vm-btn" id="vm-cancel" type="button">Cancel</button>
					<button class="vm-btn primary" id="vm-ok" type="button" disabled>Use prefix</button>
				</div>
				<button class="vm-skip" id="vm-skip" type="button">Skip — use a random address</button>
			</div>
		`;
		document.body.appendChild(overlay);

		const input    = overlay.querySelector('#vm-input');
		const preview  = overlay.querySelector('#vm-preview');
		const meter    = overlay.querySelectorAll('.vm-meter .seg');
		const estEl    = overlay.querySelector('#vm-est');
		const tierEl   = overlay.querySelector('#vm-tier');
		const okBtn    = overlay.querySelector('#vm-ok');

		let previewTimer = null;
		function update() {
			const raw = input.value;
			const valid = !raw || BASE58_RE.test(raw);
			input.classList.toggle('invalid', !valid);

			meter.forEach((seg, idx) => {
				seg.className = 'seg' + (raw.length > idx ? ` lit-${raw.length}` : '');
			});

			if (!raw) {
				preview.innerHTML = '<span class="rest">' + _esc(_sampleAddress()) + '</span>';
				estEl.textContent = 'enter a prefix above';
				tierEl.innerHTML = '';
				okBtn.disabled = true;
				return;
			}
			if (!valid) {
				preview.textContent = 'invalid Base58 — avoid 0, O, I, l';
				estEl.textContent = '';
				tierEl.innerHTML = '';
				okBtn.disabled = true;
				return;
			}
			const sample = _sampleAddress(raw);
			preview.innerHTML = `<span class="pfx">${_esc(raw)}</span><span class="rest">${_esc(sample.slice(raw.length))}</span>`;
			estEl.textContent = `est. ${_formatTime(_estimateSeconds(raw.length))} on ${_coreCount()} cores`;
			tierEl.innerHTML = raw.length >= FREE_THRESHOLD
				? `<span class="vm-paid">✦ Paid plan</span>`
				: `<span style="color:#1b5e20;font-weight:600">Free</span>`;
			okBtn.disabled = false;
		}

		// Animate the preview's tail every 600ms so it feels alive — only when prefix is set.
		function startPreviewLoop() {
			stopPreviewLoop();
			previewTimer = setInterval(() => {
				const raw = input.value;
				if (raw && BASE58_RE.test(raw)) {
					const sample = _sampleAddress(raw);
					const pfxNode = preview.querySelector('.pfx');
					const restNode = preview.querySelector('.rest');
					if (pfxNode && restNode) restNode.textContent = sample.slice(raw.length);
				}
			}, 600);
		}
		function stopPreviewLoop() {
			if (previewTimer) clearInterval(previewTimer);
			previewTimer = null;
		}

		input.addEventListener('input', update);
		overlay.querySelectorAll('.vm-chip').forEach((c) => {
			c.addEventListener('click', () => {
				input.value = c.dataset.prefix;
				update();
				input.focus();
			});
		});

		function close(value) {
			stopPreviewLoop();
			overlay.remove();
			document.removeEventListener('keydown', onKey);
			resolve(value);
		}
		function onKey(e) {
			if (e.key === 'Escape') close(null);
			if (e.key === 'Enter' && !okBtn.disabled) close(input.value.trim());
		}
		overlay.querySelector('#vm-cancel').addEventListener('click', () => close(null));
		overlay.querySelector('#vm-skip').addEventListener('click', () => close(''));
		overlay.querySelector('#vm-ok').addEventListener('click', () => close(input.value.trim()));
		overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
		document.addEventListener('keydown', onKey);

		update();
		startPreviewLoop();
		setTimeout(() => input.focus(), 50);
	});
}
