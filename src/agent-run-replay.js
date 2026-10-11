// The Runs tab on an agent page (owner-only): every autonomous run the agent
// made, and a step-by-step replay of any one of them.
//
// Data: /api/agent-run-replay (api/agent-run-replay.js), the same run library
// the MCP run tools read, so the page shows exactly what an MCP client sees:
// each model turn, each tool call paired with its result, the chained receipt
// on every step and whether that chain still verifies, the budget in steps and
// dollars, and the plain-language summary written when the run ended.
//
// A live run is polled incrementally (only steps after the last seq) and can be
// cancelled; the cancel lands before the run's next step. The selected run is
// kept in ?run= so a replay link from create_agent_run opens straight onto it.

import { apiFetch } from './api.js';
import { emptyStateHTML, errorStateHTML, skeletonHTML } from './shared/state-kit.js';

const POLL_MS = 2500;
const REPLAY_TICK_MS = 650;

const STATUS_LABEL = {
	queued: 'Queued',
	scheduled: 'Scheduled',
	running: 'Running',
	paused: 'Paused',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Cancelled',
	budget_exhausted: 'Budget reached',
};

const KIND_LABEL = {
	status: 'Status',
	model_call: 'Model turn',
	tool_call: 'Tool call',
	tool_result: 'Tool result',
	tool_blocked: 'Blocked',
	final: 'Finished',
	error: 'Error',
};

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
function ago(iso) {
	if (!iso) return '';
	const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
	const abs = Math.abs(s);
	if (!rtf) return new Date(iso).toLocaleString();
	if (abs < 60) return rtf.format(s, 'second');
	if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
	return rtf.format(Math.round(s / 86400), 'day');
}

function money(n) {
	const v = Number(n) || 0;
	if (v === 0) return '$0';
	return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function pretty(value) {
	if (value == null) return '';
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function oneLine(value, n = 120) {
	const t = (typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)).replace(/\s+/g, ' ').trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

const isLive = (run) => run && !['completed', 'failed', 'cancelled', 'budget_exhausted'].includes(run.status);

let stylesInjected = false;
function injectStyles() {
	if (stylesInjected) return;
	stylesInjected = true;
	const css = `
.rr-host{container-type:inline-size}
.rr{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:start}
.rr-list{display:flex;flex-direction:column;gap:6px;min-width:0}
.rr-list-items{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;overscroll-behavior:contain;padding:2px}
@container (min-width:720px){.rr{grid-template-columns:minmax(240px,300px) minmax(0,1fr)}.rr-list-items{max-height:none;overflow:visible}}
.rr-list-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}
.rr-list-head h3{margin:0;font-size:13px;font-weight:600;color:var(--text-2,#a1a1aa);letter-spacing:.02em;text-transform:uppercase}
.rr-icon-btn{background:transparent;border:1px solid var(--border-2,#2a2a2a);color:var(--text-2,#a1a1aa);border-radius:8px;padding:5px 9px;font:inherit;font-size:12px;cursor:pointer;transition:color .15s,border-color .15s,background .15s}
.rr-icon-btn:hover{color:var(--text,#fafafa);border-color:var(--text-3,#71717a)}
.rr-icon-btn:active{background:var(--panel-2,#161616)}
.rr-icon-btn:focus-visible,.rr-item:focus-visible,.rr-btn:focus-visible,.rr-receipt:focus-visible,.rr-scrub input:focus-visible{outline:2px solid var(--text,#fafafa);outline-offset:2px}
.rr-item{display:block;width:100%;text-align:left;background:var(--panel,#111);border:1px solid var(--border,#1f1f1f);border-radius:10px;padding:10px 12px;color:var(--text,#fafafa);font:inherit;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}
.rr-item:hover{border-color:var(--border-2,#2a2a2a);background:var(--panel-2,#161616)}
.rr-item:active{transform:scale(.995)}
.rr-item[aria-current="true"]{border-color:var(--text-3,#71717a);background:var(--panel-2,#161616)}
.rr-item-goal{font-size:13px;line-height:1.4;margin:6px 0 4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.rr-item-meta{font-size:11.5px;color:var(--text-3,#71717a);display:flex;gap:8px;flex-wrap:wrap}
.rr-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--border-2,#2a2a2a);color:var(--text-2,#a1a1aa)}
.rr-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.rr-pill--live{color:#60a5fa}.rr-pill--live::before{animation:rr-pulse 1.2s ease-in-out infinite}
.rr-pill--ok{color:#4ade80}.rr-pill--bad{color:#f87171}.rr-pill--warn{color:var(--warn,#fbbf24)}
@keyframes rr-pulse{50%{opacity:.3}}
@media (prefers-reduced-motion:reduce){.rr-pill--live::before{animation:none}.rr-step{animation:none!important}}
.rr-more{margin-top:4px}
.rr-detail{min-width:0;background:var(--panel,#111);border:1px solid var(--border,#1f1f1f);border-radius:var(--radius,14px);padding:16px 18px}
.rr-detail-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
.rr-goal{margin:8px 0 0;font-size:15px;line-height:1.5;font-weight:500;word-break:break-word}
.rr-actions{display:flex;gap:8px;flex-wrap:wrap}
.rr-btn{background:var(--panel-2,#161616);border:1px solid var(--border-2,#2a2a2a);color:var(--text,#fafafa);border-radius:8px;padding:7px 12px;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,opacity .15s}
.rr-btn:hover{border-color:var(--text-3,#71717a)}
.rr-btn:active{background:var(--border,#1f1f1f)}
.rr-btn[disabled]{opacity:.5;cursor:default}
.rr-btn--danger{color:#fca5a5;border-color:rgba(248,113,113,.35)}
.rr-btn--danger:hover{border-color:#f87171}
.rr-meters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.rr-meter{border:1px solid var(--border,#1f1f1f);border-radius:10px;padding:10px 12px}
.rr-meter-label{font-size:11px;color:var(--text-3,#71717a);text-transform:uppercase;letter-spacing:.04em}
.rr-meter-value{font-size:14px;font-weight:600;margin-top:3px;font-variant-numeric:tabular-nums}
.rr-bar{height:4px;border-radius:2px;background:var(--border,#1f1f1f);margin-top:8px;overflow:hidden}
.rr-bar>span{display:block;height:100%;background:var(--text-2,#a1a1aa);transform-origin:left;transition:transform .3s ease}
.rr-summary{border-left:2px solid var(--text-3,#71717a);padding:8px 12px;margin:0 0 14px;font-size:13.5px;line-height:1.6;color:var(--text-2,#a1a1aa);background:var(--panel-2,#161616);border-radius:0 8px 8px 0;word-break:break-word}
.rr-chain{display:flex;align-items:center;gap:8px;font-size:12.5px;margin:0 0 14px;color:var(--text-2,#a1a1aa)}
.rr-chain strong{color:var(--text,#fafafa)}
.rr-scrub{display:flex;align-items:center;gap:10px;margin:0 0 12px;flex-wrap:wrap}
.rr-scrub input{flex:1;min-width:140px;accent-color:var(--text,#fafafa)}
.rr-scrub-pos{font-size:12px;color:var(--text-3,#71717a);font-variant-numeric:tabular-nums;min-width:72px;text-align:right}
.rr-timeline{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.rr-step{border:1px solid var(--border,#1f1f1f);border-radius:10px;padding:10px 12px;animation:rr-in .25s ease both}
.rr-step[data-state="future"]{display:none}
.rr-step[data-state="current"]{border-color:var(--text-3,#71717a)}
@keyframes rr-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.rr-step-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px}
.rr-seq{font-variant-numeric:tabular-nums;color:var(--text-3,#71717a);min-width:24px}
.rr-kind{font-weight:600}
.rr-tool{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:var(--panel-2,#161616);padding:1px 6px;border-radius:5px}
.rr-step-meta{margin-left:auto;color:var(--text-3,#71717a);font-size:11.5px;display:flex;gap:8px;flex-wrap:wrap}
.rr-step-line{margin:6px 0 0;font-size:12.5px;color:var(--text-2,#a1a1aa);word-break:break-word}
.rr-step--error .rr-kind,.rr-step--blocked .rr-kind{color:#f87171}
.rr-step--ok .rr-kind{color:#4ade80}
.rr-step details{margin-top:6px}
.rr-step summary{cursor:pointer;font-size:12px;color:var(--text-3,#71717a)}
.rr-step summary:hover{color:var(--text-2,#a1a1aa)}
.rr-step pre{margin:6px 0 0;padding:8px 10px;background:var(--bg,#0a0a0a);border:1px solid var(--border,#1f1f1f);border-radius:8px;font-size:11.5px;line-height:1.5;overflow:auto;max-height:280px;white-space:pre-wrap;word-break:break-word}
.rr-receipt{background:transparent;border:0;padding:0;font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--text-3,#71717a);cursor:pointer}
.rr-receipt:hover{color:var(--text,#fafafa)}
.rr-note{font-size:12px;color:var(--text-3,#71717a);margin:10px 0 0}
`;
	const style = document.createElement('style');
	style.dataset.module = 'agent-run-replay';
	style.textContent = css;
	document.head.appendChild(style);
}

function pillClass(status) {
	if (['queued', 'scheduled', 'running'].includes(status)) return 'rr-pill--live';
	if (status === 'completed') return 'rr-pill--ok';
	if (status === 'failed') return 'rr-pill--bad';
	if (status === 'cancelled' || status === 'budget_exhausted' || status === 'paused') return 'rr-pill--warn';
	return '';
}

function pill(status) {
	return `<span class="rr-pill ${pillClass(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
}

function runItem(run, selected) {
	const steps = `${run.turns ?? 0}/${run.maxSteps ?? 0} turns`;
	const spent = run.budget?.creditsUsd ? `${money(run.spent?.creditsUsd)} of ${money(run.budget.creditsUsd)}` : 'free lanes';
	return `<button type="button" class="rr-item" data-run="${esc(run.id)}" aria-current="${selected ? 'true' : 'false'}">
		${pill(run.status)}
		<p class="rr-item-goal">${esc(run.goal)}</p>
		<div class="rr-item-meta"><span>${esc(ago(run.createdAt))}</span><span>${esc(steps)}</span><span>${esc(spent)}</span>${run.source ? `<span>via ${esc(run.source)}</span>` : ''}</div>
	</button>`;
}

function meter(label, value, fraction) {
	const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : null;
	return `<div class="rr-meter"><div class="rr-meter-label">${esc(label)}</div><div class="rr-meter-value">${esc(value)}</div>${
		f == null ? '' : `<div class="rr-bar" aria-hidden="true"><span style="transform:scaleX(${f})"></span></div>`
	}</div>`;
}

function stepTone(step) {
	if (step.kind === 'tool_blocked') return 'rr-step--blocked';
	if (step.kind === 'error') return 'rr-step--error';
	if (step.kind === 'tool_result') {
		const o = step.output;
		const failed = o && typeof o === 'object' && 'error' in o && Object.keys(o).length === 1;
		return failed ? 'rr-step--error' : 'rr-step--ok';
	}
	return '';
}

function stepLine(step) {
	const o = step.output || {};
	switch (step.kind) {
		case 'status':
			return [STATUS_LABEL[o.status] || o.status, o.note].filter(Boolean).join(': ');
		case 'model_call': {
			const calls = Array.isArray(o.toolCalls) ? o.toolCalls.map((c) => c?.name || c?.function?.name).filter(Boolean) : [];
			if (calls.length) return `Asked for ${calls.join(', ')}`;
			return o.content ? oneLine(o.content) : 'Replied';
		}
		case 'tool_call':
			return oneLine(step.input);
		case 'tool_result':
			return 'error' in o && Object.keys(o).length === 1 ? `Failed: ${oneLine(o.error)}` : oneLine(step.output);
		case 'tool_blocked':
			return o.reason ? `Refused: ${oneLine(o.reason)}` : 'Refused by the run policy';
		case 'final':
			return o.result ? oneLine(o.result, 200) : 'Done';
		case 'error':
			return oneLine(o.error || o.note || 'The run stopped on an error.', 200);
		default:
			return oneLine(step.output);
	}
}

function stepItem(step) {
	const meta = [];
	if (step.model) meta.push(esc(step.model));
	if (step.usage) meta.push(`${(Number(step.usage.input) || 0) + (Number(step.usage.output) || 0)} tok`);
	if (step.costUsd) meta.push(money(step.costUsd));
	if (step.latencyMs != null) meta.push(`${step.latencyMs} ms`);
	const receipt = step.receipt
		? `<button type="button" class="rr-receipt" data-copy="${esc(step.receipt)}" title="Receipt ${esc(step.receipt)}. Click to copy." aria-label="Copy receipt for step ${step.seq}">${esc(step.receipt.slice(0, 10))}</button>`
		: '';
	const body = [];
	if (step.input != null) body.push(`<div><strong>Input</strong><pre>${esc(pretty(step.input))}</pre></div>`);
	if (step.output != null && step.kind !== 'status') body.push(`<div><strong>Output</strong><pre>${esc(pretty(step.output))}</pre></div>`);
	return `<li class="rr-step ${stepTone(step)}" data-seq="${step.seq}">
		<div class="rr-step-head">
			<span class="rr-seq">#${step.seq}</span>
			<span class="rr-kind">${esc(KIND_LABEL[step.kind] || step.kind)}</span>
			${step.tool ? `<span class="rr-tool">${esc(step.tool)}</span>` : ''}
			<span class="rr-step-meta">${meta.map((m) => `<span>${m}</span>`).join('')}${receipt}</span>
		</div>
		<p class="rr-step-line">${esc(stepLine(step))}</p>
		${body.length ? `<details><summary>Details</summary>${body.join('')}</details>` : ''}
	</li>`;
}

function chainLine(chain, live) {
	if (live) return `<p class="rr-chain">Receipts are verified when the run ends.</p>`;
	if (!chain) return '';
	if (chain.verified) {
		return `<p class="rr-chain"><span class="rr-pill rr-pill--ok">Verified</span><span><strong>Receipt chain intact</strong> across ${chain.checked} steps. No step was edited, dropped or reordered.</span></p>`;
	}
	if (chain.brokenAt != null) {
		return `<p class="rr-chain"><span class="rr-pill rr-pill--bad">Broken</span><span><strong>Receipt chain breaks at step ${chain.brokenAt}.</strong> That step no longer matches what the run recorded.</span></p>`;
	}
	return `<p class="rr-chain">This run predates step receipts.</p>`;
}

/**
 * Mount the Runs tab.
 * @param {HTMLElement} root
 * @param {{ agentId: string, agentName?: string, initialRunId?: string|null }} opts
 * @returns {{ destroy(): void }}
 */
export function mountRunReplay(root, { agentId, agentName = 'This agent', initialRunId = null }) {
	injectStyles();
	const state = {
		runs: [],
		nextBefore: null,
		selectedId: initialRunId,
		detail: null,
		cursor: null,
		pollTimer: null,
		replayTimer: null,
		listAbort: null,
		detailAbort: null,
		destroyed: false,
	};

	root.classList.add('rr-host');
	root.innerHTML = `<div class="rr">
		<section class="rr-list" aria-label="Runs">
			<div class="rr-list-head"><h3>Runs</h3><button type="button" class="rr-icon-btn" data-act="refresh" aria-label="Refresh runs">Refresh</button></div>
			<div class="rr-list-items" data-slot="list">${skeletonHTML(4, 'row')}</div>
		</section>
		<section class="rr-detail" aria-live="polite" data-slot="detail">${skeletonHTML(3, 'row')}</section>
	</div>`;
	const listSlot = root.querySelector('[data-slot="list"]');
	const detailSlot = root.querySelector('[data-slot="detail"]');

	function setRunParam(id) {
		const url = new URL(location.href);
		if (id) url.searchParams.set('run', id);
		else url.searchParams.delete('run');
		if (url.href !== location.href) history.replaceState(history.state, '', url);
	}

	async function getJson(path, signal) {
		const res = await apiFetch(path, { signal });
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			const err = new Error(body?.error_description || `Request failed (${res.status})`);
			err.code = body?.error;
			err.status = res.status;
			throw err;
		}
		return body.data;
	}

	function renderList() {
		if (!state.runs.length) {
			listSlot.innerHTML = emptyStateHTML({
				compact: true,
				title: 'No runs yet',
				body: `${esc(agentName)} has not worked a goal on its own. Start one from any MCP client with <code>create_agent_run</code>, or attach an automation that starts runs on a schedule or a market trigger.`,
				actions: [{ label: 'How runs work', href: '/docs/agent-runtime' }],
			});
			return;
		}
		listSlot.innerHTML =
			state.runs.map((r) => runItem(r, r.id === state.selectedId)).join('') +
			(state.nextBefore ? `<button type="button" class="rr-icon-btn rr-more" data-act="more">Load older runs</button>` : '');
	}

	async function loadList({ append = false } = {}) {
		state.listAbort?.abort();
		const ctrl = (state.listAbort = new AbortController());
		if (!append) listSlot.innerHTML = skeletonHTML(4, 'row');
		try {
			const q = new URLSearchParams({ agent: agentId });
			if (append && state.nextBefore) q.set('before', state.nextBefore);
			const data = await getJson(`/api/agent-run-replay?${q}`, ctrl.signal);
			if (state.destroyed) return;
			state.runs = append ? [...state.runs, ...data.runs] : data.runs;
			state.nextBefore = data.nextBefore;
			renderList();
			if (!append) {
				if (!state.selectedId && state.runs.length) selectRun(state.runs[0].id, { push: false });
				else if (state.selectedId) loadDetail();
				else renderNoSelection();
			}
		} catch (err) {
			if (ctrl.signal.aborted || state.destroyed) return;
			listSlot.innerHTML = errorStateHTML({
				title: 'Could not load runs',
				body: esc(err.message || 'Check your connection and try again.'),
				actions: [{ label: 'Retry', id: 'retry-list', primary: true }],
			});
			if (!state.runs.length) renderNoSelection();
		}
	}

	function renderNoSelection() {
		detailSlot.innerHTML = emptyStateHTML({
			compact: true,
			title: 'Pick a run',
			body: 'Choose a run on the left to replay every model turn and tool call it made, with the receipt for each step.',
		});
	}

	function selectRun(id, { push = true } = {}) {
		state.selectedId = id;
		if (push) setRunParam(id);
		for (const el of listSlot.querySelectorAll('.rr-item')) el.setAttribute('aria-current', el.dataset.run === id ? 'true' : 'false');
		loadDetail();
	}

	function stopTimers() {
		clearTimeout(state.pollTimer);
		state.pollTimer = null;
		clearInterval(state.replayTimer);
		state.replayTimer = null;
	}

	async function loadDetail() {
		stopTimers();
		state.detailAbort?.abort();
		const ctrl = (state.detailAbort = new AbortController());
		const id = state.selectedId;
		detailSlot.innerHTML = skeletonHTML(3, 'row');
		try {
			const data = await getJson(`/api/agent-run-replay?run=${encodeURIComponent(id)}`, ctrl.signal);
			if (state.destroyed || id !== state.selectedId) return;
			state.detail = data;
			state.cursor = null;
			renderDetail();
			schedulePoll();
		} catch (err) {
			if (ctrl.signal.aborted || state.destroyed) return;
			const missing = err.status === 404;
			detailSlot.innerHTML = errorStateHTML({
				title: missing ? 'Run not found' : 'Could not load this run',
				body: missing ? 'This run does not exist or belongs to another account. Pick one from the list.' : esc(err.message),
				actions: missing ? [{ label: 'Show latest run', id: 'latest', primary: true }] : [{ label: 'Retry', id: 'retry-detail', primary: true }],
			});
		}
	}

	function renderDetail() {
		const { run, steps, receiptChain, live, hasMore } = state.detail;
		const turns = steps.filter((s) => s.kind === 'model_call').length;
		const turnsFrac = run.maxSteps ? turns / run.maxSteps : null;
		const budget = run.budget?.creditsUsd || 0;
		const spentLabel = budget ? `${money(run.spent?.creditsUsd)} of ${money(budget)}` : `${money(run.spent?.creditsUsd)} (free lanes)`;
		const traces = state.detail.toolTraces || [];
		const failed = traces.filter((t) => t.status === 'error' || t.status === 'blocked').length;
		detailSlot.innerHTML = `
			<div class="rr-detail-head">
				<div style="min-width:0;flex:1">
					${pill(run.status)}${run.cancelRequested && live ? ' <span class="rr-pill rr-pill--warn">Stopping</span>' : ''}
					<p class="rr-goal">${esc(run.goal)}</p>
				</div>
				<div class="rr-actions">
					${live && !run.cancelRequested ? '<button type="button" class="rr-btn rr-btn--danger" data-act="cancel">Cancel run</button>' : ''}
					<button type="button" class="rr-btn" data-act="copy-link">Copy link</button>
				</div>
			</div>
			<div class="rr-meters">
				${meter('Model turns', `${turns} of ${run.maxSteps ?? 0}`, turnsFrac)}
				${meter('Credits', spentLabel, budget ? (run.spent?.creditsUsd || 0) / budget : null)}
				${meter('Tool calls', `${traces.length}${failed ? ` (${failed} failed)` : ''}`, null)}
				${meter(run.finishedAt ? 'Finished' : 'Started', ago(run.finishedAt || run.startedAt || run.createdAt), null)}
			</div>
			${run.summary ? `<p class="rr-summary">${esc(run.summary)}</p>` : live ? '<p class="rr-summary">Working. Steps appear here as the agent takes them; a summary is written when the run ends.</p>' : ''}
			${chainLine(receiptChain, live)}
			${steps.length > 1 ? `<div class="rr-scrub">
				<button type="button" class="rr-btn" data-act="replay" aria-label="Replay steps in order">Replay</button>
				<input type="range" min="1" max="${steps.length}" value="${state.cursor ?? steps.length}" aria-label="Step position" data-act="scrub" />
				<span class="rr-scrub-pos">${state.cursor ?? steps.length} / ${steps.length}</span>
			</div>` : ''}
			<ol class="rr-timeline">${steps.map(stepItem).join('')}</ol>
			${hasMore ? '<p class="rr-note">Showing the first 500 steps.</p>' : ''}
			${steps.length ? '' : '<p class="rr-note">No steps recorded yet.</p>'}`;
		applyCursor();
	}

	function applyCursor() {
		const n = state.cursor;
		const items = detailSlot.querySelectorAll('.rr-step');
		items.forEach((el, i) => {
			el.dataset.state = n == null ? 'past' : i + 1 < n ? 'past' : i + 1 === n ? 'current' : 'future';
		});
		const pos = detailSlot.querySelector('.rr-scrub-pos');
		const range = detailSlot.querySelector('[data-act="scrub"]');
		if (pos) pos.textContent = `${n ?? items.length} / ${items.length}`;
		if (range) range.value = String(n ?? items.length);
		if (n != null) items[n - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	function toggleReplay(btn) {
		if (state.replayTimer) {
			clearInterval(state.replayTimer);
			state.replayTimer = null;
			btn.textContent = 'Replay';
			return;
		}
		const total = state.detail.steps.length;
		state.cursor = state.cursor == null || state.cursor >= total ? 1 : state.cursor;
		applyCursor();
		btn.textContent = 'Pause';
		state.replayTimer = setInterval(() => {
			if (state.cursor >= total) {
				clearInterval(state.replayTimer);
				state.replayTimer = null;
				state.cursor = null;
				btn.textContent = 'Replay';
			} else {
				state.cursor += 1;
			}
			applyCursor();
		}, REPLAY_TICK_MS);
	}

	function schedulePoll() {
		if (!state.detail?.live || state.destroyed) return;
		state.pollTimer = setTimeout(poll, POLL_MS);
	}

	async function poll() {
		const id = state.selectedId;
		// A hidden tab or panel costs nothing: check again later.
		if (document.visibilityState === 'hidden' || !root.isConnected || root.offsetParent === null) return schedulePoll();
		try {
			const data = await getJson(`/api/agent-run-replay?run=${encodeURIComponent(id)}&after=${state.detail.nextAfter}`);
			if (state.destroyed || id !== state.selectedId) return;
			if (!data.live) {
				// Finished: one full read picks up the summary and verifies the chain.
				await loadDetail();
				const i = state.runs.findIndex((r) => r.id === id);
				if (i >= 0) {
					state.runs[i] = state.detail.run;
					renderList();
				}
				return;
			}
			state.detail = {
				...state.detail,
				run: data.run,
				live: data.live,
				steps: [...state.detail.steps, ...data.steps],
				toolTraces: [...(state.detail.toolTraces || []), ...data.toolTraces],
				nextAfter: data.nextAfter,
			};
			if (data.steps.length || state.replayTimer == null) renderDetail();
		} catch {
			// A dropped poll is retried on the next tick; the last good view stays up.
		}
		schedulePoll();
	}

	async function cancel(btn) {
		btn.disabled = true;
		btn.textContent = 'Cancelling…';
		try {
			const res = await apiFetch(`/api/agent-run-replay?run=${encodeURIComponent(state.selectedId)}&action=cancel`, { method: 'POST' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.error_description || 'The run could not be cancelled.');
			await loadDetail();
		} catch (err) {
			btn.disabled = false;
			btn.textContent = 'Cancel run';
			btn.insertAdjacentHTML('afterend', `<span class="rr-note" role="alert">${esc(err.message)}</span>`);
		}
	}

	async function copy(text, el, done = 'Copied') {
		try {
			await navigator.clipboard.writeText(text);
			const prev = el.textContent;
			el.textContent = done;
			setTimeout(() => {
				if (el.isConnected) el.textContent = prev;
			}, 1400);
		} catch {
			el.title = text;
		}
	}

	root.addEventListener('click', (e) => {
		const item = e.target.closest('.rr-item');
		if (item) return selectRun(item.dataset.run);
		const receipt = e.target.closest('.rr-receipt');
		if (receipt) return copy(receipt.dataset.copy, receipt);
		const act = e.target.closest('[data-act], [data-sk-action]');
		if (!act) return;
		const a = act.dataset.act || act.dataset.skAction;
		if (a === 'refresh' || a === 'retry-list') loadList();
		else if (a === 'more') loadList({ append: true });
		else if (a === 'retry-detail') loadDetail();
		else if (a === 'latest') {
			state.selectedId = null;
			setRunParam(null);
			if (state.runs.length) selectRun(state.runs[0].id);
			else renderNoSelection();
		} else if (a === 'cancel') cancel(act);
		else if (a === 'replay') toggleReplay(act);
		else if (a === 'copy-link') {
			const url = new URL(location.href);
			url.searchParams.set('view', 'runs');
			url.searchParams.set('run', state.selectedId);
			copy(url.href, act, 'Link copied');
		}
	});

	root.addEventListener('input', (e) => {
		if (e.target.dataset?.act !== 'scrub') return;
		if (state.replayTimer) {
			clearInterval(state.replayTimer);
			state.replayTimer = null;
			const btn = detailSlot.querySelector('[data-act="replay"]');
			if (btn) btn.textContent = 'Replay';
		}
		const v = Number(e.target.value);
		state.cursor = v >= state.detail.steps.length ? null : v;
		applyCursor();
	});

	loadList();

	return {
		destroy() {
			state.destroyed = true;
			stopTimers();
			state.listAbort?.abort();
			state.detailAbort?.abort();
			root.classList.remove('rr-host');
		},
	};
}
