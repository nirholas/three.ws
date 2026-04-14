// Dashboard single-file app. Uses native DOM — no framework.
// Keeps bundle small and ensures anything rendering <model-viewer> works without bundler.

export const state = { user: null };

export const api = {
	me: () => j('GET', '/api/auth/me'),
	listAvatars: () => j('GET', '/api/avatars?limit=100'),
	deleteAvatar: (id) => j('DELETE', `/api/avatars/${id}`),
	patchAvatar: (id, patch) => j('PATCH', `/api/avatars/${id}`, patch),
	presign: (body) => j('POST', '/api/avatars/presign', body),
	createAvatar: (body) => j('POST', '/api/avatars', body),
	listKeys: () => j('GET', '/api/keys'),
	createKey: (body) => j('POST', '/api/keys', body),
	revokeKey: (id) => j('DELETE', `/api/keys/${id}`),
};

async function j(method, path, body) {
	const res = await fetch(path, {
		method,
		credentials: 'include',
		headers: body ? { 'content-type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = res.headers.get('content-type')?.includes('application/json')
		? await res.json()
		: null;
	if (!res.ok) throw Object.assign(new Error((data && data.error_description) || res.statusText), { status: res.status, data });
	return data;
}

export function signOut() {
	fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
		location.href = '/';
	});
}

export function navigate(tab) {
	document.querySelectorAll('aside a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
	const main = document.getElementById('main');
	main.innerHTML = '';
	const renderer = tabs[tab] || tabs.avatars;
	renderer(main);
}

const tabs = {
	avatars: renderAvatars,
	upload: renderUpload,
	keys: renderKeys,
	mcp: renderMcp,
	billing: renderBilling,
};

// ── Avatars ─────────────────────────────────────────────────────────────────
async function renderAvatars(root) {
	root.innerHTML = `<h1>Your avatars</h1><p class="sub">Each avatar gets a stable URL and can be rendered in Claude or any app via MCP.</p><div id="list" class="cards"></div>`;
	const list = root.querySelector('#list');
	list.innerHTML = '<div class="muted">Loading…</div>';
	try {
		const { avatars } = await api.listAvatars();
		if (!avatars.length) {
			list.innerHTML = `<div class="empty">No avatars yet. <a href="#upload">Upload one</a> or create via the viewer.</div>`;
			return;
		}
		list.innerHTML = '';
		for (const a of avatars) list.appendChild(avatarCard(a));
	} catch (e) {
		list.innerHTML = `<div class="err">${esc(e.message)}</div>`;
	}
}

function avatarCard(a) {
	const el = document.createElement('div');
	el.className = 'card';
	const preview = a.model_url
		? `<model-viewer src="${attr(a.model_url)}" camera-controls auto-rotate shadow-intensity="1" exposure="1" tone-mapping="aces"></model-viewer>`
		: `<span>Private · preview requires signed URL</span>`;
	el.innerHTML = `
		<div class="preview">${preview}</div>
		<h3>${esc(a.name)}</h3>
		<p class="meta">${a.size_bytes ? fmtSize(a.size_bytes) : ''} · ${esc(a.visibility)} · ${new Date(a.created_at).toLocaleDateString()}</p>
		<div class="row" style="gap:6px; margin-bottom:10px">${a.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
		<div class="row" style="justify-content:space-between">
			<select data-vis>${['private','unlisted','public'].map((v) => `<option ${v===a.visibility?'selected':''} value="${v}">${v}</option>`).join('')}</select>
			<button class="btn sec" data-del>Delete</button>
		</div>
	`;
	el.querySelector('[data-vis]').addEventListener('change', async (e) => {
		try {
			await api.patchAvatar(a.id, { visibility: e.target.value });
		} catch (err) { alert(err.message); }
	});
	el.querySelector('[data-del]').addEventListener('click', async () => {
		if (!confirm(`Delete "${a.name}"?`)) return;
		try {
			await api.deleteAvatar(a.id);
			el.remove();
		} catch (err) { alert(err.message); }
	});
	return el;
}

// ── Upload ──────────────────────────────────────────────────────────────────
function renderUpload(root) {
	root.innerHTML = `
		<h1>Upload avatar</h1><p class="sub">Upload a .glb file. It's stored on our CDN and made available via API and MCP.</p>
		<form id="up" class="card" style="max-width:520px">
			<label>File<input id="file" type="file" accept=".glb,model/gltf-binary" required></label>
			<label style="display:block;margin-top:12px">Name<input id="name" required maxlength="120" style="width:100%"></label>
			<label style="display:block;margin-top:12px">Description<textarea id="desc" rows="2" style="width:100%"></textarea></label>
			<label style="display:block;margin-top:12px">Visibility
				<select id="vis" style="width:100%">
					<option value="private">Private (only you)</option>
					<option value="unlisted">Unlisted (anyone with link)</option>
					<option value="public">Public (discoverable)</option>
				</select>
			</label>
			<label style="display:block;margin-top:12px">Tags (comma separated)<input id="tags" style="width:100%"></label>
			<div id="progress" class="muted" style="margin-top:12px"></div>
			<button class="btn" style="margin-top:16px" type="submit">Upload</button>
		</form>
	`;
	const form = root.querySelector('#up');
	const progress = root.querySelector('#progress');
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		const file = root.querySelector('#file').files[0];
		if (!file) return;
		progress.textContent = 'Requesting upload URL…';
		try {
			const { upload_url, storage_key } = await api.presign({
				size_bytes: file.size,
				content_type: file.type || 'model/gltf-binary',
			});
			progress.textContent = `Uploading ${fmtSize(file.size)}…`;
			await uploadToR2(upload_url, file, (pct) => (progress.textContent = `Uploading ${pct}%…`));
			progress.textContent = 'Finalizing…';
			const tags = (root.querySelector('#tags').value || '').split(',').map((s) => s.trim()).filter(Boolean);
			const { avatar } = await api.createAvatar({
				storage_key,
				name: root.querySelector('#name').value,
				description: root.querySelector('#desc').value || undefined,
				visibility: root.querySelector('#vis').value,
				tags,
				size_bytes: file.size,
				content_type: file.type || 'model/gltf-binary',
				source: 'upload',
				source_meta: {},
			});
			progress.innerHTML = `Uploaded! <a href="#avatars">View</a>`;
			location.hash = 'avatars';
		} catch (err) {
			progress.textContent = '';
			alert(err.message);
		}
	});
}

function uploadToR2(url, file, onProgress) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url);
		xhr.setRequestHeader('content-type', file.type || 'model/gltf-binary');
		xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
		xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
		xhr.onerror = () => reject(new Error('Network error during upload'));
		xhr.send(file);
	});
}

// ── API keys ────────────────────────────────────────────────────────────────
async function renderKeys(root) {
	root.innerHTML = `
		<h1>API keys</h1><p class="sub">Server-side keys for calling the MCP server without OAuth. Treat like passwords.</p>
		<div class="card" style="margin-bottom:16px">
			<form id="new" class="row" style="flex-wrap:wrap;gap:10px">
				<input id="kname" placeholder="Key name (e.g. my-app prod)" required>
				<select id="kenv"><option value="live">live</option><option value="test">test</option></select>
				<button class="btn" type="submit">Create key</button>
			</form>
			<div id="reveal"></div>
		</div>
		<div id="klist" class="card"></div>
	`;
	const klist = root.querySelector('#klist');
	async function refresh() {
		try {
			const { keys } = await api.listKeys();
			if (!keys.length) { klist.innerHTML = '<div class="muted">No keys yet.</div>'; return; }
			klist.innerHTML = keys.map((k) => `
				<div class="key-row">
					<div>
						<div><code>${esc(k.prefix)}…</code> — ${esc(k.name)}</div>
						<div class="muted">scope: ${esc(k.scope)} · created ${new Date(k.created_at).toLocaleDateString()}${k.revoked_at?` · <b style="color:#f88">revoked</b>`:''}</div>
					</div>
					${k.revoked_at ? '' : `<button class="btn sec" data-id="${esc(k.id)}">Revoke</button>`}
				</div>
			`).join('');
			klist.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', async () => {
				if (!confirm('Revoke this key?')) return;
				try { await api.revokeKey(b.dataset.id); refresh(); } catch (e) { alert(e.message); }
			}));
		} catch (e) { klist.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
	}
	root.querySelector('#new').addEventListener('submit', async (e) => {
		e.preventDefault();
		try {
			const { key } = await api.createKey({
				name: root.querySelector('#kname').value,
				environment: root.querySelector('#kenv').value,
			});
			root.querySelector('#reveal').innerHTML = `
				<div style="margin-top:10px">
					<p class="muted">Copy this key now — you won't see it again.</p>
					<pre><code>${esc(key.secret)}</code></pre>
				</div>
			`;
			root.querySelector('#kname').value = '';
			refresh();
		} catch (err) { alert(err.message); }
	});
	refresh();
}

// ── MCP integration ─────────────────────────────────────────────────────────
function renderMcp(root) {
	const origin = location.origin;
	root.innerHTML = `
		<h1>Use from Claude &amp; other MCP clients</h1>
		<p class="sub">Connect any MCP-compatible client to render your avatars inline.</p>

		<h3 class="section">Remote MCP server URL</h3>
		<pre><code>${esc(origin)}/api/mcp</code></pre>

		<h3 class="section">Claude Desktop / Claude Code (remote)</h3>
		<p class="muted">Add a Custom Connector in Claude. When prompted, sign in with your 3D Agent account.</p>
		<pre><code>${esc(JSON.stringify({
			mcpServers: {
				'3d-agent': { url: `${origin}/api/mcp` }
			}
		}, null, 2))}</code></pre>

		<h3 class="section">Programmatic (API key)</h3>
		<p class="muted">Bypass OAuth for server-to-server usage. Pass key as a bearer token.</p>
		<pre><code>curl -X POST ${esc(origin)}/api/mcp \\
  -H "authorization: Bearer sk_live_…" \\
  -H "content-type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'</code></pre>

		<h3 class="section">Available tools</h3>
		<ul>
			<li><b>list_my_avatars</b> — list avatars</li>
			<li><b>get_avatar</b> — fetch by id or slug</li>
			<li><b>search_public_avatars</b> — discover public avatars</li>
			<li><b>render_avatar</b> — returns &lt;model-viewer&gt; HTML for rendering as a Claude artifact</li>
			<li><b>delete_avatar</b> — remove an avatar (requires <code>avatars:delete</code>)</li>
		</ul>
	`;
}

// ── Billing placeholder ─────────────────────────────────────────────────────
function renderBilling(root) {
	root.innerHTML = `<h1>Plan &amp; usage</h1><p class="sub">You're on the <b>${esc(state.user.plan)}</b> plan.</p><div class="card muted">Detailed usage analytics coming soon.</div>`;
}

// ── utils ───────────────────────────────────────────────────────────────────
function fmtSize(b) { if (b < 1024) return b + ' B'; if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB'; return (b/1024/1024).toFixed(1) + ' MB'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function attr(s) { return esc(s); }
