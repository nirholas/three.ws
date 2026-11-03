// Coin Control (pages/coin-control.html).
//
// Two modes on one page:
//   /coin-control          the owner's control room for a coin their agent
//                          launched: fee engine rules (buyback and burn, holder
//                          rewards, DCA), what the engine did, who a reward
//                          reaches, the fee split, and bounties paid from the
//                          agent wallet.
//   /coin-control/:mint    the public proof page for that coin: the same totals
//                          and actions, every one linked to its transaction,
//                          with the creator's verified X handle. Read-only.
//
// Rules run on the reinvest engine (/api/revenue/rules): nothing moves until
// the owner confirms the exact terms, and the server refuses the confirm if the
// rule changed since it was reviewed. Bounty payouts are previewed first and
// confirmed from a signed-in browser session only.
// API: api/_lib/coin-control/routes.js. Doc: docs/coin-control.md.

import './agent-commerce.css';
import './earnings.css';
import './coin-control.css';
import { apiFetch } from './api.js';
import { esc, relTime } from './agent-commerce-format.js';
import { usd } from './earnings-chart.js';

const CC = '/api/coin-control';
const REV = '/api/revenue';
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const POLL_MS = 60_000;
const ENGINE_LEGS = [
	{ kind: 'buyback_burn', label: 'Buy back and burn', hint: 'Buys the coin with SOL from the agent wallet, then burns every token that buy returned.' },
	{ kind: 'holder_rewards', label: 'SOL rewards to holders', hint: 'Sends SOL to the top holders, split by holding size or by a lottery anyone can re-check.' },
	{ kind: 'dca_own_coin', label: 'Buy and hold', hint: 'Buys the coin and keeps it in the agent wallet.' },
];
const ENGINE_KINDS = new Set(ENGINE_LEGS.map((l) => l.kind));
const PRESETS = [
	{ id: 'burn', label: 'Burn half of every period', legs: [{ kind: 'buyback_burn', pct: 50 }] },
	{ id: 'holders', label: 'Reward the top 10 holders', legs: [{ kind: 'holder_rewards', pct: 30, mode: 'pro_rata', recipients: 10 }] },
	{ id: 'mix', label: 'Burn plus a weekly lottery', legs: [{ kind: 'buyback_burn', pct: 40 }, { kind: 'holder_rewards', pct: 20, mode: 'lottery', recipients: 3 }] },
];

const $ = (id) => document.getElementById(id);
const els = {};
const state = {
	mode: 'owner', mint: null, coins: [], key: null, data: null,
	editing: null, previews: new Map(), payouts: new Map(), busy: new Set(),
	topEvent: undefined, pollTimer: null, stage: null,
};

// ── helpers ──────────────────────────────────────────────────────────────────

async function call(url, { method = 'GET', body, anonymous = false } = {}) {
	const headers = { accept: 'application/json' };
	if (body) headers['content-type'] = 'application/json';
	let res;
	try {
		res = anonymous
			? await fetch(url, { method, headers })
			: await apiFetch(url, { method, allowAnonymous: true, headers, body: body ? JSON.stringify(body) : undefined });
	} catch (err) {
		if (err?.redirected) return { ok: false, status: 401, data: null, message: 'Your session expired. Sign in again.' };
		return { ok: false, status: 0, data: null, message: 'Network error. Check your connection and try again.' };
	}
	const json = await res.json().catch(() => ({}));
	return {
		ok: res.ok, status: res.status, code: json?.error?.code || null, data: json?.data ?? json,
		message: json?.error?.message || (typeof json?.error === 'string' ? json.error : null) || `Request failed (${res.status})`,
	};
}

function announce(msg) {
	els.live.textContent = '';
	requestAnimationFrame(() => { els.live.textContent = msg; });
}
function flash(msg) {
	els.flash.textContent = msg;
	els.flash.hidden = false;
	announce(msg);
	clearTimeout(flash.t);
	flash.t = setTimeout(() => { els.flash.hidden = true; }, 7000);
}
function showError(msg, retry) {
	els.error.innerHTML = `<strong>${esc(msg)}</strong>${retry ? '<br><button type="button" class="ac-btn ac-btn-sm" data-retry>Try again</button>' : ''}`;
	els.error.hidden = false;
	els.error._retry = retry || null;
}
function clearError() { els.error.hidden = true; }

function show(which) {
	els.skel.hidden = which !== 'skel';
	els.main.hidden = which !== 'main';
	els.auth.hidden = which !== 'auth';
	els.nocoin.hidden = which !== 'nocoin';
}

const short = (s) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : '');
const sym = (coin) => (coin?.symbol ? `$${String(coin.symbol).replace(/^\$/, '')}` : 'the coin');
const tokens = (s) => {
	const n = Number(s);
	if (!Number.isFinite(n)) return esc(String(s ?? '0'));
	return n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 4 });
};
const sol = (s) => `${Number(s || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`;
const txLink = (tx, label) => (tx?.url ? `<a href="${esc(tx.url)}" target="_blank" rel="noopener" class="ac-mono" title="${esc(tx.signature)}">${esc(label || short(tx.signature))}</a>` : '');
const legLabel = (kind) => ENGINE_LEGS.find((l) => l.kind === kind)?.label || kind.replace(/_/g, ' ');
const modeLabel = (l) => (l.mode === 'lottery' ? `lottery, ${l.recipients ?? 3} winners` : `top ${l.recipients ?? 10} holders by size`);

// ── 3D agent: reacts to what the engine just did ─────────────────────────────

async function mountStage(coin) {
	const key = coin.agent_id;
	if (state.stage?.key === key) return;
	els.stage.querySelector('agent-3d')?.remove();
	state.stage = { key, el: null };
	try {
		await import('./element.js');
	} catch {
		els.stage.classList.add('is-empty');
		return;
	}
	if (state.stage?.key !== key) return;
	const el = document.createElement('agent-3d');
	el.setAttribute('agent-id', coin.agent_id);
	el.setAttribute('mode', 'inline');
	el.setAttribute('controls', 'orbit');
	el.setAttribute('aria-label', `${coin.agent_name || 'The agent'}, ${sym(coin)}'s agent`);
	els.stage.prepend(el);
	state.stage.el = el;
}

function eventSentence(e, coin) {
	if (e.kind === 'buyback_burn') {
		return e.burned ? `Burned ${tokens(e.burned)} ${sym(coin)}` : `Bought back ${usd(e.usd)} of ${sym(coin)}`;
	}
	if (e.kind === 'holder_rewards') return `Sent ${sol(e.sol)} to ${e.recipients.length} holder${e.recipients.length === 1 ? '' : 's'}`;
	return `Bought ${usd(e.usd)} of ${sym(coin)}`;
}

function react(events, coin, { fresh }) {
	const el = state.stage?.el;
	const latest = events[0];
	const recent = latest && Date.now() - new Date(latest.at).getTime() < 86_400_000;
	try {
		el?.setMood?.(recent ? 0.7 : 0.15, recent ? 0.6 : 0.25);
		if (fresh && latest) el?.wave?.();
	} catch (err) {
		console.warn('[coin-control] avatar reaction failed', err?.message);
	}
	if (latest && (fresh || recent)) {
		els.caption.textContent = `${eventSentence(latest, coin)}, ${relTime(latest.at)}`;
		els.caption.hidden = false;
	} else {
		els.caption.hidden = true;
	}
}

// ── loading ──────────────────────────────────────────────────────────────────

function readKey() {
	const p = new URLSearchParams(location.search);
	const agent = p.get('agent');
	const network = p.get('network') === 'devnet' ? 'devnet' : 'mainnet';
	return agent ? { agent_id: agent, network } : null;
}

async function bootOwner() {
	show('skel');
	const res = await call(`${CC}/coins`);
	if (res.status === 401) return showAuth();
	if (!res.ok) return showError(res.message, bootOwner);
	state.coins = res.data.coins || [];
	if (!state.coins.length) return show('nocoin');
	const want = readKey();
	const pick = (want && state.coins.find((c) => c.agent_id === want.agent_id && c.network === want.network)) || state.coins[0];
	state.key = { agent_id: pick.agent_id, network: pick.network };
	els.coin.innerHTML = state.coins.map((c) => {
		const v = `${c.agent_id}|${c.network}`;
		return `<option value="${esc(v)}" ${c === pick ? 'selected' : ''}>${esc(c.symbol ? `$${c.symbol}` : c.name || short(c.mint))} · ${esc(c.agent_name || 'Agent')}${c.network === 'devnet' ? ' (devnet)' : ''}</option>`;
	}).join('');
	els.controls.hidden = false;
	await loadOverview();
}

async function loadOverview({ quiet = false } = {}) {
	if (!quiet) { clearError(); show('skel'); }
	const q = new URLSearchParams({ agent_id: state.key.agent_id, network: state.key.network });
	const res = await call(`${CC}/overview?${q}`);
	if (res.status === 401) return showAuth();
	if (!res.ok) {
		if (quiet) return;
		show('main');
		return showError(res.message, () => loadOverview());
	}
	clearError();
	render(res.data);
}

async function loadPublic({ quiet = false } = {}) {
	if (!quiet) show('skel');
	const res = await call(`${CC}/public/${encodeURIComponent(state.mint)}`, { anonymous: true });
	if (!res.ok) {
		if (quiet) return;
		if (res.status === 404) {
			show('main');
			els.main.innerHTML = `<div class="ac-empty"><div class="ac-empty-icon" aria-hidden="true">🔍</div><h3>No coin here</h3><p>${esc(res.message)} Check the address, or browse coins launched through three.ws.</p><a class="ac-btn ac-btn-primary" href="/launches">See launches</a></div>`;
			return;
		}
		show('main');
		return showError(res.message, () => loadPublic());
	}
	clearError();
	render(res.data);
}

function showAuth() {
	show('auth');
	els.login.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

function startPolling() {
	clearInterval(state.pollTimer);
	state.pollTimer = setInterval(() => {
		if (document.hidden || state.busy.size || !els.ruleForm.hidden || !els.bountyForm.hidden) return;
		if (state.mode === 'public') loadPublic({ quiet: true });
		else if (state.key) loadOverview({ quiet: true });
	}, POLL_MS);
}

// ── render ───────────────────────────────────────────────────────────────────

function render(d) {
	const firstForCoin = state.data?.coin?.mint !== d.coin.mint;
	state.data = d;
	const coin = d.coin;
	const owner = state.mode === 'owner';
	document.title = `${sym(coin)} Coin Control · three.ws`;
	els.title.textContent = `${sym(coin)} Coin Control`;
	els.crumb.textContent = coin.symbol ? `$${coin.symbol}` : 'Coin Control';
	if (!owner) {
		els.lede.textContent = `What ${coin.agent_name || 'this agent'} does with ${sym(coin)}'s creator fees. Every buyback, burn and holder reward below is a Solana transaction you can check.`;
	}
	renderBadges(d);
	renderStats(d);
	renderEngine(d);
	renderEvents(d);
	renderSplit(d);
	renderBounties(d);
	els.holdersPanel.hidden = !owner;
	if (owner) {
		const pub = new URL(d.public_url, location.origin).href;
		els.publicLink.href = pub;
		els.copyPublic.dataset.url = pub;
		history.replaceState(null, '', `${location.pathname}?agent=${coin.agent_id}&network=${coin.network}`);
	}
	show('main');
	if (firstForCoin) {
		state.topEvent = d.events[0]?.id ?? null;
		mountStage(coin).then(() => react(d.events, coin, { fresh: false }));
	} else {
		const fresh = (d.events[0]?.id ?? null) !== state.topEvent;
		state.topEvent = d.events[0]?.id ?? null;
		react(d.events, coin, { fresh });
		if (fresh) announce(`New engine action: ${eventSentence(d.events[0], coin)}`);
	}
}

function renderBadges(d) {
	const coin = d.coin;
	const x = state.mode === 'owner' ? d.x : d.creator_x;
	const parts = [];
	if (coin.network === 'devnet') parts.push('<span class="ac-badge-devnet">Devnet</span>');
	parts.push(`<a class="cc-chip" href="/launches/${esc(coin.mint)}" title="${esc(coin.mint)}">${esc(coin.name || sym(coin))} · <span class="ac-mono">${esc(short(coin.mint))}</span></a>`);
	if (x?.verified) {
		parts.push(`<a class="cc-chip cc-chip-ok" href="https://x.com/${encodeURIComponent(x.username)}" target="_blank" rel="noopener" title="The creator proved they control this X account">✓ Creator on X: @${esc(x.username)}</a>`);
	} else if (state.mode === 'owner') {
		parts.push('<a class="cc-chip cc-chip-warn" href="/api/auth/x/connect?scope=read&amp;return_to=%2Fcoin-control">Verify your X account</a>');
	} else {
		parts.push('<span class="cc-chip">Creator has not verified an X account</span>');
	}
	els.badges.innerHTML = parts.join('');
}

function renderStats(d) {
	const t = d.totals;
	const coin = d.coin;
	const tiles = [
		{ k: 'Bought back', v: usd(t.bought_back_usd), s: `${t.buyback_runs} buy${t.buyback_runs === 1 ? '' : 's'} from the agent wallet` },
		{ k: 'Burned', v: `${tokens(t.burned)} <span class="cc-unit">${esc(sym(coin))}</span>`, s: t.burns_pending ? `${t.burns_pending} burn${t.burns_pending === 1 ? '' : 's'} settling` : 'Removed from supply for good' },
		{ k: 'Paid to holders', v: sol(t.rewarded_sol), s: `${t.rewards_sent} payment${t.rewards_sent === 1 ? '' : 's'} over ${t.reward_runs} run${t.reward_runs === 1 ? '' : 's'}` },
	];
	if (state.mode === 'owner') {
		const e = d.earnings;
		tiles.push(e
			? { k: 'Agent revenue', v: usd(e.revenue_usd), s: e.unclaimed_creator_fees?.length ? `${e.unclaimed_creator_fees.length} unclaimed creator fee balance${e.unclaimed_creator_fees.length === 1 ? '' : 's'}. <a href="/earnings?agent=${esc(coin.agent_id)}">Open earnings</a>` : `<a href="/earnings?agent=${esc(coin.agent_id)}">Every source in the earnings ledger</a>` }
			: { k: 'Agent revenue', v: '<span class="ac-hint">Unavailable</span>', s: 'The ledger could not be read right now.' });
		tiles.push({
			k: 'Agent wallet',
			v: d.wallet.sol == null ? '<span class="ac-hint">Unavailable</span>' : sol(d.wallet.sol),
			s: d.wallet.address ? `<span class="ac-mono">${esc(short(d.wallet.address))}</span> pays every action` : 'This agent has no Solana wallet yet.',
		});
	}
	els.stats.innerHTML = tiles.map((t2) => `<div class="er-stat"><dt>${esc(t2.k)}</dt><dd>${t2.v}</dd><small>${t2.s}</small></div>`).join('');
}

function renderSplit(d) {
	const f = d.fee_split;
	const onchain = d.coin.onchain_buyback_bps;
	els.split.innerHTML = `
		<p class="cc-big">${(f.creator_share_bps / 100).toLocaleString()}% <span class="ac-hint">of creator fees go to the creator</span></p>
		<p class="ac-hint">${esc(f.sentence)}</p>
		${onchain ? `<p class="ac-hint">Set at launch: ${(onchain / 100).toLocaleString()}% of fees go to the coin's own on-chain buyback.</p>` : ''}
		${state.mode === 'owner' ? '<p class="ac-hint"><a href="/creator/payouts">Creator payouts</a> shows each fee claim and where it went.</p>' : ''}`;
}

// ── engine (rules) ───────────────────────────────────────────────────────────

function renderEngine(d) {
	const owner = state.mode === 'owner';
	els.newRule.hidden = !owner;
	els.presets.hidden = !owner;
	if (!owner) {
		els.engineHint.textContent = 'What the creator has switched on. Each runs once per period on the fees the agent earned.';
		els.rules.innerHTML = d.engine.length
			? `<ul class="cc-rule-list">${d.engine.map((l) => `<li class="cc-rule-pub"><strong>${l.pct}%</strong> ${esc(legLabel(l.kind))}${l.kind === 'holder_rewards' ? ` <span class="ac-hint">(${esc(modeLabel(l))})</span>` : ''} <span class="ac-hint">every ${esc(periodNoun(l.period))}, on since ${esc(new Date(l.since).toLocaleDateString())}</span></li>`).join('')}</ul>`
			: '<p class="ac-empty-inline">The creator has not switched on any buyback, burn or holder reward yet.</p>';
		return;
	}
	els.engineHint.textContent = `Rules run after each complete period on what ${d.coin.agent_name || 'the agent'} earned, within the caps you set. Nothing runs until you confirm the exact terms.`;
	els.presets.innerHTML = `<span class="ac-hint">Start from:</span>${PRESETS.map((p) => `<button type="button" class="ac-btn ac-btn-sm" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}`;
	const rules = d.rules.filter((r) => r.legs.some((l) => ENGINE_KINDS.has(l.kind)));
	if (!rules.length) {
		els.rules.innerHTML = `<div class="ac-empty-inline">No engine rule yet. Pick a starting point above, or create one from scratch. You will see exactly what it would send before anything is switched on.</div>`;
		return;
	}
	els.rules.innerHTML = rules.map(ruleCard).join('');
	for (const [id, p] of state.previews) {
		const card = els.rules.querySelector(`[data-rule="${id}"]`);
		const rule = rules.find((r) => r.id === id);
		if (card && rule) card.querySelector('[data-slot="preview"]').innerHTML = previewHtml(rule, p);
	}
}

const periodNoun = (p) => ({ daily: 'day', weekly: 'week', monthly: 'month' }[p] || p);

function ruleStatus(r) {
	if (r.status === 'active' && r.confirmed) return '<span class="cc-pill cc-pill-ok">Running</span>';
	if (r.status === 'paused') return `<span class="cc-pill cc-pill-warn">Paused</span>${r.paused_reason ? ` <span class="ac-hint">${esc(r.paused_reason)}</span>` : ''}`;
	return '<span class="cc-pill">Waiting for your confirmation</span>';
}

function ruleCard(r) {
	const engineOnly = r.legs.every((l) => ENGINE_KINDS.has(l.kind));
	const legs = r.legs.map((l) => `<li><strong>${l.pct}%</strong> ${esc(ENGINE_KINDS.has(l.kind) ? legLabel(l.kind) : l.kind.replace(/_/g, ' '))}${l.kind === 'holder_rewards' ? ` <span class="ac-hint">(${esc(modeLabel(l))})</span>` : ''}</li>`).join('');
	return `<article class="ac-card cc-rule" data-rule="${esc(r.id)}">
		<div class="cc-rule-head"><h3 class="ac-section-title">${esc(r.name)}</h3>${ruleStatus(r)}</div>
		<ul class="cc-legs">${legs}</ul>
		<p class="ac-hint">Every ${esc(periodNoun(r.period))}. At most ${usd(r.per_run_cap_usd)} a run and ${usd(r.lifetime_cap_usd)} in total; runs under ${usd(r.min_run_usd)} are skipped.</p>
		<div class="er-actions">
			<button type="button" class="ac-btn ac-btn-sm ${r.confirmed ? '' : 'ac-btn-primary'}" data-act="review">${r.confirmed ? 'See terms' : 'Review and confirm'}</button>
			<button type="button" class="ac-btn ac-btn-sm" data-act="test" title="Plans a run against last period without moving anything">Test run</button>
			${r.status === 'active' && r.confirmed ? '<button type="button" class="ac-btn ac-btn-sm" data-act="pause">Pause</button>' : ''}
			${engineOnly ? '<button type="button" class="ac-btn ac-btn-sm" data-act="edit">Edit</button>' : `<a class="ac-btn ac-btn-sm" href="/earnings?agent=${esc(r.agent_id)}" title="This rule also funds other things, so it is edited in the earnings console">Edit in earnings</a>`}
			<button type="button" class="ac-btn ac-btn-sm ac-btn-danger" data-act="delete">Delete</button>
		</div>
		<p class="ac-form-msg" data-slot="msg" role="status"></p>
		<div data-slot="preview"></div>
	</article>`;
}

function previewHtml(rule, p) {
	const rows = p.confirmation.map((c) => `<tr>
		<td>${esc(c.label)}<br><span class="ac-hint">${c.pct}%</span></td>
		<td>${esc(c.asset)} on Solana ${esc(c.network)}</td>
		<td>${c.recipient ? `<span class="ac-mono">${esc(c.recipient)}</span>` : '<span class="er-neg">Not available</span>'}<br><span class="ac-hint">${esc(c.recipient_label)}</span></td>
		<td class="er-r ac-num">${usd(c.would_send_usd)}</td>
	</tr>`).join('');
	const ready = p.confirmation.every((c) => c.ready);
	return `<div class="cc-terms">
		<h4>${rule.confirmed ? 'Confirmed terms' : 'Confirm these exact terms'}</h4>
		<div class="er-ledger"><table class="er-confirm"><thead><tr><th scope="col">What</th><th scope="col">Asset and chain</th><th scope="col">Goes to</th><th scope="col" class="er-r">Would send (last period)</th></tr></thead><tbody>${rows}</tbody></table></div>
		<p class="ac-hint">Last period's income was ${usd(p.base_usd)}: ${usd(p.plan.executable_usd)} would go to the engine and ${usd(p.plan.kept_usd)} stays with the agent.${p.plan.scaled ? ' The caps scaled it down.' : ''}${p.plan.skip ? ` This period would send nothing: ${esc(p.plan.skip)}` : ''}</p>
		<p class="ac-hint">${esc(p.note)}</p>
		${rule.confirmed ? '' : `<div class="ac-form-foot"><button type="button" class="ac-btn ac-btn-primary" data-act="confirm" ${ready ? '' : 'disabled'}>I confirm: run this every ${esc(periodNoun(rule.period))}</button>${ready ? '' : '<span class="ac-hint">A destination above is not available yet.</span>'}</div>`}
	</div>`;
}

function ruleMsg(card, msg, bad) {
	const slot = card.querySelector('[data-slot="msg"]');
	slot.textContent = msg;
	slot.classList.toggle('is-bad', Boolean(bad));
	announce(msg);
}

async function ruleAction(card, act) {
	const id = card.dataset.rule;
	const rule = state.data.rules.find((r) => r.id === id);
	if (!rule || state.busy.has(id)) return;
	if (act === 'edit') return openRuleForm(rule);
	if (act === 'delete' && !window.confirm(`Delete "${rule.name}"? Its run history goes with it. Actions already on chain stay on the proof page.`)) return;
	state.busy.add(id);
	card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
	try {
		if (act === 'review') {
			const res = await call(`${REV}/rules/${id}/preview`);
			if (!res.ok) return ruleMsg(card, res.message, true);
			state.previews.set(id, res.data);
			card.querySelector('[data-slot="preview"]').innerHTML = previewHtml(rule, res.data);
			card.querySelector('[data-act="confirm"]')?.focus();
		} else if (act === 'confirm') {
			const p = state.previews.get(id);
			const res = await call(`${REV}/rules/${id}/confirm`, { method: 'POST', body: { hash: p?.rule?.hash || rule.hash } });
			if (!res.ok) {
				if (res.code === 'rule_changed') state.previews.delete(id);
				return ruleMsg(card, res.code === 'rule_changed' ? 'This rule changed since you reviewed it. Review the new terms and confirm again.' : res.message, true);
			}
			state.previews.delete(id);
			flash(`"${rule.name}" is running. It acts after each complete ${periodNoun(rule.period)}.`);
			await loadOverview({ quiet: true });
		} else if (act === 'pause') {
			const res = await call(`${REV}/rules/${id}/pause`, { method: 'POST', body: {} });
			if (!res.ok) return ruleMsg(card, res.message, true);
			flash(`"${rule.name}" is paused.`);
			await loadOverview({ quiet: true });
		} else if (act === 'test') {
			const res = await call(`${REV}/rules/${id}/test-run`, { method: 'POST', body: {} });
			if (!res.ok) return ruleMsg(card, res.message, true);
			const r = res.data;
			ruleMsg(card, r.skipped ? `Test run: nothing would run (${r.reason || 'no income in the last period'}).` : `Test run: ${usd(r.run?.executed_usd)} of ${usd(r.run?.planned_usd)} planned would run. Nothing was sent.`);
		} else if (act === 'delete') {
			const res = await call(`${REV}/rules/${id}`, { method: 'DELETE' });
			if (!res.ok) return ruleMsg(card, res.message, true);
			state.previews.delete(id);
			flash(`Deleted "${rule.name}".`);
			await loadOverview({ quiet: true });
		}
	} finally {
		state.busy.delete(id);
		card.querySelectorAll('button').forEach((b) => { b.disabled = false; });
	}
}

function openRuleForm(rule = null, preset = null) {
	state.editing = rule?.id || null;
	const legs = rule?.legs || preset?.legs || [];
	const legOf = (k) => legs.find((l) => l.kind === k);
	const hr = legOf('holder_rewards');
	const f = els.ruleForm;
	f.innerHTML = `
		<h3 class="ac-section-title" style="margin:0">${rule ? 'Edit engine rule' : 'New engine rule'}</h3>
		${rule?.confirmed ? '<div class="ac-notice ac-notice-warn" style="margin:0">Saving a change stops this rule until you confirm the new terms.</div>' : ''}
		<div class="ac-inline">
			<div class="ac-field"><label for="cr-name">Name</label><input id="cr-name" maxlength="80" required value="${esc(rule?.name || preset?.label || `${sym(state.data.coin)} engine`)}" /></div>
			<div class="ac-field"><label for="cr-period">Runs every</label><select id="cr-period">${['daily', 'weekly', 'monthly'].map((p) => `<option value="${p}" ${(rule?.period || 'weekly') === p ? 'selected' : ''}>${periodNoun(p)}</option>`).join('')}</select></div>
			<div class="ac-field"><label for="cr-basis">Income counted</label><select id="cr-basis"><option value="revenue" ${rule?.basis !== 'revenue_and_trading_profit' ? 'selected' : ''}>Revenue only</option><option value="revenue_and_trading_profit" ${rule?.basis === 'revenue_and_trading_profit' ? 'selected' : ''}>Revenue plus trading profit</option></select></div>
		</div>
		<fieldset class="cc-fieldset"><legend>Share of each period's income</legend>
			${ENGINE_LEGS.map((l) => `
			<div class="cc-leg-row">
				<div><label for="cr-pct-${l.kind}">${esc(l.label)}</label><small>${esc(l.hint)}</small></div>
				<div class="cc-pct"><input id="cr-pct-${l.kind}" inputmode="decimal" autocomplete="off" placeholder="0" value="${legOf(l.kind)?.pct ?? ''}" /><span aria-hidden="true">%</span></div>
			</div>
			${l.kind === 'holder_rewards' ? `<div class="cc-leg-opts ac-inline">
				<div class="ac-field"><label for="cr-hr-mode">Split</label><select id="cr-hr-mode"><option value="pro_rata" ${hr?.mode !== 'lottery' ? 'selected' : ''}>By holding size</option><option value="lottery" ${hr?.mode === 'lottery' ? 'selected' : ''}>Weighted lottery</option></select></div>
				<div class="ac-field"><label for="cr-hr-n">Holders paid (1 to 20)</label><input id="cr-hr-n" inputmode="numeric" value="${hr?.recipients ?? (hr?.mode === 'lottery' ? 3 : 10)}" /></div>
			</div>` : ''}`).join('')}
			<small id="cr-keep"></small>
		</fieldset>
		<div class="ac-inline">
			<div class="ac-field"><label for="cr-per">Cap per run (USD)</label><input id="cr-per" inputmode="decimal" required value="${rule?.per_run_cap_usd ?? 25}" /></div>
			<div class="ac-field"><label for="cr-life">Lifetime cap (USD)</label><input id="cr-life" inputmode="decimal" required value="${rule?.lifetime_cap_usd ?? 250}" /></div>
			<div class="ac-field"><label for="cr-min">Skip runs under (USD)</label><input id="cr-min" inputmode="decimal" value="${rule?.min_run_usd ?? 1}" /></div>
		</div>
		<div class="ac-form-foot"><button type="submit" class="ac-btn ac-btn-primary">${rule ? 'Save changes' : 'Create rule'}</button><button type="button" class="ac-btn" data-cancel>Cancel</button><span class="ac-form-msg" id="cr-msg" role="alert"></span></div>`;
	f.hidden = false;
	updateKeep();
	f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	$('cr-name').focus();
}

function updateKeep() {
	const total = ENGINE_LEGS.reduce((a, l) => a + (Number($(`cr-pct-${l.kind}`)?.value) || 0), 0);
	const keep = $('cr-keep');
	if (!keep) return;
	keep.textContent = total > 100 ? `Over by ${Math.round((total - 100) * 100) / 100}%. The shares must add up to 100% or less.` : `The agent keeps ${Math.round((100 - total) * 100) / 100}%.`;
	keep.classList.toggle('is-bad', total > 100);
}

async function submitRule(e) {
	e.preventDefault();
	const msg = $('cr-msg');
	msg.textContent = '';
	const legs = ENGINE_LEGS.map((l) => ({ kind: l.kind, pct: Number($(`cr-pct-${l.kind}`).value) })).filter((l) => l.pct > 0);
	if (!legs.length) { msg.textContent = 'Give at least one action a share above 0%.'; return; }
	const rewards = legs.find((l) => l.kind === 'holder_rewards');
	if (rewards) {
		rewards.mode = $('cr-hr-mode').value;
		rewards.recipients = Number($('cr-hr-n').value);
	}
	const body = {
		name: $('cr-name').value, period: $('cr-period').value, basis: $('cr-basis').value, network: state.data.coin.network, legs,
		per_run_cap_usd: Number($('cr-per').value), lifetime_cap_usd: Number($('cr-life').value), min_run_usd: Number($('cr-min').value || 0),
	};
	const btn = els.ruleForm.querySelector('[type="submit"]');
	btn.disabled = true;
	const res = state.editing
		? await call(`${REV}/rules/${state.editing}`, { method: 'PATCH', body })
		: await call(`${REV}/rules`, { method: 'POST', body: { ...body, agent_id: state.data.coin.agent_id } });
	btn.disabled = false;
	if (!res.ok) { msg.textContent = res.message; return; }
	const id = res.data.rule?.id;
	els.ruleForm.hidden = true;
	if (id) state.previews.delete(id);
	flash(state.editing ? 'Saved. Review and confirm the new terms to switch it back on.' : 'Rule created. Review and confirm its terms to switch it on.');
	state.editing = null;
	await loadOverview({ quiet: true });
	const card = id && els.rules.querySelector(`[data-rule="${id}"]`);
	if (card) ruleAction(card, 'review');
}

// ── events ───────────────────────────────────────────────────────────────────

function eventHtml(e, coin) {
	const when = `<time datetime="${esc(e.at)}" title="${esc(new Date(e.at).toLocaleString())}">${esc(relTime(e.at))}</time>`;
	if (e.kind === 'buyback_burn') {
		const burn = e.burn_state === 'burned'
			? `Burned ${tokens(e.burned)} ${esc(sym(coin))} ${txLink(e.burn_tx, 'burn tx')}`
			: e.burn_state === 'skipped'
				? `<span class="ac-hint">No burn: ${esc(e.burn_note || 'the buy returned no tokens')}</span>`
				: '<span class="ac-hint">Burn settling. It retries automatically.</span>';
		return `<li class="cc-ev cc-ev-burn"><span class="cc-ev-icon" aria-hidden="true">🔥</span><div><strong>Bought back ${usd(e.usd)}</strong> ${txLink(e.buy_tx, 'buy tx')}<br>${burn}</div>${when}</li>`;
	}
	if (e.kind === 'holder_rewards') {
		const who = e.recipients.map((r) => `<li><span class="ac-mono">${esc(short(r.owner))}</span> ${esc(sol(r.sol))} ${txLink(r.tx, 'tx')}</li>`).join('');
		const lot = e.lottery
			? `<details class="cc-lottery"><summary>Check the draw</summary><p class="ac-hint">Winners were drawn from the top ${e.lottery.pool_size} holders, weighted by balance, using seed sha256("${esc(e.lottery.leg_key)}|${esc(e.lottery.blockhash)}"):</p><p class="ac-mono">${esc(e.lottery.seed)}</p><p class="ac-hint">The blockhash was fixed by the chain before the draw, so nobody could pick it.</p></details>`
			: '';
		return `<li class="cc-ev cc-ev-reward"><span class="cc-ev-icon" aria-hidden="true">💸</span><div><strong>Sent ${esc(sol(e.sol))} to ${e.recipients.length} holder${e.recipients.length === 1 ? '' : 's'}</strong> <span class="ac-hint">${e.mode === 'lottery' ? 'lottery' : 'by holding size'}</span>${e.not_sent ? ` <span class="ac-hint">(${e.not_sent} not sent)</span>` : ''}<ul class="cc-recips">${who}</ul>${lot}</div>${when}</li>`;
	}
	return `<li class="cc-ev"><span class="cc-ev-icon" aria-hidden="true">🛒</span><div><strong>Bought ${usd(e.usd)} and held</strong> ${txLink(e.buy_tx, 'buy tx')}</div>${when}</li>`;
}

function renderEvents(d) {
	els.events.innerHTML = d.events.length
		? d.events.map((e) => eventHtml(e, d.coin)).join('')
		: `<li class="ac-empty-inline">${state.mode === 'owner' ? 'Nothing yet. Once a confirmed rule runs, every buyback, burn and reward shows up here and on your public page.' : 'The engine has not acted yet. Every buyback, burn and reward will show up here with its transaction.'}</li>`;
}

async function loadHolders() {
	els.holders.innerHTML = '<div class="er-skel" style="height:120px"></div>';
	const q = new URLSearchParams(state.key);
	const res = await call(`${CC}/holders?${q}`);
	if (!res.ok) {
		els.holders.innerHTML = `<p class="er-neg">${esc(res.message)}</p><button type="button" class="ac-btn ac-btn-sm" id="cc-load-holders">Try again</button>`;
		return;
	}
	const { holders, eligible } = res.data;
	if (!holders.length) {
		els.holders.innerHTML = '<p class="ac-empty-inline">No wallet besides yours and the curve holds the coin yet, so a reward would reach nobody.</p>';
		return;
	}
	const scale = 10 ** (state.data.coin.decimals ?? 6);
	const top = Number(holders[0].amount) || 1;
	els.holders.innerHTML = `<p class="ac-hint">${eligible} eligible wallet${eligible === 1 ? '' : 's'}. Top ${holders.length}:</p>
		<ol class="cc-holders">${holders.map((h) => `<li><a class="ac-mono" href="https://solscan.io/account/${esc(h.owner)}${state.key.network === 'devnet' ? '?cluster=devnet' : ''}" target="_blank" rel="noopener" title="${esc(h.owner)}">${esc(short(h.owner))}</a><span class="cc-bar" style="--w:${Math.max(2, Math.round((Number(h.amount) / top) * 100))}%"></span><span class="ac-num">${tokens(Number(h.amount) / scale)}</span></li>`).join('')}</ol>`;
}

// ── bounties ─────────────────────────────────────────────────────────────────

function renderBounties(d) {
	const owner = state.mode === 'owner';
	els.newBounty.hidden = !owner;
	els.bountiesHint.textContent = owner
		? 'Ask for something (a video, a meme, a feature) and pay the best submission in SOL from the agent wallet. Bounties also appear on the public bounty board.'
		: `Work the creator is paying for in SOL. Submit on the bounty board.`;
	if (!d.bounties.length) {
		els.bounties.innerHTML = `<p class="ac-empty-inline">${owner ? 'No bounties yet. Post one to get your holders making things for the coin.' : 'No open bounties right now.'}</p>`;
		return;
	}
	els.bounties.innerHTML = d.bounties.map((b) => bountyCard(b, owner)).join('');
}

function bountyState(b) {
	if (b.payout?.state === 'paid') return `<span class="cc-pill cc-pill-ok">Paid</span> ${txLink(b.payout.tx, 'payout tx')}`;
	if (b.payout?.state === 'awaiting_approval') return `<span class="cc-pill cc-pill-warn">Waiting for your approval</span> <a href="${esc(b.payout.approval_link)}">Open approval</a>`;
	if (b.status === 'open') return `<span class="cc-pill">Open</span> <span class="ac-hint">until ${esc(new Date(b.expires_at).toLocaleDateString())}</span>`;
	return `<span class="cc-pill">${esc(b.status)}</span>`;
}

function bountyCard(b, owner) {
	const subs = owner && b.submissions?.length
		? `<ul class="cc-subs">${b.submissions.map((s) => `<li data-sub="${esc(s.id)}">
			<div><strong>${esc(s.username || 'Someone')}</strong> <span class="ac-hint">${esc(relTime(s.created_at))}</span>${s.status === 'accepted' ? ' <span class="cc-pill cc-pill-ok">Winner</span>' : ''}
			<p>${esc(s.content || '')}</p>${s.media_url ? `<a href="${esc(s.media_url)}" target="_blank" rel="noopener">Open their ${esc(s.media_type || 'file')}</a>` : ''}
			${!s.payout_address && b.status === 'open' ? '<p class="ac-hint">No Solana wallet linked, so they cannot be paid yet.</p>' : ''}</div>
			${b.status === 'open' && s.payout_address ? `<button type="button" class="ac-btn ac-btn-sm" data-pay="${esc(s.id)}">Pay ${esc(sol(b.reward_sol))}</button>` : ''}
			<div class="cc-pay" data-slot="pay"></div>
		</li>`).join('')}</ul>`
		: owner ? '<p class="ac-hint">No submissions yet.</p>' : '';
	return `<article class="ac-card cc-bounty" data-bounty="${esc(b.id)}">
		<div class="cc-rule-head"><h3 class="ac-section-title"><a href="${esc(b.board_url)}">${esc(b.title)}</a></h3><span class="cc-reward">${esc(sol(b.reward_sol))}${b.reward_usd ? ` <span class="ac-hint">(${usd(b.reward_usd)})</span>` : ''}</span></div>
		${b.description ? `<p class="cc-desc">${esc(b.description)}</p>` : ''}
		<p>${bountyState(b)} <span class="ac-hint">· ${b.submission_count} submission${b.submission_count === 1 ? '' : 's'}</span></p>
		${subs}
	</article>`;
}

async function previewPayout(li, bountyId, subId) {
	const slot = li.querySelector('[data-slot="pay"]');
	const btn = li.querySelector('[data-pay]');
	btn.disabled = true;
	slot.innerHTML = '<div class="er-skel" style="height:90px"></div>';
	const res = await call(`${CC}/bounties/${bountyId}/payout/preview`, { method: 'POST', body: { submission_id: subId } });
	btn.disabled = false;
	if (!res.ok) { slot.innerHTML = `<p class="er-neg" role="alert">${esc(res.message)}</p>`; return; }
	const p = res.data;
	state.payouts.set(subId, p);
	const c = p.confirmation;
	slot.innerHTML = `<div class="cc-terms">
		<h4>Confirm this payment</h4>
		<table class="er-confirm"><tbody>
			<tr><th scope="row">To</th><td><strong>${esc(p.winner.username || 'Winner')}</strong><br><span class="ac-mono">${esc(c.recipient)}</span></td></tr>
			<tr><th scope="row">Amount</th><td>${esc(c.amount)}${c.usd != null ? ` <span class="ac-hint">(${usd(c.usd)})</span>` : ''}</td></tr>
			<tr><th scope="row">Chain</th><td>${esc(c.chain)}</td></tr>
			<tr><th scope="row">From</th><td>The agent wallet</td></tr>
		</tbody></table>
		<p class="ac-hint">${esc(p.route_detail)}</p>
		${p.blocked
			? `<p class="er-neg" role="alert">${esc(p.blocked.message)}</p>`
			: `<div class="ac-form-foot"><button type="button" class="ac-btn ac-btn-primary" data-confirm-pay="${esc(subId)}">${p.route === 'direct' ? 'Confirm and send' : 'Confirm and request approval'}</button><button type="button" class="ac-btn" data-cancel-pay>Cancel</button></div>`}
	</div>`;
	slot.querySelector('[data-confirm-pay]')?.focus();
}

async function confirmPayout(li, bountyId, subId) {
	const p = state.payouts.get(subId);
	if (!p?.preview_id || state.busy.has(bountyId)) return;
	state.busy.add(bountyId);
	const slot = li.querySelector('[data-slot="pay"]');
	slot.querySelectorAll('button').forEach((b) => { b.disabled = true; });
	try {
		const res = await call(`${CC}/bounties/${bountyId}/payout/confirm`, { method: 'POST', body: { submission_id: subId, preview_id: p.preview_id } });
		if (!res.ok) {
			slot.insertAdjacentHTML('beforeend', `<p class="er-neg" role="alert">${esc(res.message)}</p>`);
			slot.querySelectorAll('button').forEach((b) => { b.disabled = false; });
			return;
		}
		state.payouts.delete(subId);
		flash(res.data.status === 'paid'
			? `Paid ${p.confirmation.amount} to ${p.winner.username || 'the winner'}. The bounty is closed.`
			: res.data.message || 'Sent to your approvals inbox. The bounty closes when you approve it.');
		await loadOverview({ quiet: true });
	} finally {
		state.busy.delete(bountyId);
	}
}

async function submitBounty(e) {
	e.preventDefault();
	const msg = $('cb-msg');
	msg.textContent = '';
	const btn = els.bountyForm.querySelector('[type="submit"]');
	btn.disabled = true;
	const res = await call(`${CC}/bounties`, {
		method: 'POST',
		body: {
			agent_id: state.data.coin.agent_id, network: state.data.coin.network,
			title: $('cb-title').value, description: $('cb-desc').value, reward_sol: Number($('cb-reward').value), expires_in_days: Number($('cb-days').value),
		},
	});
	btn.disabled = false;
	if (!res.ok) { msg.textContent = res.message; return; }
	els.bountyForm.hidden = true;
	els.bountyForm.reset();
	flash('Bounty posted. It is on the bounty board and your public page.');
	await loadOverview({ quiet: true });
}

// ── boot ─────────────────────────────────────────────────────────────────────

function bind() {
	els.error.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) els.error._retry?.(); });
	els.coin.addEventListener('change', () => {
		const [agent_id, network] = els.coin.value.split('|');
		state.key = { agent_id, network };
		state.previews.clear();
		state.payouts.clear();
		els.ruleForm.hidden = true;
		els.bountyForm.hidden = true;
		els.holders.innerHTML = '<button type="button" class="ac-btn ac-btn-sm" id="cc-load-holders">Load holders</button>';
		loadOverview();
	});
	els.copyPublic.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(els.copyPublic.dataset.url);
			flash('Public link copied. Share it so holders can check every action.');
		} catch {
			flash(`Copy this link: ${els.copyPublic.dataset.url}`);
		}
	});
	els.newRule.addEventListener('click', () => openRuleForm());
	els.presets.addEventListener('click', (e) => {
		const b = e.target.closest('[data-preset]');
		if (b) openRuleForm(null, PRESETS.find((p) => p.id === b.dataset.preset));
	});
	els.ruleForm.addEventListener('input', updateKeep);
	els.ruleForm.addEventListener('submit', submitRule);
	els.ruleForm.addEventListener('click', (e) => {
		if (e.target.closest('[data-cancel]')) { els.ruleForm.hidden = true; state.editing = null; }
	});
	els.rules.addEventListener('click', (e) => {
		const b = e.target.closest('button[data-act]');
		if (b) ruleAction(b.closest('[data-rule]'), b.dataset.act);
	});
	els.holdersPanel.addEventListener('click', (e) => { if (e.target.closest('#cc-load-holders')) loadHolders(); });
	els.newBounty.addEventListener('click', () => {
		els.bountyForm.hidden = false;
		$('cb-title').focus();
	});
	els.bountyForm.addEventListener('submit', submitBounty);
	els.bountyForm.addEventListener('click', (e) => { if (e.target.closest('[data-cancel]')) els.bountyForm.hidden = true; });
	els.bounties.addEventListener('click', (e) => {
		const li = e.target.closest('[data-sub]');
		const card = e.target.closest('[data-bounty]');
		if (!li || !card) return;
		if (e.target.closest('[data-pay]')) previewPayout(li, card.dataset.bounty, li.dataset.sub);
		else if (e.target.closest('[data-confirm-pay]')) confirmPayout(li, card.dataset.bounty, li.dataset.sub);
		else if (e.target.closest('[data-cancel-pay]')) {
			state.payouts.delete(li.dataset.sub);
			li.querySelector('[data-slot="pay"]').innerHTML = '';
		}
	});
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && state.data) {
			if (state.mode === 'public') loadPublic({ quiet: true });
			else if (state.key) loadOverview({ quiet: true });
		}
	});
}

function xOutcome() {
	const p = new URLSearchParams(location.search);
	const x = p.get('x');
	if (!x) return;
	if (x === 'connected') flash('Your X account is verified. Holders now see it on your public page.');
	else if (x === 'denied') showError('X sign-in was cancelled, so your account is not verified. Try again whenever you like.');
	else if (x === 'unconfigured') showError('X verification is not available right now. Try again later.');
	else showError('X verification did not finish. Try again.');
}

function init() {
	Object.assign(els, {
		title: $('cc-title'), lede: $('cc-lede'), crumb: $('cc-crumb'), badges: $('cc-badges'), stage: $('cc-stage'), caption: $('cc-caption'),
		live: $('cc-live'), error: $('cc-error'), flash: $('cc-flash'), auth: $('cc-auth'), login: $('cc-login'), nocoin: $('cc-nocoin'),
		skel: $('cc-skel'), main: $('cc-main'), controls: $('cc-controls'), coin: $('cc-coin'), copyPublic: $('cc-copy-public'), publicLink: $('cc-public-link'),
		stats: $('cc-stats'), engineHint: $('cc-engine-hint'), newRule: $('cc-new-rule'), presets: $('cc-presets'), ruleForm: $('cc-rule-form'), rules: $('cc-rules'),
		events: $('cc-events'), holdersPanel: $('cc-holders-panel'), holders: $('cc-holders'), split: $('cc-split'),
		bountiesHint: $('cc-bounties-hint'), newBounty: $('cc-new-bounty'), bountyForm: $('cc-bounty-form'), bounties: $('cc-bounties'),
	});
	bind();
	const m = location.pathname.match(/^\/coin-control\/([^/]+)\/?$/);
	if (m && MINT_RE.test(m[1])) {
		state.mode = 'public';
		state.mint = m[1];
		document.body.classList.add('cc-public');
		loadPublic();
	} else {
		xOutcome();
		bootOwner();
	}
	startPolling();
}

init();
