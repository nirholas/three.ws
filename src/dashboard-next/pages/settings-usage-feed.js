// Settings panel: Connect to Power BI or Excel (the OData usage feed).
//
//   GET    /api/usage/feed-keys            { keys, teams, feed_url, max_keys }
//   POST   /api/usage/feed-keys            { name, team_id? } -> { key, token }
//   DELETE /api/usage/feed-keys?id=<uuid>  revoke
//
// The feed itself is api/odata/v1.js. A key is a read-only password for HTTP
// Basic: Power BI and Excel store it with the data source, so scheduled refresh
// works without a gateway. The token is shown once, right after creation.
// Docs: docs/usage-odata.md.

import { esc, get, post, del, relTime } from '../api.js';
import { emptyStateHTML, errorStateHTML, attachRetry } from '../../shared/state-kit.js';
import { toast } from '../../shared/toast.js';

const ID = 'usage-feed';
const DOCS = 'https://github.com/nirholas/three.ws/blob/main/docs/usage-odata.md';

function injectStyles() {
	if (document.getElementById('set-feed-css')) return;
	const s = document.createElement('style');
	s.id = 'set-feed-css';
	s.textContent = `
		.feed-url{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap;margin-bottom:16px}
		.feed-code{flex:1 1 260px;min-width:0;padding:9px 12px;border-radius:8px;border:1px solid var(--nxt-stroke-strong);
			background:rgba(255,255,255,.03);font:12.5px/1.5 var(--nxt-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
			color:var(--nxt-ink);overflow-x:auto;white-space:nowrap;user-select:all}
		.feed-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:4px 0 16px}
		.feed-field{display:grid;gap:4px;flex:1 1 180px;min-width:0}
		.feed-field span{font-size:12px;color:var(--nxt-ink-fade)}
		.feed-input{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--nxt-stroke-strong);
			background:rgba(255,255,255,.04);color:var(--nxt-ink);font:inherit;font-size:13px;
			transition:border-color .16s ease,box-shadow .16s ease}
		.feed-input:hover{border-color:var(--nxt-accent)}
		.feed-input:focus-visible{outline:none;border-color:var(--nxt-accent);box-shadow:0 0 0 3px var(--nxt-accent-soft)}
		.feed-new{margin:0 0 16px;padding:14px;border-radius:10px;border:1px solid var(--nxt-accent);background:var(--nxt-accent-soft)}
		.feed-new-title{font-size:13.5px;font-weight:600;margin-bottom:4px}
		.feed-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--nxt-stroke)}
		.feed-row:last-child{border-bottom:0}
		.feed-row-meta{flex:1 1 220px;min-width:0}
		.feed-row-name{font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
		.feed-row-facts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px;font-size:12px;color:var(--nxt-ink-fade)}
		.feed-steps{margin-top:16px;display:grid;gap:8px}
		.feed-steps details{border:1px solid var(--nxt-stroke);border-radius:10px;padding:0 14px;transition:border-color .16s ease}
		.feed-steps details:hover,.feed-steps details[open]{border-color:var(--nxt-stroke-strong)}
		.feed-steps summary{cursor:pointer;padding:11px 0;font-size:13.5px;font-weight:500;border-radius:6px;list-style-position:inside}
		.feed-steps summary:focus-visible{outline:none;box-shadow:0 0 0 3px var(--nxt-accent-soft)}
		.feed-steps ol{margin:0 0 12px;padding-left:20px;font-size:13px;line-height:1.6;color:var(--nxt-ink-dim)}
		.feed-steps code{font-family:var(--nxt-mono, ui-monospace, monospace);font-size:12px;color:var(--nxt-ink)}
		.feed-link{color:var(--nxt-accent);text-decoration:underline;text-underline-offset:2px;border-radius:4px}
		.feed-link:hover{text-decoration-thickness:2px}
		.feed-link:focus-visible{outline:none;box-shadow:0 0 0 3px var(--nxt-accent-soft)}
		.dn-btn:focus-visible{outline:none;box-shadow:0 0 0 3px var(--nxt-accent-soft)}
		.dn-btn[disabled]{opacity:.55;cursor:progress}
	`;
	document.head.appendChild(s);
}

function shell() {
	injectStyles();
	const panel = document.createElement('div');
	panel.className = 'dn-panel';
	panel.id = ID;
	panel.setAttribute('aria-label', 'Connect to Power BI or Excel');
	panel.innerHTML = `
		<div style="margin-bottom:14px">
			<div class="dn-panel-title">Connect to Power BI or Excel</div>
			<div class="dn-panel-sub" style="margin:2px 0 0">Analyze your usage (MCP tool calls, LLM tokens and cost, Forge generations, billing) in Power BI or Excel through a read-only OData feed that refreshes on a schedule.</div>
		</div>
		<div data-slot="body"></div>`;
	return panel;
}

export function renderUsageFeed(resp, onRetry) {
	const panel = shell();
	const body = panel.querySelector('[data-slot="body"]');
	if (!resp.ok) {
		body.innerHTML = errorStateHTML({ title: "Couldn't load feed keys", body: 'The usage feed service did not answer. Check your connection and try again.' });
		attachRetry(body, onRetry);
		return panel;
	}
	paint(body, resp.data, null, onRetry);
	return panel;
}

async function refresh(body, created, onRetry) {
	try {
		paint(body, await get('/api/usage/feed-keys'), created, onRetry);
	} catch {
		body.innerHTML = errorStateHTML({ title: "Couldn't reload feed keys", body: 'Your change was sent, but the list could not be refreshed. Try again.' });
		attachRetry(body, onRetry);
	}
}

async function copy(text, what) {
	try {
		await navigator.clipboard.writeText(text);
		toast(`${what} copied`, { variant: 'success' });
	} catch {
		toast(`Select the ${what.toLowerCase()} and copy it with Ctrl+C`, { variant: 'error' });
	}
}

function keyRow(k) {
	return `
		<div class="feed-row">
			<div class="feed-row-meta">
				<div class="feed-row-name">${esc(k.name)}</div>
				<div class="feed-row-facts">
					<span class="dn-tag">${k.team_id ? `Team: ${esc(k.team_name || 'team')}` : 'Personal'}</span>
					<code style="font-family:var(--nxt-mono, ui-monospace, monospace)">${esc(k.prefix)}…</code>
					<span>Created ${esc(relTime(k.created_at))}</span>
					<span>${k.last_used_at ? `Last refresh ${esc(relTime(k.last_used_at))}` : 'Not used yet'}</span>
				</div>
			</div>
			<button type="button" class="dn-btn danger" data-revoke="${esc(k.id)}" aria-label="Revoke key ${esc(k.name)}">Revoke</button>
		</div>`;
}

function steps(feedUrl) {
	const url = `<code>${esc(feedUrl)}</code>`;
	return `
		<div class="feed-steps">
			<details>
				<summary>Power BI Desktop</summary>
				<ol>
					<li>Home, Get data, More, OData feed.</li>
					<li>Paste ${url} and choose OK.</li>
					<li>Choose Basic. User name: anything (for example <code>powerbi</code>). Password: your feed key.</li>
					<li>Pick the tables (UsageDaily, McpToolCalls, LlmUsage, Generations, Billing) and choose Load.</li>
				</ol>
			</details>
			<details>
				<summary>Power BI Service scheduled refresh</summary>
				<ol>
					<li>Publish the report from Power BI Desktop to a workspace.</li>
					<li>In the workspace, open the semantic model's Settings, Data source credentials, Edit credentials.</li>
					<li>Authentication method Basic, the same user name and feed key, privacy level Organizational. No gateway is needed.</li>
					<li>Turn on Refresh, set a schedule (up to 8 times a day on Pro), and apply.</li>
				</ol>
			</details>
			<details>
				<summary>Excel</summary>
				<ol>
					<li>Data, Get Data, From Other Sources, From OData Feed.</li>
					<li>Paste ${url}, choose Basic, and enter any user name and your feed key.</li>
					<li>Select the tables and Load. Data, Refresh All pulls new usage at any time.</li>
				</ol>
			</details>
			<div class="dn-panel-sub" style="margin:4px 0 0">A ready-made Power Query script with typed columns, and a starter report layout, are in the <a class="feed-link" href="${DOCS}" target="_blank" rel="noopener">usage feed guide</a>.</div>
		</div>`;
}

function paint(body, data, created, onRetry) {
	const keys = Array.isArray(data?.keys) ? data.keys : [];
	const teams = Array.isArray(data?.teams) ? data.teams : [];
	const feedUrl = data?.feed_url || `${location.origin}/api/odata/v1/`;
	const atLimit = keys.length >= (data?.max_keys || 10);

	body.innerHTML = `
		<div class="feed-url">
			<div class="feed-code" aria-label="Feed URL">${esc(feedUrl)}</div>
			<button type="button" class="dn-btn" data-action="copy-url">Copy feed URL</button>
		</div>
		${created ? `
			<div class="feed-new" role="status">
				<div class="feed-new-title">Copy your new key now</div>
				<div class="dn-panel-sub" style="margin:0 0 10px">This is the only time it is shown. Use it as the password with Basic authentication.</div>
				<div class="feed-url" style="margin:0">
					<div class="feed-code" aria-label="New feed key">${esc(created.token)}</div>
					<button type="button" class="dn-btn primary" data-action="copy-token">Copy key</button>
				</div>
			</div>` : ''}
		<form class="feed-form" data-slot="form" novalidate>
			<label class="feed-field">
				<span>Key name</span>
				<input class="feed-input" name="name" maxlength="80" required placeholder="Finance Power BI" autocomplete="off" ${atLimit ? 'disabled' : ''}>
			</label>
			<label class="feed-field">
				<span>Data it can read</span>
				<select class="feed-input" name="team_id" ${atLimit ? 'disabled' : ''}>
					<option value="">My own usage</option>
					${teams.map((t) => `<option value="${esc(t.id)}">Team ${esc(t.name)} (owner and active people)</option>`).join('')}
				</select>
			</label>
			<button type="submit" class="dn-btn primary" ${atLimit ? 'disabled' : ''}>Create key</button>
		</form>
		<div data-slot="form-err" role="alert" style="color:var(--nxt-danger, #ff6b6b);font-size:13px;margin:-8px 0 12px"></div>
		${atLimit ? `<div class="dn-panel-sub" style="margin:-4px 0 12px">You have ${keys.length} active keys, the maximum. Revoke one to create another.</div>` : ''}
		<div data-slot="list">
			${keys.length ? keys.map(keyRow).join('') : emptyStateHTML({
				icon: '',
				compact: true,
				title: 'No feed keys yet',
				body: 'Name a key above and create it, then paste the feed URL into Power BI or Excel and use the key as the password.',
			})}
		</div>
		${steps(feedUrl)}`;

	body.querySelector('[data-action="copy-url"]').addEventListener('click', () => copy(feedUrl, 'Feed URL'));
	body.querySelector('[data-action="copy-token"]')?.addEventListener('click', () => copy(created.token, 'Key'));

	const form = body.querySelector('[data-slot="form"]');
	const formErr = body.querySelector('[data-slot="form-err"]');
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const name = form.elements.name.value.trim();
		formErr.textContent = '';
		if (!name) {
			formErr.textContent = 'Give the key a name, for example the report or workbook it is for.';
			form.elements.name.focus();
			return;
		}
		const btn = form.querySelector('button[type="submit"]');
		btn.disabled = true;
		btn.textContent = 'Creating…';
		try {
			const res = await post('/api/usage/feed-keys', { name, team_id: form.elements.team_id.value || null });
			await refresh(body, res, onRetry);
		} catch (err) {
			formErr.textContent = err?.message || 'The key could not be created. Try again.';
			btn.disabled = false;
			btn.textContent = 'Create key';
		}
	});

	body.querySelectorAll('[data-revoke]').forEach((btn) => {
		btn.addEventListener('click', async () => {
			if (btn.dataset.confirm !== 'yes') {
				btn.dataset.confirm = 'yes';
				btn.textContent = 'Revoke: refreshes using it will stop';
				return;
			}
			btn.disabled = true;
			try {
				await del(`/api/usage/feed-keys?id=${encodeURIComponent(btn.dataset.revoke)}`);
				toast('Key revoked', { variant: 'success' });
				await refresh(body, null, onRetry);
			} catch (err) {
				toast(err?.message || 'Could not revoke the key. Try again.', { variant: 'error' });
				btn.disabled = false;
			}
		});
	});
}
