// /launch/robinhood: an owner launches a coin on Pons (Robinhood Chain) from
// one of their agents' own EVM wallets.
//
// Data flow: GET /api/agents lists the owner's agents. Every form change is
// debounced into POST /api/agents/:id/pons/quote, which reads the live Pons
// terms, the agent wallet's balance and the spend policy, and returns the
// exact cost and anything blocking the launch. Launch confirms the quoted
// amount in a dialog, then POSTs the identical body to /pons/launch, which
// signs with the agent's custodial key and answers with the landed token.
// Nothing is estimated here: every number on screen came from that quote.

import './page.css';
import { ensureRiskAck } from '../shared/risk-ack.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) =>
	String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const fmtEth = (v) => {
	const n = Number(v);
	if (!Number.isFinite(n)) return '0';
	if (n === 0) return '0';
	return n < 0.0001 ? n.toExponential(2) : n.toLocaleString('en-US', { maximumFractionDigits: 6 });
};
const fmtTokens = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

const state = {
	user: undefined,
	agents: null,
	agentsError: '',
	form: {
		agentId: '',
		name: '',
		symbol: '',
		symbolTouched: false,
		description: '',
		image: '',
		twitter: '',
		telegram: '',
		website: '',
		buyEth: '',
		taxPct: '0',
		buyback: false,
	},
	quote: null,
	quoteError: '',
	quoting: false,
	quoteSeq: 0,
	launching: false,
	launched: null,
};

async function api(path, { method = 'GET', body } = {}) {
	const res = await fetch(path, {
		method,
		credentials: 'include',
		headers: body ? { 'content-type': 'application/json' } : { accept: 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw Object.assign(new Error(data?.error_description || data?.error || `Request failed (${res.status})`), {
			code: data?.error,
			status: res.status,
			detail: data?.detail,
		});
	}
	return data;
}

const selectedAgent = () => state.agents?.find((a) => a.id === state.form.agentId) || null;

function suggestSymbol(name) {
	return String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

/** The request body both /quote and /launch take, built only from the form. */
function requestBody() {
	const f = state.form;
	const socials = {};
	if (f.twitter.trim()) socials.twitter = f.twitter.trim();
	if (f.telegram.trim()) socials.telegram = f.telegram.trim();
	if (f.website.trim()) socials.website = f.website.trim();
	const body = {
		name: f.name.trim(),
		symbol: f.symbol.trim(),
		buy_eth: Math.max(0, Number(f.buyEth) || 0),
		creator_tax_bps: Math.round(Math.min(10, Math.max(0, Number(f.taxPct) || 0)) * 100),
		buyback: f.buyback,
	};
	if (f.description.trim()) body.description = f.description.trim();
	if (f.image.trim()) body.image_url = f.image.trim();
	if (Object.keys(socials).length) body.socials = socials;
	return body;
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
	const params = new URL(location.href).searchParams;
	state.form.name = (params.get('name') || '').slice(0, 64);
	if (params.get('symbol')) {
		state.form.symbol = suggestSymbol(params.get('symbol'));
		state.form.symbolTouched = true;
	} else state.form.symbol = suggestSymbol(state.form.name);
	render();
	try {
		const me = await fetch('/api/auth/me', { credentials: 'include' });
		state.user = me.ok ? (await me.json()).user || null : null;
		if (state.user) {
			const { agents = [] } = await api('/api/agents');
			state.agents = agents;
			const wanted = params.get('agent');
			state.form.agentId = (agents.find((a) => a.id === wanted) || agents[0])?.id || '';
		} else state.agents = [];
	} catch (err) {
		state.agentsError = /failed to fetch/i.test(err.message) ? 'three.ws could not be reached.' : err.message;
		state.agents = [];
	}
	render();
	scheduleQuote(0);
}

// ── Rendering ──────────────────────────────────────────────────────────────

function render() {
	const root = $('#lr-app');
	if (state.agents === null) {
		root.innerHTML = `<div class="lr-grid"><div class="lr-card lr-skel" style="height:520px"></div><div class="lr-card lr-skel" style="height:360px"></div></div>`;
		return;
	}
	if (state.agentsError) {
		root.innerHTML = emptyCard('Could not load your agents', esc(state.agentsError), '<button type="button" class="lr-btn" id="lr-retry">Try again</button>');
		$('#lr-retry').addEventListener('click', () => location.reload());
		return;
	}
	if (!state.user) {
		const next = encodeURIComponent(location.pathname + location.search);
		root.innerHTML = emptyCard(
			'Sign in to launch',
			'Your agent signs the launch with its own wallet, so you need to be signed in as its owner.',
			`<a class="lr-btn lr-btn-primary" href="/login?next=${next}">Sign in</a>`,
		) + botsCard();
		return;
	}
	if (!state.agents.length) {
		root.innerHTML = emptyCard(
			'Create an agent first',
			'Coins launch from an agent\'s own wallet. Create a 3D agent and it gets a wallet that works on Robinhood Chain.',
			'<a class="lr-btn lr-btn-primary" href="/create">Create an agent</a>',
		) + botsCard();
		return;
	}
	if (state.launched) {
		root.innerHTML = successCard(state.launched) + botsCard();
		$('#lr-again').addEventListener('click', () => {
			state.launched = null;
			state.form.name = '';
			state.form.symbol = '';
			state.form.symbolTouched = false;
			render();
			scheduleQuote(0);
		});
		return;
	}
	root.innerHTML = `<div class="lr-grid">${formCard()}<aside class="lr-side">${summaryCard()}</aside></div>${botsCard()}`;
	wireForm();
}

function emptyCard(title, text, action) {
	return `<section class="lr-card lr-empty"><h2>${esc(title)}</h2><p>${text}</p><div>${action}</div></section>`;
}

function formCard() {
	const f = state.form;
	const agent = selectedAgent();
	const options = state.agents
		.map((a) => `<option value="${esc(a.id)}" ${a.id === f.agentId ? 'selected' : ''}>${esc(a.name || 'Agent')}</option>`)
		.join('');
	const logoHint = agent?.avatar_thumbnail_url
		? "Leave empty to use your agent's avatar."
		: 'An https:// or ipfs:// image. Your agent\'s avatar is private, so add one here.';
	return `
	<form class="lr-card lr-form" id="lr-form" novalidate>
		<label class="lr-field"><span>Agent</span>
			<select class="lr-input" id="f-agent" name="agent">${options}</select>
		</label>
		<div class="lr-row">
			<label class="lr-field lr-grow"><span>Coin name</span>
				<input class="lr-input" id="f-name" maxlength="64" autocomplete="off" placeholder="${esc(agent?.name || 'My agent coin')}" value="${esc(f.name)}" required />
			</label>
			<label class="lr-field lr-ticker"><span>Ticker</span>
				<input class="lr-input lr-mono" id="f-symbol" maxlength="16" autocomplete="off" placeholder="TICKER" value="${esc(f.symbol)}" required />
			</label>
		</div>
		<label class="lr-field"><span>Description <em>optional</em></span>
			<textarea class="lr-input" id="f-description" maxlength="2048" rows="3" placeholder="What is this coin about?">${esc(f.description)}</textarea>
		</label>
		<label class="lr-field"><span>Logo URL <em>optional</em></span>
			<input class="lr-input" id="f-image" type="url" inputmode="url" maxlength="512" placeholder="https://" value="${esc(f.image)}" />
			<small>${esc(logoHint)}</small>
		</label>
		<fieldset class="lr-socials"><legend>Links <em>optional</em></legend>
			<input class="lr-input" id="f-twitter" type="url" inputmode="url" maxlength="256" placeholder="https://x.com/…" aria-label="X link" value="${esc(f.twitter)}" />
			<input class="lr-input" id="f-telegram" type="url" inputmode="url" maxlength="256" placeholder="https://t.me/…" aria-label="Telegram link" value="${esc(f.telegram)}" />
			<input class="lr-input" id="f-website" type="url" inputmode="url" maxlength="256" placeholder="https://your-site" aria-label="Website" value="${esc(f.website)}" />
		</fieldset>
		<div class="lr-row">
			<label class="lr-field lr-grow"><span>Opening buy</span>
				<div class="lr-unit"><input class="lr-input lr-mono" id="f-buy" inputmode="decimal" autocomplete="off" placeholder="0.0" value="${esc(f.buyEth)}" /><span>ETH</span></div>
				<small>Bought in the launch transaction itself, before anyone else can trade.</small>
			</label>
			<label class="lr-field lr-tax"><span>Creator tax</span>
				<div class="lr-unit"><input class="lr-input lr-mono" id="f-tax" inputmode="decimal" autocomplete="off" value="${esc(f.taxPct)}" /><span>%</span></div>
				<small>Paid to your agent on every trade. Max 10%.</small>
			</label>
		</div>
		<div class="lr-toggle">
			<div><strong>Buyback and lock</strong><span>Route the buyback share of trading fees into a five-year locked buyback of your coin.</span></div>
			<button type="button" class="lr-switch" role="switch" id="f-buyback" aria-checked="${f.buyback}" aria-label="Buyback and lock"></button>
		</div>
	</form>`;
}

function summaryCard() {
	const q = state.quote;
	if (state.quoteError) {
		return `<section class="lr-card lr-summary"><h2>Cost</h2><p class="lr-error" role="alert">${esc(state.quoteError)}</p>
			<button type="button" class="lr-btn" id="lr-requote">Try again</button></section>`;
	}
	if (!q) {
		return `<section class="lr-card lr-summary"><h2>Cost</h2>
			${state.quoting ? '<div class="lr-skel lr-skel-line"></div><div class="lr-skel lr-skel-line"></div><div class="lr-skel lr-skel-line"></div>' : '<p class="lr-muted">Name the coin and pick a ticker to see the live cost.</p>'}
			<button type="button" class="lr-btn lr-btn-primary lr-launch" disabled>Launch on Pons</button></section>`;
	}
	const rows = [
		['Pons launch fee', `${fmtEth(q.cost.launch_fee_eth)} ETH`],
		['Opening buy', `${fmtEth(q.cost.opening_buy_eth)} ETH`],
		[q.cost.gas_estimated ? 'Network gas' : 'Network gas (typical)', `${fmtEth(q.cost.gas_eth)} ETH`],
	];
	const blockers = q.blockers.length
		? `<ul class="lr-blockers" role="alert">${q.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
		: '';
	return `
	<section class="lr-card lr-summary${state.quoting ? ' is-updating' : ''}">
		<h2>Cost</h2>
		<dl class="lr-cost">
			${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="lr-mono">${esc(v)}</dd></div>`).join('')}
			<div class="lr-total"><dt>Total</dt><dd class="lr-mono">${esc(fmtEth(q.cost.total_eth))} ETH${q.cost.total_usd != null ? `<small>≈ $${esc(q.cost.total_usd.toLocaleString('en-US'))}</small>` : ''}</dd></div>
		</dl>
		${Number(q.cost.opening_buy_eth) > 0 ? `<p class="lr-receive">Your agent receives <strong class="lr-mono">${esc(fmtTokens(q.opening_buy.tokens))} $${esc(q.coin.symbol)}</strong>, ${esc(q.opening_buy.pct_of_supply)}% of supply.</p>` : ''}
		<div class="lr-wallet">
			<span class="lr-wallet-label">${esc(q.agent.name || 'Agent')} wallet on Robinhood Chain</span>
			<div class="lr-wallet-row">
				<code class="lr-mono" title="${esc(q.wallet.address)}">${esc(short(q.wallet.address))}</code>
				<button type="button" class="lr-copy" id="lr-copy" data-copy="${esc(q.wallet.address)}" aria-label="Copy wallet address">Copy</button>
				<span class="lr-balance lr-mono">${esc(fmtEth(q.wallet.balance_eth))} ETH</span>
			</div>
		</div>
		${blockers}
		<button type="button" class="lr-btn lr-btn-primary lr-launch" id="lr-launch" ${q.ready && !state.quoting ? '' : 'disabled'}>Launch on Pons</button>
		<p class="lr-fine">Fees: ${esc(q.terms.curve_fee_bps / 100)}% per trade on the curve, plus your creator tax. Graduates at ${esc(q.terms.graduation_threshold_eth)} ETH raised.</p>
	</section>`;
}

function successCard(r) {
	return `
	<section class="lr-card lr-success">
		<p class="lr-eyebrow"><span class="lr-dot" aria-hidden="true"></span>Live on Robinhood Chain</p>
		<h2>$${esc(r.symbol)} is trading</h2>
		<p>${esc(r.name)} launched from your agent's wallet in block ${esc(r.block.toLocaleString('en-US'))}.${r.opening_buy ? ` The opening buy of ${esc(fmtEth(r.opening_buy.eth))} ETH bought ${esc(fmtTokens(r.opening_buy.tokens))} $${esc(r.symbol)}.` : ''}</p>
		<code class="lr-mono lr-token">${esc(r.token)}</code>
		<div class="lr-actions">
			<a class="lr-btn lr-btn-primary" href="${esc(r.urls.pons)}" target="_blank" rel="noopener noreferrer">Trade on Pons ↗</a>
			<a class="lr-btn" href="${esc(r.urls.coin)}">Coin page</a>
			<a class="lr-btn" href="${esc(r.urls.explorer)}" target="_blank" rel="noopener noreferrer">Transaction ↗</a>
			<button type="button" class="lr-btn" id="lr-again">Launch another</button>
		</div>
	</section>`;
}

function botsCard() {
	const id = state.form.agentId || '<agent-id>';
	return `
	<section class="lr-card lr-bots">
		<h2>Let your bots launch</h2>
		<p>The same launch is one API call, so a bot can quote, check with you, and launch. Use an API key with spend permission, or give your agent the <code>pons-launch</code> skill.</p>
		<pre class="lr-mono"><code>curl -X POST https://three.ws/api/agents/${esc(id)}/pons/quote \\
  -H "authorization: Bearer $THREEWS_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"name":"My Coin","symbol":"MINE","buy_eth":0.01}'

# Same body to /pons/launch sends it.</code></pre>
		<a href="/docs/pons-launch">Read the Pons launch guide →</a>
	</section>`;
}

// ── Form wiring + live quote ───────────────────────────────────────────────

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
	bind('#f-twitter', 'twitter');
	bind('#f-telegram', 'telegram');
	bind('#f-website', 'website');
	bind('#f-buy', 'buyEth');
	bind('#f-tax', 'taxPct');
	$('#f-buyback').addEventListener('click', (e) => {
		f.buyback = !f.buyback;
		e.currentTarget.setAttribute('aria-checked', String(f.buyback));
		scheduleQuote();
	});
	$('#lr-form').addEventListener('submit', (e) => e.preventDefault());
	wireSummary();
}

function wireSummary() {
	$('#lr-requote')?.addEventListener('click', () => scheduleQuote(0));
	$('#lr-launch')?.addEventListener('click', confirmLaunch);
	const copy = $('#lr-copy');
	copy?.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(copy.dataset.copy);
			copy.textContent = 'Copied';
			copy.classList.add('is-done');
		} catch {
			copy.textContent = 'Select and copy';
		}
	});
}

function paintSummary() {
	const side = $('.lr-side');
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
	if (!state.form.agentId || !body.name || !body.symbol) {
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
		const { data } = await api(`/api/agents/${encodeURIComponent(state.form.agentId)}/pons/quote`, { method: 'POST', body });
		if (seq !== state.quoteSeq) return;
		state.quote = data;
	} catch (err) {
		if (seq !== state.quoteSeq) return;
		state.quote = null;
		state.quoteError = err.message;
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
	dialog.className = 'lr-dialog';
	dialog.setAttribute('aria-labelledby', 'lr-dialog-title');
	dialog.innerHTML = `
		<h2 id="lr-dialog-title">Launch $${esc(q.coin.symbol)}?</h2>
		<p>This spends real ETH from your agent's wallet and creates a coin anyone can trade. It cannot be undone.</p>
		<dl class="lr-cost">
			<div><dt>From</dt><dd class="lr-mono">${esc(q.agent.name || 'Agent')} · ${esc(short(q.wallet.address))}</dd></div>
			<div><dt>To</dt><dd>Pons launchpad</dd></div>
			<div><dt>Chain</dt><dd>Robinhood Chain (${esc(q.chain_id)})</dd></div>
			<div class="lr-total"><dt>Amount</dt><dd class="lr-mono">${esc(fmtEth(q.cost.total_eth))} ETH${q.cost.total_usd != null ? `<small>≈ $${esc(q.cost.total_usd.toLocaleString('en-US'))}</small>` : ''}</dd></div>
		</dl>
		<div class="lr-actions">
			<button type="button" class="lr-btn" value="cancel" id="lr-cancel">Cancel</button>
			<button type="button" class="lr-btn lr-btn-primary" id="lr-go">Launch</button>
		</div>`;
	document.body.appendChild(dialog);
	const close = () => {
		dialog.close();
		dialog.remove();
	};
	dialog.addEventListener('cancel', close);
	$('#lr-cancel', dialog).addEventListener('click', close);
	$('#lr-go', dialog).addEventListener('click', async () => {
		close();
		await launch();
	});
	dialog.showModal();
	$('#lr-go', dialog).focus();
}

async function launch() {
	if (!(await ensureRiskAck({ context: 'pons-launch' }))) return;
	state.launching = true;
	const btn = $('#lr-launch');
	if (btn) {
		btn.disabled = true;
		btn.textContent = 'Signing and sending…';
		btn.classList.add('is-busy');
	}
	try {
		const { data } = await api(`/api/agents/${encodeURIComponent(state.form.agentId)}/pons/launch`, {
			method: 'POST',
			body: requestBody(),
		});
		state.launched = data;
		render();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	} catch (err) {
		state.quoteError = err.message;
		state.quote = null;
		paintSummary();
	} finally {
		state.launching = false;
	}
}

boot();
