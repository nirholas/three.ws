// "Billed through Microsoft" on /dashboard/billing.
//
// For customers who bought three.ws on Microsoft Marketplace: the plan they
// hold, its Microsoft status in plain language, the renewal date, this billing
// period's metered usage against what the plan includes, the seat roster for
// per-user plans, and where to change any of it in Microsoft. Microsoft owns
// the purchase itself (plan, seat count, payment, cancellation); three.ws owns
// who holds the seats.
//
// Data: GET /api/microsoft-marketplace/subscriptions, POST /api/microsoft-marketplace/seats
// (api/_lib/microsoft-billing.js).

import { get, post, esc, relTime } from '../api.js';
import { skeletonHTML, errorStateHTML, attachRetry } from '../../shared/state-kit.js';

const TONE_CLASS = { ok: 'msb-chip-ok', warn: 'msb-chip-warn', bad: 'msb-chip-bad', muted: 'msb-chip-muted' };

function fmtDate(iso) {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? 'not set' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtNum(n) {
	const v = Number(n) || 0;
	return v >= 100_000 ? v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 }) : v.toLocaleString();
}

function renewalLine(s) {
	if (s.status === 'Unsubscribed') return s.term_end ? `Ended ${fmtDate(s.term_end)}` : 'Ended';
	if (s.status === 'PendingFulfillmentStart') return 'Starts once activated';
	if (s.renews_at) return `Renews ${fmtDate(s.renews_at)}`;
	if (s.term_end) return `Ends ${fmtDate(s.term_end)} (recurring billing is off)`;
	return 'No term reported yet';
}

function meterHTML(m) {
	const pct = m.percent ?? 0;
	const level = m.over_included ? 'over' : pct >= 80 ? 'high' : 'ok';
	const lost = m.rejected + m.expired;
	const ceiling = m.included != null ? ` of ${fmtNum(m.included)} included` : '';
	return `
		<div class="msb-meter">
			<div class="msb-meter-head">
				<span class="msb-meter-name">${esc(m.display_name)}</span>
				<span class="msb-meter-val">${fmtNum(m.billable)}${esc(ceiling)}</span>
			</div>
			<div class="msb-bar" role="progressbar" aria-label="${esc(m.display_name)} used this period"
				aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
				<span class="msb-bar-fill msb-bar-${level}" style="width:${m.included != null ? pct : 0}%"></span>
			</div>
			<div class="msb-meter-foot">
				${fmtNum(m.accepted)} accepted by Microsoft${m.pending ? `, ${fmtNum(m.pending)} being reported` : ''}${lost ? `, ${fmtNum(lost)} not billed` : ''}${m.over_included ? '. Usage past the included amount is billed per unit by Microsoft.' : ''}
			</div>
		</div>`;
}

function personHTML(p) {
	const tags = [p.is_you ? 'you' : null, p.is_owner ? 'owner' : null].filter(Boolean);
	return `<span class="msb-person"><strong>${esc(p.name)}</strong>${p.email ? ` <span class="msb-dim">${esc(p.email)}</span>` : ''}${tags.map((t) => ` <span class="msb-tag">${t}</span>`).join('')}</span>`;
}

function seatsHTML(s, teams) {
	const seats = s.seats;
	const full = seats.used >= seats.purchased;
	const pct = seats.purchased ? Math.min(100, Math.round((seats.used / seats.purchased) * 100)) : 0;
	const head = `
		<div class="msb-sub-head">
			<h3>Seats</h3>
			<span class="msb-dim">${seats.used} of ${seats.purchased} in use</span>
		</div>
		<div class="msb-bar" role="progressbar" aria-label="Seats in use" aria-valuemin="0" aria-valuemax="${seats.purchased}" aria-valuenow="${seats.used}">
			<span class="msb-bar-fill msb-bar-${full ? 'high' : 'ok'}" style="width:${pct}%"></span>
		</div>`;

	if (!s.can_manage_seats) {
		return `
			<div class="msb-block">
				${head}
				<p class="msb-note">${s.you_hold_seat ? 'You hold one of these seats, so the plan applies to your account.' : 'You do not hold a seat on this subscription.'} Your team admin assigns seats.</p>
				${s.you_hold_seat ? `<button type="button" class="msb-btn msb-btn-quiet" data-ms-op="unassign" data-sub="${esc(s.id)}" data-user="self">Give up my seat</button>` : ''}
			</div>`;
	}

	const holders = seats.holders.length
		? `<ul class="msb-list">${seats.holders.map((h) => `
			<li>
				${personHTML(h)}
				<span class="msb-dim msb-when">since ${esc(fmtDate(h.assigned_at))}</span>
				<button type="button" class="msb-btn msb-btn-quiet" data-ms-op="unassign" data-sub="${esc(s.id)}" data-user="${esc(h.user_id)}"
					aria-label="Remove the seat from ${esc(h.name)}">Remove</button>
			</li>`).join('')}</ul>`
		: '<p class="msb-note">No one holds a seat yet, so nobody has the plan. Assign the first seat below.</p>';

	const open = seats.candidates.filter((c) => !c.seat_elsewhere);
	const assign = open.length
		? `
			<form class="msb-row" data-ms-form="assign" data-sub="${esc(s.id)}">
				<label class="msb-sr" for="msb-assign-${esc(s.id)}">Person to give a seat</label>
				<select id="msb-assign-${esc(s.id)}" name="user_id" class="msb-select" ${full ? 'disabled' : ''}>
					${open.map((c) => `<option value="${esc(c.user_id)}">${esc(c.name)}${c.email ? ` (${esc(c.email)})` : ''}${c.is_you ? ' (you)' : ''}</option>`).join('')}
				</select>
				<button type="submit" class="msb-btn" ${full ? 'disabled' : ''}>Assign seat</button>
			</form>
			${full ? '<p class="msb-note">Every seat is in use. Add seats on the subscription in the Azure portal, or remove someone first.</p>' : ''}`
		: `<p class="msb-note">${s.team ? `Everyone in ${esc(s.team.name)} already has a seat or holds one on another subscription.` : 'Link a team to give seats to its members.'}</p>`;
	const busyElsewhere = seats.candidates.filter((c) => c.seat_elsewhere);
	const elsewhere = busyElsewhere.length
		? `<p class="msb-note">${busyElsewhere.map((c) => esc(c.name)).join(', ')} already ${busyElsewhere.length === 1 ? 'holds a seat' : 'hold seats'} on another Microsoft subscription.</p>`
		: '';

	let team = '';
	if (s.team) {
		team = `
			<div class="msb-row msb-team">
				<span>Seats go to members of <a href="/teams/${esc(s.team.id)}">${esc(s.team.name)}</a>.</span>
				${s.can_link_team ? `<button type="button" class="msb-btn msb-btn-quiet" data-ms-op="unlink_team" data-sub="${esc(s.id)}">Unlink team</button>` : ''}
			</div>`;
	} else if (s.can_link_team) {
		team = teams.length
			? `
				<form class="msb-row msb-team" data-ms-form="link_team" data-sub="${esc(s.id)}">
					<label class="msb-sr" for="msb-team-${esc(s.id)}">Team whose members can hold seats</label>
					<select id="msb-team-${esc(s.id)}" name="team_id" class="msb-select">
						${teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}
					</select>
					<button type="submit" class="msb-btn">Link team</button>
				</form>`
			: '<p class="msb-note">To share seats, <a href="/teams">create a team</a> and invite your people, then link it here.</p>';
	}

	return `<div class="msb-block">${head}${team}${holders}${assign}${elsewhere}</div>`;
}

function freshnessHTML(f) {
	if (!f) return '';
	const when = f.refreshed_at ? relTime(f.refreshed_at) : 'earlier';
	return f.error
		? `<p class="msb-fresh msb-fresh-stale" role="status">Showing the copy saved ${esc(when)}. Microsoft did not answer just now (${esc(f.error)}); reload to try again.</p>`
		: `<p class="msb-fresh">Checked with Microsoft ${esc(when)}.</p>`;
}

function subscriptionHTML(s, data) {
	const statusText = `<span class="msb-chip ${TONE_CLASS[s.status_tone] || 'msb-chip-muted'}">${esc(s.status_label)}</span>`;
	const facts = [
		renewalLine(s),
		s.seat_based ? `${s.quantity} seat${s.quantity === 1 ? '' : 's'}` : 'Flat rate',
		s.beneficiary_email ? `For ${s.beneficiary_email}` : null,
	].filter(Boolean);
	return `
		<article class="msb-card" aria-labelledby="msb-title-${esc(s.id)}">
			<header class="msb-card-head">
				<div>
					<div class="msb-kicker">Microsoft Marketplace${s.name ? ` · ${esc(s.name)}` : ''}${s.is_test ? ' · <span class="msb-tag">test purchase</span>' : ''}</div>
					<h3 class="msb-title" id="msb-title-${esc(s.id)}">${esc(s.plan_name)} plan ${statusText}</h3>
					<p class="msb-facts">${facts.map((f) => esc(f)).join('<span aria-hidden="true"> · </span>')}</p>
				</div>
			</header>
			<p class="msb-explain msb-explain-${esc(s.status_tone)}">${esc(s.status_explanation)}</p>

			<div class="msb-block">
				<div class="msb-sub-head">
					<h3>Usage this billing period</h3>
					<span class="msb-dim">${esc(fmtDate(s.period.start))} to ${esc(fmtDate(s.period.end))}</span>
				</div>
				<div class="msb-meters">${s.usage.map(meterHTML).join('')}</div>
			</div>

			${s.seat_based ? seatsHTML(s, data.teams) : ''}

			<div class="msb-block">
				<div class="msb-sub-head"><h3>Manage in Microsoft</h3></div>
				<div class="msb-links">
					${data.manage_links.map((l) => `
						<a class="msb-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">
							<strong>${esc(l.label)} <span aria-hidden="true">↗</span></strong>
							<span>${esc(l.hint)}</span>
						</a>`).join('')}
				</div>
				<details class="msb-details">
					<summary>What happens if the subscription is suspended or cancelled?</summary>
					<p><strong>Suspended.</strong> Microsoft pauses a subscription when a payment does not go through. Paid features stop, but your account, agents, avatars, creations and everything on the free plan keep working. When Microsoft reinstates it, the plan returns on its own; nothing needs to be set up again.</p>
					<p><strong>Cancelled.</strong> Cancel from the subscription's page in the Azure portal; Microsoft refunds a cancellation made within 72 hours of purchase. If recurring billing is off, the subscription runs to the end of its term and then ends. A cancelled subscription cannot be reactivated, so returning means buying the offer again. Your account and everything you made stay, on the free plan limits.</p>
					<p><strong>Seats.</strong> If your organization lowers the seat count in Microsoft, the most recently assigned seats are freed first and each person is told in their notifications.</p>
				</details>
			</div>
			${freshnessHTML(s.freshness)}
		</article>`;
}

function render(el, data) {
	if (!data) {
		el.innerHTML = `
			<section class="dn-panel" aria-labelledby="msb-h">
				<div class="bl-panel-head"><h2 id="msb-h">Billed through Microsoft</h2></div>
				${errorStateHTML({
					title: 'Couldn’t load your Microsoft subscriptions',
					body: 'The subscriptions endpoint did not answer. Your plan and billing in Microsoft are unaffected; retry in a moment.',
				})}
			</section>`;
		return;
	}
	if (!data.subscriptions.length) {
		el.innerHTML = `
			<section class="dn-panel msb-empty" aria-labelledby="msb-h">
				<div class="bl-panel-head"><h2 id="msb-h">Billed through Microsoft</h2></div>
				<p class="msb-note">No Microsoft subscription is linked to this account. <a href="/microsoft">Buy three.ws through Microsoft Marketplace</a> to pay on your Microsoft invoice.</p>
			</section>`;
		return;
	}
	el.innerHTML = `
		<section class="dn-panel" aria-labelledby="msb-h">
			<div class="bl-panel-head">
				<h2 id="msb-h">Billed through Microsoft</h2>
				<span class="bl-tagline">purchases made on Microsoft Marketplace, invoiced by Microsoft</span>
			</div>
			<div class="msb-status" role="status" aria-live="polite"></div>
			${data.subscriptions.map((s) => subscriptionHTML(s, data)).join('')}
		</section>`;
}

function injectStyles() {
	if (document.getElementById('msb-styles')) return;
	const s = document.createElement('style');
	s.id = 'msb-styles';
	s.textContent = `
		.msb-card { border: 1px solid var(--nxt-stroke); border-radius: var(--nxt-radius-sm); padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 1rem; background: var(--nxt-glass); }
		.msb-card + .msb-card { margin-top: 1rem; }
		.msb-kicker { font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--nxt-ink-fade); }
		.msb-title { font-size: 1.25rem; font-weight: 680; color: var(--nxt-ink); margin: .2rem 0; display: flex; align-items: center; gap: .55rem; flex-wrap: wrap; }
		.msb-facts { margin: 0; font-size: .84rem; color: var(--nxt-ink-dim); overflow-wrap: anywhere; }
		.msb-chip { font-size: .7rem; font-weight: 650; letter-spacing: .02em; padding: .18rem .55rem; border-radius: 999px; border: 1px solid currentColor; }
		.msb-chip-ok { color: var(--nxt-success); }
		.msb-chip-warn { color: var(--nxt-warn); }
		.msb-chip-bad { color: var(--nxt-danger); }
		.msb-chip-muted { color: var(--nxt-ink-fade); }
		.msb-explain { margin: 0; font-size: .82rem; line-height: 1.55; color: var(--nxt-ink-dim); border-left: 3px solid var(--nxt-stroke-strong); padding: .15rem 0 .15rem .75rem; }
		.msb-explain-ok { border-left-color: var(--nxt-success); }
		.msb-explain-warn { border-left-color: var(--nxt-warn); }
		.msb-explain-bad { border-left-color: var(--nxt-danger); color: var(--nxt-ink); }
		.msb-block { display: flex; flex-direction: column; gap: .6rem; }
		.msb-sub-head { display: flex; align-items: baseline; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
		.msb-sub-head h3 { margin: 0; font-size: .86rem; font-weight: 650; color: var(--nxt-ink); }
		.msb-dim { color: var(--nxt-ink-fade); font-size: .76rem; }
		.msb-meters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: .9rem; }
		.msb-meter { display: flex; flex-direction: column; gap: .35rem; }
		.msb-meter-head { display: flex; justify-content: space-between; gap: .5rem; font-size: .8rem; flex-wrap: wrap; }
		.msb-meter-name { color: var(--nxt-ink); font-weight: 600; }
		.msb-meter-val { color: var(--nxt-ink-dim); font-variant-numeric: tabular-nums; }
		.msb-meter-foot { font-size: .72rem; color: var(--nxt-ink-fade); line-height: 1.4; }
		.msb-bar { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--nxt-stroke) 70%, transparent); overflow: hidden; }
		.msb-bar-fill { display: block; height: 100%; border-radius: inherit; transition: width .4s ease; min-width: 0; }
		.msb-bar-ok { background: var(--nxt-accent); }
		.msb-bar-high { background: var(--nxt-warn); }
		.msb-bar-over { background: var(--nxt-danger); }
		.msb-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
		.msb-list li { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; padding: .5rem 0; border-bottom: 1px solid color-mix(in srgb, var(--nxt-stroke) 55%, transparent); }
		.msb-person { flex: 1 1 14rem; min-width: 0; font-size: .82rem; color: var(--nxt-ink); overflow-wrap: anywhere; }
		.msb-when { font-size: .72rem; }
		.msb-tag { font-size: .66rem; text-transform: uppercase; letter-spacing: .05em; padding: .05rem .4rem; border-radius: 4px; background: color-mix(in srgb, var(--nxt-accent) 16%, transparent); color: var(--nxt-ink); }
		.msb-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; font-size: .82rem; color: var(--nxt-ink-dim); }
		.msb-team a { color: var(--nxt-accent); }
		.msb-select { flex: 1 1 12rem; min-width: 0; max-width: 100%; font: inherit; font-size: .82rem; color: var(--nxt-ink); background: var(--nxt-glass); border: 1px solid var(--nxt-stroke); border-radius: 8px; padding: .45rem .55rem; }
		.msb-select:hover { border-color: var(--nxt-stroke-strong); }
		.msb-select:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 1px; }
		.msb-btn { font: inherit; font-size: .8rem; font-weight: 600; padding: .45rem .85rem; border-radius: 8px; border: 1px solid var(--nxt-accent); background: var(--nxt-accent); color: var(--nxt-on-accent, #fff); cursor: pointer; transition: filter .15s ease, transform .1s ease, background .15s ease; }
		.msb-btn:hover:not(:disabled) { filter: brightness(1.08); }
		.msb-btn:active:not(:disabled) { transform: translateY(1px); }
		.msb-btn:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 2px; }
		.msb-btn:disabled { opacity: .5; cursor: not-allowed; }
		.msb-btn-quiet { background: transparent; color: var(--nxt-ink); border-color: var(--nxt-stroke); }
		.msb-btn-quiet:hover:not(:disabled) { border-color: var(--nxt-stroke-strong); background: color-mix(in srgb, var(--nxt-stroke) 35%, transparent); filter: none; }
		.msb-note { margin: 0; font-size: .8rem; color: var(--nxt-ink-dim); line-height: 1.5; }
		.msb-note a, .msb-details a { color: var(--nxt-accent); }
		.msb-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: .7rem; }
		.msb-link { display: flex; flex-direction: column; gap: .25rem; border: 1px solid var(--nxt-stroke); border-radius: var(--nxt-radius-sm); padding: .75rem .9rem; text-decoration: none; transition: border-color .15s ease, transform .15s ease; }
		.msb-link:hover { border-color: var(--nxt-stroke-strong); transform: translateY(-1px); }
		.msb-link:active { transform: translateY(0); }
		.msb-link:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 2px; }
		.msb-link strong { color: var(--nxt-ink); font-size: .84rem; }
		.msb-link span { color: var(--nxt-ink-fade); font-size: .74rem; line-height: 1.4; }
		.msb-details { font-size: .8rem; color: var(--nxt-ink-dim); }
		.msb-details summary { cursor: pointer; color: var(--nxt-ink); font-weight: 600; padding: .25rem 0; border-radius: 4px; }
		.msb-details summary:hover { color: var(--nxt-accent); }
		.msb-details summary:focus-visible { outline: 2px solid var(--nxt-accent); outline-offset: 2px; }
		.msb-details p { margin: .45rem 0 0; line-height: 1.55; }
		.msb-fresh { margin: 0; font-size: .72rem; color: var(--nxt-ink-fade); }
		.msb-fresh-stale { color: var(--nxt-warn); }
		.msb-status:empty { display: none; }
		.msb-status { font-size: .8rem; padding: .5rem .75rem; border-radius: 8px; margin-bottom: .8rem; border: 1px solid var(--nxt-stroke); color: var(--nxt-ink); }
		.msb-status[data-tone="bad"] { border-color: var(--nxt-danger); color: var(--nxt-danger); }
		.msb-status[data-tone="ok"] { border-color: var(--nxt-success); }
		.msb-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
		@media (max-width: 480px) {
			.msb-card { padding: .9rem; }
			.msb-title { font-size: 1.08rem; }
			.msb-row .msb-btn { flex: 1 1 100%; }
		}
		@media (prefers-reduced-motion: reduce) {
			.msb-bar-fill, .msb-link, .msb-btn { transition: none; }
		}
	`;
	document.head.appendChild(s);
}

/** Mount the section into `el`. Loads independently of the rest of the billing page. */
export function mountMicrosoftBilling(el, { userId } = {}) {
	injectStyles();
	let last = null;

	const load = async () => {
		el.innerHTML = `<div class="dn-panel">${skeletonHTML(3, 'row')}</div>`;
		last = await get('/api/microsoft-marketplace/subscriptions').catch(() => null);
		render(el, last);
	};

	const say = (message, tone) => {
		const box = el.querySelector('.msb-status');
		if (!box) return;
		box.dataset.tone = tone;
		box.textContent = message;
	};

	const run = async (control, body, done) => {
		control.disabled = true;
		try {
			await post('/api/microsoft-marketplace/seats', body);
			await load();
			say(done, 'ok');
		} catch (err) {
			control.disabled = false;
			say(err?.message || 'That change did not go through. Try again.', 'bad');
		}
	};

	el.addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-ms-op]');
		if (!btn || btn.disabled) return;
		const op = btn.dataset.msOp;
		const target = btn.dataset.user === 'self' ? userId : btn.dataset.user;
		const body = { op, subscription_id: btn.dataset.sub };
		if (target) body.user_id = target;
		const done = op === 'unlink_team' ? 'Team unlinked. Seats held through it were freed.'
			: btn.dataset.user === 'self' ? 'You gave up your seat.'
			: 'Seat removed. That person has been notified.';
		run(btn, body, done);
	});

	el.addEventListener('submit', (e) => {
		const form = e.target.closest('form[data-ms-form]');
		if (!form) return;
		e.preventDefault();
		const op = form.dataset.msForm;
		const field = op === 'assign' ? 'user_id' : 'team_id';
		const select = form.elements[field];
		if (!select?.value) return;
		const label = select.options[select.selectedIndex]?.textContent || '';
		run(form.querySelector('button[type="submit"]'), { op, subscription_id: form.dataset.sub, [field]: select.value },
			op === 'assign' ? `Seat assigned to ${label.trim()}.` : `Linked ${label.trim()}. Its members can now hold seats.`);
	});

	attachRetry(el, load);
	return load();
}
