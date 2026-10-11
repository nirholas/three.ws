// /launch/uniswap: an owner has one of their agents launch a fixed-supply coin
// with a Uniswap V3 pool on Base, from the agent's own EVM wallet.
//
// Data flow: GET /api/launches/lanes supplies the fee tiers and lock options
// (live from the launcher), GET /api/agents lists the owner's agents, and every
// form change is debounced into POST /api/agents/:id/uniswap/quote, which names
// every fee and anything blocking. Launch shows the confirmation table, signs
// only after an explicit yes, and sends the body with an Idempotency-Key. The
// response is a launch record: the page follows GET /api/launches/:id until it
// is finalized or failed, so a dropped connection never means a second launch.

import { ensureRiskAck } from '../shared/risk-ack.js';
import { mountLanePicker } from '../launch/lane-picker.js';
import { amount, esc, explainLoad, getJson, short, usd } from '../paired/common.js';

const $ = (s, r = document) => r.querySelector(s);

const STAGES = [
	['accepted', 'Request accepted'],
	['policy_checked', 'Spend policy checked'],
	['reserved', 'Spend reserved'],
	['submitted', 'Transaction sent'],
	['confirmed', 'Confirmed on Base'],
	['finalized', 'Launch recorded'],
];

const state = {
	user: undefined,
	agents: null,
	agentsError: '',
	lane: null,
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
		tier: 10000,
		mcap: '4',
		lock: 'permanent',
		days: '365',
		recipient: '',
	},
	quote: null,
	quoteError: '',
	quoting: false,
	quoteSeq: 0,
	launching: false,
	attempt: null,
	record: null,
	launchError: '',
};

const suggestSymbol = (name) => String(name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
const selectedAgent = () => state.agents?.find((a) => a.id === state.form.agentId) || null;
const tiers = () => state.lane?.fee_tiers || [];
const lockModes = () => state.lane?.liquidity?.lock_options || [];

/** The body /quote and /launch both take, built only from the form. */
function requestBody() {
	const f = state.form;
	const body = { name: f.name.trim(), symbol: f.symbol.trim(), fee_tier: f.tier, lock: { mode: f.lock } };
	const mcap = Number(f.mcap);
	if (mcap > 0) body.start_market_cap_eth = mcap;
	if (f.lock === 'timelock') body.lock.unlock_days = Number(f.days);
	if (f.description.trim()) body.description = f.description.trim();
	if (f.image.trim()) body.image_url = f.image.trim();
	const socials = {};
	if (f.website.trim()) socials.website = f.website.trim();
	if (f.twitter.trim()) socials.twitter = f.twitter.trim();
	if (f.telegram.trim()) socials.telegram = f.telegram.trim();
	if (Object.keys(socials).length) body.socials = socials;
	if (f.recipient.trim()) body.fee_recipient = f.recipient.trim();
	return body;
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function boot() {
	const params = new URL(location.href).searchParams;
	state.form.name = (params.get('name') || '').slice(0, 32);
	state.form.symbol = suggestSymbol(params.get('symbol') || state.form.name);
	state.form.symbolTouched = Boolean(params.get('symbol'));
	render();
	mountLanePicker($('#ul-lanes'), { current: 'uniswap' }).then((lanes) => {
		state.lane = lanes?.find((l) => l.id === 'uniswap') || null;
		if (state.lane && !tiers().some((t) => t.fee === state.form.tier)) state.form.tier = tiers()[0]?.fee ?? 10000;
		if (state.agents) render();
	});

	const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
	state.user = me?.user || null;
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
	const root = $('#ul-app');
	if (state.agents === null) {
		root.innerHTML = `<div class="pc-launch"><div class="cv-skel" style="height:620px;border-radius:14px"></div><div class="cv-skel" style="height:380px;border-radius:14px"></div></div>`;
		return;
	}
	if (state.agentsError) {
		root.innerHTML = emptyCard('Could not load your agents', esc(state.agentsError), '<button type="button" class="pc-btn" id="ul-retry">Try again</button>');
		$('#ul-retry').addEventListener('click', () => location.reload());
		return;
	}
	if (!state.user) {
		const next = encodeURIComponent(location.pathname + location.search);
		root.innerHTML = emptyCard('Sign in to launch', 'Your agent signs the launch with its own wallet, so you need to be signed in as its owner.', `<a class="pc-btn pc-btn-primary" href="${'/login?next=' + next}">Sign in</a>`);
		return;
	}
	if (!state.agents.length) {
		root.innerHTML = emptyCard('Create an agent first', 'Uniswap pool coins launch from an agent\'s own wallet. Create a 3D agent and it gets a wallet that works on Base.', '<a class="pc-btn pc-btn-primary" href="/create">Create an agent</a>');
		return;
	}
	if (state.record) {
		root.innerHTML = trackerCard();
		wireTracker();
		return;
	}
	if (state.lane && !state.lane.available) {
		root.innerHTML = emptyCard('This lane is not open yet', esc(state.lane.unavailable_reason || ''), '<a class="pc-btn pc-btn-primary" href="/launch">Choose another lane</a>');
		return;
	}
	root.innerHTML = `<div class="pc-launch">${formCard()}<aside id="ul-side">${summaryCard()}</aside></div>${apiCard()}`;
	wireForm();
	wireSummary();
}

function optionButtons(items, current, attr, render1) {
	return `<div class="ul-options" role="group">${items.map((it) => `<button type="button" class="ul-option" ${attr}="${esc(it.key)}" aria-pressed="${it.key === String(current)}">${render1(it)}</button>`).join('')}</div>`;
}

function formCard() {
	const f = state.form;
	const agent = selectedAgent();
	const agentOptions = state.agents.map((a) => `<option value="${esc(a.id)}" ${a.id === f.agentId ? 'selected' : ''}>${esc(a.name || 'Agent')}</option>`).join('');
	const tierButtons = optionButtons(
		tiers().map((t) => ({ key: t.fee, bps: t.bps })),
		f.tier,
		'data-tier',
		(t) => `<strong>${esc(+t.bps.toFixed(2))}%</strong><small>per trade</small>`,
	);
	const lockButtons = optionButtons(
		lockModes().map((m) => ({ key: m.id, label: m.label, description: m.description })),
		f.lock,
		'data-lock',
		(m) => `<strong>${esc(m.label)}</strong><small>${esc(m.description)}</small>`,
	);
	return `
	<form class="pc-panel" id="ul-form" novalidate>
		<label class="pc-field"><span>Agent</span><select class="pc-input" id="f-agent">${agentOptions}</select></label>
		<div class="pc-row">
			<label class="pc-field"><span>Coin name</span>
				<input class="pc-input" id="f-name" maxlength="32" autocomplete="off" placeholder="${esc(agent?.name || 'My agent coin')}" value="${esc(f.name)}" required />
			</label>
			<label class="pc-field pc-ticker"><span>Ticker</span>
				<input class="pc-input mono" id="f-symbol" maxlength="10" autocomplete="off" placeholder="TICKER" value="${esc(f.symbol)}" required />
			</label>
		</div>
		<div class="pc-field"><span>Pool fee</span><small>Paid by traders on every swap and earned by the liquidity position.</small>${tierButtons}</div>
		<label class="pc-field"><span>Starting market cap <em>in ETH</em></span>
			<div class="pc-unit"><input class="pc-input mono" id="f-mcap" inputmode="decimal" autocomplete="off" value="${esc(f.mcap)}" /><span>ETH</span></div>
			<small>The price of the first block times the whole supply of one billion. The pool needs no ETH from you to open.</small>
		</label>
		<div class="pc-field"><span>Liquidity</span>${lockButtons}</div>
		${f.lock === 'timelock' ? `<label class="pc-field"><span>Unlock after</span><div class="pc-unit"><input class="pc-input mono" id="f-days" inputmode="numeric" value="${esc(f.days)}" /><span>days</span></div><small>Between 1 and 3650 days.</small></label>` : ''}
		<label class="pc-field"><span>Fee recipient <em>optional</em></span>
			<input class="pc-input mono" id="f-recipient" autocomplete="off" maxlength="64" placeholder="${esc(agent ? 'Your agent wallet' : '0x…')}" value="${esc(f.recipient)}" />
			<small>Where collected pool fees go. An address other than the agent wallet must be on the agent's EVM allowlist and needs a lock.</small>
		</label>
		<label class="pc-field"><span>Description <em>optional</em></span>
			<textarea class="pc-input" id="f-description" maxlength="480" rows="3" placeholder="What is this coin about?">${esc(f.description)}</textarea>
		</label>
		<label class="pc-field"><span>Logo URL <em>optional</em></span>
			<input class="pc-input" id="f-image" type="url" inputmode="url" maxlength="512" placeholder="https://" value="${esc(f.image)}" />
			<small>It is copied onto three.ws so it can never change.</small>
		</label>
		<fieldset class="pc-field" style="border:0;padding:0;margin:0"><legend style="padding:0;margin-bottom:0.35rem">Links <em>optional</em></legend>
			<div class="pc-row">
				<input class="pc-input" id="f-website" type="url" inputmode="url" maxlength="200" placeholder="https://your-site" aria-label="Website" value="${esc(f.website)}" />
				<input class="pc-input" id="f-twitter" type="url" inputmode="url" maxlength="200" placeholder="https://x.com/…" aria-label="X link" value="${esc(f.twitter)}" />
				<input class="pc-input" id="f-telegram" type="url" inputmode="url" maxlength="200" placeholder="https://t.me/…" aria-label="Telegram link" value="${esc(f.telegram)}" />
			</div>
		</fieldset>
	</form>`;
}

function feeRows(q) {
	return q.fees
		.map((fee) => {
			if (fee.eth != null) {
				const usdPart = fee.usd != null ? ` (${usd(fee.usd, { compact: false })})` : '';
				return `<dt>${esc(fee.label)}${fee.estimated ? ' (estimated)' : ''}</dt><dd>${esc(amount(fee.eth))} ETH${esc(usdPart)}</dd>`;
			}
			return `<dt>${esc(fee.label)}</dt><dd>${esc(+(fee.bps / 100).toFixed(2))}%<br /><small>${esc(fee.note || '')}</small></dd>`;
		})
		.join('');
}

function summaryCard() {
	const q = state.quote;
	const f = state.form;
	if (state.quoteError) {
		return `<section class="pc-panel"><h2 class="cv-h2">Cost</h2><p class="pc-status is-error" role="alert">${esc(state.quoteError)}</p>
			<button type="button" class="pc-btn" id="ul-requote">Try again</button></section>`;
	}
	if (!q) {
		const need = !f.name.trim() || !f.symbol.trim() ? 'Name the coin and pick a ticker' : 'Check the form';
		return `<section class="pc-panel"><h2 class="cv-h2">Cost</h2>
			${state.quoting ? '<div class="cv-skel" style="height:1.1rem"></div><div class="cv-skel" style="height:1.1rem"></div><div class="cv-skel" style="height:1.1rem"></div>' : `<p class="pc-fine">${esc(need)} to see every fee.</p>`}
			<button type="button" class="pc-btn pc-btn-primary" disabled>Launch</button></section>`;
	}
	const blockers = q.blockers.length ? `<ul class="pc-blockers" role="alert">${q.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
	return `
	<section class="pc-panel" ${state.quoting ? 'style="opacity:0.7"' : ''}>
		<h2 class="cv-h2">$${esc(q.coin.symbol)} pool</h2>
		<dl class="pc-out">
			<dt>Supply</dt><dd>${esc(Number(q.coin.total_supply).toLocaleString('en-US'))}, all in the pool</dd>
			<dt>Opens at</dt><dd>${esc(amount(q.pool.start_market_cap_eth))} ETH market cap</dd>
			<dt>Pool fee</dt><dd>${esc(+(q.pool.fee_tier_bps / 100).toFixed(2))}%</dd>
			<dt>Liquidity</dt><dd>${esc(q.lock.label)}${q.lock.unlock_at ? ` until ${esc(new Date(q.lock.unlock_at).toLocaleDateString())}` : ''}</dd>
			<dt>Fees go to</dt><dd><code>${esc(short(q.lock.fee_recipient))}</code></dd>
			<dt>Your fee share</dt><dd>${esc(+(q.creator_share_bps / 100).toFixed(2))}%</dd>
		</dl>
		<h2 class="cv-h2">Every fee</h2>
		<dl class="pc-out">${feeRows(q)}
			<dt><strong>Total to launch</strong></dt><dd><strong>${esc(amount(q.cost.total_eth))} ETH</strong>${q.cost.total_usd != null ? `<br /><small>about ${esc(usd(q.cost.total_usd, { compact: false }))}</small>` : ''}</dd>
		</dl>
		<div class="pc-field" style="gap:0.3rem">
			<span>${esc(q.agent.name || 'Agent')} wallet on Base</span>
			<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
				<code title="${esc(q.wallet.address)}">${esc(short(q.wallet.address))}</code>
				<button type="button" class="pc-btn" id="ul-copy" data-copy="${esc(q.wallet.address)}" style="min-height:28px" aria-label="Copy wallet address">Copy</button>
				<span class="cv-mono" style="margin-left:auto">${esc(amount(q.wallet.balance_eth))} ETH</span>
			</div>
		</div>
		${blockers}
		${state.launchError ? `<p class="pc-status is-error" role="alert">${esc(state.launchError)}</p>` : ''}
		<button type="button" class="pc-btn pc-btn-primary" id="ul-launch" ${q.ready && !state.quoting && !state.launching ? '' : 'disabled'}>Review and launch</button>
		<p class="pc-fine">Nothing is signed until you confirm the table that follows.</p>
	</section>`;
}

function apiCard() {
	const id = state.form.agentId || '<agent-id>';
	return `
	<section class="pc-panel" style="margin-top:1.25rem">
		<h2 class="cv-h2">Let your agent and your bots launch</h2>
		<p class="pc-fine" style="font-size:0.875rem;color:var(--cv-text-2)">Quote first, then launch with an <code>Idempotency-Key</code> so a retry returns the same launch instead of a second one. The MCP tools are <code>uniswap_launch_quote</code>, <code>uniswap_launch</code> and <code>launch_status</code>.</p>
		<pre class="pc-code"><code>curl -X POST https://three.ws/api/agents/${esc(id)}/uniswap/launch \\
  -H "authorization: Bearer $THREEWS_API_KEY" \\
  -H "idempotency-key: $(uuidgen)" \\
  -H "content-type: application/json" \\
  -d '{"name":"Chip Stack","symbol":"CHIPS","fee_tier":10000,"lock":{"mode":"permanent"}}'

# Then follow it: GET /api/launches/:id</code></pre>
		<a href="/docs/launch-lanes">Read the launch lanes guide →</a>
	</section>`;
}

// ── Wiring + live quote ────────────────────────────────────────────────────

function wireForm() {
	const f = state.form;
	const bind = (sel, key, after) => {
		const input = $(sel);
		if (!input) return;
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
	bind('#f-mcap', 'mcap', (input) => {
		const clean = input.value.replace(/[^0-9.]/g, '');
		if (clean !== input.value) input.value = clean;
		f.mcap = clean;
	});
	bind('#f-days', 'days');
	bind('#f-recipient', 'recipient');
	bind('#f-description', 'description');
	bind('#f-image', 'image');
	bind('#f-website', 'website');
	bind('#f-twitter', 'twitter');
	bind('#f-telegram', 'telegram');
	$('#ul-form').addEventListener('click', (e) => {
		const tier = e.target.closest('[data-tier]');
		const lock = e.target.closest('[data-lock]');
		if (tier) f.tier = Number(tier.dataset.tier);
		else if (lock) f.lock = lock.dataset.lock;
		else return;
		const scroll = window.scrollY;
		$('#ul-app .pc-launch > form').outerHTML = formCard();
		wireForm();
		window.scrollTo({ top: scroll });
		scheduleQuote(0);
	});
	$('#ul-form').addEventListener('submit', (e) => e.preventDefault());
}

function wireSummary() {
	$('#ul-requote')?.addEventListener('click', () => scheduleQuote(0));
	$('#ul-launch')?.addEventListener('click', confirmLaunch);
	const copy = $('#ul-copy');
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
	const side = $('#ul-side');
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
	if (!state.form.agentId || !body.name || body.symbol.length < 2 || !body.start_market_cap_eth) {
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
		const data = await getJson(`/api/agents/${encodeURIComponent(state.form.agentId)}/uniswap/quote`, {
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

// ── Confirm, launch, follow ────────────────────────────────────────────────

/** The table the owner approves. Nothing is signed before "Launch" is pressed. */
function confirmLaunch() {
	const q = state.quote;
	if (!q?.ready || state.launching) return;
	const dialog = document.createElement('dialog');
	dialog.className = 'pc-dialog';
	dialog.setAttribute('aria-labelledby', 'ul-dialog-title');
	dialog.innerHTML = `
		<h2 id="ul-dialog-title" class="cv-h2">Launch $${esc(q.coin.symbol)}?</h2>
		<p class="pc-fine" style="font-size:0.875rem;color:var(--cv-text-2)">This spends real funds from your agent's wallet and creates a coin anyone can trade. It cannot be undone.</p>
		<dl class="pc-out">
			<dt>From</dt><dd>${esc(q.agent.name || 'Agent')} · <code>${esc(short(q.wallet.address))}</code></dd>
			<dt>To</dt><dd>Uniswap launcher <code>${esc(short(q.launcher))}</code></dd>
			<dt>Chain</dt><dd>${esc(q.chain === 'base' ? 'Base' : q.chain)} (${esc(q.chain_id)})</dd>
			<dt>Pool</dt><dd>${esc(q.coin.symbol)} / WETH · ${esc(+(q.pool.fee_tier_bps / 100).toFixed(2))}% fee tier</dd>
			<dt>Liquidity</dt><dd>${esc(q.lock.label)}</dd>
			${feeRows(q)}
			<dt><strong>Amount</strong></dt><dd><strong>${esc(amount(q.cost.total_eth))} ETH</strong></dd>
		</dl>
		<div class="pc-dialog-actions">
			<button type="button" class="pc-btn" id="ul-cancel">Cancel</button>
			<button type="button" class="pc-btn pc-btn-primary" id="ul-go">Launch</button>
		</div>`;
	document.body.appendChild(dialog);
	const close = () => {
		dialog.close();
		dialog.remove();
	};
	dialog.addEventListener('cancel', close);
	$('#ul-cancel', dialog).addEventListener('click', close);
	$('#ul-go', dialog).addEventListener('click', async () => {
		close();
		await launch();
	});
	dialog.showModal();
	$('#ul-cancel', dialog).focus();
}

/** One key per distinct request: a retry of the same body reuses it, an edit gets a new one. */
function attemptFor(bodyJson) {
	if (!state.attempt || state.attempt.bodyJson !== bodyJson || state.attempt.agentId !== state.form.agentId) {
		state.attempt = { key: crypto.randomUUID(), bodyJson, agentId: state.form.agentId };
	}
	return state.attempt;
}

async function launch() {
	if (!(await ensureRiskAck({ context: 'uniswap-launch' }))) return;
	state.launching = true;
	state.launchError = '';
	paintSummary();
	const bodyJson = JSON.stringify(requestBody());
	const attempt = attemptFor(bodyJson);
	try {
		const data = await getJson(`/api/agents/${encodeURIComponent(attempt.agentId)}/uniswap/launch`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json', 'idempotency-key': attempt.key },
			body: bodyJson,
		});
		state.record = data.launch;
		render();
		window.scrollTo({ top: 0, behavior: 'smooth' });
		follow();
	} catch (err) {
		if (err.status === 409 && err.code && err.code !== 'idempotency_key_reused') state.attempt = null;
		state.launchError = explainLaunchError(err);
		paintSummary();
	} finally {
		state.launching = false;
	}
}

function explainLaunchError(err) {
	if (/failed to fetch|network/i.test(err?.message || '')) {
		return 'The connection dropped while launching. Press launch again: the same request is sent with the same key, so you get the same launch, never a second one.';
	}
	return explainLoad(err);
}

let pollTimer = null;
async function follow() {
	clearTimeout(pollTimer);
	const rec = state.record;
	if (!rec || rec.status === 'finalized' || rec.status === 'failed') return;
	try {
		state.record = await getJson(`/api/launches/${encodeURIComponent(rec.id)}`);
	} catch {
		/* keep the last known state; the next tick retries */
	}
	render();
	pollTimer = setTimeout(follow, 3000);
}

function stageList(rec) {
	const seen = new Set((rec.stages || []).map((s) => s.stage));
	const failed = rec.status === 'failed';
	const firstTodo = STAGES.findIndex(([id]) => !seen.has(id));
	return `<ol class="ul-stages" aria-label="Launch progress">${STAGES.map(([id, label], i) => {
		const done = seen.has(id);
		const cls = done ? 'is-done' : i === firstTodo ? (failed ? 'is-failed' : 'is-live') : 'is-todo';
		return `<li class="${cls}"><span class="dot" aria-hidden="true"></span>${esc(label)}</li>`;
	}).join('')}</ol>`;
}

function trackerCard() {
	const rec = state.record;
	if (rec.status === 'finalized') {
		const r = rec.result;
		return `
		<section class="pc-panel" style="max-width:720px">
			<p class="cv-sub" style="margin:0">Live on Base</p>
			<h2 class="cv-h2" style="font-size:1.5rem">$${esc(r.symbol)} is trading</h2>
			<p style="margin:0;color:var(--cv-text-2)">${esc(r.name)} launched from your agent's wallet in block ${esc(Number(r.block).toLocaleString('en-US'))} with a ${esc(+(r.fee_tier_bps / 100).toFixed(2))}% pool and ${esc(String(r.lock).replace('none', 'no lock'))}. It cost ${esc(amount(r.spent_eth))} ETH.</p>
			${stageList(rec)}
			<code>${esc(r.token)}</code>
			<div class="pc-hero-actions">
				<a class="pc-btn pc-btn-primary" href="${esc(r.urls.token)}" target="_blank" rel="noopener noreferrer">Token ↗</a>
				<a class="pc-btn" href="${esc(r.urls.pool)}" target="_blank" rel="noopener noreferrer">Pool ↗</a>
				<a class="pc-btn" href="${esc(r.urls.explorer)}" target="_blank" rel="noopener noreferrer">Transaction ↗</a>
				<button type="button" class="pc-btn" id="ul-again">Launch another</button>
			</div>
		</section>`;
	}
	if (rec.status === 'failed') {
		return `
		<section class="pc-panel" style="max-width:720px">
			<h2 class="cv-h2">The launch did not go through</h2>
			<p class="pc-status is-error" role="alert">${esc(rec.error?.message || 'The launch failed.')}</p>
			${stageList(rec)}
			<p class="pc-fine">A failed launch is closed. Going back and launching again starts a new one with a new key.</p>
			<div class="pc-hero-actions"><button type="button" class="pc-btn pc-btn-primary" id="ul-back">Back to the form</button></div>
		</section>`;
	}
	return `
	<section class="pc-panel" style="max-width:720px">
		<h2 class="cv-h2">Launching…</h2>
		<p class="pc-fine">You can leave this page. The launch continues and is saved under <code>${esc(rec.id)}</code>.</p>
		${stageList(rec)}
		${rec.tx_hash ? `<code title="${esc(rec.tx_hash)}">${esc(short(rec.tx_hash))}</code>` : ''}
	</section>`;
}

function wireTracker() {
	$('#ul-again')?.addEventListener('click', () => {
		state.record = null;
		state.attempt = null;
		Object.assign(state.form, { name: '', symbol: '', symbolTouched: false, description: '' });
		render();
		scheduleQuote(0);
	});
	$('#ul-back')?.addEventListener('click', () => {
		state.record = null;
		state.attempt = null;
		render();
		scheduleQuote(0);
	});
}

boot();
