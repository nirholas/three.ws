// /login/verify: the second step of signing in when two-step verification is
// on, and the step-up a signed-in session takes before opening a team that
// requires it. Talks to /api/auth/mfa/{pending,verify} (api/auth/mfa/[action].js).

const $ = (id) => document.getElementById(id);
const form = $('verify-form');
const input = $('code');
const submit = $('submit');
const toggle = $('toggle');
const errBox = $('err');
const okBox = $('ok');

const params = new URLSearchParams(location.search);
const rawNext = params.get('next') || '';
const next = rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.startsWith('/login') ? rawNext : '/dashboard';
let recovery = false;
let busy = false;

function show(el, text) {
	el.textContent = text;
	el.hidden = !text;
}

function setMode(useRecovery) {
	recovery = useRecovery;
	input.value = '';
	input.classList.toggle('recovery', recovery);
	input.inputMode = recovery ? 'text' : 'numeric';
	input.autocomplete = recovery ? 'off' : 'one-time-code';
	input.maxLength = recovery ? 11 : 6;
	input.removeAttribute('pattern');
	if (!recovery) input.pattern = '[0-9]{6}';
	$('code-label').textContent = recovery ? 'Recovery code' : 'Authenticator code';
	$('code-hint').textContent = recovery
		? 'One of the ten codes you saved when you turned on two-step verification, like k3v9q-7xh2m. Each works once.'
		: 'The 6-digit code in your authenticator app for three.ws.';
	toggle.textContent = recovery ? 'Use my authenticator app instead' : 'Use a recovery code instead';
	show(errBox, '');
	input.focus();
}

function ready(title, sub) {
	$('title').textContent = title;
	$('sub').textContent = sub;
	$('loading').hidden = true;
	$('fields').hidden = false;
	input.focus();
}

function dead(title, sub, { linkText = 'Sign in again', href = '/login?next=' + encodeURIComponent(next) } = {}) {
	$('title').textContent = title;
	$('sub').textContent = sub;
	$('loading').hidden = true;
	$('fields').hidden = true;
	$('back').textContent = linkText;
	$('back').href = href;
}

async function load() {
	let mode;
	try {
		const res = await fetch('/api/auth/mfa/pending', { credentials: 'include', cache: 'no-store' });
		if (!res.ok) throw new Error(`status ${res.status}`);
		mode = (await res.json()).mode;
	} catch {
		$('loading').hidden = true;
		show(errBox, 'Could not reach three.ws to check your sign-in. Check your connection, then reload this page.');
		return;
	}
	if (mode === 'sign_in') return ready('Two-step verification', 'Your password or sign-in provider checked out. Enter the code from your authenticator app to finish signing in.');
	if (mode === 'step_up') return ready('Confirm it is you', 'This page needs a session that passed two-step verification. Enter a code from your authenticator app to continue.');
	if (mode === 'verified') return location.replace(next);
	if (mode === 'expired') return dead('This sign-in expired', 'Two-step sign-ins wait 10 minutes for a code, or end after 5 wrong codes. Sign in again to get a fresh one.');
	if (mode === 'not_enabled') return dead('Two-step verification is off', 'Your account does not use two-step verification yet. Turn it on under Settings, Security.', { linkText: 'Open Security settings', href: '/settings#security' });
	return dead('You are signed out', 'Sign in first; you will be asked for your code afterwards.');
}

form.addEventListener('submit', async (e) => {
	e.preventDefault();
	if (busy) return;
	const code = input.value.trim();
	if (!recovery && !/^\d{6}$/.test(code)) return show(errBox, 'Enter the 6 digits shown in your authenticator app.');
	if (recovery && code.replace(/[\s-]/g, '').length !== 10) return show(errBox, 'A recovery code has 10 letters and digits, like k3v9q-7xh2m.');
	busy = true;
	submit.disabled = true;
	submit.textContent = 'Verifying…';
	show(errBox, '');
	try {
		const res = await fetch('/api/auth/mfa/verify', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code, next }),
		});
		const data = await res.json().catch(() => ({}));
		if (res.ok) {
			const left = data.method === 'recovery' ? ` You have ${data.recovery_codes_left} recovery codes left; make new ones in Settings if that is low.` : '';
			show(okBox, `Verified. Taking you on.${left}`);
			setTimeout(() => location.replace(data.next || next), data.method === 'recovery' ? 2500 : 0);
			return;
		}
		if (data.error === 'mfa_expired' || data.error === 'too_many_attempts') {
			return dead(data.error === 'too_many_attempts' ? 'Too many wrong codes' : 'This sign-in expired', `${data.error_description || 'Sign in again.'}`);
		}
		if (res.status === 429) return show(errBox, 'Too many tries from here. Wait a few minutes, then try again.');
		show(errBox, data.error_description || 'That code did not work. Try the newest code from your app.');
		input.select();
	} catch {
		show(errBox, 'Could not reach three.ws. Check your connection and try again; your code was not used.');
	} finally {
		busy = false;
		submit.disabled = false;
		submit.textContent = 'Verify';
	}
});

toggle.addEventListener('click', () => setMode(!recovery));
input.addEventListener('input', () => {
	if (!recovery && /^\d{6}$/.test(input.value.trim())) form.requestSubmit();
});

load();
