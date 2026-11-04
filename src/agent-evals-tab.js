// The Evaluate tab on an agent page (owner-only): score the agent on a suite,
// watch each task land, read why a case failed, and see how the score moved
// across runs.
//
// Data: /api/v1 (api/_lib/evals/routes.js). Running a suite streams one server-sent
// event per scored task, so the progress bar is the real count of finished
// tasks, never an animation. Only free and Vertex lanes are offered, the same
// set the server enforces.

import { consumeCsrfToken } from './api.js';
import { emptyStateHTML, errorStateHTML, skeletonHTML } from './shared/state-kit.js';

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pct = (n) => (n == null ? 'n/a' : `${Math.round(n * 100)}%`);
const score = (n) => (n == null ? 'n/a' : Number(n).toFixed(2));
const usd = (n) => (n == null ? 'n/a' : Number(n) < 0.01 ? `$${Number(n).toFixed(4)}` : `$${Number(n).toFixed(2)}`);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

class ApiFailure extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

async function readError(res) {
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	return new ApiFailure(res.status, body?.error?.code || 'request_failed', body?.error?.message || `Request failed (${res.status}).`);
}

async function api(path, { method = 'GET', body } = {}) {
	const headers = { accept: 'application/json' };
	if (body !== undefined) headers['content-type'] = 'application/json';
	if (method !== 'GET') {
		const token = await consumeCsrfToken();
		if (token) headers['x-csrf-token'] = token;
	}
	let res;
	try {
		res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
	} catch {
		throw new ApiFailure(0, 'network_error', 'Could not reach three.ws. Check your connection and try again.');
	}
	if (!res.ok) throw await readError(res);
	return (await res.json()).data;
}

/** Yield { event, data } from a text/event-stream response body as it arrives. */
async function* readSse(res) {
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let i;
		while ((i = buf.indexOf('\n\n')) !== -1) {
			const block = buf.slice(0, i);
			buf = buf.slice(i + 2);
			let event = 'message';
			const data = [];
			for (const line of block.split('\n')) {
				if (line.startsWith('event:')) event = line.slice(6).trim();
				else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
			}
			if (data.length) yield { event, data: JSON.parse(data.join('\n')) };
		}
	}
}

/** Tasks whose status changed between two reports of the same suite. */
export function diffReports(prev, next) {
	const before = new Map(prev.tasks.map((t) => [t.id, t.status]));
	const changes = [];
	for (const t of next.tasks) {
		const was = before.get(t.id);
		if (was && was !== t.status) {
			changes.push({ id: t.id, from: was, to: t.status, kind: t.status === 'passed' ? 'fixed' : t.status === 'failed' ? 'regressed' : 'changed' });
		}
	}
	return changes;
}

/** Line chart of score over time as inline SVG. Points are focusable buttons-in-spirit via <a> with titles. */
export function scoreChart(points) {
	if (points.length < 2) return '';
	const W = 560;
	const H = 120;
	const pad = { l: 34, r: 10, t: 10, b: 18 };
	const x = (i) => pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r);
	const y = (s) => pad.t + (1 - s) * (H - pad.t - pad.b);
	const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
	const grid = [0, 0.5, 1]
		.map((g) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(g)}" y2="${y(g)}" class="ev-grid"/><text x="${pad.l - 6}" y="${y(g) + 4}" text-anchor="end" class="ev-axis">${g}</text>`)
		.join('');
	const dots = points
		.map(
			(p, i) =>
				`<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="4.5" class="ev-dot" data-eval="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(`${when(p.at)}: score ${score(p.score)} on ${p.model}`)}"><title>${esc(`${when(p.at)}  score ${score(p.score)}  ${p.model}`)}</title></circle>`
		)
		.join('');
	return `<svg viewBox="0 0 ${W} ${H}" class="ev-chart" role="img" aria-label="Score over the last ${points.length} runs">${grid}<path d="${path}" class="ev-line"/>${dots}</svg>`;
}

let stylesInjected = false;
function injectStyles() {
	if (stylesInjected) return;
	stylesInjected = true;
	const el = document.createElement('style');
	el.textContent = `
.ev{display:flex;flex-direction:column;gap:16px;min-width:0}
.ev-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;background:var(--panel,#111);border:1px solid var(--border,#1f1f1f);border-radius:var(--radius,14px);padding:14px 16px}
.ev-field{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 180px}
.ev-field label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3,#71717a)}
.ev-field select{background:var(--panel-2,#161616);color:var(--text,#fafafa);border:1px solid var(--border-2,#2a2a2a);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;min-width:0;max-width:100%}
.ev-field select:hover{border-color:var(--text-3,#71717a)}
.ev-btn{background:var(--text,#fafafa);color:var(--bg,#0a0a0a);border:1px solid transparent;border-radius:8px;padding:9px 16px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s,transform .15s}
.ev-btn:hover{opacity:.88}.ev-btn:active{transform:scale(.98)}
.ev-btn[disabled]{opacity:.45;cursor:default;transform:none}
.ev-btn--ghost{background:transparent;color:var(--text-2,#a1a1aa);border-color:var(--border-2,#2a2a2a)}
.ev-btn--ghost:hover{color:var(--text,#fafafa);border-color:var(--text-3,#71717a);opacity:1}
.ev-btn:focus-visible,.ev-field select:focus-visible,.ev-row:focus-visible,.ev-dot:focus-visible,.ev-hist-item:focus-visible{outline:2px solid var(--text,#fafafa);outline-offset:2px}
.ev-card{background:var(--panel,#111);border:1px solid var(--border,#1f1f1f);border-radius:var(--radius,14px);padding:16px 18px;min-width:0}
.ev-card h3{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--text-2,#a1a1aa);letter-spacing:.02em;text-transform:uppercase}
.ev-progress{height:6px;border-radius:3px;background:var(--border,#1f1f1f);overflow:hidden;margin:10px 0 6px}
.ev-progress>span{display:block;height:100%;background:var(--text,#fafafa);transform-origin:left;transition:transform .25s ease}
.ev-progress-note{font-size:12.5px;color:var(--text-2,#a1a1aa)}
.ev-meters{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}
.ev-meter{border:1px solid var(--border,#1f1f1f);border-radius:10px;padding:9px 12px}
.ev-meter b{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3,#71717a)}
.ev-meter span{display:block;font-size:17px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums}
.ev-meta{font-size:12.5px;color:var(--text-3,#71717a);margin:0 0 12px;word-break:break-word}
.ev-tasks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ev-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%;text-align:left;background:transparent;color:var(--text,#fafafa);border:1px solid var(--border,#1f1f1f);border-radius:10px;padding:9px 12px;font:inherit;font-size:13px;cursor:pointer;transition:background .15s,border-color .15s}
.ev-row:hover{background:var(--panel-2,#161616);border-color:var(--border-2,#2a2a2a)}
.ev-row:active{background:var(--border,#1f1f1f)}
.ev-row-title{flex:1 1 160px;min-width:0;word-break:break-word}
.ev-row-meta{color:var(--text-3,#71717a);font-size:11.5px;font-variant-numeric:tabular-nums}
.ev-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--border-2,#2a2a2a);color:var(--text-2,#a1a1aa)}
.ev-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.ev-pill--passed{color:#4ade80}.ev-pill--failed{color:#f87171}.ev-pill--errored{color:var(--warn,#fbbf24)}.ev-pill--pending{color:var(--text-3,#71717a)}
.ev-pill--running::before{animation:ev-pulse 1.2s ease-in-out infinite}
@keyframes ev-pulse{50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){.ev-pill--running::before{animation:none}.ev-progress>span{transition:none}}
.ev-detail{margin:6px 0 4px 6px;padding:10px 12px;border-left:2px solid var(--border-2,#2a2a2a);font-size:12.5px;line-height:1.55;color:var(--text-2,#a1a1aa)}
.ev-detail ul{margin:4px 0 8px;padding-left:18px}
.ev-detail code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--panel-2,#161616);padding:1px 5px;border-radius:4px;word-break:break-word}
.ev-ok{color:#4ade80}.ev-bad{color:#f87171}
.ev-changes{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px;font-size:12.5px}
.ev-chip{padding:3px 9px;border-radius:999px;border:1px solid var(--border-2,#2a2a2a)}
.ev-chip--fixed{color:#4ade80}.ev-chip--regressed{color:#f87171}
.ev-chart{width:100%;height:auto;display:block;margin-bottom:10px}
.ev-grid{stroke:var(--border,#1f1f1f);stroke-width:1}
.ev-axis{fill:var(--text-3,#71717a);font-size:10px}
.ev-line{fill:none;stroke:var(--text-2,#a1a1aa);stroke-width:2}
.ev-dot{fill:var(--text,#fafafa);cursor:pointer;stroke:var(--panel,#111);stroke-width:2}
.ev-dot:hover{fill:#60a5fa}
.ev-hist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.ev-hist-item{display:flex;gap:10px;flex-wrap:wrap;align-items:center;width:100%;text-align:left;background:transparent;color:var(--text,#fafafa);border:1px solid var(--border,#1f1f1f);border-radius:10px;padding:8px 12px;font:inherit;font-size:12.5px;cursor:pointer;transition:background .15s,border-color .15s}
.ev-hist-item:hover{background:var(--panel-2,#161616);border-color:var(--border-2,#2a2a2a)}
.ev-hist-item[aria-current="true"]{border-color:var(--text-3,#71717a)}
.ev-hist-item span:last-child{margin-left:auto;color:var(--text-3,#71717a)}
.ev-banner{border:1px solid rgba(248,113,113,.4);color:#fca5a5;border-radius:10px;padding:10px 12px;font-size:13px;word-break:break-word}
.ev-banner button{margin-left:8px}
`;
	document.head.appendChild(el);
}

/**
 * Mount the tab.
 * @param {HTMLElement} root
 * @param {{ agentId: string, agentName?: string }} opts
 * @returns {{ destroy(): void }}
 */
export function mountAgentEvals(root, { agentId, agentName = 'this agent' }) {
	injectStyles();
	const base = `/agents/${encodeURIComponent(agentId)}/evals`;
	const state = {
		catalog: null,
		history: [],
		suite: null,
		model: null,
		selected: null, // { eval, report }
		previous: null, // report of the previous completed run of the same suite
		running: null, // { total, done, rows, suite, model }
		banner: null,
		open: new Set(),
	};
	let aborter = null;
	let alive = true;

	root.classList.add('ev');
	root.innerHTML = skeletonHTML(3, 'card');

	const historyForSuite = () => state.history.filter((e) => e.suite === state.suite && e.status === 'completed' && e.score != null);

	async function load() {
		try {
			const [catalog, history] = await Promise.all([api('/evals/catalog'), api(base)]);
			if (!alive) return;
			state.catalog = catalog;
			state.history = history;
			state.suite = state.suite || catalog.suites.find((s) => !s.invalid)?.name || null;
			state.model = state.model || catalog.defaultModel;
			const latest = history.find((e) => e.status === 'completed' && e.suite === state.suite);
			if (latest && !state.selected) await select(latest.id, { quiet: true });
			render();
		} catch (err) {
			if (!alive) return;
			root.innerHTML = errorStateHTML({
				title: 'Could not load evals',
				body: esc(err.message),
				actions: [{ label: 'Retry', id: 'ev-retry', primary: true }],
			});
			root.querySelector('[data-sk-action="ev-retry"]')?.addEventListener('click', () => {
				root.innerHTML = skeletonHTML(3, 'card');
				load();
			});
		}
	}

	async function select(evalId, { quiet = false } = {}) {
		try {
			const full = await api(`${base}/${encodeURIComponent(evalId)}`);
			if (!alive) return;
			state.selected = { eval: full, report: full.report };
			state.open.clear();
			state.previous = null;
			const older = state.history.filter((e) => e.suite === full.suite && e.status === 'completed' && e.createdAt < full.createdAt)[0];
			if (older) {
				try {
					state.previous = (await api(`${base}/${encodeURIComponent(older.id)}`)).report;
				} catch {
					state.previous = null;
				}
			}
			if (!quiet) render();
		} catch (err) {
			state.banner = err.message;
			render();
		}
	}

	async function run() {
		if (state.running || !state.suite) return;
		const suite = state.catalog.suites.find((s) => s.name === state.suite);
		state.banner = null;
		state.running = { total: suite?.tasks.length || 0, done: 0, rows: [], suite: state.suite, model: state.model };
		render();
		aborter = new AbortController();
		try {
			const token = await consumeCsrfToken();
			const res = await fetch(`/api/v1${base}`, {
				method: 'POST',
				credentials: 'include',
				signal: aborter.signal,
				headers: { accept: 'text/event-stream', 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
				body: JSON.stringify({ suite: state.suite, model: state.model }),
			});
			if (!res.ok) throw await readError(res);
			let finished = null;
			for await (const { event, data } of readSse(res)) {
				if (!alive) return;
				if (event === 'start') state.running.total = data.tasks;
				if (event === 'task') {
					state.running.rows.push(data);
					state.running.done = data.index + 1;
					renderRunning();
				}
				if (event === 'done') finished = data;
				if (event === 'error') throw new ApiFailure(500, data.code, data.message);
			}
			if (!finished) throw new ApiFailure(0, 'stream_ended', 'The connection closed before the run finished. Reload to see whether it completed.');
			state.running = null;
			state.history = await api(base);
			state.selected = { eval: finished, report: finished.report };
			state.open.clear();
			const older = state.history.filter((e) => e.suite === finished.suite && e.status === 'completed' && e.id !== finished.id)[0];
			state.previous = older ? (await api(`${base}/${encodeURIComponent(older.id)}`).catch(() => null))?.report || null : null;
		} catch (err) {
			if (err.name === 'AbortError') return;
			state.running = null;
			state.banner = err.status === 409 ? `${err.message}` : err.message;
			state.history = await api(base).catch(() => state.history);
		}
		if (alive) render();
	}

	function renderRunning() {
		const el = root.querySelector('[data-ev="running"]');
		if (el) el.innerHTML = runningHTML();
	}

	function runningHTML() {
		const r = state.running;
		if (!r) return '';
		const ratio = r.total ? r.done / r.total : 0;
		const rows = r.rows
			.map((t) => `<li class="ev-row" style="cursor:default"><span class="ev-pill ev-pill--${esc(t.status)}">${esc(t.status)}</span><span class="ev-row-title">${esc(t.title || t.id)}</span><span class="ev-row-meta">${t.steps} steps, ${t.latencyMs} ms</span></li>`)
			.join('');
		return `<div class="ev-card"><h3>Running ${esc(r.suite)}</h3>
			<div class="ev-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${r.total}" aria-valuenow="${r.done}"><span style="transform:scaleX(${ratio})"></span></div>
			<div class="ev-progress-note" role="status" aria-live="polite">${r.done} of ${r.total} tasks scored on ${esc(r.model)}. Leave this tab open until it finishes.</div>
			<ul class="ev-tasks" style="margin-top:12px">${rows}</ul></div>`;
	}

	function reportHTML() {
		const sel = state.selected;
		if (!sel?.report) return '';
		const { report, eval: ev } = sel;
		const s = report.summary;
		const changes = state.previous ? diffReports(state.previous, report) : [];
		const chips = changes.length
			? `<div class="ev-changes" aria-label="Changes since the previous run">${changes.map((c) => `<span class="ev-chip ev-chip--${c.kind}">${esc(c.id)}: ${esc(c.from)} to ${esc(c.to)}</span>`).join('')}</div>`
			: state.previous
				? '<p class="ev-meta">No task changed status since the previous run.</p>'
				: '';
		const rows = report.tasks
			.map((t) => {
				const open = state.open.has(t.id);
				const checks = t.checks.map((c) => `<li class="${c.passed ? 'ev-ok' : 'ev-bad'}">${c.passed ? 'passed' : 'failed'}: ${esc(c.detail)}</li>`).join('');
				const tools = (t.trace.toolCalls || []).map((c) => `<code>${esc(c.tool)}</code>`).join(' ');
				const detail = open
					? `<div class="ev-detail">${t.error ? `<p class="ev-bad">${esc(t.error)}</p>` : ''}${checks ? `<ul>${checks}</ul>` : ''}<p>Tools: ${tools || 'none'}</p>${t.trace.answer ? `<p>Answer: ${esc(String(t.trace.answer).slice(0, 600))}</p>` : ''}</div>`
					: '';
				return `<li><button type="button" class="ev-row" data-task="${esc(t.id)}" aria-expanded="${open}"><span class="ev-pill ev-pill--${esc(t.status)}">${esc(t.status)}</span><span class="ev-row-title">${esc(t.title || t.id)}</span><span class="ev-row-meta">${t.trace.steps} steps, ${t.trace.latencyMs} ms</span></button>${detail}</li>`;
			})
			.join('');
		const truncated = report.truncated ? `<p class="ev-meta">Stopped at the cost cap (${usd(report.truncated.maxCostUsd)}). ${report.truncated.skipped.length} task(s) were not run.</p>` : '';
		return `<div class="ev-card"><h3>${esc(report.suite.title)} on ${esc(report.model)}</h3>
			<p class="ev-meta">Run ${esc(when(ev.createdAt))}. Configuration ${esc(report.config.version)}.</p>
			<div class="ev-meters">
				<div class="ev-meter"><b>Score</b><span>${score(s.score)}</span></div>
				<div class="ev-meter"><b>Passed</b><span>${s.passed}/${s.tasks}</span></div>
				<div class="ev-meter"><b>Pass rate</b><span>${pct(s.passRate)}</span></div>
				<div class="ev-meter"><b>Cost</b><span>${usd(s.costUsd)}</span></div>
			</div>${truncated}${chips}<ul class="ev-tasks">${rows}</ul></div>`;
	}

	function historyHTML() {
		const list = state.history.filter((e) => !state.suite || e.suite === state.suite);
		const points = historyForSuite().slice(0, 20).reverse().map((e) => ({ id: e.id, score: e.score, at: e.createdAt, model: e.model }));
		const items = list
			.slice(0, 15)
			.map(
				(e) =>
					`<li><button type="button" class="ev-hist-item" data-eval="${esc(e.id)}" aria-current="${state.selected?.eval.id === e.id}"><span class="ev-pill ev-pill--${e.status === 'completed' ? 'passed' : e.status === 'running' ? 'running' : 'failed'}">${esc(e.status)}</span><span>score ${score(e.score)}</span><span>${esc(e.model)}</span><span>${esc(when(e.createdAt))}</span></button></li>`
			)
			.join('');
		return `<div class="ev-card"><h3>History</h3>${scoreChart(points)}<ul class="ev-hist">${items}</ul></div>`;
	}

	function render() {
		if (!alive) return;
		const c = state.catalog;
		const usable = c.suites.filter((s) => !s.invalid);
		if (!usable.length) {
			root.innerHTML = emptyStateHTML({ title: 'No eval suites yet', body: 'The platform has no suites installed. Check back after the next release.' });
			return;
		}
		const suiteOpts = usable.map((s) => `<option value="${esc(s.name)}"${s.name === state.suite ? ' selected' : ''}>${esc(s.title)} (${s.tasks.length} tasks)</option>`).join('');
		const modelOpts = c.models.map((m) => `<option value="${esc(m.id)}"${m.id === state.model ? ' selected' : ''}>${esc(m.id)}${m.free ? ' (free)' : ' (credits)'}</option>`).join('');
		const noModels = !c.models.length;
		const banner = state.banner ? `<div class="ev-banner" role="alert">${esc(state.banner)}<button type="button" class="ev-btn ev-btn--ghost" data-ev="dismiss">Dismiss</button></div>` : '';
		const hasHistory = state.history.length > 0;
		const empty = !hasHistory && !state.running
			? emptyStateHTML({
					title: 'No evals yet',
					body: `Run a suite to see how ${esc(agentName)} scores. Each case checks the tools it calls, the arguments and the honesty of the answer.`,
					compact: true,
				})
			: '';
		root.innerHTML = `
			<div class="ev-bar">
				<div class="ev-field"><label for="ev-suite">Suite</label><select id="ev-suite" ${state.running ? 'disabled' : ''}>${suiteOpts}</select></div>
				<div class="ev-field"><label for="ev-model">Model</label><select id="ev-model" ${state.running || noModels ? 'disabled' : ''}>${modelOpts || '<option>No model available</option>'}</select></div>
				<button type="button" class="ev-btn" id="ev-run" ${state.running || noModels ? 'disabled' : ''}>${state.running ? 'Running...' : 'Run evaluation'}</button>
			</div>
			${noModels ? '<div class="ev-banner" role="alert">No model lane is available to run evals right now.</div>' : ''}
			${banner}
			<div data-ev="running">${runningHTML()}</div>
			${empty}
			${state.running ? '' : reportHTML()}
			${hasHistory ? historyHTML() : ''}`;
		bind();
	}

	function bind() {
		root.querySelector('#ev-suite')?.addEventListener('change', (e) => {
			state.suite = e.target.value;
			state.selected = null;
			const latest = state.history.find((h) => h.suite === state.suite && h.status === 'completed');
			if (latest) select(latest.id);
			else render();
		});
		root.querySelector('#ev-model')?.addEventListener('change', (e) => {
			state.model = e.target.value;
		});
		root.querySelector('#ev-run')?.addEventListener('click', run);
		root.querySelector('[data-ev="dismiss"]')?.addEventListener('click', () => {
			state.banner = null;
			render();
		});
		for (const btn of root.querySelectorAll('.ev-row[data-task]')) {
			btn.addEventListener('click', () => {
				const id = btn.dataset.task;
				if (state.open.has(id)) state.open.delete(id);
				else state.open.add(id);
				render();
				root.querySelector(`.ev-row[data-task="${CSS.escape(id)}"]`)?.focus();
			});
		}
		for (const btn of root.querySelectorAll('[data-eval]')) {
			const open = () => select(btn.dataset.eval);
			btn.addEventListener('click', open);
			if (btn.tagName === 'circle') {
				btn.addEventListener('keydown', (e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						open();
					}
				});
			}
		}
	}

	load();

	return {
		destroy() {
			alive = false;
			aborter?.abort();
		},
	};
}
