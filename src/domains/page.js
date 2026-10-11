// /domains: search, quote, confirmed register (credits) and connect to an agent.

import { domainsApi, esc, fmtUsd } from './api.js';

const $ = (id) => document.getElementById(id);
const CONTACT_KEY = 'twx_domain_contact';

let selected = null;
let pendingKey = null;

function banner(kind, html) {
	$('dm-banner').innerHTML = html ? `<div class="dm-banner ${kind}">${html}</div>` : '';
}

function loadContact() {
	try {
		return JSON.parse(localStorage.getItem(CONTACT_KEY) || '{}');
	} catch {
		return {};
	}
}

function saveContact(c) {
	try {
		localStorage.setItem(CONTACT_KEY, JSON.stringify(c));
	} catch {}
}

async function showQuota() {
	try {
		const q = await domainsApi.quota();
		if (q.exhausted) {
			banner('warn', 'The registrar is at its daily request limit. Pricing still works from the snapshot; live availability resumes after the daily reset.');
		}
	} catch {}
}

function resultRow(r) {
	const act = r.available
		? `<button class="dm-btn act" type="button" data-pick="${esc(r.domain)}">Register</button>`
		: `<span class="why act">${esc(r.message || r.reason)}</span>`;
	return `<li class="dm-row ${r.available ? '' : 'taken'}">
		<div><div class="name">${esc(r.domain)}</div><div class="why">${r.available ? 'Available' : esc(r.reason)}</div></div>
		<div class="price">${r.available ? `${fmtUsd(r.registrationUsd)}<small>per year, renews at ${fmtUsd(r.renewalUsd)}</small>` : ''}</div>
		${act}</li>`;
}

async function runSearch(q) {
	const status = $('dm-search-status');
	const list = $('dm-results');
	status.textContent = 'Searching…';
	list.innerHTML = '<li class="dm-skel"></li><li class="dm-skel"></li><li class="dm-skel"></li>';
	try {
		const out = await domainsApi.search(q);
		list.innerHTML = out.results.length ? out.results.map(resultRow).join('') : '<li class="dm-empty">No names found. Try a shorter keyword.</li>';
		status.textContent = `${out.availableCount} available of ${out.results.length}. ${out.cached ? 'Cached result.' : 'Live from the registrar.'}`;
	} catch (e) {
		list.innerHTML = '';
		status.textContent = e.code === 'domains_quota_exhausted' ? e.message : e.status === 429 ? 'Too many searches this hour. Try again later.' : `${e.message} Check your connection and search again.`;
	}
}

function field(id, label, value, { wide = false, type = 'text', placeholder = '' } = {}) {
	return `<label class="dm-field ${wide ? 'wide' : ''}" for="${id}">${label}<input id="${id}" type="${type}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" /></label>`;
}

function openRegister(domain) {
	selected = domain;
	pendingKey = null;
	const c = loadContact();
	$('dm-register').hidden = false;
	$('dm-reg-body').innerHTML = `
		<p><strong>${esc(domain)}</strong>. The registrant contact is sent to the registrar and is hidden from the public WHOIS by default.</p>
		<form id="dm-form" class="dm-form" novalidate>
			${field('c-name', 'Full name', c.name)}
			${field('c-email', 'Email', c.email, { type: 'email' })}
			${field('c-phone', 'Phone (+14155550123)', c.phone, { type: 'tel' })}
			${field('c-country', 'Country (2 letters)', c.country, { placeholder: 'US' })}
			${field('c-addr', 'Street address', (c.address_lines || [])[0], { wide: true })}
			${field('c-city', 'City', c.city)}
			${field('c-region', 'State or region', c.region)}
			${field('c-postal', 'Postal code', c.postal_code)}
			<label class="dm-check wide"><input id="c-renew" type="checkbox" /> Renew automatically each year from my credits</label>
			<div class="dm-actions wide"><button class="dm-btn" type="submit">Get exact quote</button><button class="dm-btn ghost" type="button" id="dm-cancel">Cancel</button></div>
		</form>
		<div id="dm-quote"></div>`;
	$('dm-register').scrollIntoView({ behavior: 'smooth', block: 'start' });
	$('dm-cancel').addEventListener('click', () => ($('dm-register').hidden = true));
	$('dm-form').addEventListener('submit', (e) => {
		e.preventDefault();
		getQuote();
	});
}

function readContact() {
	const v = (id) => $(id).value.trim();
	return { name: v('c-name'), email: v('c-email'), phone: v('c-phone'), country: v('c-country'), address_lines: [v('c-addr')], city: v('c-city'), region: v('c-region'), postal_code: v('c-postal') };
}

async function getQuote() {
	const box = $('dm-quote');
	const contact = readContact();
	saveContact(contact);
	box.innerHTML = '<div class="dm-skel"></div>';
	try {
		const q = await domainsApi.quote({ domain: selected, contact, auto_renew: $('c-renew').checked });
		const short = !q.payment.sufficient;
		box.innerHTML = `<div class="dm-quote" aria-live="polite">
			<div><span>${esc(q.domain)}, ${q.termYears} year</span><span>${fmtUsd(q.priceUsd)}</span></div>
			<div><span>Renews at</span><span>${fmtUsd(q.renewalUsd)} / year</span></div>
			<div><span>Your credits</span><span>${fmtUsd(q.payment.balanceUsd)}</span></div>
			<div class="total"><span>Charged now</span><span>${fmtUsd(q.priceUsd)}</span></div>
		</div>
		<p class="dm-status">${esc(q.autoRenewNote)}</p>
		${short ? '<p class="dm-banner warn">Your credits do not cover this. <a href="/credits">Add credits</a> then quote again.</p>' : ''}
		<div class="dm-actions"><button id="dm-confirm" class="dm-btn" type="button" ${short ? 'disabled' : ''}>Confirm and pay ${fmtUsd(q.priceUsd)} from credits</button></div>`;
		$('dm-confirm').addEventListener('click', () => confirmRegister(q));
	} catch (e) {
		const missing = e.detail?.missing?.length ? ` Missing: ${esc(e.detail.missing.join(', '))}.` : '';
		box.innerHTML = e.status === 401
			? '<p class="dm-banner warn"><a href="/login?next=/domains">Sign in</a> to register a domain.</p>'
			: `<p class="dm-banner err">${esc(e.message)}${missing}</p>`;
	}
}

async function confirmRegister(q) {
	const btn = $('dm-confirm');
	btn.disabled = true;
	btn.textContent = 'Registering…';
	pendingKey = pendingKey || crypto.randomUUID();
	try {
		const out = await domainsApi.register({
			domain: q.domain,
			contact: readContact(),
			auto_renew: q.autoRenew,
			expected_price_usd: q.priceUsd,
			confirm: true,
			idempotency_key: pendingKey,
			source: 'api',
		});
		$('dm-quote').innerHTML = `<p class="dm-banner">Registration submitted for ${esc(out.registration.domain)}. This usually settles within a minute.</p>`;
		await pollRegistration(out.registration.id);
		loadMine();
	} catch (e) {
		btn.disabled = false;
		btn.textContent = 'Retry';
		const msg = e.code === 'price_changed' ? 'The price changed. Get a new quote.' : e.message;
		$('dm-quote').insertAdjacentHTML('beforeend', `<p class="dm-banner err">${esc(msg)} Nothing is charged twice if you retry.</p>`);
	}
}

async function pollRegistration(id) {
	for (let i = 0; i < 30; i++) {
		const s = await domainsApi.status(id).catch(() => null);
		if (s && s.status !== 'registering') {
			banner(s.status === 'active' ? '' : 'err', s.status === 'active' ? `${esc(s.domain)} is registered.` : `Registration failed: ${esc(s.error || 'unknown')}. Your credits were refunded.`);
			return;
		}
		await new Promise((r) => setTimeout(r, 4000));
	}
	banner('warn', 'Still registering. It will appear under Your domains when it settles.');
}

async function loadMine() {
	const box = $('dm-mine');
	box.innerHTML = '<div class="dm-skel"></div>';
	try {
		const { registrations, hosts } = await domainsApi.list();
		if (!registrations.length) {
			box.innerHTML = '<p class="dm-empty">No domains yet. Search above and register one.</p>';
			return;
		}
		const hostMap = new Map(hosts.map((h) => [h.host, h]));
		const agents = await fetch('/api/agents', { credentials: 'include' }).then((r) => (r.ok ? r.json() : { agents: [] })).catch(() => ({ agents: [] }));
		const opts = (agents.agents || []).map((a) => `<option value="${esc(a.id)}">${esc(a.name || a.id)}</option>`).join('');
		box.innerHTML = `<table class="dm-table"><thead><tr><th>Domain</th><th>Status</th><th>Expires</th><th>Serve agent page</th></tr></thead><tbody>${registrations
			.map((r) => {
				const h = hostMap.get(r.domain);
				const connect = r.status !== 'active'
					? ''
					: h
						? `<span class="dm-pill ${h.status === 'live' ? 'ok' : ''}">${esc(h.status.replace('_', ' '))}</span> ${h.status === 'live' ? `<a href="https://${esc(h.host)}">Open</a>` : `<button class="dm-btn ghost" data-recheck="${esc(r.domain)}">Check</button>`}`
						: opts
							? `<select aria-label="Agent for ${esc(r.domain)}" data-agent-for="${esc(r.domain)}">${opts}</select> <button class="dm-btn" data-connect="${esc(r.domain)}">Connect</button>`
							: '<a href="/create">Create an agent first</a>';
				return `<tr><td>${esc(r.domain)}</td><td><span class="dm-pill ${r.status === 'active' ? 'ok' : ''}">${esc(r.status)}</span></td><td>${r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : ''}</td><td>${connect}</td></tr>`;
			})
			.join('')}</tbody></table><p id="dm-connect-note" class="dm-status" aria-live="polite"></p>`;
	} catch (e) {
		box.innerHTML = e.status === 401 ? '<p class="dm-empty"><a href="/login?next=/domains">Sign in</a> to see your domains.</p>' : `<p class="dm-banner err">${esc(e.message)} <button class="dm-btn ghost" id="dm-retry">Retry</button></p>`;
		$('dm-retry')?.addEventListener('click', loadMine);
	}
}

async function connect(domain) {
	const note = $('dm-connect-note');
	const agentId = document.querySelector(`[data-agent-for="${CSS.escape(domain)}"]`)?.value;
	note.textContent = 'Setting up DNS and the certificate…';
	try {
		const out = await domainsApi.connect({ domain, agent_id: agentId });
		note.textContent = out.message || `Connecting ${domain}. The certificate can take several minutes to provision.`;
		loadMine();
	} catch (e) {
		note.textContent = e.message;
	}
}

async function recheck(domain) {
	const note = $('dm-connect-note');
	try {
		const s = await domainsApi.connectStatus(domain);
		note.textContent = `${domain}: ${s.status}${s.error ? `. ${s.error}` : ''}`;
		loadMine();
	} catch (e) {
		note.textContent = e.message;
	}
}

document.addEventListener('click', (e) => {
	const t = e.target.closest('[data-pick],[data-connect],[data-recheck]');
	if (!t) return;
	if (t.dataset.pick) openRegister(t.dataset.pick);
	else if (t.dataset.connect) connect(t.dataset.connect);
	else recheck(t.dataset.recheck);
});

$('dm-search').addEventListener('submit', (e) => {
	e.preventDefault();
	const q = $('dm-q').value.trim();
	if (q) {
		history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
		runSearch(q);
	}
});

const params = new URLSearchParams(location.search);
const pre = params.get('domain') || params.get('q');
if (pre) {
	$('dm-q').value = pre;
	runSearch(pre);
}
showQuota();
loadMine();
