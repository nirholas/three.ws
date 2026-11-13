/**
 * /drops/:slug - one generative 3D collection.
 *
 * Three things share this page and stay in sync through one `state` object:
 * the stage (a model-viewer for the selected item, or its sealed placeholder),
 * the item grid (paginated, filterable by rarity tier), and the provenance
 * panel (which re-derives the roll through /api/drops/verify rather than
 * asserting it).
 *
 * Reveal is a claim-then-poll job, so selecting a sealed item and pressing
 * Reveal starts a real forge job and this module polls /api/drops/reveal until
 * the GLB lands. Polling stops the moment the item leaves `revealing`, and on
 * page hide, so a backgrounded tab never holds an open loop.
 */

import { initMintPanel } from './drop-mint-panel.js';
import { getAccess, getTierPass, attachTierPass } from './three-access.js';
import { formatRemaining } from './early-countdown.js';

const PAGE_SIZE = 48;
const POLL_MS = 4000;
const TIERS = ['legendary', 'epic', 'rare', 'common'];

// Grid cells are ~132px wide, so the footer pill gets an abbreviation rather
// than the full tier name. These are explicit because slicing the word to a
// fixed length renders "legendary" as the meaningless "LEGE".
const TIER_SHORT = { legendary: 'LEG', epic: 'EPIC', rare: 'RARE', common: 'COM' };

const el = {
	page: document.getElementById('dr-page'),
	pageState: document.getElementById('dr-page-state'),
	name: document.getElementById('dr-name'),
	symbol: document.getElementById('dr-symbol'),
	status: document.getElementById('dr-status'),
	early: document.getElementById('dr-early'),
	description: document.getElementById('dr-description'),
	stage: document.getElementById('dr-stage'),
	itemActions: document.getElementById('dr-item-actions'),
	itemTraits: document.getElementById('dr-item-traits'),
	itemNote: document.getElementById('dr-item-note'),
	supplyMeter: document.getElementById('dr-supply-meter'),
	supplyFill: document.getElementById('dr-supply-fill'),
	supplyLabel: document.getElementById('dr-supply-label'),
	distribution: document.getElementById('dr-distribution'),
	hash: document.getElementById('dr-hash'),
	seed: document.getElementById('dr-seed'),
	verify: document.getElementById('dr-verify'),
	verifyNote: document.getElementById('dr-verify-note'),
	filters: document.getElementById('dr-filters'),
	items: document.getElementById('dr-items'),
	itemsCount: document.getElementById('dr-items-count'),
	more: document.getElementById('dr-more'),
};

const state = {
	slug: slugFromPath(),
	drop: null,
	distribution: [],
	items: [],
	total: 0,
	offset: 0,
	tier: null,
	selected: null,
	pollTimer: null,
};

function slugFromPath() {
	const parts = window.location.pathname.split('/').filter(Boolean);
	const i = parts.indexOf('drops');
	const raw = i >= 0 ? parts[i + 1] : parts[parts.length - 1];
	return raw ? decodeURIComponent(raw) : '';
}

/* ── load ─────────────────────────────────────────────────────────────── */

async function load() {
	if (!state.slug) return fail('No collection was named in the URL.');
	try {
		const res = await fetch(`/api/drops/get?slug=${encodeURIComponent(state.slug)}`, {
			headers: { accept: 'application/json' },
			credentials: 'same-origin',
		});
		if (res.status === 404) return fail('That collection does not exist, or is private.');
		if (res.status === 503) return fail('Drops are not enabled on this deployment.');
		if (!res.ok) throw new Error(`the collection returned ${res.status}`);

		const data = await res.json();
		state.drop = data.drop;
		state.distribution = data.distribution || [];
		state.items = data.items || [];
		state.offset = state.items.length;
		state.total = state.drop.supply;

		renderHeader();
		renderSupply(data.stats);
		renderDistribution();
		renderFilters();
		renderItems();
		select(state.items[0] || null);
		mintPanel = initMintPanel({
			getDrop: () => state.drop,
			getSelected: () => state.selected,
			onMinted: (m) => patchItem({ index: m.index, mint_address: m.mint_address, owner_wallet: m.owner_wallet, minted_at: m.minted_at }),
			reloadDrop,
		});
		mintPanel.render();

		el.page.hidden = false;
		document.title = `${state.drop.name} · three.ws Drops`;
	} catch (err) {
		fail(err?.message || 'Could not load this collection.');
	} finally {
		el.items.setAttribute('aria-busy', 'false');
	}
}

let mintPanel = null;

/** Re-read the drop so counts and the collection address reflect the chain writes. */
async function reloadDrop() {
	const res = await fetch(`/api/drops/get?slug=${encodeURIComponent(state.slug)}`, {
		headers: { accept: 'application/json' },
		credentials: 'same-origin',
	});
	if (!res.ok) return;
	const data = await res.json();
	state.drop = data.drop;
	renderSupply(data.stats);
	mintPanel?.render();
}

function fail(message) {
	el.pageState.innerHTML = '';
	const box = document.createElement('div');
	box.className = 'dr-error';
	const h = document.createElement('h3');
	h.textContent = 'Collection unavailable';
	const p = document.createElement('p');
	p.textContent = message;
	const back = document.createElement('a');
	back.className = 'dr-btn';
	back.href = '/drops';
	back.textContent = 'Browse all collections';
	box.append(h, p, back);
	el.pageState.appendChild(box);
}

/* ── header and panels ────────────────────────────────────────────────── */

let earlyTimer = null;
// The viewer's drops.early read for the current identity: null (not read yet),
// 'loading', 'error', or the access payload from /api/three/access.
let earlyAccess = null;

function earlyRemaining() {
	const drop = state.drop;
	if (drop?.status !== 'live' || !drop.public_opens_at) return 0;
	return new Date(drop.public_opens_at).getTime() - Date.now();
}

function earlyEligible() {
	return Boolean(earlyAccess && typeof earlyAccess === 'object' && earlyAccess.eligible);
}

/** Status chip plus the holder-window banner, re-rendered every second while the window runs. */
function renderStatus() {
	clearTimeout(earlyTimer);
	const remaining = earlyRemaining();
	if (remaining > 0) {
		el.status.textContent = `Public in ${formatRemaining(remaining)}`;
		renderEarlyBanner(remaining);
		earlyTimer = setTimeout(renderStatus, 1000);
		return;
	}
	el.early.hidden = true;
	el.status.textContent = state.drop.status === 'live' ? '' : state.drop.status;
	if (earlyAccess !== null) {
		// The window just closed: the reveal button no longer carries the holder hint.
		earlyAccess = null;
		renderItemActions();
	}
}

function earlyState() {
	if (earlyAccess === 'loading' || earlyAccess === null) return 'loading';
	if (earlyAccess === 'error') return 'error';
	return earlyAccess.eligible ? 'eligible' : 'locked';
}

function renderEarlyBanner(remaining) {
	el.early.hidden = false;
	if (earlyAccess === null) loadEarlyAccess();
	const clock = formatRemaining(remaining);
	const view = earlyState();
	el.early.setAttribute('aria-busy', view === 'loading' ? 'true' : 'false');

	// Only the clock changes every tick; rebuild the banner when the state does.
	if (el.early.dataset.state === view) {
		const c = el.early.querySelector('[data-clock]');
		if (c) c.textContent = clock;
		return;
	}
	el.early.dataset.state = view;
	el.early.innerHTML = '';

	if (view === 'loading') {
		el.early.innerHTML =
			'<span class="dr-sr-only">Checking your $THREE tier</span>' +
			'<span class="dr-early-skel" style="width:58%" aria-hidden="true"></span>' +
			'<span class="dr-early-skel" style="width:32%" aria-hidden="true"></span>';
		return;
	}

	const badge = document.createElement('span');
	badge.className = 'dr-early-badge';
	const text = document.createElement('p');
	text.className = 'dr-early-text';
	const countdown = document.createElement('strong');
	countdown.dataset.clock = '';
	countdown.textContent = clock;

	if (view === 'error') {
		badge.textContent = 'Holder window';
		text.append('We could not check your $THREE tier. Gold holders reveal first; everyone can reveal in ', countdown, '.');
		const retry = document.createElement('button');
		retry.type = 'button';
		retry.className = 'dr-btn dr-btn-sm';
		retry.textContent = 'Retry';
		retry.addEventListener('click', () => {
			earlyAccess = null;
			renderStatus();
		});
		el.early.append(badge, text, retry);
		return;
	}

	const tierLabel = earlyAccess.required?.label || 'Gold';
	if (view === 'eligible') {
		badge.textContent = 'Early access';
		const held = earlyAccess.held?.label || tierLabel;
		text.append(`Your ${held} hold lets you reveal now. Everyone else can in `, countdown, '.');
		el.early.append(badge, text);
		return;
	}

	badge.textContent = `${tierLabel} holders first`;
	text.append('Reveals open to everyone in ', countdown, `. Hold ${tierLabel} in $THREE to reveal now.`);
	const tiers = document.createElement('a');
	tiers.className = 'dr-btn dr-btn-sm';
	tiers.href = '/three';
	tiers.textContent = 'See $THREE tiers';
	el.early.append(badge, text, tiers);
}

async function loadEarlyAccess() {
	earlyAccess = 'loading';
	const data = await getAccess('drops.early', { fresh: true });
	earlyAccess = data?.access || 'error';
	if (earlyRemaining() > 0) {
		renderStatus();
		renderItemActions();
	}
}

function renderHeader() {
	el.name.textContent = state.drop.name;
	el.symbol.textContent = state.drop.symbol;
	el.description.textContent = state.drop.description || state.drop.style;
	renderStatus();
	el.hash.textContent = `provenance ${state.drop.provenance_hash}`;
	el.seed.textContent = state.drop.seed ? `seed ${state.drop.seed}` : 'seed sealed until launch';
}

function renderSupply(stats) {
	const revealed = stats?.by_status?.revealed || 0;
	const supply = state.drop.supply;
	const pct = supply ? Math.round((revealed / supply) * 100) : 0;
	el.supplyFill.style.width = `${pct}%`;
	el.supplyMeter.setAttribute('aria-valuemax', String(supply));
	el.supplyMeter.setAttribute('aria-valuenow', String(revealed));
	el.supplyMeter.setAttribute('aria-label', `${revealed} of ${supply} revealed`);
	el.supplyLabel.textContent = `${revealed.toLocaleString()} of ${supply.toLocaleString()} revealed`;
}

function renderDistribution() {
	el.distribution.innerHTML = '';
	if (!state.distribution.length) {
		const p = document.createElement('p');
		p.className = 'dr-hint';
		p.textContent = 'No trait layers on this collection.';
		el.distribution.appendChild(p);
		return;
	}
	for (const layer of state.distribution) {
		const box = document.createElement('div');
		box.className = 'dr-dist-layer';
		const h = document.createElement('h4');
		h.textContent = layer.layer_name;
		box.appendChild(h);
		for (const v of layer.values) {
			const row = document.createElement('div');
			row.className = 'dr-dist-row';
			const name = document.createElement('span');
			name.textContent = v.value;
			const share = document.createElement('span');
			share.textContent = `${(v.share * 100).toFixed(1)}%`;
			share.title = `${v.count} of ${state.drop.supply}`;
			row.append(name, share);
			box.appendChild(row);
		}
		el.distribution.appendChild(box);
	}
}

function renderFilters() {
	el.filters.innerHTML = '';
	const all = chip('All', state.tier === null, () => applyTier(null));
	el.filters.appendChild(all);
	for (const tier of TIERS) {
		el.filters.appendChild(
			chip(tier[0].toUpperCase() + tier.slice(1), state.tier === tier, () => applyTier(tier)),
		);
	}
}

function chip(label, pressed, onClick) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'dr-chip';
	b.textContent = label;
	b.setAttribute('aria-pressed', String(pressed));
	b.addEventListener('click', onClick);
	return b;
}

async function applyTier(tier) {
	state.tier = tier;
	state.offset = 0;
	state.items = [];
	renderFilters();
	el.items.setAttribute('aria-busy', 'true');
	await loadMore(true);
	el.items.setAttribute('aria-busy', 'false');
}

/* ── items ────────────────────────────────────────────────────────────── */

async function loadMore(replace = false) {
	const params = new URLSearchParams({
		slug: state.slug,
		limit: String(PAGE_SIZE),
		offset: String(replace ? 0 : state.offset),
	});
	if (state.tier) params.set('tier', state.tier);

	try {
		const res = await fetch(`/api/drops/items?${params}`, {
			headers: { accept: 'application/json' },
			credentials: 'same-origin',
		});
		if (!res.ok) throw new Error(`items returned ${res.status}`);
		const data = await res.json();
		state.items = replace ? data.items : state.items.concat(data.items);
		state.offset = state.items.length;
		state.total = data.total;
		renderItems();
		if (replace) select(state.items[0] || null);
	} catch (err) {
		note(el.itemNote, err?.message || 'Could not load more items.', 'error');
	}
}

function renderItems() {
	el.items.innerHTML = '';
	el.itemsCount.textContent = `${state.items.length.toLocaleString()} of ${state.total.toLocaleString()}`;
	for (const item of state.items) el.items.appendChild(itemButton(item));
	el.more.hidden = state.items.length >= state.total;
}

function itemButton(item) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'dr-item';
	b.setAttribute('aria-current', String(state.selected?.index === item.index));
	b.setAttribute('aria-label', `Item ${item.index}, ${item.rarity_tier}, rank ${item.rarity_rank}`);

	const art = document.createElement('div');
	art.className = 'dr-item-art';
	if (item.thumbnail_url) {
		const img = document.createElement('img');
		img.src = item.thumbnail_url;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		art.appendChild(img);
	} else {
		art.textContent = item.status === 'revealed' ? '3D' : `#${item.index}`;
	}

	const foot = document.createElement('div');
	foot.className = 'dr-item-foot';
	const rank = document.createElement('span');
	rank.textContent = `#${item.rarity_rank}`;
	const pill = document.createElement('span');
	pill.className = `dr-pill dr-pill--${item.rarity_tier}`;
	pill.textContent = TIER_SHORT[item.rarity_tier] || item.rarity_tier;
	foot.append(rank, pill);

	if (item.mint_address) {
		const badge = document.createElement('span');
		badge.className = 'dr-minted-badge';
		badge.textContent = 'minted';
		art.appendChild(badge);
	}

	b.append(art, foot);
	b.addEventListener('click', () => select(item));
	return b;
}

/* ── stage ────────────────────────────────────────────────────────────── */

function select(item) {
	stopPolling();
	queueMicrotask(() => mintPanel?.render());
	state.selected = item;
	renderItems();
	renderStage();
	renderItemTraits();
	renderItemActions();
	note(el.itemNote, '', '');
	if (item?.status === 'revealing') startPolling();
}

function renderStage() {
	el.stage.innerHTML = '';
	const item = state.selected;
	if (!item) {
		el.stage.appendChild(sealedMark('No item selected', 'Pick one from the grid below.'));
		return;
	}

	if (item.status === 'revealed' && item.glb_url) {
		const viewer = document.createElement('model-viewer');
		viewer.setAttribute('src', item.glb_url);
		viewer.setAttribute('alt', `${state.drop.name} item ${item.index}`);
		viewer.setAttribute('camera-controls', '');
		viewer.setAttribute('auto-rotate', '');
		viewer.setAttribute('touch-action', 'pan-y');
		viewer.setAttribute('shadow-intensity', '1');
		viewer.setAttribute('environment-image', 'neutral');
		viewer.setAttribute('loading', 'lazy');
		el.stage.appendChild(viewer);
		return;
	}

	if (item.status === 'revealing') {
		el.stage.appendChild(sealedMark('Forging', `Item #${item.index} is being generated. This takes a minute or two.`));
		return;
	}

	if (item.status === 'failed') {
		el.stage.appendChild(
			sealedMark('Reveal failed', item.reveal_error || 'The generator could not finish this item. Try again.'),
		);
		return;
	}

	el.stage.appendChild(
		sealedMark(`#${item.index}`, 'Sealed. Its traits are already rolled and public; only the art is unforged.'),
	);
}

function sealedMark(title, body) {
	const wrap = document.createElement('div');
	wrap.className = 'dr-sealed';
	const mark = document.createElement('div');
	mark.className = 'dr-sealed-mark';
	mark.textContent = title;
	const p = document.createElement('p');
	p.style.margin = '0';
	p.style.maxWidth = '34ch';
	p.textContent = body;
	wrap.append(mark, p);
	return wrap;
}

function renderItemTraits() {
	el.itemTraits.innerHTML = '';
	const item = state.selected;
	if (!item) return;

	const shareOf = (layerKey, value) => {
		const layer = state.distribution.find((l) => l.layer === layerKey);
		const hit = layer?.values.find((v) => v.value === value);
		return hit ? `${(hit.share * 100).toFixed(1)}%` : '';
	};

	const rank = document.createElement('div');
	rank.className = 'dr-trait';
	rank.innerHTML = `<dt>Rarity</dt>`;
	const rankDd = document.createElement('dd');
	rankDd.append(document.createTextNode(`Rank ${item.rarity_rank} `));
	const pill = document.createElement('span');
	pill.className = `dr-pill dr-pill--${item.rarity_tier}`;
	pill.textContent = item.rarity_tier;
	rankDd.appendChild(pill);
	rank.appendChild(rankDd);
	el.itemTraits.appendChild(rank);

	for (const t of item.traits) {
		const box = document.createElement('div');
		box.className = 'dr-trait';
		const dt = document.createElement('dt');
		dt.textContent = t.layer_name || t.layer;
		const dd = document.createElement('dd');
		dd.textContent = t.value;
		const share = document.createElement('div');
		share.className = 'dr-trait-share';
		share.textContent = shareOf(t.layer, t.value);
		box.append(dt, dd, share);
		el.itemTraits.appendChild(box);
	}
}

function renderItemActions() {
	el.itemActions.innerHTML = '';
	const item = state.selected;
	if (!item) return;

	if (item.status === 'revealed' && item.glb_url) {
		el.itemActions.appendChild(
			link('Open in viewer', `/viewer?src=${encodeURIComponent(item.glb_url)}`),
		);
		el.itemActions.appendChild(link('Download GLB', item.glb_url, true));
		if (item.mint_address) {
			const net = state.drop?.collection_network === 'devnet' ? '?cluster=devnet' : '';
			el.itemActions.appendChild(link('View on Solscan', `https://solscan.io/token/${item.mint_address}${net}`));
		}
		return;
	}

	if (item.status === 'sealed' || item.status === 'failed') {
		const reveal = document.createElement('button');
		reveal.type = 'button';
		reveal.className = 'dr-btn dr-btn-primary';
		reveal.textContent = item.status === 'failed' ? 'Retry reveal' : 'Reveal this item';
		if (earlyRemaining() > 0 && earlyState() === 'locked') {
			const tier = earlyAccess.required?.label || 'Gold';
			reveal.title = `Opens to everyone when the countdown ends, or now for ${tier} holders.`;
		}
		reveal.addEventListener('click', () => startReveal(item, reveal));
		el.itemActions.appendChild(reveal);
	}
}

function link(label, href, download = false) {
	const a = document.createElement('a');
	a.className = 'dr-btn';
	a.href = href;
	a.textContent = label;
	if (download) a.setAttribute('download', '');
	else if (href.startsWith('http')) a.rel = 'noopener';
	return a;
}

/* ── reveal ───────────────────────────────────────────────────────────── */

async function startReveal(item, button) {
	button.disabled = true;
	note(el.itemNote, 'Starting the forge...', '');
	try {
		// Inside the holder window the server checks drops.early, so prove the hold
		// with a fresh tier pass. Ask the wallet to sign only when the read says this
		// identity is eligible, so a non-holder is never prompted for nothing.
		if (earlyRemaining() > 0) {
			await getTierPass({ interactive: earlyEligible() });
		}
		const res = await fetch('/api/drops/reveal', {
			method: 'POST',
			headers: attachTierPass({ 'content-type': 'application/json' }),
			credentials: 'same-origin',
			body: JSON.stringify({ slug: state.slug, index: item.index }),
		});
		const data = await res.json().catch(() => ({}));

		if (res.status === 401) {
			note(el.itemNote, 'Sign in to reveal an item.', 'error');
			button.disabled = false;
			return;
		}
		if (res.status === 402 && data?.error === 'three_hold_required') {
			holdRequiredNote(data);
			button.disabled = false;
			return;
		}
		if (!res.ok && res.status !== 202) {
			note(el.itemNote, data?.message || `The forge returned ${res.status}.`, 'error');
			button.disabled = false;
			return;
		}

		patchItem(data.item);
		if (data.item?.status === 'revealed') {
			note(el.itemNote, 'Revealed.', 'ok');
		} else {
			note(el.itemNote, 'Generating. This page updates itself when the model lands.', '');
			startPolling();
		}
	} catch (err) {
		note(el.itemNote, err?.message || 'Could not reach the forge.', 'error');
		button.disabled = false;
	}
}

function startPolling() {
	stopPolling();
	state.pollTimer = window.setInterval(pollSelected, POLL_MS);
}

function stopPolling() {
	if (state.pollTimer) {
		window.clearInterval(state.pollTimer);
		state.pollTimer = null;
	}
}

async function pollSelected() {
	const item = state.selected;
	if (!item) return stopPolling();
	try {
		const res = await fetch(
			`/api/drops/reveal?slug=${encodeURIComponent(state.slug)}&index=${item.index}`,
			{ headers: { accept: 'application/json' }, credentials: 'same-origin' },
		);
		if (!res.ok) return;
		const data = await res.json();
		if (!data.item) return;
		patchItem(data.item);
		if (data.item.status !== 'revealing') {
			stopPolling();
			note(
				el.itemNote,
				data.item.status === 'revealed' ? 'Revealed.' : data.item.reveal_error || 'Reveal stopped.',
				data.item.status === 'revealed' ? 'ok' : 'error',
			);
		}
	} catch {
		// A dropped poll is not a failed reveal; the next tick tries again.
	}
}

function patchItem(next) {
	if (!next) return;
	const i = state.items.findIndex((x) => x.index === next.index);
	if (i >= 0) state.items[i] = { ...state.items[i], ...next };
	if (state.selected?.index === next.index) state.selected = { ...state.selected, ...next };
	renderItems();
	renderStage();
	renderItemActions();
	refreshSupply();
}

async function refreshSupply() {
	try {
		const res = await fetch(`/api/drops/get?slug=${encodeURIComponent(state.slug)}`, {
			headers: { accept: 'application/json' },
			credentials: 'same-origin',
		});
		if (!res.ok) return;
		const data = await res.json();
		renderSupply(data.stats);
	} catch {
		// The meter is a readout, not a gate. A failed refresh leaves the last
		// good number on screen rather than blanking it.
	}
}

/* ── verify ───────────────────────────────────────────────────────────── */

async function verify() {
	el.verify.disabled = true;
	note(el.verifyNote, 'Recomputing the roll from the published spec...', '');
	try {
		const params = new URLSearchParams({ slug: state.slug });
		if (state.selected) params.set('index', String(state.selected.index));
		const res = await fetch(`/api/drops/verify?${params}`, {
			headers: { accept: 'application/json' },
			credentials: 'same-origin',
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			note(el.verifyNote, data?.message || `Verification returned ${res.status}.`, 'error');
			return;
		}

		const hashOk = data.hash_matches;
		const itemOk = data.item ? data.item.traits_match : true;
		if (hashOk && itemOk) {
			note(
				el.verifyNote,
				data.item
					? `Verified. The provenance hash matches the spec, and item #${data.item.index} re-rolls to exactly the traits served.`
					: 'Verified. The provenance hash matches the published spec.',
				'ok',
			);
		} else {
			note(
				el.verifyNote,
				hashOk
					? 'The provenance hash matches, but the selected item does not re-roll to the traits served. Report this collection.'
					: 'The provenance hash does not match the published spec. Report this collection.',
				'error',
			);
		}
	} catch (err) {
		note(el.verifyNote, err?.message || 'Could not run verification.', 'error');
	} finally {
		el.verify.disabled = false;
	}
}

/* ── wire ─────────────────────────────────────────────────────────────── */

/** The 402 from the holder window: which tier is needed, how far off, and where to get it. */
function holdRequiredNote(gate) {
	const tier = gate.required?.label || 'Gold';
	const toGo = Number(gate.usd_to_go);
	const short = toGo > 0 ? ` You are $${toGo.toFixed(2)} short.` : '';
	note(
		el.itemNote,
		`${tier} holders reveal first during this window.${short} It opens to everyone when the countdown ends. `,
		'error',
	);
	const a = document.createElement('a');
	a.href = '/three';
	a.className = 'dr-note-link';
	a.textContent = 'See $THREE tiers';
	el.itemNote.appendChild(a);
}

function note(target, message, kind) {
	target.textContent = message || '';
	target.className = `dr-note${kind ? ` dr-note--${kind}` : ''}`;
}

el.more?.addEventListener('click', () => loadMore(false));
el.verify?.addEventListener('click', verify);

// A different wallet is a different holder: re-read the early-window access.
window.addEventListener('wallet:changed', () => {
	if (!state.drop || earlyRemaining() <= 0) return;
	earlyAccess = null;
	renderStatus();
});

// A backgrounded tab must not keep an open poll loop running.
document.addEventListener('visibilitychange', () => {
	if (document.hidden) stopPolling();
	else if (state.selected?.status === 'revealing') startPolling();
});
window.addEventListener('pagehide', stopPolling);

load();
