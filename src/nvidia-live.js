// Live NVIDIA lane health and measured GPU numbers, read from /api/nvidia/stats.
//
// One module drives both surfaces:
//   /nvidia             #nv-live   lane grid, GPU fleet chart, methodology
//   /nvidia/benchmarks  #nv-bench  the same plus full 7d/30d tables and CSV
//
// Every number comes from the API, which aggregates real probe rows and real
// forge jobs (api/_lib/nvidia-lanes.js). A lane or window without data renders
// the API's own note; nothing here estimates or fills in.

import './nvidia-live.css';

const STATS_URL = '/api/nvidia/stats';
const CSV_URL = '/api/nvidia/stats?format=csv';
const REFRESH_MS = 5 * 60_000;

const STATUS = Object.freeze({
	ok: { label: 'Live', glyph: '✓', cls: 'ok' },
	degraded: { label: 'Degraded', glyph: '!', cls: 'warn' },
	down: { label: 'Down', glyph: '×', cls: 'bad' },
	unconfigured: { label: 'Not deployed', glyph: '−', cls: 'off' },
	none: { label: 'Not probed yet', glyph: '−', cls: 'off' },
});

// Categorical identity for the two GPU families the fleet runs on. Validated
// with the dataviz palette checker on both the dark (#10140f) and light (#fff)
// surfaces; the hex lives in the page CSS as --gpu-l4 / --gpu-rtx.
const GPU_FAMILIES = Object.freeze([
	{ family: 'L4', cls: 'l4' },
	{ family: 'RTX PRO 6000', cls: 'rtx' },
]);
const familyClass = (family) => GPU_FAMILIES.find((g) => g.family === family)?.cls || 'other';

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat()) {
		if (c == null || c === false) continue;
		node.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return node;
}

export function formatMs(ms) {
	if (ms == null || !Number.isFinite(ms)) return '-';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.round((ms % 60_000) / 1000);
	if (s === 0) return `${m} min`;
	if (s === 60) return `${m + 1} min`;
	return `${m}m ${String(s).padStart(2, '0')}s`;
}

function ago(iso, now = Date.now()) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const mins = Math.max(0, Math.round((now - t) / 60_000));
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const h = Math.round(mins / 60);
	if (h < 48) return `${h} h ago`;
	return `${Math.round(h / 24)} d ago`;
}

const pct = (v) => (v == null ? '-' : `${v}%`);
const dash = (v) => (v == null ? '-' : v);

function statusPill(status) {
	const s = STATUS[status] || STATUS.down;
	return el('span', { class: `nvl-pill nvl-${s.cls}` }, el('span', { class: 'nvl-glyph', 'aria-hidden': 'true', text: s.glyph }), s.label);
}

function gpuChip(gpu) {
	if (!gpu) return null;
	return el(
		'span',
		{ class: `nvl-gpu nvl-gpu-${familyClass(gpu.family)}`, title: gpu.region ? `${gpu.name}, ${gpu.region}` : gpu.name },
		el('span', { class: 'nvl-swatch', 'aria-hidden': 'true' }),
		gpu.family || gpu.name,
	);
}

// ── Lane grid ────────────────────────────────────────────────────────────────

function laneCard(lane) {
	const last = lane.last_probe;
	const w7 = lane.probes['7d'];
	const failing = last.status === 'down' || last.status === 'degraded';
	return el(
		'article',
		{ class: `nvl-card${failing ? ' nvl-card-alert' : ''}`, 'aria-label': `${lane.label}: ${(STATUS[last.status] || STATUS.down).label}` },
		el('header', { class: 'nvl-card-head' },
			el('div', {},
				el('span', { class: 'nvl-tech', text: lane.technology }),
				el('h3', { text: lane.label }),
			),
			statusPill(last.status),
		),
		el('code', { class: 'nvl-model', title: lane.model || '', text: lane.model || 'model not reported' }),
		el('dl', { class: 'nvl-metrics' },
			el('div', {}, el('dt', { text: 'Last probe' }), el('dd', { text: last.latency_ms != null ? formatMs(last.latency_ms) : '-' })),
			el('div', {}, el('dt', { text: '7d p50' }), el('dd', { text: w7.count ? formatMs(w7.p50_ms) : '-' })),
			el('div', {}, el('dt', { text: '7d up' }), el('dd', { text: w7.count ? pct(w7.availability_pct) : '-' })),
		),
		el('footer', { class: 'nvl-card-foot' },
			lane.gpu ? gpuChip(lane.gpu) : null,
			lane.gpu?.region ? el('span', { text: lane.gpu.region }) : null,
			el('span', { class: 'nvl-when', text: last.probed_at ? ago(last.probed_at) : last.note || '' }),
		),
		failing && last.detail ? el('p', { class: 'nvl-detail', text: last.detail }) : null,
		!w7.count && last.status !== 'none' && last.status !== 'unconfigured' ? el('p', { class: 'nvl-empty-note', text: w7.note }) : null,
		last.status === 'unconfigured' ? el('p', { class: 'nvl-empty-note', text: 'This worker is not deployed on the production service yet, so it is not probed and counts toward no availability figure.' }) : null,
		last.status === 'none' ? el('p', { class: 'nvl-empty-note', text: `First probe runs within ${lane.cadence_minutes} minutes of deploy.` }) : null,
	);
}

function renderSummary(root, stats) {
	const node = root.querySelector('[data-nvl="summary"]');
	if (!node) return;
	const probed = stats.lanes.filter((l) => l.last_probe.status !== 'none' && l.last_probe.status !== 'unconfigured');
	const live = probed.filter((l) => l.last_probe.status === 'ok').length;
	node.replaceChildren(
		el('strong', { text: `${live} of ${probed.length}` }),
		` deployed lanes answered their last probe. Updated ${ago(stats.generated_at)}.`,
	);
}

function renderGrid(root, stats) {
	const grid = root.querySelector('[data-nvl="grid"]');
	if (!grid) return;
	grid.removeAttribute('aria-busy');
	const hosted = stats.lanes.filter((l) => l.kind === 'hosted');
	const gpu = stats.lanes.filter((l) => l.kind === 'gpu');
	grid.replaceChildren(
		el('h3', { class: 'nvl-group', text: 'Hosted on NVIDIA' }),
		el('div', { class: 'nvl-cards' }, hosted.map(laneCard)),
		el('h3', { class: 'nvl-group', text: 'Self-hosted on NVIDIA GPUs' }),
		el('div', { class: 'nvl-cards' }, gpu.map(laneCard)),
	);
}

// ── GPU fleet chart ──────────────────────────────────────────────────────────

// Axis steps that read as clock time: 250 ms up to one hour.
const TIME_STEPS_MS = [250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_200_000, 1_800_000, 3_600_000];

export function timeAxis(maxMs, segments = 4) {
	const v = maxMs > 0 ? maxMs : 1000;
	const step = TIME_STEPS_MS.find((s) => s * segments >= v) || Math.ceil(v / segments / 3_600_000) * 3_600_000;
	return { max: step * segments, ticks: Array.from({ length: segments + 1 }, (_, i) => i * step) };
}

function fleetTooltip(row) {
	return `${row.label} on ${row.gpu}${row.region ? ` (${row.region})` : ''}: ${row.done} completed jobs, p50 ${formatMs(row.p50_ms)}, p95 ${formatMs(row.p95_ms)}, last 30 days`;
}

function fleetChart(rows) {
	const { max, ticks } = timeAxis(Math.max(...rows.map((r) => r.p95_ms || r.p50_ms || 0)));
	const families = [...new Set(rows.map((r) => r.gpu_family || r.gpu))];
	const tip = el('div', { class: 'nvl-tip', role: 'status', 'aria-live': 'polite', hidden: true });
	const show = (row, bar) => {
		tip.textContent = fleetTooltip(row);
		tip.hidden = false;
		const host = bar.closest('.nvl-chart').getBoundingClientRect();
		const r = bar.getBoundingClientRect();
		tip.style.left = `${Math.min(r.left - host.left + 8, host.width - 260)}px`;
		tip.style.top = `${r.bottom - host.top + 6}px`;
	};
	const hide = () => { tip.hidden = true; };
	return el('figure', { class: 'nvl-chart' },
		families.length > 1
			? el('div', { class: 'nvl-legend', role: 'list', 'aria-label': 'GPU type' },
				families.map((f) => el('span', { role: 'listitem', class: `nvl-gpu nvl-gpu-${familyClass(f)}` }, el('span', { class: 'nvl-swatch', 'aria-hidden': 'true' }), f)))
			: null,
		el('div', { class: 'nvl-plot' },
			el('div', { class: 'nvl-grid-lines', 'aria-hidden': 'true' },
				ticks.map((t) => el('span', { style: `left:${(t / max) * 100}%` }, el('em', { text: formatMs(t) })))),
			rows.map((row) => {
				const bar = el('button', {
					type: 'button',
					class: `nvl-bar nvl-gpu-${familyClass(row.gpu_family)}`,
					style: `width:${Math.max(1, (row.p50_ms / max) * 100)}%`,
					'aria-label': fleetTooltip(row),
				});
				bar.addEventListener('mouseenter', () => show(row, bar));
				bar.addEventListener('focus', () => show(row, bar));
				bar.addEventListener('mouseleave', hide);
				bar.addEventListener('blur', hide);
				return el('div', { class: 'nvl-row' },
					el('div', { class: 'nvl-row-label' }, el('span', { text: row.label.replace(/ GPU worker$/, '') }), el('small', { text: `${row.gpu_family || row.gpu}, ${row.done} jobs` })),
					el('div', { class: 'nvl-track' },
						bar,
						row.p95_ms ? el('span', { class: 'nvl-p95', style: `left:${(row.p95_ms / max) * 100}%`, title: `p95 ${formatMs(row.p95_ms)}` }) : null,
					),
					el('div', { class: 'nvl-bar-value' }, el('span', { text: formatMs(row.p50_ms) }), el('small', { text: row.p95_ms ? `p95 ${formatMs(row.p95_ms)}` : '' })),
				);
			}),
		),
		tip,
		el('figcaption', { text: 'Bar: median end-to-end job time. Tick: p95. Completed jobs in the last 30 days, attributed to the GPU their worker reported.' }),
	);
}

function fleetToday(stats) {
	const lanes = stats.lanes.filter((l) => l.kind === 'gpu' && l.gpu);
	if (!lanes.length) return null;
	return el('div', { class: 'nvl-today' },
		el('h4', { text: 'Where each worker runs right now' }),
		el('ul', {}, lanes.map((l) => el('li', {},
			el('span', { class: 'nvl-today-lane', text: l.label.replace(/ GPU worker$/, '') }),
			gpuChip(l.gpu),
			el('span', { class: 'nvl-today-name', text: `${l.gpu.name}${l.gpu.region ? `, ${l.gpu.region}` : ''}` }),
		))),
	);
}

function renderFleet(root, stats) {
	const node = root.querySelector('[data-nvl="fleet"]');
	if (!node) return;
	node.removeAttribute('aria-busy');
	const rows = Array.isArray(stats.fleet) ? [...stats.fleet].sort((a, b) => a.label.localeCompare(b.label) || String(a.gpu_family).localeCompare(String(b.gpu_family))) : [];
	node.replaceChildren(
		rows.length
			? fleetChart(rows)
			: el('div', { class: 'nvl-empty' },
				el('strong', { text: 'No GPU-attributed jobs in the last 30 days yet.' }),
				el('p', { text: `Each completed job now records the GPU worker that served it, so this chart fills in as jobs finish. The lane tables below already count every job.` }),
			),
		fleetToday(stats),
	);
}

function renderMethodology(root, stats) {
	const node = root.querySelector('[data-nvl="method"]');
	if (!node) return;
	const m = stats.methodology || {};
	const items = [
		['Probes', m.probes],
		['Cadence', m.cadence],
		['Latency', m.latency],
		['Jobs', m.jobs],
		['GPU split', m.gpu_split],
		['Empty windows', m.empty],
	].filter(([, v]) => v);
	node.replaceChildren(el('dl', { class: 'nvl-method' }, items.map(([k, v]) => el('div', {}, el('dt', { text: k }), el('dd', { text: v })))));
}

// ── Benchmark tables ─────────────────────────────────────────────────────────

function table(caption, head, rows) {
	return el('div', { class: 'table-scroll' },
		el('table', {},
			el('caption', { class: 'nvl-sr', text: caption }),
			el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))),
			el('tbody', {}, rows),
		),
	);
}

function probeRows(stats) {
	return stats.lanes.map((l) => {
		const a = l.probes['7d'];
		const b = l.probes['30d'];
		return el('tr', {},
			el('th', { scope: 'row' }, l.label, el('br'), el('code', { text: l.model || '-' })),
			el('td', {}, statusPill(l.last_probe.status)),
			el('td', { text: l.last_probe.latency_ms != null ? formatMs(l.last_probe.latency_ms) : '-' }),
			el('td', { text: a.count ? `${pct(a.availability_pct)} (${a.ok}/${a.count})` : a.note }),
			el('td', { text: a.count ? `${formatMs(a.p50_ms)} / ${formatMs(a.p95_ms)}` : '-' }),
			el('td', { text: b.count ? `${pct(b.availability_pct)} (${b.ok}/${b.count})` : b.note }),
			el('td', { text: b.count ? `${formatMs(b.p50_ms)} / ${formatMs(b.p95_ms)}` : '-' }),
		);
	});
}

function jobRows(stats) {
	return stats.lanes.filter((l) => l.jobs).map((l) => {
		const cells = ['7d', '30d'].flatMap((w) => {
			const j = l.jobs[w];
			if (!j.done && !j.failed) return [el('td', { colspan: 3, class: 'nvl-muted', text: j.note })];
			return [
				el('td', { text: `${j.done} done, ${j.failed} failed (${pct(j.success_pct)})` }),
				el('td', { text: `${formatMs(j.p50_ms)} / ${formatMs(j.p95_ms)}` }),
				el('td', { text: j.gpu_measured ? `${formatMs(j.gpu_p50_ms)} / ${formatMs(j.gpu_p95_ms)} (${j.gpu_measured})` : '-' }),
			];
		});
		return el('tr', {}, el('th', { scope: 'row' }, l.label, l.gpu ? el('br') : null, gpuChip(l.gpu)), ...cells);
	});
}

function fleetRows(stats) {
	if (!Array.isArray(stats.fleet) || !stats.fleet.length) return [el('tr', {}, el('td', { colspan: 6, class: 'nvl-muted', text: stats.fleet?.note || 'no GPU-attributed jobs yet' }))];
	return stats.fleet.map((r) => el('tr', {},
		el('th', { scope: 'row', text: r.label }),
		el('td', {}, gpuChip({ name: r.gpu, family: r.gpu_family, region: r.region })),
		el('td', { text: dash(r.region) }),
		el('td', { text: String(r.done) }),
		el('td', { text: formatMs(r.p50_ms) }),
		el('td', { text: formatMs(r.p95_ms) }),
	));
}

function renderTables(root, stats) {
	const probes = root.querySelector('[data-nvl="probe-table"]');
	if (probes) probes.replaceChildren(table('Probe results per lane', ['Lane and model', 'Now', 'Last', '7d up', '7d p50 / p95', '30d up', '30d p50 / p95'], probeRows(stats)));
	const jobs = root.querySelector('[data-nvl="job-table"]');
	if (jobs) jobs.replaceChildren(table('Real job telemetry per lane', ['Lane', '7d jobs', '7d p50 / p95', '7d GPU time', '30d jobs', '30d p50 / p95', '30d GPU time'], jobRows(stats)));
	const fleet = root.querySelector('[data-nvl="fleet-table"]');
	if (fleet) fleet.replaceChildren(table('Jobs by GPU', ['Lane', 'GPU', 'Region', 'Jobs (30d)', 'p50', 'p95'], fleetRows(stats)));
	for (const a of root.querySelectorAll('[data-nvl="csv"]')) a.setAttribute('href', CSV_URL);
}

// ── States and loading ───────────────────────────────────────────────────────

function renderError(root, err, retry) {
	const node = root.querySelector('[data-nvl="error"]');
	if (!node) return;
	node.hidden = false;
	node.replaceChildren(
		el('strong', { text: 'Live lane data did not load.' }),
		el('span', { text: ` ${err?.message || 'The stats service did not answer.'} The lanes themselves are unaffected; this only reads their history.` }),
		el('button', { type: 'button', class: 'btn btn-sec nvl-retry', onclick: retry, text: 'Try again' }),
	);
	for (const busy of root.querySelectorAll('[aria-busy="true"]')) busy.setAttribute('aria-busy', 'false');
}

async function fetchStats() {
	const res = await fetch(STATS_URL, { headers: { accept: 'application/json' } });
	if (res.status === 429) throw new Error('Too many requests from this network; wait a minute.');
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.error_description || body?.message || `The stats service answered HTTP ${res.status}.`);
	}
	return res.json();
}

function render(root, stats) {
	const errNode = root.querySelector('[data-nvl="error"]');
	if (errNode) errNode.hidden = true;
	renderSummary(root, stats);
	renderGrid(root, stats);
	renderFleet(root, stats);
	renderTables(root, stats);
	renderMethodology(root, stats);
	root.dataset.loaded = 'true';
}

function mount(root) {
	let lastLoad = 0;
	const load = async () => {
		const retry = root.querySelector('.nvl-retry');
		if (retry) retry.disabled = true;
		try {
			const stats = await fetchStats();
			lastLoad = Date.now();
			render(root, stats);
		} catch (err) {
			console.warn('[nvidia-live]', err?.message);
			renderError(root, err, load);
		}
	};
	load();
	// The API is cached for five minutes; re-read when a returning tab is stale.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible' && lastLoad && Date.now() - lastLoad > REFRESH_MS) load();
	});
}

if (typeof document !== 'undefined') {
	for (const root of document.querySelectorAll('[data-nvl-root]')) mount(root);
}
