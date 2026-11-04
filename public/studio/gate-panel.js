// "Holders only" panel for /studio: turn an avatar the creator owns into a
// token-gated embed without touching the API by hand.
//
// The gate itself lives on the server (api/embed/gate-create.js stores it,
// api/embed/resolve.js enforces it on every fetch with a real Solana balance
// read). This panel only reads that gate back, creates or replaces it, and
// removes it, so what it shows is always what a viewer will actually meet.
//
// $THREE is the default token. A creator may name another SPL mint in the
// advanced field; that mint is runtime data passed straight to the endpoint.
//
// Exported pure functions (tested in tests/studio-gate-control.test.js):
//   gateAssetId, shortMint, isSolanaMint, parseMinAmount, buildGateRequest,
//   tierShortcuts, formatTokenAmount, gateErrorState, gateResultView
//
// DOM entry: mountGatePanel takes the panel element plus the getAvatarId,
// getOwnedAvatar, getUser and onPickAvatar callbacks, and returns an object
// whose avatarChanged method the studio calls on every avatar pick.

export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
export const THREE_SYMBOL = '$THREE';

// The server's ceiling on a threshold (api/_lib/embed-gate.js MAX_MIN_AMOUNT).
// Refusing above it here beats a silent server-side clamp the creator never sees.
const MAX_MIN_AMOUNT = 1e15;
// SPL tokens carry at most 9 decimals, so a finer threshold cannot be held.
const MAX_DECIMALS = 9;

const AVATAR_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT_RE = /^(\d+(\.\d*)?|\.\d+)$/;

// ── Pure logic ──────────────────────────────────────────────────────────────

/** The `avatar:<id>` embed asset spec for a library avatar, or null. */
export function gateAssetId(avatarId) {
	const id = String(avatarId ?? '').trim();
	return AVATAR_ID_RE.test(id) ? `avatar:${id}` : null;
}

/** First and last four characters of a mint, for display. */
export function shortMint(mint) {
	const m = String(mint ?? '');
	return m.length > 12 ? `${m.slice(0, 4)}...${m.slice(-4)}` : m;
}

export function isSolanaMint(value) {
	return BASE58_RE.test(String(value ?? '').trim());
}

/** Parse the minimum-amount field. Commas and spaces are grouping, not data. */
export function parseMinAmount(raw) {
	const s = String(raw ?? '').replace(/[\s,]/g, '');
	if (!s) return { ok: false, message: 'Enter how many tokens a viewer must hold.' };
	if (!AMOUNT_RE.test(s)) return { ok: false, message: 'The minimum must be a number above zero.' };
	const decimals = s.includes('.') ? s.split('.')[1].length : 0;
	if (decimals > MAX_DECIMALS) {
		return { ok: false, message: `Use at most ${MAX_DECIMALS} decimal places, the finest amount a Solana token can hold.` };
	}
	const value = Number(s);
	if (!Number.isFinite(value) || value <= 0) return { ok: false, message: 'The minimum must be a number above zero.' };
	if (value > MAX_MIN_AMOUNT) {
		return { ok: false, message: 'That minimum is too large for any real token supply. Enter a smaller amount.' };
	}
	return { ok: true, value };
}

/**
 * The POST /api/embed/gate-create body, or the per-field errors that stop it.
 * `mint` is omitted when it is empty or $THREE, so the server default applies.
 */
export function buildGateRequest({ avatarId, minAmount, mint }) {
	const errors = {};
	const assetId = gateAssetId(avatarId);
	if (!assetId) errors.avatar = 'Pick an avatar you own first.';
	const amount = parseMinAmount(minAmount);
	if (!amount.ok) errors.minAmount = amount.message;
	const mintStr = String(mint ?? '').trim();
	if (mintStr && !isSolanaMint(mintStr)) {
		errors.mint = 'That is not a Solana token mint address. Paste the mint (32 to 44 base58 characters), or clear the field to use $THREE.';
	}
	if (Object.keys(errors).length) return { ok: false, errors };
	const gate = { minAmount: amount.value, chain: 'solana' };
	if (mintStr && mintStr !== THREE_MINT) gate.mint = mintStr;
	return { ok: true, body: { assetId, gate } };
}

/**
 * Token counts for each paid $THREE tier at the live price. The tiers are USD
 * thresholds (api/_lib/three-tier.js), so a count is the smallest whole number
 * of tokens worth at least the tier's bar. Empty without a usable price.
 */
export function tierShortcuts(ladder, priceUsd) {
	const price = Number(priceUsd);
	if (!Array.isArray(ladder) || !Number.isFinite(price) || price <= 0) return [];
	const out = [];
	for (const t of ladder) {
		const minUsd = Number(t?.min_usd);
		if (!(Number(t?.level) >= 1) || !Number.isFinite(minUsd) || minUsd <= 0) continue;
		let tokens = Math.ceil(minUsd / price);
		if ((tokens - 1) * price >= minUsd) tokens -= 1;
		while (tokens * price < minUsd) tokens += 1;
		out.push({ id: t.id, label: t.label, minUsd, tokens });
	}
	return out;
}

export function formatTokenAmount(n) {
	return Number(n).toLocaleString('en-US', { maximumFractionDigits: MAX_DECIMALS });
}

function waitPhrase(seconds) {
	const s = Math.max(1, Math.round(Number(seconds) || 60));
	if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
	const m = Math.ceil(s / 60);
	return `${m} minute${m === 1 ? '' : 's'}`;
}

/**
 * What a failed request tells the creator, and the one action that recovers.
 * `status` 0 means the request never got an answer.
 */
export function gateErrorState(status, body, { returnTo = '/studio' } = {}) {
	const retry = { label: 'Try again', retry: true };
	if (!status) {
		return { kind: 'network', message: 'Could not reach three.ws. Check your connection, then try again.', action: retry };
	}
	if (status === 401) {
		return {
			kind: 'auth',
			message: 'Your session ended. Sign in again to gate this avatar.',
			action: { label: 'Sign in', href: `/login?next=${encodeURIComponent(returnTo)}` },
		};
	}
	if (status === 403) {
		return {
			kind: 'not_owner',
			message: 'You can only gate an avatar you own. This one belongs to another account.',
			action: { label: 'Pick one of your avatars', pick: true },
		};
	}
	if (status === 404) {
		return {
			kind: 'not_found',
			message: 'This avatar no longer exists, so it cannot be gated.',
			action: { label: 'Pick another avatar', pick: true },
		};
	}
	if (status === 429) {
		const unavailable = body?.reason === 'rate_limiter_unavailable';
		return {
			kind: 'rate_limited',
			message: unavailable
				? 'Gating is briefly unavailable. Try again in a minute.'
				: `Too many gate changes in a short time. Try again in about ${waitPhrase(body?.retry_after)}.`,
			action: retry,
		};
	}
	if (status === 400) {
		return {
			kind: 'validation',
			message: body?.error_description || 'The server rejected this gate. Check the amount and token.',
			action: null,
		};
	}
	return {
		kind: 'server',
		message: `three.ws could not save the gate right now (HTTP ${status}). Nothing was changed.`,
		action: retry,
	};
}

/** Display model for a gate response (create or read), or null when ungated. */
export function gateResultView(resp) {
	if (!resp || !resp.gate) return null;
	const { mint, minAmount } = resp.gate;
	const isThree = !mint || mint === THREE_MINT;
	const token = isThree ? THREE_SYMBOL : shortMint(mint);
	return {
		gateId: resp.gateId || null,
		assetId: resp.assetId,
		mint: mint || THREE_MINT,
		minAmount: Number(minAmount),
		isThree,
		requirement: `Hold ${formatTokenAmount(minAmount)} ${token} to unlock`,
		snippet: resp.embed?.snippet || '',
		previewUrl: resp.embed?.previewUrl || '',
	};
}

// ── Network ─────────────────────────────────────────────────────────────────

async function request(url, init = {}) {
	let res;
	try {
		res = await fetch(url, {
			credentials: 'include',
			headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
			...init,
		});
	} catch {
		return { status: 0, body: null };
	}
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	return { status: res.status, ok: res.ok, body };
}

// The tier ladder and the live price are page-wide facts; read them once.
let _pricingPromise = null;
function loadTierPricing() {
	if (!_pricingPromise) {
		_pricingPromise = Promise.all([request('/api/token/price'), request('/api/three/tier')]).then(([price, tier]) => {
			const priceUsd = price.ok ? Number(price.body?.price_usd) : NaN;
			const ladder = tier.ok ? tier.body?.ladder : null;
			const shortcuts = tierShortcuts(ladder, priceUsd);
			if (!shortcuts.length) _pricingPromise = null;
			return { shortcuts, priceUsd };
		});
	}
	return _pricingPromise;
}

async function copyText(text, input) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			input?.focus();
			input?.select?.();
			return document.execCommand('copy');
		} catch {
			return false;
		}
	}
}

// ── DOM ─────────────────────────────────────────────────────────────────────

function h(tag, props = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'text') el.textContent = v;
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat()) if (c != null && c !== false) el.append(c);
	return el;
}

export function mountGatePanel(root, { getAvatarId, getOwnedAvatar, getUser, onPickAvatar } = {}) {
	// What the server says about the current avatar: null until read.
	let current = { assetId: null, view: null };
	let open = false;
	let editing = false;
	let readSeq = 0;

	const toggle = h('button', {
		type: 'button',
		class: 'gate-switch',
		role: 'switch',
		'aria-checked': 'false',
		'aria-labelledby': 'gate-panel-title',
		'aria-controls': 'gate-panel-body',
	}, h('span', { class: 'gate-switch-knob', 'aria-hidden': 'true' }));
	const status = h('span', { class: 'gate-status', 'aria-live': 'polite' });
	const body = h('div', { class: 'gate-body', id: 'gate-panel-body', hidden: true });

	root.classList.add('gate-panel');
	root.replaceChildren(
		h('div', { class: 'gate-head' },
			h('div', { class: 'gate-head-text' },
				h('h2', { id: 'gate-panel-title', text: 'Holders only' }),
				h('p', { class: 'gate-sub', text: 'Only wallets holding a token can open this avatar\'s embed. three.ws checks the balance on Solana every time it loads.' }),
			),
			h('div', { class: 'gate-head-ctl' }, status, toggle),
		),
		body,
	);

	function returnTo() {
		return location.pathname + location.search;
	}

	function setSwitch(on) {
		toggle.setAttribute('aria-checked', String(on));
		body.hidden = !on;
		status.textContent = current.view ? 'On' : '';
		status.classList.toggle('is-on', Boolean(current.view));
	}

	function render(node) {
		body.replaceChildren(node);
	}

	function errorBox(state, onRetry) {
		const box = h('div', { class: 'gate-error', role: 'alert' }, h('p', { text: state.message }));
		const a = state.action;
		if (a?.href) box.append(h('a', { class: 'btn-ghost btn-sm', href: a.href, text: a.label }));
		else if (a?.retry && onRetry) box.append(h('button', { type: 'button', class: 'btn-ghost btn-sm', text: a.label, onclick: onRetry }));
		else if (a?.pick) box.append(h('button', { type: 'button', class: 'btn-ghost btn-sm', text: a.label, onclick: () => onPickAvatar?.() }));
		return box;
	}

	function emptyState() {
		const user = getUser?.();
		if (!user) {
			return h('div', { class: 'gate-empty' },
				h('p', { text: 'Sign in to gate an avatar you own. Visitors below the bar see a locked preview; holders get the full 3D embed.' }),
				h('a', { class: 'btn-ghost btn-sm', href: `/login?next=${encodeURIComponent(returnTo())}`, text: 'Sign in' }),
			);
		}
		const picked = getAvatarId?.();
		return h('div', { class: 'gate-empty' },
			h('p', {
				text: picked
					? 'Pick one of your own avatars first. The demo agent and public avatars belong to other accounts, so only their owners can gate them.'
					: 'Pick an avatar first. Gating works on avatars in your library.',
			}),
			h('button', { type: 'button', class: 'btn-ghost btn-sm', text: 'Go to your avatars', onclick: () => onPickAvatar?.() }),
		);
	}

	function skeleton() {
		return h('div', { class: 'gate-skeleton', 'aria-busy': 'true', 'aria-label': 'Checking this avatar\'s gate' },
			h('span', { class: 'gate-skel-line' }),
			h('span', { class: 'gate-skel-line gate-skel-line--short' }),
			h('span', { class: 'gate-skel-block' }),
		);
	}

	function copyRow(value, label) {
		const ta = h('textarea', { rows: '3', readonly: true, 'aria-label': label });
		ta.value = value;
		const btn = h('button', { type: 'button', class: 'btn-ghost btn-sm', text: 'Copy' });
		btn.addEventListener('click', async () => {
			const ok = await copyText(value, ta);
			btn.textContent = ok ? 'Copied' : 'Select and copy';
			setTimeout(() => (btn.textContent = 'Copy'), 1400);
		});
		return h('div', { class: 'copy-row' }, ta, btn);
	}

	function gateView(view, { justCreated = false } = {}) {
		const removeBtn = h('button', { type: 'button', class: 'btn-danger btn-sm', text: 'Remove gate' });
		const changeBtn = h('button', { type: 'button', class: 'btn-ghost btn-sm', text: 'Change requirement' });
		const actions = h('div', { class: 'gate-actions' }, changeBtn, removeBtn);
		changeBtn.addEventListener('click', () => {
			editing = true;
			render(form(view));
		});
		removeBtn.addEventListener('click', () => actions.replaceWith(confirmRemove(actions)));

		const wrap = h('div', { class: 'gate-result' },
			h('p', { class: 'gate-result-title' },
				h('span', { class: 'gate-dot', 'aria-hidden': 'true' }),
				justCreated ? 'Gate created. ' : 'Gate active. ',
				h('strong', { text: view.requirement }),
			),
			view.isThree ? null : h('p', { class: 'gate-mint-note' }, 'Token mint ', h('code', { text: view.mint })),
			h('label', { class: 'field' }, h('span', { text: 'Embed snippet' }), copyRow(view.snippet, 'Gated embed snippet')),
			h('p', { class: 'gate-hint', text: 'Paste it on any page. Visitors below the bar see "Hold to unlock"; raising the bar later signs everyone out of the old one.' }),
			view.previewUrl
				? h('a', { class: 'btn-ghost btn-sm gate-preview-link', href: view.previewUrl, target: '_blank', rel: 'noopener', text: 'Open the gated preview' })
				: null,
			actions,
		);
		return wrap;
	}

	function confirmRemove(actions) {
		const err = h('div');
		const yes = h('button', { type: 'button', class: 'btn-danger btn-sm', text: 'Remove the gate' });
		const no = h('button', { type: 'button', class: 'btn-ghost btn-sm', text: 'Keep it' });
		const box = h('div', { class: 'gate-confirm', role: 'group', 'aria-label': 'Confirm removing the gate' },
			h('p', { text: 'Anyone with the snippet will see this avatar without holding anything. Remove the gate?' }),
			h('div', { class: 'gate-actions' }, no, yes),
			err,
		);
		no.addEventListener('click', () => box.replaceWith(actions));
		yes.addEventListener('click', async () => {
			yes.disabled = no.disabled = true;
			yes.classList.add('is-busy');
			const r = await request(`/api/embed/gate-create?assetId=${encodeURIComponent(current.assetId)}`, { method: 'DELETE' });
			if (!r.ok) {
				yes.disabled = no.disabled = false;
				yes.classList.remove('is-busy');
				err.replaceChildren(errorBox(gateErrorState(r.status, r.body, { returnTo: returnTo() }), () => yes.click()));
				return;
			}
			current.view = null;
			editing = false;
			open = false;
			setSwitch(false);
			render(form(null));
			toggle.focus();
		});
		setTimeout(() => no.focus(), 0);
		return box;
	}

	function form(existing) {
		const avatar = getOwnedAvatar?.();
		const mintInput = h('input', {
			type: 'text',
			id: 'gate-mint',
			autocomplete: 'off',
			spellcheck: 'false',
			placeholder: 'Leave empty to use $THREE',
			'aria-describedby': 'gate-mint-err',
		});
		const mintErr = h('p', { class: 'gate-field-err', id: 'gate-mint-err', hidden: true });
		const amountInput = h('input', {
			type: 'text',
			id: 'gate-amount',
			inputmode: 'decimal',
			autocomplete: 'off',
			placeholder: 'e.g. 50,000',
			'aria-describedby': 'gate-amount-err gate-amount-usd',
		});
		const amountErr = h('p', { class: 'gate-field-err', id: 'gate-amount-err', hidden: true });
		const amountUsd = h('p', { class: 'gate-amount-usd', id: 'gate-amount-usd' });
		const tokenLabel = h('span', { class: 'gate-token-symbol', text: THREE_SYMBOL });
		const tiers = h('div', { class: 'gate-tiers', role: 'group', 'aria-label': 'Set the minimum to a $THREE holder tier' });
		const tiersWrap = h('div', { class: 'gate-tiers-wrap' }, h('p', { class: 'gate-tiers-label', text: 'Or match a $THREE holder tier' }), tiers);
		const submit = h('button', { type: 'submit', class: 'btn-primary gate-submit' }, h('span', { class: 'gate-submit-label', text: existing ? 'Update gate' : 'Create gated embed' }));
		const formErr = h('div', { class: 'gate-form-err' });
		const cancel = existing
			? h('button', { type: 'button', class: 'btn-ghost', text: 'Cancel', onclick: () => { editing = false; render(gateView(existing)); } })
			: null;
		let priceUsd = NaN;

		if (existing) {
			amountInput.value = formatTokenAmount(existing.minAmount);
			if (!existing.isThree) mintInput.value = existing.mint;
		}

		const advanced = h('details', { class: 'gate-advanced', open: existing && !existing.isThree ? true : null },
			h('summary', { text: 'Use another Solana token' }),
			h('label', { class: 'field', for: 'gate-mint' }, h('span', { text: 'Token mint address' }), mintInput),
			mintErr,
		);

		function isThreeSelected() {
			const m = mintInput.value.trim();
			return !m || m === THREE_MINT;
		}

		function refreshToken() {
			const three = isThreeSelected();
			tokenLabel.textContent = three ? THREE_SYMBOL : (isSolanaMint(mintInput.value) ? shortMint(mintInput.value.trim()) : 'tokens');
			tiersWrap.hidden = !three;
			refreshUsd();
		}

		function refreshUsd() {
			const p = parseMinAmount(amountInput.value);
			amountUsd.textContent = p.ok && isThreeSelected() && Number.isFinite(priceUsd)
				? `About $${(p.value * priceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })} at today's price`
				: '';
			for (const b of tiers.querySelectorAll('button')) {
				b.setAttribute('aria-pressed', String(p.ok && Number(b.dataset.tokens) === p.value));
			}
		}

		function showFieldError(input, el, msg) {
			el.textContent = msg || '';
			el.hidden = !msg;
			input.setAttribute('aria-invalid', msg ? 'true' : 'false');
		}

		function renderTiers() {
			tiers.replaceChildren(...Array.from({ length: 4 }, () => h('span', { class: 'gate-tier gate-tier--skeleton', 'aria-hidden': 'true' })));
			tiers.setAttribute('aria-busy', 'true');
			loadTierPricing().then(({ shortcuts, priceUsd: p }) => {
				tiers.removeAttribute('aria-busy');
				if (!shortcuts.length) {
					tiers.replaceChildren(
						h('p', { class: 'gate-tiers-note' }, 'The live $THREE price is unavailable, so tier shortcuts are hidden. Enter an amount, or ',
							h('button', { type: 'button', class: 'gate-link-btn', text: 'retry', onclick: renderTiers }), '.'),
					);
					return;
				}
				priceUsd = p;
				tiers.replaceChildren(...shortcuts.map((t) => h('button', {
					type: 'button',
					class: 'gate-tier',
					'data-tokens': String(t.tokens),
					'aria-pressed': 'false',
					onclick: () => {
						amountInput.value = formatTokenAmount(t.tokens);
						showFieldError(amountInput, amountErr, '');
						refreshUsd();
					},
				}, h('span', { class: 'gate-tier-name', text: t.label }), h('span', { class: 'gate-tier-amt', text: `$${t.minUsd.toLocaleString('en-US')} = ${formatTokenAmount(t.tokens)}` }))));
				refreshUsd();
			});
		}

		amountInput.addEventListener('input', () => {
			showFieldError(amountInput, amountErr, '');
			refreshUsd();
		});
		mintInput.addEventListener('input', () => {
			showFieldError(mintInput, mintErr, '');
			refreshToken();
		});

		const el = h('form', { class: 'gate-form', novalidate: true },
			h('p', { class: 'gate-asset' }, 'Gating ', h('strong', { text: avatar?.name || 'this avatar' })),
			h('div', { class: 'field' },
				h('span', { text: 'Token' }),
				h('div', { class: 'gate-token-chip' },
					h('strong', { text: THREE_SYMBOL }),
					h('code', { text: shortMint(THREE_MINT), title: THREE_MINT }),
					h('span', { class: 'muted', text: 'Solana' }),
				),
			),
			advanced,
			h('div', { class: 'field' },
				h('label', { for: 'gate-amount', text: 'Minimum a viewer must hold' }),
				h('div', { class: 'gate-amount-row' }, amountInput, tokenLabel),
				amountErr,
				amountUsd,
			),
			tiersWrap,
			h('div', { class: 'gate-actions' }, cancel, submit),
			formErr,
		);

		el.addEventListener('submit', async (e) => {
			e.preventDefault();
			formErr.replaceChildren();
			const built = buildGateRequest({ avatarId: getOwnedAvatar?.()?.id, minAmount: amountInput.value, mint: mintInput.value });
			if (!built.ok) {
				showFieldError(amountInput, amountErr, built.errors.minAmount);
				showFieldError(mintInput, mintErr, built.errors.mint);
				if (built.errors.mint) advanced.open = true;
				if (built.errors.avatar) formErr.replaceChildren(errorBox({ message: built.errors.avatar, action: { label: 'Go to your avatars', pick: true } }));
				(built.errors.minAmount ? amountInput : built.errors.mint ? mintInput : submit).focus();
				return;
			}
			submit.disabled = true;
			submit.classList.add('is-busy');
			submit.setAttribute('aria-busy', 'true');
			const r = await request('/api/embed/gate-create', { method: 'POST', body: JSON.stringify(built.body) });
			submit.disabled = false;
			submit.classList.remove('is-busy');
			submit.removeAttribute('aria-busy');
			if (r.status !== 201) {
				const state = gateErrorState(r.status, r.body, { returnTo: returnTo() });
				formErr.replaceChildren(errorBox(state, () => el.requestSubmit()));
				return;
			}
			// The asset may have changed while the request was in flight.
			if (r.body?.assetId !== gateAssetId(getOwnedAvatar?.()?.id)) return;
			current = { assetId: r.body.assetId, view: gateResultView(r.body) };
			editing = false;
			setSwitch(true);
			render(gateView(current.view, { justCreated: true }));
			body.querySelector('.copy-row button')?.focus();
		});

		renderTiers();
		refreshToken();
		return el;
	}

	// The asset whose gate is loaded or loading, so re-selecting the same
	// avatar does not refetch.
	let readFor;
	async function readCurrent({ force = false } = {}) {
		const avatar = getOwnedAvatar?.();
		const assetId = gateAssetId(avatar?.id);
		if (!force && readFor !== undefined && assetId === readFor) return;
		readFor = assetId;
		const seq = ++readSeq;
		if (!getUser?.() || !assetId) {
			current = { assetId: null, view: null };
			setSwitch(open);
			render(emptyState());
			return;
		}
		current = { assetId, view: null };
		status.textContent = '';
		render(skeleton());
		const r = await request(`/api/embed/gate-create?assetId=${encodeURIComponent(assetId)}`);
		if (seq !== readSeq) return;
		if (!r.ok) {
			readFor = undefined;
			setSwitch(open);
			render(errorBox(gateErrorState(r.status, r.body, { returnTo: returnTo() }), () => readCurrent({ force: true })));
			return;
		}
		current.view = gateResultView(r.body);
		if (current.view) open = true;
		editing = false;
		setSwitch(open);
		render(current.view ? gateView(current.view) : form(null));
	}

	toggle.addEventListener('click', () => {
		if (open && current.view) {
			// Switching off an active gate is a real change on live sites, so it
			// goes through the same confirmation as the Remove button.
			if (editing) render(gateView(current.view));
			const actions = body.querySelector('.gate-actions');
			if (actions && !body.querySelector('.gate-confirm')) actions.replaceWith(confirmRemove(actions));
			return;
		}
		open = !open;
		setSwitch(open);
		if (open && !body.firstChild) readCurrent();
		if (open) body.querySelector('input, button, a')?.focus({ preventScroll: true });
	});

	readCurrent();

	return {
		avatarChanged() {
			readCurrent();
		},
	};
}
