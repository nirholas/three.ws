// /launch/paired: an owner has one of their agents launch a paired coin on
// Robinhood Chain from the agent's own EVM wallet.
//
// Data flow: GET /api/agents lists the owner's agents and GET
// /api/v1/robinhood/paired-markets lists what a coin can pair with. Every form
// change is debounced into POST /api/agents/:id/paired/quote, which validates
// the coin, prices every pool and the launch, checks the agent wallet and its
// spend policy, and names anything blocking. Launch confirms the quoted cost
// in a dialog, then POSTs the identical body to /paired/launch, which signs
// with the agent's custodial key. Every number on screen came from a quote.

import { ensureRiskAck } from '../shared/risk-ack.js';
import { mountLanePicker } from '../launch/lane-picker.js';
import { CLASS_LABELS, amount, classChip, esc, explainLoad, getJson, short, usd } from './common.js';

const $ = (s, r = document) => r.querySelector(s);
const MAX_MARKETS = 5;

const state = {
	user: undefined,
	agents: null,
	agentsError: '',
	markets: null,
	marketsError: '',
	klass: 'all',
	search: '',
	form: {
		agentId: '',
		name: '',
		symbol: '',
		symbolTouched: false,
		description: '',
		image: '',
		website: '',
		twitter: '',
		telegram: '',
		picked: [],
		buyMarket: '',
		buyAmount: '',
	},
	quote: null,
	quoteError: '',
	quoting: false,
	quoteSeq: 0,
	launching: false,
	launched: null,
	attempt: null,
};

const suggestSymbol = (name) => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
const selectedAgent = () => state.agents?.find((a) => a.id === state.form.agentId) || null;
const marketBySymbol = (sym) => state.markets?.find((m) => m.symbol === sym) || null;

function evenSplit() {
	const n = state.form.picked.length;
	if (!n) return;
	const base = Math.floor(10000 / n);
	let rem = 10000 - base * n;
	state.form.picked.forEach((p) => {
		p.bps = base + (rem-- > 0 ? 1 : 0);
	});
}

const totalBps = () => state.form.picked.reduce((s, p) => s + p.bps, 0);

/** The body /quote and /launch both take, built only from the form. */
function requestBody() {
	const f = state.form;
	const body = {
		name: f.name.trim(),
		symbol: f.symbol.trim(),
		markets: f.picked.map((p) => p.symbol),
		weights: f.picked.map((p) => p.bps / 100),
	};
	if (f.description.trim()) body.description = f.description.trim();
	if (f.image.trim()) body.image_url = f.image.trim();
	const socials = {};
	if (f.website.trim()) socials.website = f.website.trim();
	if (f.twitter.trim()) socials.twitter = f.twitter.trim();
	if (f.telegram.trim()) socials.telegram = f.telegram.trim();
	if (Object.keys(socials).length) body.socials = socials;
	if (Number(f.buyAmount) > 0 && f.picked.some((p) => p.symbol === f.buyMarket)) {
		body.dev_buy = { market: f.buyMarket, amount: f.buyAmount.trim() };
	}
	return body;
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
	const params = new URL(location.href).searchParams;
	state.form.name = (params.get('name') || '').slice(0, 32);
	if (params.get('symbol')) {
		state.form.symbol = suggestSymbol(params.get('symbol'));
		state.form.symbolTouched = true;
	} else state.form.symbol = suggestSymbol(state.form.name);
	const wantedMarkets = (params.get('markets') || '').split(',').map((s) => s.trim().replace(/^\$/, '').toUpperCase()).filter(Boolean);
	render();

	const [me, markets] = await Promise.allSettled([
		fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
		getJson('/api/v1/robinhood/paired-markets'),
	]);
	if (markets.status === 'fulfilled') {
		state.markets = markets.value.markets;
		for (const sym of wantedMarkets.slice(0, MAX_MARKETS)) {
			const m = state.markets.find((x) => x.symbol.toUpperCase() === sym);
			if (m && !state.form.picked.some((p) => p.symbol === m.symbol)) state.form.picked.push({ symbol: m.symbol, bps: 0 });
		}
		evenSplit();
	} else state.marketsError = explainLoad(markets.reason);

	state.user = me.status === 'fulfilled' ? me.value?.user || null : null;
	if (state.user) {
		try {
			const { agents = [] } = await getJson('/api/agents');
			state.agents = agents;
			const wanted = params.get('agent');
			state.form.agentId = (agents.find((a) => a.id === wanted) || agents[0])?.id || '';
		} catch (err) {
			state.agentsError = explainLoad(err);
			state.agents = [];
		}
	} else state.agents = [];
	render();
	scheduleQuote(0);
}

// ── Rendering ──────────────────────────────────────────────────────────────

function emptyCard(title, text, action) {
	return `<section class="pc-empty"><h2>${esc(title)}</h2><p>${text}</p><div>${action}</div></section>`;
}

function render() {
	const root = $('#pl-app');
	if (state.agents === null) {
		root.innerHTML = `<div class="pc-launch"><div class="cv-skel" style="height:620px;border-radius:14px"></div><div class="cv-skel" style="height:380px;border-radius:14px"></div></div>`;
		return;
	}
	if (state.agentsError) {
		root.innerHTML = emptyCard('Could not load your agents', esc(state.agentsError), '<button type="button" class="pc-btn" id="pl-retry">Try again</button>');
		$('#pl-retry').addEventListener('click', () => location.reload());
		return;
	}
	if (!state.user) {
		const next = encodeURIComponent(location.pathname + location.search);
		root.innerHTML = emptyCard(
			'Sign in to launch',
			'Your agent signs the launch with its own wallet, so you need to be signed in as its owner. Browse <a href="/markets/robinhood/paired">paired coins</a> in the meantime.',
			`<a class="pc-btn pc-btn-primary" href="/login?next=${next}">Sign in</a>`,
		) + botsCard();
		return;
	}
	if (!state.agents.length) {
		root.innerHTML = emptyCard(
			'Create an agent first',
			'Paired coins launch from an agent\'s own wallet. Create a 3D agent and it gets a wallet that works on Robinhood Chain.',
			'<a class="pc-btn pc-btn-primary" href="/create">Create an agent</a>',
		) + botsCard();
		return;
	}
	if (state.launched) {
		root.innerHTML = successCard(state.launched) + botsCard();
		$('#pl-again').addEventListener('click', () => {
			state.launched = null;
			Object.assign(state.form, { name: '', symbol: '', symbolTouched: false, description: '', buyAmount: '' });
			render();
			scheduleQuote(0);
		});
		return;
	}
	root.innerHTML = `<div class="pc-launch">${formCard()}<aside id="pl-side">${summaryCard()}</aside></div>${botsCard()}`;
	wireForm();
	paintPicker();
	paintAlloc();
	wireSummary();
}

function formCard() {
	const f = state.form;
	const agent = selectedAgent();
	const options = state.agents.map((a) => `<option value="${esc(a.id)}" ${a.id === f.agentId ? 'selected' : ''}>${esc(a.name || 'Agent')}</option>`).join('');
	const logoHint = agent?.avatar_thumbnail_url ? "Leave empty to use your agent's avatar." : "An https:// image. Your agent's avatar is private, so add one here.";
	return `
	<form class="pc-panel" id="pl-form" novalidate>
		<label class="pc-field"><span>Agent</span>
			<select class="pc-input" id="f-agent">${options}</select>
		</label>
		<div class="pc-row">
			<label class="pc-field"><span>Coin name</span>
				<input class="pc-input" id="f-name" maxlength="32" autocomplete="off" placeholder="${esc(agent?.name || 'My agent coin')}" value="${esc(f.name)}" required />
			</label>
			<label class="pc-field pc-ticker"><span>Ticker</span>
				<input class="pc-input mono" id="f-symbol" maxlength="10" autocomplete="off" placeholder="TICKER" value="${esc(f.symbol)}" required />
			</label>
		</div>

		<div class="pc-picker">
			<div class="pc-field" style="gap:0.2rem"><span>Pair with <em>up to ${MAX_MARKETS}</em></span><small>Each market gets its own bonding curve. Your agent does not need to hold any of them.</small></div>
			<div class="pc-picker-search">
				<div class="pc-tabs" id="pl-classes" role="tablist" aria-label="Asset class"></div>
				<input class="pc-input" id="pl-search" type="search" placeholder="Search" aria-label="Search markets" style="flex:1;min-width:120px" />
			</div>
			<div class="pc-chips" id="pl-chips" role="group" aria-label="Markets"></div>
		</div>

		<div class="pc-alloc" id="pl-alloc" aria-live="polite"></div>

		<label class="pc-field"><span>Description <em>optional</em></span>
			<textarea class="pc-input" id="f-description" maxlength="480" rows="3" placeholder="What is this coin about?">${esc(f.description)}</textarea>
		</label>
		<label class="pc-field"><span>Logo URL <em>optional</em></span>
			<input class="pc-input" id="f-image" type="url" inputmode="url" maxlength="512" placeholder="https://" value="${esc(f.image)}" />
			<small>${esc(logoHint)} It is copied onto three.ws so it can never change.</small>
		</label>
		<fieldset class="pc-field" style="border:0;padding:0;margin:0"><legend style="padding:0;margin-bottom:0.35rem">Links <em>optional</em></legend>
			<div class="pc-row">
				<input class="pc-input" id="f-website" type="url" inputmode="url" maxlength="200" placeholder="https://your-site" aria-label="Website" value="${esc(f.website)}" />
				<input class="pc-input" id="f-twitter" type="url" inputmode="url" maxlength="200" placeholder="https://x.com/…" aria-label="X link" value="${esc(f.twitter)}" />
				<input class="pc-input" id="f-telegram" type="url" inputmode="url" maxlength="200" placeholder="https://t.me/…" aria-label="Telegram link" value="${esc(f.telegram)}" />
			</div>
		</fieldset>
		<div class="pc-row" id="pl-buy"></div>
	</form>`;
}

function paintPicker() {
	const tabs = $('#pl-classes');
	const chips = $('#pl-chips');
	if (!tabs) return;
	if (state.marketsError) {
		chips.innerHTML = `<p class="pc-status is-error" role="alert">${esc(state.marketsError)} <button type="button" class="pc-btn" id="pl-mretry" style="min-height:28px">Retry</button></p>`;
		$('#pl-mretry').addEventListener('click', async () => {
			state.marketsError = '';
			try {
				state.markets = (await getJson('/api/v1/robinhood/paired-markets')).markets;
			} catch (err) {
				state.marketsError = explainLoad(err);
			}
			paintPicker();
		});
		return;
	}
	if (!state.markets) {
		chips.innerHTML = '<div class="cv-skel" style="height:72px;width:100%;border-radius:10px"></div>';
		return;
	}
	const classes = ['all', ...new Set(state.markets.map((m) => m.assetClass))];
	tabs.innerHTML = classes
		.map((k) => `<button type="button" class="pc-tab" role="tab" data-class="${esc(k)}" aria-selected="${k === state.klass}">${esc(k === 'all' ? 'All' : CLASS_LABELS[k] || k)}</button>`)
		.join('');
	const q = state.search.trim().toLowerCase();
	const full = state.form.picked.length >= MAX_MARKETS;
	const list = state.markets.filter((m) => (state.klass === 'all' || m.assetClass === state.klass) && (!q || m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)));
	chips.innerHTML = list.length
		? list
			.map((m) => {
				const on = state.form.picked.some((p) => p.symbol === m.symbol);
				return `<button type="button" class="pc-chip" data-symbol="${esc(m.symbol)}" aria-pressed="${on}" ${!on && full ? 'disabled' : ''} title="${esc(m.name)}: opens at ${esc(usd(m.openingValueUsd))}">${esc(m.symbol)}<small>${esc(CLASS_LABELS[m.assetClass] || '')}</small></button>`;
			})
			.join('')
		: `<p class="pc-fine">No market matches "${esc(state.search)}".</p>`;
}

function paintAlloc() {
	const host = $('#pl-alloc');
	if (!host) return;
	const f = state.form;
	if (!f.picked.length) {
		host.innerHTML = '<p class="pc-fine">Pick at least one market above. A coin paired with several splits its one billion supply across them.</p>';
		paintBuy();
		return;
	}
	const total = totalBps();
	host.innerHTML = `${f.picked
		.map((p, i) => {
			const m = marketBySymbol(p.symbol);
			return `<div class="pc-alloc-row">
				<span><strong>${esc(p.symbol)}</strong><br />${m ? classChip(m.assetClass) : ''}</span>
				<input type="range" min="1" max="100" step="1" value="${Math.round(p.bps / 100)}" data-i="${i}" aria-label="${esc(p.symbol)} share of supply" />
				<div class="pc-unit"><input class="pc-input mono" data-pct="${i}" inputmode="decimal" value="${esc(+(p.bps / 100).toFixed(2))}" aria-label="${esc(p.symbol)} percent" /><span>%</span></div>
				<button type="button" class="pc-x" data-remove="${i}" aria-label="Remove ${esc(p.symbol)}">×</button>
			</div>`;
		})
		.join('')}
		<div class="pc-alloc-total ${total === 10000 ? '' : 'is-bad'}"><span>Total <strong>${esc(+(total / 100).toFixed(2))}%</strong>${total === 10000 ? '' : ' (must be exactly 100%)'}</span>${f.picked.length > 1 ? '<button type="button" class="pc-btn" id="pl-even" style="min-height:28px">Even split</button>' : ''}</div>`;

	host.querySelectorAll('input[type="range"]').forEach((r) =>
		r.addEventListener('input', () => {
			f.picked[Number(r.dataset.i)].bps = Number(r.value) * 100;
			host.querySelector(`[data-pct="${r.dataset.i}"]`).value = r.value;
			paintTotal();
			scheduleQuote();
		}),
	);
	host.querySelectorAll('[data-pct]').forEach((input) =>
		input.addEventListener('input', () => {
			const v = Math.max(0, Math.min(100, Number(input.value) || 0));
			f.picked[Number(input.dataset.pct)].bps = Math.round(v * 100);
			host.querySelector(`input[type="range"][data-i="${input.dataset.pct}"]`).value = String(Math.round(v));
			paintTotal();
			scheduleQuote();
		}),
	);
	host.querySelectorAll('[data-remove]').forEach((b) =>
		b.addEventListener('click', () => {
			f.picked.splice(Number(b.dataset.remove), 1);
			evenSplit();
			paintPicker();
			paintAlloc();
			scheduleQuote();
		}),
	);
	$('#pl-even')?.addEventListener('click', () => {
		evenSplit();
		paintAlloc();
		scheduleQuote();
	});
	paintBuy();
}

function paintTotal() {
	const el = $('.pc-alloc-total');
	if (!el) return;
	const total = totalBps();
	el.classList.toggle('is-bad', total !== 10000);
	el.querySelector('span').innerHTML = `Total <strong>${esc(+(total / 100).toFixed(2))}%</strong>${total === 10000 ? '' : ' (must be exactly 100%)'}`;
}

function paintBuy() {
	const host = $('#pl-buy');
	if (!host) return;
	const f = state.form;
	if (!f.picked.length) {
		host.innerHTML = '';
		return;
	}
	if (!f.picked.some((p) => p.symbol === f.buyMarket)) f.buyMarket = f.picked[0].symbol;
	host.innerHTML = `
		<label class="pc-field"><span>Opening buy <em>optional</em></span>
			<div class="pc-unit"><input class="pc-input mono" id="f-buy" inputmode="decimal" autocomplete="off" placeholder="0.0" value="${esc(f.buyAmount)}" /><span>${esc(f.buyMarket)}</span></div>
			<small>Bought in the launch transaction itself, so nobody trades the curve first. Spends the agent's ${esc(f.buyMarket)}.</small>
		</label>
		<label class="pc-field pc-ticker"><span>Buy with</span>
			<select class="pc-input" id="f-buy-market">${f.picked.map((p) => `<option ${p.symbol === f.buyMarket ? 'selected' : ''}>${esc(p.symbol)}</option>`).join('')}</select>
		</label>`;
	$('#f-buy').addEventListener('input', (e) => {
		const clean = e.target.value.replace(/[^0-9.]/g, '');
		if (clean !== e.target.value) e.target.value = clean;
		f.buyAmount = clean;
		scheduleQuote();
	});
	$('#f-buy-market').addEventListener('change', (e) => {
		f.buyMarket = e.target.value;
		paintBuy();
		scheduleQuote();
	});
}

function summaryCard() {
	const q = state.quote;
	const f = state.form;
	if (state.quoteError) {
		return `<section class="pc-panel"><h2 class="cv-h2">Cost</h2><p class="pc-status is-error" role="alert">${esc(state.quoteError)}</p>
			<button type="button" class="pc-btn" id="pl-requote">Try again</button></section>`;
	}
	if (!q) {
		const need = !f.name.trim() || !f.symbol.trim() ? 'Name the coin and pick a ticker' : !f.picked.length ? 'Pick at least one market' : totalBps() !== 10000 ? 'Make the shares total 100%' : '';
		return `<section class="pc-panel"><h2 class="cv-h2">Cost</h2>
			${state.quoting ? '<div class="cv-skel" style="height:1.1rem"></div><div class="cv-skel" style="height:1.1rem"></div><div class="cv-skel" style="height:1.1rem"></div>' : `<p class="pc-fine">${esc(need || 'Pricing…')} to see the live cost.</p>`}
			<button type="button" class="pc-btn pc-btn-primary" disabled>Launch paired coin</button></section>`;
	}
	const opening = q.pairs.every((p) => p.opening_value_usd != null) ? q.pairs.reduce((s, p) => s + p.opening_value_usd, 0) : null;
	const blockers = q.blockers.length ? `<ul class="pc-blockers" role="alert">${q.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
	return `
	<section class="pc-panel" ${state.quoting ? 'style="opacity:0.7"' : ''}>
		<h2 class="cv-h2">$${esc(q.coin.symbol)} pools</h2>
		<dl class="pc-out">${q.pairs
			.map((p) => `<dt>${esc(p.symbol)} · ${esc(p.weight_pct)}%</dt><dd>${p.opening_value_usd != null ? `opens ${esc(usd(p.opening_value_usd))}` : 'unpriced'}</dd>`)
			.join('')}${opening != null ? `<dt><strong>Opening market cap</strong></dt><dd><strong>${esc(usd(opening))}</strong></dd>` : ''}</dl>
		<h2 class="cv-h2">Cost</h2>
		<dl class="pc-out">
			<dt>Launch fee</dt><dd>${esc(q.cost.launch_fee_eth)} ETH</dd>
			<dt>${q.cost.gas_estimated ? 'Network gas' : 'Network gas (typical)'}</dt><dd>${esc(amount(q.cost.gas_eth))} ETH</dd>
			${q.opening_buy ? `<dt>Opening buy</dt><dd>${esc(q.opening_buy.amount)} ${esc(q.opening_buy.market)}</dd>` : ''}
			<dt><strong>Total ETH</strong></dt><dd><strong>${esc(amount(q.cost.total_eth))} ETH</strong></dd>
			${q.cost.total_usd != null ? `<dt>All in</dt><dd>≈ ${esc(usd(q.cost.total_usd, { compact: false }))}</dd>` : ''}
		</dl>
		${q.opening_buy ? `<p class="pc-fine" style="color:var(--cv-text-2)">Your agent receives <strong>${esc(amount(q.opening_buy.tokens, 0))} $${esc(q.coin.symbol)}</strong>, ${esc(q.opening_buy.pct_of_supply)}% of supply.</p>` : ''}
		<div class="pc-field" style="gap:0.3rem">
			<span>${esc(q.agent.name || 'Agent')} wallet on Robinhood Chain</span>
			<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
				<code title="${esc(q.wallet.address)}">${esc(short(q.wallet.address))}</code>
				<button type="button" class="pc-btn" id="pl-copy" data-copy="${esc(q.wallet.address)}" style="min-height:28px" aria-label="Copy wallet address">Copy</button>
				<span class="cv-mono" style="margin-left:auto">${esc(amount(q.wallet.balance_eth))} ETH</span>
			</div>
		</div>
		${blockers}
		<button type="button" class="pc-btn pc-btn-primary" id="pl-launch" ${q.ready && !state.quoting ? '' : 'disabled'}>Launch paired coin</button>
		<p class="pc-fine">Swap fee ${esc(q.terms.swap_fee_bps / 100)}% per trade, ${esc(q.terms.creator_share_bps / 100)}% of it paid to your agent in each pool's asset. Liquidity is locked forever and there is no migration.</p>
	</section>`;
}

function successCard(r) {
	return `
	<section class="pc-panel" style="max-width:720px">
		<p class="cv-sub" style="margin:0">Live on Robinhood Chain</p>
		<h2 class="cv-h2" style="font-size:1.5rem">$${esc(r.symbol)} is trading</h2>
		<p style="margin:0;color:var(--cv-text-2)">${esc(r.name)} launched from your agent's wallet in block ${esc(r.block.toLocaleString('en-US'))}, paired with ${esc(r.pairs.map((p) => `${p.symbol} ${p.weight_pct}%`).join(', '))}.${r.opening_buy ? ` The opening buy of ${esc(r.opening_buy.amount)} ${esc(r.opening_buy.market)} bought ${esc(amount(r.opening_buy.tokens, 0))} $${esc(r.symbol)}.` : ''}</p>
		<code>${esc(r.token)}</code>
		<div class="pc-hero-actions">
			<a class="pc-btn pc-btn-primary" href="${esc(r.urls.coin)}">Open the coin page</a>
			<a class="pc-btn" href="${esc(r.urls.explorer)}" target="_blank" rel="noopener noreferrer">Transaction ↗</a>
			<button type="button" class="pc-btn" id="pl-again">Launch another</button>
		</div>
	</section>`;
}

function botsCard() {
	const id = state.form.agentId || '<agent-id>';
	return `
	<section class="pc-panel" style="margin-top:1.25rem">
		<h2 class="cv-h2">Let your agent and your bots launch</h2>
		<p class="pc-fine" style="font-size:0.875rem;color:var(--cv-text-2)">The same launch is one API call, so a bot can quote, check with you, then launch. Use an API key with spend permission, give your agent the <code>paired-launch</code> skill, or connect the three.ws MCP server and call <code>paired_launch_quote</code> then <code>paired_launch</code>.</p>
		<pre class="pc-code"><code>curl -X POST https://three.ws/api/agents/${esc(id)}/paired/quote \\
  -H "authorization: Bearer $THREEWS_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"name":"Chip Stack","symbol":"CHIPS","markets":["NVDA","WETH","USDG"],"weights":[50,30,20]}'

# The same body to /paired/launch sends it.</code></pre>
		<a href="/docs/paired-coins">Read the paired coins guide →</a>
	</section>`;
}

// ── Wiring + live quote ────────────────────────────────────────────────────

function wireForm() {
	const f = state.form;
	const bind = (sel, key, after) => {
		const input = $(sel);
		input.addEventListener('input', () => {
			f[key] = input.value;
			after?.(input);
			scheduleQuote();
		});
	};
	$('#f-agent').addEventListener('change', (e) => {
		f.agentId = e.target.value;
		state.quote = null;
		render();
		scheduleQuote(0);
	});
	bind('#f-name', 'name', () => {
		if (!f.symbolTouched) {
			f.symbol = suggestSymbol(f.name);
			$('#f-symbol').value = f.symbol;
		}
	});
	bind('#f-symbol', 'symbol', (input) => {
		f.symbolTouched = true;
		const clean = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
		if (clean !== input.value) input.value = clean;
		f.symbol = clean;
	});
	bind('#f-description', 'description');
	bind('#f-image', 'image');
	bind('#f-website', 'website');
	bind('#f-twitter', 'twitter');
	bind('#f-telegram', 'telegram');
	$('#pl-classes').addEventListener('click', (e) => {
		const tab = e.target.closest('[data-class]');
		if (!tab) return;
		state.klass = tab.dataset.class;
		paintPicker();
	});
	let t;
	$('#pl-search').addEventListener('input', (e) => {
		clearTimeout(t);
		t = setTimeout(() => {
			state.search = e.target.value;
			paintPicker();
		}, 120);
	});
	$('#pl-chips').addEventListener('click', (e) => {
		const chip = e.target.closest('[data-symbol]');
		if (!chip || chip.disabled) return;
		const sym = chip.dataset.symbol;
		const i = f.picked.findIndex((p) => p.symbol === sym);
		if (i >= 0) f.picked.splice(i, 1);
		else if (f.picked.length < MAX_MARKETS) f.picked.push({ symbol: sym, bps: 0 });
		evenSplit();
		paintPicker();
		paintAlloc();
		scheduleQuote();
	});
	$('#pl-form').addEventListener('submit', (e) => e.preventDefault());
}

function wireSummary() {
	$('#pl-requote')?.addEventListener('click', () => scheduleQuote(0));
	$('#pl-launch')?.addEventListener('click', confirmLaunch);
	const copy = $('#pl-copy');
	copy?.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(copy.dataset.copy);
			copy.textContent = 'Copied';
		} catch {
			copy.textContent = 'Select and copy';
		}
	});
}

function paintSummary() {
	const side = $('#pl-side');
	if (!side) return;
	side.innerHTML = summaryCard();
	wireSummary();
}

let quoteTimer = null;
function scheduleQuote(delay = 450) {
	clearTimeout(quoteTimer);
	quoteTimer = setTimeout(runQuote, delay);
}

async function runQuote() {
	const body = requestBody();
	if (!state.form.agentId || !body.name || !body.symbol || !body.markets.length || totalBps() !== 10000) {
		state.quote = null;
		state.quoteError = '';
		paintSummary();
		return;
	}
	const seq = ++state.quoteSeq;
	state.quoting = true;
	state.quoteError = '';
	paintSummary();
	try {
		const data = await getJson(`/api/agents/${encodeURIComponent(state.form.agentId)}/paired/quote`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(body),
		});
		if (seq !== state.quoteSeq) return;
		state.quote = data;
	} catch (err) {
		if (seq !== state.quoteSeq) return;
		state.quote = null;
		state.quoteError = explainLoad(err);
	} finally {
		if (seq === state.quoteSeq) {
			state.quoting = false;
			paintSummary();
		}
	}
}

// ── Launch ─────────────────────────────────────────────────────────────────

function confirmLaunch() {
	const q = state.quote;
	if (!q?.ready || state.launching) return;
	const dialog = document.createElement('dialog');
	dialog.className = 'pc-dialog';
	dialog.setAttribute('aria-labelledby', 'pl-dialog-title');
	dialog.innerHTML = `
		<h2 id="pl-dialog-title" class="cv-h2">Launch $${esc(q.coin.symbol)}?</h2>
		<p class="pc-fine" style="font-size:0.875rem;color:var(--cv-text-2)">This spends real funds from your agent's wallet and creates a coin anyone can trade. It cannot be undone.</p>
		<dl class="pc-out">
			<dt>From</dt><dd>${esc(q.agent.name || 'Agent')} · ${esc(short(q.wallet.address))}</dd>
			<dt>To</dt><dd>Paired launchpad ${esc(short(q.launchpad))}</dd>
			<dt>Chain</dt><dd>Robinhood Chain (${esc(q.chain_id)})</dd>
			<dt>Pairs</dt><dd>${esc(q.pairs.map((p) => `${p.symbol} ${p.weight_pct}%`).join(', '))}</dd>
			<dt><strong>Amount</strong></dt><dd><strong>${esc(amount(q.cost.total_eth))} ETH</strong>${q.opening_buy ? ` + ${esc(q.opening_buy.amount)} ${esc(q.opening_buy.market)}` : ''}</dd>
		</dl>
		<div class="pc-dialog-actions">
			<button type="button" class="pc-btn" id="pl-cancel">Cancel</button>
			<button type="button" class="pc-btn pc-btn-primary" id="pl-go">Launch</button>
		</div>`;
	document.body.appendChild(dialog);
	const close = () => {
		dialog.close();
		dialog.remove();
	};
	dialog.addEventListener('cancel', close);
	$('#pl-cancel', dialog).addEventListener('click', close);
	$('#pl-go', dialog).addEventListener('click', async () => {
		close();
		await launch();
	});
	dialog.showModal();
	$('#pl-go', dialog).focus();
}

/** One key per distinct request: a retry of the same body reuses it, an edit gets a new one. */
function attemptFor(bodyJson) {
	const agentId = state.form.agentId;
	if (!state.attempt || state.attempt.bodyJson !== bodyJson || state.attempt.agentId !== agentId) {
		state.attempt = { key: crypto.randomUUID(), bodyJson, agentId };
	}
	return state.attempt;
}

/** Follow GET /api/launches/:id until the launch is finalized or failed. */
async function settle(launch) {
	let rec = launch;
	while (rec.status !== 'finalized' && rec.status !== 'failed') {
		await new Promise((r) => setTimeout(r, 3000));
		rec = await getJson(`/api/launches/${encodeURIComponent(rec.id)}`);
	}
	if (rec.status === 'failed') throw Object.assign(new Error(rec.error?.message || 'The launch failed.'), { code: rec.error?.code });
	return rec.result;
}

async function launch() {
	if (!(await ensureRiskAck({ context: 'paired-launch' }))) return;
	state.launching = true;
	const btn = $('#pl-launch');
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Signing and sending…';
		btn.classList.add('is-busy');
	}
	const bodyJson = JSON.stringify(requestBody());
	const attempt = attemptFor(bodyJson);
	try {
		const data = await getJson(`/api/agents/${encodeURIComponent(attempt.agentId)}/paired/launch`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json', 'idempotency-key': attempt.key },
			body: bodyJson,
		});
		state.launched = data.launch && data.launch.status !== 'finalized' ? await settle(data.launch) : data;
		render();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	} catch (err) {
		if (err.status === 409 || err.code === 'launch_failed') state.attempt = null;
		state.quoteError = /failed to fetch|network/i.test(err?.message || '')
			? 'The connection dropped while launching. Press launch again: the same request is sent with the same key, so you get the same launch, never a second one.'
			: explainLoad(err);
		state.quote = null;
		paintSummary();
	} finally {
		state.launching = false;
	}
}

mountLanePicker(document.getElementById('pl-lanes'), { current: 'paired' });
boot();
