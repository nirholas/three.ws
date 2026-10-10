// /admin/event-markets: events with and without markets, why the cron skipped some,
// and manual open / void. A client of /api/ops/event-markets, never a gate in front of
// it: the endpoint authorizes on the server (platform admin session).

const el = document.getElementById('em-content');
const refreshBtn = document.getElementById('em-refresh');
const stamp = document.getElementById('em-stamp');
const toastHost = document.getElementById('em-toast-host');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'n/a');
const KIND = {
	arena_tournament: 'Arena tournament',
	event_leaderboard: 'Platform event',
	launch_cohort: 'Launch cohort',
	build_round: 'Build round',
	bounty: 'Bounty',
	custom: 'Custom',
};
const REASON = {
	too_few_entrants: 'Too few entrants',
	no_defined_winner: 'No defined winner',
	lock_passed: 'Pick window already closed',
};

function toast(message, bad = false) {
	const t = document.createElement('div');
	t.className = `em-toast${bad ? ' bad' : ''}`;
	t.textContent = message;
	toastHost.replaceChildren(t);
	setTimeout(() => t.remove(), 6000);
}

function skeleton() {
	el.innerHTML = '<div class="em-skeleton"></div>'.repeat(5);
}

function note(title, body, bad = false) {
	el.innerHTML = `<div class="em-note${bad ? ' bad' : ''}"><h2>${esc(title)}</h2><p>${body}</p></div>`;
}

function marketCell(e) {
	if (e.market) {
		const m = e.market;
		return `<span class="em-pill ${esc(m.status)}">${esc(m.status)}</span>
			<div class="em-muted"><a href="/event-markets/${encodeURIComponent(m.slug)}">${esc(m.slug)}</a> · ${m.outcome_count} outcomes · ${m.pick_count} picks</div>`;
	}
	const why = e.skip || e.blocker;
	if (why) {
		return `<span class="em-pill skip">${esc(REASON[why.reason] || why.reason)}</span><div class="em-muted">${esc(why.detail || '')}</div>`;
	}
	return '<span class="em-pill none">Opens next tick</span>';
}

function actionsCell(e) {
	const kind = esc(e.source_kind);
	const ref = esc(e.source_ref);
	if (e.market) {
		const open = ['open', 'locked'].includes(e.market.status);
		return open ? `<button class="em-btn danger" data-act="void" data-market="${esc(e.market.id)}" type="button">Void</button>` : '';
	}
	return `<button class="em-btn" data-act="open" data-kind="${kind}" data-ref="${ref}" type="button">Open now</button>`;
}

function eventsSection(d) {
	if (!d.events.length) {
		return `<div class="em-note"><h2>No upcoming or live events</h2><p>When a tournament, build round, bounty or platform event is announced it appears here and gets a market on the next tick.</p></div>`;
	}
	const rows = d.events
		.map(
			(e) => `<tr>
			<td><div class="em-ev-title">${esc(e.title)}</div><div class="em-muted">${esc(KIND[e.source_kind] || e.source_kind)}</div></td>
			<td>${esc(when(e.starts_at))}<div class="em-muted">to ${esc(when(e.ends_at))}</div></td>
			<td>${e.entrant_count}<div class="em-muted">locks ${esc(when(e.lock_at))}</div></td>
			<td>${marketCell(e)}</td>
			<td><div class="em-actions">${actionsCell(e)}</div></td>
		</tr>`,
		)
		.join('');
	return `<section class="em-section"><div class="em-section-title">Events <span>${d.events.length} listed by the sources right now</span></div>
		<div class="em-table-wrap"><table class="em-table"><thead><tr><th>Event</th><th>Window</th><th>Entrants</th><th>Market</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function skipsSection(d) {
	if (!d.skips.length) return '';
	const rows = d.skips
		.map(
			(s) => `<tr><td><div class="em-ev-title">${esc(s.title)}</div><div class="em-muted">${esc(KIND[s.source_kind] || s.source_kind)}</div></td>
			<td><span class="em-pill skip">${esc(REASON[s.reason] || s.reason)}</span><div class="em-muted">${esc(s.detail || '')}</div></td>
			<td>${esc(when(s.first_seen))}</td><td>${esc(when(s.last_seen))}<div class="em-muted">seen ${s.seen_count}x</div></td></tr>`,
		)
		.join('');
	return `<section class="em-section"><div class="em-section-title">Skipped <span>events the cron declined, with the reason</span></div>
		<div class="em-table-wrap"><table class="em-table"><thead><tr><th>Event</th><th>Reason</th><th>First seen</th><th>Last seen</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function errorsSection(d) {
	if (!d.source_errors.length) return '';
	return `<div class="em-note bad"><h2>A source failed to list events</h2><p>${d.source_errors.map((x) => `<code>${esc(x.source_kind)}</code> ${esc(x.message)}`).join('<br>')}</p></div>`;
}

function render(d) {
	el.innerHTML = errorsSection(d) + eventsSection(d) + skipsSection(d);
	stamp.textContent = `Read ${when(d.generated_at)}`;
}

let inFlight = null;

async function load() {
	if (inFlight) return;
	refreshBtn.disabled = true;
	el.setAttribute('aria-busy', 'true');
	skeleton();
	inFlight = (async () => {
		try {
			const res = await fetch('/api/ops/event-markets', { credentials: 'include', headers: { accept: 'application/json' } });
			if (res.status === 401) return note('Sign in required', 'This page takes a platform admin session. <a href="/login?next=/admin/event-markets">Sign in</a>, then come back.');
			if (res.status === 403) return note('Admins only', 'This account is not a platform admin. <a href="/login?next=/admin/event-markets">Switch account</a>.');
			if (res.status === 429) return note('Rate limited', `Retry in ${esc(res.headers.get('retry-after') || 'a moment')} seconds.`, true);
			if (res.status === 503) {
				const body = await res.json().catch(() => ({}));
				return note('Migration pending', esc(body.error_description || 'Event Markets tables are missing. Run npm run db:status.'), true);
			}
			if (!res.ok) throw new Error(`status ${res.status}`);
			render(await res.json());
		} catch (err) {
			note('Could not load events', `${esc(err?.message || err)}. Check your connection and refresh.`, true);
		} finally {
			refreshBtn.disabled = false;
			el.setAttribute('aria-busy', 'false');
			inFlight = null;
		}
	})();
	await inFlight;
}

async function act(btn) {
	const act = btn.dataset.act;
	if (act === 'void' && !confirm('Void this market? Picks on it stop counting.')) return;
	btn.disabled = true;
	try {
		const payload = act === 'open'
			? { action: 'open', source_kind: btn.dataset.kind, source_ref: btn.dataset.ref }
			: { action: 'void', market_id: btn.dataset.market };
		const res = await fetch('/api/ops/event-markets', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(payload),
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(body.error_description || `status ${res.status}`);
		toast(act === 'open' ? `Opened ${body.slug}` : `Voided ${body.slug}`);
		await load();
	} catch (err) {
		toast(err?.message || String(err), true);
		btn.disabled = false;
	}
}

el.addEventListener('click', (ev) => {
	const btn = ev.target.closest('button[data-act]');
	if (btn) act(btn);
});
refreshBtn.addEventListener('click', load);
load();
