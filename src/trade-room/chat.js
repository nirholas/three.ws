/**
 * Spectator chat panel for a live trade room.
 *
 * mountChat() renders the panel into a container, loads the recent messages
 * from /api/sniper/room-chat, and then takes live messages and removals from
 * the room's SSE stream (main.js forwards the `chat` and `chat_hidden`
 * events). Posting needs a signed-in session plus a CSRF token; the room's
 * owner can hide any message and an author can remove their own.
 *
 * Every user-supplied string reaches the DOM through textContent, never
 * innerHTML. Static markup and state-kit shells are the only HTML strings.
 */

import { emptyStateHTML, errorStateHTML, skeletonHTML } from '../shared/state-kit.js';
import { ago } from './model.js';

const MAX_MESSAGES = 200;
const PIN_SLACK_PX = 48;
const CLOCK_MS = 30_000;
const NARROW = '(max-width: 1023px)';

const ERROR_COPY = {
	unauthorized: 'Sign in to join the chat.',
	empty: 'Write something first.',
	blocked_content: 'That message contains language this room does not allow. Rephrase and send again.',
	duplicate: 'You just sent that exact message.',
	rate_limited: 'You are sending messages too fast. Wait a few seconds.',
	unavailable: 'Chat is not available right now. Your message was not sent, try again in a moment.',
	not_found: 'This room is no longer public, so it cannot take messages.',
};

const LIVE_COPY = {
	live: 'Trading now',
	warm: 'Traded recently',
	quiet: 'Quiet',
};

let csrfCache = null;
async function csrfToken() {
	if (csrfCache && csrfCache.expiresAt > Date.now() + 5_000) return csrfCache.token;
	const res = await fetch('/api/csrf-token', { credentials: 'include' });
	if (!res.ok) throw Object.assign(new Error('csrf'), { code: 'unauthorized' });
	const body = await res.json();
	csrfCache = { token: body.data.token, expiresAt: Date.now() + (body.data.expires_in - 30) * 1000 };
	return csrfCache.token;
}

async function callChat(agentId, { method = 'GET', query = '', body } = {}) {
	const headers = { accept: 'application/json' };
	if (method !== 'GET') {
		headers['x-csrf-token'] = await csrfToken();
		if (body) headers['content-type'] = 'application/json';
	}
	const res = await fetch(`/api/sniper/room-chat?agent_id=${encodeURIComponent(agentId)}${query}`, {
		method,
		credentials: 'include',
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		throw Object.assign(new Error(data?.error || `http_${res.status}`), {
			status: res.status,
			code: data?.error || `http_${res.status}`,
			serverMessage: data?.error_description || data?.message || '',
		});
	}
	return data;
}

function el(tag, cls, text) {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	if (text != null) node.textContent = text;
	return node;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.host        element the panel renders into
 * @param {string} opts.agentId
 * @param {string} opts.leaderName
 * @param {() => string} opts.roomState  'live' | 'warm' | 'quiet'
 * @returns {{onChat(m: object): void, onHidden(id: string): void, onRoomState(): void,
 *            reconnected(): void, sinceIso(): string|null, destroy(): void}}
 */
export function mountChat({ host, agentId, leaderName, roomState }) {
	const nowPath = `${location.pathname}${location.search}`;
	const signInHref = `/login?next=${encodeURIComponent(nowPath)}`;
	const mq = typeof matchMedia === 'function' ? matchMedia(NARROW) : null;

	const s = {
		status: 'loading', // loading | ready | error
		errorCode: '',
		messages: [],
		mine: new Set(),
		viewer: { signed_in: false, is_owner: false },
		maxLen: 280,
		cursorMs: Date.now(),
		pinned: true,
		unread: 0,
		sending: false,
		open: false,
		loadSeq: 0,
	};

	host.innerHTML = `
		<div class="trc-head">
			<h2 class="tr-h trc-title" id="trc-title">Room chat</h2>
			<span class="trc-live" data-live="quiet"><span class="trc-live-dot" aria-hidden="true"></span><span data-live-text></span></span>
			<button type="button" class="trc-close" aria-label="Close chat">Close</button>
		</div>
		<div class="trc-body">
			<ol class="trc-list" role="log" aria-live="polite" aria-relevant="additions" aria-labelledby="trc-title" tabindex="0"></ol>
			<button type="button" class="trc-pill" hidden></button>
		</div>
		<form class="trc-form" novalidate>
			<div class="trc-row">
				<label class="tr-sr-only" for="trc-input">Message to the room</label>
				<input class="trc-input" id="trc-input" type="text" autocomplete="off" enterkeyhint="send" />
				<button type="submit" class="lb-btn lb-btn-primary trc-send">Send</button>
			</div>
			<div class="trc-meta">
				<span class="trc-count" aria-hidden="true"></span>
				<span class="trc-note" role="status"></span>
			</div>
		</form>`;

	const launch = el('button', 'trc-launch');
	launch.type = 'button';
	launch.setAttribute('aria-controls', host.id || 'trc');
	launch.setAttribute('aria-expanded', 'false');
	host.insertAdjacentElement('afterend', launch);

	const list = host.querySelector('.trc-list');
	const pill = host.querySelector('.trc-pill');
	const form = host.querySelector('.trc-form');
	const input = host.querySelector('.trc-input');
	const sendBtn = host.querySelector('.trc-send');
	const count = host.querySelector('.trc-count');
	const note = host.querySelector('.trc-note');
	const liveEl = host.querySelector('.trc-live');
	const closeBtn = host.querySelector('.trc-close');

	// ── rendering ────────────────────────────────────────────────────────

	function setNote(text, tone = '') {
		note.textContent = text || '';
		note.dataset.tone = tone;
	}

	function renderLive() {
		const st = roomState() || 'quiet';
		liveEl.dataset.live = st;
		liveEl.querySelector('[data-live-text]').textContent = LIVE_COPY[st] || LIVE_COPY.quiet;
		if (s.status === 'ready' && !s.messages.length) renderList();
	}

	function renderLaunch() {
		const n = s.messages.length;
		launch.textContent = n ? `Chat (${n})` : 'Chat';
		launch.setAttribute('aria-label', n ? `Open room chat, ${n} messages` : 'Open room chat');
	}

	function renderComposer() {
		const signed = s.viewer.signed_in;
		const unavailable = s.status === 'error' && s.errorCode === 'unavailable';
		input.disabled = !signed || unavailable;
		sendBtn.disabled = !signed || s.sending || unavailable;
		input.maxLength = s.maxLen;
		input.placeholder = signed ? `Message ${leaderName}'s room` : 'Sign in to chat';
		updateCount();
		let gate = form.querySelector('.trc-gate');
		if (!signed && s.status !== 'loading') {
			if (!gate) {
				gate = el('a', 'lb-btn trc-gate', 'Sign in to chat');
				form.querySelector('.trc-row').appendChild(gate);
			}
			gate.href = signInHref;
			sendBtn.hidden = true;
		} else {
			gate?.remove();
			sendBtn.hidden = false;
		}
	}

	function updateCount() {
		const n = [...input.value].length;
		count.textContent = `${n}/${s.maxLen}`;
		count.dataset.near = n >= s.maxLen - 30 ? 'true' : 'false';
	}

	function messageNode(m) {
		const li = el('li', 'trc-msg');
		li.dataset.id = m.id;
		if (m.is_owner) li.classList.add('is-owner');
		const head = el('div', 'trc-msg-head');
		head.appendChild(el('span', 'trc-name', m.name));
		if (m.is_owner) {
			const badge = el('span', 'trc-badge', 'owner');
			badge.title = 'This is the trader who owns the room';
			head.appendChild(badge);
		}
		const time = el('time', 'trc-time', ago(m.at));
		time.dateTime = m.at;
		time.dataset.ago = '';
		head.appendChild(time);
		const mine = m.mine || s.mine.has(m.id);
		const role = mine ? 'author' : s.viewer.is_owner ? 'owner' : null;
		if (role) {
			const btn = el('button', 'trc-act', role === 'owner' && !mine ? 'Hide' : 'Delete');
			btn.type = 'button';
			btn.dataset.remove = m.id;
			btn.setAttribute('aria-label', `${role === 'owner' && !mine ? 'Hide' : 'Delete'} message from ${m.name}`);
			head.appendChild(btn);
		}
		li.appendChild(head);
		li.appendChild(el('p', 'trc-text', m.body));
		return li;
	}

	function renderList() {
		list.setAttribute('aria-busy', s.status === 'loading' ? 'true' : 'false');
		if (s.status === 'loading') {
			list.innerHTML = `<li class="trc-state">${skeletonHTML(4, 'text')}</li>`;
			return;
		}
		if (s.status === 'error') {
			const unavailable = s.errorCode === 'unavailable';
			list.innerHTML = `<li class="trc-state">${errorStateHTML({
				title: unavailable ? 'Chat is not available yet' : 'Could not load the chat',
				body: unavailable
					? 'Room chat is being set up. The trades above are unaffected. Try again in a moment.'
					: 'The chat did not answer. Check your connection and retry; the trades keep streaming.',
			})}</li>`;
			return;
		}
		if (!s.messages.length) {
			const st = roomState();
			list.innerHTML = `<li class="trc-state">${emptyStateHTML({
				compact: true,
				title: 'No messages yet',
				body: st === 'live'
					? `${leaderName} is trading right now. Say something, you would be the first.`
					: `This room is quiet right now and nobody has spoken yet. Start the conversation; it picks up when ${leaderName} trades again.`,
			})}</li>`;
			return;
		}
		const frag = document.createDocumentFragment();
		for (const m of s.messages) frag.appendChild(messageNode(m));
		list.replaceChildren(frag);
		if (s.pinned) scrollToEnd();
	}

	function scrollToEnd() {
		list.scrollTop = list.scrollHeight;
		s.unread = 0;
		renderPill();
	}

	function renderPill() {
		pill.hidden = s.unread === 0;
		if (s.unread) pill.textContent = s.unread === 1 ? '1 new message' : `${s.unread} new messages`;
	}

	// ── state changes ────────────────────────────────────────────────────

	function noteTime(iso) {
		const t = new Date(iso).getTime();
		if (Number.isFinite(t) && t > s.cursorMs) s.cursorMs = t;
	}

	function addMessage(m) {
		if (!m || !m.id || s.messages.some((x) => x.id === m.id)) return false;
		noteTime(m.at);
		const wasEmpty = s.messages.length === 0;
		s.messages.push(m);
		if (s.messages.length > MAX_MESSAGES) s.messages.splice(0, s.messages.length - MAX_MESSAGES);
		if (wasEmpty || s.status !== 'ready') {
			renderList();
		} else {
			list.appendChild(messageNode(m));
			while (list.children.length > s.messages.length) list.firstElementChild.remove();
			if (s.pinned) scrollToEnd();
			else { s.unread += 1; renderPill(); }
		}
		renderLaunch();
		return true;
	}

	function dropMessage(id) {
		const i = s.messages.findIndex((x) => x.id === id);
		if (i < 0) return;
		s.messages.splice(i, 1);
		s.mine.delete(id);
		list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
		if (!s.messages.length) renderList();
		renderLaunch();
	}

	async function load() {
		const seq = ++s.loadSeq;
		const first = s.status !== 'ready';
		// Messages the stream delivered while the first read was in flight.
		const pending = first ? s.messages : [];
		if (first) { s.status = 'loading'; renderList(); renderComposer(); }
		try {
			const data = await callChat(agentId);
			if (seq !== s.loadSeq) return;
			s.status = 'ready';
			s.errorCode = '';
			s.viewer = data.viewer || s.viewer;
			s.maxLen = data.max_length || s.maxLen;
			s.cursorMs = Number(data.t) || Date.now();
			const loaded = data.messages || [];
			const known = new Set(loaded.map((m) => m.id));
			s.messages = [...loaded, ...pending.filter((m) => !known.has(m.id))].slice(-MAX_MESSAGES);
			s.mine = new Set(s.messages.filter((m) => m.mine).map((m) => m.id));
			s.pinned = true;
			s.unread = 0;
			renderList();
			renderPill();
		} catch (err) {
			if (seq !== s.loadSeq) return;
			if (!first) return;
			s.status = 'error';
			s.errorCode = err.code === 'unavailable' ? 'unavailable' : 'failed';
			renderList();
		}
		renderComposer();
		renderLaunch();
	}

	async function send(e) {
		e.preventDefault();
		if (s.sending || !s.viewer.signed_in) return;
		const text = input.value;
		if (!text.trim()) { setNote(ERROR_COPY.empty, 'error'); input.focus(); return; }
		s.sending = true;
		sendBtn.disabled = true;
		sendBtn.textContent = 'Sending';
		setNote('');
		try {
			const { message } = await callChat(agentId, { method: 'POST', body: { body: text } });
			s.mine.add(message.id);
			if (!addMessage({ ...message, mine: true })) {
				list.querySelector(`[data-id="${CSS.escape(message.id)}"]`)?.replaceWith(messageNode({ ...message, mine: true }));
			}
			input.value = '';
			updateCount();
			s.pinned = true;
			scrollToEnd();
		} catch (err) {
			if (err.code === 'unauthorized' || err.status === 401) {
				s.viewer = { ...s.viewer, signed_in: false };
				renderComposer();
			}
			const fallback = err.status ? '' : 'Could not reach the server. Check your connection; your message is still in the box.';
			setNote(ERROR_COPY[err.code] || err.serverMessage || fallback || 'Could not send. Try again.', 'error');
		} finally {
			s.sending = false;
			sendBtn.textContent = 'Send';
			renderComposer();
			if (!input.disabled) input.focus();
		}
	}

	async function remove(id, btn) {
		btn.disabled = true;
		try {
			await callChat(agentId, { method: 'DELETE', query: `&id=${encodeURIComponent(id)}` });
			dropMessage(id);
		} catch (err) {
			btn.disabled = false;
			if (err.status === 404) { dropMessage(id); return; }
			setNote(err.status === 403 ? 'You can only remove your own messages.' : 'Could not remove that message. Try again.', 'error');
		}
	}

	// ── sheet (narrow screens) ───────────────────────────────────────────

	function setOpen(open) {
		s.open = open;
		host.classList.toggle('is-open', open);
		launch.setAttribute('aria-expanded', String(open));
		if (open) {
			s.pinned = true;
			scrollToEnd();
			if (!input.disabled) input.focus();
		} else if (mq?.matches) {
			launch.focus();
		}
	}

	// ── events ───────────────────────────────────────────────────────────

	list.addEventListener('scroll', () => {
		s.pinned = list.scrollHeight - list.scrollTop - list.clientHeight < PIN_SLACK_PX;
		if (s.pinned && s.unread) { s.unread = 0; renderPill(); }
	}, { passive: true });
	pill.addEventListener('click', () => { s.pinned = true; scrollToEnd(); });
	input.addEventListener('input', () => { updateCount(); if (note.dataset.tone === 'error') setNote(''); });
	form.addEventListener('submit', send);
	list.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-remove]');
		if (btn) remove(btn.dataset.remove, btn);
		if (e.target.closest('[data-sk-retry]')) load();
	});
	launch.addEventListener('click', () => setOpen(!s.open));
	closeBtn.addEventListener('click', () => setOpen(false));
	host.addEventListener('keydown', (e) => { if (e.key === 'Escape' && s.open && mq?.matches) setOpen(false); });

	const clock = setInterval(() => {
		for (const t of list.querySelectorAll('time[data-ago]')) t.textContent = ago(t.dateTime);
	}, CLOCK_MS);

	renderLive();
	renderLaunch();
	renderComposer();
	load();

	return {
		onChat(m) { addMessage(m); },
		onHidden(id) { dropMessage(id); },
		onRoomState: renderLive,
		reconnected() { load(); },
		sinceIso() { return new Date(s.cursorMs).toISOString(); },
		destroy() { clearInterval(clock); launch.remove(); },
	};
}
