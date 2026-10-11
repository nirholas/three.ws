// "Continue with Telegram" on /login and /register.
//
// Two ways in, both verified server-side (api/auth/telegram/[action].js):
//   1. The Telegram login widget: a top-level navigation to Telegram and back,
//      the same shape as Google. Best on a device where Telegram is signed in
//      in the browser.
//   2. A magic link: the page asks the API for a one-time token and shows it
//      as a deep link plus a QR code. Opening it in the Telegram app sends
//      `/start tl_<token>` to the bot, the gateway claims it, and this page,
//      which has been polling, receives the session and moves on. Best on a
//      desktop when Telegram lives on the phone.
//
// The button stays hidden until /api/config says a bot token is configured,
// so a deployment without Telegram never shows a dead control.

import { safeNext } from './safe-next.js';

const POLL_MS = 2000;

const btn = document.getElementById('telegram-btn');
const modal = document.getElementById('telegram-modal');

function nextPath() {
	return safeNext(window.__loginNext || new URLSearchParams(location.search).get('next') || '/dashboard');
}

function widgetUrl() {
	return `/api/auth/telegram/start?next=${encodeURIComponent(nextPath())}`;
}

async function configured() {
	try {
		const cfg = await (await fetch('/api/config')).json();
		return cfg?.telegramEnabled === true;
	} catch {
		return false;
	}
}

// ── magic link ───────────────────────────────────────────────────────────────

let pollTimer = null;
let active = null;

function stopPolling() {
	if (pollTimer) clearTimeout(pollTimer);
	pollTimer = null;
	active = null;
}

function setStatus(text, tone = 'muted') {
	const el = modal.querySelector('[data-slot="status"]');
	el.textContent = text;
	el.dataset.tone = tone;
}

async function drawQr(deepLink) {
	const canvas = modal.querySelector('[data-slot="qr"]');
	try {
		const mod = await import('qrcode');
		await (mod.default || mod).toCanvas(canvas, deepLink, { width: 180, margin: 1, color: { dark: '#ffffffff', light: '#00000000' } });
		canvas.hidden = false;
	} catch {
		// The deep link button still works without the QR.
		canvas.hidden = true;
	}
}

async function poll(issued) {
	if (active !== issued) return;
	let res;
	try {
		res = await fetch(`/api/auth/telegram/poll?id=${encodeURIComponent(issued.id)}&secret=${encodeURIComponent(issued.poll_secret)}`, { credentials: 'include' });
	} catch {
		pollTimer = setTimeout(() => poll(issued), POLL_MS * 2);
		return;
	}
	const data = await res.json().catch(() => ({}));
	if (active !== issued) return;
	if (res.status === 404 || data.status === 'expired') {
		setStatus('That link expired. Generate a new one.', 'bad');
		modal.querySelector('[data-action="refresh"]').hidden = false;
		stopPolling();
		return;
	}
	if (!res.ok) {
		setStatus(data.error_description || 'Telegram could not complete the sign-in. Try again.', 'bad');
		modal.querySelector('[data-action="refresh"]').hidden = false;
		stopPolling();
		return;
	}
	if (data.status === 'completed') {
		setStatus(data.is_new ? 'Account created. Taking you in.' : 'Signed in. Taking you in.', 'ok');
		stopPolling();
		location.href = safeNext(data.next || nextPath());
		return;
	}
	pollTimer = setTimeout(() => poll(issued), POLL_MS);
}

async function startMagic() {
	stopPolling();
	modal.querySelector('[data-action="refresh"]').hidden = true;
	modal.querySelector('[data-slot="qr"]').hidden = true;
	const open = modal.querySelector('[data-action="open-telegram"]');
	open.removeAttribute('href');
	open.setAttribute('aria-disabled', 'true');
	setStatus('Preparing your link…');
	let res;
	try {
		res = await fetch('/api/auth/telegram/magic', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ intent: 'login', next: nextPath() }),
		});
	} catch {
		setStatus('Could not reach three.ws. Check your connection and try again.', 'bad');
		modal.querySelector('[data-action="refresh"]').hidden = false;
		return;
	}
	const issued = await res.json().catch(() => ({}));
	if (!res.ok) {
		setStatus(issued.error_description || 'Telegram sign-in is not available right now.', 'bad');
		modal.querySelector('[data-action="refresh"]').hidden = false;
		return;
	}
	active = issued;
	open.href = issued.deep_link;
	open.removeAttribute('aria-disabled');
	modal.querySelector('[data-slot="bot"]').textContent = issued.bot_username ? `@${issued.bot_username}` : 'the three.ws bot';
	const mins = Math.max(1, Math.round((issued.expires_in || 600) / 60));
	setStatus(`Waiting for Telegram. The link works once and expires in ${mins} minute${mins === 1 ? '' : 's'}.`);
	drawQr(issued.deep_link);
	pollTimer = setTimeout(() => poll(issued), POLL_MS);
}

// ── modal ────────────────────────────────────────────────────────────────────

let lastFocus = null;

function openModal() {
	lastFocus = document.activeElement;
	modal.hidden = false;
	document.body.style.overflow = 'hidden';
	modal.querySelector('[data-action="widget"]').href = widgetUrl();
	modal.querySelector('[data-action="close"]').focus();
	startMagic();
}

function closeModal() {
	stopPolling();
	modal.hidden = true;
	document.body.style.overflow = '';
	if (lastFocus?.focus) lastFocus.focus();
}

(async function boot() {
	if (!btn || !modal) return;
	if (!(await configured())) return;
	btn.hidden = false;
	btn.addEventListener('click', openModal);
	modal.querySelector('[data-action="close"]').addEventListener('click', closeModal);
	modal.querySelector('[data-action="refresh"]').addEventListener('click', startMagic);
	modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
	document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
})();
