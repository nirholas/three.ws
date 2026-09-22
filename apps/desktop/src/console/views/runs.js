// Runs: give an agent a goal and a budget, then follow it step by step. Each
// model call, tool call and result lands on the timeline as it happens (the
// run's SSE stream), with its cost and any transaction it signed. A running
// run can be cancelled; the server stops it within one step.
//
// On a server without the v1 Runs API the same view shows the agent's signed
// action log (/api/agent-actions): the real record of what it did, newest
// first.

import { html, raw, mount, onAction, emptyState, errorState, skeletonLines } from '../lib/dom.js';
import { agentPicker, bindPicker } from '../lib/agents-store.js';
import { relativeTime, formatUsd, shortAddress } from '../../shared/normalize.js';

const STATUS = {
	scheduled: ['Scheduled', 'chip-info'],
	queued: ['Queued', 'chip-info'],
	running: ['Running', 'chip-info'],
	paused: ['Paused', 'chip-warn'],
	completed: ['Completed', 'chip-ok'],
	failed: ['Failed', 'chip-bad'],
	cancelled: ['Cancelled', ''],
	budget_exhausted: ['Budget used up', 'chip-warn'],
};

export function runStatusChip(status) {
	const [label, cls] = STATUS[status] || [String(status || 'unknown'), ''];
	return html`<span class="chip ${cls}">${label}</span>`;
}

const explorer = (sig) => `https://solscan.io/tx/${encodeURIComponent(sig)}`;

export function stepMarkup(s) {
	const cls = s.error ? 'error' : s.tool ? 'tool' : s.kind === 'final' || s.kind === 'result' ? 'done' : '';
	return html`<li class="step ${cls}">
		<div class="step-head">
			<b>${s.title}</b>
			${s.at ? html`<span>${relativeTime(s.at)}</span>` : ''}
			${s.costUsd ? html`<span>${formatUsd(s.costUsd)}</span>` : ''}
			${s.signature ? html`<a href="${explorer(s.signature)}" class="mono" style="font-size:11.5px;color:var(--blue)">${shortAddress(s.signature, 6, 6)}</a>` : ''}
		</div>
		${s.input ? html`<div class="step-body">${s.input}</div>` : ''}
		${s.output ? html`<div class="step-body">${s.output}</div>` : ''}
		${s.error ? html`<div class="step-body err">${s.error}</div>` : ''}
	</li>`;
}

export function activityMarkup(a) {
	return html`<li class="step ${a.signature ? 'done' : ''}">
		<div class="step-head">
			<b>${a.title}</b>
			${a.at ? html`<span>${relativeTime(a.at)}</span>` : ''}
			${a.skill ? html`<span>via ${a.skill}</span>` : ''}
			${a.signature ? html`<a href="${explorer(a.signature)}" class="mono" style="font-size:11.5px;color:var(--blue)">${shortAddress(a.signature, 6, 6)}</a>` : ''}
		</div>
		${a.detail ? html`<div class="step-body">${a.detail}</div>` : ''}
	</li>`;
}

export function mountRuns(root, ctx) {
	const { bridge, agents, toast } = ctx;
	let phase = 'loading';
	let error = null;
	let data = null;
	let selectedRun = null;
	let detail = null;
	let detailError = null;
	let creating = false;
	let watching = null;

	function unwatch() {
		if (watching) bridge.runs.unwatch(watching).catch(() => {});
		watching = null;
	}

	function newRunForm() {
		return html`<form class="card" id="new-run" style="margin-bottom:16px">
			<div class="field"><label for="goal">Goal</label>
				<textarea class="textarea input" id="goal" rows="2" placeholder="Check my wallet, summarize today's activity, and draft a post about it" required></textarea></div>
			<div class="row" style="margin-top:10px">
				<div class="field"><label for="max-steps">Max steps</label><input class="input" id="max-steps" type="number" min="1" max="60" value="12" /></div>
				<div class="field"><label for="budget">Budget (USD)</label><input class="input" id="budget" type="number" min="0" step="0.01" placeholder="0.50" /></div>
				<button type="submit" class="btn btn-primary" ${creating ? raw('disabled') : ''}>${creating ? raw('<span class="spin" aria-hidden="true"></span>Starting') : 'Start run'}</button>
			</div>
		</form>`;
	}

	function runList() {
		if (!data.runs.length) {
			return emptyState({ icon: 'runs', title: 'No runs yet', message: 'Give this agent a goal above. It works through it one step at a time, within the budget you set.' });
		}
		return html`<div class="list" role="listbox" aria-label="Runs">${data.runs.map((r) => html`<button type="button" class="list-item" role="option" aria-selected="${r.id === selectedRun}" data-action="pick" data-id="${r.id}">
			<div class="top">${runStatusChip(r.status)}<span class="sub">${relativeTime(r.createdAt)}</span></div>
			<div class="goal">${r.goal || 'Untitled run'}</div>
			<div class="sub">${r.steps} step${r.steps === 1 ? '' : 's'}${r.spentUsd ? ` · ${formatUsd(r.spentUsd)}` : ''}</div>
		</button>`)}</div>`;
	}

	function detailPanel() {
		if (!selectedRun) return html`<div class="state"><h3>Pick a run</h3><p>Its steps appear here, live while it runs.</p></div>`;
		if (detailError) return errorState(detailError, { title: 'This run could not load', retry: 'reload-run' });
		if (!detail) return html`<div class="card">${skeletonLines(6)}</div>`;
		const r = detail.run;
		return html`<div class="card">
			<div class="top" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
				${runStatusChip(r.status)}
				${!r.terminal ? html`<button type="button" class="btn btn-sm btn-danger" data-action="cancel-run">Cancel run</button>` : ''}
			</div>
			<h3 style="margin-top:10px;font-size:15px" class="selectable">${r.goal}</h3>
			<div class="run-summary">
				<span><b>${r.steps}</b>${r.maxSteps ? ` / ${r.maxSteps}` : ''} steps</span>
				<span><b>${formatUsd(r.spentUsd)}</b>${r.budgetUsd ? ` of ${formatUsd(r.budgetUsd)}` : ''} spent</span>
				${r.createdAt ? html`<span>Started ${relativeTime(r.createdAt)}</span>` : ''}
				${watching === r.id ? html`<span class="chip chip-info">Live</span>` : ''}
			</div>
			${r.error ? html`<div class="banner bad">${r.error}</div>` : ''}
			${detail.steps.length ? html`<ol class="timeline">${detail.steps.map(stepMarkup)}</ol>` : html`<p style="color:var(--muted)">No steps yet. The first one appears as soon as the agent starts.</p>`}
			${r.result ? html`<h2>Result</h2><div class="msg msg-agent" style="max-width:none">${raw(ctx.markdown(r.result))}</div>` : ''}
		</div>`;
	}

	function body() {
		if (phase === 'loading') return html`<div class="split"><div>${skeletonLines(6)}</div><div class="sk sk-block"></div></div>`;
		if (phase === 'error') return errorState(error, { title: 'Runs could not load' });
		if (phase === 'no-agents') return emptyState({ icon: 'agents', title: 'No agents yet', message: 'Create an agent on three.ws to give it goals and follow its runs.', actions: [{ action: 'create', label: 'Create an agent', primary: true }] });
		if (data.mode === 'activity') {
			return html`<div class="banner"><span class="ico ico-runs" aria-hidden="true"></span><div>This is ${agents.selected()?.name || 'the agent'}'s signed action log. Goal-driven runs with a step timeline start here once three.ws serves the v1 Runs API.</div></div>
				${data.activity.length
					? html`<div class="card"><ol class="timeline">${data.activity.map(activityMarkup)}</ol></div>`
					: emptyState({ icon: 'runs', title: 'Nothing recorded yet', message: 'Every action this agent takes, and every transaction it signs, is logged here.' })}`;
		}
		return html`${newRunForm()}<div class="split"><div>${runList()}</div><div>${detailPanel()}</div></div>`;
	}

	function render() {
		const list = agents.list();
		mount(root, html`<div class="view">
			<header class="head">
				<div><h1>Runs</h1><p>Goals your agents work through, step by step.</p></div>
				<div class="head-actions">
					${list.length ? agentPicker(list, agents.selectedId(), 'Agent') : ''}
					<button type="button" class="btn btn-ghost btn-icon" data-action="retry" aria-label="Refresh runs"><span class="ico ico-refresh" aria-hidden="true"></span></button>
				</div>
			</header>
			${body()}
		</div>`);
		root.querySelector('#new-run')?.addEventListener('submit', (e) => {
			e.preventDefault();
			createRun();
		});
	}

	async function loadRun(id) {
		unwatch();
		selectedRun = id;
		detail = null;
		detailError = null;
		render();
		try {
			detail = await bridge.runs.detail(id);
			if (!detail.run.terminal) {
				watching = id;
				await bridge.runs.watch(id);
			}
		} catch (err) {
			detailError = err;
		}
		render();
	}

	async function load() {
		unwatch();
		phase = 'loading';
		render();
		try {
			await agents.load();
			if (!agents.selectedId()) {
				phase = 'no-agents';
				render();
				return;
			}
			data = await bridge.runs.list(agents.selectedId());
			phase = 'ready';
			if (data.mode === 'runs' && data.runs.length) {
				const keep = data.runs.find((r) => r.id === selectedRun) || data.runs[0];
				render();
				loadRun(keep.id);
				return;
			}
			selectedRun = null;
		} catch (err) {
			phase = 'error';
			error = err;
		}
		render();
	}

	async function createRun() {
		const goal = root.querySelector('#goal')?.value;
		const maxSteps = root.querySelector('#max-steps')?.value;
		const budgetUsd = root.querySelector('#budget')?.value;
		creating = true;
		render();
		try {
			const run = await bridge.runs.create(agents.selectedId(), { goal, maxSteps, budgetUsd });
			data.runs = [run, ...data.runs];
			toast('Run started.', 'ok');
			creating = false;
			loadRun(run.id);
		} catch (err) {
			creating = false;
			toast(err.message, 'bad');
			render();
		}
	}

	const offEvents = bridge.runs.onEvent((evt) => {
		if (evt.runId !== selectedRun || !detail) return;
		if (evt.type === 'step' && evt.step) {
			const i = detail.steps.findIndex((s) => s.id && s.id === evt.step.id);
			if (i >= 0) detail.steps[i] = evt.step;
			else detail.steps.push(evt.step);
			detail.run.steps = Math.max(detail.run.steps, detail.steps.length);
		} else if (evt.type === 'run' && evt.run) {
			detail.run = { ...detail.run, ...evt.run, goal: evt.run.goal || detail.run.goal };
			const i = data.runs.findIndex((r) => r.id === evt.runId);
			if (i >= 0) data.runs[i] = { ...data.runs[i], ...detail.run };
		} else if (evt.type === 'end') {
			if (watching === evt.runId) watching = null;
		} else if (evt.type === 'error') {
			toast(`Live updates stopped: ${evt.message}`, 'bad');
		}
		render();
	});

	const offPicker = bindPicker(root, agents, () => {
		selectedRun = null;
		load();
	});

	const offActions = onAction(root, {
		retry: load,
		create: () => bridge.app.openExternal('/create'),
		pick: (el) => loadRun(el.dataset.id),
		'reload-run': () => selectedRun && loadRun(selectedRun),
		'cancel-run': async (el) => {
			el.disabled = true;
			try {
				const run = await bridge.runs.cancel(selectedRun);
				detail.run = { ...detail.run, ...run };
				toast('Cancel requested. The run stops after its current step.', 'ok');
			} catch (err) {
				toast(err.message, 'bad');
			}
			render();
		},
	});

	load();
	return () => {
		unwatch();
		offEvents();
		offPicker();
		offActions();
	};
}
