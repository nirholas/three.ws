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
	if (!response.ok) throw new Error(data.message || data.error || `Request failed with HTTP ${response.status}`);
	return data;
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
		const request = state.mode === 'wire'
			? fetch('/api/solana/atomic', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ transaction: value }),
			})
			: fetch(`/api/solana/atomic?signature=${encodeURIComponent(value)}`, { headers: { accept: 'application/json' } });
		const { inspection } = await request.then(responseJson);
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

loadStatus();
const initialSignature = new URLSearchParams(location.search).get('signature');
if (initialSignature) {
	$('at-input').value = initialSignature;
	inspect();
} else {
	show('empty');
}
