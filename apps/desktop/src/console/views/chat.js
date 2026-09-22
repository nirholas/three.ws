// Chat: talk to one of your agents and watch it work. Replies stream in as
// they are written; every tool the agent calls shows as a status chip that
// flips from running to done; anything that would move money arrives as a
// card that hands off to the Wallet's preview-and-approve flow instead of
// executing from chat.
//
// History lives on the server when it has the v1 Agents API (one thread
// across web, desktop and chat gateways). Otherwise it is kept on this
// device, per agent.

import { html, raw, mount, onAction, emptyState, errorState, avatar, skeletonLines } from '../lib/dom.js';
import { agentPicker, bindPicker } from '../lib/agents-store.js';
import { relativeTime, formatUsd, shortAddress } from '../../shared/normalize.js';

const MAX_LOCAL = 100;
const SUGGESTIONS = ['What can you do?', 'What is in your wallet?', 'Summarize what you did today', 'Which tools can you use?'];

const localKey = (agentId) => `console:chat:${agentId}`;

export function loadLocalHistory(agentId, storage = globalThis.localStorage) {
	try {
		const parsed = JSON.parse(storage?.getItem(localKey(agentId)) || '[]');
		return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.content === 'string') : [];
	} catch {
		return [];
	}
}

export function saveLocalHistory(agentId, messages, storage = globalThis.localStorage) {
	try {
		const keep = messages
			.filter((m) => !m.error && m.content)
			.slice(-MAX_LOCAL)
			.map(({ role, content, at, tools }) => ({ role, content, at, tools: tools || [] }));
		storage?.setItem(localKey(agentId), JSON.stringify(keep));
	} catch {
		// Storage full or blocked: the conversation still works, it just is not
		// remembered after the app closes.
	}
}

// A money-moving action an agent proposed mid-chat, as a hand-off card.
export function actionCard(action, index) {
	if (action?.type !== 'sendSol') return '';
	const to = action.to ? shortAddress(action.to, 6, 6) : 'your default address';
	return html`<div class="action-card" role="group" aria-label="Proposed send">
		<b>Your agent wants to send ${action.usd != null ? formatUsd(action.usd) : 'some'} of SOL to ${to}</b>
		Nothing has moved. Review the exact amount, recipient and fees before anything is sent.
		<div><button type="button" class="btn btn-sm btn-primary" data-action="review-send" data-index="${index}">Review in Wallet</button></div>
	</div>`;
}

export function toolChip(t) {
	const cls = t.status === 'done' ? 'done' : t.status === 'pending_confirmation' ? 'waiting' : 'running';
	const label = t.status === 'pending_confirmation' ? `${t.label}: waiting for your approval on three.ws` : t.label;
	return html`<span class="tool ${cls}"><span class="ico ${cls === 'done' ? 'ico-check' : 'ico-tool'}" aria-hidden="true"></span>${label}</span>`;
}

export function messageMarkup(m, i, markdown) {
	if (m.role === 'user') return html`<div class="msg msg-user">${m.content}</div>`;
	if (m.error) {
		return html`<div class="msg msg-error" role="alert">${m.error}
			<div><button type="button" class="btn btn-sm" data-action="retry-send" style="margin-top:8px">Try again</button></div></div>`;
	}
	// markdown() returns DOMPurify-sanitized HTML, so it is safe to inline.
	const body = m.content ? raw(markdown(m.content)) : '';
	return html`${m.tools?.length ? html`<div class="tools">${m.tools.map(toolChip)}</div>` : ''}
		${m.content || m.streaming ? html`<div class="msg msg-agent ${m.streaming ? 'caret' : ''}" ${m.streaming ? raw('id="live"') : ''}>${body}</div>` : ''}
		${(m.actions || []).map((a, j) => actionCard(a, `${i}:${j}`))}
		${m.at && !m.streaming ? html`<div class="msg-meta">${relativeTime(m.at)}${m.channel && m.channel !== 'desktop' ? ` · via ${m.channel}` : ''}</div>` : ''}`;
}

export function mountChat(root, ctx) {
	const { bridge, agents, markdown, navigate, toast } = ctx;
	let phase = 'loading';
	let loadError = null;
	let messages = [];
	let serverHistory = false;
	let requestId = null;
	let lastPrompt = null;
	let draft = '';

	const agentId = () => agents.selectedId();

	function logMarkup() {
		if (phase === 'history') {
			return html`<div class="chat-inner">${[64, 48, 72].map((w, i) => html`<div class="sk sk-bubble" style="width:${w}%;align-self:${i % 2 ? 'flex-end' : 'flex-start'}"></div>`)}</div>`;
		}
		if (!messages.length) {
			const a = agents.selected();
			return html`<div class="chat-empty">
				${avatar(a, 64)}
				<h3>Start a conversation with ${a?.name || 'your agent'}</h3>
				<p>${serverHistory ? 'This thread is shared with the web and your chat apps.' : 'This conversation is kept on this device.'} Ask anything, or try one of these:</p>
				<div class="suggestions">${SUGGESTIONS.map((s) => html`<button type="button" class="suggestion" data-action="suggest" data-text="${s}">${s}</button>`)}</div>
			</div>`;
		}
		return html`<div class="chat-inner">${messages.map((m, i) => messageMarkup(m, i, markdown))}</div>`;
	}

	function render() {
		if (phase === 'loading') {
			mount(root, html`<div class="view">${skeletonLines(4)}</div>`);
			return;
		}
		if (phase === 'error') {
			mount(root, html`<div class="view">${errorState(loadError, { title: 'Chat could not load' })}</div>`);
			return;
		}
		if (phase === 'empty') {
			mount(root, html`<div class="view">${emptyState({ icon: 'chat', title: 'No agents to talk to yet', message: 'Create an agent on three.ws, then come back to chat with it here.', actions: [{ action: 'create', label: 'Create an agent', primary: true }] })}</div>`);
			return;
		}
		const busy = Boolean(requestId);
		mount(root, html`<div class="view view-full">
			<div class="chat-head drag">
				${agentPicker(agents.list(), agentId(), 'Agent to chat with')}
				<span class="chip chip-plain" title="${serverHistory ? 'Stored on three.ws' : 'Stored on this device'}">${serverHistory ? 'Synced history' : 'This device'}</span>
				<span class="spacer"></span>
				<button type="button" class="btn btn-ghost btn-sm" data-action="new" ${busy || !messages.length ? raw('disabled') : ''}>New conversation</button>
			</div>
			<div class="chat-log" id="log" aria-live="polite">${logMarkup()}</div>
			<form class="composer" id="composer">
				<div class="composer-inner">
					<textarea id="input" rows="1" placeholder="Message ${agents.selected()?.name || 'your agent'}" aria-label="Message" spellcheck="true">${draft}</textarea>
					${busy
						? html`<button type="button" class="btn btn-icon" data-action="stop" aria-label="Stop"><span class="ico ico-stop" aria-hidden="true"></span></button>`
						: html`<button type="submit" class="btn btn-primary btn-icon" aria-label="Send" id="send"><span class="ico ico-send" aria-hidden="true"></span></button>`}
				</div>
				<div class="composer-hint"><span>Enter to send, Shift+Enter for a new line</span><span>Money never moves from chat without a preview</span></div>
			</form>
		</div>`);
		wireComposer();
		scrollToEnd();
	}

	function scrollToEnd() {
		const log = root.querySelector('#log');
		if (log) log.scrollTop = log.scrollHeight;
	}

	function autosize(ta) {
		ta.style.height = 'auto';
		ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
	}

	function wireComposer() {
		const ta = root.querySelector('#input');
		const form = root.querySelector('#composer');
		if (!ta || !form) return;
		autosize(ta);
		if (!requestId) ta.focus();
		ta.addEventListener('input', () => {
			draft = ta.value;
			autosize(ta);
		});
		ta.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				form.requestSubmit();
			}
		});
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			send(ta.value);
		});
	}

	// Text chunks touch only the live bubble; anything structural re-renders.
	function paintText() {
		const last = messages[messages.length - 1];
		const live = root.querySelector('#live');
		if (!live || !last?.streaming) return render();
		live.innerHTML = markdown(last.content);
		scrollToEnd();
	}

	async function send(text) {
		const message = String(text || '').trim();
		if (!message || requestId || !agentId()) return;
		lastPrompt = message;
		draft = '';
		const history = messages.filter((m) => !m.error && m.content);
		messages = messages.filter((m) => !m.error);
		messages.push({ role: 'user', content: message, at: new Date().toISOString() });
		messages.push({ role: 'assistant', content: '', tools: [], actions: [], streaming: true });
		try {
			const res = await bridge.chat.send({ agentId: agentId(), message, history });
			requestId = res.requestId;
		} catch (err) {
			messages[messages.length - 1] = { role: 'assistant', error: err.message };
		}
		render();
	}

	function finish() {
		const last = messages[messages.length - 1];
		if (last?.streaming) {
			last.streaming = false;
			last.at = new Date().toISOString();
			if (!last.content && !last.tools?.length && !last.actions?.length) messages.pop();
		}
		requestId = null;
		if (!serverHistory) saveLocalHistory(agentId(), messages);
		render();
	}

	const offEvents = bridge.chat.onEvent((evt) => {
		if (!requestId || evt.requestId !== requestId) return;
		const last = messages[messages.length - 1];
		if (!last) return;
		if (evt.type === 'chunk') {
			last.content += evt.text || '';
			paintText();
		} else if (evt.type === 'tool') {
			const existing = last.tools.find((t) => t.label === evt.label);
			if (existing) existing.status = evt.status;
			else last.tools.push({ label: evt.label, status: evt.status });
			render();
		} else if (evt.type === 'action') {
			last.actions.push(evt.action);
		} else if (evt.type === 'done') {
			if (evt.reply && !last.content) last.content = evt.reply;
			last.tools = last.tools.filter((t) => t.status !== 'thinking');
			for (const t of last.tools) if (t.status === 'running') t.status = 'done';
		} else if (evt.type === 'error') {
			messages[messages.length - 1] = { role: 'assistant', error: evt.code === 'signed_out' ? 'Your session ended. Sign in again to keep chatting.' : evt.message };
		} else if (evt.type === 'aborted') {
			if (!last.content) last.content = '_Stopped._';
		} else if (evt.type === 'end') {
			finish();
		}
	});

	async function loadConversation() {
		const id = agentId();
		if (!id) return;
		phase = 'history';
		render();
		try {
			const res = await bridge.chat.history(id);
			serverHistory = Boolean(res.serverHistory);
			messages = serverHistory ? res.messages : loadLocalHistory(id);
		} catch (err) {
			serverHistory = false;
			messages = loadLocalHistory(id);
			toast(`History could not load from the server: ${err.message}`, 'bad');
		}
		phase = 'ready';
		render();
	}

	async function boot() {
		phase = 'loading';
		render();
		try {
			await agents.load();
		} catch (err) {
			phase = 'error';
			loadError = err;
			render();
			return;
		}
		if (!agents.list().length) {
			phase = 'empty';
			render();
			return;
		}
		loadConversation();
	}

	const offPicker = bindPicker(root, agents, () => {
		if (requestId) bridge.chat.abort(requestId);
		requestId = null;
		loadConversation();
	});

	const offActions = onAction(root, {
		retry: boot,
		create: () => bridge.app.openExternal('/create'),
		suggest: (el) => send(el.dataset.text),
		stop: () => requestId && bridge.chat.abort(requestId),
		new: () => {
			messages = [];
			if (!serverHistory) saveLocalHistory(agentId(), messages);
			render();
		},
		'retry-send': () => {
			messages = messages.filter((m) => !m.error);
			if (messages[messages.length - 1]?.role === 'user') messages.pop();
			send(lastPrompt);
		},
		'review-send': (el) => {
			const [mi, ai] = el.dataset.index.split(':').map(Number);
			const action = messages[mi]?.actions?.[ai];
			if (!action) return;
			ctx.handoff = { type: 'send', agentId: agentId(), destination: action.to || '', usd: action.usd ?? null };
			navigate('wallet');
		},
	});

	boot();
	return () => {
		offEvents();
		offPicker();
		offActions();
		if (requestId) bridge.chat.abort(requestId);
	};
}
