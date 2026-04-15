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
	// Support #edit/<id> sub-routes for per-avatar edit screens.
	const [base, ...rest] = (tab || 'avatars').split('/');
	document.querySelectorAll('aside a').forEach((a) => a.classList.toggle('active', a.dataset.tab === base));
	const main = document.getElementById('main');
	main.innerHTML = '';
	const renderer = tabs[base] || tabs.avatars;
	renderer(main, rest);
}

const tabs = {
	avatars: renderAvatars,
	create: renderCreate,
	edit: renderEdit,
	upload: renderUpload,
	embed: renderEmbed,
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
			list.innerHTML = `<div class="empty">No avatars yet. <a href="#create">Take a selfie</a> or <a href="#upload">upload a .glb</a>.</div>`;
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
			<div class="row" style="gap:6px">
				<a class="btn sec" href="#edit/${encodeURIComponent(a.id)}">Edit</a>
				<button class="btn sec" data-del>Delete</button>
			</div>
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

// ── Create from selfie ──────────────────────────────────────────────────────
// Embeds the Ready Player Me hosted creator (free, no API key). RPM handles
// camera capture, selfie-to-mesh, and returns a GLB URL via postMessage.
// We fetch that GLB and run it through the same R2 upload path as manual uploads.
const RPM_SUBDOMAIN = 'demo'; // any public RPM subdomain works for self-serve
const RPM_ORIGIN    = `https://${RPM_SUBDOMAIN}.readyplayer.me`;
const RPM_SRC       = `${RPM_ORIGIN}/avatar?frameApi&bodyType=fullbody&clearCache=true`;

function renderCreate(root) {
	root.innerHTML = `
		<div class="toolbar">
			<div>
				<h1>Create from a selfie</h1>
				<p class="sub">Take a photo. We turn it into a 3D avatar and save it to your account.</p>
			</div>
			<button class="btn sec" id="rpm-restart" type="button" style="display:none">Start over</button>
		</div>
		<div id="rpm-stage" class="card" style="padding:0; overflow:hidden; min-height:640px; position:relative">
			<div id="rpm-intro" style="padding:32px; text-align:center">
				<div style="font-size:42px; line-height:1; margin-bottom:12px">📸</div>
				<p style="margin:0 0 18px; color:#ccc">
					Next screen: allow camera access, take a selfie, pick body type.
					Your avatar auto-saves here when you hit "Next" in the last step.
				</p>
				<button class="btn" id="rpm-launch" type="button">Open camera</button>
			</div>
			<iframe id="rpm-iframe" title="Avatar creator" allow="camera *; microphone *" style="display:none; width:100%; height:640px; border:0; background:#0f0f17"></iframe>
			<div id="rpm-progress" class="muted" style="padding:16px 20px; border-top:1px solid var(--border); display:none"></div>
		</div>
	`;

	const launchBtn  = root.querySelector('#rpm-launch');
	const restartBtn = root.querySelector('#rpm-restart');
	const intro      = root.querySelector('#rpm-intro');
	const iframe     = root.querySelector('#rpm-iframe');
	const progress   = root.querySelector('#rpm-progress');

	const say = (msg, isError = false) => {
		progress.style.display = 'block';
		progress.style.color = isError ? '#ffb3b3' : '#888';
		progress.textContent = msg;
	};

	let onMsg = null;

	const start = () => {
		intro.style.display = 'none';
		iframe.style.display = 'block';
		iframe.src = RPM_SRC;
		restartBtn.style.display = 'inline-block';
		progress.style.display = 'none';

		onMsg = async (event) => {
			if (event.origin !== RPM_ORIGIN) return;
			const data = parseRpmMessage(event.data);
			if (!data?.eventName) return;

			// Ready Player Me → subscribe to all events once its frame is ready.
			if (data.eventName === 'v1.frame.ready') {
				iframe.contentWindow?.postMessage(
					JSON.stringify({ target: 'readyplayerme', type: 'subscribe', eventName: 'v1.**' }),
					RPM_ORIGIN,
				);
				return;
			}

			if (data.eventName === 'v1.avatar.exported') {
				const glbUrl = data.data?.url;
				if (!glbUrl) { say('No avatar URL returned', true); return; }
				say('Fetching avatar…');
				try {
					const avatar = await saveRpmAvatar(glbUrl);
					say(`Saved "${avatar.name}". Redirecting…`);
					setTimeout(() => { location.hash = 'avatars'; }, 600);
				} catch (err) {
					say(err.message || 'Failed to save avatar', true);
				}
			}
		};
		window.addEventListener('message', onMsg);
	};

	const stop = () => {
		if (onMsg) window.removeEventListener('message', onMsg);
		onMsg = null;
		iframe.src = 'about:blank';
		iframe.style.display = 'none';
		intro.style.display = 'block';
		restartBtn.style.display = 'none';
		progress.style.display = 'none';
	};

	launchBtn.addEventListener('click', start);
	restartBtn.addEventListener('click', stop);
}

function parseRpmMessage(raw) {
	if (!raw) return null;
	if (typeof raw === 'object') return raw;
	try { return JSON.parse(raw); } catch { return null; }
}

async function saveRpmAvatar(sourceUrl) {
	const res = await fetch(sourceUrl);
	if (!res.ok) throw new Error(`Fetch avatar failed: ${res.status}`);
	const blob = await res.blob();
	const contentType = 'model/gltf-binary';
	const size = blob.size;
	const checksum = await sha256Hex(blob);

	const { upload_url, storage_key } = await api.presign({
		size_bytes: size,
		content_type: contentType,
		checksum_sha256: checksum,
	});

	await new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', upload_url);
		xhr.setRequestHeader('content-type', contentType);
		xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
		xhr.onerror = () => reject(new Error('Network error during upload'));
		xhr.send(blob);
	});

	const { avatar } = await api.createAvatar({
		storage_key,
		size_bytes: size,
		content_type: contentType,
		checksum_sha256: checksum,
		name: `Selfie avatar ${new Date().toLocaleDateString()}`,
		visibility: 'private',
		tags: ['selfie'],
		source: 'import',
		source_meta: { provider: 'readyplayerme', source_url: sourceUrl, selfie_based: true },
	});

	// Wire the new avatar straight into the caller's default agent identity so
	// the selfie immediately becomes the agent's body across the site.
	await attachAvatarToDefaultAgent(avatar.id).catch((e) => console.warn('attach to agent skipped:', e.message));
	return avatar;
}

async function attachAvatarToDefaultAgent(avatarId) {
	const meRes = await fetch('/api/agents/me', { credentials: 'include' });
	if (!meRes.ok) return;
	const { agent } = await meRes.json();
	if (!agent) return;
	await fetch(`/api/agents/${agent.id}`, {
		method: 'PUT',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ avatar_id: avatarId }),
	});
}

// ── Edit avatar ─────────────────────────────────────────────────────────────
async function renderEdit(root, params = []) {
	const id = params[0];
	if (!id) { location.hash = 'avatars'; return; }

	root.innerHTML = `
		<div class="toolbar">
			<div>
				<h1>Edit avatar</h1>
				<p class="sub">Update the details that appear in MCP results and the public gallery.</p>
			</div>
			<a class="btn sec" href="#avatars">Back</a>
		</div>
		<div id="edit-body">
			<div class="muted">Loading…</div>
		</div>
	`;

	const body = root.querySelector('#edit-body');
	let avatar;
	try {
		const res = await fetch(`/api/avatars/${encodeURIComponent(id)}`, { credentials: 'include' });
		if (!res.ok) throw new Error((await res.json()).error_description || res.statusText);
		avatar = (await res.json()).avatar;
	} catch (err) {
		body.innerHTML = `<div class="err">${esc(err.message)}</div>`;
		return;
	}

	const previewUrl = avatar.url || avatar.model_url;
	body.innerHTML = `
		<div style="display:grid; grid-template-columns:minmax(260px,1fr) minmax(260px,2fr); gap:20px; align-items:start">
			<div class="card" style="padding:10px">
				<div class="preview" style="aspect-ratio:1/1; margin:0; background:#0f0f17; border-radius:10px; overflow:hidden">
					${previewUrl
						? `<model-viewer src="${attr(previewUrl)}" camera-controls auto-rotate shadow-intensity="1" exposure="1" tone-mapping="aces" style="width:100%;height:100%"></model-viewer>`
						: `<div style="display:grid;place-items:center;height:100%;color:#555;font-size:12px">Preview unavailable</div>`}
				</div>
				<p class="muted" style="margin:10px 4px 0">${fmtSize(avatar.size_bytes || 0)} · ${esc(avatar.source || 'upload')}</p>
			</div>
			<form id="ef" class="card" style="max-width:560px">
				<label style="display:block">Name<input id="ename" value="${attr(avatar.name || '')}" maxlength="120" style="width:100%"></label>
				<label style="display:block;margin-top:12px">Description<textarea id="edesc" rows="3" style="width:100%">${esc(avatar.description || '')}</textarea></label>
				<label style="display:block;margin-top:12px">Visibility
					<select id="evis" style="width:100%">
						${['private','unlisted','public'].map((v) => `<option ${v===avatar.visibility?'selected':''} value="${v}">${v}</option>`).join('')}
					</select>
				</label>
				<label style="display:block;margin-top:12px">Tags (comma separated)<input id="etags" value="${attr((avatar.tags || []).join(', '))}" style="width:100%"></label>
				<div id="emsg" class="muted" style="margin-top:12px"></div>
				<div class="row" style="gap:8px; margin-top:16px">
					<button class="btn" type="submit">Save changes</button>
					<button class="btn sec" id="euse" type="button">Use as my agent's body</button>
				</div>
			</form>
		</div>
	`;

	const msg = body.querySelector('#emsg');
	body.querySelector('#ef').addEventListener('submit', async (e) => {
		e.preventDefault();
		msg.style.color = '#888';
		msg.textContent = 'Saving…';
		try {
			const tags = (body.querySelector('#etags').value || '').split(',').map((s) => s.trim()).filter(Boolean);
			await api.patchAvatar(id, {
				name: body.querySelector('#ename').value.trim(),
				description: body.querySelector('#edesc').value.trim() || undefined,
				visibility: body.querySelector('#evis').value,
				tags,
			});
			msg.style.color = '#9a8cff';
			msg.textContent = 'Saved.';
		} catch (err) {
			msg.style.color = '#ffb3b3';
			msg.textContent = err.message;
		}
	});

	body.querySelector('#euse').addEventListener('click', async () => {
		msg.style.color = '#888';
		msg.textContent = 'Linking to your agent…';
		try {
			await attachAvatarToDefaultAgent(id);
			msg.style.color = '#9a8cff';
			msg.textContent = 'Your agent will now render with this avatar.';
		} catch (err) {
			msg.style.color = '#ffb3b3';
			msg.textContent = err.message || 'Failed to link avatar to agent';
		}
	});
}

async function sha256Hex(blob) {
	const buf = await blob.arrayBuffer();
	const hash = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
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

// ── Embed ───────────────────────────────────────────────────────────────────
// Shows copy-paste snippets for dropping the agent into Lobehub, Claude,
// an iframe on any site, and a postMessage example for piping chat into the
// avatar so it reacts (speaks / emotes) to host-app events.
async function renderEmbed(root) {
	root.innerHTML = `
		<h1>Embed your agent</h1>
		<p class="sub">Drop your agent into Lobehub, Claude Artifacts, your site, or anywhere that can render an iframe. The agent reacts to chat messages via a postMessage bridge.</p>
		<div id="embed-body"><div class="muted">Loading your agent…</div></div>
	`;
	const body = root.querySelector('#embed-body');

	let agent;
	try {
		const res = await fetch('/api/agents/me', { credentials: 'include' });
		if (res.ok) agent = (await res.json()).agent;
	} catch {}

	if (!agent) {
		body.innerHTML = `
			<div class="empty">
				You don't have an agent yet. <a href="#create">Create one from a selfie</a> first.
			</div>
		`;
		return;
	}

	const origin = location.origin;
	const embedUrl = `${origin}/agent/${encodeURIComponent(agent.id)}/embed`;
	const homeUrl  = `${origin}/agent/${encodeURIComponent(agent.id)}`;
	const iframeSnippet = `<iframe src="${embedUrl}" allow="camera; microphone" style="width:320px;height:420px;border:0;border-radius:16px;overflow:hidden" title="${esc(agent.name || 'Agent')}"></iframe>`;
	const lobehubSnippet = [
		"// Drop into a Lobehub fork — renders the agent alongside the chat panel",
		"// and forwards assistant messages to it so the avatar speaks/emotes.",
		"import { useEffect, useRef } from 'react';",
		"",
		"export function AgentSidecar({ latestAssistantMessage }) {",
		`  const AGENT_ID = ${JSON.stringify(agent.id)};`,
		`  const EMBED_URL = ${JSON.stringify(embedUrl)};`,
		"  const ref = useRef(null);",
		"",
		"  useEffect(() => {",
		"    if (!ref.current || !latestAssistantMessage) return;",
		"    ref.current.contentWindow?.postMessage({",
		"      __agent: AGENT_ID,",
		"      type: 'action',",
		"      action: { type: 'speak', payload: { text: latestAssistantMessage.text } },",
		"    }, '*');",
		"  }, [latestAssistantMessage]);",
		"",
		"  return <iframe ref={ref} src={EMBED_URL} allow=\"camera; microphone\"",
		"    style={{ width: 320, height: 420, border: 0, borderRadius: 16 }} />;",
		"}",
	].join('\n');
	const claudeSnippet = [
		"<!-- Paste into Claude as an HTML Artifact. The avatar renders live. -->",
		`<iframe src="${embedUrl}"`,
		"        style=\"width:100%;height:480px;border:0;border-radius:16px\"",
		"        allow=\"camera; microphone\"></iframe>",
	].join('\n');
	const postMessageSnippet = [
		"// From any host page, make the avatar speak + emote:",
		"const frame = document.querySelector('iframe');",
		"frame.contentWindow.postMessage({",
		`  __agent: ${JSON.stringify(agent.id)},`,
		"  type: 'action',",
		"  action: { type: 'speak', payload: { text: 'Hello from the host app' } },",
		"}, '*');",
		"",
		"// Listen for agent readiness:",
		"window.addEventListener('message', (e) => {",
		`  if (e.data?.__agent === ${JSON.stringify(agent.id)} && e.data.type === 'ready') {`,
		"    console.log('agent online:', e.data.name);",
		"  }",
		"});",
	].join('\n');

	body.innerHTML = `
		<div style="display:grid; grid-template-columns:minmax(260px,1fr) minmax(320px,1.4fr); gap:20px; align-items:start">
			<div class="card" style="padding:8px">
				<iframe src="${attr(embedUrl + '?preview=1')}" style="width:100%;aspect-ratio:3/4;border:0;border-radius:10px;background:#0f0f17" title="Preview"></iframe>
				<div class="row" style="justify-content:space-between; padding:10px 6px 4px">
					<strong>${esc(agent.name || 'My Agent')}</strong>
					<a href="${attr(homeUrl)}" target="_blank" class="muted">Home page →</a>
				</div>
				<p class="muted" style="padding:0 6px">Agent ID <code>${esc(agent.id)}</code></p>
			</div>
			<div>
				${snippetBlock('Universal iframe (any site)', iframeSnippet, 'html')}
				${snippetBlock('Lobehub React sidecar', lobehubSnippet, 'tsx')}
				${snippetBlock('Claude Artifact', claudeSnippet, 'html')}
				${snippetBlock('postMessage bridge (speak + listen)', postMessageSnippet, 'js')}
				<div class="card" style="margin-top:14px">
					<h3 style="margin:0 0 6px">Who can embed?</h3>
					<p class="muted" style="margin:0 0 10px">By default anyone. Lock it down to specific hosts (your Lobehub deploy, your Substack…) on the <a href="/dashboard/embed-policy?agent=${encodeURIComponent(agent.id)}">embed-policy page</a>.</p>
				</div>
			</div>
		</div>
	`;

	for (const btn of body.querySelectorAll('[data-copy]')) {
		btn.addEventListener('click', async () => {
			const target = body.querySelector(btn.dataset.copy);
			if (!target) return;
			try {
				await navigator.clipboard.writeText(target.textContent);
				const original = btn.textContent;
				btn.textContent = 'Copied';
				setTimeout(() => { btn.textContent = original; }, 1200);
			} catch {
				btn.textContent = 'Copy failed';
			}
		});
	}
}

function snippetBlock(title, code, _lang) {
	const id = 'snip-' + Math.random().toString(36).slice(2, 8);
	return `
		<div class="card" style="margin-bottom:14px">
			<div class="row" style="justify-content:space-between; margin-bottom:8px">
				<strong>${esc(title)}</strong>
				<button class="btn sec" data-copy="#${id}" type="button">Copy</button>
			</div>
			<pre id="${id}" style="margin:0; max-height:260px">${esc(code)}</pre>
		</div>
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
