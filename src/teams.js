// /teams and /teams/:id: specialist teams.
//
// /teams lists the caller's squads and assembles new ones (POST /api/teams
// provisions four role agents under one spend policy). /teams/:id shows the
// squad as four 3D agents, runs each specialist through /api/teams/:id/run,
// streams the shared findings board over SSE, and edits the policy.
//
// The owner's settings also hold the organisation section: claim the team's
// Microsoft Entra tenant (/api/teams/:id/enterprise), choose whether people
// from it are offered the team or auto-joined, and run SCIM provisioning with
// a per-team token (docs/enterprise-sso.md). A person from a claimed tenant
// lands on /teams/:id?join=1 with the offer (/api/teams/:id/join).
//
// Every string that came from a token or an agent (names, symbols, summaries,
// evidence) is untrusted data and goes through esc() before it touches the DOM.

import { consumeCsrfToken } from './api.js';
import { agentAvatarGlb } from './shared/agent-3d.js';
import { resolveDevR2Url } from './shared/dev-r2-proxy.js';
import { shortAddress as short } from './shared/address.js';

const ROOT = document.getElementById('tmRoot');
const CONTENT = document.getElementById('tmContent');
const REDUCED = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const FIXED = ['researcher', 'entry', 'trader', 'launcher'];
const ROLE_TITLE = { researcher: 'Researcher', entry: 'Entry', trader: 'Trader', launcher: 'Launcher', custom: 'Specialist' };
const ROLE_PITCH = {
	researcher: 'Vets a token and posts a scored verdict the whole squad cites.',
	entry: 'Scores finished launches against your entry gates and posts setups. Never trades.',
	trader: 'Quotes, simulates or trades inside the spend policy, only on research it can cite.',
	launcher: 'Prepares a launch plan for you to review and sign. Never launches on its own.',
};
const KIND_LABEL = { research: 'Research', entry_signal: 'Entry signal', trade: 'Trade', launch_prep: 'Launch prep' };
const VERDICT_TONE = {
	pass: 'good', caution: 'warn', avoid: 'bad',
	setup: 'good', no_setup: '',
	quoted: 'info', simulated: 'info', executed: 'good', refused: 'bad', failed: 'bad',
	ready: 'good', blocked: 'warn',
};
const STATUS_TONE = { active: 'good', paused: 'warn', provisioning: 'info', failed: 'bad', archived: '' };
const PERM_SHORT = {
	'findings.read': 'read board',
	'findings.write': 'post',
	'research.run': 'research',
	'signals.scan': 'scan',
	'trade.quote': 'quote',
	'trade.execute': 'sign trades',
	'launch.prepare': 'launch prep',
};
const FILTERS = [['', 'All'], ['research', 'Research'], ['entry_signal', 'Entry'], ['trade', 'Trades'], ['launch_prep', 'Launch']];
const PAGE = 30;

// ── small helpers ────────────────────────────────────────────────────────────

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const num = (n, digits = 4) => Number(n).toLocaleString(undefined, { maximumFractionDigits: digits });
const sol = (n) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : `${num(n)} SOL`);
const roleVar = (role) => `--role:var(--role-${FIXED.includes(role) ? role : 'custom'})`;

function ago(iso) {
	if (!iso) return 'never';
	const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 45) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
	return new Date(iso).toLocaleDateString();
}

function timeLeft(iso) {
	const ms = new Date(iso).getTime() - Date.now();
	if (!(ms > 0)) return null;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function api(url, { method = 'GET', body } = {}) {
	const opts = { method, credentials: 'include', headers: { accept: 'application/json' } };
	if (body !== undefined) {
		opts.headers['content-type'] = 'application/json';
		opts.body = JSON.stringify(body);
	}
	if (method !== 'GET') {
		const token = await consumeCsrfToken().catch(() => null);
		if (token) opts.headers['x-csrf-token'] = token;
	}
	let r;
	try {
		r = await fetch(url, opts);
	} catch {
		return { ok: false, status: 0, code: 'network', message: 'Could not reach three.ws. Check your connection and try again.' };
	}
	let j = null;
	try {
		j = await r.json();
	} catch {
		j = null;
	}
	if (!r.ok) {
		return {
			ok: false,
			status: r.status,
			code: j?.error || 'error',
			message: j?.error_description || j?.message || `Request failed (${r.status}).`,
			detail: j?.detail || null,
		};
	}
	return { ok: true, status: r.status, data: j?.data ?? null, body: j };
}

async function currentUser() {
	try {
		const r = await fetch('/api/auth/me', { credentials: 'include' });
		if (!r.ok) return null;
		const d = await r.json();
		return d?.user || null;
	} catch {
		return null;
	}
}

let toastTimer = 0;
function toast(msg) {
	const el = $('#tmToast');
	el.textContent = msg;
	el.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}

function confirmDialog({ title, html, okLabel = 'Confirm', tone = 'primary' }) {
	const dlg = $('#tmConfirm');
	$('#tmConfirmTitle').textContent = title;
	$('#tmConfirmBody').innerHTML = html;
	const ok = $('#tmConfirmOk');
	ok.textContent = okLabel;
	ok.className = `tm-btn ${tone}`;
	dlg.returnValue = '';
	return new Promise((resolve) => {
		dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
		dlg.showModal();
	});
}

function errorHtml(e) {
	const signIn = e.status === 401
		? ` <a href="/login?next=${encodeURIComponent(location.pathname)}">Sign in again</a>.`
		: '';
	const agree = e.code === 'agreement_required'
		? `<p style="margin:10px 0 0"><a class="tm-btn sm primary" href="/legal/agreements?next=${encodeURIComponent(location.pathname)}">Sign the real-funds agreement</a></p>`
		: '';
	return `<div class="tm-err" role="alert">${esc(e.message)}${signIn}${agree}</div>`;
}

function busy(btn, text) {
	const prev = btn.innerHTML;
	btn.disabled = true;
	btn.innerHTML = `<span class="tm-spin" aria-hidden="true"></span>${esc(text)}`;
	return () => {
		btn.disabled = false;
		btn.innerHTML = prev;
	};
}

function wireSeg(root) {
	for (const seg of $$('.tm-seg[data-seg]', root)) {
		seg.addEventListener('click', (e) => {
			const b = e.target.closest('button[data-v]');
			if (!b) return;
			for (const x of $$('button', seg)) x.setAttribute('aria-pressed', String(x === b));
			seg.dataset.value = b.dataset.v;
			seg.dispatchEvent(new CustomEvent('seg-change', { detail: b.dataset.v }));
		});
	}
}

function seg(name, options, value) {
	return `<div class="tm-seg" role="group" aria-label="${esc(name)}" data-seg="${esc(name)}" data-value="${esc(value)}">${options
		.map(([v, text]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === value}">${esc(text)}</button>`)
		.join('')}</div>`;
}

// Broken thumbnails fall back to the role initial instead of a broken image.
document.addEventListener('error', (e) => {
	const img = e.target;
	if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
	const span = document.createElement('span');
	span.className = img.dataset.fallbackClass || 'tm-ava';
	span.textContent = img.dataset.fallback;
	span.setAttribute('aria-hidden', 'true');
	img.replaceWith(span);
}, true);

function done() {
	ROOT.setAttribute('aria-busy', 'false');
}

// ── /teams ───────────────────────────────────────────────────────────────────

function heroHtml(compact) {
	return `
		<section class="tm-hero">
			<p class="tm-kicker">Specialist teams</p>
			<h1 class="tm-title">Four agents. One policy. One board.</h1>
			<p class="tm-sub">A team is a squad of four 3D agents that work one market together. They post everything they learn to a shared findings board, and the Trader only acts on research it can cite, inside a spend policy you set.</p>
			${compact ? '' : ''}
			<ul class="tm-roles">
				${FIXED.map((r) => `<li style="${roleVar(r)}"><b>${ROLE_TITLE[r]}</b>${esc(ROLE_PITCH[r])}</li>`).join('')}
			</ul>
		</section>`;
}

function createFormHtml() {
	return `
		<form class="tm-panel tm-form" id="tmCreate" novalidate aria-labelledby="tmCreateH">
			<h2 class="tm-h2" id="tmCreateH">Assemble a team</h2>
			<label class="tm-field"><span class="tm-label">Team name</span>
				<input class="tm-input" name="name" maxlength="60" required autocomplete="off" placeholder="Morning desk" /></label>
			<label class="tm-field"><span class="tm-label">What it works on (optional)</span>
				<textarea class="tm-input" name="description" maxlength="500" placeholder="New launches with a two-sided market and no bundles."></textarea></label>
			<div class="tm-field"><span class="tm-label">Network</span>
				${seg('Network', [['mainnet', 'Mainnet'], ['devnet', 'Devnet']], 'mainnet')}
				<span class="tm-hint">Devnet runs on test SOL. A live mainnet trade also needs the signed real-funds agreement.</span></div>
			<div class="tm-grid2">
				<label class="tm-field"><span class="tm-label">Per trade (SOL)</span>
					<input class="tm-input" name="per_trade_sol" type="number" inputmode="decimal" min="0.001" max="50" step="0.001" value="0.05" required /></label>
				<label class="tm-field"><span class="tm-label">Daily budget (SOL)</span>
					<input class="tm-input" name="daily_budget_sol" type="number" inputmode="decimal" min="0.001" max="500" step="0.001" value="0.25" required /></label>
			</div>
			<label class="tm-field"><span class="tm-label">Finding lifetime (minutes)</span>
				<input class="tm-input" name="ttl_minutes" type="number" inputmode="numeric" min="1" max="1440" step="1" value="15" required />
				<span class="tm-hint">How long a verdict stays citable. After that the Trader researches the mint again.</span></label>
			<label class="tm-check"><input type="checkbox" name="allow_caution" /> Let the Trader buy on a "caution" verdict, not only on a "pass".</label>
			<label class="tm-check"><input type="checkbox" name="is_public" /> Make the team page and its board public.</label>
			<div id="tmCreateErr"></div>
			<button class="tm-btn primary" type="submit">Assemble four agents</button>
			<p class="tm-hint">Creates four agents you own, each with a 3D body, a wallet and a public page. Nothing is funded and nothing is signed.</p>
		</form>`;
}

function rosterHtml(roster) {
	return (roster || []).slice(0, 5).map((r) => {
		const initial = esc((ROLE_TITLE[r.role] || r.role || '?')[0]);
		const style = roleVar(r.role);
		return r.thumbnail_url
			? `<img class="tm-ava" style="${style}" src="${esc(resolveDevR2Url(r.thumbnail_url))}" alt="${esc(r.name || ROLE_TITLE[r.role])}" loading="lazy" decoding="async" data-fallback="${initial}" />`
			: `<span class="tm-ava" style="${style}" aria-hidden="true">${initial}</span>`;
	}).join('');
}

function teamCardHtml(t) {
	const statusTone = STATUS_TONE[t.status] ?? '';
	return `
		<li><a class="tm-card" href="${esc(t.page_url)}">
			<span class="tm-roster" aria-hidden="true">${rosterHtml(t.roster)}</span>
			<span style="min-width:0">
				<span class="tm-card-name">${esc(t.name)}</span>
				<span class="tm-card-meta">
					<span>${t.member_count} ${t.member_count === 1 ? 'agent' : 'agents'}</span>
					<span>${esc(label(t.network))}</span>
					<span>${t.last_finding_at ? `Last finding ${esc(ago(t.last_finding_at))}` : 'No findings yet'}</span>
					${t.is_public ? '<span>Public</span>' : ''}
				</span>
			</span>
			<span class="tm-chip ${statusTone}">${esc(label(t.status))}</span>
		</a></li>`;
}

async function renderList() {
	document.title = 'Specialist Teams · three.ws';
	const user = await currentUser();
	if (!user) {
		CONTENT.innerHTML = `
			${heroHtml(false)}
			<div class="tm-state tm-section">
				<h2>Sign in to assemble a team</h2>
				<p>Your squad's agents, wallets and findings belong to your account. Sign in and you can have four specialists working a market in under a minute.</p>
				<div class="tm-actions" style="justify-content:center">
					<a class="tm-btn primary" href="/login?next=${encodeURIComponent('/teams')}">Sign in</a>
					<a class="tm-btn" href="/register?next=${encodeURIComponent('/teams')}">Create an account</a>
				</div>
			</div>`;
		done();
		return;
	}

	CONTENT.innerHTML = `
		${heroHtml(true)}
		<div class="tm-layout">
			<section aria-labelledby="tmYourH">
				<h2 class="tm-h2" id="tmYourH">Your teams <small id="tmCount"></small></h2>
				<div id="tmList"></div>
			</section>
			<aside>${createFormHtml()}</aside>
		</div>`;
	wireSeg(CONTENT);
	wireCreate();
	await loadTeams();
	done();
}

async function loadTeams() {
	const box = $('#tmList');
	box.innerHTML = `<div class="tm-stack">${'<div class="tm-skel" style="height:76px"></div>'.repeat(3)}</div>`;
	const res = await api('/api/teams');
	if (!res.ok) {
		box.innerHTML = `
			<div class="tm-state">
				<h3>Your teams did not load</h3>
				<p>${esc(res.message)}</p>
				<button class="tm-btn" type="button" id="tmRetry">Try again</button>
			</div>`;
		$('#tmRetry').addEventListener('click', loadTeams);
		return;
	}
	const teams = res.data || [];
	const memberOf = res.body?.member_of || [];
	$('#tmCount').textContent = teams.length ? `${teams.length}` : '';
	const memberHtmlList = memberOf.length
		? `<h2 class="tm-h2 tm-section" id="tmMemberH">Teams you belong to <small>Joined through your organisation</small></h2>
			<ul class="tm-cards" aria-labelledby="tmMemberH">${memberOf.map(memberTeamCardHtml).join('')}</ul>`
		: '';
	if (!teams.length && memberOf.length) {
		box.innerHTML = `
			<div class="tm-state">
				<h3>You do not own a team yet</h3>
				<p>You belong to the teams below through your organisation. Assemble your own squad with the form alongside.</p>
			</div>${memberHtmlList}`;
		return;
	}
	if (!teams.length) {
		box.innerHTML = `
			<div class="tm-state">
				<h3>No teams yet</h3>
				<p>Name a team, set how much the Trader may spend, and three.ws provisions a Researcher, an Entry scout, a Trader and a Launcher for you.</p>
				<button class="tm-btn primary" type="button" id="tmStart">Assemble your first team</button>
			</div>`;
		$('#tmStart').addEventListener('click', () => {
			const input = $('#tmCreate input[name="name"]');
			input.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
			input.focus({ preventScroll: true });
		});
		return;
	}
	box.innerHTML = `<ul class="tm-cards">${teams.map(teamCardHtml).join('')}</ul>${memberHtmlList}`;
}

function memberTeamCardHtml(t) {
	return `
		<li><a class="tm-card" href="/teams/${esc(t.id)}">
			<span class="tm-roster" aria-hidden="true"><span class="tm-ava">${esc(String(t.name || '?')[0])}</span></span>
			<span style="min-width:0">
				<span class="tm-card-name">${esc(t.name)}</span>
				<span class="tm-card-meta">
					<span>${esc(label(t.network))}</span>
					<span>${t.source === 'scim' ? 'Provisioned by your organisation' : 'Joined with Microsoft'} ${esc(ago(t.joined_at))}</span>
				</span>
			</span>
			<span class="tm-chip info">Member</span>
		</a></li>`;
}

function wireCreate() {
	const form = $('#tmCreate');
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const errBox = $('#tmCreateErr');
		errBox.innerHTML = '';
		const fd = new FormData(form);
		const name = String(fd.get('name') || '').trim();
		if (!name) {
			errBox.innerHTML = errorHtml({ message: 'Give the team a name.' });
			form.name.focus();
			return;
		}
		const body = {
			name,
			description: String(fd.get('description') || '').trim() || null,
			network: $('.tm-seg[data-seg="Network"]', form).dataset.value,
			is_public: fd.get('is_public') === 'on',
			policy: {
				per_trade_sol: Number(fd.get('per_trade_sol')),
				daily_budget_sol: Number(fd.get('daily_budget_sol')),
				finding_ttl_seconds: Math.round(Number(fd.get('ttl_minutes')) * 60),
				allow_caution: fd.get('allow_caution') === 'on',
			},
		};
		const btn = $('button[type="submit"]', form);
		const restore = busy(btn, 'Provisioning four agents…');
		ROOT.setAttribute('aria-busy', 'true');
		const res = await api('/api/teams', { method: 'POST', body });
		ROOT.setAttribute('aria-busy', 'false');
		if (res.ok) {
			location.assign(res.data.page_url);
			return;
		}
		restore();
		// Partial provisioning still created the team: send the owner to repair it.
		if (res.detail?.team_id) {
			toast('The team was created but a role agent was not. Opening it so you can repair it.');
			location.assign(`/teams/${encodeURIComponent(res.detail.team_id)}`);
			return;
		}
		errBox.innerHTML = errorHtml(res);
	});
}

// ── /teams/:id ───────────────────────────────────────────────────────────────

const state = {
	id: null,
	team: null,
	user: null,
	findings: new Map(),
	filter: '',
	nextBefore: null,
	since: null,
	es: null,
	retryTimer: 0,
	observer: null,
};

async function renderDetail(id) {
	state.id = id;
	const wantsJoin = new URLSearchParams(location.search).has('join');
	const [user, res, offer] = await Promise.all([
		currentUser(),
		api(`/api/teams/${id}`),
		wantsJoin ? api(`/api/teams/${id}/join`) : Promise.resolve(null),
	]);
	state.user = user;
	if (offer?.ok && offer.data.status !== 'active') {
		paintJoinOffer(offer.data);
		done();
		return;
	}
	if (wantsJoin) dropParams('join');
	if (!res.ok) {
		CONTENT.innerHTML = res.status === 404
			? `<div class="tm-state">
				<h2>This team is private or does not exist</h2>
				<p>${user ? 'It may have been archived, or its owner keeps it private.' : 'If it is yours, sign in to open it.'}</p>
				<div class="tm-actions" style="justify-content:center">
					${user ? '' : `<a class="tm-btn primary" href="/login?next=${encodeURIComponent(location.pathname)}">Sign in</a>`}
					<a class="tm-btn" href="/teams">Specialist teams</a>
				</div>
			</div>`
			: `<div class="tm-state">
				<h2>The team did not load</h2>
				<p>${esc(res.message)}</p>
				<button class="tm-btn" type="button" id="tmRetry">Try again</button>
			</div>`;
		$('#tmRetry')?.addEventListener('click', () => renderDetail(id));
		done();
		return;
	}
	state.team = res.data;
	paintDetail();
	done();
	announceOutcomes();
	await loadFindings(true);
	openStream();
}

function paintDetail() {
	const t = state.team;
	document.title = `${t.name} · Specialist Teams · three.ws`;
	const owner = t.is_owner;
	CONTENT.innerHTML = `
		<a class="tm-back" href="/teams">‹ ${owner ? 'Your teams' : 'Specialist teams'}</a>
		<header class="tm-head">
			<div style="min-width:0">
				<h1>${esc(t.name)}</h1>
				${t.description ? `<p class="tm-desc">${esc(t.description)}</p>` : ''}
				<div class="tm-head-meta" id="tmChips"></div>
			</div>
			${owner ? '<div class="tm-actions" id="tmHeadActions"></div>' : ''}
		</header>
		<div id="tmBanners"></div>
		<dl class="tm-tiles" id="tmTiles"></dl>
		<section class="tm-section" aria-labelledby="tmSquadH">
			<h2 class="tm-h2" id="tmSquadH">The squad <small>Each specialist is a full agent with its own page</small></h2>
			<ul class="tm-squad" id="tmSquad"></ul>
		</section>
		<div class="tm-work${owner ? '' : ' solo'}">
			${owner ? consoleHtml() : ''}
			<section class="tm-panel" aria-labelledby="tmBoardH">
				<div class="tm-board-head">
					<h2 class="tm-h2" id="tmBoardH" style="margin:0">Findings board</h2>
					<span class="tm-live" id="tmLive" role="status"><i aria-hidden="true"></i><span>Connecting</span></span>
				</div>
				<div style="margin-bottom:12px">${seg('Filter findings', FILTERS, state.filter)}</div>
				<ul class="tm-feed" id="tmFeed"></ul>
				<div class="tm-more" id="tmMore"></div>
			</section>
		</div>
		${owner ? settingsHtml() : ''}`;
	wireSeg(CONTENT);
	paintChrome();
	paintSquad();
	if (owner) {
		wireConsole();
		wireSettings();
	}
	$('.tm-seg[data-seg="Filter findings"]').addEventListener('seg-change', (e) => {
		state.filter = e.detail;
		loadFindings(true);
	});
	$('#tmFeed').addEventListener('click', onFeedClick);
}

/** Chips, header actions, banners and stat tiles: everything a status change touches. */
function paintChrome() {
	const t = state.team;
	const owner = t.is_owner;
	$('#tmChips').innerHTML = `
		<span class="tm-chip ${STATUS_TONE[t.status] ?? ''}">${esc(label(t.status))}</span>
		<span class="tm-chip ${t.network === 'devnet' ? 'info' : ''}">${esc(label(t.network))}</span>
		<span class="tm-chip">${t.is_public ? 'Public' : 'Private'}</span>`;

	if (owner) {
		const canToggle = t.status === 'active' || t.status === 'paused';
		$('#tmHeadActions').innerHTML = `
			${canToggle ? `<button class="tm-btn sm" type="button" id="tmToggle">${t.status === 'paused' ? 'Resume' : 'Pause'}</button>` : ''}
			<a class="tm-btn sm primary" href="/teams/${esc(t.id)}/chat">Chat with squad</a>
			<a class="tm-btn sm" href="#tmSettings">Settings</a>`;
		$('#tmToggle')?.addEventListener('click', (e) => setStatus(t.status === 'paused' ? 'active' : 'paused', e.currentTarget));
	}

	const banners = [];
	const needsRepair = t.missing_roles.length > 0 || t.status === 'provisioning' || t.status === 'failed';
	if (needsRepair) {
		const missing = t.missing_roles.map((r) => ROLE_TITLE[r]).join(', ');
		banners.push(owner
			? `<div class="tm-note bad tm-banner"><span><b>${missing ? `Missing: ${esc(missing)}.` : 'This team is not fully assembled.'}</b> ${t.last_error ? esc(t.last_error) : 'Repair provisions any role agent that was not created.'}</span>
				<button class="tm-btn sm primary" type="button" id="tmRepair">Repair team</button></div>`
			: '<div class="tm-note warn tm-banner"><span><b>This team is still being assembled.</b> Its specialists have not all joined yet.</span></div>');
	} else if (t.status === 'paused') {
		banners.push(owner
			? `<div class="tm-note warn tm-banner"><span><b>Paused.</b> No specialist runs until you resume the team. The board stays readable.</span>
				<button class="tm-btn sm primary" type="button" id="tmResume">Resume</button></div>`
			: '<div class="tm-note warn tm-banner"><span><b>Paused by its owner.</b> The board below is the record so far.</span></div>');
	}
	$('#tmBanners').innerHTML = banners.join('');
	$('#tmRepair')?.addEventListener('click', (e) => repairTeam(e.currentTarget));
	$('#tmResume')?.addEventListener('click', (e) => setStatus('active', e.currentTarget));

	const ttlMin = Math.round((t.policy?.finding_ttl_seconds ?? 900) / 60);
	const tiles = [
		['Findings', num(t.findings.total, 0)],
		['Last 24h', num(t.findings.last_24h, 0)],
		['Last finding', esc(ago(t.findings.last_at))],
		['Verdicts live for', `${ttlMin} min`],
	];
	if (owner) {
		tiles.push(['Trader wallet', esc(sol(t.trader_balance_sol))]);
		tiles.push(['Per trade cap', esc(sol(t.policy.per_trade_sol))]);
		tiles.push(['Daily budget', esc(sol(t.policy.daily_budget_sol))]);
	}
	$('#tmTiles').innerHTML = tiles.map(([k, v]) => `<div class="tm-tile"><dt>${k}</dt><dd>${v}</dd></div>`).join('');

	const runnable = t.status === 'active';
	for (const b of $$('.tm-console button[type="submit"]')) b.disabled = !runnable;
	const gateNote = $('#tmConsoleGate');
	if (gateNote) {
		gateNote.hidden = runnable;
		gateNote.textContent = t.status === 'paused' ? 'Resume the team to run its specialists.' : 'Repair the team before running its specialists.';
	}
}

function memberHtml(m) {
	const a = m.agent;
	const glb = agentAvatarGlb({ model_url: a.model_url });
	const initial = esc((m.title || '?')[0]);
	const thumb = a.thumbnail_url
		? `<img class="tm-stage-img" src="${esc(resolveDevR2Url(a.thumbnail_url))}" alt="" loading="lazy" decoding="async" data-fallback="${initial}" data-fallback-class="tm-stage-initial" />`
		: `<span class="tm-stage-initial" aria-hidden="true">${initial}</span>`;
	const perms = m.permissions.map((p) => `<span class="${p === 'trade.execute' ? 'sign' : ''}" title="${esc(state.team.permission_catalog?.[p] || p)}">${esc(PERM_SHORT[p] || p)}</span>`).join('');
	return `
		<li class="tm-member" data-member="${esc(m.id)}" style="${roleVar(m.role)}">
			<div class="tm-stage" data-glb="${esc(glb)}" data-name="${esc(a.name)}">${thumb}</div>
			<div class="tm-member-body">
				<div class="tm-actions" style="gap:6px">
					<span class="tm-chip role">${esc(m.title)}</span>
					${m.can_sign ? '<span class="tm-chip bad" title="Can sign trades from its wallet, inside the spend policy">Can sign</span>' : '<span class="tm-chip" title="Holds no signing permission">No signing</span>'}
				</div>
				<a class="tm-member-name" href="${esc(a.page_url)}">${esc(a.name)}</a>
				<p class="tm-member-blurb">${esc(m.blurb)}</p>
				<div class="tm-perms" aria-label="Permissions">${perms || '<span>no permissions</span>'}</div>
				${m.budget_sol != null ? `<span class="tm-hint">Budget ${esc(sol(m.budget_sol))} a day</span>` : ''}
				${a.wallet ? `<span class="tm-hint tm-mono" title="${esc(a.wallet)}">${esc(short(a.wallet))}</span>` : ''}
			</div>
		</li>`;
}

function missingHtml(role) {
	return `
		<li class="tm-member" style="${roleVar(role)}">
			<div class="tm-missing">No ${ROLE_TITLE[role]} yet.<br />${state.team.is_owner ? 'Repair the team to provision one.' : 'Its owner has not finished assembling the team.'}</div>
			<div class="tm-member-body"><span class="tm-chip role">${ROLE_TITLE[role]}</span></div>
		</li>`;
}

function paintSquad() {
	const t = state.team;
	const byRole = new Map(t.members.filter((m) => m.role !== 'custom').map((m) => [m.role, m]));
	const custom = t.members.filter((m) => m.role === 'custom');
	$('#tmSquad').innerHTML = [
		...FIXED.map((r) => (byRole.has(r) ? memberHtml(byRole.get(r)) : missingHtml(r))),
		...custom.map(memberHtml),
	].join('');
	mountFigures();
}

// The squad renders a live <agent-3d> per member, mounted only once its card is
// on screen so four WebGL contexts never compete during first paint.
let elementReady = null;
function loadElement() {
	elementReady ??= import('./element.js').then(() => true, () => false);
	return elementReady;
}

function mountFigures() {
	state.observer?.disconnect();
	if (!('IntersectionObserver' in window)) return;
	state.observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			state.observer.unobserve(entry.target);
			mountFigure(entry.target);
		}
	}, { rootMargin: '120px' });
	for (const stage of $$('#tmSquad .tm-stage[data-glb]')) state.observer.observe(stage);
}

async function mountFigure(stage) {
	if (!(await loadElement())) return;
	const el = document.createElement('agent-3d');
	el.setAttribute('body', resolveDevR2Url(stage.dataset.glb));
	el.setAttribute('mode', 'inline');
	el.setAttribute('responsive', '');
	el.setAttribute('background', 'transparent');
	el.setAttribute('name-plate', 'off');
	el.setAttribute('avatar-chat', 'off');
	el.setAttribute('kiosk', '');
	el.setAttribute('aria-label', `${stage.dataset.name} in 3D`);
	el.addEventListener('agent:ready', () => {
		el.classList.add('ready');
		$('.tm-stage-img, .tm-stage-initial', stage)?.classList.add('gone');
	}, { once: true });
	stage.append(el);
}

function pulseMember(memberId) {
	const card = memberId && $(`.tm-member[data-member="${CSS.escape(memberId)}"]`);
	if (!card) return;
	card.classList.add('pulse');
	setTimeout(() => card.classList.remove('pulse'), 1800);
}

// ── organisation join ────────────────────────────────────────────────────────

function dropParams(...names) {
	const url = new URL(location.href);
	for (const n of names) url.searchParams.delete(n);
	history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// Outcomes of the Microsoft round trips (api/auth/microsoft/[action].js),
// which land back here as ?tenant=<outcome>#enterprise or ?joined=1.
const TENANT_OUTCOMES = {
	claimed: 'Tenant claimed. People who sign in with Microsoft from it can now find this team.',
	tenant_claimed: 'That Microsoft tenant already belongs to another three.ws team. Its owner has to unclaim it first.',
	already_claimed: 'This team already holds a different tenant. Unclaim it before claiming another.',
	not_admin: 'That Microsoft account is not a directory administrator. Sign in as a Global, Privileged Role, Application or Cloud Application Administrator.',
	personal_account: 'Personal Microsoft accounts have no organisation to claim. Sign in with a work or school account.',
	not_owner: 'Only the team owner can claim a tenant for it.',
	session_changed: 'Your three.ws session changed during the Microsoft round trip. Try again.',
	cancelled: 'Microsoft sign-in was cancelled. Nothing changed.',
	expired: 'That Microsoft round trip took too long. Try again.',
	failed: 'Microsoft could not complete that. Try again.',
	exchange_failed: 'Microsoft did not accept the request. Try again in a moment.',
	invalid_token: 'Microsoft returned something we could not verify. Try again.',
	reauth_stale: 'Microsoft did not ask for your password again. Try once more.',
	admin_consent_required: 'Your organisation has to approve three.ws in Microsoft Entra first.',
	unavailable: 'Sign in with Microsoft is not configured on this deployment.',
	rate_limited: 'Too many attempts. Try again in a few minutes.',
};

function announceOutcomes() {
	const params = new URLSearchParams(location.search);
	const tenant = params.get('tenant');
	if (tenant && TENANT_OUTCOMES[tenant]) toast(TENANT_OUTCOMES[tenant]);
	if (params.has('joined')) toast(`Welcome to ${state.team.name}. You joined through your organisation.`);
	if (params.has('tenant') || params.has('joined')) dropParams('tenant', 'joined');
}

function paintJoinOffer(o) {
	document.title = `Join ${o.team.name} · Specialist Teams · three.ws`;
	const who = o.account?.email || o.account?.display_name || 'your Microsoft account';
	const org = o.tenant_name || 'your organisation';
	const removed = o.status === 'deactivated';
	CONTENT.innerHTML = `
		<a class="tm-back" href="/teams">‹ Specialist teams</a>
		<section class="tm-state tm-join" aria-labelledby="tmJoinH">
			<p class="tm-kicker">Through ${esc(org)}</p>
			<h2 id="tmJoinH">${removed ? `Your access to ${esc(o.team.name)} was removed` : `Join ${esc(o.team.name)}`}</h2>
			${o.team.description ? `<p>${esc(o.team.description)}</p>` : ''}
			<p>${removed
				? 'The team owner or your organisation removed you. Ask them to restore your access.'
				: `${esc(org)} uses this team on three.ws. You signed in as <b>${esc(who)}</b>, so you can join it.${o.status === 'declined' ? ' You declined earlier; you can still join.' : ''}`}</p>
			<div id="tmJoinErr"></div>
			<div class="tm-actions" style="justify-content:center">
				${removed
					? '<a class="tm-btn primary" href="/dashboard">Go to your dashboard</a>'
					: `<button class="tm-btn primary" type="button" data-decision="join">Join team</button>
						${o.status === 'declined' ? '' : '<button class="tm-btn" type="button" data-decision="decline">Not now</button>'}`}
			</div>
		</section>`;
	for (const btn of $$('[data-decision]', CONTENT)) {
		btn.addEventListener('click', async () => {
			const decision = btn.dataset.decision;
			const restore = busy(btn, decision === 'join' ? 'Joining…' : 'Declining…');
			const res = await api(`/api/teams/${state.id}/join`, { method: 'POST', body: { decision } });
			if (!res.ok) {
				restore();
				$('#tmJoinErr').innerHTML = errorHtml(res);
				return;
			}
			if (decision === 'decline') {
				location.assign('/teams');
				return;
			}
			const url = new URL(location.href);
			url.searchParams.delete('join');
			url.searchParams.set('joined', '1');
			history.replaceState(null, '', url.pathname + url.search + url.hash);
			ROOT.setAttribute('aria-busy', 'true');
			renderDetail(state.id);
		});
	}
}

// ── owner actions ────────────────────────────────────────────────────────────

const TABS = [
	['research', 'researcher', 'Research'],
	['scan', 'entry', 'Entry scan'],
	['trade', 'trader', 'Trade'],
	['launch', 'launcher', 'Launch prep'],
];

const MINT_ATTRS = 'class="tm-input tm-mono" name="mint" autocomplete="off" spellcheck="false" maxlength="44" pattern="[1-9A-HJ-NP-Za-km-z]{32,44}"';

function consoleHtml() {
	const panes = {
		research: `
			<label class="tm-field"><span class="tm-label">Token mint</span><input ${MINT_ATTRS} required placeholder="Mint address" /></label>
			<label class="tm-check"><input type="checkbox" name="refresh" /> Research again even if a live verdict is on the board.</label>
			<p class="tm-hint">Checks mint and freeze authority, venue, holders, bundles and smart money, then posts a verdict that stays citable for the finding lifetime.</p>
			<button class="tm-btn primary" type="submit">Research</button>`,
		scan: `
			<label class="tm-field"><span class="tm-label">Token mint (optional)</span><input ${MINT_ATTRS} placeholder="Leave empty to scan recent launches" /></label>
			<p class="tm-hint">Without a mint, scores every launch whose observation window closed in the last two hours against the entry gates in Settings and posts the best setups. The Entry agent never trades.</p>
			<button class="tm-btn primary" type="submit">Scan</button>`,
		trade: `
			<label class="tm-field"><span class="tm-label">Token mint</span><input ${MINT_ATTRS} required placeholder="Mint address" /></label>
			<div class="tm-grid2">
				<div class="tm-field"><span class="tm-label">Side</span>${seg('Side', [['buy', 'Buy'], ['sell', 'Sell']], 'buy')}</div>
				<div class="tm-field"><span class="tm-label">Mode</span>${seg('Mode', [['quote', 'Quote'], ['simulate', 'Simulate'], ['live', 'Live']], 'quote')}</div>
			</div>
			<div class="tm-grid2">
				<label class="tm-field"><span class="tm-label" id="tmAmountL">Amount (SOL)</span><input class="tm-input" name="amount" inputmode="decimal" autocomplete="off" required placeholder="0.01" /></label>
				<label class="tm-field"><span class="tm-label">Slippage (bps, optional)</span><input class="tm-input" name="slippage" type="number" inputmode="numeric" min="1" max="5000" step="1" placeholder="Default" /></label>
			</div>
			<p class="tm-hint" id="tmTradeHint">The Trader cites a live research verdict on this mint, or researches it first and posts that verdict too. Quote and Simulate never sign.</p>
			<button class="tm-btn primary" type="submit" id="tmTradeGo">Get quote</button>`,
		launch: `
			<div class="tm-grid2">
				<label class="tm-field"><span class="tm-label">Coin name</span><input class="tm-input" name="name" maxlength="32" required autocomplete="off" /></label>
				<label class="tm-field"><span class="tm-label">Ticker</span><input class="tm-input tm-mono" name="symbol" maxlength="10" required autocomplete="off" style="text-transform:uppercase" /></label>
			</div>
			<label class="tm-field"><span class="tm-label">Description (optional)</span><textarea class="tm-input" name="description" maxlength="500"></textarea></label>
			<p class="tm-hint">The Launcher checks the launch lane and writes a plan. You review and sign it yourself on the launchpad, with the Launcher's 3D body as the coin image.</p>
			<button class="tm-btn primary" type="submit">Prepare plan</button>`,
	};
	return `
		<section class="tm-panel tm-console" aria-labelledby="tmConsoleH">
			<h2 class="tm-h2" id="tmConsoleH">Run a specialist</h2>
			<p class="tm-note warn" id="tmConsoleGate" hidden></p>
			<div class="tm-tabs" role="tablist" aria-label="Specialist">
				${TABS.map(([action, role, text], i) => `<button type="button" role="tab" id="tmTab-${action}" aria-controls="tmPane-${action}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" style="${roleVar(role)}">${text}</button>`).join('')}
			</div>
			${TABS.map(([action, role], i) => `
				<div role="tabpanel" id="tmPane-${action}" aria-labelledby="tmTab-${action}" ${i === 0 ? '' : 'hidden'}>
					<form class="tm-form" data-action="${action}" data-role="${role}" novalidate>${panes[action]}</form>
					<div class="tm-result" aria-live="polite"></div>
				</div>`).join('')}
		</section>`;
}

function wireConsole() {
	const tabs = $$('.tm-tabs [role="tab"]');
	const select = (tab) => {
		for (const t of tabs) {
			const on = t === tab;
			t.setAttribute('aria-selected', String(on));
			t.tabIndex = on ? 0 : -1;
			$(`#${t.getAttribute('aria-controls')}`).hidden = !on;
		}
	};
	for (const tab of tabs) {
		tab.addEventListener('click', () => select(tab));
		tab.addEventListener('keydown', (e) => {
			const i = tabs.indexOf(tab);
			const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
			if (!next) return;
			e.preventDefault();
			select(next);
			next.focus();
		});
	}

	const tradeForm = $('form[data-action="trade"]');
	const sideSeg = $('.tm-seg[data-seg="Side"]', tradeForm);
	const modeSeg = $('.tm-seg[data-seg="Mode"]', tradeForm);
	const syncTrade = () => {
		const sell = sideSeg.dataset.value === 'sell';
		const mode = modeSeg.dataset.value;
		$('#tmAmountL').textContent = sell ? 'Amount (tokens, or max)' : 'Amount (SOL)';
		tradeForm.amount.placeholder = sell ? 'max' : '0.01';
		const go = $('#tmTradeGo');
		go.textContent = mode === 'live' ? 'Review live trade' : mode === 'simulate' ? 'Simulate' : 'Get quote';
		go.className = `tm-btn ${mode === 'live' ? 'live' : 'primary'}`;
		$('#tmTradeHint').textContent = mode === 'live'
			? 'Live signs and sends from the Trader wallet, inside the per trade cap and daily budget. You confirm the exact amount first.'
			: 'The Trader cites a live research verdict on this mint, or researches it first and posts that verdict too. Quote and Simulate never sign.';
	};
	sideSeg.addEventListener('seg-change', syncTrade);
	modeSeg.addEventListener('seg-change', syncTrade);

	for (const form of $$('.tm-console form')) form.addEventListener('submit', onRun);
	paintChrome();
}

function readInput(form) {
	const action = form.dataset.action;
	const fd = new FormData(form);
	const mint = String(fd.get('mint') || '').trim();
	if (action === 'research') return { mint, refresh: fd.get('refresh') === 'on' };
	if (action === 'scan') return mint ? { mint } : {};
	if (action === 'launch') {
		return {
			name: String(fd.get('name') || '').trim(),
			symbol: String(fd.get('symbol') || '').trim().toUpperCase(),
			description: String(fd.get('description') || '').trim(),
		};
	}
	const side = $('.tm-seg[data-seg="Side"]', form).dataset.value;
	const rawAmount = String(fd.get('amount') || '').trim();
	const slippage = String(fd.get('slippage') || '').trim();
	return {
		mint,
		side,
		amount: side === 'sell' && rawAmount.toLowerCase() === 'max' ? 'max' : Number(rawAmount),
		mode: $('.tm-seg[data-seg="Mode"]', form).dataset.value,
		...(slippage ? { slippageBps: Number(slippage) } : {}),
	};
}

function validate(form, input) {
	const action = form.dataset.action;
	const mintRe = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
	if ((action === 'research' || action === 'trade') && !mintRe.test(input.mint)) return 'Paste a valid Solana token mint address.';
	if (action === 'scan' && input.mint && !mintRe.test(input.mint)) return 'That is not a valid Solana mint address. Leave it empty to scan recent launches.';
	if (action === 'trade' && input.amount !== 'max' && !(input.amount > 0)) return input.side === 'sell' ? 'Enter a token amount, or max.' : 'Enter how much SOL to spend.';
	if (action === 'launch' && !input.name) return 'Give the coin a name.';
	if (action === 'launch' && !/^[A-Z0-9]{1,10}$/.test(input.symbol)) return 'The ticker must be 1 to 10 letters or digits.';
	return null;
}

function liveTradeHtml(input) {
	const t = state.team;
	const trader = t.members.find((m) => m.role === 'trader');
	const amount = input.side === 'buy' ? `${num(input.amount, 9)} SOL` : input.amount === 'max' ? 'Entire token balance' : `${num(input.amount, 9)} tokens`;
	const rows = [
		['Action', input.side === 'buy' ? 'Buy' : 'Sell'],
		['Amount', amount],
		['Token mint', `<span class="tm-mono">${esc(input.mint)}</span>`],
		['Network', esc(label(t.network))],
		['From wallet', trader?.agent.wallet ? `<span class="tm-mono">${esc(trader.agent.wallet)}</span>` : 'Trader wallet'],
		['Per trade cap', esc(sol(t.policy.per_trade_sol))],
		['Daily budget', esc(sol(t.policy.daily_budget_sol))],
	];
	return `
		<table>${rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</table>
		<p>${t.network === 'mainnet'
			? '<b>This signs and sends a real mainnet transaction.</b> It cannot be undone. The Trader still refuses it if research says avoid or a spend guard trips.'
			: 'This signs a devnet transaction with test SOL. The Trader still refuses it if research says avoid or a spend guard trips.'}</p>`;
}

async function onRun(e) {
	e.preventDefault();
	const form = e.currentTarget;
	const action = form.dataset.action;
	const result = form.nextElementSibling;
	result.innerHTML = '';
	const input = readInput(form);
	const problem = validate(form, input);
	if (problem) {
		result.innerHTML = errorHtml({ message: problem });
		return;
	}
	if (action === 'trade' && input.mode === 'live') {
		const ok = await confirmDialog({ title: 'Confirm live trade', html: liveTradeHtml(input), okLabel: 'Sign and send', tone: 'live' });
		if (!ok) return;
		input.confirm = true;
	}
	const btn = $('button[type="submit"]', form);
	const restore = busy(btn, { research: 'Researching…', scan: 'Scanning…', trade: 'Working…', launch: 'Preparing…' }[action]);
	const res = await api(`/api/teams/${state.id}/run`, { method: 'POST', body: { action, role: form.dataset.role, input } });
	restore();
	if (!res.ok) {
		result.innerHTML = errorHtml(res);
		return;
	}
	const findings = runFindings(action, res.data);
	for (const f of findings) addFinding(f);
	result.innerHTML = runResultHtml(action, res.data);
}

function runFindings(action, data) {
	if (action === 'scan') return data.findings || [];
	if (action === 'trade') return [data.research, data.finding].filter(Boolean);
	return data.finding ? [data.finding] : [];
}

function runResultHtml(action, data) {
	if (action === 'research') {
		return `<div class="tm-note"><b>${data.reused ? 'Reused a live verdict' : 'Posted a fresh verdict'}</b>: ${esc(label(data.finding.verdict))}${data.finding.score != null ? `, score ${data.finding.score}/100` : ''}. ${data.reused ? 'Nothing was redone.' : ''}</div>`;
	}
	if (action === 'scan') {
		if (data.setups === undefined) return `<div class="tm-note"><b>${esc(label(data.findings[0]?.verdict))}</b>: ${esc(data.findings[0]?.summary)}</div>`;
		return `<div class="tm-note"><b>Scanned ${data.scanned} ${data.scanned === 1 ? 'launch' : 'launches'}.</b> ${data.setups ? `Posted ${data.setups} ${data.setups === 1 ? 'setup' : 'setups'} to the board.` : 'None cleared the entry gates, so nothing was posted.'}</div>`;
	}
	if (action === 'launch') {
		const url = data.finding.evidence?.launch_url;
		return data.ready && url
			? `<div class="tm-note"><b>Plan ready.</b> Review it and sign it yourself on the launchpad.<p style="margin:10px 0 0"><a class="tm-btn sm primary" href="${esc(url)}">Review and sign on the launchpad</a></p></div>`
			: `<div class="tm-note bad"><b>Blocked.</b> ${esc((data.blockers || [])[0] || data.finding.summary)}</div>`;
	}
	const f = data.finding;
	const cite = data.research
		? `Cited research: <b>${esc(label(data.research.verdict))}</b> (${f.evidence?.research_source === 'ran' ? 'researched just now' : 'reused from the board'}).`
		: 'No research cited (exits are never blocked by research).';
	const tone = f.verdict === 'refused' || f.verdict === 'failed' ? 'bad' : '';
	const explorer = f.evidence?.result?.explorer;
	return `<div class="tm-note ${tone}"><b>${esc(label(f.verdict))}.</b> ${esc(f.summary)}<br />${cite}${explorer ? ` <a href="${esc(explorer)}" target="_blank" rel="noopener">View transaction</a>` : ''}</div>`;
}

async function setStatus(status, btn) {
	const restore = busy(btn, status === 'paused' ? 'Pausing…' : 'Resuming…');
	const res = await api(`/api/teams/${state.id}`, { method: 'PATCH', body: { status } });
	if (!res.ok) {
		restore();
		toast(res.message);
		return;
	}
	state.team = res.data;
	paintChrome();
	toast(status === 'paused' ? 'Team paused.' : 'Team resumed.');
}

async function repairTeam(btn) {
	const restore = busy(btn, 'Provisioning…');
	const res = await api(`/api/teams/${state.id}/repair`, { method: 'POST' });
	if (!res.ok) {
		restore();
		toast(res.message);
		return;
	}
	state.team = res.data.team;
	paintChrome();
	paintSquad();
	paintMembers();
	const n = res.data.created?.length || 0;
	toast(n ? `Provisioned ${n} ${n === 1 ? 'agent' : 'agents'}.` : 'Nothing was missing.');
}

// ── findings board ───────────────────────────────────────────────────────────

function subjectHtml(f) {
	if (f.subject_kind !== 'mint') {
		const text = f.subject.startsWith('launch:') ? `Launch plan $${f.subject.slice(7)}` : f.subject;
		return `<span class="tm-f-subject">${esc(text)}</span>`;
	}
	const sym = f.evidence?.identity?.symbol;
	return `<a class="tm-f-subject" href="/coin/${encodeURIComponent(f.subject)}" title="${esc(f.subject)}">${sym ? `$${esc(String(sym).slice(0, 16))} ` : ''}<span class="tm-mono">${esc(short(f.subject))}</span></a>`;
}

function expiryHtml(f) {
	if (!f.expires_at) return '';
	const left = timeLeft(f.expires_at);
	return `<span data-expires="${esc(f.expires_at)}">${left ? `Citable for ${left}` : 'Expired'}</span>`;
}

function citeHtml(f) {
	return (f.cites || []).map((id) => {
		const cited = state.findings.get(id);
		const text = cited ? `Cites ${KIND_LABEL[cited.kind] || 'finding'}: ${label(cited.verdict)}` : 'Cites research';
		return `<button type="button" class="tm-cite" data-cite="${esc(id)}" data-subject="${esc(f.subject)}">${esc(text)}</button>`;
	}).join('');
}

function row(k, v) {
	if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
	return `<dt>${esc(k)}</dt><dd>${v}</dd>`;
}
const list = (items) => `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const val = (v) => (v == null ? null : esc(typeof v === 'number' ? num(v, 6) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v));

function evidenceRows(f) {
	const ev = f.evidence || {};
	if (f.kind === 'research') {
		return [
			row('Reasons', ev.reasons?.length ? list(ev.reasons) : null),
			row('Safety', ev.safety ? `${esc(label(ev.safety.verdict))}${ev.safety.score != null ? `, ${esc(ev.safety.score)}/100` : ''}` : null),
			row('Checks', ev.safety?.checks?.length ? list(ev.safety.checks.map((c) => `${label(c.name)}: ${c.status}${c.reason ? ` (${c.reason})` : ''}`)) : null),
			row('Subscores', ev.subscores ? list(Object.entries(ev.subscores).map(([k, v]) => `${label(k)}: ${v ?? 'n/a'}`)) : null),
			row('Smart money', ev.smart_money ? `${ev.smart_money.count} wallets${ev.smart_money.score != null ? `, score ${esc(ev.smart_money.score)}` : ''}${ev.smart_money.sybil_flag ? ', sybil flagged' : ''}` : null),
			row('Sources', ev.sources?.length ? list(ev.sources.map((s) => `${label(s.name)}${s.at ? ` at ${new Date(s.at).toLocaleTimeString()}` : ': unavailable'}`)) : null),
		];
	}
	if (f.kind === 'entry_signal') {
		return [
			row('Strategy score', val(ev.strategy_score)),
			row('Reasons', ev.reasons?.length ? list(ev.reasons) : null),
			row('Market cap', ev.market_cap_usd != null ? `$${num(ev.market_cap_usd, 0)}` : null),
			row('Gates', ev.gates ? list(Object.entries(ev.gates).filter(([, v]) => v != null).map(([k, v]) => `${label(k)}: ${v}`)) : null),
			row('Scorer', val(ev.scorer)),
		];
	}
	if (f.kind === 'trade') {
		const q = ev.quote;
		const r = ev.result;
		const req = ev.request || {};
		return [
			row('Rule', ev.rule ? `${esc(label(ev.rule))}: ${esc(ev.rule_reason)}` : null),
			row('Research', ev.research_verdict ? `${esc(label(ev.research_verdict))} (${ev.research_source === 'ran' ? 'researched for this trade' : 'reused from the board'})` : null),
			row('Request', esc(`${label(req.side)} ${req.amount ?? ''} ${req.side === 'buy' ? 'SOL' : req.amount === 'max' ? '' : 'tokens'}, ${req.mode}, ${req.network}`)),
			row('Expected out', q ? (q.side === 'buy' ? `${val(q.expected_tokens_out)} tokens` : `${val(q.expected_sol_out)} SOL`) : null),
			row('Price impact', q?.price_impact_pct != null ? `${num(q.price_impact_pct, 2)}%` : null),
			row('USD value', q?.usd_value != null ? `$${num(q.usd_value, 2)}` : null),
			row('Spend guard', q ? (q.allowed ? 'Pass' : esc(q.blocked_reason?.message || 'Blocked')) : null),
			row('Signature', r?.signature ? `<span class="tm-mono">${esc(short(r.signature))}</span>` : null),
			row('Engine', r?.message ? esc(r.message) : null),
		];
	}
	const plan = ev.plan || {};
	const lane = ev.lane || {};
	return [
		row('Plan', esc(`${plan.name || ''} ($${plan.symbol || ''})`)),
		row('Description', val(plan.description)),
		row('Lane', lane.label ? esc(`${lane.label} on ${lane.network}, quoted in ${lane.quote}`) : null),
		row('Trade fee', lane.trade_fee_bps != null ? `${num(lane.trade_fee_bps / 100, 2)}%` : null),
		row('Creator share', lane.creator_fee_percent != null ? `${num(lane.creator_fee_percent, 2)}% of fees` : null),
		row('Blockers', ev.blockers?.length ? list(ev.blockers) : null),
		row('Signer', ev.signer === 'owner' ? 'You, on the launchpad' : null),
	];
}

function findingHtml(f) {
	const ev = f.evidence || {};
	const tone = VERDICT_TONE[f.verdict] ?? '';
	const stale = f.expires_at && !timeLeft(f.expires_at);
	const explorer = ev.result?.explorer;
	const rows = evidenceRows(f).join('');
	return `
		<li class="tm-finding${stale ? ' stale' : ''}" id="f-${esc(f.id)}" style="${roleVar(f.author_role)}" tabindex="-1">
			<div class="tm-f-top">
				<span class="tm-chip role">${esc(ROLE_TITLE[f.author_role] || f.author_role)}</span>
				<span class="tm-chip">${esc(KIND_LABEL[f.kind] || f.kind)}</span>
				<span class="tm-chip ${tone}">${esc(label(f.verdict))}</span>
				${subjectHtml(f)}
				<time class="tm-f-time" datetime="${esc(f.created_at)}" title="${esc(new Date(f.created_at).toLocaleString())}">${esc(ago(f.created_at))}</time>
			</div>
			<p class="tm-f-summary">${esc(f.summary)}</p>
			<div class="tm-f-meta">
				${f.score != null ? `<span>Score ${esc(f.score)}/100</span>` : ''}
				${citeHtml(f)}
				${expiryHtml(f)}
				${f.receipt_id ? `<span>Receipt <span class="tm-mono">${esc(short(f.receipt_id))}</span></span>` : ''}
				${explorer ? `<a href="${esc(explorer)}" target="_blank" rel="noopener">View transaction</a>` : ''}
				${ev.launch_url ? `<a href="${esc(ev.launch_url)}">Review and sign on the launchpad</a>` : ''}
			</div>
			${rows ? `<details class="tm-ev"><summary>Evidence</summary><dl>${rows}</dl></details>` : ''}
			<div class="tm-cited"></div>
		</li>`;
}

function feedEmptyHtml() {
	const kind = FILTERS.find(([v]) => v === state.filter)?.[1];
	if (state.filter) return `<li class="tm-state" data-empty><h3>No ${esc(kind.toLowerCase())} findings yet</h3><p>Switch the filter to All to see everything the squad posted.</p></li>`;
	return state.team.is_owner
		? '<li class="tm-state" data-empty><h3>Nothing on the board yet</h3><p>Run the Researcher on a mint, or let the Entry agent scan recent launches. Every finding lands here live.</p></li>'
		: '<li class="tm-state" data-empty><h3>Nothing on the board yet</h3><p>Findings appear here live as the squad works.</p></li>';
}

async function loadFindings(reset) {
	const feed = $('#tmFeed');
	const more = $('#tmMore');
	if (reset) {
		state.nextBefore = null;
		feed.innerHTML = '<li class="tm-skel" style="height:96px"></li><li class="tm-skel" style="height:96px"></li><li class="tm-skel" style="height:96px"></li>';
		more.innerHTML = '';
	}
	const q = new URLSearchParams({ limit: String(PAGE) });
	if (state.filter) q.set('kind', state.filter);
	if (!reset && state.nextBefore) q.set('before', state.nextBefore);
	const res = await api(`/api/teams/${state.id}/findings?${q}`);
	if (!res.ok) {
		if (reset) {
			feed.innerHTML = `<li class="tm-state"><h3>The board did not load</h3><p>${esc(res.message)}</p><button class="tm-btn" type="button" data-retry>Try again</button></li>`;
		} else {
			more.innerHTML = `<button class="tm-btn" type="button" id="tmLoadMore">Try again</button>`;
			$('#tmLoadMore').addEventListener('click', () => loadFindings(false));
		}
		return;
	}
	const rows = res.data || [];
	for (const f of rows) state.findings.set(f.id, f);
	if (reset) {
		feed.innerHTML = rows.length ? rows.map(findingHtml).join('') : feedEmptyHtml();
		if (!state.since) state.since = rows.length && !state.filter ? new Date(rows[0].created_at).toISOString() : new Date().toISOString();
	} else {
		feed.insertAdjacentHTML('beforeend', rows.map(findingHtml).join(''));
	}
	refreshCites();
	state.nextBefore = res.body?.next_before || null;
	more.innerHTML = state.nextBefore ? '<button class="tm-btn" type="button" id="tmLoadMore">Load older findings</button>' : '';
	$('#tmLoadMore')?.addEventListener('click', async (e) => {
		busy(e.currentTarget, 'Loading…');
		await loadFindings(false);
	});
}

/** Relabel cite buttons once the finding they point at is known. */
function refreshCites() {
	for (const b of $$('#tmFeed .tm-cite')) {
		const cited = state.findings.get(b.dataset.cite);
		if (cited) b.textContent = `Cites ${KIND_LABEL[cited.kind] || 'finding'}: ${label(cited.verdict)}`;
	}
}

function addFinding(f) {
	const fresh = !state.findings.has(f.id);
	state.findings.set(f.id, f);
	if (!fresh || $(`#f-${CSS.escape(f.id)}`)) return;
	if (state.team && fresh) {
		state.team.findings.total += 1;
		state.team.findings.last_24h += 1;
		state.team.findings.last_at = f.created_at;
		paintChrome();
	}
	pulseMember(f.member_id);
	if (state.filter && f.kind !== state.filter) return;
	const feed = $('#tmFeed');
	$('[data-empty]', feed)?.remove();
	feed.insertAdjacentHTML('afterbegin', findingHtml(f));
	refreshCites();
}

async function onFeedClick(e) {
	if (e.target.closest('[data-retry]')) {
		loadFindings(true);
		return;
	}
	const btn = e.target.closest('.tm-cite');
	if (!btn) return;
	const id = btn.dataset.cite;
	const target = $(`#f-${CSS.escape(id)}`);
	if (target) {
		target.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
		target.focus({ preventScroll: true });
		target.classList.add('flash');
		setTimeout(() => target.classList.remove('flash'), 1800);
		return;
	}
	// The cited finding is older than the loaded page or hidden by the filter:
	// show it inline under the finding that cites it.
	const slot = $('.tm-cited', btn.closest('.tm-finding'));
	if (slot.childElementCount) {
		slot.innerHTML = '';
		return;
	}
	let cited = state.findings.get(id);
	if (!cited) {
		const q = new URLSearchParams({ kind: 'research', subject: btn.dataset.subject, limit: '100' });
		const res = await api(`/api/teams/${state.id}/findings?${q}`);
		cited = res.ok ? (res.data || []).find((x) => x.id === id) : null;
		if (cited) state.findings.set(cited.id, cited);
	}
	if (!cited) {
		toast('That finding is no longer on the board.');
		return;
	}
	slot.innerHTML = `<ul class="tm-feed" style="margin-top:10px">${findingHtml(cited).replace(`id="f-${esc(cited.id)}"`, '')}</ul>`;
}

function setLive(mode, text) {
	const el = $('#tmLive');
	if (!el) return;
	el.className = `tm-live${mode ? ` ${mode}` : ''}`;
	$('span', el).textContent = text;
}

function openStream() {
	state.es?.close();
	clearTimeout(state.retryTimer);
	if (!('EventSource' in window)) {
		setLive('', 'Live updates unavailable in this browser');
		return;
	}
	const q = new URLSearchParams();
	if (state.since) q.set('since', state.since);
	const es = new EventSource(`/api/teams/${state.id}/findings/stream?${q}`, { withCredentials: true });
	state.es = es;
	es.addEventListener('open', () => setLive('on', 'Live'));
	es.addEventListener('hello', () => setLive('on', 'Live'));
	es.addEventListener('finding', (ev) => {
		try {
			const f = JSON.parse(ev.data);
			state.since = new Date(f.created_at).toISOString();
			addFinding(f);
		} catch {
			/* a malformed frame is skipped; the next poll carries the row again */
		}
	});
	es.addEventListener('status', async () => {
		const res = await api(`/api/teams/${state.id}`);
		if (res.ok) {
			state.team = res.data;
			paintChrome();
		}
	});
	es.addEventListener('gone', () => {
		es.close();
		setLive('', 'Stopped');
		toast('This team was archived or made private.');
	});
	es.addEventListener('error', () => {
		if (es.readyState === EventSource.CLOSED) {
			// The browser gave up (an HTTP error, not a dropped socket). Retry with
			// a fresh connection resuming from the last finding we saw.
			setLive('retry', 'Reconnecting');
			state.retryTimer = setTimeout(openStream, 5000);
		} else {
			setLive('retry', 'Reconnecting');
		}
	});
}

// Keep expiry countdowns honest without re-rendering the board.
setInterval(() => {
	for (const el of $$('[data-expires]')) {
		const left = timeLeft(el.dataset.expires);
		el.textContent = left ? `Citable for ${left}` : 'Expired';
		el.closest('.tm-finding')?.classList.toggle('stale', !left);
	}
}, 5000);

window.addEventListener('pagehide', () => state.es?.close());

// ── settings ─────────────────────────────────────────────────────────────────

function settingsHtml() {
	const t = state.team;
	const p = t.policy;
	const g = p.entry || {};
	return `
		<section class="tm-section tm-panel" id="tmSettings" aria-labelledby="tmSetH">
			<h2 class="tm-h2" id="tmSetH">Settings</h2>
			<form class="tm-form" id="tmSetForm" novalidate>
				<div class="tm-grid2">
					<label class="tm-field"><span class="tm-label">Team name</span><input class="tm-input" name="name" maxlength="60" required value="${esc(t.name)}" /></label>
					<label class="tm-field"><span class="tm-label">Description</span><input class="tm-input" name="description" maxlength="500" value="${esc(t.description || '')}" /></label>
				</div>
				<fieldset class="tm-fieldset">
					<legend>Spend policy</legend>
					<div class="tm-grid2">
						<label class="tm-field"><span class="tm-label">Per trade (SOL)</span><input class="tm-input" name="per_trade_sol" type="number" min="0.001" max="50" step="0.001" value="${esc(p.per_trade_sol)}" /></label>
						<label class="tm-field"><span class="tm-label">Daily budget (SOL)</span><input class="tm-input" name="daily_budget_sol" type="number" min="0.001" max="500" step="0.001" value="${esc(p.daily_budget_sol)}" /></label>
						<label class="tm-field"><span class="tm-label">Finding lifetime (minutes)</span><input class="tm-input" name="ttl_minutes" type="number" min="1" max="1440" step="1" value="${Math.round(p.finding_ttl_seconds / 60)}" /></label>
					</div>
					<label class="tm-check"><input type="checkbox" name="allow_caution" ${p.allow_caution ? 'checked' : ''} /> Let the Trader buy on a "caution" verdict, not only on a "pass".</label>
					<p class="tm-hint">The caps are written onto the Trader agent's own trade limits, so the platform spend guards enforce them on every trade.</p>
				</fieldset>
				<fieldset class="tm-fieldset">
					<legend>Entry gates</legend>
					<div class="tm-grid2">
						<label class="tm-field"><span class="tm-label">Min quality (0 to 100)</span><input class="tm-input" name="min_quality_score" type="number" min="0" max="100" step="1" value="${esc(g.min_quality_score ?? '')}" /></label>
						<label class="tm-field"><span class="tm-label">Max bundle score (0 to 1)</span><input class="tm-input" name="max_bundle_score" type="number" min="0" max="1" step="0.05" value="${esc(g.max_bundle_score ?? '')}" /></label>
						<label class="tm-field"><span class="tm-label">Min market cap (USD)</span><input class="tm-input" name="min_market_cap_usd" type="number" min="0" step="1000" value="${esc(g.min_market_cap_usd ?? '')}" placeholder="No floor" /></label>
						<label class="tm-field"><span class="tm-label">Max market cap (USD)</span><input class="tm-input" name="max_market_cap_usd" type="number" min="0" step="1000" value="${esc(g.max_market_cap_usd ?? '')}" placeholder="No ceiling" /></label>
					</div>
					<label class="tm-check"><input type="checkbox" name="require_two_sided_market" ${g.require_two_sided_market ? 'checked' : ''} /> Require a two-sided market (real buyers and sellers).</label>
					<label class="tm-check"><input type="checkbox" name="require_smart_money" ${g.require_smart_money ? 'checked' : ''} /> Require smart-money wallets in the early holders.</label>
				</fieldset>
				<label class="tm-check"><input type="checkbox" name="is_public" ${t.is_public ? 'checked' : ''} /> Public: anyone with the link can watch the squad and its board. Policy and wallet balances stay private.</label>
				<div id="tmSetErr"></div>
				<div class="tm-actions"><button class="tm-btn primary" type="submit">Save settings</button></div>
			</form>

			<h3 class="tm-h2 tm-section">Members and permissions <small>A grant can only narrow a role, never widen it</small></h3>
			<div id="tmMembers" class="tm-stack"></div>

			<h3 class="tm-h2 tm-section">Add a specialist <small>One of your agents, with a read-mostly grant</small></h3>
			<form class="tm-form" id="tmAddForm" novalidate>
				<label class="tm-field"><span class="tm-label">Agent</span><select class="tm-input" name="agent_id" required><option value="">Loading your agents…</option></select></label>
				<div class="tm-perms-pick" id="tmAddPerms"></div>
				<div id="tmAddErr"></div>
				<div class="tm-actions"><button class="tm-btn" type="submit">Add to team</button></div>
			</form>

			<h3 class="tm-h2 tm-section" id="enterprise">Your organisation <small>Microsoft Entra ID sign-in and SCIM provisioning</small></h3>
			<div id="tmEnterprise" class="tm-stack" aria-live="polite"></div>

			<h3 class="tm-h2 tm-section">Archive</h3>
			<div class="tm-note bad tm-banner"><span>Archiving stops the team and hides its page. The four agents stay in your account with their wallets.</span>
				<button class="tm-btn sm danger" type="button" id="tmArchive">Archive team</button></div>
		</section>`;
}

function permChecks(name, perms, checked) {
	const catalog = state.team.permission_catalog || {};
	return perms.map((p) => `
		<label class="tm-check"><input type="checkbox" name="${esc(name)}" value="${esc(p)}" ${checked.includes(p) ? 'checked' : ''} />
			<span><b>${esc(PERM_SHORT[p] || p)}</b>: ${esc(catalog[p] || '')}</span></label>`).join('');
}

function paintMembers() {
	const box = $('#tmMembers');
	if (!box) return;
	const members = state.team.members;
	if (!members.length) {
		box.innerHTML = '<p class="tm-muted">No members yet. Repair the team to provision its four specialists.</p>';
		return;
	}
	box.innerHTML = members.map((m) => `
		<form class="tm-fieldset tm-form" data-member-form="${esc(m.id)}" style="${roleVar(m.role)}">
			<legend><span class="tm-chip role">${esc(m.title)}</span> ${esc(m.agent.name)}</legend>
			${permChecks('perm', m.ceiling || m.permissions, m.permissions)}
			<div class="tm-actions">
				<button class="tm-btn sm" type="submit">Save grant</button>
				${m.role === 'custom' ? '<button class="tm-btn sm danger" type="button" data-remove>Remove</button>' : ''}
			</div>
		</form>`).join('');
	for (const form of $$('[data-member-form]', box)) {
		const id = form.dataset.memberForm;
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			const permissions = $$('input[name="perm"]:checked', form).map((i) => i.value);
			const restore = busy($('button[type="submit"]', form), 'Saving…');
			const res = await api(`/api/teams/${state.id}/members/${id}`, { method: 'PATCH', body: { permissions } });
			restore();
			if (!res.ok) return toast(res.message);
			await reloadTeam();
			toast('Grant saved.');
		});
		$('[data-remove]', form)?.addEventListener('click', async (e) => {
			const restore = busy(e.currentTarget, 'Removing…');
			const res = await api(`/api/teams/${state.id}/members/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				restore();
				return toast(res.message);
			}
			await reloadTeam();
			toast('Specialist removed. The agent stays in your account.');
		});
	}
}

async function reloadTeam() {
	const res = await api(`/api/teams/${state.id}`);
	if (!res.ok) return;
	state.team = res.data;
	paintChrome();
	paintSquad();
	paintMembers();
	fillAddForm();
}

let ownedAgents = null;
async function fillAddForm() {
	const form = $('#tmAddForm');
	if (!form) return;
	const submit = $('button[type="submit"]', form);
	if (!ownedAgents) {
		const res = await api('/api/agents');
		if (!res.ok) {
			form.agent_id.innerHTML = '<option value="">Your agents did not load</option>';
			form.agent_id.disabled = true;
			submit.disabled = true;
			$('#tmAddErr').innerHTML = `<div class="tm-err" role="alert">${esc(res.message)} <button class="tm-btn sm" type="button" id="tmAgentsRetry">Try again</button></div>`;
			$('#tmAgentsRetry').addEventListener('click', () => {
				$('#tmAddErr').innerHTML = '';
				fillAddForm();
			});
			return;
		}
		ownedAgents = res.body?.agents || [];
	}
	const taken = new Set(state.team.members.map((m) => m.agent.id));
	const free = ownedAgents.filter((a) => !taken.has(a.id));
	form.agent_id.innerHTML = free.length
		? `<option value="">Choose an agent</option>${free.map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.display_name || 'Agent')}</option>`).join('')}`
		: '<option value="">All of your agents are already on this team</option>';
	form.agent_id.disabled = !free.length;
	submit.disabled = !free.length;
	const customCeiling = Object.keys(state.team.permission_catalog || {}).filter((p) => p !== 'trade.execute');
	$('#tmAddPerms').innerHTML = permChecks('perm', customCeiling, ['findings.read', 'findings.write', 'research.run']);
}

function wireSettings() {
	paintMembers();
	fillAddForm();
	loadEnterprise();

	$('#tmSetForm').addEventListener('submit', async (e) => {
		e.preventDefault();
		const form = e.currentTarget;
		const fd = new FormData(form);
		const opt = (k) => (String(fd.get(k) ?? '').trim() === '' ? null : Number(fd.get(k)));
		const body = {
			name: String(fd.get('name') || '').trim(),
			description: String(fd.get('description') || '').trim(),
			is_public: fd.get('is_public') === 'on',
			policy: {
				per_trade_sol: Number(fd.get('per_trade_sol')),
				daily_budget_sol: Number(fd.get('daily_budget_sol')),
				finding_ttl_seconds: Math.round(Number(fd.get('ttl_minutes')) * 60),
				allow_caution: fd.get('allow_caution') === 'on',
				entry: {
					min_quality_score: opt('min_quality_score'),
					max_bundle_score: opt('max_bundle_score'),
					min_market_cap_usd: opt('min_market_cap_usd'),
					max_market_cap_usd: opt('max_market_cap_usd'),
					require_two_sided_market: fd.get('require_two_sided_market') === 'on',
					require_smart_money: fd.get('require_smart_money') === 'on',
				},
			},
		};
		const errBox = $('#tmSetErr');
		errBox.innerHTML = '';
		if (!body.name) {
			errBox.innerHTML = errorHtml({ message: 'Give the team a name.' });
			return;
		}
		const restore = busy($('button[type="submit"]', form), 'Saving…');
		const res = await api(`/api/teams/${state.id}`, { method: 'PATCH', body });
		restore();
		if (!res.ok) {
			errBox.innerHTML = errorHtml(res);
			return;
		}
		state.team = res.data;
		$('.tm-head h1').textContent = state.team.name;
		document.title = `${state.team.name} · Specialist Teams · three.ws`;
		paintChrome();
		toast('Settings saved.');
	});

	$('#tmAddForm').addEventListener('submit', async (e) => {
		e.preventDefault();
		const form = e.currentTarget;
		const errBox = $('#tmAddErr');
		errBox.innerHTML = '';
		const agentId = form.agent_id.value;
		if (!agentId) {
			errBox.innerHTML = errorHtml({ message: 'Choose one of your agents.' });
			return;
		}
		const permissions = $$('input[name="perm"]:checked', form).map((i) => i.value);
		const restore = busy($('button[type="submit"]', form), 'Adding…');
		const res = await api(`/api/teams/${state.id}/members`, { method: 'POST', body: { agent_id: agentId, permissions } });
		restore();
		if (!res.ok) {
			errBox.innerHTML = errorHtml(res);
			return;
		}
		await reloadTeam();
		toast('Specialist added.');
	});

	$('#tmArchive').addEventListener('click', async (e) => {
		const btn = e.currentTarget;
		const ok = await confirmDialog({
			title: 'Archive this team?',
			html: `<p><b>${esc(state.team.name)}</b> stops running and its page goes away. Its agents, their wallets and any funds in them stay in your account.</p>`,
			okLabel: 'Archive team',
			tone: 'live',
		});
		if (!ok) return;
		const restore = busy(btn, 'Archiving…');
		const res = await api(`/api/teams/${state.id}`, { method: 'DELETE' });
		if (!res.ok) {
			restore();
			return toast(res.message);
		}
		location.assign('/teams');
	});
}

// ── organisation: tenant claim and SCIM ──────────────────────────────────────

const EVENT_TEXT = {
	tenant_claimed: 'Tenant claimed',
	tenant_reverified: 'Tenant re-verified',
	tenant_unclaimed: 'Tenant unclaimed',
	join_mode_changed: 'Join mode changed',
	scim_token_generated: 'SCIM token generated',
	scim_token_rotated: 'SCIM token rotated',
	scim_token_revoked: 'SCIM token revoked',
	member_joined: 'Joined the team',
	offer_declined: 'Declined the offer',
	person_bound: 'Signed in and was matched',
	person_removed: 'Removed by the owner',
	person_restored: 'Restored by the owner',
	user_created: 'Provisioned',
	user_updated: 'Updated',
	user_deactivated: 'Deactivated',
	user_reactivated: 'Reactivated',
	user_deleted: 'Deprovisioned',
	group_created: 'Group created',
	group_updated: 'Group updated',
	group_deleted: 'Group deleted',
};
const ACTOR_TEXT = { owner: 'Owner', scim: 'Entra SCIM', member: 'Member', system: 'three.ws' };
const PERSON_TONE = { active: 'good', declined: '', deactivated: 'bad', deleted: 'bad' };

const ent = { data: null, issued: null };

async function loadEnterprise() {
	const box = $('#tmEnterprise');
	if (!box) return;
	box.innerHTML = '<div class="tm-skel" style="height:120px"></div><div class="tm-skel" style="height:160px"></div>';
	const res = await api(`/api/teams/${state.id}/enterprise`);
	if (!res.ok) {
		box.innerHTML = `
			<div class="tm-err" role="alert">The organisation settings did not load. ${esc(res.message)}
				<button class="tm-btn sm" type="button" id="tmEntRetry">Try again</button></div>`;
		$('#tmEntRetry').addEventListener('click', loadEnterprise);
		return;
	}
	ent.data = res.data;
	paintEnterprise();
	if (location.hash === '#enterprise') $('#enterprise')?.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
}

function claimHref() {
	return `/api/auth/microsoft/start?intent=tenant_claim&team=${encodeURIComponent(state.id)}`;
}

function paintEnterprise() {
	const box = $('#tmEnterprise');
	const d = ent.data;
	if (!d.claim) {
		box.innerHTML = `
			<div class="tm-state">
				<h3>Connect your Microsoft Entra tenant</h3>
				<p>Sign in once as a directory administrator to claim your organisation. After that, colleagues who sign in with Microsoft are offered this team or join it automatically, and you can provision people from Microsoft Entra ID over SCIM.</p>
				<div class="tm-actions" style="justify-content:center">
					<a class="tm-btn primary" href="${esc(claimHref())}">Claim with a Microsoft admin account</a>
					<a class="tm-btn" href="/docs/enterprise-sso" target="_blank" rel="noopener">How it works</a>
				</div>
			</div>
			${eventsHtml(d.events)}`;
		return;
	}
	const c = d.claim;
	box.innerHTML = `
		<div class="tm-fieldset">
			<div class="tm-ent-row">
				<div style="min-width:0">
					<div class="tm-ent-name">${esc(c.tenant_name || 'Microsoft Entra tenant')} <span class="tm-chip good">Claimed</span></div>
					<div class="tm-hint">Tenant <span class="tm-mono">${esc(c.tenant_id)}</span> · verified by ${esc(c.verified_by || 'an administrator')}${c.verified_role ? ` (${esc(c.verified_role)})` : ''} · ${esc(ago(c.claimed_at))}</div>
				</div>
				<div class="tm-actions">
					<a class="tm-btn sm" href="${esc(claimHref())}">Re-verify</a>
					<button class="tm-btn sm danger" type="button" id="tmUnclaim">Unclaim</button>
				</div>
			</div>
			<div class="tm-field">
				<span class="tm-label">When someone from this tenant signs in with Microsoft</span>
				${seg('Join mode', [['offer', 'Offer the team'], ['auto', 'Join automatically']], c.join_mode)}
				<p class="tm-hint" id="tmJoinHint">${joinHint(c.join_mode)}</p>
			</div>
		</div>
		${scimHtml(d)}
		${peopleHtml(d)}
		${eventsHtml(d.events)}`;
	wireSeg(box);
	wireEnterprise();
}

function joinHint(mode) {
	return mode === 'auto'
		? 'They become read-only members the first time they sign in. People you or SCIM removed stay out.'
		: 'They see an invitation to this team after signing in and choose whether to join.';
}

function scimHtml(d) {
	const s = d.scim;
	const issued = ent.issued;
	const status = s.has_token
		? `Token <span class="tm-mono">${esc(s.token_prefix)}…</span> · ${s.rotated_at ? `rotated ${esc(ago(s.rotated_at))}` : `created ${esc(ago(s.created_at))}`} · ${s.last_used_at ? `last used ${esc(ago(s.last_used_at))}` : 'not used yet'}`
		: 'No token yet. Generate one, then paste it into the Microsoft Entra admin center as the Secret Token.';
	return `
		<fieldset class="tm-fieldset">
			<legend>SCIM provisioning</legend>
			<div class="tm-field">
				<span class="tm-label">Tenant URL</span>
				<div class="tm-copy"><input class="tm-input tm-mono" readonly value="${esc(d.scim_base_url)}" aria-label="SCIM tenant URL" />
					<button class="tm-btn sm" type="button" data-copy="${esc(d.scim_base_url)}">Copy</button></div>
			</div>
			${issued ? `
				<div class="tm-note warn tm-ent-secret" role="status">
					<b>Copy this token now. It is shown only once.</b>
					<div class="tm-copy"><input class="tm-input tm-mono" readonly value="${esc(issued.token)}" aria-label="SCIM secret token" id="tmScimToken" />
						<button class="tm-btn sm primary" type="button" data-copy="${esc(issued.token)}">Copy token</button></div>
					<span>Paste it into Microsoft Entra ID as the Secret Token, then select Test Connection.${issued.rotated ? ' The previous token stopped working the moment this one was made.' : ''}</span>
				</div>` : ''}
			<p class="tm-hint">${status}</p>
			<p class="tm-hint">Last sync: ${s.last_sync_at ? `<b>${esc(ago(s.last_sync_at))}</b> (${esc(new Date(s.last_sync_at).toLocaleString())})` : 'Microsoft Entra ID has not provisioned anyone yet. Its first cycle starts when you turn provisioning on, then repeats about every 40 minutes.'}</p>
			<div class="tm-actions">
				<button class="tm-btn sm ${s.has_token ? '' : 'primary'}" type="button" id="tmScimIssue">${s.has_token ? 'Rotate token' : 'Generate token'}</button>
				${s.has_token ? '<button class="tm-btn sm danger" type="button" id="tmScimRevoke">Revoke token</button>' : ''}
				<a class="tm-btn sm" href="/docs/enterprise-sso#scim-setup" target="_blank" rel="noopener">Entra setup guide</a>
			</div>
		</fieldset>`;
}

function peopleHtml(d) {
	const c = d.counts;
	if (!d.people.length) {
		return `
			<fieldset class="tm-fieldset">
				<legend>People</legend>
				<p class="tm-hint" style="margin:0">Nobody from ${esc(d.claim.tenant_name || 'this tenant')} is on the team yet. Share this page's link with colleagues, switch to automatic join, or assign people to three.ws in Microsoft Entra ID to provision them.</p>
			</fieldset>`;
	}
	return `
		<fieldset class="tm-fieldset">
			<legend>People <small class="tm-hint">${c.active} active${c.pending ? `, ${c.pending} not signed in yet` : ''}${c.deactivated ? `, ${c.deactivated} removed` : ''}</small></legend>
			<div class="tm-table-wrap"><table class="tm-table">
				<thead><tr><th scope="col">Person</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col"><span class="tm-sr">Actions</span></th></tr></thead>
				<tbody>${d.people.map((p) => `
					<tr>
						<td><b>${esc(p.display_name || p.user_name || p.email || 'Unnamed')}</b><br><span class="tm-hint tm-mono">${esc(p.user_name || p.email || '')}</span></td>
						<td>${p.source === 'scim' ? 'Entra SCIM' : 'Microsoft sign-in'}${p.bound ? '' : '<br><span class="tm-hint">Not signed in yet</span>'}</td>
						<td><span class="tm-chip ${PERSON_TONE[p.status] ?? ''}">${esc(label(p.status))}</span></td>
						<td class="tm-cell-act">${p.status === 'active'
							? `<button class="tm-btn sm danger" type="button" data-person="${esc(p.id)}" data-status="deactivated">Remove</button>`
							: p.status === 'deactivated' ? `<button class="tm-btn sm" type="button" data-person="${esc(p.id)}" data-status="active">Restore</button>` : ''}</td>
					</tr>`).join('')}</tbody>
			</table></div>
		</fieldset>`;
}

function eventsHtml(events) {
	if (!events?.length) return '';
	return `
		<fieldset class="tm-fieldset">
			<legend>Recent activity</legend>
			<ol class="tm-ent-events">${events.map((e) => `
				<li><span class="tm-chip ${e.actor === 'scim' ? 'info' : ''}">${esc(ACTOR_TEXT[e.actor] || label(e.actor))}</span>
					<span>${esc(EVENT_TEXT[e.action] || label(e.action))}${e.person_name || e.person_user_name ? `: <b>${esc(e.person_name || e.person_user_name)}</b>` : ''}${e.action === 'join_mode_changed' && e.detail?.join_mode ? ` to ${esc(e.detail.join_mode === 'auto' ? 'join automatically' : 'offer the team')}` : ''}</span>
					<time class="tm-hint" datetime="${esc(e.created_at)}" title="${esc(new Date(e.created_at).toLocaleString())}">${esc(ago(e.created_at))}</time></li>`).join('')}</ol>
		</fieldset>`;
}

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

function wireEnterprise() {
	const box = $('#tmEnterprise');
	for (const b of $$('[data-copy]', box)) {
		b.addEventListener('click', async () => {
			if (await copyText(b.dataset.copy)) {
				toast('Copied.');
				return;
			}
			b.previousElementSibling?.select();
			toast('Copying was blocked. The text is selected: copy it with your keyboard.');
		});
	}

	$('.tm-seg[data-seg="Join mode"]', box)?.addEventListener('seg-change', async (e) => {
		const mode = e.detail;
		$('#tmJoinHint').textContent = joinHint(mode);
		const res = await api(`/api/teams/${state.id}/enterprise`, { method: 'PATCH', body: { join_mode: mode } });
		if (!res.ok) {
			toast(res.message);
			paintEnterprise();
			return;
		}
		ent.data = res.data;
		paintEnterprise();
		toast(mode === 'auto' ? 'People from your tenant now join automatically.' : 'People from your tenant are now offered the team.');
	});

	$('#tmUnclaim')?.addEventListener('click', async (e) => {
		const btn = e.currentTarget;
		const ok = await confirmDialog({
			title: 'Unclaim this tenant?',
			html: `<p><b>${esc(ent.data.claim.tenant_name || ent.data.claim.tenant_id)}</b> stops being linked to this team. Nobody new can join through it, and the SCIM token is revoked, so provisioning stops. People already on the team keep their access until you remove them.</p>`,
			okLabel: 'Unclaim tenant',
			tone: 'live',
		});
		if (!ok) return;
		const restore = busy(btn, 'Unclaiming…');
		const res = await api(`/api/teams/${state.id}/enterprise`, { method: 'DELETE' });
		if (!res.ok) {
			restore();
			return toast(res.message);
		}
		ent.data = res.data;
		ent.issued = null;
		paintEnterprise();
		toast('Tenant unclaimed. SCIM provisioning is off.');
	});

	$('#tmScimIssue')?.addEventListener('click', async (e) => {
		const btn = e.currentTarget;
		const rotating = ent.data.scim.has_token;
		if (rotating) {
			const ok = await confirmDialog({
				title: 'Rotate the SCIM token?',
				html: '<p>The current token stops working immediately. Provisioning fails until you paste the new token into the Microsoft Entra admin center.</p>',
				okLabel: 'Rotate token',
				tone: 'live',
			});
			if (!ok) return;
		}
		const restore = busy(btn, rotating ? 'Rotating…' : 'Generating…');
		const res = await api(`/api/teams/${state.id}/enterprise/scim-token`, { method: 'POST' });
		if (!res.ok) {
			restore();
			return toast(res.message);
		}
		ent.data = res.data.state;
		ent.issued = { token: res.data.token, rotated: rotating };
		paintEnterprise();
		$('#tmScimToken')?.select();
	});

	$('#tmScimRevoke')?.addEventListener('click', async (e) => {
		const btn = e.currentTarget;
		const ok = await confirmDialog({
			title: 'Revoke the SCIM token?',
			html: '<p>Microsoft Entra ID can no longer provision or deprovision people until you generate a new token. People already on the team are not changed.</p>',
			okLabel: 'Revoke token',
			tone: 'live',
		});
		if (!ok) return;
		const restore = busy(btn, 'Revoking…');
		const res = await api(`/api/teams/${state.id}/enterprise/scim-token`, { method: 'DELETE' });
		if (!res.ok) {
			restore();
			return toast(res.message);
		}
		ent.data = res.data;
		ent.issued = null;
		paintEnterprise();
		toast('SCIM token revoked.');
	});

	for (const b of $$('[data-person]', box)) {
		b.addEventListener('click', async () => {
			const status = b.dataset.status;
			if (status === 'deactivated') {
				const ok = await confirmDialog({
					title: 'Remove this person?',
					html: '<p>They lose access to this team at once, and the sessions they opened through your Microsoft tenant are signed out. You can restore them later.</p>',
					okLabel: 'Remove',
					tone: 'live',
				});
				if (!ok) return;
			}
			const restore = busy(b, status === 'active' ? 'Restoring…' : 'Removing…');
			const res = await api(`/api/teams/${state.id}/enterprise/people/${b.dataset.person}`, { method: 'PATCH', body: { status } });
			if (!res.ok) {
				restore();
				return toast(res.message);
			}
			ent.data = res.data.state;
			paintEnterprise();
			toast(status === 'active' ? 'Access restored.' : 'Removed. Their tenant sessions were signed out.');
		});
	}
}

// ── route ────────────────────────────────────────────────────────────────────

const match = location.pathname.match(/^\/teams\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
if (match) renderDetail(match[1].toLowerCase());
else renderList();
