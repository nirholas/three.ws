/**
 * /link-device: the device side of a link code (api/auth/link-codes/[action].js).
 *
 * The owner mints a code on /dashboard/account#linked-devices and opens this
 * page on the phone or desktop app that should join the account, usually by
 * scanning the QR the account page shows. This page:
 *
 *   1. Reads the code from `?code=` or lets the person type it.
 *   2. Shows what will be linked (device kind, a name the owner will recognise)
 *      and claims the code on an explicit press. Nothing is claimed on load, so
 *      a code opened by a link-preview fetcher stays unclaimed.
 *   3. Polls until the owner confirms or rejects in their signed-in browser.
 *      A phone receives a session (the cookie is set by the poll response and
 *      the page moves on to the dashboard); a desktop app receives an API key,
 *      shown exactly once with a copy button.
 *
 * Expired, rejected and already-used codes each get their own screen because
 * each needs a different next step.
 */

import { apiFetch } from './api.js';

const root = document.getElementById('cla-root');
const ACCOUNT_URL = '/dashboard/account#linked-devices';
const KIND_COPY = {
	phone: { label: 'Phone', hint: 'Signs this browser in; no key to copy' },
	desktop: { label: 'Desktop app', hint: 'Receives an API key for the app' },
};

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat()) {
		if (c == null) continue;
		node.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return node;
}

function render(...nodes) {
	root.replaceChildren(...nodes);
	root.setAttribute('aria-busy', 'false');
}

function normalizeCode(input) {
	const letters = String(input || '').toUpperCase().replace(/[^A-Z]/g, '');
	return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null;
}

function statusCard({ tone, icon, title, body, actions = [] }) {
	return el('section', { class: 'cla-card' },
		el('div', { class: 'cla-status-icon', 'data-tone': tone, 'aria-hidden': 'true', text: icon }),
		el('h2', { class: 'cla-card-title', text: title }),
		el('p', { class: 'cla-muted' }, body),
		actions.length ? el('div', { class: 'cla-actions' }, actions) : null,
	);
}

// ── What this device looks like ──────────────────────────────────────────────

function isMobile() {
	if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') return navigator.userAgentData.mobile;
	return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function platformName() {
	const ua = navigator.userAgent;
	if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
	if (/Android/.test(ua)) return 'Android';
	if (/Mac OS X/.test(ua)) return 'macOS';
	if (/Windows/.test(ua)) return 'Windows';
	if (/CrOS/.test(ua)) return 'ChromeOS';
	if (/Linux/.test(ua)) return 'Linux';
	return navigator.platform || 'Unknown';
}

function browserName() {
	const ua = navigator.userAgent;
	if (/Edg\//.test(ua)) return 'Edge';
	if (/OPR\//.test(ua)) return 'Opera';
	if (/Firefox\//.test(ua)) return 'Firefox';
	if (/Chrome\//.test(ua)) return 'Chrome';
	if (/Safari\//.test(ua)) return 'Safari';
	return 'Browser';
}

function defaultDeviceName() {
	return `${browserName()} on ${platformName()}`;
}

// ── Entry: no code yet ───────────────────────────────────────────────────────

function renderCodeEntry(message = '') {
	const input = el('input', {
		class: 'cla-input',
		id: 'ld-code-input',
		name: 'code',
		autocomplete: 'one-time-code',
		autocapitalize: 'characters',
		spellcheck: 'false',
		inputmode: 'text',
		maxlength: '9',
		placeholder: 'BCDF-GHJK',
		'aria-describedby': message ? 'ld-code-error' : null,
		'aria-invalid': message ? 'true' : null,
	});
	const form = el('form', {
		class: 'cla-form',
		onsubmit: (e) => {
			e.preventDefault();
			const code = normalizeCode(input.value);
			if (!code) return renderCodeEntry('Codes are eight letters, like BCDF-GHJK. Check your account page.');
			history.replaceState(null, '', `/link-device?code=${encodeURIComponent(code)}`);
			renderClaim(code);
		},
	},
		el('label', { class: 'sr-only', for: 'ld-code-input', text: 'Link code' }),
		input,
		el('button', { class: 'btn btn--primary', type: 'submit', text: 'Continue' }),
	);
	render(el('section', { class: 'cla-card' },
		el('h2', { class: 'cla-card-title', text: 'Enter the code from your account page' }),
		el('p', { class: 'cla-muted' }, 'On a signed-in browser, open ', el('a', { href: ACCOUNT_URL, text: 'Linked devices' }), ', press "Link a phone" or "Link a desktop app", and type the eight-letter code here.'),
		form,
		message ? el('p', { class: 'cla-error', id: 'ld-code-error', role: 'alert', text: message }) : null,
	));
	input.focus();
}

// ── Claim: say what will be linked, then claim on an explicit press ─────────

function renderClaim(code, { kind = isMobile() ? 'phone' : 'desktop', name = defaultDeviceName(), errorMessage = '' } = {}) {
	const nameInput = el('input', { class: 'cla-input', id: 'ld-name', name: 'name', value: name, maxlength: '80', autocomplete: 'off', style: 'flex:1 1 100%' });
	const kinds = Object.entries(KIND_COPY).map(([value, copy]) => {
		const radio = el('input', { type: 'radio', name: 'kind', value, checked: value === kind });
		return { radio, item: el('label', { class: 'ld-kind' }, radio, el('span', {}, copy.label, el('small', { text: copy.hint }))) };
	});
	const submit = el('button', { class: 'btn btn--primary', type: 'submit', text: 'Link this device' });
	const form = el('form', {
		class: 'ld-form',
		onsubmit: async (e) => {
			e.preventDefault();
			const chosen = kinds.find((k) => k.radio.checked)?.radio.value || kind;
			const label = nameInput.value.trim() || defaultDeviceName();
			submit.disabled = true;
			submit.setAttribute('aria-busy', 'true');
			await claim(code, chosen, label);
		},
	},
		el('div', { class: 'ld-field' }, el('label', { for: 'ld-name', text: 'How this device appears on your account page' }), nameInput),
		el('div', { class: 'ld-field' }, el('span', { text: 'What this device is' }), el('div', { class: 'ld-kinds', role: 'radiogroup', 'aria-label': 'Device kind' }, kinds.map((k) => k.item))),
		el('div', { class: 'cla-actions' }, submit),
		errorMessage ? el('p', { class: 'cla-error', role: 'alert', text: errorMessage }) : null,
	);
	render(el('section', { class: 'cla-card' },
		el('h2', { class: 'cla-card-title', text: 'Link this device to your account' }),
		el('div', { class: 'cla-code', 'aria-label': `Code ${code.split('').join(' ')}`, text: code }),
		el('p', { class: 'cla-muted', text: 'Pressing the button sends this code to three.ws. The account that minted it then sees this device by name and confirms or rejects it. Nothing is linked until they confirm.' }),
		form,
	));
	submit.focus();
}

async function claim(code, kind, name) {
	let res;
	try {
		res = await apiFetch('/api/auth/link-codes/claim', {
			method: 'POST',
			allowAnonymous: true,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code, device_kind: kind, device: { name, platform: platformName(), client: `${browserName()} (web)` } }),
		});
	} catch {
		return renderClaim(code, { kind, name, errorMessage: 'Your connection dropped before the code was sent. Nothing changed; try again.' });
	}
	const data = await res.json().catch(() => ({}));
	if (res.ok) return waitForDecision(code, data);
	switch (data.error) {
		case 'unknown_code':
		case 'invalid_code':
			return renderCodeEntry(data.message || 'No link request is waiting for that code. Check your account page.');
		case 'wrong_kind':
			return renderClaim(code, { kind: kind === 'phone' ? 'desktop' : 'phone', name, errorMessage: data.message || 'That code was minted for a different kind of device. Pick the other option.' });
		case 'expired':
			return renderExpired();
		case 'already_used':
			return renderUsed();
		case 'rate_limited':
			return renderClaim(code, { kind, name, errorMessage: 'Too many attempts from this network. Wait a minute and try again.' });
		default:
			return renderClaim(code, { kind, name, errorMessage: data.message || `The server answered ${res.status}. Nothing changed; try again.` });
	}
}

// ── Wait for the owner to confirm in their signed-in browser ─────────────────

async function waitForDecision(code, claimed) {
	const interval = Math.max(1000, Number(claimed.poll_every_ms) || 2000);
	const deadline = new Date(claimed.expires_at).getTime();
	const cancel = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Start over' });
	let stopped = false;
	cancel.addEventListener('click', () => { stopped = true; renderCodeEntry(); });
	render(el('section', { class: 'cla-card' },
		el('h2', { class: 'cla-card-title', text: 'Confirm on your account page' }),
		el('p', { class: 'cla-muted' }, 'Go back to ', el('a', { href: ACCOUNT_URL, target: '_blank', rel: 'noopener', text: 'Linked devices' }), ' in the browser that minted the code. It now shows this device under "Waiting for your confirmation"; press Confirm there and this page finishes on its own.'),
		el('div', { class: 'ld-wait' }, el('span', { class: 'ld-pulse', 'aria-hidden': 'true' }), el('span', { text: `Waiting for confirmation. The code expires at ${new Date(deadline).toLocaleTimeString()}.` })),
		el('div', { class: 'cla-actions' }, cancel),
	));
	const url = `/api/auth/link-codes/poll?id=${encodeURIComponent(claimed.id)}&secret=${encodeURIComponent(claimed.claim_secret)}`;
	while (!stopped && Date.now() < deadline + interval) {
		await new Promise((r) => setTimeout(r, interval));
		if (stopped) return;
		let res;
		try {
			res = await apiFetch(url, { allowAnonymous: true });
		} catch {
			continue;
		}
		if (res.status === 404) return renderRejected();
		if (res.status === 429) { await new Promise((r) => setTimeout(r, interval * 2)); continue; }
		const data = await res.json().catch(() => ({}));
		if (!res.ok) continue;
		if (data.status === 'claimed') continue;
		if (data.status === 'confirmed') return renderConfirmed(data);
		if (data.status === 'rejected') return renderRejected();
		if (data.status === 'expired') return renderExpired();
		if (data.status === 'consumed') return renderUsed();
	}
	if (!stopped) renderExpired();
}

// ── Outcomes ─────────────────────────────────────────────────────────────────

function renderConfirmed(data) {
	const credential = data.credential || {};
	if (credential.kind === 'session') {
		render(statusCard({
			tone: 'ok', icon: '✓', title: 'Linked. Signing you in',
			body: 'This device is now on your account and is signed in. Taking you to your dashboard.',
			actions: [el('a', { class: 'btn btn--primary', href: '/dashboard', text: 'Open the dashboard' })],
		}));
		setTimeout(() => location.assign('/dashboard'), 800);
		return;
	}
	if (credential.kind === 'api_key' && credential.secret) {
		const copy = el('button', { class: 'btn btn--secondary', type: 'button', text: 'Copy key' });
		copy.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(credential.secret);
				copy.textContent = 'Copied';
			} catch {
				copy.textContent = 'Select and copy it by hand';
			}
		});
		return render(el('section', { class: 'cla-card' },
			el('div', { class: 'cla-status-icon', 'data-tone': 'ok', 'aria-hidden': 'true', text: '✓' }),
			el('h2', { class: 'cla-card-title', text: 'Linked. Here is the key for your app' }),
			el('p', { class: 'cla-muted', text: 'Paste this API key into the desktop app. It is shown once; if you lose it, revoke this device from your account page and link again.' }),
			el('div', { class: 'ld-secret' }, el('code', { text: credential.secret }), copy),
			el('div', { class: 'cla-actions' }, el('a', { class: 'btn btn--ghost', href: ACCOUNT_URL, text: 'View linked devices' })),
		));
	}
	render(statusCard({
		tone: 'ok', icon: '✓', title: 'Linked',
		body: 'This device is now on your account. You can close this page.',
		actions: [el('a', { class: 'btn btn--secondary', href: ACCOUNT_URL, text: 'View linked devices' })],
	}));
}

function renderExpired() {
	render(statusCard({
		tone: 'bad', icon: '⏱', title: 'This code expired',
		body: 'Codes last ten minutes. Generate a fresh one from Linked devices on your account page and try again.',
		actions: [el('button', { class: 'btn btn--secondary', type: 'button', text: 'Enter another code', onclick: () => renderCodeEntry() })],
	}));
}

function renderRejected() {
	render(statusCard({
		tone: 'bad', icon: '✕', title: 'Link rejected',
		body: 'The account that minted this code said no, so this device received nothing. If that was a mistake, generate a new code and try again.',
		actions: [el('button', { class: 'btn btn--secondary', type: 'button', text: 'Enter another code', onclick: () => renderCodeEntry() })],
	}));
}

function renderUsed() {
	render(statusCard({
		tone: 'bad', icon: '!', title: 'This code was already used',
		body: 'Every code works exactly once. If you did not use it, check Linked devices on your account page and revoke anything you do not recognise, then generate a new code.',
		actions: [el('a', { class: 'btn btn--secondary', href: ACCOUNT_URL, text: 'Review linked devices' })],
	}));
}

const initial = normalizeCode(new URLSearchParams(location.search).get('code'));
if (initial) renderClaim(initial);
else renderCodeEntry(new URLSearchParams(location.search).get('code') ? 'That code is not in the right shape. Codes are eight letters, like BCDF-GHJK.' : '');
