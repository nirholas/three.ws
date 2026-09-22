// Editors: put three.ws in every coding client on this machine in one click.
// The app writes each client's own MCP config (src/main/editors.js) with no
// credential in it; each client signs in the first time it uses a tool, on a
// three.ws consent screen that names it.

import { html, mount, onAction, errorState, skeletonLines } from '../lib/dom.js';

const LOGO = {
	'claude-code': ['CC', 22],
	'claude-desktop': ['CD', 22],
	cursor: ['Cu', 220],
	windsurf: ['Ws', 170],
	vscode: ['VS', 205],
	gemini: ['Ge', 260],
	codex: ['Cx', 140],
};

export function editorRow(e, busyId) {
	const [mark, hue] = LOGO[e.id] || [e.name.slice(0, 2), 200];
	const full = e.configured.length === e.total;
	const status = e.error
		? html`<span class="chip chip-bad">Config unreadable</span>`
		: full ? html`<span class="chip chip-ok">Connected</span>`
		: e.configured.length ? html`<span class="chip chip-warn">${e.configured.length} of ${e.total} servers</span>`
		: e.installed ? html`<span class="chip">Not connected</span>`
		: html`<span class="chip chip-plain">Not found</span>`;
	const busy = busyId === e.id;
	return html`<div class="editor">
		<span class="editor-logo" style="background:hsl(${hue} 60% 42%)" aria-hidden="true">${mark}</span>
		<div class="meta">
			<b>${e.name}</b> ${status}
			<div class="path" title="${e.configPath}">${e.configPath}</div>
			${e.error ? html`<div class="err">${e.error}</div>` : ''}
		</div>
		${e.configured.length ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="disconnect" data-id="${e.id}" ${busy ? 'disabled' : ''}>Remove</button>` : ''}
		<button type="button" class="btn btn-sm ${full ? '' : 'btn-primary'}" data-action="connect" data-id="${e.id}" ${busy || e.error ? 'disabled' : ''}>${busy ? 'Working' : full ? 'Reconnect' : 'Connect'}</button>
	</div>`;
}

export function mountEditors(root, ctx) {
	const { bridge, toast } = ctx;
	let phase = 'loading';
	let error = null;
	let editors = [];
	let servers = [];
	let busyId = null;
	let done = null;

	function body() {
		if (phase === 'loading') return html`<div class="card">${skeletonLines(7)}</div>`;
		if (phase === 'error') return errorState(error, { title: 'Clients could not be checked' });
		const installed = editors.filter((e) => e.installed && !e.error && e.configured.length < e.total);
		const shown = [...editors].sort((a, b) => Number(b.installed) - Number(a.installed));
		return html`${done ? html`<div class="banner" role="status"><span class="ico ico-check" aria-hidden="true" style="color:var(--green)"></span><div>${done}</div></div>` : ''}
			<div class="card" style="padding:0">${shown.map((e) => editorRow(e, busyId))}</div>
			<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
				<button type="button" class="btn btn-primary" data-action="connect-all" ${installed.length && !busyId ? '' : 'disabled'}>Connect all detected${installed.length ? ` (${installed.length})` : ''}</button>
				<span style="color:var(--dim);font-size:12.5px">A client not found here can still be connected: Connect creates its config.</span>
			</div>
			<h2>What gets added</h2>
			<div class="servers">${servers.map((s) => html`<div class="server"><b>${s.name}</b> ${s.auth === 'none' ? html`<span class="chip chip-plain">No sign-in</span>` : ''}<p>${s.about}</p><code title="${s.url}">${s.url}</code></div>`)}</div>
			<p style="color:var(--muted);font-size:12.5px;margin-top:14px">No key or token is written to any config. Each client asks you to approve it on three.ws the first time it calls a tool, and you can revoke any of them from your connections page. The first edit of each file keeps a backup next to it (<span class="mono">.three-ws.bak</span>).</p>`;
	}

	function render() {
		mount(root, html`<div class="view">
			<header class="head">
				<div><h1>Connect your editor</h1><p>Give Claude, Cursor and every other coding client your three.ws tools.</p></div>
				<div class="head-actions">
					<button type="button" class="btn btn-ghost" data-action="retry" aria-label="Check again"><span class="ico ico-refresh" aria-hidden="true"></span>Check again</button>
					<button type="button" class="btn btn-ghost" data-action="docs">MCP docs</button>
				</div>
			</header>
			${body()}
		</div>`);
	}

	async function load() {
		phase = 'loading';
		render();
		try {
			const [list, info] = await Promise.all([bridge.editors.detect(), bridge.app.info()]);
			editors = list;
			servers = info.mcpServers;
			phase = 'ready';
		} catch (err) {
			phase = 'error';
			error = err;
		}
		render();
	}

	async function connect(id) {
		busyId = id;
		render();
		const e = editors.find((x) => x.id === id);
		try {
			const res = await bridge.editors.connect(id);
			done = `${res.name} now has ${res.added.length} three.ws servers${res.via ? ` (added with ${res.via})` : ''}. Restart ${res.name} to load them; the first tool call asks you to approve it on three.ws.`;
		} catch (err) {
			toast(`${e?.name || id}: ${err.message}`, 'bad');
		}
		busyId = null;
		editors = await bridge.editors.detect().catch(() => editors);
		render();
	}

	const offActions = onAction(root, {
		retry: load,
		docs: () => bridge.app.openExternal('/docs/mcp'),
		connect: (el) => connect(el.dataset.id),
		'connect-all': async () => {
			const targets = editors.filter((e) => e.installed && !e.error && e.configured.length < e.total).map((e) => e.id);
			for (const id of targets) await connect(id);
			done = `Connected ${targets.length} client${targets.length === 1 ? '' : 's'}. Restart each one to load the servers.`;
			render();
		},
		disconnect: async (el) => {
			busyId = el.dataset.id;
			render();
			try {
				const res = await bridge.editors.disconnect(el.dataset.id);
				done = `Removed ${res.removed.length} three.ws server${res.removed.length === 1 ? '' : 's'} from ${res.name}.`;
			} catch (err) {
				toast(err.message, 'bad');
			}
			busyId = null;
			editors = await bridge.editors.detect().catch(() => editors);
			render();
		},
	});

	load();
	return offActions;
}
