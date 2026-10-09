// /mcp-clients: which AI clients use the hosted three.ws MCP servers.
//
// A client of GET /api/ops/mcp-clients, never a gate in front of it: the
// endpoint authorizes on the server (platform admin session). This page owes the
// operator every state: loading skeletons, empty window, populated, signed out,
// not an admin, migration pending and plain failure, each with a way forward.

const el = document.getElementById('mc-content');
const windowSelect = document.getElementById('mc-window');
const refreshBtn = document.getElementById('mc-refresh');
const stamp = document.getElementById('mc-stamp');

// Categorical series for the daily chart and the bars. Six hues that stay
// distinct on the dark surface; the sixth is the neutral "everyone else".
const SERIES = ['#7c5cff', '#2dd4bf', '#f0a93b', '#f472b6', '#38bdf8'];
const OTHER_COLOR = '#94a3b8';
const CHART_CLIENTS = SERIES.length;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 0) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a');
const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : 'n/a');

function colorFor(rank) {
	return rank < CHART_CLIENTS ? SERIES[rank] : OTHER_COLOR;
}

function cell(label, value, note) {
	return `<div class="mc-cell">
		<div class="mc-cell-label">${esc(label)}</div>
		<div class="mc-cell-value">${esc(value)}</div>
		<div class="mc-cell-note">${esc(note || '')}</div>
	</div>`;
}

function totalsSection(d) {
	const t = d.totals;
	return `<section class="mc-section">
		<div class="mc-section-title">Last ${num(d.window_days)} days <span>UTC days, today included</span></div>
		<div class="mc-grid">
			${cell('Distinct clients', num(t.clients), 'By normalized clientInfo.name')}
			${cell('Sessions', num(t.sessions), 'Initialize handshakes')}
			${cell('Tool calls', num(t.calls), 'tools/call across all servers')}
			${cell('Calls with no client', pct(t.unattributed_share), `${num(t.unattributed_calls)} calls from clients that did not echo the session id`)}
		</div>
	</section>`;
}

function clientBars(d) {
	const max = Math.max(1, ...d.clients.map((c) => c.calls));
	const rows = d.clients
		.slice(0, 12)
		.map((c, i) => {
			const unknown = c.client === 'unknown' || c.client === 'other';
			return `<div class="mc-bar-row${unknown ? ' unknown' : ''}">
				<div class="mc-bar-label" title="${esc(c.client)}">${esc(c.client)}</div>
				<div class="mc-bar-track" role="img" aria-label="${esc(c.client)}: ${num(c.calls)} calls, ${num(c.sessions)} sessions">
					<div class="mc-bar-fill" style="width:${((c.calls / max) * 100).toFixed(1)}%;background:${unknown ? OTHER_COLOR : colorFor(i)}"></div>
				</div>
				<div class="mc-bar-count">${num(c.calls)} calls · ${num(c.sessions)} sessions · ${pct(c.share_of_calls)}</div>
			</div>`;
		})
		.join('');
	return `<section class="mc-section">
		<div class="mc-section-title">Calls by client <span>top ${Math.min(12, d.clients.length)} of ${num(d.clients.length)}</span></div>
		<div class="mc-bars">${rows}</div>
	</section>`;
}

function dailyChart(d) {
	const top = d.clients.filter((c) => c.client !== 'unknown' && c.client !== 'other').slice(0, CHART_CLIENTS).map((c) => c.client);
	const days = d.daily.map((day) => {
		const segs = top.map((name) => day.by_client[name] || 0);
		const rest = day.calls - segs.reduce((s, n) => s + n, 0);
		return { day: day.day, calls: day.calls, segs: [...segs, rest] };
	});
	const peak = Math.max(1, ...days.map((x) => x.calls));
	const W = 1000;
	const H = 220;
	const pad = { l: 44, r: 8, t: 8, b: 22 };
	const iw = W - pad.l - pad.r;
	const ih = H - pad.t - pad.b;
	const slot = iw / days.length;
	const bw = Math.max(1, slot * 0.72);
	const y = (v) => pad.t + ih - (v / peak) * ih;
	const grid = [0, 0.5, 1]
		.map((f) => {
			const v = Math.round(peak * f);
			return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"></line><text x="${pad.l - 6}" y="${y(v) + 3}" text-anchor="end">${num(v)}</text>`;
		})
		.join('');
	const cols = days
		.map((x, i) => {
			let acc = 0;
			const rects = x.segs
				.map((n, k) => {
					if (n <= 0) return '';
					const top0 = y(acc + n);
					const h = y(acc) - top0;
					acc += n;
					const fill = k < top.length ? colorFor(k) : OTHER_COLOR;
					return `<rect class="col" x="${(pad.l + i * slot + (slot - bw) / 2).toFixed(2)}" y="${top0.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(h, 0.5).toFixed(2)}" fill="${fill}"></rect>`;
				})
				.join('');
			return `<g class="day"><title>${esc(x.day)}: ${num(x.calls)} calls</title>${rects}</g>`;
		})
		.join('');
	const labelEvery = Math.max(1, Math.ceil(days.length / 8));
	const labels = days
		.map((x, i) => (i % labelEvery === 0 ? `<text x="${(pad.l + i * slot + slot / 2).toFixed(2)}" y="${H - 6}" text-anchor="middle">${esc(x.day.slice(5))}</text>` : ''))
		.join('');
	const legend = [...top.map((name, k) => ({ name, color: colorFor(k) })), { name: 'everyone else', color: OTHER_COLOR }]
		.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`)
		.join('');
	return `<section class="mc-section">
		<div class="mc-section-title">Calls per day <span>stacked by the top ${top.length} clients</span></div>
		<div class="mc-chart">
			<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tool calls per day, stacked by client">${grid}${cols}${labels}</svg>
			<div class="mc-legend">${legend}</div>
		</div>
	</section>`;
}

function chips(list, key) {
	return `<div class="mc-chips">${list.map((x) => `<span class="mc-chip" title="${num(x.sessions)} sessions">${esc(x[key])} ${num(x.calls)}</span>`).join('')}</div>`;
}

function tableSection(d) {
	const body = d.clients
		.map(
			(c) => `<tr>
			<td class="mc-mono">${esc(c.client)}</td>
			<td class="num">${num(c.sessions)}</td>
			<td class="num">${num(c.calls)}</td>
			<td>${chips(c.versions, 'version')}</td>
			<td>${chips(c.surfaces, 'surface')}</td>
			<td>${chips(c.auth_kinds, 'auth_kind')}</td>
			<td>${c.top_tools.length ? `<div class="mc-chips">${c.top_tools.map((t) => `<span class="mc-chip">${esc(t.tool)} ${num(t.calls)}</span>`).join('')}</div>` : '<span class="mc-chip">none</span>'}</td>
		</tr>`,
		)
		.join('');
	return `<section class="mc-section">
		<div class="mc-section-title">Every client <span>versions, servers, auth and top tools by calls</span></div>
		<div class="mc-table-wrap"><table class="mc-table">
			<thead><tr>
				<th scope="col">Client</th><th scope="col" class="num">Sessions</th><th scope="col" class="num">Calls</th>
				<th scope="col">Versions</th><th scope="col">Servers</th><th scope="col">Auth</th><th scope="col">Top tools</th>
			</tr></thead>
			<tbody>${body}</tbody>
		</table></div>
		<p class="mc-detail"><b>Calls with no client</b> come from clients that never echo the
		<code>Mcp-Session-Id</code> header the servers issue on initialize, so their calls cannot be joined to a
		clientInfo. A high figure means the number of clients above is a floor, not a count.</p>
	</section>`;
}

function definitions(d) {
	return `<details class="mc-defs">
		<summary>How these numbers are defined</summary>
		<dl>
			<dt>Client</dt><dd>clientInfo.name from the initialize request, lowercased, trimmed, restricted to letters, digits and <code>._:/@+-</code>, capped at 64 characters.</dd>
			<dt>Session</dt><dd>One initialize. The server issues an <code>Mcp-Session-Id</code> and a conforming client echoes it on later requests, which is how a tool call finds its client.</dd>
			<dt>Auth kind</dt><dd>anonymous, install (a free studio install token), key (an API key), oauth (an OAuth access token) or x402 (a paid call).</dd>
			<dt>other</dt><dd>Each server process admits a bounded number of distinct client and tool names per day and groups the rest, so a hostile initialize loop cannot grow the tables.</dd>
			<dt>Retention</dt><dd>Daily aggregates are kept. Raw session rows expire after ${num(d.raw_retention_days)} days.</dd>
			<dt>Same numbers, no browser</dt><dd><code>GET /api/ops/mcp-clients?days=${num(d.window_days)}</code> with an admin session.</dd>
		</dl>
	</details>`;
}

function render(d) {
	stamp.textContent = d.generated_at ? `read ${new Date(d.generated_at).toLocaleTimeString()}` : '';
	if (d.totals.calls === 0 && d.totals.sessions === 0) {
		el.innerHTML = `<div class="mc-note">
			<h2>No MCP traffic recorded in the last ${num(d.window_days)} days</h2>
			Sessions appear here once a client connects to a hosted server and initializes. Run
			<code>npm run probe:mcp-clients</code> against a local server, or connect any MCP client to
			<code>https://three.ws/api/mcp-studio</code>, then press Refresh. A longer window above may
			also hold earlier traffic.
		</div>`;
		return;
	}
	el.innerHTML = totalsSection(d) + clientBars(d) + dailyChart(d) + tableSection(d) + definitions(d);
}

function skeleton() {
	const cells = Array.from({ length: 4 }, () => '<div class="mc-skeleton cell"></div>').join('');
	const rows = Array.from({ length: 6 }, () => '<div class="mc-skeleton bar"></div>').join('');
	el.innerHTML = `
		<section class="mc-section">
			<div class="mc-section-title">Reading the client ledger</div>
			<div class="mc-grid">${cells}</div>
		</section>
		<section class="mc-section">
			<div class="mc-section-title">Calls by client</div>
			${rows}
		</section>`;
}

function retryNote(kind, title, body) {
	el.innerHTML = `<div class="mc-note${kind === 'bad' ? ' bad' : ''}">
		<h2>${esc(title)}</h2>
		${body}
		<br /><button type="button" id="mc-retry">Try again</button>
	</div>`;
	document.getElementById('mc-retry')?.addEventListener('click', load);
	stamp.textContent = '';
}

function signedOut() {
	retryNote(
		'info',
		'Sign in to read this board',
		`It is internal, so it takes a platform admin session. <a href="/login?next=/mcp-clients">Sign in</a>, then come back.`,
	);
}

function forbidden() {
	retryNote(
		'info',
		'This account is not a platform admin',
		`Client analytics are limited to platform admins. <a href="/login?next=/mcp-clients">Switch account</a>.`,
	);
}

function migrationPending(message) {
	retryNote(
		'bad',
		'The analytics tables are not there yet',
		`<code>${esc(message)}</code><br /><br />Run <code>npm run db:status</code>, then apply the migration.`,
	);
}

function failed(message) {
	retryNote(
		'bad',
		'Could not read client analytics',
		`<code>${esc(message)}</code><br /><br />Check the service is up (<code>/api/healthz</code>) and try again.`,
	);
}

let inFlight = null;

async function load() {
	// A second click while a read is open would race two renders.
	if (inFlight) return;
	refreshBtn.disabled = true;
	refreshBtn.textContent = 'Reading…';
	el.setAttribute('aria-busy', 'true');
	skeleton();
	inFlight = (async () => {
		try {
			const res = await fetch(`/api/ops/mcp-clients?days=${encodeURIComponent(windowSelect.value)}`, {
				credentials: 'include',
				headers: { accept: 'application/json' },
			});
			if (res.status === 401) return signedOut();
			if (res.status === 403) return forbidden();
			if (res.status === 429) return failed(`rate limited, retry in ${res.headers.get('retry-after') || 'a moment'}s`);
			if (res.status === 503) {
				const body = await res.json().catch(() => ({}));
				return migrationPending(body.error_description || 'migration pending');
			}
			if (!res.ok) throw new Error(`status ${res.status}`);
			render(await res.json());
		} catch (err) {
			failed(err?.message || String(err));
		} finally {
			refreshBtn.disabled = false;
			refreshBtn.textContent = 'Refresh';
			el.setAttribute('aria-busy', 'false');
			inFlight = null;
		}
	})();
	await inFlight;
}

windowSelect.addEventListener('change', load);
refreshBtn.addEventListener('click', load);
load();
