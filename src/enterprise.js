/**
 * /enterprise (pages/enterprise.html): buying paths, identity, security,
 * Microsoft surfaces, support, the printable procurement packet and the
 * contact form.
 *
 *   Content     data/enterprise.json (buy paths, identity, security, support,
 *               attestation, publisher), data/microsoft-surfaces.json (the same
 *               surface statuses /microsoft shows), data/subprocessors.json.
 *   Live probe  /api/microsoft-marketplace/status: whether in-Marketplace
 *               purchase and Sign in with Microsoft are switched on.
 *   Contact     POST /api/enterprise/contact, stored in the Microsoft leads
 *               pipeline and shown at /admin/microsoft/leads.
 *
 * Pure shaping lives in src/enterprise-model.js (tests/enterprise.test.js).
 */

import enterprise from '../data/enterprise.json';
import surfaceData from '../data/microsoft-surfaces.json';
import subprocessors from '../data/subprocessors.json';
import {
	INTERESTS,
	TEAM_SIZES,
	identityStatus,
	marketplaceTarget,
	marketplacePurchaseLine,
	publisherLine,
} from './enterprise-model.js';

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === null || v === undefined || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
	return node;
}

function link(url, label, cls) {
	const external = /^https?:/.test(url);
	return el('a', { href: url, class: cls, target: external ? '_blank' : null, rel: external ? 'noopener' : null }, label);
}

const TONE_CLASS = { ok: 'is-good', pending: 'is-warn', neutral: 'is-off', unknown: 'is-off' };
const SURFACE_TONE = { live: 'is-good', 'pending review': 'is-warn', 'built, awaiting publish': 'is-off' };

function badge(text, tone) {
	return el('span', { class: `tr-badge ${tone}` }, text);
}

function probeLine({ tone, text }) {
	return el('p', { class: `ent-probe ent-probe-${tone}` }, el('span', { class: 'ent-probe-dot', 'aria-hidden': 'true' }), text);
}

// ── live probe ──────────────────────────────────────────────────────────────

let probePromise = null;
function readProbe() {
	if (!probePromise) {
		probePromise = fetch('/api/microsoft-marketplace/status', { headers: { accept: 'application/json' } })
			.then((r) => (r.ok ? r.json() : null))
			.catch(() => null);
	}
	return probePromise;
}

// ── sections ────────────────────────────────────────────────────────────────

function renderHeroCta() {
	const target = marketplaceTarget(enterprise);
	const cta = $('#ent-mp-cta');
	cta.href = target.url;
	cta.textContent = target.label;
}

function renderGlance() {
	const a = enterprise.attestation;
	$('#ent-glance-attest').textContent = `Attestation ${a.status}`;
	$('#ent-glance-attest-detail').textContent = 'Microsoft 365 Publisher Attestation. No SOC 2 or ISO report today.';
}

function renderBuy() {
	const root = $('#ent-buy');
	const target = marketplaceTarget(enterprise);
	const cards = enterprise.buy.map((b) => {
		const slot = b.probe ? el('div', { class: 'ent-probe-slot', 'aria-live': 'polite' }, el('span', { class: 'ent-skel', 'aria-label': 'Checking live status' })) : null;
		const action = b.probe
			? link(target.url, target.label, 'tr-btn tr-btn-primary')
			: el('a', { href: b.action.url, class: 'tr-btn', 'data-interest': b.id === 'invoice' ? 'invoice' : null }, b.action.label);
		const card = el('article', { class: 'ent-card' }, el('h3', { text: b.name }), el('p', { text: b.summary }), slot, el('div', { class: 'ent-card-foot' }, action));
		if (b.probe === 'marketplace') {
			readProbe().then((probe) => slot.replaceChildren(probeLine(marketplacePurchaseLine(probe))));
		}
		return card;
	});
	root.replaceChildren(...cards);
	root.removeAttribute('aria-busy');
}

function renderIdentity() {
	const body = $('#ent-identity');
	const rows = enterprise.identity.map((item) => {
		const statusCell = el('td', { 'data-label': 'Status' });
		const paint = (probe) => {
			const s = identityStatus(item, probe);
			statusCell.replaceChildren(badge(s.label, TONE_CLASS[s.tone]));
		};
		if (item.probe) {
			statusCell.append(el('span', { class: 'ent-skel', 'aria-label': 'Checking live status' }));
			readProbe().then(paint);
		} else {
			paint(null);
		}
		return el(
			'tr',
			{},
			el('td', { 'data-label': 'Feature' }, item.name),
			statusCell,
			el('td', { 'data-label': 'Detail' }, item.detail, ' ', link(item.link.url, item.link.label)),
		);
	});
	body.replaceChildren(...rows);
}

function renderSecurity() {
	const rows = enterprise.security.map((r) =>
		el('tr', {}, el('td', { 'data-label': 'Topic' }, r.label), el('td', { 'data-label': 'Answer' }, r.value, ' ', r.link ? link(r.link, 'Full answer') : null)),
	);
	const a = enterprise.attestation;
	rows.push(
		el(
			'tr',
			{},
			el('td', { 'data-label': 'Topic' }, 'Compliance'),
			el('td', { 'data-label': 'Answer' }, badge(a.status, 'is-warn'), ' ', `${a.name}. ${a.detail} `, link('/trust#compliance', 'Full status')),
		),
	);
	$('#ent-security').replaceChildren(...rows);
}

function renderSurfaces() {
	const byId = new Map(surfaceData.surfaces.map((s) => [s.id, s]));
	const cards = enterprise.surfaces
		.map((id) => byId.get(id))
		.filter(Boolean)
		.map((s) =>
			el(
				'article',
				{ class: 'ent-card' },
				el('div', { class: 'ent-card-top' }, el('span', { class: 'ent-kind', text: s.kind }), badge(s.status, SURFACE_TONE[s.status] || 'is-off')),
				el('h3', { text: s.name }),
				el('p', { text: s.today }),
				el('div', { class: 'ent-card-foot' }, link(s.action.url, s.action.label, 'tr-btn'), link(s.evidence.url, s.evidence.label, 'ent-textlink')),
			),
		);
	$('#ent-surfaces').replaceChildren(...cards);
}

function dlRows(root, rows) {
	root.replaceChildren(
		...rows.flatMap(({ label, value, link: href, linkLabel }) => [
			el('dt', { text: label }),
			el('dd', {}, value, href ? [' ', link(href, linkLabel || 'Details')] : null),
		]),
	);
}

function renderSupport() {
	dlRows($('#ent-support'), enterprise.support.map((r) => ({ ...r, linkLabel: 'Open' })));
}

function findSecurity(label) {
	return enterprise.security.find((r) => r.label === label)?.value || '';
}

function renderPacket() {
	const c = enterprise.contacts;
	const ids = enterprise.identity.map((i) => i.name).join(', ');
	const rows = [
		{ label: 'Vendor', value: publisherLine(enterprise) },
		{ label: 'Website and source', value: `${enterprise.publisher.website}. Source code public under ${enterprise.publisher.license}: ${enterprise.publisher.source}` },
		{ label: 'Hosting regions', value: findSecurity('Hosting'), link: '/trust#hosting' },
		{ label: 'Encryption in transit', value: findSecurity('Encryption in transit') },
		{ label: 'Encryption at rest', value: findSecurity('Encryption at rest') },
		{ label: 'Single sign-on and provisioning', value: `${ids}. Built; statuses on three.ws/enterprise.`, link: '/docs/enterprise-sso' },
		{ label: 'Data retention', value: findSecurity('Retention'), link: '/trust#retention' },
		{ label: 'Backups', value: findSecurity('Backups') },
		{ label: 'Compliance', value: `${enterprise.attestation.name}: ${enterprise.attestation.status}. ${enterprise.attestation.detail}`, link: '/trust#compliance' },
		{ label: 'How to buy', value: `Microsoft Marketplace (${marketplaceTarget(enterprise).url}), invoice or purchase order, or self-serve at three.ws/pricing.` },
		{ label: 'Contacts', value: `Sales ${c.sales}. Security ${c.security}. Privacy ${c.privacy}.` },
	];
	dlRows($('#ent-packet'), rows);
	$('#ent-packet-meta').textContent = `three.ws procurement packet. Data reviewed ${enterprise.updated}. Printed ${new Date().toISOString().slice(0, 10)} from https://three.ws/enterprise.`;

	const sp = subprocessors.subprocessors.map((s) =>
		el('tr', {}, el('td', { 'data-label': 'Name' }, s.name), el('td', { 'data-label': 'Purpose' }, s.purpose), el('td', { 'data-label': 'Region' }, s.region)),
	);
	$('#ent-subprocessors').replaceChildren(...sp);
	$('#ent-sp-meta').replaceChildren(
		`${subprocessors.subprocessors.length} subprocessors, last reviewed ${subprocessors.lastReviewed}. Data each one sees and its terms: `,
		link('/trust/subprocessors', 'three.ws/trust/subprocessors'),
		'.',
	);
}

function renderOfferStructuredData() {
	const offer = String(enterprise.marketplace.offer_url || '').trim();
	if (!offer) return;
	const ld = {
		'@context': 'https://schema.org',
		'@type': 'Offer',
		name: 'three.ws on Microsoft Marketplace',
		url: offer,
		seller: { '@id': 'https://three.ws/#organization' },
	};
	document.head.append(el('script', { type: 'application/ld+json', text: JSON.stringify(ld) }));
}

// ── print ───────────────────────────────────────────────────────────────────

function wirePrint() {
	document.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-print-packet]');
		if (!btn) return;
		document.documentElement.classList.add('ent-printing');
		window.print();
	});
	window.addEventListener('afterprint', () => document.documentElement.classList.remove('ent-printing'));
}

// ── contact form ────────────────────────────────────────────────────────────

function fillSelects() {
	const interest = $('#ent-interest');
	interest.replaceChildren(...Object.entries(INTERESTS).map(([value, label]) => el('option', { value }, label)));
	interest.value = 'marketplace';
	const team = $('#ent-team');
	team.replaceChildren(el('option', { value: '' }, 'Choose one'), ...TEAM_SIZES.map((v) => el('option', { value: v }, `${v} people`)));
}

function wireInterestLinks() {
	document.addEventListener('click', (e) => {
		const a = e.target.closest('a[data-interest]');
		if (!a) return;
		const sel = $('#ent-interest');
		if (Object.hasOwn(INTERESTS, a.dataset.interest)) sel.value = a.dataset.interest;
		requestAnimationFrame(() => $('#ent-name').focus({ preventScroll: true }));
	});
}

function clearErrors(form) {
	for (const p of form.querySelectorAll('.ent-err')) p.textContent = '';
	for (const i of form.querySelectorAll('[aria-invalid]')) i.removeAttribute('aria-invalid');
	$('#ent-form-banner').hidden = true;
}

function showFieldErrors(form, errors) {
	let first = null;
	for (const [name, msg] of Object.entries(errors || {})) {
		const input = form.elements.namedItem(name);
		const out = $(`#ent-${name}-err`);
		if (out) out.textContent = msg;
		if (input) {
			input.setAttribute('aria-invalid', 'true');
			first ??= input;
		}
	}
	if (first) first.focus();
	return Boolean(first);
}

function clientErrors(data) {
	const errors = {};
	if (!data.name.trim()) errors.name = 'Enter your name.';
	if (!data.email.trim()) errors.email = 'Enter your work email.';
	else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) errors.email = 'Enter a valid email address, like name@company.com.';
	if (!data.company.trim()) errors.company = 'Enter your company name.';
	return errors;
}

function banner(text) {
	const b = $('#ent-form-banner');
	b.textContent = text;
	b.hidden = false;
}

function wireForm() {
	const form = $('#ent-form');
	const submit = $('#ent-submit');
	const done = $('#ent-done');

	form.addEventListener('input', (e) => {
		const t = e.target;
		if (t.getAttribute('aria-invalid')) {
			t.removeAttribute('aria-invalid');
			const out = $(`#ent-${t.name}-err`);
			if (out) out.textContent = '';
		}
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		clearErrors(form);
		const data = Object.fromEntries(new FormData(form).entries());
		if (showFieldErrors(form, clientErrors(data))) return;

		submit.disabled = true;
		submit.classList.add('is-busy');
		submit.textContent = 'Sending';
		form.setAttribute('aria-busy', 'true');
		try {
			const res = await fetch('/api/enterprise/contact', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify(data),
			});
			const body = await res.json().catch(() => ({}));
			if (res.ok && body.ok) {
				form.hidden = true;
				$('#ent-done-text').textContent = body.id
					? `A person will reply to ${data.email.trim()} within one business day. Your reference is ${body.id.slice(0, 8)}.`
					: `A person will reply to ${data.email.trim()} within one business day.`;
				done.hidden = false;
				done.focus();
				return;
			}
			if (res.status === 400 && body.fields) {
				showFieldErrors(form, body.fields);
				banner('Some fields need attention. Fix the highlighted ones and send again.');
			} else if (res.status === 429) {
				banner(body.error_description || 'Too many messages from this network. Wait a few minutes and try again, or email support@three.ws.');
			} else {
				banner(`We could not save your message (${body.error_description || `server answered ${res.status}`}). Your details are still in the form: send again, or email support@three.ws.`);
			}
		} catch {
			banner('Your message did not reach us because the network dropped. Your details are still in the form: check your connection and send again, or email support@three.ws.');
		} finally {
			submit.disabled = false;
			submit.classList.remove('is-busy');
			submit.textContent = 'Send';
			form.removeAttribute('aria-busy');
		}
	});

	$('#ent-again').addEventListener('click', () => {
		form.reset();
		$('#ent-interest').value = 'marketplace';
		done.hidden = true;
		form.hidden = false;
		$('#ent-name').focus();
	});
}

renderHeroCta();
renderGlance();
renderBuy();
renderIdentity();
renderSecurity();
renderSurfaces();
renderSupport();
renderPacket();
renderOfferStructuredData();
fillSelects();
wirePrint();
wireInterestLinks();
wireForm();
