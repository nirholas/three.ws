// The page: key status and setup, the chat stream, and the 3D stage. Every
// state on screen is driven by a real server response or stream event.

import { readSSE } from '/shared/sse.js';
import { createStage } from '/stage.js';

const $ = (id) => document.getElementById(id);
const MAX_MESSAGE = 1200;

const el = {
	boot: $('boot'),
	setup: $('setup'),
	setupProblem: $('setup-problem'),
	setupKeys: $('setup-keys'),
	setupRecheck: $('setup-recheck'),
	chat: $('chat'),
	notice: $('notice'),
	logWrap: $('log-wrap'),
	log: $('log'),
	empty: $('empty'),
	composer: $('composer'),
	input: $('composer-input'),
	counter: $('counter'),
	send: $('send'),
	stop: $('stop'),
	newChat: $('new-chat'),
	modelChip: $('model-chip'),
	canvas: $('stage-canvas'),
	stageEmpty: $('stage-empty'),
	stageLoading: $('stage-loading'),
	stageLoadingLabel: $('stage-loading-label'),
	stageBarFill: $('stage-bar'),
	stageError: $('stage-error'),
	stageBarRow: $('stage-bar-row'),
	stageTitle: $('stage-title'),
	spin: $('spin'),
	resetView: $('reset-view'),
	viewerLink: $('viewer-link'),
	download: $('download'),
	versions: $('versions'),
	versionsList: $('versions-list'),
	live: $('live'),
};

const state = {
	responseId: null,
	busy: false,
	controller: null,
	versions: [],
	active: -1,
	buffers: new Map(),
	lastMessage: '',
	ready: false,
};

let stage = null;
function getStage() {
	if (!stage) stage = createStage(el.canvas);
	return stage;
}

// ---------------------------------------------------------------- helpers

function h(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === null || value === undefined || value === false) continue;
		if (key === 'class') node.className = value;
		else if (key === 'text') node.textContent = value;
		else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
		else node.setAttribute(key, value === true ? '' : value);
	}
	for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
	return node;
}

function announce(message) {
	el.live.textContent = '';
	requestAnimationFrame(() => (el.live.textContent = message));
}

function formatBytes(n) {
	if (!Number.isFinite(n)) return '';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatSeconds(s) {
	if (!Number.isFinite(s) || s < 0) return '';
	if (s < 60) return `${Math.round(s)}s`;
	return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

function nearBottom() {
	const w = el.logWrap;
	return w.scrollHeight - w.scrollTop - w.clientHeight < 80;
}

function scrollLog(force = false) {
	if (force || nearBottom()) el.logWrap.scrollTop = el.logWrap.scrollHeight;
}

/** An error card from an AppError JSON: title, message, fix, and a link or retry when useful. */
function errorCard(error, { onRetry } = {}) {
	const actions = [];
	if (error.link) actions.push(h('a', { class: 'btn btn-ghost btn-sm', href: error.link, target: '_blank', rel: 'noopener', text: linkLabel(error.link) }));
	if (onRetry && error.retryable) actions.push(h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: onRetry, text: 'Try again' }));
	return [
		h('p', { class: 'card-title', text: error.title || 'Something went wrong' }),
		error.message ? h('p', { class: 'card-body', text: error.message }) : null,
		error.fix ? h('p', { class: 'card-fix', text: error.fix }) : null,
		actions.length ? h('div', { class: 'card-actions' }, actions) : null,
	];
}

function linkLabel(url) {
	try {
		const { hostname, pathname } = new URL(url);
		if (/viewer/.test(pathname)) return 'Open the viewer';
		if (/api-keys/.test(pathname)) return `Open ${hostname}${pathname}`;
		return `Open ${hostname}`;
	} catch {
		return 'Open link';
	}
}

// ---------------------------------------------------------------- status and setup

async function loadStatus({ refresh = false } = {}) {
	el.setupRecheck.disabled = true;
	el.setupRecheck.textContent = 'Checking...';
	try {
		const res = await fetch(`/api/status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`);
		applyStatus(await res.json());
	} catch (err) {
		showSetup([], {
			title: 'Could not reach this starter\'s server',
			message: err.message || 'The status request failed.',
			fix: 'Make sure the server is running (npm run dev) and reload the page.',
		});
	} finally {
		el.boot.hidden = true;
		el.setupRecheck.disabled = false;
		el.setupRecheck.textContent = 'Check again';
	}
}

function applyStatus(status) {
	if (status.model) {
		el.modelChip.textContent = status.model;
		el.modelChip.title = `xAI model: ${status.model}. Change it with XAI_MODEL in .env.`;
		el.modelChip.hidden = false;
	}
	if (status.missing.length || status.problem) {
		state.ready = false;
		showSetup(status.missing, status.problem, status);
		return;
	}
	state.ready = true;
	el.setup.hidden = true;
	el.chat.hidden = false;
	if (status.warning) showNotice(`${status.warning.title}. ${status.warning.fix || ''}`.trim());
	else hideNotice();
	updateComposer();
}

function keyItem(entry, problem) {
	const malformed = problem === 'malformed';
	return h(
		'li',
		{ class: 'setup-key' },
		h('div', { class: 'setup-key-head' }, h('span', { class: 'setup-key-name', text: entry.label }), h('span', { class: `pill ${malformed ? 'pill-warn' : 'pill-error'}`, text: malformed ? 'Has extra characters' : problem === 'rejected' ? 'Rejected' : 'Missing' })),
		h('p', { class: 'setup-key-why', text: entry.why }),
		malformed ? h('p', { class: 'setup-key-why', text: 'The value contains spaces, quotes or other characters a key never has. Paste it again as plain text.' }) : null,
		h('p', { class: 'setup-key-where' }, 'Create it at ', h('a', { href: entry.url, target: '_blank', rel: 'noopener', text: entry.url.replace(/^https:\/\//, '') })),
		h('div', { class: 'env-line' }, h('code', { text: entry.example }), copyButton(`${entry.name}=`)),
	);
}

function copyButton(text) {
	const button = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Copy ${text}`, text: 'Copy' });
	button.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(text);
			button.textContent = 'Copied';
			announce(`Copied ${text}`);
		} catch {
			button.textContent = 'Select and copy';
		}
		setTimeout(() => (button.textContent = 'Copy'), 1600);
	});
	return button;
}

const KEY_FOR_CODE = {
	xai_unauthorized: 'XAI_API_KEY',
	xai_bad_key: 'XAI_API_KEY',
	xai_forbidden: 'XAI_API_KEY',
	three_ws_bad_key: 'THREE_WS_API_KEY',
};

function showSetup(missing, problem, status = null) {
	el.chat.hidden = true;
	el.setup.hidden = false;
	el.setupKeys.replaceChildren();
	for (const entry of missing) el.setupKeys.append(keyItem(entry, entry.problem));
	const rejected = problem && KEY_FOR_CODE[problem.code];
	if (rejected && status?.keyHelp?.[rejected]) el.setupKeys.append(keyItem({ name: rejected, ...status.keyHelp[rejected] }, 'rejected'));
	if (problem) {
		el.setupProblem.replaceChildren(...errorCard(problem));
		el.setupProblem.hidden = false;
	} else {
		el.setupProblem.hidden = true;
	}
	el.setupKeys.hidden = el.setupKeys.childElementCount === 0;
	const names = missing.map((m) => m.label);
	announce(problem ? problem.title : `Setup needed: ${names.join(' and ')}`);
}

function showNotice(message) {
	el.notice.textContent = message;
	el.notice.hidden = false;
}

function hideNotice() {
	el.notice.hidden = true;
	el.notice.textContent = '';
}

// ---------------------------------------------------------------- composer

function updateComposer() {
	const length = el.input.value.length;
	const text = el.input.value.trim();
	el.send.disabled = !state.ready || state.busy || !text || length > MAX_MESSAGE;
	el.stop.hidden = !state.busy;
	el.input.disabled = !state.ready;
	el.newChat.disabled = state.busy || (!state.responseId && state.versions.length === 0 && el.log.childElementCount === 0);
	if (length > MAX_MESSAGE - 200) {
		el.counter.hidden = false;
		el.counter.textContent = ` ${length} / ${MAX_MESSAGE}`;
		el.counter.classList.toggle('over', length > MAX_MESSAGE);
	} else {
		el.counter.hidden = true;
	}
}

function autoGrow() {
	el.input.style.height = 'auto';
	el.input.style.height = `${Math.min(el.input.scrollHeight, 180)}px`;
}

// ---------------------------------------------------------------- the turn

function stageNote() {
	const version = state.versions[state.active];
	return version ? { glbUrl: version.glbUrl, label: version.label || version.prompt || '' } : null;
}

function startTurn(message) {
	const text = message.trim();
	if (!text || state.busy || !state.ready) return;
	state.lastMessage = text;
	el.input.value = '';
	autoGrow();
	el.empty.hidden = true;
	el.log.append(h('li', { class: 'msg msg-user' }, h('p', { text })));
	const turn = createTurnView();
	scrollLog(true);
	runTurn(text, turn);
}

function createTurnView() {
	const timeline = h('ol', { class: 'timeline', 'aria-label': 'What Grok did' });
	const reply = h('div', { class: 'reply' });
	const status = h('p', { class: 'turn-status' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'turn-status-text', text: 'Sending to Grok' }));
	const extras = h('div', { class: 'turn-extras' });
	const root = h('li', { class: 'msg msg-grok', 'aria-busy': 'true' }, status, timeline, reply, extras);
	el.log.append(root);
	return {
		root,
		timeline,
		reply,
		extras,
		status,
		tools: new Map(),
		job: null,
		text: '',
		setStatus(textValue) {
			status.hidden = false;
			status.querySelector('.turn-status-text').textContent = textValue;
		},
		finish() {
			root.removeAttribute('aria-busy');
			status.hidden = true;
		},
	};
}

const TOOL_LABEL = {
	search_catalog: 'Searching the catalog',
	forge_free: 'Generating a model',
	refine_model: 'Refining the model',
	check_job: 'Collecting the render',
	get_job: 'Checking the render',
};

function argsSummary(args) {
	if (!args || typeof args !== 'object') return '';
	const pick = args.q || args.query || args.prompt || args.instruction || args.job_id || args.raw;
	return typeof pick === 'string' ? pick : '';
}

function toolRow(turn, data) {
	let row = turn.tools.get(data.id);
	if (!row) {
		const summary = h('span', { class: 'tool-summary' });
		const detail = h('pre', { class: 'tool-args' });
		const toggle = h('button', { type: 'button', class: 'tool-toggle', 'aria-expanded': 'false' }, h('span', { class: 'tool-icon', 'aria-hidden': 'true' }), h('span', { class: 'tool-name' }), summary);
		const item = h('li', { class: 'tool running' }, toggle, detail);
		detail.hidden = true;
		toggle.addEventListener('click', () => {
			const open = toggle.getAttribute('aria-expanded') !== 'true';
			toggle.setAttribute('aria-expanded', String(open));
			detail.hidden = !open;
		});
		turn.timeline.append(item);
		row = { item, toggle, summary, detail, name: toggle.querySelector('.tool-name') };
		turn.tools.set(data.id, row);
	}
	row.name.textContent = TOOL_LABEL[data.name] || data.name;
	const arg = argsSummary(data.arguments);
	if (arg && !row.summary.dataset.result) row.summary.textContent = arg;
	row.detail.textContent = `${data.name}(${JSON.stringify(data.arguments || {}, null, 2)})`;
	return row;
}

function onToolResult(turn, data) {
	const row = turn.tools.get(data.id) || toolRow(turn, { id: data.id, name: data.name, arguments: {} });
	row.item.classList.remove('running');
	const failed = ['failed', 'sign_in_required', 'bad_key'].includes(data.kind);
	row.item.classList.add(failed ? 'failed' : data.kind === 'pending' ? 'pending' : 'ok');
	row.summary.dataset.result = '1';
	row.summary.textContent = data.summary;
}

function jobView(turn) {
	if (!turn.job) {
		const label = h('span', { class: 'job-label', text: 'Rendering on three.ws' });
		const meta = h('span', { class: 'job-meta' });
		const fill = h('div', { class: 'bar-fill' });
		const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Render progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
		const link = h('a', { class: 'job-link', target: '_blank', rel: 'noopener', hidden: true, text: 'Watch in the viewer' });
		const root = h('div', { class: 'job' }, h('div', { class: 'job-head' }, label, meta), bar, link);
		turn.extras.append(root);
		turn.job = { root, label, meta, fill, bar, link };
	}
	return turn.job;
}

function onJob(turn, data) {
	const view = jobView(turn);
	const pct = Number.isFinite(data.progress) ? Math.max(0, Math.min(100, Math.round(data.progress <= 1 ? data.progress * 100 : data.progress))) : null;
	view.label.textContent = data.phase ? `Rendering on three.ws: ${data.phase}` : 'Rendering on three.ws';
	const parts = [];
	if (pct !== null) parts.push(`${pct}%`);
	if (Number.isFinite(data.elapsedSeconds)) parts.push(`${formatSeconds(data.elapsedSeconds)} in`);
	if (Number.isFinite(data.etaSeconds) && data.etaSeconds > 0) parts.push(`about ${formatSeconds(data.etaSeconds)} left`);
	view.meta.textContent = parts.join(' · ');
	if (pct !== null) {
		view.bar.classList.remove('indeterminate');
		view.fill.style.width = `${pct}%`;
		view.bar.setAttribute('aria-valuenow', String(pct));
	} else {
		view.bar.classList.add('indeterminate');
		view.bar.removeAttribute('aria-valuenow');
	}
	if (data.viewerUrl) {
		view.link.href = data.viewerUrl;
		view.link.hidden = false;
	}
	turn.setStatus('Grok started a render. Following it until the model is ready.');
}

function onCatalog(turn, data) {
	if (!data.items?.length) return;
	const list = h('ul', { class: 'catalog', 'aria-label': 'Catalog matches' });
	for (const item of data.items.slice(0, 6)) {
		const button = h(
			'button',
			{ type: 'button', class: 'catalog-item', title: `Put ${item.title} on the stage` },
			item.thumb ? h('img', { src: item.thumb, alt: '', loading: 'lazy', width: '96', height: '96' }) : h('span', { class: 'catalog-noimg', 'aria-hidden': 'true' }),
			h('span', { class: 'catalog-title', text: item.title }),
			h('span', { class: 'catalog-meta', text: [item.license, formatBytes(item.bytes)].filter(Boolean).join(' · ') }),
		);
		button.addEventListener('click', () => {
			addVersion({ glbUrl: item.glbUrl, viewerUrl: item.viewerUrl, posterUrl: item.thumb, label: item.title, prompt: item.title, tool: 'search_catalog' });
		});
		list.append(h('li', {}, button));
	}
	turn.extras.append(h('p', { class: 'extras-label', text: 'Catalog matches. Pick one to put it on the stage.' }), list);
	const first = data.items[0];
	if (first && !state.versions.some((v) => v.glbUrl === first.glbUrl)) {
		addVersion({ glbUrl: first.glbUrl, viewerUrl: first.viewerUrl, posterUrl: first.thumb, label: first.title, prompt: first.title, tool: 'search_catalog' });
	}
}

function onModel(turn, data) {
	if (turn.job) {
		turn.job.root.classList.add('done');
		turn.job.label.textContent = 'Render finished';
		turn.job.bar.classList.remove('indeterminate');
		turn.job.fill.style.width = '100%';
		turn.job.bar.setAttribute('aria-valuenow', '100');
	}
	const label = data.instruction ? `${data.label || data.prompt || 'Model'}: ${data.instruction}` : data.label || data.prompt || 'Model';
	const version = addVersion({ ...data, label });
	const card = h(
		'div',
		{ class: 'model-card' },
		data.posterUrl ? h('img', { src: data.posterUrl, alt: '', width: '64', height: '64', loading: 'lazy' }) : null,
		h('div', { class: 'model-card-body' }, h('p', { class: 'model-card-title', text: label }), h('p', { class: 'model-card-meta', text: data.tool === 'refine_model' ? 'Refined version' : 'New model' })),
		h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Show', onclick: () => selectVersion(state.versions.indexOf(version)) }),
	);
	turn.extras.append(card);
	turn.setStatus('Model ready. Grok is wrapping up.');
}

async function runTurn(message, turn) {
	state.busy = true;
	state.controller = new AbortController();
	updateComposer();
	announce('Sent. Waiting for Grok.');
	let finished = false;
	let failure = null;

	try {
		const res = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
			body: JSON.stringify({ message, previousResponseId: state.responseId, stage: stageNote() }),
			signal: state.controller.signal,
		});
		if (!res.ok || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
			const body = await res.json().catch(() => ({}));
			throw Object.assign(new Error(body?.error?.message || `HTTP ${res.status}`), { app: body?.error || null });
		}
		for await (const evt of readSSE(res.body)) {
			let data = {};
			try {
				data = evt.data ? JSON.parse(evt.data) : {};
			} catch {
				continue;
			}
			switch (evt.event) {
				case 'response':
					state.responseId = data.id;
					break;
				case 'round':
					turn.setStatus(data.round > 1 ? 'Telling Grok the model is ready' : 'Grok is reading your message');
					break;
				case 'thinking':
					turn.setStatus('Grok is thinking');
					break;
				case 'text':
					turn.text += data.delta;
					turn.reply.textContent = turn.text;
					break;
				case 'tool':
					toolRow(turn, data);
					if (data.status === 'running') turn.setStatus(`${TOOL_LABEL[data.name] || data.name} on three.ws`);
					break;
				case 'tool_result':
					onToolResult(turn, data);
					break;
				case 'job':
					onJob(turn, data);
					break;
				case 'model':
					onModel(turn, data);
					break;
				case 'catalog':
					onCatalog(turn, data);
					break;
				case 'notice':
					turn.extras.append(h('p', { class: 'turn-notice', text: data.message }));
					break;
				case 'error':
					failure = data;
					break;
				case 'done':
					finished = true;
					if (data.responseId) state.responseId = data.responseId;
					break;
				default:
					break;
			}
			scrollLog();
		}
		if (!finished && !failure) {
			failure = { code: 'stream_closed', title: 'The connection closed early', message: 'The server stopped streaming before the turn finished.', fix: 'Send the message again.', retryable: true };
		}
	} catch (err) {
		if (err.name === 'AbortError') {
			turn.extras.append(h('p', { class: 'turn-notice', text: 'Stopped. Anything already running on three.ws keeps going; ask "check on it" to collect it.' }));
			announce('Stopped');
		} else {
			failure = err.app || { code: 'network', title: 'Could not reach the server', message: err.message, fix: 'Check that the server is still running, then send again.', retryable: true };
		}
	} finally {
		state.busy = false;
		state.controller = null;
		turn.finish();
		if (failure) showTurnError(turn, failure, message);
		else if (finished) announce(turn.text ? `Grok: ${turn.text}` : 'Done');
		updateComposer();
		scrollLog();
		if (!el.input.disabled) el.input.focus({ preventScroll: true });
	}
}

function showTurnError(turn, error, message) {
	if (turn.job && !turn.job.root.classList.contains('done')) turn.job.root.classList.add('stopped');
	for (const row of turn.tools.values()) if (row.item.classList.contains('running')) row.item.classList.replace('running', 'failed');
	const card = h('div', { class: 'card card-error', role: 'alert' }, errorCard(error, { onRetry: () => startTurn(message) }));
	turn.extras.append(card);
	if (KEY_FOR_CODE[error.code] || error.code === 'three_ws_sign_in' || error.code === 'setup_required') loadStatus({ refresh: true });
}

function stopTurn() {
	state.controller?.abort();
}

function newChat() {
	if (state.busy) return;
	state.responseId = null;
	el.log.replaceChildren();
	el.empty.hidden = false;
	updateComposer();
	announce('New chat. The model on the stage stays until you make another.');
	el.input.focus();
}

// ---------------------------------------------------------------- versions and stage

function addVersion(data) {
	const existing = state.versions.findIndex((v) => v.glbUrl === data.glbUrl);
	if (existing >= 0) {
		selectVersion(existing);
		return state.versions[existing];
	}
	const version = { glbUrl: data.glbUrl, viewerUrl: data.viewerUrl || null, posterUrl: data.posterUrl || null, label: data.label || 'Model', prompt: data.prompt || '', tool: data.tool || '' };
	state.versions.push(version);
	renderVersions();
	selectVersion(state.versions.length - 1);
	return version;
}

function renderVersions() {
	el.versionsList.replaceChildren();
	state.versions.forEach((version, index) => {
		const button = h(
			'button',
			{ type: 'button', class: 'version', 'aria-current': index === state.active ? 'true' : null, title: version.label },
			version.posterUrl ? h('img', { src: version.posterUrl, alt: '', width: '40', height: '40' }) : h('span', { class: 'version-num', 'aria-hidden': 'true', text: String(index + 1) }),
			h('span', { class: 'version-label', text: `v${index + 1}` }),
		);
		button.setAttribute('aria-label', `Version ${index + 1}: ${version.label}`);
		button.addEventListener('click', () => selectVersion(index));
		el.versionsList.append(h('li', {}, button));
	});
	el.versions.hidden = state.versions.length < 2;
}

async function selectVersion(index) {
	const version = state.versions[index];
	if (!version) return;
	state.active = index;
	renderVersions();
	el.stageTitle.textContent = version.label;
	el.viewerLink.hidden = !version.viewerUrl;
	if (version.viewerUrl) el.viewerLink.href = version.viewerUrl;
	await showOnStage(version);
}

async function showOnStage(version) {
	el.stageEmpty.hidden = true;
	el.stageError.hidden = true;
	el.stageLoading.hidden = false;
	el.stageBarRow.hidden = false;
	el.download.disabled = true;
	el.stageLoadingLabel.textContent = 'Downloading the model';
	el.stageBarFill.style.width = '0%';
	el.stageBarFill.parentElement.classList.add('indeterminate');
	try {
		const result = await getStage().load(version.glbUrl, {
			onProgress(loaded, total) {
				if (total) {
					el.stageBarFill.parentElement.classList.remove('indeterminate');
					el.stageBarFill.style.width = `${Math.round((loaded / total) * 100)}%`;
					el.stageLoadingLabel.textContent = `Downloading the model: ${formatBytes(loaded)} of ${formatBytes(total)}`;
				} else {
					el.stageLoadingLabel.textContent = `Downloading the model: ${formatBytes(loaded)}`;
				}
			},
		});
		state.buffers.set(version.glbUrl, result.buffer);
		version.bytes = result.bytes;
		el.stageLoading.hidden = true;
		el.download.disabled = false;
		el.download.textContent = `Download GLB (${formatBytes(result.bytes)})`;
		el.canvas.setAttribute('aria-label', `3D model: ${version.label}. Drag or use the arrow keys to look around.`);
		el.canvas.dataset.loaded = version.glbUrl;
		announce(`${version.label} is on the stage`);
	} catch (err) {
		if (err.name === 'AbortError') return;
		el.stageLoading.hidden = true;
		const viewer = version.viewerUrl;
		el.stageError.replaceChildren(
			...errorCard(
				{
					title: 'The model could not be shown here',
					message: err.message || 'Loading the GLB failed.',
					fix: viewer ? 'The model is still on three.ws. Open it in the viewer, or try loading it again.' : 'Try loading it again.',
					link: viewer,
					retryable: true,
				},
				{ onRetry: () => showOnStage(version) },
			),
		);
		el.stageError.hidden = false;
	}
}

function downloadActive() {
	const version = state.versions[state.active];
	const buffer = version && state.buffers.get(version.glbUrl);
	if (!buffer) return;
	const blob = new Blob([buffer], { type: 'model/gltf-binary' });
	const url = URL.createObjectURL(blob);
	const name = `${(version.label || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'model'}.glb`;
	const a = h('a', { href: url, download: name });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
	announce(`Downloading ${name}`);
}

// ---------------------------------------------------------------- wiring

el.composer.addEventListener('submit', (event) => {
	event.preventDefault();
	startTurn(el.input.value);
});
el.input.addEventListener('input', () => {
	autoGrow();
	updateComposer();
});
el.input.addEventListener('keydown', (event) => {
	if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		if (!el.send.disabled) startTurn(el.input.value);
	}
});
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && state.busy) stopTurn();
});
el.stop.addEventListener('click', stopTurn);
el.newChat.addEventListener('click', newChat);
el.setupRecheck.addEventListener('click', () => loadStatus({ refresh: true }));
for (const button of document.querySelectorAll('.example')) {
	button.addEventListener('click', () => {
		el.input.value = button.dataset.prompt;
		autoGrow();
		updateComposer();
		startTurn(button.dataset.prompt);
	});
}
el.spin.addEventListener('click', () => {
	const on = !getStage().turntable;
	getStage().setTurntable(on);
	el.spin.setAttribute('aria-pressed', String(on));
});
el.resetView.addEventListener('click', () => getStage().resetView());
el.download.addEventListener('click', downloadActive);
el.canvas.addEventListener('keydown', (event) => {
	if (stage && stage.handleKey(event)) {
		event.preventDefault();
		if (stage.turntable) {
			stage.setTurntable(false);
			el.spin.setAttribute('aria-pressed', 'false');
		}
	}
});

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) el.spin.setAttribute('aria-pressed', 'false');

// ?glb=<https link>&label=<name> opens any GLB on the stage, so a model can be
// shared as a link to this page. Follow-ups then refine that model.
function openFromLink() {
	const params = new URLSearchParams(location.search);
	const raw = params.get('glb');
	if (!raw) return;
	let url;
	try {
		url = new URL(raw);
	} catch {
		return;
	}
	if (url.protocol !== 'https:') return;
	const label = (params.get('label') || decodeURIComponent(url.pathname.split('/').pop() || 'Model').replace(/\.glb$/i, '')).slice(0, 120);
	const viewer = params.get('viewer');
	addVersion({ glbUrl: url.href, viewerUrl: viewer && viewer.startsWith('https://') ? viewer : null, label, prompt: label, tool: 'link' });
}

openFromLink();
loadStatus();
