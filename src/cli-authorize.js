/**
 * /cli/authorize: a person approving a sign-in their own terminal started.
 *
 * `npx three-ws login --device` (and `setup` when a browser redirect cannot
 * reach the terminal) prints a URL and a short code, then polls
 * /api/cli/token. This page is the other half:
 *
 *   1. Read the code from `?code=` or let the person type it.
 *   2. Show exactly what is asking (client, machine, when) and which
 *      permissions the key would carry, money-moving ones flagged, each one
 *      removable. The approver can narrow the request, never widen it.
 *   3. Allow or deny on an explicit press. Nothing is approved on load: a code
 *      opened by a link-preview fetcher must stay pending.
 *
 * The dead ends (expired, already used, unknown code) are separate screens
 * because each needs a different next step.
 */

import { apiFetch } from './api.js';

const root = document.getElementById('cla-root');

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

function busy() {
	root.setAttribute('aria-busy', 'true');
}

function normalizeCode(input) {
	const letters = String(input || '').toUpperCase().replace(/[^A-Z]/g, '');
	return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : null;
}

function relTime(iso) {
	const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
	if (secs < 60) return 'just now';
	const mins = Math.round(secs / 60);
	return `${mins} minute${mins === 1 ? '' : 's'} ago`;
}

function statusCard({ tone, icon, title, body, actions = [] }) {
	return el('section', { class: 'cla-card' },
		el('div', { class: 'cla-status-icon', 'data-tone': tone, 'aria-hidden': 'true', text: icon }),
		el('h2', { class: 'cla-card-title', text: title }),
		el('p', { class: 'cla-muted' }, body),
		actions.length ? el('div', { class: 'cla-actions' }, actions) : null,
	);
}

function retryButton(code) {
	return el('button', { class: 'btn btn--secondary', type: 'button', onclick: () => load(code), text: 'Try again' });
}

// ── Entry: no code yet ───────────────────────────────────────────────────────

function renderCodeEntry(message = '') {
	const input = el('input', {
		class: 'cla-input',
		id: 'cla-code-input',
		name: 'code',
		autocomplete: 'one-time-code',
		autocapitalize: 'characters',
		spellcheck: 'false',
		inputmode: 'text',
		maxlength: '9',
		placeholder: 'BCDF-GHJK',
		'aria-describedby': message ? 'cla-code-error' : null,
		'aria-invalid': message ? 'true' : null,
	});
	const form = el('form', {
		class: 'cla-form',
		onsubmit: (e) => {
			e.preventDefault();
			const code = normalizeCode(input.value);
			if (!code) return renderCodeEntry('Codes are eight letters, like BCDF-GHJK. Check your terminal.');
			history.replaceState(null, '', `/cli/authorize?code=${encodeURIComponent(code)}`);
			load(code);
		},
	},
		el('label', { class: 'sr-only', for: 'cla-code-input', text: 'Sign-in code' }),
		input,
		el('button', { class: 'btn btn--primary', type: 'submit', text: 'Continue' }),
	);
	render(el('section', { class: 'cla-card' },
		el('h2', { class: 'cla-card-title', text: 'Enter the code from your terminal' }),
		el('p', { class: 'cla-muted' }, 'Run ', el('code', { text: 'npx three-ws login --device' }), ' and type the eight-letter code it prints.'),
		form,
		message ? el('p', { class: 'cla-error', id: 'cla-code-error', role: 'alert', text: message }) : null,
	));
	input.focus();
}

// ── Load the link ────────────────────────────────────────────────────────────

async function load(code) {
	busy();
	let res;
	try {
		res = await apiFetch(`/api/cli/link?code=${encodeURIComponent(code)}`, { allowAnonymous: true });
	} catch {
		return render(statusCard({
			tone: 'bad', icon: '!', title: 'Could not reach three.ws',
			body: 'Your connection dropped before the sign-in could load. Your terminal is still waiting, so try again.',
			actions: [retryButton(code)],
		}));
	}
	if (res.status === 401) return renderSignIn();
	const data = await res.json().catch(() => ({}));
	if (res.status === 404 || res.status === 400) return renderCodeEntry(data.error_description || 'No sign-in is waiting for that code. Check your terminal.');
	if (!res.ok) {
		return render(statusCard({
			tone: 'bad', icon: '!', title: 'Something went wrong on our side',
			body: data.error_description || `The server answered ${res.status}. Your terminal is still waiting; try again in a moment.`,
			actions: [retryButton(code)],
		}));
	}
	const { link, account } = data;
	if (link.status === 'approved' || link.status === 'consumed') return renderDone('approved', link);
	if (link.status === 'denied') return renderDone('denied', link);
	if (link.expired) return renderExpired();
	renderApproval(link, account);
}

function renderSignIn() {
	const next = location.pathname + location.search;
	render(statusCard({
		tone: 'ok', icon: '→', title: 'Sign in to continue',
		body: 'Sign in to the three.ws account the terminal should use. You will come straight back here to approve it.',
		actions: [
			el('a', { class: 'btn btn--primary', href: `/login?next=${encodeURIComponent(next)}`, text: 'Sign in' }),
			el('a', { class: 'btn btn--ghost', href: `/register?next=${encodeURIComponent(next)}`, text: 'Create an account' }),
		],
	}));
}

function renderExpired() {
	render(statusCard({
		tone: 'bad', icon: '⏱', title: 'This code expired',
		body: el('span', {}, 'Codes last ten minutes. Run ', el('code', { text: 'npx three-ws login --device' }), ' again for a fresh one.'),
	}));
}

function renderDone(kind, link) {
	if (kind === 'approved') {
		return render(statusCard({
			tone: 'ok', icon: '✓', title: 'Approved. Back to your terminal',
			body: `${link.client_name}${link.hostname ? ` on ${link.hostname}` : ''} is signed in and finishing setup. You can close this tab. The key it received is listed with your API keys, where you can revoke it.`,
			actions: [el('a', { class: 'btn btn--secondary', href: '/dashboard/api', text: 'View API keys' })],
		}));
	}
	return render(statusCard({
		tone: 'bad', icon: '✕', title: 'Sign-in denied',
		body: 'The terminal was told no and received nothing. If that was a mistake, run the command again.',
	}));
}

// ── Approve or deny ─────────────────────────────────────────────────────────

function renderApproval(link, account, errorMessage = '') {
	const boxes = link.requested_scopes.map((s) => {
		const box = el('input', { type: 'checkbox', name: 'scope', value: s.scope, checked: true });
		return {
			box,
			item: el('li', { class: 'cla-scope' },
				el('label', {},
					box,
					el('span', {},
						s.label,
						s.financial ? el('span', { class: 'cla-badge', text: 'moves funds' }) : null,
						el('span', { class: 'cla-scope-name', text: s.scope }),
					),
				),
			),
		};
	});
	const financial = link.requested_scopes.some((s) => s.financial);
	const allow = el('button', { class: 'btn btn--primary', type: 'button', text: 'Approve' });
	const deny = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Deny' });

	async function decide(decision) {
		const scope = boxes.filter((b) => b.box.checked).map((b) => b.box.value).join(' ');
		if (decision === 'allow' && !scope) return renderApproval(link, account, 'Keep at least one permission, or deny the sign-in instead.');
		allow.disabled = true; deny.disabled = true;
		(decision === 'allow' ? allow : deny).setAttribute('aria-busy', 'true');
		let res;
		try {
			res = await apiFetch('/api/cli/approve', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ code: link.user_code, decision, scope }),
			});
		} catch (err) {
			if (err?.redirected) return;
			return renderApproval(link, account, 'Your connection dropped before that went through. Nothing changed; try again.');
		}
		const data = await res.json().catch(() => ({}));
		if (res.ok) return renderDone(data.status === 'approved' ? 'approved' : 'denied', link);
		if (res.status === 410) return renderExpired();
		if (res.status === 409) return load(link.user_code);
		renderApproval(link, account, data.error_description || `The server answered ${res.status}. Nothing changed; try again.`);
	}
	allow.addEventListener('click', () => decide('allow'));
	deny.addEventListener('click', () => decide('deny'));

	render(el('section', { class: 'cla-card' },
		el('h2', { class: 'cla-card-title', text: 'Does this code match your terminal?' }),
		el('div', { class: 'cla-code', 'aria-label': `Code ${link.user_code.split('').join(' ')}`, text: link.user_code }),
		el('dl', { class: 'cla-meta' },
			el('dt', { text: 'App' }), el('dd', { text: link.client_name }),
			el('dt', { text: 'Machine' }), el('dd', { text: link.hostname || 'Not reported' }),
			el('dt', { text: 'Started' }), el('dd', { text: relTime(link.created_at) }),
			el('dt', { text: 'Account' }), el('dd', { text: account.email }),
		),
		el('p', { class: 'cla-muted', text: 'The new API key will be able to:' }),
		el('ul', { class: 'cla-scopes' }, boxes.map((b) => b.item)),
		financial
			? el('p', { class: 'cla-warn', text: 'Permissions marked "moves funds" let tools spend USDC from your agent wallet. Every spend still stops at your spending caps. Untick them if this terminal only needs to read.' })
			: null,
		el('div', { class: 'cla-actions' }, deny, allow),
		errorMessage ? el('p', { class: 'cla-error', role: 'alert', text: errorMessage }) : null,
	));
	allow.focus();
}

const initial = normalizeCode(new URLSearchParams(location.search).get('code'));
if (initial) load(initial);
else renderCodeEntry(new URLSearchParams(location.search).get('code') ? 'That code is not in the right shape. Codes are eight letters, like BCDF-GHJK.' : '');
