// The three.ws PowerPoint add-in task pane (pages/office-powerpoint.html,
// served at /office/powerpoint). Signs in with the three.ws OAuth server
// (PKCE, dynamic client registration), lists the user's own models
// (GET /api/forge/mine), generates new ones on the free lane (forge_free on
// /api/mcp-studio) and inserts the one-slide deck from
// /api/forge/export-pptx with PowerPoint.insertSlidesFromBase64. Outside
// PowerPoint the same pane works in a browser tab and downloads the .pptx.

import './taskpane.css';

import { filenameFromDisposition, pptxErrorMessage, saveBlob } from '../forge-powerpoint.js';
import {
	SCOPE,
	authorizeUrl,
	bytesToBase64,
	createPkce,
	endpointOn,
	exportUrl,
	needsRefresh,
	randomState,
	readAuthCallback,
	readGeneration,
	readPollFrame,
} from './core.js';

const ORIGIN = location.origin;
const REDIRECT_URI = `${ORIGIN}/office/powerpoint/auth`;
const CLIENT_KEY = 'tws_office_client';
const AUTH_KEY = 'tws_office_auth';
const PENDING_KEY = 'tws_office_pending';
const RECENT_KEY = 'tws_office_recent';
const RECENT_MAX = 6;
const PAGE_SIZE = 12;
const POLL_MS = 2500;
const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const $ = (id) => document.getElementById(id);
const el = {
	account: $('op-account'),
	signIn: $('op-signin'),
	live: $('op-live'),
	env: $('op-env'),
	form: $('op-gen-form'),
	prompt: $('op-prompt'),
	generate: $('op-generate'),
	progress: $('op-progress'),
	progressBar: $('op-progress-bar'),
	progressText: $('op-progress-text'),
	genError: $('op-gen-error'),
	recent: $('op-recent'),
	recentList: $('op-recent-list'),
	mine: $('op-mine'),
	mineState: $('op-mine-state'),
	more: $('op-more'),
};

const state = {
	office: false,
	canInsert: false,
	canTarget: false,
	discovery: null,
	user: null,
	nextBefore: null,
	loadingMine: false,
	genRun: 0,
};

// ── storage ─────────────────────────────────────────────────────────────────
// Storage can be unavailable (a locked-down Office webview, private mode); the
// pane keeps working for the session, it just forgets on reload.

const memory = new Map();
function readStore(area, key) {
	try {
		const raw = area.getItem(key);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return memory.get(key) ?? null;
	}
}
function writeStore(area, key, value) {
	try {
		if (value == null) area.removeItem(key);
		else area.setItem(key, JSON.stringify(value));
	} catch {
		if (value == null) memory.delete(key);
		else memory.set(key, value);
	}
}

function announce(message) {
	el.live.textContent = '';
	el.live.textContent = message;
}

// ── OAuth ───────────────────────────────────────────────────────────────────

async function discovery() {
	if (state.discovery) return state.discovery;
	const [as, pr] = await Promise.all([
		fetch(`${ORIGIN}/.well-known/oauth-authorization-server`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`discovery ${r.status}`)))),
		fetch(`${ORIGIN}/.well-known/oauth-protected-resource`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`resource ${r.status}`)))),
	]);
	state.discovery = {
		authorize: endpointOn(ORIGIN, as.authorization_endpoint),
		token: endpointOn(ORIGIN, as.token_endpoint),
		register: endpointOn(ORIGIN, as.registration_endpoint),
		revoke: as.revocation_endpoint ? endpointOn(ORIGIN, as.revocation_endpoint) : null,
		resource: pr.resource,
	};
	return state.discovery;
}

async function clientId() {
	const saved = readStore(localStorage, CLIENT_KEY);
	if (saved?.client_id && saved.redirect_uri === REDIRECT_URI) return saved.client_id;
	const d = await discovery();
	const res = await fetch(d.register, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			client_name: 'three.ws for PowerPoint',
			client_uri: 'https://three.ws/docs/powerpoint',
			redirect_uris: [REDIRECT_URI],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			scope: SCOPE,
			software_id: 'three-ws-powerpoint-addin',
			software_version: '1.0.0',
		}),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.client_id) throw new Error(body.error_description || 'three.ws did not register the add-in. Try again.');
	writeStore(localStorage, CLIENT_KEY, { client_id: body.client_id, redirect_uri: REDIRECT_URI });
	return body.client_id;
}

async function tokenRequest(form) {
	const d = await discovery();
	const res = await fetch(d.token, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ ...form, resource: d.resource }).toString(),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body.access_token) {
		if (body.error === 'invalid_client') writeStore(localStorage, CLIENT_KEY, null);
		const err = new Error(body.error_description || 'three.ws could not finish the sign-in. Sign in again.');
		err.code = body.error;
		throw err;
	}
	const auth = {
		access_token: body.access_token,
		refresh_token: body.refresh_token || null,
		scope: body.scope || '',
		expires_at: Date.now() + (Number(body.expires_in) || 3600) * 1000,
	};
	writeStore(localStorage, AUTH_KEY, auth);
	return auth;
}

let refreshing = null;
/** A usable access token, refreshed when close to expiry; null when signed out. */
async function accessToken({ force = false } = {}) {
	const auth = readStore(localStorage, AUTH_KEY);
	if (!auth) return null;
	if (!force && !needsRefresh(auth)) return auth.access_token;
	if (!auth.refresh_token) {
		writeStore(localStorage, AUTH_KEY, null);
		return null;
	}
	refreshing ||= (async () => {
		try {
			const next = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: await clientId() });
			return next.access_token;
		} catch {
			writeStore(localStorage, AUTH_KEY, null);
			return null;
		} finally {
			refreshing = null;
		}
	})();
	return refreshing;
}

/** fetch with the bearer; one forced refresh on 401, then signed out. */
async function authedFetch(url, init = {}) {
	let token = await accessToken();
	if (!token) return null;
	const go = (t) => fetch(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${t}` } });
	let res = await go(token);
	if (res.status === 401) {
		token = await accessToken({ force: true });
		if (!token) return null;
		res = await go(token);
		if (res.status === 401) {
			writeStore(localStorage, AUTH_KEY, null);
			return null;
		}
	}
	return res;
}

async function beginSignIn() {
	el.signIn.disabled = true;
	el.signIn.setAttribute('aria-busy', 'true');
	try {
		const [d, id, pkce] = await Promise.all([discovery(), clientId(), createPkce(crypto)]);
		const stateToken = randomState(crypto);
		writeStore(sessionStorage, PENDING_KEY, { verifier: pkce.verifier, state: stateToken, client_id: id });
		const url = authorizeUrl(d.authorize, {
			clientId: id,
			redirectUri: REDIRECT_URI,
			scope: SCOPE,
			state: stateToken,
			challenge: pkce.challenge,
			resource: d.resource,
		});
		if (state.office && window.Office?.context?.ui?.displayDialogAsync) {
			await signInWithDialog(url);
		} else {
			location.assign(url);
			return;
		}
	} catch (err) {
		showAccountError(err.message || 'Sign-in did not start. Try again.');
	}
	el.signIn.disabled = false;
	el.signIn.removeAttribute('aria-busy');
}

// The authorize page refuses to be framed, so inside PowerPoint it opens in an
// Office dialog; the callback page posts its URL back with messageParent.
function signInWithDialog(url) {
	return new Promise((resolve) => {
		Office.context.ui.displayDialogAsync(url, { height: 70, width: 36, promptBeforeOpen: false }, (result) => {
			if (result.status !== Office.AsyncResultStatus.Succeeded) {
				showAccountError(`PowerPoint could not open the sign-in window (${result.error?.message || 'blocked'}). Allow pop-ups for three.ws and try again.`);
				resolve();
				return;
			}
			const dialog = result.value;
			dialog.addEventHandler(Office.EventType.DialogMessageReceived, async (arg) => {
				dialog.close();
				await finishSignIn(arg.message);
				resolve();
			});
			dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
				announce('The sign-in window was closed before you finished.');
				resolve();
			});
		});
	});
}

async function finishSignIn(href) {
	const pending = readStore(sessionStorage, PENDING_KEY);
	writeStore(sessionStorage, PENDING_KEY, null);
	if (!pending) {
		showAccountError('That sign-in response is from an older attempt. Sign in again.');
		return;
	}
	const result = readAuthCallback(href, pending.state);
	if (result.error) {
		showAccountError(result.error);
		return;
	}
	try {
		await tokenRequest({
			grant_type: 'authorization_code',
			code: result.code,
			redirect_uri: REDIRECT_URI,
			code_verifier: pending.verifier,
			client_id: pending.client_id,
		});
		await refreshAccount();
		announce(`Signed in as ${state.user?.name || 'your three.ws account'}.`);
	} catch (err) {
		showAccountError(err.message);
	}
}

async function signOut() {
	const auth = readStore(localStorage, AUTH_KEY);
	writeStore(localStorage, AUTH_KEY, null);
	state.user = null;
	renderAccount();
	renderMineSignedOut();
	announce('Signed out of three.ws.');
	const client = readStore(localStorage, CLIENT_KEY);
	if (auth?.refresh_token && client?.client_id) {
		try {
			const d = await discovery();
			if (d.revoke) {
				await fetch(d.revoke, {
					method: 'POST',
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({ token: auth.refresh_token, client_id: client.client_id }).toString(),
				});
			}
		} catch {
			// The local tokens are already gone; an unreachable revoke leaves only a
			// refresh token nobody holds, which expires on its own.
		}
	}
}

// ── account chip ────────────────────────────────────────────────────────────

function showAccountError(message) {
	renderAccount();
	const note = document.createElement('p');
	note.className = 'op-account-error';
	note.setAttribute('role', 'alert');
	note.textContent = message;
	el.account.appendChild(note);
}

function renderAccount() {
	el.account.replaceChildren();
	el.account.removeAttribute('aria-busy');
	if (!state.user) {
		el.signIn.hidden = false;
		el.signIn.disabled = false;
		el.signIn.removeAttribute('aria-busy');
		return;
	}
	el.signIn.hidden = true;
	const chip = document.createElement('div');
	chip.className = 'op-chip';
	if (state.user.avatar) {
		const img = document.createElement('img');
		img.src = state.user.avatar;
		img.alt = '';
		img.width = 24;
		img.height = 24;
		chip.appendChild(img);
	} else {
		const initial = document.createElement('span');
		initial.className = 'op-chip-initial';
		initial.setAttribute('aria-hidden', 'true');
		initial.textContent = (state.user.name || '?').trim().charAt(0).toUpperCase();
		chip.appendChild(initial);
	}
	const name = document.createElement('span');
	name.className = 'op-chip-name';
	name.textContent = state.user.name;
	chip.appendChild(name);
	const out = document.createElement('button');
	out.type = 'button';
	out.className = 'op-link';
	out.textContent = 'Sign out';
	out.addEventListener('click', signOut);
	chip.appendChild(out);
	el.account.appendChild(chip);
}

async function refreshAccount() {
	const res = await authedFetch(`${ORIGIN}/api/me`).catch(() => null);
	if (res?.ok) {
		const { user } = await res.json();
		state.user = { id: user.id, name: user.display_name || user.username || user.handle || 'three.ws account', avatar: user.avatar_url || null };
	} else {
		state.user = null;
	}
	renderAccount();
	if (state.user) loadMine({ reset: true });
	else renderMineSignedOut();
}

// ── your models ─────────────────────────────────────────────────────────────

function mineSkeleton() {
	el.mine.replaceChildren();
	el.mine.setAttribute('aria-busy', 'true');
	for (let i = 0; i < 4; i++) {
		const li = document.createElement('li');
		li.className = 'op-skel op-card-skel';
		li.setAttribute('aria-hidden', 'true');
		el.mine.appendChild(li);
	}
	el.mineState.hidden = true;
	el.more.hidden = true;
}

function setMineState(html, actions = []) {
	el.mineState.replaceChildren();
	const p = document.createElement('p');
	p.innerHTML = html;
	el.mineState.appendChild(p);
	if (actions.length) {
		const row = document.createElement('div');
		row.className = 'op-row';
		for (const a of actions) row.appendChild(a);
		el.mineState.appendChild(row);
	}
	el.mineState.hidden = false;
}

function button(label, onClick, cls = 'op-btn is-ghost') {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = cls;
	b.textContent = label;
	b.addEventListener('click', onClick);
	return b;
}

function renderMineSignedOut() {
	el.mine.replaceChildren();
	el.mine.removeAttribute('aria-busy');
	el.more.hidden = true;
	setMineState(
		'<strong>Sign in to see your models.</strong> Everything you made on three.ws (Forge generations, rigged avatars, uploads) shows up here, ready to drop on a slide.',
		[button('Sign in to three.ws', beginSignIn, 'op-btn')],
	);
}

function modelCard(model) {
	const li = document.createElement('li');
	li.className = 'op-card';
	const thumb = document.createElement('div');
	thumb.className = 'op-thumb';
	if (model.previewImageUrl) {
		const img = document.createElement('img');
		img.src = model.previewImageUrl;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.addEventListener('error', () => img.remove(), { once: true });
		thumb.appendChild(img);
	}
	const glyph = document.createElement('span');
	glyph.className = 'op-thumb-glyph';
	glyph.setAttribute('aria-hidden', 'true');
	glyph.textContent = (model.title || '?').charAt(0).toUpperCase();
	thumb.prepend(glyph);
	li.appendChild(thumb);

	const body = document.createElement('div');
	body.className = 'op-card-body';
	const title = document.createElement('a');
	title.className = 'op-card-title';
	title.href = model.modelUrl;
	title.target = '_blank';
	title.rel = 'noopener';
	title.textContent = model.title;
	title.title = model.prompt || model.title;
	body.appendChild(title);
	const meta = document.createElement('span');
	meta.className = `op-badge is-${model.visibility}`;
	meta.textContent = model.visibility;
	body.appendChild(meta);
	li.appendChild(body);

	if (model.exportable) {
		const insert = button(state.canInsert ? 'Insert' : 'Download', () => insertDeck({ id: model.id }, insert, model.title), 'op-btn is-small');
		insert.setAttribute('aria-label', `${state.canInsert ? 'Insert' : 'Download'} ${model.title}`);
		li.appendChild(insert);
	} else {
		const note = document.createElement('a');
		note.className = 'op-card-note';
		note.href = model.modelUrl;
		note.target = '_blank';
		note.rel = 'noopener';
		note.textContent = 'Private: make it unlisted to use it';
		li.appendChild(note);
	}
	return li;
}

async function loadMine({ reset = false } = {}) {
	if (state.loadingMine) return;
	state.loadingMine = true;
	if (reset) {
		state.nextBefore = null;
		mineSkeleton();
	} else {
		el.more.disabled = true;
		el.more.setAttribute('aria-busy', 'true');
	}
	try {
		const url = new URL(`${ORIGIN}/api/forge/mine`);
		url.searchParams.set('limit', String(PAGE_SIZE));
		if (state.nextBefore) url.searchParams.set('before', state.nextBefore);
		const res = await authedFetch(url.toString());
		if (!res) {
			state.user = null;
			renderAccount();
			renderMineSignedOut();
			return;
		}
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(body.error_description || `three.ws answered ${res.status}.`);
		if (reset) el.mine.replaceChildren();
		for (const m of body.models) el.mine.appendChild(modelCard(m));
		state.nextBefore = body.nextBefore;
		el.more.hidden = !state.nextBefore;
		if (reset && !body.models.length) {
			setMineState(
				'<strong>No models yet.</strong> Describe one above and generate it free, or make one in <a href="https://three.ws/forge" target="_blank" rel="noopener">Forge</a>. Finished models land here.',
			);
		} else {
			el.mineState.hidden = true;
		}
	} catch (err) {
		if (reset) el.mine.replaceChildren();
		setMineState(`<strong>Your models did not load.</strong> ${escapeHtml(err.message || 'Check your connection.')}`, [
			button('Try again', () => loadMine({ reset: true })),
		]);
	} finally {
		state.loadingMine = false;
		el.mine.removeAttribute('aria-busy');
		el.more.disabled = false;
		el.more.removeAttribute('aria-busy');
	}
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ── insert ──────────────────────────────────────────────────────────────────

async function fetchDeck(source) {
	let res;
	try {
		res = await fetch(exportUrl(ORIGIN, source), { headers: { accept: PPTX_TYPE } });
	} catch {
		throw new Error('Could not reach three.ws. Check your connection and try again.');
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(pptxErrorMessage(res.status, body));
	}
	const blob = await res.blob();
	return { blob, filename: filenameFromDisposition(res.headers.get('content-disposition')) || 'three-ws-model.pptx' };
}

async function insertIntoPresentation(blob) {
	const b64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
	await PowerPoint.run(async (ctx) => {
		const options = { formatting: 'KeepSourceFormatting' };
		if (state.canTarget) {
			const selected = ctx.presentation.getSelectedSlides();
			selected.load('items/id');
			await ctx.sync();
			if (selected.items.length) options.targetSlideId = selected.items[selected.items.length - 1].id;
		}
		ctx.presentation.insertSlidesFromBase64(b64, options);
		await ctx.sync();
	});
}

async function insertDeck(source, btn, title) {
	if (btn.getAttribute('aria-busy') === 'true') return;
	const label = btn.textContent;
	btn.setAttribute('aria-busy', 'true');
	btn.disabled = true;
	btn.textContent = state.canInsert ? 'Inserting' : 'Building';
	try {
		const { blob, filename } = await fetchDeck(source);
		if (state.canInsert) {
			try {
				await insertIntoPresentation(blob);
				announce(`${title} is on a new slide. Drag the model to rotate it.`);
				flash(btn, 'Inserted');
				return;
			} catch (err) {
				saveBlob(blob, filename);
				announce(`PowerPoint would not insert the slide (${err.message || err.code || 'unknown error'}), so it was downloaded as ${filename}. Open it and copy the slide in.`);
				flash(btn, 'Downloaded');
				return;
			}
		}
		saveBlob(blob, filename);
		announce(`Downloaded ${filename}. Open it in PowerPoint and drag the model to rotate it.`);
		flash(btn, 'Downloaded');
	} catch (err) {
		announce(err.message);
		btn.textContent = label;
		btn.title = err.message;
		btn.classList.add('is-error');
	} finally {
		btn.disabled = false;
		btn.removeAttribute('aria-busy');
	}

	function flash(b, text) {
		b.textContent = text;
		b.classList.remove('is-error');
		b.classList.add('is-done');
		setTimeout(() => {
			b.textContent = label;
			b.classList.remove('is-done');
		}, 2500);
	}
}

// ── generate ────────────────────────────────────────────────────────────────

function promptTitle(prompt) {
	const t = String(prompt || '').trim().replace(/\s+/g, ' ');
	if (!t) return 'three.ws model';
	const cut = t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t;
	return cut.charAt(0).toUpperCase() + cut.slice(1);
}

async function callFreeLane(prompt) {
	const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'forge_free', arguments: { prompt, tier: 'standard' } } });
	const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
	const send = (extra) => fetch(`${ORIGIN}/api/mcp-studio`, { method: 'POST', headers: { ...headers, ...extra }, body });
	// Signed in, the generation is metered to the account; a token the server
	// will not take (expired, revoked) falls back to the anonymous free lane.
	const token = await accessToken();
	let res = await send(token ? { authorization: `Bearer ${token}` } : {});
	if (res.status === 401 && token) res = await send({});
	const text = await res.text();
	const json = text.trimStart().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) || '').slice(5);
	try {
		return JSON.parse(json);
	} catch {
		return { error: { message: res.ok ? 'The generator sent an answer the pane could not read. Try again.' : `The generator answered ${res.status}. Try again.` } };
	}
}

function setProgress(fraction, text) {
	el.progress.hidden = false;
	const pct = typeof fraction === 'number' ? Math.max(4, Math.min(100, Math.round(fraction * 100))) : null;
	el.progressBar.classList.toggle('is-indeterminate', pct === null);
	el.progressBar.style.width = pct === null ? '' : `${pct}%`;
	el.progress.setAttribute('aria-valuenow', pct === null ? '' : String(pct));
	el.progressText.textContent = text;
}

function etaWords(seconds) {
	if (!seconds || seconds <= 0) return '';
	return seconds < 60 ? `, about ${Math.ceil(seconds)} s left` : `, about ${Math.ceil(seconds / 60)} min left`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollJob(pollUrl, run) {
	const u = new URL(pollUrl, ORIGIN);
	const url = `${ORIGIN}${u.pathname}${u.search}`;
	let misses = 0;
	while (run === state.genRun) {
		await wait(POLL_MS);
		if (run !== state.genRun) return null;
		let frame;
		try {
			const res = await fetch(url, { headers: { accept: 'application/json' } });
			frame = await res.json();
			misses = 0;
		} catch {
			misses += 1;
			if (misses >= 5) return { status: 'error', message: 'Lost contact with three.ws while the model was generating. Check your connection; it may still appear under Your models.' };
			continue;
		}
		const read = readPollFrame(frame);
		if (read.status !== 'pending') return read;
		setProgress(read.progress, `Generating${etaWords(read.etaSeconds)}`);
	}
	return null;
}

async function generate(event) {
	event.preventDefault();
	const prompt = el.prompt.value.trim();
	if (prompt.length < 3) {
		el.genError.textContent = 'Describe the model in a few words, for example "a brass lantern".';
		el.genError.hidden = false;
		el.prompt.focus();
		return;
	}
	const run = ++state.genRun;
	el.genError.hidden = true;
	el.generate.disabled = true;
	el.generate.setAttribute('aria-busy', 'true');
	el.prompt.setAttribute('aria-busy', 'true');
	setProgress(null, 'Sending to the free generator');
	try {
		let result = readGeneration(await callFreeLane(prompt));
		if (result.status === 'pending') {
			setProgress(result.progress, `Generating${etaWords(result.etaSeconds)}`);
			result = await pollJob(result.pollUrl, run);
		}
		if (!result || run !== state.genRun) return;
		if (result.status === 'error') throw new Error(result.message);
		const item = { glbUrl: result.glbUrl, prompt, title: promptTitle(prompt), at: Date.now() };
		const recent = [item, ...(readStore(localStorage, RECENT_KEY) || []).filter((r) => r.glbUrl !== item.glbUrl)].slice(0, RECENT_MAX);
		writeStore(localStorage, RECENT_KEY, recent);
		renderRecent();
		setProgress(1, 'Done. It is first in Just generated.');
		announce(`${item.title} is ready. ${state.canInsert ? 'Insert it' : 'Download it'} from Just generated.`);
		el.recentList.querySelector('button')?.focus();
		if (state.user) loadMine({ reset: true });
	} catch (err) {
		el.progress.hidden = true;
		el.genError.textContent = err.message || 'The model could not be generated. Try again.';
		el.genError.hidden = false;
	} finally {
		if (run === state.genRun) {
			el.generate.disabled = false;
			el.generate.removeAttribute('aria-busy');
			el.prompt.removeAttribute('aria-busy');
		}
	}
}

function renderRecent() {
	const recent = readStore(localStorage, RECENT_KEY) || [];
	el.recent.hidden = !recent.length;
	el.recentList.replaceChildren();
	for (const r of recent) {
		const li = document.createElement('li');
		li.className = 'op-recent-item';
		const text = document.createElement('a');
		text.className = 'op-recent-title';
		text.href = `${ORIGIN}/viewer?src=${encodeURIComponent(r.glbUrl)}`;
		text.target = '_blank';
		text.rel = 'noopener';
		text.textContent = r.title;
		text.title = `Open ${r.title} in the three.ws viewer`;
		li.appendChild(text);
		const b = button(state.canInsert ? 'Insert' : 'Download', () => insertDeck({ src: r.glbUrl, title: r.title }, b, r.title), 'op-btn is-small');
		b.setAttribute('aria-label', `${state.canInsert ? 'Insert' : 'Download'} ${r.title}`);
		li.appendChild(b);
		el.recentList.appendChild(li);
	}
}

// ── boot ────────────────────────────────────────────────────────────────────

async function detectOffice() {
	if (!window.Office?.onReady) return;
	try {
		const info = await Office.onReady();
		state.office = info?.host === Office.HostType.PowerPoint;
		const req = Office.context?.requirements;
		state.canInsert = state.office && !!req?.isSetSupported?.('PowerPointApi', '1.2');
		state.canTarget = state.canInsert && !!req?.isSetSupported?.('PowerPointApi', '1.5');
	} catch {
		state.office = false;
	}
}

function renderEnvironment() {
	if (state.canInsert) {
		el.env.hidden = true;
		return;
	}
	el.env.hidden = false;
	el.env.textContent = state.office
		? 'This version of PowerPoint cannot insert slides from an add-in (it needs PowerPointApi 1.2). Models download as a .pptx you can open and copy from.'
		: 'You are viewing the add-in in a browser. Models download as a .pptx; open it in PowerPoint and drag the model to rotate it.';
}

async function boot() {
	el.form.addEventListener('submit', generate);
	el.prompt.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) el.form.requestSubmit();
	});
	el.signIn.addEventListener('click', beginSignIn);
	el.more.addEventListener('click', () => loadMine());

	await detectOffice();
	renderEnvironment();
	renderRecent();

	// Outside PowerPoint the sign-in returns here as a full-page redirect.
	const params = new URLSearchParams(location.search);
	if (params.has('state') && (params.has('code') || params.has('error'))) {
		const href = location.href;
		if (typeof history.replaceState === 'function') history.replaceState(null, '', location.pathname);
		await finishSignIn(href);
		return;
	}
	if (readStore(localStorage, AUTH_KEY)) await refreshAccount();
	else {
		renderAccount();
		renderMineSignedOut();
	}
}

boot();
