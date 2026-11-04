// /settings/sandbox: the owner surface for the agent sandbox.
// Talks to /api/sandbox/* (api/sandbox/[action].js). Read-mostly: agents start
// executions; the owner reads output, downloads files, stops a workspace and
// edits the host allowlist.

import { apiFetch } from './api.js';

const $ = (id) => document.getElementById(id);
const state = { overview: null };

function el(tag, attrs = {}, ...kids) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === false || v == null) continue;
		if (k === 'class') node.className = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(kid));
	return node;
}

async function call(path, { method = 'GET', body } = {}) {
	const res = await apiFetch(path, {
		method,
		headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.error_description || data.error || `request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return data;
}

let toastTimer;
function toast(message) {
	const t = $('toast');
	t.textContent = message;
	t.classList.add('show');
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

const usd = (n) => `$${Number(n || 0).toFixed(Number(n) < 0.01 && Number(n) > 0 ? 6 : 4)}`;
const secs = (ms) => (ms == null ? '-' : `${(Number(ms) / 1000).toFixed(1)}s`);
const bytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const tone = (s) => (s === 'succeeded' || s === 'active' ? 'ok' : s === 'failed' || s === 'error' || s === 'timeout' || s === 'killed' ? 'bad' : 'warn');
const skeleton = (n) => Array.from({ length: n }, () => el('div', { class: 'sb-skel' }));
const fileHref = (runId, path) => `/api/sandbox/file?run=${encodeURIComponent(runId)}&path=${encodeURIComponent(path)}`;

function section(host, message, retry) {
	host.replaceChildren(el('div', { class: 'sb-error' }, el('p', {}, message), retry ? el('button', { type: 'button', class: 'sb-btn', onclick: retry }, 'Retry') : null));
}

function renderLimits(o) {
	const l = o.limits;
	const stat = (value, label) => el('div', { class: 'sb-stat' }, el('b', {}, value), el('span', {}, label));
	const avail = o.backends.filter((b) => b.available).map((b) => b.label).join(', ');
	$('limits-body').replaceChildren(
		el(
			'div',
			{ class: 'sb-grid' },
			stat(String(l.plan), 'plan'),
			stat(`${l.cpu} CPU, ${l.memoryMb} MB`, 'per program'),
			stat(`${l.maxWallSeconds}s`, 'longest program'),
			stat(String(l.executionsPerRun), 'programs per workspace'),
			stat(bytes(l.workspaceBytes), 'workspace size'),
			stat(l.egress ? 'bridge only' : 'none', 'network'),
		),
		el('p', { class: 'sb-sub' }, avail ? `Running on: ${avail}.` : 'No sandbox backend is available right now, so agents cannot run code until one is configured.'),
	);
}

function renderHosts(o) {
	$('hosts-input').value = o.settings.allow_hosts.join('\n');
	$('hosts-note').textContent = o.settings.allow_hosts.length ? `${o.settings.allow_hosts.length} allowed` : 'No hosts allowed. Programs can only call platform tools.';
}

async function saveHosts() {
	const hosts = $('hosts-input').value.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);
	const btn = $('hosts-save');
	btn.disabled = true;
	try {
		const { settings } = await call('/api/sandbox/settings', { method: 'PATCH', body: { allow_hosts: hosts } });
		state.overview.settings = settings;
		renderHosts(state.overview);
		toast('Allowed hosts saved');
	} catch (err) {
		toast(err.message);
	} finally {
		btn.disabled = false;
	}
}

function renderExecution(e, runId) {
	const out = (label, text, truncated) =>
		text ? el('div', {}, el('small', {}, label + (truncated ? ' (truncated)' : '')), el('pre', { class: 'sb-out' }, text)) : null;
	const files = (e.files_out || []).map((f) => el('a', { class: 'sb-file', href: fileHref(runId, f.path), download: '' }, `${f.path} (${bytes(f.size ?? 0)})`));
	return el(
		'div',
		{ class: 'sb-exec' },
		el(
			'div',
			{ class: 'sb-row', style: 'margin:0' },
			el('b', {}, `#${e.seq} ${e.kind === 'terminal' ? 'terminal' : e.language || 'code'}`),
			el('span', { class: `sb-pill ${tone(e.status)}` }, e.status),
			el('small', {}, `${secs(e.wall_ms)}, exit ${e.exit_code ?? '-'}, ${e.backend}, ${usd(e.charged_usd)}`),
		),
		e.code ? el('pre', { class: 'sb-out' }, e.code) : null,
		out('stdout', e.stdout, e.stdout_truncated),
		out('stderr', e.stderr, e.stderr_truncated),
		e.error ? el('p', { class: 'sb-sub' }, `Error: ${e.error}`) : null,
		files.length ? el('div', { class: 'sb-files' }, files) : null,
	);
}

async function loadDetail(run, panel) {
	panel.replaceChildren(...skeleton(2));
	try {
		const d = await call(`/api/sandbox/run?run=${encodeURIComponent(run.run_id)}`);
		const kids = [];
		if (d.run.status === 'active') {
			kids.push(
				el(
					'div',
					{ class: 'sb-row', style: 'margin:0 0 8px' },
					el('button', { type: 'button', class: 'sb-btn danger', onclick: () => stopRun(run) }, 'Stop this workspace'),
					el('small', {}, 'No further programs will run in it.'),
				),
			);
		} else if (d.run.killed_reason) {
			kids.push(el('p', { class: 'sb-sub' }, `Stopped: ${d.run.killed_reason}`));
		}
		kids.push(...(d.executions.length ? d.executions.map((e) => renderExecution(e, run.run_id)) : [el('div', { class: 'sb-empty' }, 'No programs have run in this workspace yet.')]));
		if (d.files.length) {
			kids.push(
				el('h3', { style: 'margin:14px 0 0;font-size:.95rem' }, 'Workspace files'),
				el('div', { class: 'sb-files' }, d.files.map((f) => el('a', { class: 'sb-file', href: fileHref(run.run_id, f.path), download: '' }, `${f.path} (${bytes(f.size ?? 0)})`))),
			);
		}
		panel.replaceChildren(...kids);
	} catch (err) {
		section(panel, err.message, () => loadDetail(run, panel));
	}
}

async function stopRun(run) {
	try {
		await call(`/api/sandbox/run?run=${encodeURIComponent(run.run_id)}`, { method: 'POST', body: { action: 'kill', reason: 'stopped by the owner' } });
		toast('Workspace stopped');
		await load();
	} catch (err) {
		toast(err.message);
	}
}

function renderRuns(o) {
	const host = $('runs-body');
	if (!o.runs.length) {
		host.replaceChildren(el('div', { class: 'sb-empty' }, 'Nothing has run yet. When one of your agents runs code or a terminal command, its workspace appears here. Ask an agent to run a script to try it.'));
		return;
	}
	host.replaceChildren(
		...o.runs.map((r) => {
			const panel = el('div', { class: 'sb-detail', hidden: true });
			const btn = el(
				'button',
				{ type: 'button', class: 'sb-run', 'aria-expanded': 'false' },
				el('span', {}, el('b', {}, r.title || r.run_id), ' ', el('span', { class: `sb-pill ${tone(r.status)}` }, r.status)),
				el('small', {}, `${r.execution_count} programs, ${secs(r.wall_ms)}, ${usd(r.cost_usd)}, ${when(r.updated_at || r.created_at)}`),
			);
			btn.addEventListener('click', () => {
				const open = btn.getAttribute('aria-expanded') === 'true';
				btn.setAttribute('aria-expanded', String(!open));
				panel.hidden = open;
				if (!open) loadDetail(r, panel);
			});
			return el('div', {}, btn, panel);
		}),
	);
}

async function load() {
	$('page-error').replaceChildren();
	try {
		const o = await call('/api/sandbox/overview');
		state.overview = o;
		renderLimits(o);
		renderHosts(o);
		renderRuns(o);
	} catch (err) {
		const msg = err.status === 401 ? 'Sign in to see your sandbox.' : err.message;
		for (const id of ['limits-body', 'runs-body']) section($(id), msg, err.status === 401 ? null : load);
	}
}

$('hosts-save').addEventListener('click', saveHosts);
load();
