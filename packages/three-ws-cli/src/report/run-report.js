// One agent run as a single self-contained HTML file: inline CSS and JS, no
// network, no external URL. The CLI (`three-ws report run <id>`) and the
// "Download report" button on the run page both call buildRunReport, so the two
// can never disagree about what a report contains.
//
// This module is pure (no node: imports, no DOM) so it runs in a browser bundle
// and in Node. Input is the payload GET /api/agent-run-replay?run=<id> returns,
// plus optionally the agent's decision-trail verification report.

const TRADE_TOOL = /(swap|trade|buy|sell|order|transfer|snipe|launch|bridge|stake|perp|position)/i;

const STATUS_LABEL = {
	queued: 'Queued',
	running: 'Running',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Cancelled',
	budget_exhausted: 'Stopped at its budget',
	scheduled: 'Scheduled',
	paused: 'Paused',
};

export function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function pretty(value) {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function money(n) {
	const v = Number(n) || 0;
	return v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

function when(iso) {
	if (!iso) return 'not recorded';
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function duration(run) {
	const start = run.startedAt || run.createdAt;
	if (!start || !run.finishedAt) return 'still running or not recorded';
	const s = Math.round((new Date(run.finishedAt) - new Date(start)) / 1000);
	if (!Number.isFinite(s) || s < 0) return 'not recorded';
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function isFailed(trace) {
	return trace.status === 'error' || trace.status === 'blocked';
}

function toolCallsOf(step) {
	const o = step.output;
	if (!o || !Array.isArray(o.toolCalls)) return [];
	return o.toolCalls.map((c) => c?.name || c?.function?.name).filter(Boolean);
}

/** The model's own words between tool calls: the decisions the agent took. */
export function decisionsOf(steps) {
	return steps
		.filter((s) => s.kind === 'model_call')
		.map((s) => ({ seq: s.seq, text: String(s.output?.content || '').trim(), calls: toolCallsOf(s), model: s.model, at: s.at }))
		.filter((d) => d.text || d.calls.length);
}

/** Tool traces that look like trades, with the outcome of each. */
export function tradesOf(traces) {
	return traces.filter((t) => TRADE_TOOL.test(String(t.tool || '')));
}

/** The head of the run's receipt chain: the receipt on the last step that has one. */
export function receiptHead(steps) {
	for (let i = steps.length - 1; i >= 0; i -= 1) if (steps[i].receipt) return steps[i].receipt;
	return null;
}

function block(label, value) {
	const text = pretty(value);
	if (!text) return '';
	return `<div class="blk"><span class="lbl">${escapeHtml(label)}</span><pre>${escapeHtml(text)}</pre></div>`;
}

function traceRow(t) {
	const tone = t.status === 'ok' ? 'ok' : t.status === 'pending' ? 'wait' : 'bad';
	return `<details class="row ${tone}" data-status="${escapeHtml(t.status)}">
<summary><span class="seq">#${escapeHtml(t.callSeq ?? t.resultSeq ?? '')}</span><span class="tool">${escapeHtml(t.tool)}</span><span class="chip ${tone}">${escapeHtml(t.status)}</span>${t.latencyMs != null ? `<span class="meta">${escapeHtml(t.latencyMs)} ms</span>` : ''}${t.receipt ? `<code class="hash" title="${escapeHtml(t.receipt)}">${escapeHtml(String(t.receipt).slice(0, 12))}</code>` : ''}</summary>
${block('Input', t.input)}${block('Output', t.output)}${t.receipt ? `<div class="blk"><span class="lbl">Receipt</span><pre>${escapeHtml(t.receipt)}</pre></div>` : ''}
</details>`;
}

function chainBadge(chain) {
	if (!chain) return '<span class="chip wait">receipt chain not recomputed</span>';
	if (chain.verified) return `<span class="chip ok">receipt chain verified, ${escapeHtml(chain.checked)} steps</span>`;
	if (chain.brokenAt != null) return `<span class="chip bad">receipt chain broken at step ${escapeHtml(chain.brokenAt)}</span>`;
	return '<span class="chip wait">run predates step receipts</span>';
}

function trailSection(trail) {
	if (!trail) {
		return `<p class="note">The decision trail could not be fetched when this report was made, so its head hash is not included. The run's own receipt chain above still vouches for every step.</p>`;
	}
	const head = trail.chain?.head_hash;
	const status = String(trail.status || 'unknown').replace(/_/g, ' ');
	const tone = trail.ok === false ? 'bad' : trail.status === 'verified' ? 'ok' : 'wait';
	if (!head) {
		return `<p><span class="chip ${tone}">${escapeHtml(status)}</span> This agent has no recorded decisions yet, so the trail has no head hash.</p>`;
	}
	return `<div class="kv">
<div><span class="lbl">Status</span><span class="chip ${tone}">${escapeHtml(status)}</span></div>
<div><span class="lbl">Entries</span><span>${escapeHtml(trail.chain?.count ?? 'unknown')}</span></div>
<div><span class="lbl">Head hash</span><code class="full">${escapeHtml(head)}</code></div>
${trail.anchor?.signature ? `<div><span class="lbl">On-chain anchor</span><code class="full">${escapeHtml(trail.anchor.signature)}</code></div>` : '<div><span class="lbl">On-chain anchor</span><span>none yet</span></div>'}
<div><span class="lbl">Checked</span><span>${escapeHtml(when(trail.checked_at))}</span></div>
</div>`;
}

const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#14161a;--mut:#5a6270;--line:#dfe3ea;--card:#f6f8fb;--ok:#0f7b3f;--bad:#b3261e;--wait:#8a5a00;--acc:#3b3ff0}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f13;--fg:#e9ecf1;--mut:#9aa3b2;--line:#262b34;--card:#151920;--ok:#4cd68b;--bad:#ff8a80;--wait:#f0b84a;--acc:#8b8fff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.1rem;margin:36px 0 12px;padding-top:12px;border-top:1px solid var(--line)}
.sub{color:var(--mut);margin:0 0 20px}
.goal{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;white-space:pre-wrap;overflow-wrap:anywhere}
.meters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
.meter{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.meter b{display:block;font-size:1.05rem}.meter span,.lbl{color:var(--mut);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.chip{display:inline-block;border-radius:999px;padding:1px 10px;font-size:.78rem;border:1px solid currentColor;margin-right:6px}
.chip.ok{color:var(--ok)}.chip.bad{color:var(--bad)}.chip.wait{color:var(--wait)}
.row{border:1px solid var(--line);border-radius:10px;margin:8px 0;background:var(--card)}
.row.bad{border-color:var(--bad)}
.row summary{cursor:pointer;padding:9px 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.row summary:focus-visible,button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.seq,.meta{color:var(--mut);font-size:.85rem}.tool{font-weight:600}
.hash{margin-left:auto;font-size:.78rem;color:var(--mut)}
.blk{padding:0 12px 10px}pre{margin:4px 0 0;padding:10px;background:var(--bg);border:1px solid var(--line);border-radius:8px;overflow:auto;max-height:340px;font-size:.82rem;white-space:pre-wrap;overflow-wrap:anywhere}
code.full{display:block;overflow-wrap:anywhere;font-size:.85rem}
.kv{display:grid;gap:10px}.kv>div{display:grid;gap:2px}
.dec{border-left:3px solid var(--acc);padding:4px 0 4px 12px;margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.note{color:var(--mut)}.empty{color:var(--mut);font-style:italic}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:8px;padding:6px 12px;cursor:pointer}
button:hover{border-color:var(--acc)}button:active{transform:translateY(1px)}
footer{margin-top:40px;color:var(--mut);font-size:.85rem}
@media print{button{display:none}details{display:block}.row summary{cursor:default}}
`;

const SCRIPT = `
(function(){
  var rows=[].slice.call(document.querySelectorAll('.row'));
  function setOpen(v){rows.forEach(function(r){r.open=v});}
  var all=document.getElementById('expand'),fail=document.getElementById('failed'),copy=document.getElementById('copyhash');
  if(all){all.addEventListener('click',function(){var open=all.getAttribute('aria-pressed')!=='true';all.setAttribute('aria-pressed',String(open));all.textContent=open?'Collapse all':'Expand all';setOpen(open);});}
  if(fail){fail.addEventListener('click',function(){var on=fail.getAttribute('aria-pressed')!=='true';fail.setAttribute('aria-pressed',String(on));fail.textContent=on?'Show all calls':'Show failed calls only';
    document.querySelectorAll('#calls .row').forEach(function(r){var bad=r.getAttribute('data-status')==='error'||r.getAttribute('data-status')==='blocked';r.hidden=on&&!bad;});});}
  if(copy&&navigator.clipboard){copy.addEventListener('click',function(){navigator.clipboard.writeText(copy.getAttribute('data-hash')).then(function(){copy.textContent='Copied';});});}else if(copy){copy.hidden=true;}
})();
`;

/**
 * @param {{
 *   run: object, steps: object[], toolTraces?: object[], receiptChain?: object|null,
 *   trail?: object|null, origin?: string, generatedAt?: string
 * }} input
 * @returns {string} a complete HTML document
 */
export function buildRunReport({ run, steps = [], toolTraces = [], receiptChain = null, trail = null, origin = 'https://three.ws', generatedAt = new Date().toISOString() }) {
	const traces = toolTraces;
	const failed = traces.filter(isFailed);
	const trades = tradesOf(traces);
	const decisions = decisionsOf(steps);
	const turns = steps.filter((s) => s.kind === 'model_call').length;
	const head = receiptHead(steps);
	const budget = run.budget?.creditsUsd || 0;
	const spent = run.spent?.creditsUsd || 0;
	const outcome = run.result || run.error || run.summary || null;
	const outcomeTone = run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'bad' : 'wait';
	const title = `Run report ${run.id}`;
	let host = origin;
	try {
		host = new URL(origin).host;
	} catch {
		host = String(origin).replace(/^https?:\/\//, '');
	}

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>Agent run report</h1>
<p class="sub">Run <code>${escapeHtml(run.id)}</code> for agent <code>${escapeHtml(run.agentId)}</code>. Generated ${escapeHtml(when(generatedAt))} from ${escapeHtml(host)}.</p>

<h2>Goal</h2>
<div class="goal">${escapeHtml(run.goal)}</div>
<div class="meters">
<div class="meter"><span>Status</span><b>${escapeHtml(STATUS_LABEL[run.status] || run.status)}</b></div>
<div class="meter"><span>Model turns</span><b>${escapeHtml(turns)}${run.maxSteps ? ` of ${escapeHtml(run.maxSteps)}` : ''}</b></div>
<div class="meter"><span>Tool calls</span><b>${escapeHtml(traces.length)}${failed.length ? ` (${escapeHtml(failed.length)} failed)` : ''}</b></div>
<div class="meter"><span>Credits</span><b>${escapeHtml(budget ? `${money(spent)} of ${money(budget)}` : `${money(spent)} (free lanes)`)}</b></div>
<div class="meter"><span>Duration</span><b>${escapeHtml(duration(run))}</b></div>
<div class="meter"><span>Model</span><b>${escapeHtml(run.model || 'default')}</b></div>
</div>
<p class="note">Started ${escapeHtml(when(run.startedAt || run.createdAt))}. Finished ${escapeHtml(when(run.finishedAt))}.</p>

<h2>Outcome</h2>
${outcome ? `<p><span class="chip ${outcomeTone}">${escapeHtml(STATUS_LABEL[run.status] || run.status)}</span></p><div class="goal">${escapeHtml(pretty(outcome))}</div>` : '<p class="empty">The run has not recorded an outcome yet.</p>'}
${run.summary && run.summary !== outcome ? `<p class="note">${escapeHtml(run.summary)}</p>` : ''}

<h2>Decisions</h2>
${decisions.length ? decisions.map((d) => `<div class="dec"><span class="meta">#${escapeHtml(d.seq)}${d.model ? ` ${escapeHtml(d.model)}` : ''}</span><br>${d.text ? escapeHtml(d.text) : '<span class="empty">No text.</span>'}${d.calls.length ? `<br><span class="meta">Asked for: ${escapeHtml(d.calls.join(', '))}</span>` : ''}</div>`).join('\n') : '<p class="empty">The model recorded no decisions in this run.</p>'}

<h2>Trades</h2>
${trades.length ? trades.map(traceRow).join('\n') : '<p class="empty">No trade, swap, order or transfer tool was called in this run. Runs use a read-only tool registry unless the agent was granted more.</p>'}

<h2>Tool calls</h2>
<div class="tools"><button type="button" id="expand" aria-pressed="false">Expand all</button>${failed.length ? '<button type="button" id="failed" aria-pressed="false">Show failed calls only</button>' : ''}</div>
<div id="calls">
${traces.length ? traces.map(traceRow).join('\n') : '<p class="empty">The run made no tool calls.</p>'}
</div>

<h2>Integrity</h2>
<p>${chainBadge(receiptChain)}</p>
<div class="kv">
<div><span class="lbl">Receipt chain head</span>${head ? `<code class="full">${escapeHtml(head)}</code>` : '<span>none recorded</span>'}</div>
</div>
${head ? `<div class="tools"><button type="button" id="copyhash" data-hash="${escapeHtml(head)}">Copy head hash</button></div>` : ''}
<h2>Decision trail head</h2>
${trailSection(trail)}

<footer>Self-contained report: no scripts or styles are loaded from the network. Verify live at ${escapeHtml(host)}/agents/${escapeHtml(run.agentId)}.</footer>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
