import { getWallets } from '@wallet-standard/app';
import { injectedProvider } from './launch/launch-wallet.js';
import { findV1WalletStandardSigner } from './onchain/adapters/solana.js';

const $ = (id) => document.getElementById(id);
const state = { mode: 'signature', lastInspection: null, replayNextBefore: null };

function formatNumber(value) {
	return value == null ? 'Not set' : Number(value).toLocaleString('en-US');
}

function shortKey(key) {
	return key ? `${key.slice(0, 4)}..${key.slice(-4)}` : 'unknown';
}

function solFromRaw(raw) {
	if (raw == null) return null;
	return Number(BigInt(raw)) / 1e9;
}

function tokensFromRaw(raw) {
	if (raw == null) return null;
	return Number(BigInt(raw)) / 1e6;
}

function fmtSol(raw) {
	const n = solFromRaw(raw);
	return n == null ? 'not set' : `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL`;
}

function fmtTokens(raw) {
	const n = tokensFromRaw(raw);
	return n == null ? 'not set' : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} tokens`;
}

/** A typed pump event (or a flattened replay trade) reduced to what the Replay panel renders. */
function describeStep(event) {
	const d = event.data || {};
	switch (event.type) {
		case 'create':
			return {
				kind: 'create',
				title: 'Launch created',
				pct: event.curveProgressPct ?? 0,
				detail: `${d.name} (${d.symbol}) - creator ${shortKey(d.creator)}`,
				delta: `${fmtTokens(d.tokenTotalSupply)} total supply`,
			};
		case 'trade':
			return {
				kind: 'trade',
				title: d.isBuy ? 'Buy' : 'Sell',
				pct: event.curveProgressPct,
				detail: `${shortKey(d.user)} ${d.isBuy ? 'bought' : 'sold'} on the bonding curve`,
				delta: `${fmtSol(d.solAmount)} ${d.isBuy ? 'in' : 'out'} · ${fmtTokens(d.tokenAmount)} ${d.isBuy ? 'out' : 'in'}`,
			};
		case 'complete':
			return {
				kind: 'complete',
				title: 'Graduated',
				pct: 100,
				detail: `Bonding curve completed for ${shortKey(d.mint)}`,
				delta: 'Liquidity migrated to PumpSwap',
			};
		case 'collectCreatorFee':
			return { kind: 'fee', title: 'Creator fee collected', pct: null, detail: `Creator ${shortKey(d.creator)}`, delta: fmtSol(d.creatorFee) };
		case 'distributeCreatorFees':
			return {
				kind: 'fee',
				title: 'Creator fees distributed',
				pct: null,
				detail: `${(d.shareholders || []).length} shareholder(s)`,
				delta: fmtSol(d.distributed),
			};
		case 'socialFeePdaClaimed':
			return { kind: 'fee', title: 'GitHub social fee claimed', pct: null, detail: `GitHub user ${d.userId}`, delta: fmtSol(d.amountClaimed) };
		case 'ammBuy':
		case 'ammSell':
			return {
				kind: 'amm',
				title: event.type === 'ammBuy' ? 'Buy (PumpSwap)' : 'Sell (PumpSwap)',
				pct: 100,
				detail: `${shortKey(d.user)} traded on the graduated pool`,
				delta: `${fmtSol(d.quoteAmountIn ?? d.quoteAmountOut)} SOL side · ${fmtTokens(d.baseAmountOut ?? d.baseAmountIn)} token side`,
			};
		case 'ammInitUserVolumeAccumulator':
		case 'ammCloseUserVolumeAccumulator':
			return { kind: 'amm-minor', title: 'Volume accumulator', pct: null, detail: shortKey(d.user), delta: null };
		case 'unrecognized':
			return {
				kind: 'unrecognized',
				title: 'Unrecognized event',
				pct: null,
				detail: `Program ${shortKey(event.programId)} · discriminator ${event.discriminator}`,
				delta: null,
			};
		default:
			return { kind: 'other', title: event.type, pct: event.curveProgressPct ?? null, detail: 'Decoded event', delta: null };
	}
}

/** A trade from inspection.replay.trades: flat shape, not a {type,data} event. */
function describeReplayTrade(t) {
	return {
		kind: 'trade',
		title: t.side === 'buy' ? 'Buy' : 'Sell',
		pct: t.curveProgressPct,
		detail: `${shortKey(t.user)} ${t.side === 'buy' ? 'bought' : 'sold'} on the bonding curve`,
		delta: `${fmtSol(t.solAmountRaw)} ${t.side === 'buy' ? 'in' : 'out'} · ${fmtTokens(t.tokenAmountRaw)} ${t.side === 'buy' ? 'out' : 'in'}`,
		sig: t.signature,
	};
}

function stepToElement(d, i) {
	const li = document.createElement('li');
	li.className = `at-replay-step is-${d.kind}`;
	const head = document.createElement('div');
	head.className = 'at-replay-step-head';
	const idx = document.createElement('span');
	idx.className = 'at-replay-step-index';
	idx.textContent = String(i + 1).padStart(2, '0');
	const title = document.createElement('strong');
	title.textContent = d.title;
	head.append(idx, title);
	if (d.pct != null) {
		const pct = document.createElement('span');
		pct.className = 'at-replay-step-pct';
		pct.textContent = `${d.pct}%`;
		head.append(pct);
	}
	li.append(head);
	if (d.detail) {
		const p = document.createElement('p');
		p.className = 'at-replay-step-detail';
		p.textContent = d.detail;
		li.append(p);
	}
	if (d.delta) {
		const p = document.createElement('p');
		p.className = 'at-replay-step-delta';
		p.textContent = d.delta;
		li.append(p);
	}
	if (d.sig) {
		const a = document.createElement('a');
		a.href = `https://solscan.io/tx/${d.sig}`;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
		a.className = 'at-replay-step-link';
		a.textContent = 'View trade';
		li.append(a);
	}
	return li;
}

function renderReplay(inspection) {
	const events = inspection.events || [];
	const replay = inspection.replay;
	const empty = $('at-replay-empty');
	const curveWrap = $('at-replay-curve');
	const steps = $('at-replay-steps');
	const errorBox = $('at-replay-error');
	const loadmoreWrap = $('at-replay-loadmore-wrap');
	const mintLink = $('at-replay-mint-link');

	const hasReplayTrades = Boolean(replay && replay.trades && replay.trades.length);
	empty.hidden = events.length > 0 || hasReplayTrades;

	const descriptors = events.map(describeStep);
	if (replay) descriptors.push(...replay.trades.map(describeReplayTrade));
	steps.replaceChildren(...descriptors.map(stepToElement));

	const pcts = descriptors.map((d) => d.pct).filter((p) => p != null);
	if (pcts.length) {
		const last = pcts[pcts.length - 1];
		curveWrap.hidden = false;
		$('at-replay-curve-fill').style.width = `${Math.min(100, last)}%`;
		$('at-replay-curve-note').textContent = last >= 100 ? 'Graduated to PumpSwap.' : `${last}% of the bonding curve filled.`;
	} else {
		curveWrap.hidden = true;
	}

	const mintish = replay ? replay.mint : events.find((e) => e.data && e.data.mint)?.data?.mint;
	mintLink.hidden = !mintish;
	if (mintish) mintLink.href = `/launches/${mintish}`;

	errorBox.hidden = !(replay && replay.error);
	if (replay && replay.error) $('at-replay-error-message').textContent = replay.error;

	loadmoreWrap.hidden = !(replay && replay.hasMore);
	state.replayNextBefore = replay ? replay.nextBefore : null;
}

function show(name) {
	for (const key of ['loading', 'error', 'report', 'empty']) $(`at-${key}`).hidden = key !== name;
}

function setMode(mode) {
	state.mode = mode;
	for (const tab of document.querySelectorAll('[data-mode]')) {
		tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
	}
	const wire = mode === 'wire';
	$('at-input-label').textContent = wire ? 'Signed or partially signed transaction bytes' : 'Solana mainnet transaction signature';
	$('at-input').placeholder = wire ? 'Paste a base64-encoded wire transaction' : 'Paste a transaction signature';
	$('at-input').rows = wire ? 6 : 2;
	$('at-hint').textContent = wire
		? 'Decoded locally by the API. The transaction is not simulated, signed, or broadcast.'
		: 'Fetched through the three.ws rotating Solana RPC rail with V1 reads enabled.';
	$('at-submit').textContent = wire ? 'Inspect wire bytes' : 'Inspect transaction';
	$('at-input').focus();
}

async function responseJson(response) {
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(data.message || data.error_description || data.error || `Request failed with HTTP ${response.status}`);
	return data;
}

/** Fetches an /api/solana/atomic inspection for a signature or base64 wire value, shared by the Inspector, Mask, and Sponsor tabs. */
async function fetchInspectionFor(mode, value) {
	const request = mode === 'wire'
		? fetch('/api/solana/atomic', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ transaction: value }),
		})
		: fetch(`/api/solana/atomic?signature=${encodeURIComponent(value)}`, { headers: { accept: 'application/json' } });
	const { inspection } = await request.then(responseJson);
	return inspection;
}

async function loadStatus() {
	try {
		const { status } = await fetch('/api/solana/atomic', { headers: { accept: 'application/json' } }).then(responseJson);
		$('at-live').classList.toggle('is-live', status.active);
		$('at-live').querySelector('strong').textContent = status.active ? 'V1 live on mainnet' : 'V1 gate not active';
		$('at-slot').textContent = `Slot ${formatNumber(status.currentSlot)}`;
	} catch {
		$('at-live').querySelector('strong').textContent = 'Mainnet status unavailable';
		$('at-slot').textContent = 'Inspector still available';
	}
}

function budgetValue(value, suffix, isExplicit) {
	if (value == null) return '<not set>';
	return `${formatNumber(value)} ${suffix}${isExplicit ? '' : ' · implicit'}`;
}

function render(inspection) {
	state.lastInspection = inspection;
	$('at-version').textContent = inspection.versionLabel;
	$('at-bytes').textContent = formatNumber(inspection.bytes);
	$('at-headroom').textContent = `${formatNumber(inspection.headroomBytes)} bytes free`;
	$('at-size-fill').style.width = `${Math.min(100, inspection.utilizationPct)}%`;
	$('at-legacy-mark').style.left = `${(1232 / inspection.limitBytes) * 100}%`;
	$('at-legacy-mark').hidden = inspection.limitBytes <= 1232;
	$('at-size-note').textContent = inspection.largerThanLegacyLimit
		? `This payload is ${formatNumber(inspection.bytes - 1232)} bytes beyond the old transaction wall. V1 makes it a single atomic landing.`
		: `${inspection.utilizationPct}% of the ${formatNumber(inspection.limitBytes)}-byte ${inspection.versionLabel} envelope is in use.`;
	$('at-signatures').textContent = `${inspection.signatureCount} / ${inspection.requiredSignatureCount} required`;
	$('at-accounts').textContent = formatNumber(inspection.staticAccountCount);
	$('at-instructions').textContent = formatNumber(inspection.instructionCount);

	const confirmed = inspection.confirmation;
	$('at-compute-used').textContent = confirmed?.computeUnitsConsumed == null
		? 'Not on-chain'
		: `${formatNumber(confirmed.computeUnitsConsumed)}${confirmed.computeUtilizationPct == null ? '' : ` · ${confirmed.computeUtilizationPct}%`}`;

	const budget = inspection.budget;
	$('at-config-source').textContent = budget.source === 'transaction-config' ? 'V1 config' : 'Compute Budget instructions';
	$('at-cu-limit').textContent = budgetValue(budget.computeUnitLimit, 'CU', budget.explicit.computeUnitLimit);
	$('at-data-limit').textContent = budgetValue(budget.loadedAccountsDataSizeLimit, 'bytes', budget.explicit.loadedAccountsDataSizeLimit);
	$('at-heap').textContent = budgetValue(budget.heapSize, 'bytes', budget.explicit.heapSize);
	$('at-priority').textContent = budgetValue(budget.priorityFeeLamports, 'lamports total', budget.explicit.priorityFee);

	const badge = $('at-verdict-badge');
	badge.className = 'at-verdict-badge';
	if (inspection.version === 1 && inspection.sponsor.safeToCosign) {
		badge.textContent = 'Caps explicit';
		badge.classList.add('is-safe');
		$('at-verdict-copy').textContent = 'The 0x81 envelope is V1 and both execution limits are explicit in transactionConfig.';
	} else if (inspection.version === 1) {
		badge.textContent = 'Limits missing';
		badge.classList.add('is-warn');
		$('at-verdict-copy').textContent = 'This is V1, but at least one required execution limit resolves to zero.';
	} else {
		badge.textContent = 'Legacy budget rules';
		$('at-verdict-copy').textContent = `${inspection.versionLabel} keeps the 1,232-byte ceiling and instruction-based compute budget.`;
	}

	$('at-notes').replaceChildren(...inspection.sponsor.notes.map((note) => {
		const item = document.createElement('li');
		item.textContent = note;
		return item;
	}));
	const explorer = $('at-explorer');
	explorer.hidden = !inspection.explorerUrl;
	if (inspection.explorerUrl) explorer.href = inspection.explorerUrl;
	$('at-share').hidden = !inspection.signature;
	renderReplay(inspection);
	show('report');
}

async function inspect() {
	const value = $('at-input').value.trim();
	if (!value) {
		$('at-error-message').textContent = state.mode === 'wire' ? 'Paste base64 wire bytes first.' : 'Paste a Solana transaction signature first.';
		show('error');
		return;
	}

	show('loading');
	$('at-submit').disabled = true;
	try {
		const inspection = await fetchInspectionFor(state.mode, value);
		render(inspection);
		if (state.mode === 'signature') {
			const url = new URL(location.href);
			url.searchParams.set('signature', value);
			history.replaceState(null, '', url);
		}
	} catch (err) {
		$('at-error-message').textContent = err.message;
		show('error');
	} finally {
		$('at-submit').disabled = false;
	}
}

for (const tab of document.querySelectorAll('[data-mode]')) tab.addEventListener('click', () => setMode(tab.dataset.mode));
$('at-form').addEventListener('submit', (event) => { event.preventDefault(); inspect(); });
$('at-retry').addEventListener('click', inspect);
$('at-share').addEventListener('click', async () => {
	await navigator.clipboard.writeText(location.href);
	const button = $('at-share');
	button.textContent = 'Link copied';
	setTimeout(() => { button.textContent = 'Copy inspection link'; }, 1_400);
});

$('at-replay-loadmore').addEventListener('click', async () => {
	const signature = state.lastInspection?.signature;
	if (!signature || !state.replayNextBefore) return;
	const button = $('at-replay-loadmore');
	button.disabled = true;
	$('at-replay-skeleton').hidden = false;
	try {
		const { inspection } = await fetch('/api/solana/atomic', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ signature, before: state.replayNextBefore }),
		}).then(responseJson);
		const replay = state.lastInspection.replay;
		replay.trades = [...(replay.trades || []), ...(inspection.replay?.trades || [])];
		replay.hasMore = inspection.replay?.hasMore ?? false;
		replay.nextBefore = inspection.replay?.nextBefore ?? null;
		replay.error = inspection.replay?.error ?? null;
		renderReplay(state.lastInspection);
	} catch (err) {
		$('at-replay-error-message').textContent = err.message;
		$('at-replay-error').hidden = false;
	} finally {
		button.disabled = false;
		$('at-replay-skeleton').hidden = true;
	}
});

$('at-replay-retry').addEventListener('click', async () => {
	const signature = state.lastInspection?.signature;
	if (!signature) return;
	$('at-replay-error').hidden = true;
	$('at-replay-skeleton').hidden = false;
	try {
		const { inspection } = await fetch(`/api/solana/atomic?signature=${encodeURIComponent(signature)}`, {
			headers: { accept: 'application/json' },
			cache: 'no-store',
		}).then(responseJson);
		state.lastInspection.replay = inspection.replay;
		renderReplay(state.lastInspection);
	} catch (err) {
		$('at-replay-error-message').textContent = err.message;
		$('at-replay-error').hidden = false;
	} finally {
		$('at-replay-skeleton').hidden = true;
	}
});

// ---------------------------------------------------------------------------
// Top-level lab tabs: Inspector, Config mask, Sponsor caps, Planner, Diff,
// Wallet check. Deep-linked via ?tab=<key> and reachable by arrow-key/Home/End
// on the tablist, per the ARIA tabs pattern.
// ---------------------------------------------------------------------------

const TAB_KEYS = ['inspector', 'mask', 'sponsor', 'planner', 'diff', 'wallet'];

function switchTab(tab) {
	if (!TAB_KEYS.includes(tab)) return;
	for (const key of TAB_KEYS) {
		const active = key === tab;
		$(`at-nav-tab-${key}`).setAttribute('aria-selected', String(active));
		$(`at-nav-tab-${key}`).tabIndex = active ? 0 : -1;
		$(`at-panel-${key}`).hidden = !active;
	}
	const url = new URL(location.href);
	url.searchParams.set('tab', tab);
	history.replaceState(null, '', url);
}

const navTabButtons = TAB_KEYS.map((key) => $(`at-nav-tab-${key}`));
for (const button of navTabButtons) button.addEventListener('click', () => switchTab(button.dataset.tab));
$('at-nav-tabs').addEventListener('keydown', (event) => {
	const currentIndex = navTabButtons.findIndex((button) => button.getAttribute('aria-selected') === 'true');
	let nextIndex = null;
	if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % navTabButtons.length;
	else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + navTabButtons.length) % navTabButtons.length;
	else if (event.key === 'Home') nextIndex = 0;
	else if (event.key === 'End') nextIndex = navTabButtons.length - 1;
	if (nextIndex == null) return;
	event.preventDefault();
	switchTab(navTabButtons[nextIndex].dataset.tab);
	navTabButtons[nextIndex].focus();
});

// ---------------------------------------------------------------------------
// Config mask decoder tab
// ---------------------------------------------------------------------------

const maskState = { mode: 'signature' };

function showMask(name) {
	for (const key of ['loading', 'error', 'report', 'empty']) $(`at-mask-${key}`).hidden = key !== name;
}

function setMaskMode(mode) {
	maskState.mode = mode;
	for (const tab of document.querySelectorAll('[data-mask-mode]')) tab.setAttribute('aria-selected', String(tab.dataset.maskMode === mode));
	const wire = mode === 'wire';
	$('at-mask-input-label').textContent = wire ? 'Signed or partially signed transaction bytes' : 'Solana mainnet transaction signature';
	$('at-mask-input').placeholder = wire ? 'Paste a base64-encoded wire transaction' : 'Paste a transaction signature';
	$('at-mask-input').rows = wire ? 6 : 2;
}

function bitsLabel(bits) {
	return bits.length > 1 ? `bits ${bits[0]}-${bits[bits.length - 1]}` : `bit ${bits[0]}`;
}

function renderMask(inspection) {
	$('at-mask-version').textContent = inspection.versionLabel;
	const mask = inspection.configMask;
	$('at-mask-not-v1').hidden = Boolean(mask);
	$('at-mask-bits-card').hidden = !mask;
	$('at-mask-table').hidden = !mask;
	$('at-mask-offsets').hidden = !mask;
	if (!mask) {
		$('at-mask-reserved-badge').hidden = true;
		showMask('report');
		return;
	}

	$('at-mask-hex').textContent = mask.maskHex;
	$('at-mask-binary').textContent = mask.maskBinary;
	$('at-mask-popcount').textContent = `${mask.popcount} of 5 known bits set.`;

	const reservedBadge = $('at-mask-reserved-badge');
	reservedBadge.hidden = !mask.reservedBitsSet;
	if (mask.reservedBitsSet) reservedBadge.textContent = `Reserved bits set (${mask.reservedBitsHex})`;

	$('at-mask-fields').replaceChildren(...mask.fields.map((field) => {
		const tr = document.createElement('tr');
		tr.className = field.invalidPartial ? 'at-field-invalid' : field.present ? 'at-field-present' : 'at-field-missing';
		const cells = [
			field.label,
			bitsLabel(field.bits),
			field.invalidPartial ? 'Partial (invalid)' : field.present ? 'Yes' : 'No',
			`${field.byteWidth} bytes`,
			field.rawHex || '-',
			field.value == null ? '<unset>' : formatNumber(field.value),
		];
		tr.append(...cells.map((text) => {
			const td = document.createElement('td');
			td.textContent = text;
			return td;
		}));
		return tr;
	}));

	$('at-mask-offsets').textContent =
		`Config values occupy bytes ${mask.configValuesByteOffset}-${mask.configValuesByteOffset + mask.configValuesByteLength - 1} ` +
		`of the message (${mask.numInstructions} instruction(s), ${mask.numAddresses} inline address(es)).`;
	showMask('report');
}

for (const tab of document.querySelectorAll('[data-mask-mode]')) tab.addEventListener('click', () => setMaskMode(tab.dataset.maskMode));
$('at-mask-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	const value = $('at-mask-input').value.trim();
	if (!value) {
		$('at-mask-error-message').textContent = maskState.mode === 'wire' ? 'Paste base64 wire bytes first.' : 'Paste a Solana transaction signature first.';
		showMask('error');
		return;
	}
	showMask('loading');
	$('at-mask-submit').disabled = true;
	try {
		renderMask(await fetchInspectionFor(maskState.mode, value));
	} catch (err) {
		$('at-mask-error-message').textContent = err.message;
		showMask('error');
	} finally {
		$('at-mask-submit').disabled = false;
	}
});
$('at-mask-retry').addEventListener('click', () => $('at-mask-form').requestSubmit());

// ---------------------------------------------------------------------------
// Sponsor cap view tab
// ---------------------------------------------------------------------------

const sponsorViewState = { mode: 'signature' };

function showSponsor(name) {
	for (const key of ['loading', 'error', 'report', 'empty']) $(`at-sponsor-${key}`).hidden = key !== name;
}

function setSponsorMode(mode) {
	sponsorViewState.mode = mode;
	for (const tab of document.querySelectorAll('[data-sponsor-mode]')) tab.setAttribute('aria-selected', String(tab.dataset.sponsorMode === mode));
	const wire = mode === 'wire';
	$('at-sponsor-input-label').textContent = wire ? 'Signed or partially signed transaction bytes' : 'Solana mainnet transaction signature';
	$('at-sponsor-input').placeholder = wire ? 'Paste a base64-encoded wire transaction' : 'Paste a transaction signature';
	$('at-sponsor-input').rows = wire ? 6 : 2;
}

function renderSponsorView(inspection) {
	$('at-sponsor-version').textContent = inspection.versionLabel;
	const budget = inspection.budget;
	$('at-sponsor-priority').textContent = budgetValue(budget.priorityFeeLamports, 'lamports total', budget.explicit.priorityFee);
	$('at-sponsor-cu').textContent = budgetValue(budget.computeUnitLimit, 'CU', budget.explicit.computeUnitLimit);
	$('at-sponsor-data').textContent = budgetValue(budget.loadedAccountsDataSizeLimit, 'bytes', budget.explicit.loadedAccountsDataSizeLimit);
	$('at-sponsor-heap').textContent = budgetValue(budget.heapSize, 'bytes', budget.explicit.heapSize);

	const badge = $('at-sponsor-verdict-badge');
	badge.className = 'at-verdict-badge';
	if (inspection.version === 1 && inspection.sponsor.safeToCosign) {
		badge.textContent = 'Caps explicit';
		badge.classList.add('is-safe');
		$('at-sponsor-verdict-copy').textContent = 'The 0x81 envelope is V1 and both execution limits are explicit in transactionConfig.';
	} else if (inspection.version === 1) {
		badge.textContent = 'Limits missing';
		badge.classList.add('is-warn');
		$('at-sponsor-verdict-copy').textContent = 'This is V1, but at least one required execution limit resolves to zero.';
	} else {
		badge.textContent = 'Legacy budget rules';
		$('at-sponsor-verdict-copy').textContent = `${inspection.versionLabel} keeps the 1,232-byte ceiling and instruction-based compute budget.`;
	}

	const dup = inspection.duplicateAccounts || [];
	$('at-sponsor-dup-summary').textContent = dup.length
		? `${dup.length} duplicate static account(s) found. This transaction would FAIL v1 sanitization.`
		: 'No duplicate static accounts. This transaction would pass the v1 sanitization check.';
	$('at-sponsor-dup-list').replaceChildren(...dup.map((address) => {
		const li = document.createElement('li');
		li.textContent = address;
		return li;
	}));

	$('at-sponsor-view-notes').replaceChildren(...inspection.sponsor.notes.map((note) => {
		const li = document.createElement('li');
		li.textContent = note;
		return li;
	}));
	showSponsor('report');
}

for (const tab of document.querySelectorAll('[data-sponsor-mode]')) tab.addEventListener('click', () => setSponsorMode(tab.dataset.sponsorMode));
$('at-sponsor-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	const value = $('at-sponsor-input').value.trim();
	if (!value) {
		$('at-sponsor-error-message').textContent = sponsorViewState.mode === 'wire' ? 'Paste base64 wire bytes first.' : 'Paste a Solana transaction signature first.';
		showSponsor('error');
		return;
	}
	showSponsor('loading');
	$('at-sponsor-submit').disabled = true;
	try {
		renderSponsorView(await fetchInspectionFor(sponsorViewState.mode, value));
	} catch (err) {
		$('at-sponsor-error-message').textContent = err.message;
		showSponsor('error');
	} finally {
		$('at-sponsor-submit').disabled = false;
	}
});
$('at-sponsor-retry').addEventListener('click', () => $('at-sponsor-form').requestSubmit());

// ---------------------------------------------------------------------------
// Planner and Diff tabs: compile a pasted instruction set with the same
// @solana/kit path the rest of three.ws uses, through /api/solana/atomic-plan.
// ---------------------------------------------------------------------------

const EXAMPLE_FEEPAYER = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const EXAMPLE_INSTRUCTIONS = JSON.stringify(
	[
		{
			programId: '11111111111111111111111111111111',
			keys: [
				{ pubkey: EXAMPLE_FEEPAYER, isSigner: true, isWritable: true },
				{ pubkey: 'So11111111111111111111111111111111111111112', isSigner: false, isWritable: true },
			],
			data: 'AgAAAIgTAAAAAAAA',
		},
	],
	null,
	2,
);

function loadExample(prefix) {
	$(`at-${prefix}-feepayer`).value = EXAMPLE_FEEPAYER;
	$(`at-${prefix}-instructions`).value = EXAMPLE_INSTRUCTIONS;
	$(`at-${prefix}-cu`).value = '200000';
	$(`at-${prefix}-data-size`).value = '4096';
	$(`at-${prefix}-priority`).value = '10';
}

function parseInstructionsJson(raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new Error(`Instructions must be valid JSON: ${err.message}`);
	}
	if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Instructions must be a non-empty JSON array.');
	return parsed;
}

function budgetConfigFrom(prefix) {
	const cu = $(`at-${prefix}-cu`).value.trim();
	const dataSize = $(`at-${prefix}-data-size`).value.trim();
	const heap = $(`at-${prefix}-heap`).value.trim();
	const priority = $(`at-${prefix}-priority`).value.trim();
	const config = {};
	if (cu !== '') config.computeUnitLimit = Number(cu);
	if (dataSize !== '') config.loadedAccountsDataSizeLimit = Number(dataSize);
	if (heap !== '') config.heapSize = Number(heap);
	if (priority !== '') config.priorityFeeMicroLamportsPerCu = Number(priority);
	return config;
}

function duplicateAccountsSummary(duplicateAccounts) {
	const dup = duplicateAccounts || [];
	return dup.length
		? `${dup.length} duplicate static account(s) found. This transaction would FAIL v1 sanitization.`
		: 'No duplicate static accounts. This transaction would pass the v1 sanitization check.';
}

function duplicateAccountsList(duplicateAccounts) {
	return (duplicateAccounts || []).map((address) => {
		const li = document.createElement('li');
		li.textContent = address;
		return li;
	});
}

function showPlan(name) {
	for (const key of ['loading', 'error', 'report', 'empty']) $(`at-plan-${key}`).hidden = key !== name;
}

function renderPlan(plan) {
	$('at-plan-version-label').textContent = plan.versionLabel;
	$('at-plan-bytes').textContent = formatNumber(plan.bytes);
	$('at-plan-headroom').textContent = plan.overLimitBy > 0 ? `${formatNumber(plan.overLimitBy)} bytes over` : `${formatNumber(plan.headroomBytes)} bytes free`;
	const utilizationPct = Math.round((plan.bytes / plan.limitBytes) * 1_000) / 10;
	$('at-plan-size-fill').style.width = `${Math.min(100, utilizationPct)}%`;
	$('at-plan-size-note').textContent = plan.overLimitBy > 0
		? `This plan is ${formatNumber(plan.overLimitBy)} bytes beyond the ${formatNumber(plan.limitBytes)}-byte ${plan.versionLabel} envelope. It would not fit.`
		: `${utilizationPct}% of the ${formatNumber(plan.limitBytes)}-byte ${plan.versionLabel} envelope is in use.`;

	$('at-plan-accounts').textContent = formatNumber(plan.staticAccountCount);
	$('at-plan-instructions-count').textContent = formatNumber(plan.instructionCount);
	$('at-plan-signers').textContent = formatNumber(plan.signerCount);
	$('at-plan-message-bytes').textContent = formatNumber(plan.messageBytes);

	const rb = plan.resourceBudget;
	$('at-plan-cu-out').textContent = `${formatNumber(rb.computeUnitLimit)} CU`;
	$('at-plan-data-out').textContent = `${formatNumber(rb.loadedAccountsDataSizeLimit)} bytes`;
	$('at-plan-data-headroom').textContent = `${formatNumber(rb.loadedAccountsHeadroomBytes)} bytes`;
	$('at-plan-priority-out').textContent = `${formatNumber(rb.priorityFeeLamports)} lamports total`;

	$('at-plan-dup-summary').textContent = duplicateAccountsSummary(plan.duplicateAccounts);
	$('at-plan-dup-list').replaceChildren(...duplicateAccountsList(plan.duplicateAccounts));
	showPlan('report');
}

$('at-plan-example').addEventListener('click', () => loadExample('plan'));
$('at-plan-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	showPlan('loading');
	$('at-plan-submit').disabled = true;
	try {
		const feePayer = $('at-plan-feepayer').value.trim();
		if (!feePayer) throw new Error('Fee payer address is required.');
		const instructions = parseInstructionsJson($('at-plan-instructions').value.trim() || '[]');
		const versionField = $('at-plan-version').value;
		const version = versionField === 'legacy' ? 'legacy' : Number(versionField);
		const budgetConfig = budgetConfigFrom('plan');
		const { plan } = await fetch('/api/solana/atomic-plan', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ feePayer, version, budgetConfig, instructions }),
		}).then(responseJson);
		renderPlan(plan);
	} catch (err) {
		$('at-plan-error-message').textContent = err.message;
		showPlan('error');
	} finally {
		$('at-plan-submit').disabled = false;
	}
});
$('at-plan-retry').addEventListener('click', () => $('at-plan-form').requestSubmit());

function showDiff(name) {
	for (const key of ['loading', 'error', 'report', 'empty']) $(`at-diff-${key}`).hidden = key !== name;
}

function renderDiff(diff) {
	for (const key of ['legacy', 'v0', 'v1']) {
		const part = diff[key];
		$(`at-diff-${key}-bytes`).textContent = `${formatNumber(part.bytes)} bytes`;
		$(`at-diff-${key}-limit`).textContent = `${formatNumber(part.limitBytes)} bytes`;
		$(`at-diff-${key}-headroom`).textContent = part.overLimitBy > 0 ? `${formatNumber(part.overLimitBy)} bytes over` : `${formatNumber(part.headroomBytes)} bytes free`;
		const fits = key === 'v1' ? part.fitsV1 : part.fitsLegacy;
		const fitsCell = $(`at-diff-${key}-fits`);
		fitsCell.textContent = fits ? 'Fits' : 'Does not fit';
		fitsCell.classList.toggle('at-fits-no', !fits);
	}

	const notes = [];
	if (diff.bytesSavedVsLegacy > 0) notes.push(`V1 saves ${formatNumber(diff.bytesSavedVsLegacy)} bytes versus legacy.`);
	else if (diff.bytesSavedVsLegacy < 0) notes.push(`V1 costs ${formatNumber(-diff.bytesSavedVsLegacy)} more bytes than legacy for this payload.`);
	else notes.push('V1 is byte-identical to legacy for this payload.');
	if (diff.bytesSavedVsV0 > 0) notes.push(`It saves ${formatNumber(diff.bytesSavedVsV0)} bytes versus V0.`);
	else if (diff.bytesSavedVsV0 < 0) notes.push(`It costs ${formatNumber(-diff.bytesSavedVsV0)} more bytes than V0.`);
	else notes.push('It is byte-identical to V0.');
	$('at-diff-savings').textContent = notes.join(' ');
	showDiff('report');
}

$('at-diff-example').addEventListener('click', () => loadExample('diff'));
$('at-diff-form').addEventListener('submit', async (event) => {
	event.preventDefault();
	showDiff('loading');
	$('at-diff-submit').disabled = true;
	try {
		const feePayer = $('at-diff-feepayer').value.trim();
		if (!feePayer) throw new Error('Fee payer address is required.');
		const instructions = parseInstructionsJson($('at-diff-instructions').value.trim() || '[]');
		const budgetConfig = budgetConfigFrom('diff');
		const { diff } = await fetch('/api/solana/atomic-plan', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ feePayer, diff: true, budgetConfig, instructions }),
		}).then(responseJson);
		renderDiff(diff);
	} catch (err) {
		$('at-diff-error-message').textContent = err.message;
		showDiff('error');
	} finally {
		$('at-diff-submit').disabled = false;
	}
});
$('at-diff-retry').addEventListener('click', () => $('at-diff-form').requestSubmit());

// ---------------------------------------------------------------------------
// Wallet V1 capability check tab: client-only, never signs or sends anything.
// The pass/fail verdict comes exclusively from the existing
// findV1WalletStandardSigner helper also used by the real signing paths
// (src/launch/launch-wallet.js, src/onchain/adapters/solana.js).
// ---------------------------------------------------------------------------

function showWallet(name) {
	for (const key of ['loading', 'error', 'report', 'empty']) $(`at-wallet-${key}`).hidden = key !== name;
}

function renderWallet({ name, address, supportsV1, versions }) {
	$('at-wallet-name').textContent = name;
	$('at-wallet-address').textContent = shortKey(address);

	const badge = $('at-wallet-verdict-badge');
	badge.className = 'at-verdict-badge';
	if (supportsV1) {
		badge.textContent = 'V1 capable';
		badge.classList.add('is-safe');
		$('at-wallet-verdict-copy').textContent =
			"wallet.features['solana:signTransaction'].supportedTransactionVersions includes 1, found via findV1WalletStandardSigner.";
	} else {
		badge.textContent = 'V1 not advertised';
		badge.classList.add('is-warn');
		$('at-wallet-verdict-copy').textContent = versions?.length
			? `This wallet's own Wallet Standard feature set advertises versions [${versions.join(', ')}], which does not include 1.`
			: 'This wallet is not registered with the Wallet Standard, or does not expose a solana:signTransaction feature three.ws can read a version list from.';
	}

	const items = (versions || []).map((v) => {
		const li = document.createElement('li');
		li.textContent = v === 1 ? 'Version 1 (SIMD-0385, 4,096-byte envelope)' : v === 0 ? 'Version 0 (address lookup tables)' : `Version ${v}`;
		return li;
	});
	if (!items.length) {
		const li = document.createElement('li');
		li.textContent = 'No explicit version list available from this wallet.';
		items.push(li);
	}
	$('at-wallet-versions').replaceChildren(...items);
	showWallet('report');
}

async function checkWallet() {
	showWallet('loading');
	$('at-wallet-check-btn').disabled = true;
	try {
		const provider = injectedProvider();
		if (!provider?.connect) {
			throw new Error('No Solana wallet extension detected. Install a Wallet Standard wallet (Phantom, Backpack, Solflare) and reload.');
		}
		const resp = await provider.connect();
		const address = (resp?.publicKey || provider.publicKey)?.toString();
		if (!address) throw new Error('Wallet connected but returned no address.');

		let signer = findV1WalletStandardSigner(getWallets().get(), address);
		if (!signer) {
			// A silent standard:connect on already-approved wallets fills in the
			// Wallet Standard account list without a second prompt; mirrors the
			// retry loop in src/launch/launch-wallet.js's v1SignerFor.
			for (const wallet of getWallets().get()) {
				const connect = wallet?.features?.['standard:connect']?.connect;
				if (!connect) continue;
				try {
					await connect({ silent: true });
				} catch {
					continue;
				}
				signer = findV1WalletStandardSigner(getWallets().get(), address);
				if (signer) break;
			}
		}

		let versions = signer ? signer.feature.supportedTransactionVersions : null;
		if (!versions) {
			const registered = getWallets().get().find((wallet) => wallet.accounts?.some((a) => a.address === address));
			versions = registered?.features?.['solana:signTransaction']?.supportedTransactionVersions || null;
		}

		const name = provider.isPhantom ? 'Phantom' : provider.isBackpack ? 'Backpack' : provider.isSolflare ? 'Solflare' : provider.isThreeWs ? 'three.ws wallet' : 'Wallet';
		renderWallet({ name, address, supportsV1: Boolean(signer), versions });
	} catch (err) {
		$('at-wallet-error-message').textContent = err.message;
		showWallet('error');
	} finally {
		$('at-wallet-check-btn').disabled = false;
	}
}

$('at-wallet-check-btn').addEventListener('click', checkWallet);
$('at-wallet-retry').addEventListener('click', checkWallet);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

loadStatus();
showMask('empty');
showSponsor('empty');
showPlan('empty');
showDiff('empty');
showWallet('empty');

const initialTab = new URLSearchParams(location.search).get('tab');
switchTab(TAB_KEYS.includes(initialTab) ? initialTab : 'inspector');

const initialSignature = new URLSearchParams(location.search).get('signature');
if (initialSignature) {
	$('at-input').value = initialSignature;
	inspect();
} else {
	show('empty');
}
