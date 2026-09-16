// /launch: pick one of your 3D agents, name a coin, launch it on pump.fun and
// claim its creator rewards, all on three.ws.
//
// Data flow:
//   GET  /api/auth/me, /api/avatars          who is here and which agents they own
//   GET  /api/pump/launch-config             live fee, v1 activation, create cost
//   POST /api/pump/build-metadata            image + metadata pinned, linked to the agent
//   POST /api/pump/launch-prep               server-built tx (mint pre-signed, fee inside)
//        wallet signs → RPC → confirm → POST /api/pump/launch-confirm
//   POST /api/pump/launch-agent              the agent's own wallet launches instead
//   GET  /api/pump/my-coins                  coins + unclaimed rewards per creator wallet
//   POST /api/pump/collect-creator-fee-prep  wallet claim (all quote mints)
//   POST /api/pump/collect-creator-fee-agent agent-wallet claim
//
// Launch Studio recipe links (?reward=) need the fee-split handoff the full
// studio panel owns, so those visits mount that panel instead.

import './launch-page.css';
import { ensureRiskAck } from '../shared/risk-ack.js';
import { ensureModelViewer } from '../shared/model-viewer-loader.js';
import {
	DESCRIPTION_MAX,
	DEV_BUY_PRESETS,
	NAME_MAX,
	SYMBOL_MAX,
	formatAmount,
	friendlyLaunchError,
	launchCost,
	launchProblems,
	normalizeSymbol,
	parseBuyIn,
	shareText,
	shortAddress,
	suggestSymbol,
} from './launch-model.js';
import {
	connectLaunchWallet,
	injectedProvider,
	linkWallet,
	restoreLaunchWallet,
	signAndBroadcast,
	solBalance,
	waitForConfirmation,
	walletInstalled,
} from './launch-wallet.js';

const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_MAX_DIM = 1024;

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
	config: null,
	user: undefined,
	agents: null,
	agentsError: '',
	agentQuery: '',
	form: {
		agentId: null,
		name: '',
		symbol: '',
		symbolTouched: false,
		description: '',
		website: '',
		twitter: '',
		telegram: '',
		buyIn: '',
		quote: 'sol',
		rewards: 'creator',
		mayhem: false,
		launcher: 'wallet',
		txFormat: 'auto',
		imageDataUrl: '',
		imageName: '',
	},
	wallet: null,
	walletBusy: false,
	walletError: '',
	walletConflict: null,
	balance: null,
	agentWallet: null,
	agentWalletError: '',
	running: false,
	coins: null,
	coinsError: '',
	claiming: new Set(),
};

// ── Networking ─────────────────────────────────────────────────────────────

async function api(path, { method = 'GET', body } = {}) {
	const res = await fetch(path, {
		method,
		credentials: 'include',
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const issues = Array.isArray(data?.issues) ? data.issues.map((i) => i.message).join('; ') : '';
		throw Object.assign(new Error(data?.error_description || issues || data?.error || `Request failed (${res.status})`), {
			code: data?.error,
			status: res.status,
		});
	}
	return data;
}

const selectedAgent = () => state.agents?.find((a) => a.id === state.form.agentId) || null;
const feeBps = () => state.config?.launch_fee_bps ?? 0;
const cost = () =>
	launchCost({
		buyIn: parseBuyIn(state.form.buyIn),
		quote: state.form.quote,
		feeBps: feeBps(),
		createCostSol: state.config?.create_cost_sol_estimate,
	});

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
	const root = $('#launch-app');
	const params = new URL(location.href).searchParams;
	if (params.get('reward')) {
		$('#lx-tabs').hidden = true;
		mountRecipePanel(root);
		return;
	}
	applyPrefill(params);
	renderShell(root);
	wireTabs(params.get('tab') === 'coins' ? 'coins' : 'create');
	wireForm();
	updateDerived();

	api('/api/pump/launch-config')
		.then(({ data }) => {
			state.config = data;
			renderLaunchOptions();
			updateDerived();
		})
		.catch(() => {
			state.config = { launch_fee_bps: 0, create_cost_sol_estimate: 0.022, tx_v1: { active: false }, config_error: true };
			updateDerived();
		});

	restoreLaunchWallet().then((w) => {
		if (w && !state.wallet) {
			state.wallet = w;
			refreshBalance();
			renderWallet();
			updateDerived();
		}
	});

	await loadIdentity(params.get('avatar'));
}

async function loadIdentity(wantedAvatar) {
	state.agents = null;
	state.agentsError = '';
	renderAgents();
	try {
		const me = await fetch('/api/auth/me', { credentials: 'include' });
		if (me.status === 401 || me.status === 403) state.user = null;
		else if (!me.ok) throw new Error(`the session check answered ${me.status}`);
		else state.user = (await me.json()).user || null;

		if (state.user) {
			const { avatars = [] } = await api('/api/avatars?limit=100');
			state.agents = avatars;
			const match = wantedAvatar && avatars.find((a) => a.id === wantedAvatar || a.slug === wantedAvatar);
			state.form.agentId = (match || avatars[0])?.id || null;
		} else {
			state.agents = [];
		}
	} catch (err) {
		state.agentsError = /failed to fetch/i.test(err.message) ? 'three.ws could not be reached' : err.message;
		state.agents = [];
	}
	renderAgents();
	renderPreviewStage();
	updateDerived();
	if (!$('#panel-coins').hidden) loadCoins();
}

function applyPrefill(params) {
	const f = state.form;
	f.name = (params.get('name') || '').slice(0, NAME_MAX);
	if (params.get('symbol')) {
		f.symbol = normalizeSymbol(params.get('symbol'));
		f.symbolTouched = true;
	} else if (f.name) f.symbol = suggestSymbol(f.name);
	f.description = (params.get('description') || '').slice(0, DESCRIPTION_MAX);
	const buy = parseBuyIn(params.get('initialBuy'));
	if (buy > 0) f.buyIn = String(buy);
	let image = params.get('image') || '';
	if (!image && params.get('imageSession')) {
		try {
			image = sessionStorage.getItem('twx.launch.image') || '';
		} catch {
			image = '';
		}
	}
	if (image.startsWith('data:image/')) {
		f.imageDataUrl = image;
		f.imageName = 'snapshot.png';
	} else if (/^https:\/\//.test(image)) {
		importImageUrl(image);
	}
}

// Recipe deep links keep their fee-routing promise through the full studio panel.
async function mountRecipePanel(root) {
	root.innerHTML = '<div class="lx-card"><p class="lx-card-note">Loading the recipe launcher…</p></div>';
	const spec = '/launch/launch.js';
	try {
		const { mountLaunchCoin } = await import(/* @vite-ignore */ spec);
		root.innerHTML = '';
		mountLaunchCoin(root);
	} catch (err) {
		root.innerHTML = `<div class="lx-empty is-error"><strong>The recipe launcher did not load.</strong>${esc(err.message)}<a class="lx-btn" href="/launch">Open the standard launcher</a></div>`;
	}
}

// ── Shell ──────────────────────────────────────────────────────────────────

function renderShell(root) {
	const f = state.form;
	root.innerHTML = `
	<div class="lx-grid" id="panel-create" role="tabpanel" aria-labelledby="tab-create">
		<form class="lx-form" id="lx-form" novalidate>
			<section class="lx-card" aria-labelledby="h-agent">
				<div class="lx-card-h"><h2 id="h-agent"><span class="lx-step" data-step="agent">1</span>Link a 3D agent</h2><a class="lx-link" href="/create-agent">New agent</a></div>
				<p class="lx-card-note">The coin launches for this agent. Its page becomes the coin's website and its 3D body rides in the token metadata.</p>
				<div id="lx-agents"></div>
			</section>

			<section class="lx-card" aria-labelledby="h-details">
				<div class="lx-card-h"><h2 id="h-details"><span class="lx-step" data-step="details">2</span>Coin details</h2></div>
				<p class="lx-card-note">Choose carefully: the name, ticker and image are permanent once the coin is created.</p>
				<div class="lx-row">
					<label class="lx-field" style="margin-top:0">
						<span class="lx-label">Coin name <span class="lx-count" id="c-name">0/${NAME_MAX}</span></span>
						<input class="lx-input" id="f-name" name="name" maxlength="${NAME_MAX}" autocomplete="off" placeholder="Name your coin" value="${esc(f.name)}" />
					</label>
					<label class="lx-field" style="margin-top:0">
						<span class="lx-label">Ticker <span class="lx-count" id="c-symbol">0/${SYMBOL_MAX}</span></span>
						<input class="lx-input is-mono" id="f-symbol" name="symbol" maxlength="${SYMBOL_MAX}" autocomplete="off" placeholder="e.g. AGENT" value="${esc(f.symbol)}" />
					</label>
				</div>
				<label class="lx-field">
					<span class="lx-label">Description <span class="lx-opt">optional · <span id="c-desc">0/${DESCRIPTION_MAX}</span></span></span>
					<textarea class="lx-textarea" id="f-description" name="description" maxlength="${DESCRIPTION_MAX}" placeholder="What is this agent and why does it have a coin?">${esc(f.description)}</textarea>
				</label>
				<details class="lx-disclosure">
					<summary>Social links <span class="lx-opt">optional</span></summary>
					<label class="lx-field"><span class="lx-label">Website <span class="lx-opt">defaults to the agent page</span></span>
						<input class="lx-input" id="f-website" name="website" type="url" inputmode="url" placeholder="https://" value="${esc(f.website)}" /></label>
					<div class="lx-row">
						<label class="lx-field"><span class="lx-label">X</span><input class="lx-input" id="f-twitter" name="twitter" placeholder="https://x.com/…" value="${esc(f.twitter)}" /></label>
						<label class="lx-field"><span class="lx-label">Telegram</span><input class="lx-input" id="f-telegram" name="telegram" placeholder="https://t.me/…" value="${esc(f.telegram)}" /></label>
					</div>
				</details>
			</section>

			<section class="lx-card" aria-labelledby="h-image">
				<div class="lx-card-h"><h2 id="h-image"><span class="lx-step done">3</span>Image</h2></div>
				<p class="lx-card-note">Defaults to your agent's portrait. Upload a square image to use something else.</p>
				<div class="lx-image">
					<div class="lx-image-thumb" id="img-thumb"></div>
					<div class="lx-drop" id="img-drop">
						<p class="lx-hint" id="img-status">PNG, JPG, GIF or WebP. Square, up to 4 MB. Drop it here.</p>
						<div class="lx-drop-actions">
							<label class="lx-btn is-small" for="f-image">Upload image</label>
							<input id="f-image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden />
							<button type="button" class="lx-btn is-small" id="img-reset">Use agent portrait</button>
						</div>
					</div>
				</div>
			</section>

			<section class="lx-card" aria-labelledby="h-launch">
				<div class="lx-card-h"><h2 id="h-launch"><span class="lx-step done">4</span>Launch settings</h2></div>
				<div id="lx-options"></div>
			</section>
		</form>

		<aside class="lx-side" aria-label="Launch preview">
			<div class="lx-card lx-preview">
				<div class="lx-stage" id="lx-stage"></div>
				<div class="lx-coin" id="lx-coin"></div>
			</div>
			<div class="lx-card" style="padding:0">
				<dl class="lx-rows" id="lx-costs"></dl>
				<ul class="lx-checklist" id="lx-checklist" aria-live="polite"></ul>
			</div>
			<div class="lx-card" style="padding:0" id="lx-wallet"></div>
			<button type="button" class="lx-btn is-primary" id="lx-launch">Launch coin</button>
			<p class="lx-fine">Coins launch on pump.fun mainnet. Launching spends real funds and cannot be undone. <a href="/legal/risk">Risks</a></p>
		</aside>
	</div>

	<section class="lx-coins" id="panel-coins" role="tabpanel" aria-labelledby="tab-coins" hidden>
		<div id="claim-status" aria-live="polite"></div>
		<div id="lx-coins-body"></div>
	</section>

	<dialog class="lx-dialog" id="lx-dialog" aria-labelledby="lx-dialog-title"><div class="lx-dialog-body" id="lx-dialog-body"></div></dialog>`;

	renderAgents();
	renderLaunchOptions();
	renderImageThumb();
	renderPreviewStage();
	renderWallet();
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function wireTabs(initial) {
	const tabs = [$('#tab-create'), $('#tab-coins')];
	const select = (name, focus = false) => {
		for (const t of tabs) {
			const on = t.dataset.tab === name;
			t.setAttribute('aria-selected', String(on));
			t.tabIndex = on ? 0 : -1;
			if (on && focus) t.focus();
		}
		$('#panel-create').hidden = name !== 'create';
		$('#panel-coins').hidden = name !== 'coins';
		const url = new URL(location.href);
		if (name === 'coins') url.searchParams.set('tab', 'coins');
		else url.searchParams.delete('tab');
		history.replaceState(null, '', url);
		if (name === 'coins' && state.user !== undefined) loadCoins();
	};
	for (const t of tabs) {
		t.addEventListener('click', () => select(t.dataset.tab));
		t.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
			e.preventDefault();
			select(t.dataset.tab === 'create' ? 'coins' : 'create', true);
		});
	}
	select(initial);
}

// ── Agents ─────────────────────────────────────────────────────────────────

function agentThumb(a, cls = 'lx-agent-img') {
	return a.thumbnail_url
		? `<img class="${cls}" src="${esc(a.thumbnail_url)}" alt="" loading="lazy" data-fallback="${esc((a.name || 'A').charAt(0).toUpperCase())}" />`
		: `<span class="lx-agent-ph" aria-hidden="true">${esc((a.name || 'A').trim().charAt(0).toUpperCase())}</span>`;
}

function swapBrokenImages(root) {
	for (const img of root.querySelectorAll('img[data-fallback]')) {
		img.addEventListener(
			'error',
			() => {
				const ph = document.createElement('span');
				ph.className = img.classList.contains('lx-agent-img') ? 'lx-agent-ph' : 'lx-coin-ph';
				ph.setAttribute('aria-hidden', 'true');
				ph.textContent = img.dataset.fallback;
				img.replaceWith(ph);
			},
			{ once: true },
		);
	}
}

function renderAgents() {
	const box = $('#lx-agents');
	if (!box) return;
	if (state.agents === null || state.user === undefined) {
		box.innerHTML = `<div class="lx-agents" aria-busy="true">${'<div class="lx-skel"></div>'.repeat(4)}</div>`;
		return;
	}
	if (state.agentsError) {
		box.innerHTML = `<div class="lx-empty is-error" role="alert"><strong>Could not load your agents.</strong><span>${esc(state.agentsError)}. Nothing was launched.</span><button type="button" class="lx-btn" id="agents-retry">Try again</button></div>`;
		$('#agents-retry').addEventListener('click', () => loadIdentity(state.form.agentId));
		return;
	}
	if (!state.user) {
		box.innerHTML = `<div class="lx-empty"><strong>Sign in to pick an agent.</strong><span>Every coin on three.ws belongs to a 3D agent. Sign in to use one of yours, or create one in about a minute.</span><div class="lx-drop-actions"><a class="lx-btn" href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Sign in</a><a class="lx-btn" href="/create-agent">Create an agent</a></div></div>`;
		return;
	}
	if (!state.agents.length) {
		box.innerHTML = `<div class="lx-empty"><strong>You don't have an agent yet.</strong><span>Create a 3D agent first. It takes about a minute, then come back here to launch its coin.</span><a class="lx-btn" href="/create-agent?next=/launch">Create your first agent</a></div>`;
		return;
	}
	const q = state.agentQuery.trim().toLowerCase();
	const list = q ? state.agents.filter((a) => `${a.name} ${a.slug || ''}`.toLowerCase().includes(q)) : state.agents;
	const search =
		state.agents.length > 8
			? `<input class="lx-input lx-agent-search" id="agent-q" type="search" placeholder="Search your ${state.agents.length} agents" value="${esc(state.agentQuery)}" aria-label="Search your agents" />`
			: '';
	const cards = list
		.map((a) => {
			const on = a.id === state.form.agentId;
			return `<button type="button" role="radio" class="lx-agent" aria-checked="${on}" tabindex="${on ? 0 : -1}" data-id="${esc(a.id)}">${agentThumb(a)}<span><span class="lx-agent-name">${esc(a.name || 'Untitled agent')}</span><span class="lx-agent-sub">${a.slug ? `@${esc(a.slug)}` : esc(a.visibility || '')}</span></span></button>`;
		})
		.join('');
	const hadFocus = box.contains(document.activeElement) && document.activeElement.id !== 'agent-q';
	box.innerHTML = `${search}<div class="lx-agents" role="radiogroup" aria-label="Your agents">${cards || '<p class="lx-hint">No agent matches that search.</p>'}<a class="lx-agent-new" href="/create-agent?next=/launch"><span aria-hidden="true">+</span>New agent</a></div>`;
	swapBrokenImages(box);

	const radios = [...box.querySelectorAll('.lx-agent')];
	if (radios.length && !radios.some((r) => r.tabIndex === 0)) radios[0].tabIndex = 0;
	radios.forEach((btn, i) => {
		btn.addEventListener('click', () => selectAgent(btn.dataset.id));
		btn.addEventListener('keydown', (e) => {
			const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
			if (!step) return;
			e.preventDefault();
			const next = radios[(i + step + radios.length) % radios.length];
			selectAgent(next.dataset.id, true);
		});
	});
	if (hadFocus) box.querySelector('.lx-agent[aria-checked="true"]')?.focus();
	$('#agent-q')?.addEventListener('input', (e) => {
		state.agentQuery = e.target.value;
		renderAgents();
		$('#agent-q')?.focus();
		const el = $('#agent-q');
		el?.setSelectionRange(el.value.length, el.value.length);
	});
}

function selectAgent(id, focus = false) {
	if (state.form.agentId !== id) {
		state.form.agentId = id;
		state.agentWallet = null;
		state.agentWalletError = '';
		const a = selectedAgent();
		if (a && !state.form.name) {
			state.form.name = (a.name || '').slice(0, NAME_MAX);
			$('#f-name').value = state.form.name;
			if (!state.form.symbolTouched) {
				state.form.symbol = suggestSymbol(state.form.name);
				$('#f-symbol').value = state.form.symbol;
			}
		}
		renderAgents();
		renderImageThumb();
		renderPreviewStage();
		if (state.form.launcher === 'agent') loadAgentWallet();
		renderWallet();
		updateDerived();
	}
	if (focus) $(`.lx-agent[data-id="${CSS.escape(id)}"]`)?.focus();
}

// ── Form ───────────────────────────────────────────────────────────────────

function wireForm() {
	const f = state.form;
	const on = (id, fn) => $(id).addEventListener('input', fn);
	on('#f-name', (e) => {
		f.name = e.target.value;
		if (!f.symbolTouched) {
			f.symbol = suggestSymbol(f.name);
			$('#f-symbol').value = f.symbol;
		}
		updateDerived();
	});
	on('#f-symbol', (e) => {
		const normalized = normalizeSymbol(e.target.value);
		if (normalized !== e.target.value) e.target.value = normalized;
		f.symbol = normalized;
		f.symbolTouched = normalized.length > 0;
		updateDerived();
	});
	on('#f-description', (e) => {
		f.description = e.target.value;
		updateDerived();
	});
	for (const key of ['website', 'twitter', 'telegram']) {
		on(`#f-${key}`, (e) => {
			f[key] = e.target.value;
			updateDerived();
		});
	}
	$('#lx-form').addEventListener('submit', (e) => e.preventDefault());

	const drop = $('#img-drop');
	$('#f-image').addEventListener('change', (e) => {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (file) takeImageFile(file);
	});
	drop.addEventListener('dragover', (e) => {
		e.preventDefault();
		drop.classList.add('is-over');
	});
	drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
	drop.addEventListener('drop', (e) => {
		e.preventDefault();
		drop.classList.remove('is-over');
		const file = e.dataTransfer?.files?.[0];
		if (file) takeImageFile(file);
	});
	$('#img-reset').addEventListener('click', () => {
		f.imageDataUrl = '';
		f.imageName = '';
		setImageStatus('Using your agent portrait.');
		renderImageThumb();
		updateDerived();
	});
	$('#lx-launch').addEventListener('click', onLaunchClick);
}

function setImageStatus(text, isError = false) {
	const el = $('#img-status');
	el.textContent = text;
	el.style.color = isError ? 'var(--danger)' : '';
}

async function takeImageFile(file) {
	if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
		setImageStatus('That file is not a PNG, JPG, GIF or WebP image.', true);
		return;
	}
	try {
		const dataUrl = file.size > IMAGE_MAX_BYTES || file.type !== 'image/gif' ? await downscale(file) : await readAsDataUrl(file);
		if (dataUrl.length * 0.75 > IMAGE_MAX_BYTES) {
			setImageStatus('That image is still over 4 MB after resizing. Use a smaller one.', true);
			return;
		}
		state.form.imageDataUrl = dataUrl;
		state.form.imageName = file.name;
		setImageStatus(`Using ${file.name}.`);
		renderImageThumb();
		updateDerived();
	} catch {
		setImageStatus('Could not read that image. Try another file.', true);
	}
}

function readAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result));
		r.onerror = () => reject(r.error);
		r.readAsDataURL(file);
	});
}

// Square-crop and cap at 1024px so every coin image is balanced and small.
async function downscale(file) {
	const bitmap = await createImageBitmap(file);
	const side = Math.min(bitmap.width, bitmap.height);
	const out = Math.min(IMAGE_MAX_DIM, side);
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = out;
	canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
	bitmap.close?.();
	return canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92);
}

async function importImageUrl(url) {
	try {
		const res = await fetch(url, { mode: 'cors' });
		if (!res.ok) return;
		const blob = await res.blob();
		await takeImageFile(new File([blob], 'prefill', { type: blob.type }));
	} catch {
		setImageStatus('The linked image could not be loaded, so your agent portrait will be used.');
	}
}

function currentImage() {
	return state.form.imageDataUrl || selectedAgent()?.thumbnail_url || '';
}

function renderImageThumb() {
	const box = $('#img-thumb');
	if (!box) return;
	const src = currentImage();
	box.innerHTML = src ? `<img src="${esc(src)}" alt="Coin image" />` : '<span class="lx-stage-empty">No image yet</span>';
	$('#img-reset').hidden = !state.form.imageDataUrl;
}

function renderLaunchOptions() {
	const box = $('#lx-options');
	if (!box) return;
	const f = state.form;
	const presets = DEV_BUY_PRESETS[f.quote];
	const v1Active = !!state.config?.tx_v1?.active;
	const seg = (name, value, label, sub, disabled = false) =>
		`<button type="button" role="radio" data-seg="${name}" data-value="${value}" aria-checked="${String(f[name]) === String(value)}" ${disabled ? 'disabled' : ''}>${label}${sub ? `<small>${sub}</small>` : ''}</button>`;

	box.innerHTML = `
		<div class="lx-field" style="margin-top:4px">
			<span class="lx-label" id="l-launcher">Launch from</span>
			<div class="lx-seg" role="radiogroup" aria-labelledby="l-launcher">
				${seg('launcher', 'wallet', 'Your wallet', 'You sign, you earn rewards')}
				${seg('launcher', 'agent', "Agent's wallet", 'The agent signs and earns')}
			</div>
		</div>
		<div class="lx-field">
			<span class="lx-label" id="l-quote">Pair with</span>
			<div class="lx-seg" role="radiogroup" aria-labelledby="l-quote">
				${seg('quote', 'sol', 'SOL', 'Classic pump.fun curve')}
				${seg('quote', 'usdc', 'USDC', 'Stable-priced curve')}
			</div>
		</div>
		<div class="lx-field">
			<span class="lx-label" id="l-rewards">Creator rewards go to</span>
			<div class="lx-seg" role="radiogroup" aria-labelledby="l-rewards">
				${seg('rewards', 'creator', 'Creator', 'Claim them on this page')}
				${seg('rewards', 'holders', 'Holders', 'Paid out to holders', f.mayhem)}
			</div>
		</div>
		<label class="lx-field" for="f-buy">
			<span class="lx-label">Dev buy <span class="lx-opt">optional</span></span>
			<div class="lx-buy"><input class="lx-input is-mono" id="f-buy" inputmode="decimal" autocomplete="off" placeholder="0.0" value="${esc(f.buyIn)}" aria-describedby="buy-hint" /><span class="lx-buy-unit">${f.quote.toUpperCase()}</span></div>
		</label>
		<div class="lx-chips" role="group" aria-label="Dev buy presets">
			${['0', ...presets].map((p) => `<button type="button" class="lx-chip" data-buy="${p}" aria-pressed="${String(parseBuyIn(f.buyIn)) === String(Number(p))}">${p === '0' ? 'None' : `${p} ${f.quote.toUpperCase()}`}</button>`).join('')}
		</div>
		<p class="lx-hint" id="buy-hint" style="margin-top:8px">Buy your own coin in the same transaction, before anyone else can.${feeBps() > 0 ? ` three.ws adds a ${feeBps() / 100}% fee on the dev buy.` : ''}</p>
		<div class="lx-toggle-row">
			<div><strong>Mayhem mode</strong><span>Higher-volatility curve for 24 hours. Set at creation only.</span></div>
			<button type="button" class="lx-switch" role="switch" id="f-mayhem" aria-checked="${f.mayhem}" aria-label="Mayhem mode" ${f.rewards === 'holders' ? 'disabled' : ''}></button>
		</div>
		<details class="lx-disclosure" ${f.txFormat !== 'auto' ? 'open' : ''}>
			<summary>Transaction format <span class="lx-badge ${v1Active ? 'is-good' : ''}" style="margin-left:6px">${v1Active ? 'v1 live' : 'v0'}</span></summary>
			<div class="lx-field">
				<div class="lx-seg" role="radiogroup" aria-label="Transaction format">
					${seg('txFormat', 'auto', 'Auto', 'Smallest that fits')}
					${seg('txFormat', '0', 'v0', 'Every wallet')}
					${seg('txFormat', '1', 'v1', '4,096-byte envelope', !v1Active)}
				</div>
				<p class="lx-hint" style="margin-top:8px">Solana transaction v1 fits launches that overflow the classic 1,232-byte limit, such as USDC coins with a dev buy. Auto uses v1 only when it is needed and your wallet supports it.</p>
			</div>
		</details>`;

	for (const b of box.querySelectorAll('[data-seg]')) {
		b.addEventListener('click', () => setOption(b.dataset.seg, b.dataset.value));
		b.addEventListener('keydown', (e) => {
			const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
			if (!step) return;
			e.preventDefault();
			const group = [...b.parentElement.querySelectorAll('[data-seg]:not(:disabled)')];
			const next = group[(group.indexOf(b) + step + group.length) % group.length];
			setOption(next.dataset.seg, next.dataset.value);
			$(`[data-seg="${next.dataset.seg}"][data-value="${next.dataset.value}"]`)?.focus();
		});
	}
	for (const c of box.querySelectorAll('[data-buy]')) {
		c.addEventListener('click', () => {
			f.buyIn = c.dataset.buy === '0' ? '' : c.dataset.buy;
			$('#f-buy').value = f.buyIn;
			syncBuyChips();
			updateDerived();
		});
	}
	$('#f-buy').addEventListener('input', (e) => {
		f.buyIn = e.target.value.replace(/[^\d.]/g, '');
		if (f.buyIn !== e.target.value) e.target.value = f.buyIn;
		syncBuyChips();
		updateDerived();
	});
	$('#f-mayhem').addEventListener('click', () => {
		f.mayhem = !f.mayhem;
		renderLaunchOptions();
		updateDerived();
	});
}

function syncBuyChips() {
	for (const c of document.querySelectorAll('[data-buy]')) {
		c.setAttribute('aria-pressed', String(String(parseBuyIn(state.form.buyIn)) === String(Number(c.dataset.buy))));
	}
}

function setOption(name, value) {
	const f = state.form;
	const next = name === 'txFormat' && value !== 'auto' ? Number(value) : value;
	if (String(f[name]) === String(next)) return;
	f[name] = next;
	if (name === 'quote') f.buyIn = '';
	if (name === 'rewards' && value === 'holders') f.mayhem = false;
	if (name === 'launcher') {
		if (value === 'agent') loadAgentWallet();
		renderWallet();
	}
	renderLaunchOptions();
	updateDerived();
}

// ── Preview + derived UI ───────────────────────────────────────────────────

let stageAgentId = null;
function renderPreviewStage() {
	const stage = $('#lx-stage');
	if (!stage) return;
	const a = selectedAgent();
	if (!a) {
		stageAgentId = null;
		stage.innerHTML = `<div class="lx-stage-empty">${state.agents === null ? 'Loading your agents…' : 'Pick an agent to see it here'}</div>`;
		return;
	}
	if (stageAgentId === a.id) return;
	stageAgentId = a.id;
	const tag = `<span class="lx-stage-tag">3D agent · ${esc(a.name || 'Untitled')}</span>`;
	if (a.model_url) {
		stage.innerHTML = `<model-viewer src="${esc(a.model_url)}" ${a.thumbnail_url ? `poster="${esc(a.thumbnail_url)}"` : ''} alt="${esc(a.name || 'Agent')} in 3D" camera-controls auto-rotate rotation-per-second="18deg" interaction-prompt="none" shadow-intensity="0.8" exposure="1.05" environment-image="neutral"></model-viewer>${tag}`;
		ensureModelViewer().catch(() => {
			if (stageAgentId !== a.id) return;
			stage.innerHTML = a.thumbnail_url ? `<img src="${esc(a.thumbnail_url)}" alt="${esc(a.name || 'Agent')}" />${tag}` : `<div class="lx-stage-empty">3D preview unavailable</div>${tag}`;
		});
	} else {
		stage.innerHTML = a.thumbnail_url ? `<img src="${esc(a.thumbnail_url)}" alt="${esc(a.name || 'Agent')}" />${tag}` : `<div class="lx-stage-empty">This agent has no body yet</div>${tag}`;
	}
}

function updateDerived() {
	const f = state.form;
	const a = selectedAgent();
	const problems = launchProblems(f, { quote: f.quote });
	const c = cost();

	const count = (id, n, max) => {
		const el = $(id);
		if (el) el.textContent = `${n}/${max}`;
	};
	count('#c-name', [...f.name].length, NAME_MAX);
	count('#c-symbol', f.symbol.length, SYMBOL_MAX);
	count('#c-desc', f.description.length, DESCRIPTION_MAX);
	document.querySelector('[data-step="agent"]')?.classList.toggle('done', !!a);
	document.querySelector('[data-step="details"]')?.classList.toggle('done', !problems.some((p) => p.field === 'name' || p.field === 'symbol'));

	const img = currentImage();
	const coin = $('#lx-coin');
	if (coin) {
		coin.innerHTML = `${img ? `<img class="lx-coin-img" src="${esc(img)}" alt="" />` : `<span class="lx-coin-ph" aria-hidden="true">?</span>`}
			<div style="min-width:0"><p class="lx-coin-name">${esc(f.name.trim() || 'Your coin name')}</p><p class="lx-coin-sym">$${esc(f.symbol || 'TICKER')}</p></div>
			${f.description.trim() ? `<p class="lx-coin-desc">${esc(f.description.trim())}</p>` : ''}
			<span class="lx-coin-link">↗ ${a ? `three.ws/agents/${esc(a.agent_id || a.id).slice(0, 8)}…` : 'links to your agent'}</span>`;
	}

	const costs = $('#lx-costs');
	if (costs) {
		const q = c.quote;
		const rows = [
			['pump.fun create + rent', `~${formatAmount(c.createSol, 4)} SOL`],
			['Dev buy', c.buyIn > 0 ? `${formatAmount(c.buyIn)} ${q}` : 'None'],
		];
		const feeRow =
			feeBps() > 0
				? `<div class="is-fee"><dt>three.ws fee · ${feeBps() / 100}%</dt><dd>${c.fee > 0 ? `${formatAmount(c.fee, q === 'USDC' ? 6 : 9)} ${q}` : '0'}</dd></div>`
				: '';
		const total = q === 'USDC' ? `${formatAmount(c.totalQuote, 6)} USDC + ~${formatAmount(c.totalSol, 4)} SOL` : `~${formatAmount(c.totalSol, 6)} SOL`;
		costs.innerHTML = `${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}${feeRow}<div class="is-total"><dt>Total</dt><dd>${total}</dd></div>`;
	}

	const list = $('#lx-checklist');
	const walletProblem = walletBlocker(c);
	const all = walletProblem ? [...problems, walletProblem] : problems;
	if (list) {
		list.hidden = !all.length;
		list.innerHTML = all
			.map((p) => `<li>${p.field && p.field !== 'wallet' ? `<button type="button" data-focus="${p.field}">${esc(p.text)}</button>` : esc(p.text)}</li>`)
			.join('');
		for (const b of list.querySelectorAll('[data-focus]')) b.addEventListener('click', () => focusField(b.dataset.focus));
	}

	const btn = $('#lx-launch');
	if (btn) {
		// Signing in and connecting a wallet are always reachable from the button;
		// only an actual launch waits for a complete form and a funded signer.
		const gateStep = state.user === null || (state.form.launcher === 'wallet' && !state.wallet && state.user);
		btn.disabled = state.running || state.user === undefined || (!gateStep && (problems.length > 0 || !!walletProblem?.blocking));
		btn.textContent = state.running ? 'Launching…' : launchLabel(walletProblem);
	}
}

function launchLabel(walletProblem) {
	if (state.user === null) return 'Sign in to launch';
	if (state.form.launcher === 'wallet' && !state.wallet) return walletInstalled() ? 'Connect wallet to launch' : 'Install a Solana wallet';
	if (walletProblem?.blocking) return 'Launch coin';
	return `Launch $${state.form.symbol || 'coin'}`;
}

// Wallet state that stops a launch. Non-blocking items only inform the button label.
function walletBlocker(c) {
	if (state.user === null) return { field: 'wallet', text: 'Sign in to launch', blocking: false };
	if (state.form.launcher === 'agent') {
		if (!state.agentWallet) return { field: 'wallet', text: state.agentWalletError || "Loading the agent's wallet", blocking: true };
		// USDC coins still pay rent and network fees in SOL (totalSol covers both lanes).
		if (state.agentWallet.sol != null && state.agentWallet.sol < c.totalSol) {
			return { field: 'wallet', text: `The agent's wallet needs ~${formatAmount(c.totalSol - state.agentWallet.sol, 4)} more SOL`, blocking: true };
		}
		return null;
	}
	if (!state.wallet) return null;
	if (state.balance != null && state.balance < c.totalSol) {
		return { field: 'wallet', text: `Your wallet needs ~${formatAmount(c.totalSol - state.balance, 4)} more SOL`, blocking: true };
	}
	return null;
}

function focusField(field) {
	const map = { agent: '.lx-agent[aria-checked="true"], .lx-agent, #lx-agents a', name: '#f-name', symbol: '#f-symbol', description: '#f-description', buyIn: '#f-buy', website: '#f-website', twitter: '#f-twitter', telegram: '#f-telegram' };
	const el = $(map[field] || '#f-name');
	if (!el) return;
	el.closest('details')?.setAttribute('open', '');
	el.scrollIntoView({ block: 'center', behavior: 'smooth' });
	el.focus({ preventScroll: true });
}

// ── Wallets ────────────────────────────────────────────────────────────────

async function refreshBalance() {
	if (!state.wallet) return;
	try {
		state.balance = await solBalance(state.wallet.address);
	} catch {
		state.balance = null;
	}
	renderWallet();
	updateDerived();
}

async function loadAgentWallet() {
	const a = selectedAgent();
	if (!a || !state.user) return;
	state.agentWallet = null;
	state.agentWalletError = '';
	renderWallet();
	try {
		const data = await api('/api/pump/agent-wallet', {
			method: 'POST',
			body: { ...(a.agent_id ? { agent_id: a.agent_id } : { avatar_id: a.id }), network: 'mainnet' },
		});
		if (selectedAgent()?.id !== a.id) return;
		state.agentWallet = data;
	} catch (err) {
		state.agentWalletError = friendlyLaunchError(err);
	}
	renderWallet();
	updateDerived();
}

function renderWallet() {
	const box = $('#lx-wallet');
	if (!box) return;
	if (state.form.launcher === 'agent') {
		const w = state.agentWallet;
		box.innerHTML = w
			? `<div class="lx-wallet"><div style="min-width:0"><div class="lx-wallet-addr">${esc(shortAddress(w.address))}</div><p class="lx-hint">Agent wallet · ${w.sol == null ? 'balance unavailable' : `${formatAmount(w.sol, 4)} SOL`}</p></div><div class="lx-drop-actions"><button type="button" class="lx-btn is-small" id="aw-copy">Copy</button><button type="button" class="lx-btn is-small" id="aw-refresh" aria-label="Refresh balance">Refresh</button></div></div>`
			: `<div class="lx-wallet"><span class="lx-hint">${esc(state.agentWalletError || "Loading the agent's wallet…")}</span>${state.agentWalletError ? '<button type="button" class="lx-btn is-small" id="aw-retry">Retry</button>' : ''}</div>`;
		$('#aw-copy')?.addEventListener('click', (e) => copyText(w.address, e.currentTarget));
		$('#aw-refresh')?.addEventListener('click', loadAgentWallet);
		$('#aw-retry')?.addEventListener('click', loadAgentWallet);
		return;
	}
	if (!state.wallet && state.walletConflict) {
		box.innerHTML = `<div class="lx-wallet" style="flex-wrap:wrap"><span class="lx-hint">${esc(shortAddress(state.walletConflict))} is linked to another three.ws account. Move it to this account to launch with it.</span><button type="button" class="lx-btn is-small" id="w-takeover" ${state.walletBusy ? 'disabled' : ''}>${state.walletBusy ? 'Moving…' : 'Move wallet here'}</button></div>`;
		$('#w-takeover').addEventListener('click', takeoverWallet);
		return;
	}
	if (!state.wallet) {
		box.innerHTML = `<div class="lx-wallet"><span class="lx-hint">${esc(state.walletError || (walletInstalled() ? 'Connect the wallet that will sign the launch.' : 'Install Phantom, Solflare or Backpack to launch from your wallet.'))}</span>${walletInstalled() ? `<button type="button" class="lx-btn is-small" id="w-connect" ${state.walletBusy ? 'disabled' : ''}>${state.walletBusy ? 'Connecting…' : 'Connect'}</button>` : '<a class="lx-btn is-small" href="https://phantom.app/" target="_blank" rel="noopener">Get Phantom</a>'}</div>`;
		$('#w-connect')?.addEventListener('click', connectWallet);
		return;
	}
	const w = state.wallet;
	box.innerHTML = `<div class="lx-wallet"><div style="min-width:0"><div class="lx-wallet-addr">${esc(shortAddress(w.address))}</div><p class="lx-hint">${esc(w.name)} · ${state.balance == null ? 'checking balance' : `${formatAmount(state.balance, 4)} SOL`}</p></div><span class="lx-badge ${w.v1 ? 'is-good' : ''}" title="${w.v1 ? 'This wallet signs Solana transaction v1' : 'This wallet signs v0 transactions'}">${w.v1 ? 'v1 ready' : 'v0'}</span></div>`;
}

async function connectWallet() {
	if (state.walletBusy) return null;
	if (!state.user) {
		location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
		return null;
	}
	state.walletBusy = true;
	state.walletError = '';
	state.walletConflict = null;
	renderWallet();
	try {
		state.wallet = await connectLaunchWallet();
		refreshBalance();
	} catch (err) {
		if (err.code === 'address_in_use') {
			state.walletConflict = injectedProvider()?.publicKey?.toString() || null;
		} else {
			state.walletError = err.code === 'USER_REJECTED' ? 'Connection cancelled.' : friendlyLaunchError(err);
		}
	} finally {
		state.walletBusy = false;
		renderWallet();
		updateDerived();
	}
	return state.wallet;
}

async function takeoverWallet() {
	const address = state.walletConflict;
	if (!address || state.walletBusy) return;
	state.walletBusy = true;
	renderWallet();
	try {
		await linkWallet(address, { takeover: true });
		state.walletConflict = null;
		state.walletBusy = false;
		await connectWallet();
		return;
	} catch (err) {
		state.walletConflict = null;
		state.walletError = friendlyLaunchError(err);
	}
	state.walletBusy = false;
	renderWallet();
	updateDerived();
}

async function copyText(text, btn) {
	try {
		await navigator.clipboard.writeText(text);
		if (btn) {
			const old = btn.textContent;
			btn.textContent = 'Copied';
			setTimeout(() => (btn.textContent = old), 1500);
		}
	} catch {
		if (btn) btn.textContent = 'Copy failed';
	}
}

// ── Launch ─────────────────────────────────────────────────────────────────

const WALLET_STEPS = [
	['metadata', 'Upload image and metadata'],
	['prepare', 'Build the launch transaction'],
	['sign', 'Approve in your wallet'],
	['confirm', 'Confirm on Solana'],
	['record', 'List it on three.ws'],
];
const AGENT_STEPS = [
	['metadata', 'Upload image and metadata'],
	['launch', "Agent signs and sends the launch"],
];

async function onLaunchClick() {
	if (state.user === null) {
		location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
		return;
	}
	if (state.form.launcher === 'wallet' && !state.wallet) {
		if (!walletInstalled()) {
			window.open('https://phantom.app/', '_blank', 'noopener');
			return;
		}
		if (!(await connectWallet())) return;
		return;
	}
	const problems = launchProblems(state.form, { quote: state.form.quote });
	if (problems.length) {
		focusField(problems[0].field);
		return;
	}
	if (!(await ensureRiskAck({ context: 'launch' }))) return;
	if (state.form.launcher === 'agent') await runAgentLaunch();
	else await runWalletLaunch();
}

function openDialog(title, lead, steps) {
	const dlg = $('#lx-dialog');
	$('#lx-dialog-body').innerHTML = `<h2 id="lx-dialog-title">${esc(title)}</h2><p>${esc(lead)}</p><ol class="lx-steps">${steps.map(([k, label]) => `<li data-step="${k}" data-state="pending"><span class="ic" aria-hidden="true"></span><span>${esc(label)}<small></small></span></li>`).join('')}</ol><div id="lx-dialog-extra"></div>`;
	dlg.oncancel = (e) => {
		if (state.running) e.preventDefault();
	};
	if (!dlg.open) dlg.showModal();
}

function step(key, st, note = '') {
	const li = $(`#lx-dialog-body [data-step="${key}"]`);
	if (!li) return;
	li.dataset.state = st;
	li.querySelector('small').textContent = note;
	if (st === 'active') li.setAttribute('aria-current', 'step');
	else li.removeAttribute('aria-current');
}

function metadataBody() {
	const f = state.form;
	const a = selectedAgent();
	return {
		name: f.name.trim(),
		symbol: normalizeSymbol(f.symbol),
		description: f.description.trim(),
		avatar_id: a.id,
		...(a.agent_id ? { agent_id: a.agent_id } : {}),
		...(f.website.trim() ? { website: f.website.trim() } : {}),
		...(f.twitter.trim() ? { twitter: f.twitter.trim() } : {}),
		...(f.telegram.trim() ? { telegram: f.telegram.trim() } : {}),
		...(f.imageDataUrl ? { image_data_url: f.imageDataUrl } : {}),
	};
}

function coinOptions() {
	const f = state.form;
	const buy = parseBuyIn(f.buyIn) || 0;
	return {
		coin_type: f.mayhem ? 'mayhem' : 'regular',
		holder_reward: f.rewards === 'holders',
		network: 'mainnet',
		...(f.quote === 'usdc' ? { quote_currency: 'usdc', usdc_buy_in: buy } : { quote_currency: 'sol', sol_buy_in: buy }),
	};
}

async function runWalletLaunch() {
	state.running = true;
	updateDerived();
	const a = selectedAgent();
	openDialog(`Launching $${normalizeSymbol(state.form.symbol)}`, 'Keep this window open. Your wallet will ask you to approve one transaction.', WALLET_STEPS);
	let current = 'metadata';
	try {
		step('metadata', 'active');
		const meta = await api('/api/pump/build-metadata', { method: 'POST', body: metadataBody() });
		step('metadata', 'done', meta.on_ipfs ? 'Pinned to IPFS' : 'Stored on three.ws');

		current = 'prepare';
		step('prepare', 'active', 'Stamping the 3ws mint mark');
		const prep = await api('/api/pump/launch-prep', {
			method: 'POST',
			body: {
				...(a.agent_id ? { agent_id: a.agent_id } : { avatar_id: a.id }),
				wallet_address: state.wallet.address,
				name: state.form.name.trim(),
				symbol: normalizeSymbol(state.form.symbol),
				uri: meta.metadata_url,
				...coinOptions(),
				transaction_version: state.form.txFormat,
				v1_capable: !!state.wallet.v1,
			},
		});
		step('prepare', 'done', `Transaction v${prep.transaction_version} · ${prep.tx_bytes.toLocaleString()} of ${prep.tx_limit_bytes.toLocaleString()} bytes`);

		current = 'sign';
		step('sign', 'active', 'Check your wallet');
		const signature = await signAndBroadcast({ txBase64: prep.tx_base64, version: prep.transaction_version, address: state.wallet.address });
		step('sign', 'done', 'Sent to Solana');

		await finishConfirm({ prep, signature, agent: a });
	} catch (err) {
		step(current, 'error', friendlyLaunchError(err));
		showDialogError(err);
	} finally {
		state.running = false;
		updateDerived();
		refreshBalance();
	}
}

async function finishConfirm({ prep, signature, agent }) {
	step('confirm', 'active', 'Usually a few seconds');
	const confirmed = await waitForConfirmation(signature);
	if (!confirmed) {
		step('confirm', 'error', 'Still pending after 75 seconds');
		$('#lx-dialog-extra').innerHTML = `<div class="lx-alert is-warn">Solana has not confirmed the launch yet. It may still land. <a class="lx-link" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener">View on Solscan</a></div><div class="lx-actions"><button type="button" class="lx-btn is-wide" id="lx-recheck">Check again</button></div>`;
		$('#lx-recheck').addEventListener('click', async () => {
			state.running = true;
			$('#lx-dialog-extra').innerHTML = '';
			try {
				await finishConfirm({ prep, signature, agent });
			} catch (err) {
				showDialogError(err);
			} finally {
				state.running = false;
			}
		});
		return;
	}
	step('confirm', 'done', 'Confirmed');
	step('record', 'active');
	const recorded = await recordLaunch(prep.prep_id, signature);
	step('record', 'done');
	showSuccess({ mint: recorded?.pump_agent_mint?.mint || prep.mint, signature, agent, fee: prep.platform_fee });
}

// The RPC that served confirmation can be a slot ahead of the one the server
// reads, so a just-confirmed signature may briefly read as missing.
async function recordLaunch(prepId, signature) {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			return await api('/api/pump/launch-confirm', { method: 'POST', body: { prep_id: prepId, tx_signature: signature } });
		} catch (err) {
			if (err.code === 'conflict') return null;
			if (err.code !== 'tx_not_found' || attempt === 4) throw err;
			await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
		}
	}
	return null;
}

async function runAgentLaunch() {
	state.running = true;
	updateDerived();
	const a = selectedAgent();
	openDialog(`Launching $${normalizeSymbol(state.form.symbol)}`, `${a.name || 'Your agent'} signs this launch with its own wallet. No wallet prompt needed.`, AGENT_STEPS);
	let current = 'metadata';
	try {
		step('metadata', 'active');
		const meta = await api('/api/pump/build-metadata', { method: 'POST', body: metadataBody() });
		step('metadata', 'done', meta.on_ipfs ? 'Pinned to IPFS' : 'Stored on three.ws');
		current = 'launch';
		step('launch', 'active', 'Signing, sending and confirming');
		const out = await api('/api/pump/launch-agent', {
			method: 'POST',
			body: {
				...(a.agent_id ? { agent_id: a.agent_id } : { avatar_id: a.id }),
				name: state.form.name.trim(),
				symbol: normalizeSymbol(state.form.symbol),
				uri: meta.metadata_url,
				...coinOptions(),
			},
		});
		step('launch', 'done', 'Confirmed');
		showSuccess({ mint: out.mint, signature: out.signature, agent: a, fee: out.platform_fee });
	} catch (err) {
		step(current, 'error', friendlyLaunchError(err));
		showDialogError(err);
	} finally {
		state.running = false;
		loadAgentWallet();
		updateDerived();
	}
}

function showDialogError(err) {
	$('#lx-dialog-extra').innerHTML = `<div class="lx-alert" role="alert">${esc(friendlyLaunchError(err))}</div><div class="lx-actions"><button type="button" class="lx-btn" id="lx-close">Close</button><button type="button" class="lx-btn" id="lx-retry">Try again</button></div>`;
	$('#lx-close').addEventListener('click', () => $('#lx-dialog').close());
	$('#lx-retry').addEventListener('click', () => {
		$('#lx-dialog').close();
		onLaunchClick();
	});
	$('#lx-close').focus();
}

function showSuccess({ mint, signature, agent, fee }) {
	const f = state.form;
	const symbol = normalizeSymbol(f.symbol);
	const img = currentImage();
	const post = shareText({ name: f.name.trim(), symbol, mint, agentName: agent?.name });
	const feeNote = fee?.settlement === 'failed' ? '<div class="lx-alert is-warn">The coin is live. The three.ws fee transfer did not go through, so you were not charged it.</div>' : '';
	$('#lx-dialog-body').innerHTML = `
		<h2 id="lx-dialog-title">$${esc(symbol)} is live</h2>
		<p>Your coin is trading on pump.fun and listed on three.ws, linked to ${esc(agent?.name || 'your agent')}.</p>
		<div class="lx-result-coin">
			${img ? `<img class="lx-coin-img" src="${esc(img)}" alt="" />` : '<span class="lx-coin-ph">?</span>'}
			<div style="min-width:0"><p class="lx-coin-name">${esc(f.name.trim())}</p><div class="lx-ca"><span>${esc(shortAddress(mint, 6, 6))}</span><button type="button" class="lx-btn is-small" id="ok-copy">Copy CA</button></div></div>
		</div>
		${feeNote}
		<div class="lx-actions">
			<a class="lx-btn" href="/launches/${esc(mint)}">Coin page</a>
			<a class="lx-btn" href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">pump.fun</a>
			<a class="lx-btn" href="/agents/${esc(agent?.agent_id || agent?.id || '')}">Agent page</a>
			<a class="lx-btn" href="https://solscan.io/tx/${esc(signature || '')}" target="_blank" rel="noopener">Transaction</a>
			<a class="lx-btn is-primary is-wide" href="https://x.com/intent/post?text=${encodeURIComponent(post)}" target="_blank" rel="noopener">Share on X</a>
			<button type="button" class="lx-btn is-wide" id="ok-another">Launch another</button>
		</div>
		<p class="lx-hint" style="margin-top:14px;text-align:center">Creator rewards build up as people trade. Claim them any time under My coins.</p>`;
	$('#ok-copy').addEventListener('click', (e) => copyText(mint, e.currentTarget));
	$('#ok-another').addEventListener('click', () => {
		$('#lx-dialog').close();
		resetForm();
	});
	state.coins = null;
	$('#ok-copy').focus();
}

function resetForm() {
	Object.assign(state.form, { name: '', symbol: '', symbolTouched: false, description: '', website: '', twitter: '', telegram: '', buyIn: '', imageDataUrl: '', imageName: '', mayhem: false });
	for (const id of ['#f-name', '#f-symbol', '#f-description', '#f-website', '#f-twitter', '#f-telegram']) $(id).value = '';
	renderLaunchOptions();
	renderImageThumb();
	updateDerived();
	$('#f-name').focus();
}

// ── My coins + claims ──────────────────────────────────────────────────────

async function loadCoins() {
	const box = $('#lx-coins-body');
	if (!box) return;
	if (state.user === null) {
		box.innerHTML = `<div class="lx-card lx-empty"><strong>Sign in to see your coins.</strong><span>Coins you launch on three.ws show up here with their unclaimed creator rewards.</span><a class="lx-btn" href="/login?next=${encodeURIComponent('/launch?tab=coins')}">Sign in</a></div>`;
		return;
	}
	if (!state.coins) box.innerHTML = `<div class="lx-card"><div class="lx-skel" style="min-height:120px"></div></div><div class="lx-card"><div class="lx-skel" style="min-height:120px"></div></div>`;
	try {
		const { data } = await api('/api/pump/my-coins');
		state.coins = data;
		state.coinsError = '';
	} catch (err) {
		state.coinsError = friendlyLaunchError(err);
	}
	renderCoins();
}

function rewardSummary(wallet) {
	if (wallet.balance_error) return { text: 'Unavailable', claimable: false };
	const parts = wallet.rewards.filter((r) => r.amount_ui != null && r.amount_ui > 0);
	if (!parts.length) return { text: '0 <small>SOL</small>', claimable: false };
	return { text: parts.map((r) => `${formatAmount(r.amount_ui, r.symbol === 'SOL' ? 6 : 2)} <small>${esc(r.symbol)}</small>`).join(' + '), claimable: true };
}

function coinRow(c) {
	const thumb = c.agent?.thumbnail_url
		? `<img src="${esc(c.agent.thumbnail_url)}" alt="" loading="lazy" data-fallback="${esc(c.symbol.charAt(0))}" />`
		: `<span class="lx-coin-ph" aria-hidden="true">${esc(c.symbol.charAt(0))}</span>`;
	const route = { holders: 'Rewards go to holders', shared: 'Rewards split by a fee-sharing config', external: 'Created by a wallet not linked to this account', unknown: 'Creator unknown' }[c.reward_route];
	return `<div class="lx-coin-row">${thumb}<div style="min-width:0"><a href="/launches/${esc(c.mint)}">${esc(c.name)} <span class="lx-coin-sym" style="display:inline">$${esc(c.symbol)}</span></a><p>${c.agent ? `${esc(c.agent.name)} · ` : ''}${new Date(c.created_at).toLocaleDateString()}${route ? ` · ${route}` : ''}</p></div><div class="lx-coin-row-links"><a class="lx-btn is-small" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">pump.fun</a></div></div>`;
}

function renderCoins() {
	const box = $('#lx-coins-body');
	if (!box) return;
	if (state.coinsError) {
		box.innerHTML = `<div class="lx-card lx-empty is-error" role="alert"><strong>Could not load your coins.</strong><span>${esc(state.coinsError)}</span><button type="button" class="lx-btn" id="coins-retry">Try again</button></div>`;
		$('#coins-retry').addEventListener('click', loadCoins);
		return;
	}
	const data = state.coins;
	const badge = $('#coins-badge');
	if (!data?.coins?.length) {
		if (badge) badge.hidden = true;
		box.innerHTML = `<div class="lx-card lx-empty"><strong>No coins yet.</strong><span>Launch a coin for one of your agents and its creator rewards will show up here, ready to claim.</span><button type="button" class="lx-btn" id="coins-create">Launch your first coin</button></div>`;
		$('#coins-create').addEventListener('click', () => $('#tab-create').click());
		return;
	}
	const claimable = data.wallets.filter((w) => rewardSummary(w).claimable).length;
	if (badge) {
		badge.hidden = !claimable;
		badge.textContent = String(claimable);
	}
	const byMint = new Map(data.coins.map((c) => [c.mint, c]));
	const walletCards = data.wallets
		.map((w) => {
			const sum = rewardSummary(w);
			const busy = state.claiming.has(w.address);
			const who = w.kind === 'agent' ? `${esc(w.agent?.name || 'Agent')}'s wallet` : 'Your wallet';
			return `<article class="lx-card">
				<div class="lx-reward">
					<div><p class="lx-reward-kicker">${who} · ${esc(shortAddress(w.address))}</p><p class="lx-reward-amt">${sum.text}</p><p class="lx-reward-meta">Unclaimed creator rewards across ${w.coins.length} coin${w.coins.length === 1 ? '' : 's'}${w.balance_error ? '. The balance could not be read right now.' : ''}</p></div>
					<button type="button" class="lx-btn ${sum.claimable ? 'is-primary' : ''}" style="${sum.claimable ? 'width:auto;min-height:44px;padding:0 22px' : ''}" data-claim="${esc(w.address)}" ${!sum.claimable || busy ? 'disabled' : ''}>${busy ? 'Claiming…' : sum.claimable ? 'Claim rewards' : 'Nothing to claim'}</button>
				</div>
				<div class="lx-coin-list">${w.coins.map((m) => coinRow(byMint.get(m))).join('')}</div>
			</article>`;
		})
		.join('');
	const grouped = new Set(data.wallets.flatMap((w) => w.coins));
	const others = data.coins.filter((c) => !grouped.has(c.mint));
	const otherCard = others.length
		? `<article class="lx-card"><p class="lx-reward-kicker">Other coins</p><div class="lx-coin-list" style="border-top:0">${others.map(coinRow).join('')}</div></article>`
		: '';
	box.innerHTML = `${walletCards}${otherCard}`;
	swapBrokenImages(box);
	for (const b of box.querySelectorAll('[data-claim]')) b.addEventListener('click', () => claim(b.dataset.claim));
}

async function claim(address) {
	const w = state.coins?.wallets.find((x) => x.address === address);
	if (!w || state.claiming.has(address)) return;
	if (!(await ensureRiskAck({ context: 'claim' }))) return;
	const status = (html) => {
		// Replaced on the next claim; the coin list re-renders below it without touching it.
		const el = $('#claim-status');
		if (el) el.innerHTML = html;
	};
	state.claiming.add(address);
	renderCoins();
	try {
		let signature;
		if (w.kind === 'agent') {
			const out = await api('/api/pump/collect-creator-fee-agent', {
				method: 'POST',
				body: { agent_id: w.agent.id, mint: w.claim_mint, network: 'mainnet', all_quotes: true },
			});
			signature = out.signature;
		} else {
			if (!state.wallet || state.wallet.address !== address) {
				await connectWallet();
				if (!state.wallet || state.wallet.address !== address) {
					throw new Error(`Switch your wallet to ${shortAddress(address)} to claim these rewards.`);
				}
			}
			const prep = await api('/api/pump/collect-creator-fee-prep', {
				method: 'POST',
				body: { creator_address: address, wallet_address: address, network: 'mainnet', all_quotes: true, v1_capable: !!state.wallet.v1 },
			});
			signature = await signAndBroadcast({ txBase64: prep.tx_base64, version: prep.transaction_version, address });
			const confirmed = await waitForConfirmation(signature);
			if (!confirmed) {
				status(`<div class="lx-alert is-warn">The claim was sent but has not confirmed yet. <a class="lx-link" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener">View on Solscan</a></div>`);
				return;
			}
		}
		status(`<div class="lx-alert is-good">Rewards claimed. <a class="lx-link" href="https://solscan.io/tx/${esc(signature)}" target="_blank" rel="noopener">View transaction</a></div>`);
	} catch (err) {
		status(`<div class="lx-alert" role="alert">${esc(friendlyLaunchError(err))}</div>`);
	} finally {
		state.claiming.delete(address);
		await loadCoins();
		refreshBalance();
	}
}

boot();
