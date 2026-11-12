// /mcp-integrations: connect an agent to third-party MCP servers.
//
// Reads the public catalog from /api/mcp-connections/catalog and manages one
// agent's connections through /api/v1/agents/:id/mcp (routes in
// api/_lib/mcp-connections/routes.js). The server owns every safety rule
// (SSRF guard, read-only defaults, acknowledgement before a write tool turns
// on); this page only presents them and asks the owner at the right moments.
// The OAuth callback sends the browser back here with ?mcp_connected=<id> or
// ?mcp_error=<code>.

import { apiFetch } from './api.js';

const $ = (id) => document.getElementById(id);
const TIER_INFO = {
	read: { label: 'Read', hint: 'Looks things up. Cannot change anything in the other service.' },
	write: { label: 'Write', hint: 'Creates or changes data in the other service. Off until you acknowledge it.' },
	financial: { label: 'Financial or irreversible', hint: 'Moves money or cannot be undone. Off until you acknowledge it.' },
};
const STATUS_LABEL = {
	active: 'Connected',
	pending_auth: 'Waiting for sign-in',
	pending_review: 'Needs your review',
	needs_auth: 'Sign-in expired',
	error: 'Error',
	disabled: 'Paused',
};
const NEEDS_OWNER = new Set(['pending_review', 'pending_auth', 'needs_auth', 'error']);
const OAUTH_ERRORS = {
	invalid_state: 'That sign-in link expired or was already used. Start the connection again.',
	wrong_account: 'You finished sign-in while signed in to a different three.ws account. Sign in to the account that started it and try again.',
	denied: 'Sign-in was cancelled at the other service, so nothing was connected.',
	exchange_failed: 'The other service did not accept the sign-in. Try connecting again.',
};
const AUTH_LABEL = { none: 'No sign-in', bearer: 'API token', oauth: 'OAuth' };
const TRANSPORT_LABEL = { 'streamable-http': 'HTTP', sse: 'SSE', stdio: 'Local (stdio)' };
const RETURN_PATH = '/mcp-integrations';

const state = {
	signedIn: null,
	agents: [],
	agentId: '',
	catalog: null,
	categories: [],
	conns: null,
	connsError: null,
	cat: '',
	q: '',
	open: new Set(),
	collapsed: new Set(),
	busy: new Set(),
};

function el(tag, attrs = {}, ...kids) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === false || v == null) continue;
		if (k === 'class') node.className = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else if (k === 'text') node.textContent = v;
		else if (k === 'checked' || k === 'disabled') node[k] = Boolean(v);
		else node.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
	return node;
}

class RequestError extends Error {
	constructor(message, { status = 0, code = null, details = null } = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

async function call(path, { method = 'GET', body, anonymous = false } = {}) {
	let res;
	try {
		res = await apiFetch(path, {
			method,
			allowAnonymous: anonymous,
			headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		throw new RequestError('Could not reach three.ws. Check your connection and try again.');
	}
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const e = data?.error;
		const message = (e && typeof e === 'object' ? e.message : data?.error_description || data?.message || e) || `Request failed (${res.status}).`;
		throw new RequestError(String(message), { status: res.status, code: e?.code || (typeof e === 'string' ? e : null), details: e?.details || null });
	}
	return data;
}

function toast(text, { error = false } = {}) {
	const t = el('div', { class: `mi-toast${error ? ' err' : ''}`, role: error ? 'alert' : 'status' }, text);
	$('toasts').append(t);
	setTimeout(() => t.remove(), error ? 9000 : 5000);
}

const connBase = () => `/api/v1/agents/${encodeURIComponent(state.agentId)}/mcp`;
const loginHref = () => `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
const returnTo = () => `${RETURN_PATH}?agent=${encodeURIComponent(state.agentId)}`;

// Data loading

function skeletonCards(n = 6) {
	return Array.from({ length: n }, () => el('div', { class: 'mi-skel card' }));
}

async function loadCatalog() {
	const grid = $('catalog');
	try {
		const doc = await call('/api/mcp-connections/catalog', { anonymous: true });
		state.catalog = doc.servers || [];
		state.categories = doc.categories || [];
		const hosted = state.catalog.filter((s) => s.runtime === 'hosted').length;
		$('catalog-sub').textContent = `${state.catalog.length} vetted MCP servers. ${hosted} run hosted and connect from here; the rest install on your own machine.`;
		renderCategories();
		renderCatalog();
	} catch (err) {
		grid.replaceChildren(
			el('div', { class: 'mi-empty', role: 'alert' },
				el('strong', { text: 'The catalog did not load.' }),
				err.message,
				el('div', { class: 'mi-acts' }, el('button', { type: 'button', class: 'mi-btn', onclick: () => { grid.replaceChildren(...skeletonCards()); loadCatalog(); } }, 'Retry'))),
		);
	}
}

async function loadAgents() {
	state.connsError = null;
	try {
		const data = await call('/api/agents', { anonymous: true });
		state.signedIn = true;
		state.agents = Array.isArray(data?.agents) ? data.agents : [];
	} catch (err) {
		if (err.status === 401) state.signedIn = false;
		else {
			state.signedIn = null;
			state.connsError = err;
		}
	}
	const wanted = new URLSearchParams(location.search).get('agent');
	let remembered = '';
	try { remembered = localStorage.getItem('mi_agent') || ''; } catch { remembered = ''; }
	const pick = [wanted, remembered].find((id) => id && state.agents.some((a) => a.id === id));
	state.agentId = pick || state.agents[0]?.id || '';
	renderAgentBar();
	if (state.agentId) await loadConnections();
	else renderConnections();
}

async function loadConnections() {
	if (!state.agentId) return renderConnections();
	state.conns = null;
	state.connsError = null;
	renderConnections();
	try {
		const { data } = await call(connBase());
		state.conns = data || [];
	} catch (err) {
		state.connsError = err;
	}
	renderConnections();
	renderCatalog();
}

function replaceConn(conn) {
	const list = state.conns || [];
	const i = list.findIndex((c) => c.id === conn.id);
	if (i >= 0) list[i] = conn;
	else list.push(conn);
	state.conns = list;
	renderConnections();
	renderCatalog();
}

// Agent picker

function renderAgentBar() {
	const select = $('agent-select');
	const addBtn = $('custom-open');
	if (state.signedIn === false) {
		$('agent-bar').replaceChildren(el('a', { class: 'mi-btn primary', href: loginHref() }, 'Sign in to connect'));
		return;
	}
	if (!state.agents.length) {
		select.replaceChildren(el('option', { value: '' }, state.signedIn ? 'No agents yet' : 'Agents unavailable'));
		select.disabled = true;
		addBtn.disabled = true;
		return;
	}
	select.replaceChildren(...state.agents.map((a) => el('option', { value: a.id }, a.name || a.id.slice(0, 8))));
	select.value = state.agentId;
	select.disabled = false;
	addBtn.disabled = false;
}

function selectAgent(id) {
	state.agentId = id;
	state.open.clear();
	try { localStorage.setItem('mi_agent', id); } catch { /* storage blocked: the choice is simply not remembered */ }
	const u = new URL(location.href);
	u.searchParams.set('agent', id);
	history.replaceState(null, '', u);
	loadConnections();
}

// Connections panel

function renderConnections() {
	const box = $('conns');
	if (state.signedIn === false) {
		box.replaceChildren(el('div', { class: 'mi-empty' },
			el('strong', { text: 'Sign in to connect your agents.' }),
			'You can browse the catalog below without an account. Connecting a server needs one of your agents.',
			el('div', { class: 'mi-acts' }, el('a', { class: 'mi-btn primary', href: loginHref() }, 'Sign in'))));
		return;
	}
	if (state.signedIn && !state.agents.length) {
		box.replaceChildren(el('div', { class: 'mi-empty' },
			el('strong', { text: 'You do not have an agent yet.' }),
			'Integrations attach to an agent. Create one first, then come back to connect it.',
			el('div', { class: 'mi-acts' }, el('a', { class: 'mi-btn primary', href: '/create' }, 'Create an agent'))));
		return;
	}
	if (state.connsError) {
		box.replaceChildren(el('div', { class: 'mi-banner err', role: 'alert' },
			el('span', {}, `Connections did not load. ${state.connsError.message}`),
			el('button', { type: 'button', class: 'mi-btn small', onclick: () => (state.agents.length ? loadConnections() : loadAgents()) }, 'Retry')));
		return;
	}
	if (state.conns === null) {
		box.replaceChildren(el('div', { class: 'mi-conns' }, el('div', { class: 'mi-skel line' }), el('div', { class: 'mi-skel line' })));
		return;
	}
	if (!state.conns.length) {
		box.replaceChildren(el('div', { class: 'mi-empty' },
			el('strong', { text: 'Nothing connected yet.' }),
			'Pick a server from the catalog below and press Connect. DeepWiki and the other documentation servers need no sign-in, so they are a good first try.',
			el('div', { class: 'mi-acts' },
				el('button', { type: 'button', class: 'mi-btn', onclick: () => $('catalog-search').focus() }, 'Browse the catalog'),
				el('button', { type: 'button', class: 'mi-btn', onclick: openCustomDialog }, 'Add a custom server by URL'))));
		return;
	}
	box.replaceChildren(el('div', { class: 'mi-conns' }, state.conns.map(renderConn)));
}

function renderConn(conn) {
	const t = conn.tool_counts;
	const details = el('details', { class: 'mi-conn', 'data-id': conn.id });
	// A connection waiting on its owner opens so the fix (review, reconnect, retry) is in view.
	if (state.open.has(conn.id) || (NEEDS_OWNER.has(conn.status) && !state.collapsed.has(conn.id))) details.open = true;
	details.addEventListener('toggle', () => {
		if (details.open) {
			state.open.add(conn.id);
			state.collapsed.delete(conn.id);
		} else {
			state.open.delete(conn.id);
			state.collapsed.add(conn.id);
		}
	});
	const used = conn.last_used_at ? ` · last used ${new Date(conn.last_used_at).toLocaleDateString()}` : '';
	const summary = el('summary', {},
		el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
		el('span', { class: 'title' },
			el('strong', { text: conn.label }),
			el('span', { class: 'meta' }, `${t.enabled} of ${t.total} tools on · ${conn.tool_prefix}*${used}`)),
		el('span', { class: `mi-status ${conn.status}` }, STATUS_LABEL[conn.status] || conn.status));
	details.append(summary, el('div', { class: 'body' }, connBody(conn)));
	return details;
}

function connBody(conn) {
	const out = [];
	const busy = state.busy.has(conn.id);
	if (conn.status === 'needs_auth' || conn.status === 'pending_auth') {
		const entry = catalogEntry(conn.catalog_id);
		const msg = conn.status === 'needs_auth'
			? `The sign-in for ${conn.label} expired or was revoked, so the agent cannot use these tools until you reconnect.`
			: `${conn.label} is added but not signed in yet. Finish sign-in to list its tools.`;
		out.push(el('div', { class: 'mi-banner', role: 'alert' }, el('span', {}, msg),
			el('div', { class: 'mi-acts' },
				conn.auth_type === 'oauth' ? el('button', { type: 'button', class: 'mi-btn small primary', disabled: busy, onclick: () => startOAuth(conn) }, 'Reconnect') : null,
				conn.auth_type === 'bearer' || entry?.auth?.alt === 'bearer' ? el('button', { type: 'button', class: 'mi-btn small', disabled: busy, onclick: () => openTokenDialog(conn, entry) }, 'Paste a token') : null)));
	}
	if (conn.status === 'error' && conn.last_error) {
		out.push(el('div', { class: 'mi-banner err', role: 'alert' }, el('span', {}, conn.last_error),
			el('button', { type: 'button', class: 'mi-btn small', disabled: busy, onclick: () => refresh(conn) }, 'Try again')));
	}
	if (conn.status === 'pending_review') out.push(reviewTable(conn));
	else if (conn.tools.length) {
		for (const tier of ['read', 'write', 'financial']) {
			const tools = conn.tools.filter((x) => x.tier === tier);
			if (!tools.length) continue;
			out.push(el('div', { class: 'mi-tier' },
				el('h3', {}, el('span', { class: `mi-dot ${tier}`, 'aria-hidden': 'true' }), `${TIER_INFO[tier].label} (${tools.length})`),
				el('p', { class: 'hint' }, TIER_INFO[tier].hint),
				el('ul', { class: 'mi-tools' }, tools.map((tool) => toolRow(conn, tool, busy)))));
		}
	} else if (conn.status === 'active') {
		out.push(el('p', { class: 'mi-sub' }, 'This server reported no tools. Refresh after the vendor adds some.'));
	}
	out.push(el('div', { class: 'mi-acts' },
		conn.status !== 'pending_auth' ? el('button', { type: 'button', class: 'mi-btn small', disabled: busy, onclick: () => refresh(conn) }, 'Refresh tools') : null,
		conn.status === 'active' || conn.status === 'disabled'
			? el('button', { type: 'button', class: 'mi-btn small', disabled: busy, onclick: () => patch(conn, { disabled: conn.status !== 'disabled' }, conn.status === 'disabled' ? 'Resumed.' : 'Paused. The agent will not see these tools.') }, conn.status === 'disabled' ? 'Resume' : 'Pause')
			: null,
		el('button', { type: 'button', class: 'mi-btn small danger', disabled: busy, onclick: () => confirmRemove(conn) }, 'Remove')));
	return out;
}

function toolRow(conn, tool, busy) {
	const id = `t-${conn.id}-${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
	const input = el('input', { type: 'checkbox', id, checked: tool.enabled, disabled: busy || conn.status === 'disabled', role: 'switch' });
	input.addEventListener('change', () => toggleTool(conn, tool, input.checked, input));
	return el('li', { class: 'mi-tool' },
		el('span', { class: 't' },
			el('label', { for: id }, el('code', { text: `${conn.tool_prefix}${tool.name}` })),
			tool.description ? el('p', { text: tool.description }) : null),
		el('label', { class: 'mi-switch' }, input, el('span', { class: 'mi-track', 'aria-hidden': 'true' })));
}

function reviewTable(conn) {
	const rows = conn.tools.map((tool) => el('tr', {},
		el('td', {}, el('code', { text: tool.name })),
		el('td', {}, el('span', { class: `mi-dot ${tool.tier}`, 'aria-hidden': 'true' }), ` ${TIER_INFO[tool.tier]?.label || tool.tier}`),
		el('td', { class: 'd' }, tool.description || 'No description given.')));
	return el('div', { class: 'mi-tier' },
		el('div', { class: 'mi-banner' }, el('span', {}, `Custom server at ${conn.server_url}. Read what each tool says it does before approving. Approving makes the server usable; every tool still starts off, and write or financial ones need an acknowledgement.`)),
		conn.tools.length
			? el('div', { class: 'mi-review-wrap' }, el('table', { class: 'mi-review' },
				el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Tool'), el('th', { scope: 'col' }, 'Tier'), el('th', { scope: 'col' }, 'What it says it does'))),
				el('tbody', {}, rows)))
			: el('p', { class: 'mi-sub' }, 'This server listed no tools.'),
		el('div', { class: 'mi-acts' }, el('button', { type: 'button', class: 'mi-btn small primary', disabled: state.busy.has(conn.id), onclick: () => patch(conn, { reviewed: true }, 'Approved. Turn on the tools you want the agent to use.') }, 'Approve server')));
}

// Connection actions

async function withBusy(conn, fn) {
	state.busy.add(conn.id);
	renderConnections();
	try {
		return await fn();
	} finally {
		state.busy.delete(conn.id);
		renderConnections();
	}
}

async function patch(conn, body, done) {
	await withBusy(conn, async () => {
		try {
			const { data } = await call(`${connBase()}/${conn.id}`, { method: 'PATCH', body });
			replaceConn(data);
			if (done) toast(done);
		} catch (err) {
			toast(err.message, { error: true });
		}
	});
}

async function toggleTool(conn, tool, on, input) {
	const enabled = new Set(conn.tools.filter((x) => x.enabled).map((x) => x.name));
	if (on) enabled.add(tool.name);
	else enabled.delete(tool.name);
	const body = { enabled_tools: [...enabled] };
	if (on && tool.tier !== 'read' && !tool.acknowledged) {
		const ok = await confirmDialog({
			title: `Turn on ${tool.name}?`,
			text: tool.tier === 'financial'
				? `This tool can move money or do something that cannot be undone in ${conn.label}. Your agent will be able to call it whenever it decides to. Only turn it on if you trust this agent with that.`
				: `This tool can create or change data in ${conn.label}. Your agent will be able to call it whenever it decides to.`,
			detail: tool.description,
			ok: 'Turn on',
			danger: tool.tier === 'financial',
		});
		if (!ok) {
			input.checked = false;
			return;
		}
		body.acknowledge = [tool.name];
	}
	await patch(conn, body, null);
}

async function refresh(conn) {
	await withBusy(conn, async () => {
		try {
			const { data } = await call(`${connBase()}/${conn.id}/refresh`, { method: 'POST', body: {} });
			replaceConn(data);
			toast(`${data.label}: ${data.tool_counts.total} tools listed.`);
		} catch (err) {
			toast(err.message, { error: true });
		}
	});
}

async function confirmRemove(conn) {
	const ok = await confirmDialog({
		title: `Remove ${conn.label}?`,
		text: 'The agent loses these tools at once and the stored sign-in or token is deleted. You can connect it again later.',
		ok: 'Remove',
		danger: true,
	});
	if (!ok) return;
	await withBusy(conn, async () => {
		try {
			await call(`${connBase()}/${conn.id}`, { method: 'DELETE' });
			state.conns = (state.conns || []).filter((c) => c.id !== conn.id);
			toast(`${conn.label} removed.`);
			renderCatalog();
		} catch (err) {
			toast(err.message, { error: true });
		}
	});
}

async function beginAuth(conn) {
	const { data } = await call(`${connBase()}/${conn.id}/auth`, { method: 'POST', body: { return_to: returnTo() } });
	if (data.authorization_url) {
		location.assign(data.authorization_url);
		return true;
	}
	if (data.connection) replaceConn(data.connection);
	return false;
}

async function startOAuth(conn) {
	await withBusy(conn, async () => {
		try {
			if (!(await beginAuth(conn))) toast(`${conn.label} is connected.`);
		} catch (err) {
			toast(err.message, { error: true });
		}
	});
}

// Dialogs

function showDialog(title, build) {
	const dialog = $('dialog');
	$('dialog-title').textContent = title;
	const body = $('dialog-body');
	body.replaceChildren(...build(() => dialog.close()).filter(Boolean));
	if (!dialog.open) dialog.showModal();
	body.querySelector('input, select, button.primary, button')?.focus();
	return dialog;
}

function confirmDialog({ title, text, detail, ok, danger }) {
	return new Promise((resolve) => {
		let answered = false;
		const dialog = showDialog(title, (close) => [
			el('p', {}, text),
			detail ? el('p', {}, el('em', {}, detail)) : null,
			el('div', { class: 'acts' },
				el('button', { type: 'button', class: 'mi-btn', onclick: () => close() }, 'Cancel'),
				el('button', { type: 'button', class: `mi-btn ${danger ? 'danger' : 'primary'}`, onclick: () => { answered = true; close(); } }, ok)),
		]);
		dialog.addEventListener('close', () => resolve(answered), { once: true });
	});
}

function requireAgent() {
	if (state.signedIn === false) {
		location.assign(loginHref());
		return false;
	}
	if (!state.agentId) {
		toast('Create an agent first, then connect it.', { error: true });
		return false;
	}
	return true;
}

function dialogError(form, err) {
	form.querySelector('.derr')?.remove();
	form.append(el('p', { class: 'derr', role: 'alert' }, err.message));
}

function submitting(form, on, label) {
	for (const b of form.querySelectorAll('button')) b.disabled = on;
	const primary = form.querySelector('button.primary');
	if (primary) {
		primary.dataset.label ||= primary.textContent;
		primary.textContent = on ? label : primary.dataset.label;
	}
}

function openConnectDialog(entry) {
	if (!requireAgent()) return;
	const agentName = state.agents.find((a) => a.id === state.agentId)?.name || 'this agent';
	const auth = entry.auth || {};
	const tokenAllowed = auth.type === 'bearer' || auth.alt === 'bearer';
	const tokenOptional = auth.type === 'bearer' && auth.optional;
	const oauthReady = auth.type === 'oauth' && entry.oauthAvailable;
	showDialog(`Connect ${entry.name}`, (close) => {
		const form = el('form', { novalidate: true });
		const tokenInput = tokenAllowed ? el('input', { class: 'mi-input', type: 'password', name: 'token', autocomplete: 'off', placeholder: tokenOptional ? 'Optional' : 'Paste the token', spellcheck: 'false' }) : null;
		const intro = auth.type === 'oauth'
			? `You will sign in at ${entry.vendor || entry.name} and approve access for ${agentName}. The token is stored encrypted and never shown again.`
			: auth.type === 'none'
				? `${entry.name} needs no sign-in. Its read tools turn on for ${agentName} right away.`
				: `${entry.name} uses an access token. It is stored encrypted and never shown again.`;
		form.append(el('p', {}, intro));
		if (entry.description) form.append(el('p', {}, entry.description));
		if (auth.type === 'oauth' && !entry.oauthAvailable) {
			form.append(el('p', {}, `Sign-in with ${entry.name} is not set up on this deployment yet${tokenAllowed ? ', so use an access token instead.' : '.'}`));
		}
		const oauthBtn = oauthReady ? el('button', { type: 'submit', class: 'mi-btn primary', value: 'oauth' }, `Sign in with ${entry.vendor || entry.name}`) : null;
		if (oauthBtn && tokenAllowed) form.append(el('div', { class: 'acts' }, oauthBtn), el('p', { class: 'or' }, 'or use an access token'));
		if (tokenInput) form.append(el('label', {}, auth.tokenHelp || 'Access token', tokenInput));
		const connectBtn = !oauthBtn || tokenAllowed
			? el('button', { type: 'submit', class: `mi-btn${oauthBtn ? '' : ' primary'}`, value: 'token', disabled: auth.type === 'oauth' && !entry.oauthAvailable && !tokenAllowed }, tokenInput ? 'Connect with token' : 'Connect')
			: null;
		form.append(el('div', { class: 'acts' },
			el('button', { type: 'button', class: 'mi-btn', onclick: () => close() }, 'Cancel'),
			oauthBtn && !tokenAllowed ? oauthBtn : null,
			connectBtn));
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const viaOAuth = ev.submitter?.value === 'oauth';
			const token = tokenInput?.value.trim() || '';
			if (!viaOAuth && tokenInput && !token && !tokenOptional) {
				dialogError(form, new Error(oauthReady ? 'Paste the access token, or use sign-in.' : 'Paste the access token.'));
				tokenInput.focus();
				return;
			}
			submitting(form, true, 'Connecting');
			try {
				const body = { catalog_id: entry.id };
				if (!viaOAuth && token) body.bearer_token = token;
				const { data: conn } = await call(connBase(), { method: 'POST', body });
				state.open.add(conn.id);
				replaceConn(conn);
				if (conn.status === 'pending_auth' && conn.auth_type === 'oauth' && (await beginAuth(conn))) return;
				close();
				const latest = state.conns.find((c) => c.id === conn.id) || conn;
				toast(latest.status === 'active' ? `${latest.label} connected with ${latest.tool_counts.enabled} tools on.` : `${latest.label} added.`);
				focusConn(conn.id);
			} catch (err) {
				submitting(form, false);
				dialogError(form, err);
			}
		});
		return [form];
	});
}

function openTokenDialog(conn, entry) {
	showDialog(`Access token for ${conn.label}`, (close) => {
		const input = el('input', { class: 'mi-input', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste the token' });
		const form = el('form', { novalidate: true },
			el('label', {}, entry?.auth?.tokenHelp || 'Access token', input),
			el('div', { class: 'acts' },
				el('button', { type: 'button', class: 'mi-btn', onclick: () => close() }, 'Cancel'),
				el('button', { type: 'submit', class: 'mi-btn primary' }, 'Save token')));
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			if (!input.value.trim()) return dialogError(form, new Error('Paste the token first.'));
			submitting(form, true, 'Checking');
			try {
				const { data } = await call(`${connBase()}/${conn.id}/auth`, { method: 'POST', body: { bearer_token: input.value.trim() } });
				replaceConn(data.connection);
				close();
				toast(`${conn.label} connected.`);
			} catch (err) {
				submitting(form, false);
				dialogError(form, err);
			}
		});
		return [form];
	});
}

function openCustomDialog() {
	if (!requireAgent()) return;
	showDialog('Add a custom MCP server', (close) => {
		const url = el('input', { class: 'mi-input', type: 'url', required: true, placeholder: 'https://mcp.example.com/mcp', autocomplete: 'off', spellcheck: 'false' });
		const label = el('input', { class: 'mi-input', type: 'text', maxlength: '80', placeholder: 'Optional, e.g. Team wiki' });
		const transport = el('select', { class: 'mi-input' }, el('option', { value: 'streamable-http' }, 'Streamable HTTP (most servers)'), el('option', { value: 'sse' }, 'SSE (older servers)'));
		const token = el('input', { class: 'mi-input', type: 'password', autocomplete: 'off', placeholder: 'Only if the server needs one' });
		const form = el('form', { novalidate: true },
			el('p', {}, 'Any public HTTPS MCP server. three.ws lists its tools first; nothing turns on until you review them. Private network addresses are refused.'),
			el('label', {}, 'Server URL', url),
			el('label', {}, 'Name', label),
			el('label', {}, 'Transport', transport),
			el('label', {}, 'Access token', token),
			el('div', { class: 'acts' },
				el('button', { type: 'button', class: 'mi-btn', onclick: () => close() }, 'Cancel'),
				el('button', { type: 'submit', class: 'mi-btn primary' }, 'List its tools')));
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const value = url.value.trim();
			if (!/^https:\/\/\S+$/i.test(value)) {
				dialogError(form, new Error('Enter the full https:// address of the server.'));
				url.focus();
				return;
			}
			submitting(form, true, 'Contacting server');
			try {
				const body = { server_url: value, transport: transport.value };
				if (label.value.trim()) body.label = label.value.trim();
				if (token.value.trim()) body.bearer_token = token.value.trim();
				const { data: conn } = await call(connBase(), { method: 'POST', body });
				state.open.add(conn.id);
				replaceConn(conn);
				if (conn.status === 'pending_auth' && conn.auth_type === 'oauth' && (await beginAuth(conn))) return;
				close();
				toast(conn.status === 'pending_review' ? 'Tools listed. Review them below.' : `${conn.label} added.`);
				focusConn(conn.id);
			} catch (err) {
				submitting(form, false);
				dialogError(form, err);
			}
		});
		return [form];
	});
}

// Catalog

const catalogEntry = (id) => (id && state.catalog ? state.catalog.find((s) => s.id === id) : null);

function renderCategories() {
	const counts = new Map();
	for (const s of state.catalog) counts.set(s.category, (counts.get(s.category) || 0) + 1);
	const chips = [{ id: '', label: 'All', n: state.catalog.length }, ...state.categories.filter((c) => counts.has(c.id)).map((c) => ({ ...c, n: counts.get(c.id) }))];
	$('catalog-cats').replaceChildren(...chips.map((c) => el('button', {
		type: 'button',
		class: 'mi-chip',
		'aria-pressed': String(state.cat === c.id),
		onclick: () => { state.cat = c.id; renderCategories(); renderCatalog(); },
	}, c.label || c.id, el('small', {}, String(c.n)))));
}

function matches(s) {
	if (state.cat && s.category !== state.cat) return false;
	if (!state.q) return true;
	const hay = `${s.id} ${s.name} ${s.vendor || ''} ${s.description || ''} ${s.category}`.toLowerCase();
	return state.q.split(/\s+/).every((w) => hay.includes(w));
}

function renderCatalog() {
	if (!state.catalog) return;
	const grid = $('catalog');
	const connected = new Map((state.conns || []).filter((c) => c.catalog_id).map((c) => [c.catalog_id, c]));
	const list = state.catalog.filter(matches);
	if (!list.length) {
		grid.replaceChildren(el('div', { class: 'mi-empty' },
			el('strong', { text: 'No servers match. Add a custom server by URL.' }),
			'Try another word, clear the category, or connect any public MCP server directly.',
			el('div', { class: 'mi-acts' },
				el('button', { type: 'button', class: 'mi-btn', onclick: () => { state.q = ''; state.cat = ''; $('catalog-search').value = ''; renderCategories(); renderCatalog(); } }, 'Clear filters'),
				el('button', { type: 'button', class: 'mi-btn primary', onclick: openCustomDialog }, 'Add by URL'))));
		return;
	}
	grid.replaceChildren(...list.map((s) => serverCard(s, connected.get(s.id))));
}

function serverCard(s, conn) {
	const local = s.runtime === 'local';
	const auth = s.auth || { type: 'none' };
	const badges = [
		s.official ? el('span', { class: 'mi-badge ok' }, 'Official') : null,
		el('span', { class: 'mi-badge' }, TRANSPORT_LABEL[s.transport] || s.transport),
		el('span', { class: 'mi-badge' }, auth.type === 'bearer' && auth.optional ? 'Token optional' : AUTH_LABEL[auth.type] || auth.type),
		s.toolCount ? el('span', { class: 'mi-badge' }, `${s.toolCount} tools`) : null,
		conn ? el('span', { class: 'mi-badge on' }, STATUS_LABEL[conn.status] || 'Connected') : null,
	];
	let action;
	if (local) action = s.docs ? el('a', { class: 'mi-btn small', href: s.docs, target: '_blank', rel: 'noopener' }, 'Install locally') : null;
	else if (conn) action = el('button', { type: 'button', class: 'mi-btn small', onclick: () => focusConn(conn.id) }, 'Manage');
	else action = el('button', { type: 'button', class: 'mi-btn small primary', disabled: !s.connectable, title: s.connectable ? null : 'Sign-in for this server is not set up on this deployment yet', onclick: () => openConnectDialog(s) }, 'Connect');
	return el('article', { class: 'mi-srv' },
		el('div', {}, el('h3', { text: s.name }), el('span', { class: 'vendor' }, s.vendor || '')),
		el('p', { text: local ? `${s.description || ''} Runs on your own machine through your MCP client, not on three.ws.` : s.description || '' }),
		el('div', { class: 'mi-badges' }, badges),
		el('div', { class: 'row' }, action, s.docs && !local ? el('a', { class: 'mi-link', href: s.docs, target: '_blank', rel: 'noopener' }, 'Docs') : null));
}

function focusConn(id) {
	state.open.add(id);
	renderConnections();
	const node = document.querySelector(`.mi-conn[data-id="${CSS.escape(id)}"]`);
	node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	node?.querySelector('summary')?.focus({ preventScroll: true });
}

// OAuth return

function handleReturn() {
	const u = new URL(location.href);
	const connected = u.searchParams.get('mcp_connected');
	const error = u.searchParams.get('mcp_error');
	if (!connected && !error) return;
	const flash = $('flash');
	if (connected) {
		state.open.add(connected);
		flash.replaceChildren(el('div', { class: 'mi-banner ok', role: 'status' }, el('span', {}, 'Signed in. The server is connected and its read tools are on.')));
	} else {
		flash.replaceChildren(el('div', { class: 'mi-banner err', role: 'alert' }, el('span', {}, OAUTH_ERRORS[error] || 'Sign-in did not complete. Try connecting again.')));
	}
	for (const k of ['mcp_connected', 'mcp_error', 'mcp_connection']) u.searchParams.delete(k);
	history.replaceState(null, '', u);
}

// Boot

let searchTimer = 0;
$('catalog-search').addEventListener('input', (ev) => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		state.q = ev.target.value.trim().toLowerCase();
		renderCatalog();
	}, 120);
});
$('agent-select').addEventListener('change', (ev) => selectAgent(ev.target.value));
$('custom-open').addEventListener('click', openCustomDialog);
document.addEventListener('keydown', (ev) => {
	if (ev.key === '/' && document.activeElement === document.body) {
		ev.preventDefault();
		$('catalog-search').focus();
	}
});

handleReturn();
loadCatalog();
loadAgents();
