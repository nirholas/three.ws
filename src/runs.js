// /runs and /runs/:id: run receipts, the per-generation record of what each
// Studio stage was expected to do, what it actually did, and the verdict.
//
//   /runs      aggregate view across every receipt in a window (GET /api/runs?stats=1)
//   /runs/:id  one receipt as a stage timeline, plus its signature check (GET /api/runs?id=)
//
// Everything a receipt says is rendered with textContent: prompts and causes are
// user and pipeline text, never markup.

const root = document.getElementById('rr-root');
const DAY_CHOICES = [1, 7, 30, 90];
const VERDICT_LABEL = { met: 'Met', recovered: 'Recovered', missed: 'Missed', skipped: 'Skipped', pending: 'Pending' };
const OUTCOME_LABEL = {
	delivered: 'Delivered as expected',
	delivered_with_issues: 'Delivered, with issues noted',
	partial: 'Partly delivered',
	pending: 'Still running',
	refused: 'Refused before any work ran',
	failed: 'Not delivered',
};
const OUTCOME_TONE = { delivered: 'met', delivered_with_issues: 'missed', partial: 'recovered', pending: 'pending', refused: 'skipped', failed: 'missed' };
const TOOL_LABEL = {
	forge_avatar: 'Rigged avatar',
	text_to_avatar: 'Avatar',
	mesh_forge: 'Mesh',
	forge_free: 'Model',
	rig_mesh: 'Rig a mesh',
	refine_model: 'Refinement',
};
const ID_RE = /rr_[1-9A-HJ-NP-Za-km-z]{16,32}/;

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
	return node;
}

const pct = (n) => (n == null ? 'n/a' : `${Math.round(n * 1000) / 10}%`);
const secs = (ms) => (Number.isFinite(ms) ? (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`) : null);
const when = (iso) => {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

async function getJson(url) {
	const res = await fetch(url, { headers: { accept: 'application/json' } });
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(body?.error_description || body?.message || `The server answered ${res.status}.`), { status: res.status });
	return body;
}

function errorState(title, message, retry) {
	return el(
		'div',
		{ class: 'rr-state rr-state--error', role: 'alert' },
		el('h2', { text: title }),
		el('p', { text: message }),
		retry ? el('button', { class: 'rr-btn', type: 'button', onclick: retry, text: 'Try again' }) : null,
	);
}

function lookupForm() {
	const input = el('input', {
		class: 'rr-input',
		type: 'text',
		name: 'receipt',
		placeholder: 'Paste a receipt link or id (rr_…)',
		'aria-label': 'Receipt link or id',
		autocomplete: 'off',
		spellcheck: 'false',
	});
	const hint = el('p', { class: 'rr-hint', 'aria-live': 'polite' });
	const form = el(
		'form',
		{
			class: 'rr-lookup',
			onsubmit: (e) => {
				e.preventDefault();
				const id = ID_RE.exec(input.value)?.[0];
				if (!id) {
					hint.textContent = 'That is not a receipt id. They start with rr_ and come at the end of every Studio result.';
					input.focus();
					return;
				}
				history.pushState(null, '', `/runs/${id}`);
				route();
			},
		},
		input,
		el('button', { class: 'rr-btn rr-btn--primary', type: 'submit', text: 'Open receipt' }),
	);
	return el('div', {}, form, hint);
}

// ── index: the aggregate view ───────────────────────────────────────────────

function skeletonIndex() {
	return el(
		'div',
		{ class: 'rr-skel', 'aria-busy': 'true', 'aria-label': 'Loading run statistics' },
		el('div', { class: 'rr-kpis' }, [0, 1, 2].map(() => el('div', { class: 'rr-kpi rr-shimmer' }))),
		[0, 1, 2, 3, 4].map(() => el('div', { class: 'rr-skel-row rr-shimmer' })),
	);
}

function verdictBar(verdicts, total) {
	const bar = el('div', { class: 'rr-bar', role: 'img', 'aria-label': Object.entries(verdicts).map(([v, n]) => `${VERDICT_LABEL[v] || v} ${n}`).join(', ') });
	for (const v of ['met', 'recovered', 'missed', 'skipped', 'pending']) {
		const n = verdicts[v] || 0;
		if (!n) continue;
		bar.append(el('span', { class: `rr-bar__seg rr-tone--${v}`, style: `flex-grow:${n}`, title: `${VERDICT_LABEL[v]}: ${n} of ${total}` }));
	}
	return bar;
}

async function renderIndex(days) {
	document.title = 'Run Receipts · three.ws';
	const picker = el(
		'div',
		{ class: 'rr-days', role: 'group', 'aria-label': 'Time window' },
		DAY_CHOICES.map((d) =>
			el('button', {
				type: 'button',
				class: `rr-chip${d === days ? ' is-active' : ''}`,
				'aria-pressed': String(d === days),
				text: d === 1 ? '24 hours' : `${d} days`,
				onclick: () => {
					history.replaceState(null, '', d === 7 ? '/runs' : `/runs?days=${d}`);
					renderIndex(d);
				},
			}),
		),
	);
	const body = el('div', {}, skeletonIndex());
	root.replaceChildren(lookupForm(), el('div', { class: 'rr-toolbar' }, el('h2', { class: 'rr-h2', text: 'Across every run' }), picker), body);

	let stats;
	try {
		stats = await getJson(`/api/runs?stats=1&days=${days}`);
	} catch (err) {
		body.replaceChildren(errorState('Could not load run statistics', `${err.message} Your receipt links still work; this only affects the summary.`, () => renderIndex(days)));
		return;
	}
	if (!stats.total) {
		body.replaceChildren(
			el(
				'div',
				{ class: 'rr-state' },
				el('h2', { text: `No runs in the last ${days === 1 ? '24 hours' : `${days} days`}` }),
				el('p', { text: 'Receipts appear here as soon as anyone generates a model, an avatar, or a rig through the free 3D Studio MCP server, including npm create @three-ws/agent.' }),
				el('div', { class: 'rr-actions' }, el('a', { class: 'rr-btn rr-btn--primary', href: '/docs/mcp-studio', text: 'Connect the 3D Studio' }), days < 90 ? el('button', { class: 'rr-btn', type: 'button', text: 'Widen to 90 days', onclick: () => renderIndex(90) }) : null),
			),
		);
		return;
	}

	const kpis = el(
		'div',
		{ class: 'rr-kpis' },
		el('div', { class: 'rr-kpi' }, el('span', { class: 'rr-kpi__n', text: stats.total.toLocaleString() }), el('span', { class: 'rr-kpi__l', text: 'runs recorded' })),
		el('div', { class: 'rr-kpi' }, el('span', { class: 'rr-kpi__n', text: pct(stats.delivery_rate) }), el('span', { class: 'rr-kpi__l', text: 'delivered a file' })),
		el('div', { class: 'rr-kpi' }, el('span', { class: 'rr-kpi__n', text: pct(stats.clean_rate) }), el('span', { class: 'rr-kpi__l', text: 'ran clean: no fallback, no miss' })),
	);

	const stageRows = stats.stages.map((s) =>
		el(
			'li',
			{ class: 'rr-stage-row' },
			el('div', { class: 'rr-stage-row__head' }, el('span', { class: 'rr-stage-row__name', text: s.label }), el('span', { class: 'rr-stage-row__rate', text: s.met_rate == null ? 'not judged' : `${pct(s.met_rate)} met` })),
			verdictBar(s.verdicts, s.total),
			el(
				'div',
				{ class: 'rr-legend' },
				Object.entries(s.verdicts).map(([v, n]) => el('span', { class: `rr-legend__item rr-tone--${v}` }, el('i', { 'aria-hidden': 'true' }), `${VERDICT_LABEL[v] || v} ${n}`)),
			),
		),
	);

	const causes = stats.top_causes.length
		? el(
				'ol',
				{ class: 'rr-causes' },
				stats.top_causes.map((c) =>
					el(
						'li',
						{},
						el('span', { class: `rr-verdict rr-tone--${c.verdict}`, text: VERDICT_LABEL[c.verdict] || c.verdict }),
						el('span', { class: 'rr-causes__stage', text: c.label }),
						el('span', { class: 'rr-causes__text', text: c.cause }),
						el('span', { class: 'rr-causes__n', text: `×${c.count}` }),
					),
				),
			)
		: el('p', { class: 'rr-muted', text: 'No stage needed a fallback or missed its contract in this window.' });

	const tools = el(
		'ul',
		{ class: 'rr-tools' },
		Object.entries(stats.tools)
			.sort((a, b) => b[1].total - a[1].total)
			.map(([tool, t]) =>
				el(
					'li',
					{},
					el('span', { class: 'rr-tools__name', text: TOOL_LABEL[tool] || tool }),
					el('code', { text: tool }),
					el('span', { class: 'rr-tools__n', text: `${t.total} run${t.total === 1 ? '' : 's'}` }),
					el('span', { class: 'rr-muted', text: Object.entries(t.outcomes).map(([o, n]) => `${n} ${(OUTCOME_LABEL[o] || o).toLowerCase()}`).join(' · ') }),
				),
			),
	);

	body.replaceChildren(
		kpis,
		el('section', { class: 'rr-card' }, el('h3', { class: 'rr-h3', text: 'Stage by stage' }), el('p', { class: 'rr-muted', text: 'Skipped and still-running stages are left out of the met rate.' }), el('ul', { class: 'rr-stage-list' }, stageRows)),
		el('section', { class: 'rr-card' }, el('h3', { class: 'rr-h3', text: 'Most common causes' }), causes),
		el('section', { class: 'rr-card' }, el('h3', { class: 'rr-h3', text: 'By tool' }), tools),
		stats.signer ? el('p', { class: 'rr-muted rr-signer' }, 'Receipts are signed by ', el('code', { text: stats.signer }), '.') : null,
	);
}

// ── detail: one receipt ─────────────────────────────────────────────────────

function metricsList(metrics) {
	if (!metrics) return null;
	const items = [];
	for (const [k, v] of Object.entries(metrics)) {
		if (v == null) continue;
		const value = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} ${b}`).join(' · ') : typeof v === 'number' ? v.toLocaleString() : String(v);
		items.push(el('div', { class: 'rr-metric' }, el('dt', { text: k.replace(/_/g, ' ') }), el('dd', { text: value })));
	}
	return items.length ? el('dl', { class: 'rr-metrics' }, items) : null;
}

function stageCard(s, i) {
	const time = secs(s.ms);
	return el(
		'li',
		{ class: `rr-step rr-tone--${s.verdict}` },
		el('div', { class: 'rr-step__dot', 'aria-hidden': 'true', text: String(i + 1) }),
		el(
			'div',
			{ class: 'rr-step__body' },
			el(
				'div',
				{ class: 'rr-step__head' },
				el('h3', { class: 'rr-step__name', text: s.label }),
				el('span', { class: `rr-verdict rr-tone--${s.verdict}`, text: VERDICT_LABEL[s.verdict] || s.verdict }),
				time ? el('span', { class: 'rr-step__time', text: time }) : null,
			),
			el('dl', { class: 'rr-eo' }, el('dt', { text: 'Expected' }), el('dd', { text: s.expected || '' }), el('dt', { text: 'Observed' }), el('dd', { text: s.observed || '' }), s.cause ? [el('dt', { text: 'Cause' }), el('dd', { class: 'rr-eo__cause', text: s.cause })] : null),
			metricsList(s.metrics),
		),
	);
}

function copyButton(label, value) {
	const btn = el('button', {
		class: 'rr-btn rr-btn--small',
		type: 'button',
		text: label,
		onclick: async () => {
			try {
				await navigator.clipboard.writeText(value);
				btn.textContent = 'Copied';
			} catch {
				btn.textContent = 'Copy failed: select the text instead';
			}
			setTimeout(() => (btn.textContent = label), 1600);
		},
	});
	return btn;
}

function verificationPanel(data) {
	const v = data.verification || { ok: false, checks: [] };
	const r = data.receipt;
	const cmd = `node scripts/run-receipt-verify.mjs ${r.id}${data.signer ? ` --signer ${data.signer}` : ''}`;
	const download = () => {
		const blob = new Blob([JSON.stringify({ receipt: data.receipt, sha256: data.sha256, signature: data.signature, signer: data.signer }, null, 2)], { type: 'application/json' });
		const a = el('a', { href: URL.createObjectURL(blob), download: `${r.id}.json` });
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	};
	return el(
		'section',
		{ class: `rr-card rr-verify ${v.ok ? 'is-ok' : 'is-bad'}` },
		el('h3', { class: 'rr-h3', text: v.ok ? 'Signature verified' : data.signature ? 'Signature did not verify' : 'Unsigned receipt' }),
		el(
			'p',
			{ class: 'rr-muted', text: v.ok ? 'This record is exactly what the pipeline wrote when the run finished. Changing any word in it breaks the signature.' : data.signature ? 'The stored record no longer matches its signature. Treat its contents as unverified.' : 'This deployment had no signing key configured when the run finished, so the record is hashed but not signed.' },
		),
		el('ul', { class: 'rr-checks' }, v.checks.map((c) => el('li', { class: c.ok ? 'is-ok' : 'is-bad' }, el('span', { 'aria-hidden': 'true', text: c.ok ? '✓' : '✕' }), el('strong', { text: c.name }), c.detail ? ` ${c.detail}` : ''))),
		el('dl', { class: 'rr-ids' }, el('dt', { text: 'sha256' }), el('dd', {}, el('code', { text: data.sha256 })), data.signer ? [el('dt', { text: 'signer' }), el('dd', {}, el('code', { text: data.signer }))] : null),
		el('p', { class: 'rr-muted', text: 'Check it yourself, without trusting this page:' }),
		el('div', { class: 'rr-cmd' }, el('code', { text: cmd }), copyButton('Copy', cmd)),
		el('div', { class: 'rr-actions' }, el('button', { class: 'rr-btn', type: 'button', text: 'Download JSON', onclick: download }), el('a', { class: 'rr-btn', href: `/api/runs?id=${encodeURIComponent(r.id)}`, target: '_blank', rel: 'noopener', text: 'Raw API response' })),
	);
}

// Only check_job completes a pending receipt, and the server keeps a hash of the
// job handle, never the handle, so it cannot collect the job on the caller's
// behalf. Studio jobs finish in minutes; a receipt still pending an hour later
// was never collected, and offering Refresh forever would imply otherwise.
const UNCOLLECTED_AFTER_MS = 60 * 60 * 1000;

function pendingNote(r, id) {
	const started = Date.parse(r.started_at);
	if (Number.isFinite(started) && Date.now() - started > UNCOLLECTED_AFTER_MS) {
		return el(
			'div',
			{ class: 'rr-pending' },
			el('p', { text: 'Never collected. A stage was still running when the tool answered, and nobody called check_job for the job afterwards, so this receipt cannot say how that stage ended. Every other stage is final.' }),
		);
	}
	return el(
		'div',
		{ class: 'rr-pending' },
		el('p', { text: 'A stage was still running when the tool answered. This receipt completes when the caller collects the job with check_job.' }),
		el('button', { class: 'rr-btn', type: 'button', text: 'Refresh', onclick: () => renderReceipt(id) }),
	);
}

async function renderReceipt(id) {
	root.replaceChildren(el('div', { class: 'rr-skel', 'aria-busy': 'true', 'aria-label': 'Loading receipt' }, el('div', { class: 'rr-skel-head rr-shimmer' }), [0, 1, 2, 3, 4].map(() => el('div', { class: 'rr-skel-row rr-shimmer' }))));
	let data;
	try {
		data = await getJson(`/api/runs?id=${encodeURIComponent(id)}`);
	} catch (err) {
		root.replaceChildren(
			err.status === 404
				? errorState('No receipt with that id', 'Check the link was copied in full. Receipt ids start with rr_ and are case-sensitive.', null)
				: errorState('Could not load this receipt', err.message, () => renderReceipt(id)),
			el('p', {}, el('a', { href: '/runs', text: 'Back to all runs' })),
		);
		return;
	}
	const r = data.receipt;
	const tone = OUTCOME_TONE[r.outcome] || 'skipped';
	document.title = `${OUTCOME_LABEL[r.outcome] || r.outcome} · Run receipt · three.ws`;
	document.getElementById('rr-title').textContent = `${TOOL_LABEL[r.tool] || r.tool} run`;

	const facts = [
		when(r.started_at),
		secs(r.duration_ms) ? `took ${secs(r.duration_ms)}` : null,
		r.input?.reference_image ? 'from a reference image' : null,
	].filter(Boolean);

	const head = el(
		'section',
		{ class: `rr-card rr-outcome rr-tone--${tone}` },
		el('div', { class: 'rr-outcome__row' }, el('span', { class: `rr-verdict rr-tone--${tone}`, text: OUTCOME_LABEL[r.outcome] || r.outcome }), el('code', { class: 'rr-outcome__tool', text: r.tool })),
		r.input?.prompt ? el('blockquote', { class: 'rr-prompt', text: r.input.prompt }) : el('p', { class: 'rr-muted', text: r.outcome === 'refused' ? 'The prompt is not kept on a refused request.' : 'No text prompt.' }),
		el('p', { class: 'rr-outcome__summary', text: r.summary }),
		el('p', { class: 'rr-muted', text: facts.join(' · ') }),
		r.output?.glb_url
			? el('div', { class: 'rr-actions' }, el('a', { class: 'rr-btn rr-btn--primary', href: r.output.viewer_url || `/viewer?src=${encodeURIComponent(r.output.glb_url)}`, text: 'Open the model' }), el('a', { class: 'rr-btn', href: r.output.glb_url, text: 'Download GLB' }))
			: null,
		r.outcome === 'pending' ? pendingNote(r, id) : null,
	);

	const issues = (r.issues || []).length
		? el(
				'section',
				{ class: 'rr-card' },
				el('h3', { class: 'rr-h3', text: 'What did not go as expected' }),
				el(
					'ul',
					{ class: 'rr-issues' },
					r.issues.map((i) =>
						el('li', {}, el('span', { class: `rr-verdict rr-tone--${i.verdict}`, text: VERDICT_LABEL[i.verdict] }), el('strong', { text: i.label }), el('span', { text: ` Expected ${lc(i.expected)} Observed ${lc(i.observed)}${i.cause ? ` Because: ${lc(i.cause)}` : ''}` })),
					),
				),
			)
		: null;

	// replaceChildren stringifies null into a "null" text node; a clean run has no issues card.
	root.replaceChildren(
		...[
			el('p', { class: 'rr-back' }, el('a', { href: '/runs', text: '← All runs' })),
			head,
			issues,
			el('section', { class: 'rr-card' }, el('h3', { class: 'rr-h3', text: 'Every stage' }), el('ol', { class: 'rr-steps' }, r.stages.map(stageCard))),
			verificationPanel(data),
		].filter(Boolean),
	);
}

const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');

function route() {
	const m = /^\/runs\/([^/]+)\/?$/.exec(location.pathname);
	if (m && ID_RE.test(decodeURIComponent(m[1]))) return renderReceipt(decodeURIComponent(m[1]));
	if (m) {
		root.replaceChildren(errorState('That is not a receipt link', 'Receipt ids start with rr_. Paste the full link from the Studio result.', null), lookupForm());
		return;
	}
	const days = Number(new URLSearchParams(location.search).get('days'));
	return renderIndex(DAY_CHOICES.includes(days) ? days : 7);
}

window.addEventListener('popstate', route);
route();
