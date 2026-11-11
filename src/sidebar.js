/**
 * /sidebar: three.ws in the Microsoft Edge sidebar.
 *
 * The web app manifest's edge_side_panel member lets a person pin the installed
 * app into Edge's side pane, where it runs next to whatever page they are
 * reading at 320 to 400px wide. This route is the layout built for that width:
 *   - Chat with the person's default agent: GET /api/agents/me (get-or-create
 *     for a session, { agent: null } signed out), then POST /api/chat, streamed.
 *   - Text to 3D: POST /api/forge on the free standard lane, then real polling
 *     of GET /api/forge?job= until the GLB is ready.
 *   - Recent models: GET /api/forge-gallery for models forged in this browser
 *     (keyed by the same anonymous forge client id /forge uses) merged with
 *     GET /api/avatars/mine when signed in.
 * The side pane is a first-party browsing context, so the normal session cookie
 * works and sign-in is the regular /login round trip back to /sidebar.
 */

import './sidebar.css';
import { getMe } from './account.js';
import { createHiddenClock, fetchJobStatus, nextBackoff, sleepUntilVisibleOrElapsed } from './shared/resilient-poll.js';

const $ = (id) => document.getElementById(id);
const RECENT_LIMIT = 6;
const POLL_MS = 2500;
const POLL_MAX_BACKOFF_MS = 15000;
const MAX_POLL_MS = 12 * 60 * 1000;
const HISTORY_KEY = 'sidebar:chat';

const FORGE_CLIENT_ID = (() => {
	const KEY = 'forge:cid';
	try {
		let id = localStorage.getItem(KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(KEY, id);
		}
		return id;
	} catch {
		return crypto.randomUUID();
	}
})();
const FORGE_HEADERS = { 'x-forge-client': FORGE_CLIENT_ID };

const state = { me: null, agent: null, history: [], sending: false, forging: false };

function announce(text) {
	const live = $('sb-live');
	live.textContent = '';
	requestAnimationFrame(() => (live.textContent = text));
}

function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else node.setAttribute(k, v);
	}
	for (const child of children) if (child) node.append(child);
	return node;
}

function renderState(container, { title, body, action }) {
	const nodes = [el('p', { class: 'sb-state-title', text: title }), el('p', { class: 'sb-state-body', text: body })];
	if (action) {
		nodes.push(el('a', { class: 'sb-btn', href: action.href, target: action.external ? '_blank' : null, rel: action.external ? 'noopener' : null, text: action.label }));
	}
	container.replaceChildren(...nodes);
	container.hidden = false;
}

function retryButton(label, onClick) {
	const btn = el('button', { type: 'button', class: 'sb-btn', text: label });
	btn.addEventListener('click', onClick);
	return btn;
}

/* ── Account ─────────────────────────────────────────────────────────────── */

function renderAccount() {
	const link = $('sb-account');
	if (state.me) {
		link.textContent = state.me.username || state.me.display_name || 'Account';
		link.href = '/settings';
		link.target = '_blank';
		link.rel = 'noopener';
	} else {
		link.textContent = 'Sign in';
		link.href = `/login?next=${encodeURIComponent('/sidebar')}`;
		link.removeAttribute('target');
	}
}

/* ── Agent and chat ──────────────────────────────────────────────────────── */

async function loadAgent() {
	const box = $('sb-agent');
	const stateEl = $('sb-agent-state');
	box.setAttribute('aria-busy', 'true');
	stateEl.hidden = true;
	if (!state.me) {
		box.hidden = true;
		box.setAttribute('aria-busy', 'false');
		renderState(stateEl, {
			title: 'Chat with your agent here',
			body: 'Sign in and your default agent rides along in the sidebar, next to any page you read.',
			action: { href: `/login?next=${encodeURIComponent('/sidebar')}`, label: 'Sign in' },
		});
		return;
	}
	try {
		const res = await fetch('/api/agents/me', { credentials: 'include', headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const { agent } = await res.json();
		if (!agent?.id) throw new Error('no agent');
		state.agent = agent;
		renderAgent(agent);
		restoreHistory();
		$('sb-chat').hidden = false;
		$('sb-log').hidden = state.history.length === 0;
	} catch {
		box.hidden = true;
		renderState(stateEl, {
			title: 'Your agent did not load',
			body: 'The agent service did not answer. Check your connection, then try again.',
		});
		stateEl.append(retryButton('Try again', () => { box.hidden = false; loadAgent(); }));
	} finally {
		box.setAttribute('aria-busy', 'false');
	}
}

function renderAgent(agent) {
	const box = $('sb-agent');
	const poster = agent.avatar_thumbnail_url
		? el('img', { class: 'sb-avatar', src: agent.avatar_thumbnail_url, alt: '', width: '44', height: '44', loading: 'lazy' })
		: el('div', { class: 'sb-avatar sb-avatar-empty', 'aria-hidden': 'true', text: (agent.name || 'A').slice(0, 1).toUpperCase() });
	const href = agent.home_url || `/agents/${encodeURIComponent(agent.id)}`;
	box.replaceChildren(
		poster,
		el('div', { class: 'sb-agent-meta' }, [
			el('h2', { class: 'sb-title', id: 'sb-agent-title', text: agent.name || 'Your agent' }),
			el('a', { class: 'sb-link', href, target: '_blank', rel: 'noopener', text: 'Open in 3D' }),
		]),
	);
	box.hidden = false;
}

function restoreHistory() {
	try {
		const saved = JSON.parse(sessionStorage.getItem(`${HISTORY_KEY}:${state.agent.id}`) || '[]');
		state.history = Array.isArray(saved) ? saved.slice(-20) : [];
	} catch {
		state.history = [];
	}
	const log = $('sb-log');
	log.replaceChildren(...state.history.map((m) => messageNode(m.role, m.content)));
	log.scrollTop = log.scrollHeight;
}

function persistHistory() {
	try {
		sessionStorage.setItem(`${HISTORY_KEY}:${state.agent.id}`, JSON.stringify(state.history.slice(-20)));
	} catch {
		/* storage full or disabled: the conversation still works for this view */
	}
}

function messageNode(role, text) {
	return el('li', { class: `sb-msg sb-msg-${role}`, text });
}

async function readChatStream(res, onText) {
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let acc = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const blocks = buf.split('\n\n');
		buf = blocks.pop() || '';
		for (const block of blocks) {
			const line = block.split('\n').find((l) => l.startsWith('data:'));
			if (!line) continue;
			let evt;
			try {
				evt = JSON.parse(line.slice(5).trim());
			} catch {
				continue;
			}
			if (evt.type === 'chunk' && evt.text) {
				acc += evt.text;
				onText(acc);
			} else if (evt.type === 'done' && !acc && evt.reply) {
				acc = evt.reply;
				onText(acc);
			} else if (evt.type === 'error') {
				throw new Error(evt.message || evt.error || 'The agent stopped replying.');
			}
		}
	}
	return acc;
}

async function sendMessage(text) {
	if (state.sending || !state.agent) return;
	state.sending = true;
	const log = $('sb-log');
	const send = $('sb-send');
	send.disabled = true;
	log.hidden = false;
	log.append(messageNode('user', text));
	const reply = messageNode('assistant', 'Thinking');
	reply.classList.add('is-pending');
	log.append(reply);
	log.scrollTop = log.scrollHeight;
	const history = state.history.slice(-10);
	state.history.push({ role: 'user', content: text });
	try {
		const res = await fetch('/api/chat', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ message: text, history, agentId: state.agent.id }),
		});
		if (!res.ok) {
			const j = await res.json().catch(() => ({}));
			throw new Error(j.error_description || j.message || `The agent returned ${res.status}.`);
		}
		const answer = await readChatStream(res, (acc) => {
			reply.classList.remove('is-pending');
			reply.textContent = acc;
			log.scrollTop = log.scrollHeight;
		});
		reply.classList.remove('is-pending');
		if (!answer) throw new Error('The agent sent an empty reply. Try rephrasing.');
		state.history.push({ role: 'assistant', content: answer });
		persistHistory();
		announce('Reply received');
	} catch (err) {
		state.history.pop();
		reply.classList.remove('is-pending');
		reply.classList.add('is-error');
		reply.textContent = `${err.message} Your message was not saved; send it again.`;
		$('sb-msg').value = text;
	} finally {
		state.sending = false;
		send.disabled = false;
	}
}

/* ── Text to 3D ──────────────────────────────────────────────────────────── */

function setJob(text, { busy = true, link = null } = {}) {
	const job = $('sb-job');
	job.hidden = false;
	job.classList.toggle('is-busy', busy);
	const p = $('sb-job-text');
	p.replaceChildren(document.createTextNode(text));
	if (link) {
		p.append(' ', el('a', { class: 'sb-link', href: link.href, target: '_blank', rel: 'noopener', text: link.label }));
	}
}

async function pollForge(jobId) {
	const hidden = createHiddenClock();
	const now = () => performance.now() - hidden.hiddenMs();
	const deadline = now() + MAX_POLL_MS;
	let backoff = POLL_MS;
	try {
		while (now() < deadline) {
			await sleepUntilVisibleOrElapsed(backoff);
			let data;
			try {
				data = await fetchJobStatus(`/api/forge?job=${encodeURIComponent(jobId)}`, { headers: FORGE_HEADERS });
			} catch (err) {
				if (err?.kind !== 'transport') throw err;
				backoff = nextBackoff(backoff, POLL_MAX_BACKOFF_MS);
				setJob('Still building. The connection dropped for a moment; checking again.');
				continue;
			}
			backoff = POLL_MS;
			if (data.status === 'done' && data.glb_url) return data;
			if (data.status === 'failed') throw new Error(data.error || 'The generator could not build that model.');
			if (data.error === 'invalid_job' || data.error === 'missing_job') {
				throw new Error(data.message || 'That generation is no longer available.');
			}
			setJob(data.status === 'running' ? 'Shaping the mesh and textures.' : 'Queued for the GPU.');
		}
	} finally {
		hidden.stop();
	}
	throw new Error('This model is taking longer than usual. It keeps building; find it later under All.');
}

async function forge(prompt) {
	if (state.forging) return;
	state.forging = true;
	const btn = $('sb-forge-btn');
	btn.disabled = true;
	setJob('Sending your prompt to the forge.');
	try {
		const res = await fetch('/api/forge', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...FORGE_HEADERS },
			body: JSON.stringify({ prompt, path: 'image', tier: 'standard', aspect_ratio: '1:1', director: true }),
		});
		const data = await res.json().catch(() => ({}));
		if (res.status === 429) throw new Error(data.message || 'The forge is busy. Try again in a few seconds.');
		if (res.status === 503) throw new Error('The generator is offline right now. Try again in a bit.');
		if (!res.ok) throw new Error(data.message || `The forge returned ${res.status}.`);
		const done = data.status === 'done' && data.glb_url ? data : await pollForge(data.job_id);
		const creationId = done.creation_id || data.creation_id;
		const href = creationId ? `/m/${encodeURIComponent(creationId)}` : `/viewer?src=${encodeURIComponent(done.glb_url)}`;
		setJob('Your model is ready.', { busy: false, link: { href, label: 'Open it' } });
		announce('Your 3D model is ready');
		$('sb-prompt').value = '';
		loadRecent();
	} catch (err) {
		setJob(err.message, { busy: false });
		announce(err.message);
	} finally {
		state.forging = false;
		btn.disabled = false;
	}
}

/* ── Recent models ───────────────────────────────────────────────────────── */

async function getJSON(url, init) {
	const res = await fetch(url, { credentials: 'include', ...init, headers: { accept: 'application/json', ...(init?.headers || {}) } });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

function normalizeCreation(c) {
	return {
		key: `m:${c.id}`,
		title: c.prompt || 'Forged model',
		sub: '3D model',
		poster: c.preview_image_url || null,
		href: `/m/${encodeURIComponent(c.id)}`,
		at: c.created_at || '',
	};
}

function normalizeAvatar(a) {
	return {
		key: `a:${a.id}`,
		title: a.name || 'Untitled avatar',
		sub: 'Saved avatar',
		poster: a.has_thumbnail ? `/api/avatars/${encodeURIComponent(a.id)}/thumb` : null,
		href: `/avatars/${encodeURIComponent(a.slug || a.id)}`,
		at: a.created_at || '',
	};
}

function recentNode(item) {
	const thumb = item.poster
		? el('img', { class: 'sb-thumb', src: item.poster, alt: '', width: '40', height: '40', loading: 'lazy' })
		: el('span', { class: 'sb-thumb sb-thumb-empty', 'aria-hidden': 'true' });
	return el('li', {}, [
		el('a', { class: 'sb-recent-item', href: item.href, target: '_blank', rel: 'noopener' }, [
			thumb,
			el('span', { class: 'sb-recent-text' }, [
				el('span', { class: 'sb-recent-title', text: item.title }),
				el('span', { class: 'sb-recent-sub', text: item.sub }),
			]),
		]),
	]);
}

async function loadRecent() {
	const list = $('sb-recent');
	const stateEl = $('sb-recent-state');
	list.setAttribute('aria-busy', 'true');
	const jobs = [getJSON(`/api/forge-gallery?limit=${RECENT_LIMIT}`, { headers: FORGE_HEADERS }).then((d) => (d.creations || []).map(normalizeCreation))];
	if (state.me) jobs.push(getJSON(`/api/avatars/mine?limit=${RECENT_LIMIT}`).then((d) => (d.avatars || []).map(normalizeAvatar)));
	const results = await Promise.allSettled(jobs);
	list.setAttribute('aria-busy', 'false');
	const items = results
		.filter((r) => r.status === 'fulfilled')
		.flatMap((r) => r.value)
		.sort((a, b) => String(b.at).localeCompare(String(a.at)))
		.slice(0, RECENT_LIMIT);
	stateEl.hidden = true;
	if (items.length) {
		list.replaceChildren(...items.map(recentNode));
		list.hidden = false;
		return;
	}
	list.hidden = true;
	if (results.every((r) => r.status === 'rejected')) {
		renderState(stateEl, { title: 'Recent models did not load', body: 'Check your connection, then try again.' });
		stateEl.append(retryButton('Try again', () => { list.hidden = false; loadRecent(); }));
		return;
	}
	renderState(stateEl, {
		title: 'No models yet',
		body: 'Describe something under Text to 3D and it lands here, ready to open, pose or embed.',
	});
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

function submitOnEnter(textarea, form) {
	textarea.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			form.requestSubmit();
		}
	});
}

function wire() {
	const chat = $('sb-chat');
	const msg = $('sb-msg');
	chat.addEventListener('submit', (e) => {
		e.preventDefault();
		const text = msg.value.trim();
		if (!text) return;
		msg.value = '';
		sendMessage(text);
	});
	submitOnEnter(msg, chat);

	const forgeForm = $('sb-forge');
	const prompt = $('sb-prompt');
	forgeForm.addEventListener('submit', (e) => {
		e.preventDefault();
		const text = prompt.value.trim();
		if (text) forge(text);
	});
	submitOnEnter(prompt, forgeForm);
}

async function boot() {
	wire();
	try {
		state.me = await getMe();
	} catch {
		state.me = null;
	}
	renderAccount();
	await Promise.all([loadAgent(), loadRecent()]);
}

boot();
