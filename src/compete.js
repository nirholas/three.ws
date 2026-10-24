/**
 * /compete and /compete/:slug: builder competitions. Reads /api/competitions
 * (configured in data/competitions.json) and renders the index, or one
 * competition with its countdown, tracks, prizes, rules, registration form and
 * the live leaderboard. Every figure comes from the API.
 */

const root = document.getElementById('cp-root');
const slug = location.pathname.replace(/^\/compete\/?/, '').split('/')[0] || null;
let ticker = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtAmount = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 });
const PHASE_LABEL = { upcoming: 'Opens soon', open: 'Registration open', building: 'Building', ended: 'Ended' };

function setBusy(b) {
	root.setAttribute('aria-busy', String(b));
}

async function getJson(url) {
	const r = await fetch(url, { credentials: 'include' });
	const body = await r.json().catch(() => ({}));
	if (!r.ok) {
		const err = new Error(body.message || body.error_description || `request failed (${r.status})`);
		err.status = r.status;
		throw err;
	}
	return body;
}

function errorState(message, retry) {
	root.innerHTML = `<section class="cp-hero"><p class="cp-eyebrow">Builder competitions</p><h1>Could not load</h1></section>
		<div class="cp-error" role="alert"><span>${esc(message)}</span><button class="cp-btn" type="button" id="cp-retry">Retry</button></div>`;
	document.getElementById('cp-retry').addEventListener('click', retry);
	setBusy(false);
}

/* ---- index ---- */

function renderIndex(list) {
	const hero = `<section class="cp-hero"><p class="cp-eyebrow">Builder competitions</p>
		<h1>Build an agent. Launch its coin. Climb the board.</h1>
		<p>Enter an agent, launch its coin through three.ws before the deadline, and rank by the creator fees it earns. Every number on a competition page is read live from the platform.</p></section>`;
	if (!list.length) {
		root.innerHTML = `${hero}<div class="cp-empty"><strong>No competition is running right now.</strong>
			Nothing is scheduled yet. You can still <a href="/create">create an agent</a> and <a href="/launch">launch its coin</a> today, and watch what agents earn on <a href="/leaderboard?tab=earned">the earnings leaderboard</a>.</div>`;
		setBusy(false);
		return;
	}
	root.innerHTML = `${hero}<div class="cp-grid">${list
		.map(
			(c) => `<a class="cp-card" href="/compete/${encodeURIComponent(c.slug)}">
				<span class="cp-phase" data-phase="${esc(c.phase)}">${esc(PHASE_LABEL[c.phase])}</span>
				<h3>${esc(c.title)}</h3>
				<p>${esc(c.summary || `${fmtDate(c.starts_at)} to ${fmtDate(c.ends_at)}`)}</p></a>`,
		)
		.join('')}</div>`;
	setBusy(false);
}

async function loadIndex() {
	try {
		renderIndex((await getJson('/api/competitions')).competitions);
	} catch (e) {
		errorState(`The competition list could not be loaded: ${e.message}`, loadIndex);
	}
}

/* ---- detail ---- */

function countdownHtml(deadline) {
	if (!deadline) return '';
	return `<div class="cp-count" role="timer" aria-label="${esc(deadline.label)}">
		<div class="cp-count-label">${esc(deadline.label)} <span id="cp-when">${esc(fmtDate(deadline.at))}</span></div>
		${['d', 'h', 'm', 's'].map((u) => `<div class="cp-unit"><b id="cp-${u}">0</b><span>${{ d: 'days', h: 'hours', m: 'min', s: 'sec' }[u]}</span></div>`).join('')}
	</div>`;
}

function startTicker(deadline, onZero) {
	clearInterval(ticker);
	if (!deadline) return;
	const target = Date.parse(deadline.at);
	const tick = () => {
		const left = Math.max(0, target - Date.now());
		const parts = { d: Math.floor(left / 864e5), h: Math.floor(left / 36e5) % 24, m: Math.floor(left / 6e4) % 60, s: Math.floor(left / 1e3) % 60 };
		for (const [k, v] of Object.entries(parts)) {
			const el = document.getElementById(`cp-${k}`);
			if (el) el.textContent = String(v);
		}
		if (left === 0) {
			clearInterval(ticker);
			onZero();
		}
	};
	tick();
	ticker = setInterval(tick, 1000);
}

function leaderboardHtml(d) {
	const { entries } = d;
	if (!entries.length) {
		return `<div class="cp-empty"><strong>No entries yet.</strong>${d.competition.registration_open ? 'Be the first: register an agent above.' : 'Registration is not open, so the board is empty.'}</div>`;
	}
	return `<div class="cp-tablewrap"><table class="cp-table"><thead><tr><th scope="col">#</th><th scope="col">Agent</th><th scope="col">Team</th><th scope="col">Coin</th><th scope="col" class="num">Creator fees</th></tr></thead><tbody>
		${entries
			.map(
				(e) => `<tr><td>${e.rank ?? '<span class="cp-pill">not launched</span>'}</td>
				<td><a href="${esc(e.agent.url)}">${esc(e.agent.name)}</a>${e.track ? `<br><small>${esc(e.track)}</small>` : ''}</td>
				<td>${esc(e.team_name || '')}${e.x_handle ? `<br><a href="https://x.com/${encodeURIComponent(e.x_handle)}" rel="noopener noreferrer">@${esc(e.x_handle)}</a>` : ''}</td>
				<td>${e.coin ? `<a href="${esc(e.coin.url)}">${esc(e.coin.symbol ? `$${e.coin.symbol}` : e.coin.name || 'Coin')}</a>` : '<span class="cp-pill">none yet</span>'}</td>
				<td class="num">${e.fees_sol == null ? '' : `${fmtAmount(e.fees_sol)} SOL`}</td></tr>`,
			)
			.join('')}</tbody></table></div>
		<p class="cp-method">${esc(d.method)}${d.refreshed_at ? ` Fee data refreshed ${esc(fmtDate(d.refreshed_at))}.` : ''}</p>`;
}

async function registerFormHtml(d) {
	const c = d.competition;
	if (!c.registration_open) return '';
	if (!d.viewer.signed_in) {
		return `<div class="cp-empty"><strong>Sign in to enter.</strong><a href="/login?next=${encodeURIComponent(location.pathname)}">Sign in</a> with the account that owns your agent.</div>`;
	}
	let agents = [];
	try {
		agents = (await getJson('/api/agents')).agents || [];
	} catch {
		return `<div class="cp-error" role="alert"><span>Your agents could not be loaded.</span><button class="cp-btn" type="button" onclick="location.reload()">Retry</button></div>`;
	}
	const open = agents.filter((a) => !d.viewer.entered_agent_ids.includes(a.id));
	if (!agents.length) {
		return `<div class="cp-empty"><strong>You need an agent to enter.</strong><a href="/create">Create one</a>, then come back.</div>`;
	}
	if (!open.length) return `<div class="cp-empty"><strong>You are in.</strong>Every one of your agents is already entered.</div>`;
	return `<form class="cp-form" id="cp-form" novalidate>
		<label>Agent<select name="agent_id" required>${open.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}${a.is_public === false ? ' (private)' : ''}</option>`).join('')}</select></label>
		${c.tracks.length ? `<label>Track<select name="track" required>${c.tracks.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}</select></label>` : ''}
		<label>Team name<input name="team_name" maxlength="80" autocomplete="off" /></label>
		<label>X handle<input name="x_handle" maxlength="16" placeholder="@yourhandle" autocomplete="off" /></label>
		<button class="cp-btn" type="submit">Enter the competition</button>
		<p class="cp-msg" id="cp-msg" role="status"></p>
	</form>`;
}

function wireForm(c, reload) {
	const form = document.getElementById('cp-form');
	if (!form) return;
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		const msg = document.getElementById('cp-msg');
		const btn = form.querySelector('button[type="submit"]');
		const data = Object.fromEntries(new FormData(form));
		for (const k of Object.keys(data)) if (data[k] === '') delete data[k];
		btn.disabled = true;
		msg.dataset.kind = '';
		msg.textContent = 'Submitting...';
		try {
			const cr = await fetch('/api/csrf-token', { credentials: 'include' });
			const token = cr.ok ? (await cr.json()).token : null;
			const r = await fetch(`/api/competitions/${encodeURIComponent(c.slug)}/entries`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
				body: JSON.stringify(data),
			});
			const body = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(body.message || body.error_description || `entry failed (${r.status})`);
			msg.dataset.kind = 'ok';
			msg.textContent = 'You are entered. Launch the agent coin before the tokenize deadline to appear ranked.';
			setTimeout(reload, 900);
		} catch (e) {
			msg.dataset.kind = 'error';
			msg.textContent = e.message;
			btn.disabled = false;
		}
	});
}

function winnersHtml(d) {
	const c = d.competition;
	if (c.phase !== 'ended') return '';
	const byId = new Map(d.entries.map((e) => [e.agent.id, e]));
	if (!c.winners.length) return `<section class="cp-section"><h2>Winners</h2><div class="cp-empty"><strong>Winners have not been announced.</strong>Judging is under way.</div></section>`;
	return `<section class="cp-section"><h2>Winners</h2><div class="cp-grid">${c.winners
		.map((w) => {
			const e = byId.get(w.agent_id);
			return `<div class="cp-card"><h3>${esc(w.place)}</h3><p>${e ? `<a href="${esc(e.agent.url)}">${esc(e.agent.name)}</a>` : esc(w.agent_id)}${w.note ? `<br>${esc(w.note)}` : ''}</p></div>`;
		})
		.join('')}</div></section>`;
}

async function renderDetail(d, reload) {
	const c = d.competition;
	const form = await registerFormHtml(d);
	root.innerHTML = `<section class="cp-hero">
			<span class="cp-phase" data-phase="${esc(c.phase)}">${esc(PHASE_LABEL[c.phase])}</span>
			<h1>${esc(c.title)}</h1>
			${c.summary ? `<p>${esc(c.summary)}</p>` : ''}
			${countdownHtml(c.next_deadline)}
		</section>
		<section class="cp-section" aria-label="Schedule"><dl class="cp-dates">
			<div><dt>Registration opens</dt><dd>${esc(fmtDate(c.starts_at))}</dd></div>
			<div><dt>Registration closes</dt><dd>${esc(fmtDate(c.register_by))}</dd></div>
			<div><dt>Coin launched by</dt><dd>${esc(fmtDate(c.tokenize_by))}</dd></div>
			<div><dt>Ends</dt><dd>${esc(fmtDate(c.ends_at))}</dd></div></dl></section>
		${winnersHtml(d)}
		${c.prizes.length ? `<section class="cp-section"><h2>Prizes</h2><div class="cp-grid">${c.prizes.map((p) => `<div class="cp-card"><h3>${esc(p.place)}</h3><div class="cp-big">${esc(fmtAmount(p.amount))} ${esc(p.asset)}</div>${p.vesting ? `<p>${esc(p.vesting)}</p>` : ''}</div>`).join('')}</div></section>` : ''}
		${c.tracks.length ? `<section class="cp-section"><h2>Tracks</h2><div class="cp-grid">${c.tracks.map((t) => `<div class="cp-card"><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p></div>`).join('')}</div></section>` : ''}
		${c.judges.length ? `<section class="cp-section"><h2>Judges</h2><div class="cp-grid">${c.judges.map((j) => `<div class="cp-card"><h3>${j.url ? `<a href="${esc(j.url)}" rel="noopener noreferrer">${esc(j.name)}</a>` : esc(j.name)}</h3>${j.role ? `<p>${esc(j.role)}</p>` : ''}</div>`).join('')}</div></section>` : ''}
		${c.rules.length ? `<section class="cp-section"><h2>Rules</h2><ol class="cp-rules">${c.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></section>` : ''}
		${form ? `<section class="cp-section"><h2>Enter</h2>${form}</section>` : ''}
		<section class="cp-section"><h2>Leaderboard</h2>${leaderboardHtml(d)}</section>`;
	document.title = `${c.title} · three.ws`;
	setBusy(false);
	wireForm(c, reload);
	startTicker(c.next_deadline, reload);
}

async function loadDetail() {
	try {
		await renderDetail(await getJson(`/api/competitions/${encodeURIComponent(slug)}`), loadDetail);
	} catch (e) {
		if (e.status === 404) {
			root.innerHTML = `<section class="cp-hero"><p class="cp-eyebrow">Builder competitions</p><h1>Competition not found</h1></section>
				<div class="cp-empty"><strong>There is no competition called "${esc(slug)}".</strong>See <a href="/compete">all competitions</a>.</div>`;
			setBusy(false);
			return;
		}
		errorState(`This competition could not be loaded: ${e.message}`, loadDetail);
	}
}

if (slug) loadDetail();
else loadIndex();
