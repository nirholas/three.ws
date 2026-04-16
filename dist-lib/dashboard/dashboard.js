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
	listWidgets: () => j('GET', '/api/widgets'),
	getWidget: (id) => j('GET', `/api/widgets/${encodeURIComponent(id)}`),
	patchWidget: (id, patch) => j('PATCH', `/api/widgets/${encodeURIComponent(id)}`, patch),
	deleteWidget: (id) => j('DELETE', `/api/widgets/${encodeURIComponent(id)}`),
	duplicateWidget: (id) => j('POST', `/api/widgets/${encodeURIComponent(id)}/duplicate`),
	widgetStats: (id) => j('GET', `/api/widgets/${encodeURIComponent(id)}/stats`),
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
		try { localStorage.removeItem('3dagent:auth-hint'); } catch { /* ignore */ }
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
	widgets: renderWidgets,
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

// ── Replace GLB ─────────────────────────────────────────────────────────────
// Shows an inline warning banner on the card, then opens a file picker.
// Validates extension, MIME, and GLB magic number before uploading.
// Runs a Mixamo skeleton compatibility check and surfaces a warning if < 50%.
function replaceGlbFlow(a, cardEl) {
	if (cardEl.querySelector('[data-glb-warn]')) return; // already open

	const warn = document.createElement('div');
	warn.setAttribute('data-glb-warn', '');
	warn.style.cssText = 'margin:8px 0; padding:10px; background:rgba(255,165,0,.08); border:1px solid rgba(255,165,0,.25); border-radius:8px; font-size:12px; color:#d4aa44';
	warn.innerHTML = `
		<p style="margin:0 0 8px">&#9888; This bypasses Avaturn &#8212; your avatar may not animate correctly if not rigged to the Mixamo skeleton.</p>
		<div class="row" style="gap:6px">
			<button class="btn" data-glb-pick style="font-size:12px;padding:6px 10px">Choose .glb file</button>
			<button class="btn sec" data-glb-cancel style="font-size:12px;padding:6px 10px">Cancel</button>
		</div>
		<input type="file" accept=".glb,model/gltf-binary" data-glb-file style="display:none">
		<div data-glb-progress style="margin-top:8px; min-height:1em"></div>
	`;
	cardEl.appendChild(warn);

	warn.querySelector('[data-glb-cancel]').addEventListener('click', () => warn.remove());
	warn.querySelector('[data-glb-pick]').addEventListener('click', () => {
		warn.querySelector('[data-glb-file]').click();
	});
	warn.querySelector('[data-glb-file]').addEventListener('change', async (e) => {
		const file = e.target.files[0];
		if (!file) return;
		const pick = warn.querySelector('[data-glb-pick]');
		const cancel = warn.querySelector('[data-glb-cancel]');
		pick.disabled = true;
		cancel.disabled = true;
		await doReplaceUpload(a, file, warn, cardEl);
		pick.disabled = false;
		cancel.disabled = false;
	});
}

async function doReplaceUpload(a, file, warnEl, cardEl) {
	const prog = warnEl.querySelector('[data-glb-progress]');
	const say = (msg, isError = false) => {
		prog.textContent = msg;
		prog.style.color = isError ? '#ffb3b3' : '#888';
	};

	// Extension check — reject .gltf and anything else
	if (!file.name.toLowerCase().endsWith('.glb')) {
		say('Only .glb files accepted. Separate .gltf + .bin packs are not supported.', true);
		return;
	}

	// MIME type check
	if (file.type && file.type !== 'model/gltf-binary' && file.type !== 'application/octet-stream') {
		say(`Unexpected file type "${file.type}". Expected model/gltf-binary.`, true);
		return;
	}

	// Magic number check: first 4 bytes must be 'glTF' (0x46546C67 little-endian)
	const header = await file.slice(0, 4).arrayBuffer();
	if (new DataView(header).getUint32(0, true) !== 0x46546C67) {
		say('Not a valid GLB \u2014 magic number check failed. Renamed files are rejected.', true);
		return;
	}

	say('Checking skeleton compatibility\u2026');
	const glbBuf = await file.arrayBuffer();
	const boneMatch = checkMixamoSkeleton(glbBuf);

	say('Requesting upload URL\u2026');
	try {
		const { upload_url, storage_key } = await api.presign({
			size_bytes: file.size,
			content_type: 'model/gltf-binary',
		});
		say(`Uploading ${fmtSize(file.size)}\u2026`);
		await uploadToR2(upload_url, file, (pct) => say(`Uploading ${pct}%\u2026`));
		say('Registering\u2026');
		const { avatar } = await api.createAvatar({
			storage_key,
			parent_avatar_id: a.id,
			name: a.name,
			description: a.description || undefined,
			visibility: a.visibility,
			tags: a.tags,
			size_bytes: file.size,
			content_type: 'model/gltf-binary',
			source: 'direct-upload',
			source_meta: { replaced_from: a.id },
		});

		// Refresh model-viewer preview if the new avatar is public/unlisted
		if (avatar.model_url) {
			const mv = cardEl.querySelector('model-viewer');
			if (mv) mv.src = avatar.model_url;
		}

		if (boneMatch !== null && boneMatch < 0.5) {
			say(`Uploaded. \u26a0 Animations may not play \u2014 skeleton mismatch (${Math.round(boneMatch * 100)}% Mixamo bone match).`);
		} else {
			say('Replaced! Your agent now uses the new GLB.');
		}
	} catch (err) {
		say(err.message || 'Upload failed', true);
	}
}

// Parse the GLB JSON chunk and count Mixamo bone name matches.
// Reuses the same strip-prefix logic as AnimationManager._buildBoneNameMap.
// Returns a ratio 0..1, or null if the file has no parseable node names.
function checkMixamoSkeleton(buffer) {
	const MIXAMO_BONES = new Set([
		'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
		'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
		'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
		'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
		'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
	]);
	try {
		const view = new DataView(buffer);
		const chunkLen = view.getUint32(12, true);
		if (view.getUint32(16, true) !== 0x4E4F534A) return null; // chunk 0 is not JSON
		const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, chunkLen)));
		const nodes = (json.nodes || []).filter((n) => n.name);
		if (!nodes.length) return null;
		const strip = (n) => n.replace(/^mixamorig\d*[_:]?/i, '').replace(/^Armature[_/]?/i, '');
		return nodes.filter((n) => MIXAMO_BONES.has(strip(n.name))).length / MIXAMO_BONES.size;
	} catch {
		return null;
	}
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
	const sdkSnippet = [
		"<!-- Drop-in SDK around the postMessage Bridge v1. -->",
		"<!-- See /agent/" + agent.id + "/embed for the wire contract. -->",
		`<iframe id="agent" src="${embedUrl}" allow="camera; microphone"`,
		"        style=\"width:320px;height:420px;border:0;border-radius:16px\"></iframe>",
		`<script src="${origin}/embed-sdk.js"></script>`,
		"<script>",
		"  const bridge = Agent3D.connect(document.getElementById('agent'), {",
		`    agentId: ${JSON.stringify(agent.id)},`,
		"    onReady:  ({ version, capabilities }) => console.log('ready', version, capabilities),",
		"    onAction: (action) => console.log('iframe emitted', action),",
		"    onResize: (h)      => console.log('preferred height', h),",
		"    onError:  (err)    => console.warn('bridge error', err.message),",
		"  });",
		"  bridge.ready.then(() => bridge.send({ type: 'speak', payload: { text: 'Hi from host' } }));",
		"</script>",
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
				${agent.wallet_address ? `
					<p class="muted" style="padding:0 6px; margin-top:6px; line-height:1.4">
						Agent wallet<br>
						<code style="font-size:11px; word-break:break-all">${esc(agent.wallet_address)}</code><br>
						<span style="font-size:11px">Server-held. Agents sign autonomously via <code style="font-size:11px">POST /api/agents/${esc(agent.id)}/sign</code>.</span>
					</p>
				` : ''}
			</div>
			<div>
				${snippetBlock('Universal iframe (any site)', iframeSnippet, 'html')}
				${snippetBlock('Lobehub React sidecar', lobehubSnippet, 'tsx')}
				${snippetBlock('Claude Artifact', claudeSnippet, 'html')}
				${snippetBlock('postMessage bridge (speak + listen)', postMessageSnippet, 'js')}
				${snippetBlock('Custom embed (Agent3D SDK · Bridge v1)', sdkSnippet, 'html')}
				<div class="card" style="margin-top:14px">
					<h3 style="margin:0 0 6px">Who can embed?</h3>
					<p class="muted" style="margin:0 0 10px">By default anyone. Lock it down to specific hosts (your Lobehub deploy, your Substack…) on the <a href="/dashboard/embed-policy?agent=${encodeURIComponent(agent.id)}">embed-policy page</a>.</p>
				</div>
				${onchainCard(agent)}
				${myAgentsCard()}
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

	bindOnchainDeploy(body, agent);
	bindMyAgents(body);
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

// ── Onchain deploy card ─────────────────────────────────────────────────────
// Mints the agent on ERC-8004 so any host (Lobehub / Claude / etc.) can resolve
// it from its onchain ID instead of needing the /agent/:id URL. Uses the
// wallet the user already connected for SIWE; pins the avatar GLB + manifest
// to IPFS; calls register() on the Identity Registry; writes the resulting
// agentId back to our DB so the agent row becomes the bridge between our host
// and the onchain record.
function onchainCard(agent) {
	const alreadyDeployed = !!agent.erc8004_agent_id;
	const chainHint = agent.chain_id ? ` on chain ${esc(String(agent.chain_id))}` : '';
	const statusHtml = alreadyDeployed
		? `<p style="margin:0 0 10px; color:#9a8cff">Deployed: agentId <code>${esc(String(agent.erc8004_agent_id))}</code>${chainHint}.</p>`
		: `<p class="muted" style="margin:0 0 10px">Mint your agent as an ERC-8004 onchain identity. Any client that knows the agentId can resolve your avatar, skills, and reputation — no off-chain registry lookup needed.</p>`;
	return `
		<div class="card" id="onchain-card" style="margin-top:14px">
			<h3 style="margin:0 0 6px">Deploy onchain (ERC-8004)</h3>
			${statusHtml}
			<div class="row" style="gap:8px; flex-wrap:wrap">
				<input id="onchain-ipfs-token" placeholder="web3.storage or Filebase API token" style="flex:1; min-width:260px" type="password">
				<button class="btn" id="onchain-deploy" type="button">${alreadyDeployed ? 'Redeploy' : 'Deploy now'}</button>
			</div>
			<div id="onchain-log" class="muted" style="margin-top:10px; font-family: ui-monospace, SF Mono, Menlo, monospace; font-size:12px; white-space:pre-wrap"></div>
		</div>
	`;
}

// Attach the click handler after the embed DOM has been rendered. Called from
// renderEmbed below via a mutation after body.innerHTML is set.
function bindOnchainDeploy(body, agent) {
	const btn   = body.querySelector('#onchain-deploy');
	const log   = body.querySelector('#onchain-log');
	const token = body.querySelector('#onchain-ipfs-token');
	if (!btn) return;

	btn.addEventListener('click', async () => {
		btn.disabled = true;
		const say = (msg, isError = false) => {
			log.style.color = isError ? '#ffb3b3' : '#888';
			log.textContent = (log.textContent ? log.textContent + '\n' : '') + msg;
		};
		log.textContent = '';

		if (!agent.avatar_id) {
			say('Your agent has no avatar yet. Create one from a selfie first.', true);
			btn.disabled = false;
			return;
		}

		try {
			say('Fetching avatar GLB…');
			const avRes = await fetch(`/api/avatars/${encodeURIComponent(agent.avatar_id)}`, { credentials: 'include' });
			if (!avRes.ok) throw new Error((await avRes.json()).error_description || 'avatar fetch failed');
			const avatarRow = (await avRes.json()).avatar;
			const glbUrl = avatarRow.url || avatarRow.model_url;
			if (!glbUrl) throw new Error('avatar has no URL');
			const glbBlob = await (await fetch(glbUrl)).blob();
			const glbFile = new File([glbBlob], `${agent.id}.glb`, { type: 'model/gltf-binary' });

			say('Opening registration flow… (loading chain module)');
			const { registerAgent } = await import('/src/erc8004/agent-registry.js');

			const result = await registerAgent({
				glbFile,
				name: agent.name || 'Agent',
				description: agent.description || `3D agent ${agent.id}`,
				apiToken: token.value.trim() || undefined,
				onStatus: (msg) => say(msg),
			});

			say(`Persisting onchain IDs to your account…`);
			const wallet = window.ethereum?.selectedAddress || '';
			const chainId = Number((await window.ethereum?.request?.({ method: 'eth_chainId' })) || 0) || undefined;
			await fetch(`/api/agents/${encodeURIComponent(agent.id)}/wallet`, {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					wallet_address: wallet,
					chain_id: chainId ? parseInt(chainId.toString(16) === chainId.toString() ? chainId : String(chainId), 10) || null : null,
					erc8004_agent_id: result.agentId,
				}),
			});

			say(`✓ Done. agentId=${result.agentId}, registration=ipfs://${result.registrationCID}, tx=${result.txHash}`);
		} catch (err) {
			say(err.message || String(err), true);
		} finally {
			btn.disabled = false;
		}
	});
}

// ── My on-chain agents card ─────────────────────────────────────────────────
// Lists every ERC-8004 agent owned by the connected wallet — minted here or
// elsewhere. Enumerates via ERC-721: balanceOf + tokenOfOwnerByIndex, falling
// back to a Transfer-event scan if the registry isn't ERC-721-Enumerable.
// Merges in DB-registered agents from /api/agents/by-wallet so "home" links
// work for agents minted through this app.
function myAgentsCard() {
	return `
		<div class="card" id="my-agents-card" style="margin-top:14px">
			<h3 style="margin:0 0 6px">Your on-chain agents</h3>
			<p class="muted" style="margin:0 0 10px">All ERC-8004 agents owned by your connected wallet — minted here or anywhere else.</p>
			<div class="row" style="gap:8px; flex-wrap:wrap; align-items:center">
				<button class="btn sec" id="my-agents-load" type="button">Load from wallet</button>
				<span id="my-agents-status" class="muted" style="font-size:12px"></span>
			</div>
			<div id="my-agents-list" style="margin-top:12px; display:grid; gap:10px"></div>
		</div>
	`;
}

function bindMyAgents(body) {
	const btn = body.querySelector('#my-agents-load');
	const status = body.querySelector('#my-agents-status');
	const list = body.querySelector('#my-agents-list');
	if (!btn) return;

	btn.addEventListener('click', async () => {
		btn.disabled = true;
		status.textContent = 'Connecting wallet…';
		list.innerHTML = '';

		try {
			const [{ connectWallet, getIdentityRegistry }, { REGISTRY_DEPLOYMENTS }] = await Promise.all([
				import('/src/erc8004/agent-registry.js'),
				import('/src/erc8004/abi.js'),
			]);

			const { signer, address, chainId } = await connectWallet();
			const deployment = REGISTRY_DEPLOYMENTS[chainId];
			if (!deployment?.identityRegistry) {
				status.textContent = `No ERC-8004 registry on chain ${chainId}. Switch networks and retry.`;
				return;
			}

			status.textContent = 'Reading registry…';
			const registry = getIdentityRegistry(chainId, signer);
			const balance = Number(await registry.balanceOf(address));

			// Fire the DB lookup in parallel with on-chain work.
			const dbPromise = fetch(
				`/api/agents/by-wallet?address=${encodeURIComponent(address)}&chain_id=${chainId}`,
				{ credentials: 'include' },
			).then((r) => (r.ok ? r.json() : { agents: [] })).catch(() => ({ agents: [] }));

			if (balance === 0) {
				const { agents: dbAgents = [] } = await dbPromise;
				if (dbAgents.length === 0) {
					status.textContent = `No agents owned on chain ${chainId}.`;
					return;
				}
				renderAgentRows(list, [], dbAgents);
				status.textContent = `${dbAgents.length} DB record${dbAgents.length === 1 ? '' : 's'} (not on-chain yet).`;
				return;
			}

			status.textContent = `${balance} agent${balance === 1 ? '' : 's'} owned. Enumerating…`;

			// Try ERC-721 Enumerable; fall back to event scan.
			let tokenIds = [];
			try {
				for (let i = 0; i < balance; i++) {
					tokenIds.push(Number(await registry.tokenOfOwnerByIndex(address, i)));
				}
			} catch {
				status.textContent = 'Registry is not Enumerable — scanning Transfer events…';
				const events = await registry.queryFilter(registry.filters.Transfer(null, address));
				const seen = new Set();
				for (const e of events) {
					const id = Number(e.args.tokenId);
					if (seen.has(id)) continue;
					seen.add(id);
					try {
						const owner = await registry.ownerOf(id);
						if (owner.toLowerCase() === address.toLowerCase()) tokenIds.push(id);
					} catch { /* token burned/transferred — skip */ }
				}
			}

			status.textContent = `Fetching metadata for ${tokenIds.length} agent${tokenIds.length === 1 ? '' : 's'}…`;
			const onchain = await Promise.all(tokenIds.map((id) => fetchTokenMeta(registry, id)));
			const { agents: dbAgents = [] } = await dbPromise;

			renderAgentRows(list, onchain, dbAgents);
			status.textContent = `${onchain.length} on-chain agent${onchain.length === 1 ? '' : 's'} on chain ${chainId}.`;
		} catch (err) {
			status.textContent = `Error: ${err.message || String(err)}`;
		} finally {
			btn.disabled = false;
		}
	});
}

async function fetchTokenMeta(registry, tokenId) {
	let uri = '';
	let meta = null;
	try { uri = await registry.tokenURI(tokenId); } catch { /* no URI set */ }
	if (uri) {
		const httpUrl = uriToHttp(uri);
		try {
			const r = await fetch(httpUrl);
			const ct = r.headers.get('content-type') || '';
			if (r.ok && ct.includes('json')) meta = await r.json();
		} catch { /* metadata unreachable */ }
	}
	return { id: tokenId, uri, meta };
}

function uriToHttp(uri) {
	if (!uri) return '';
	if (uri.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
	if (uri.startsWith('ar://'))   return `https://arweave.net/${uri.slice(5)}`;
	return uri;
}

function renderAgentRows(list, onchainAgents, dbAgents) {
	const dbByAgentId = new Map();
	for (const a of dbAgents) {
		if (a.erc8004_agent_id != null) dbByAgentId.set(String(a.erc8004_agent_id), a);
	}

	list.innerHTML = '';
	for (const { id, uri, meta } of onchainAgents) {
		const dbRow = dbByAgentId.get(String(id));
		const name = meta?.name || dbRow?.name || `Agent #${id}`;
		const desc = meta?.description || dbRow?.description || '';
		const img = uriToHttp(meta?.image || '');
		const homeLink = dbRow ? `/agent/${encodeURIComponent(dbRow.id)}` : '';
		const metaLink = uri ? uriToHttp(uri) : '';

		const el = document.createElement('div');
		el.className = 'row';
		el.style.cssText = 'gap:12px; padding:10px; border:1px solid #2a2a34; border-radius:10px; align-items:flex-start';
		el.innerHTML = `
			<div style="flex:0 0 64px; width:64px; height:64px; border-radius:8px; background:#0f0f17; overflow:hidden; display:flex; align-items:center; justify-content:center">
				${img ? `<img src="${attr(img)}" alt="" style="max-width:100%;max-height:100%;object-fit:cover" onerror="this.remove()">` : '<span class="muted" style="font-size:10px">no image</span>'}
			</div>
			<div style="flex:1 1 auto; min-width:0">
				<div class="row" style="justify-content:space-between; gap:8px; flex-wrap:wrap">
					<strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(name)}</strong>
					<span class="muted" style="font-size:12px">#${esc(String(id))}</span>
				</div>
				${desc ? `<p class="muted" style="margin:4px 0 0; font-size:12px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden">${esc(desc)}</p>` : ''}
				<div class="row" style="gap:10px; margin-top:6px; font-size:12px">
					${metaLink ? `<a href="${attr(metaLink)}" target="_blank" rel="noopener" class="muted">Metadata</a>` : ''}
					${homeLink ? `<a href="${attr(homeLink)}" target="_blank" rel="noopener">Open home</a>` : ''}
				</div>
			</div>
		`;
		list.appendChild(el);
	}

	// Surface DB rows that aren't on-chain yet (e.g. registration failed).
	for (const a of dbAgents) {
		const hasOnchain = a.erc8004_agent_id != null && onchainAgents.some((o) => String(o.id) === String(a.erc8004_agent_id));
		if (hasOnchain) continue;

		const el = document.createElement('div');
		el.className = 'row';
		el.style.cssText = 'gap:12px; padding:10px; border:1px dashed #2a2a34; border-radius:10px; align-items:flex-start; opacity:.85';
		el.innerHTML = `
			<div style="flex:0 0 64px; width:64px; height:64px; border-radius:8px; background:#0f0f17; display:flex; align-items:center; justify-content:center">
				<span class="muted" style="font-size:10px">db only</span>
			</div>
			<div style="flex:1 1 auto; min-width:0">
				<div class="row" style="justify-content:space-between; gap:8px; flex-wrap:wrap">
					<strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${esc(a.name || 'Agent')}</strong>
					<span class="muted" style="font-size:12px">not on-chain</span>
				</div>
				${a.description ? `<p class="muted" style="margin:4px 0 0; font-size:12px">${esc(a.description)}</p>` : ''}
				<div class="row" style="gap:10px; margin-top:6px; font-size:12px">
					<a href="/agent/${encodeURIComponent(a.id)}" target="_blank" rel="noopener">Open home</a>
				</div>
			</div>
		`;
		list.appendChild(el);
	}
}

// ── Billing placeholder ─────────────────────────────────────────────────────
function renderBilling(root) {
	root.innerHTML = `<h1>Plan &amp; usage</h1><p class="sub">You're on the <b>${esc(state.user.plan)}</b> plan.</p><div class="card muted">Detailed usage analytics coming soon.</div>`;
}

// ── Widgets ─────────────────────────────────────────────────────────────────
// Saved 3D experiences the user has generated in the Studio. Each gets its own
// card with a live, lazy-loaded preview iframe. Editing happens in /studio —
// the dashboard is for managing what already exists.

const WIDGET_TYPE_META = {
	'turntable':         { label: 'Turntable',       color: '#6a5cff' },
	'animation-gallery': { label: 'Animations',      color: '#ff5ca8' },
	'talking-agent':     { label: 'Talking Agent',   color: '#00e5a0' },
	'passport':          { label: 'Passport',        color: '#f0c14b' },
	'hotspot-tour':      { label: 'Hotspot Tour',    color: '#5cc8ff' },
};

const WIDGET_PREFS_KEY = 'dashboard.widgets.prefs';
const DEFAULT_WIDGET_PREFS = { sort: 'updated', type: '', q: '' };

function loadWidgetPrefs() {
	try { return { ...DEFAULT_WIDGET_PREFS, ...JSON.parse(localStorage.getItem(WIDGET_PREFS_KEY) || '{}') }; }
	catch { return { ...DEFAULT_WIDGET_PREFS }; }
}
function saveWidgetPrefs(prefs) {
	try { localStorage.setItem(WIDGET_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

async function renderWidgets(root) {
	const prefs = loadWidgetPrefs();
	root.innerHTML = `
		<div class="widgets-header">
			<div>
				<h1>Your widgets</h1>
				<p class="sub">Embeddable 3D experiences — each gets a stable URL.</p>
			</div>
			<a class="btn-primary" href="/studio">+ New widget</a>
		</div>
		<div class="widget-toolbar" role="toolbar" aria-label="Widget filters">
			<label class="sr-only" for="w-search">Search widgets</label>
			<input id="w-search" type="search" placeholder="Search by name…" value="${attr(prefs.q)}">
			<label class="sr-only" for="w-type">Filter by type</label>
			<select id="w-type" aria-label="Filter by widget type">
				<option value="">All types</option>
				${Object.entries(WIDGET_TYPE_META).map(([t, m]) =>
					`<option value="${attr(t)}" ${prefs.type===t?'selected':''}>${esc(m.label)}</option>`).join('')}
			</select>
			<label class="sr-only" for="w-sort">Sort widgets</label>
			<select id="w-sort" aria-label="Sort widgets">
				<option value="updated" ${prefs.sort==='updated'?'selected':''}>Recently updated</option>
				<option value="views"   ${prefs.sort==='views'  ?'selected':''}>Most viewed</option>
				<option value="name"    ${prefs.sort==='name'   ?'selected':''}>Name (A–Z)</option>
			</select>
			<span id="w-count" class="muted" aria-live="polite"></span>
		</div>
		<div id="widget-list" class="cards" aria-busy="true"><div class="muted">Loading…</div></div>
	`;

	const list = root.querySelector('#widget-list');
	const countEl = root.querySelector('#w-count');
	let widgets = [];

	try {
		const data = await api.listWidgets();
		widgets = data.widgets || [];
	} catch (e) {
		list.innerHTML = `<div class="err">${esc(e.message)}</div>`;
		list.setAttribute('aria-busy', 'false');
		return;
	}

	const observer = lazyIframeObserver();

	function rerender() {
		list.setAttribute('aria-busy', 'false');
		if (!widgets.length) {
			list.innerHTML = `
				<div class="empty" style="grid-column:1/-1">
					<p style="font-size:15px;color:#ccc;margin:0 0 8px">No widgets yet.</p>
					<p style="margin:0 0 18px">Your widgets are embeddable 3D experiences — pick an avatar, a type, and we handle the rest.</p>
					<a class="btn-primary" href="/studio">+ Create your first widget</a>
				</div>
			`;
			countEl.textContent = '';
			return;
		}
		const filtered = applyWidgetFilters(widgets, prefs);
		countEl.textContent = filtered.length === widgets.length
			? `${widgets.length} widget${widgets.length===1?'':'s'}`
			: `${filtered.length} of ${widgets.length}`;
		list.innerHTML = '';
		if (!filtered.length) {
			list.innerHTML = `<div class="empty" style="grid-column:1/-1">No widgets match the current filters.</div>`;
			return;
		}
		for (const w of filtered) {
			const card = widgetCard(w, { reload: rerender, mutate: (next) => mutateLocal(widgets, w.id, next), remove: () => { widgets = widgets.filter((x) => x.id !== w.id); rerender(); } });
			list.appendChild(card);
			const ifr = card.querySelector('iframe[data-src]');
			if (ifr) observer.observe(ifr);
		}
	}

	root.querySelector('#w-search').addEventListener('input', (e) => { prefs.q = e.target.value; saveWidgetPrefs(prefs); rerender(); });
	root.querySelector('#w-type').addEventListener('change', (e) => { prefs.type = e.target.value; saveWidgetPrefs(prefs); rerender(); });
	root.querySelector('#w-sort').addEventListener('change', (e) => { prefs.sort = e.target.value; saveWidgetPrefs(prefs); rerender(); });

	rerender();
}

function mutateLocal(arr, id, next) {
	const i = arr.findIndex((x) => x.id === id);
	if (i >= 0) arr[i] = { ...arr[i], ...next };
}

function applyWidgetFilters(widgets, prefs) {
	let out = widgets;
	if (prefs.type) out = out.filter((w) => w.type === prefs.type);
	if (prefs.q) {
		const q = prefs.q.trim().toLowerCase();
		if (q) out = out.filter((w) => (w.name || '').toLowerCase().includes(q));
	}
	out = [...out];
	if (prefs.sort === 'name')   out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
	if (prefs.sort === 'views')  out.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
	if (prefs.sort === 'updated' || !prefs.sort) {
		out.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
	}
	return out;
}

function widgetCard(w, ctx) {
	const meta = WIDGET_TYPE_META[w.type] || { label: w.type, color: '#888' };
	const card = document.createElement('div');
	card.className = 'widget-card card';
	card.dataset.id = w.id;

	const previewSrc = `/#widget=${encodeURIComponent(w.id)}&kiosk=true&preview=1`;
	const previewHtml = w.avatar
		? `<iframe data-src="${attr(previewSrc)}" loading="lazy" tabindex="-1" title="Preview of ${attr(w.name || 'widget')}"></iframe>`
		: `<div class="placeholder">Avatar unavailable.<br>Edit to pick a replacement.</div>`;

	card.innerHTML = `
		<div class="frame">${previewHtml}</div>
		<div class="title">
			<h3 title="Double-click to rename">${esc(w.name || 'Untitled')}</h3>
			<span class="pill"><span class="dot" style="background:${attr(meta.color)}"></span>${esc(meta.label)}</span>
		</div>
		<div class="row" style="justify-content:space-between; gap:8px">
			<span class="meta">${formatViewCount(w.view_count)} · updated ${timeAgo(w.updated_at)}</span>
			<label class="toggle" title="${w.is_public ? 'Public — anyone with the URL can view' : 'Private — only you can view'}">
				<input type="checkbox" data-public ${w.is_public?'checked':''}>
				<span class="track"></span>
				<span class="label">${w.is_public ? 'Public' : 'Private'}</span>
			</label>
		</div>
		<div class="actions">
			<a href="/studio?edit=${encodeURIComponent(w.id)}" data-edit>Edit</a>
			<button data-share type="button">Share</button>
			<button data-duplicate type="button">Duplicate</button>
			<button data-details type="button">Details</button>
			<button data-delete class="danger" type="button">Delete</button>
		</div>
	`;

	// Inline rename — double-click on the title swaps in an input.
	const titleEl = card.querySelector('.title h3');
	titleEl.addEventListener('dblclick', () => beginRename(card, w, ctx));

	// Public/private toggle — confirm before disabling so embeds aren't silently broken.
	const toggleInput = card.querySelector('input[data-public]');
	toggleInput.addEventListener('change', async () => {
		const next = toggleInput.checked;
		if (!next && !confirm('Making this widget private will break any existing embeds on other sites. Continue?')) {
			toggleInput.checked = true;
			return;
		}
		try {
			await api.patchWidget(w.id, { is_public: next });
			ctx.mutate({ is_public: next });
			card.querySelector('.toggle .label').textContent = next ? 'Public' : 'Private';
			toast(next ? 'Now public' : 'Now private');
		} catch (err) {
			toggleInput.checked = !next;
			toast(err.message || 'Failed to update', true);
		}
	});

	card.querySelector('[data-share]').addEventListener('click', () => openShareModal(w));
	card.querySelector('[data-details]').addEventListener('click', () => openWidgetDrawer(w, ctx));
	card.querySelector('[data-duplicate]').addEventListener('click', async () => {
		try {
			await api.duplicateWidget(w.id);
			toast('Duplicated');
			// Re-fetch via navigate so the new row's avatar join is populated.
			navigate('widgets');
		} catch (err) { toast(err.message || 'Duplicate failed', true); }
	});
	card.querySelector('[data-delete]').addEventListener('click', async () => {
		if (!confirm(`Delete "${w.name || 'this widget'}"? This cannot be undone.`)) return;
		try {
			await api.deleteWidget(w.id);
			card.style.transition = 'opacity .2s';
			card.style.opacity = '0';
			setTimeout(() => ctx.remove(), 220);
			toast('Deleted');
		} catch (err) { toast(err.message || 'Delete failed', true); }
	});

	return card;
}

function beginRename(card, w, ctx) {
	const titleEl = card.querySelector('.title h3');
	if (!titleEl) return;
	const original = w.name || '';
	const input = document.createElement('input');
	input.type = 'text';
	input.value = original;
	input.maxLength = 120;
	input.setAttribute('aria-label', 'Widget name');
	titleEl.replaceWith(input);
	input.focus();
	input.select();

	let settled = false;
	const restore = (text) => {
		if (settled) return; settled = true;
		const h = document.createElement('h3');
		h.textContent = text;
		h.title = 'Double-click to rename';
		input.replaceWith(h);
		h.addEventListener('dblclick', () => beginRename(card, { ...w, name: text }, ctx));
	};

	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { e.preventDefault(); commit(); }
		else if (e.key === 'Escape') { e.preventDefault(); restore(original); }
	});
	input.addEventListener('blur', commit);

	async function commit() {
		const next = input.value.trim();
		if (!next || next === original) { restore(original); return; }
		try {
			await api.patchWidget(w.id, { name: next });
			ctx.mutate({ name: next });
			restore(next);
			toast('Renamed');
		} catch (err) {
			restore(original);
			toast(err.message || 'Rename failed', true);
		}
	}
}

function lazyIframeObserver() {
	if (typeof IntersectionObserver === 'undefined') {
		// Fallback — eagerly hydrate. Old browsers shouldn't pay this a/b cost.
		return { observe(el) { hydrate(el); } };
	}
	const io = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				hydrate(entry.target);
				io.unobserve(entry.target);
			}
		}
	}, { rootMargin: '120px' });
	return io;
	function hydrate(el) {
		const src = el.getAttribute('data-src');
		if (src && !el.src) el.src = src;
	}
}

// ── Widget details drawer ───────────────────────────────────────────────────
async function openWidgetDrawer(w, ctx) {
	const overlay = document.createElement('div');
	overlay.className = 'drawer-overlay';
	const drawer = document.createElement('aside');
	drawer.className = 'drawer';
	drawer.setAttribute('role', 'dialog');
	drawer.setAttribute('aria-label', `Widget details — ${w.name || 'untitled'}`);
	drawer.tabIndex = -1;

	const previewSrc = `/#widget=${encodeURIComponent(w.id)}&kiosk=true&preview=1`;
	const pageUrl    = `${location.origin}/w/${encodeURIComponent(w.id)}`;
	const iframeSnippet = makeIframeSnippet(w, pageUrl, 600, 600);
	const scriptSnippet = `<script async src="${location.origin}/embed.js" data-widget="${esc(w.id)}"></script>`;
	const meta = WIDGET_TYPE_META[w.type] || { label: w.type, color: '#888' };

	drawer.innerHTML = `
		<header>
			<h2>${esc(w.name || 'Untitled')}</h2>
			<button class="btn sec" data-close type="button" aria-label="Close details">Close</button>
		</header>
		<div class="body">
			<div class="frame-lg"><iframe src="${attr(previewSrc)}" title="Preview"></iframe></div>
			<div>
				<span class="pill"><span class="dot" style="background:${attr(meta.color)}"></span>${esc(meta.label)}</span>
				<span class="muted" style="margin-left:8px">${esc(w.is_public ? 'Public' : 'Private')} · updated ${timeAgo(w.updated_at)}</span>
			</div>
			<div id="stats-region" aria-live="polite"><div class="muted">Loading stats…</div></div>
			<details>
				<summary>Embed code</summary>
				<div style="display:flex; flex-direction:column; gap:10px; margin-top:8px">
					<div>
						<div class="row" style="justify-content:space-between; margin-bottom:4px"><strong style="font-size:12px">Iframe</strong><button class="btn sec" data-copy="iframe" type="button">Copy</button></div>
						<pre id="snip-iframe" style="margin:0">${esc(iframeSnippet)}</pre>
					</div>
					<div>
						<div class="row" style="justify-content:space-between; margin-bottom:4px"><strong style="font-size:12px">One-line script</strong><button class="btn sec" data-copy="script" type="button">Copy</button></div>
						<pre id="snip-script" style="margin:0">${esc(scriptSnippet)}</pre>
					</div>
					<div>
						<div class="row" style="justify-content:space-between; margin-bottom:4px"><strong style="font-size:12px">Direct URL</strong><button class="btn sec" data-copy="url" type="button">Copy</button></div>
						<pre id="snip-url" style="margin:0">${esc(pageUrl)}</pre>
					</div>
				</div>
			</details>
			<details>
				<summary>Configuration (read-only)</summary>
				<pre style="margin:8px 0 0; max-height:220px">${esc(JSON.stringify(w.config || {}, null, 2))}</pre>
			</details>
			<div class="danger-zone">
				<h3>Danger zone</h3>
				<p class="muted" style="margin:0 0 10px; font-size:12px">Deleting removes the widget for everyone. Embeds will return 404.</p>
				<button class="btn-primary btn-danger" data-drawer-delete type="button">Delete this widget</button>
			</div>
		</div>
	`;

	document.body.appendChild(overlay);
	document.body.appendChild(drawer);
	requestAnimationFrame(() => { overlay.classList.add('open'); drawer.classList.add('open'); });
	drawer.focus();

	const close = () => {
		overlay.classList.remove('open');
		drawer.classList.remove('open');
		setTimeout(() => { overlay.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); }, 220);
	};
	const onKey = (e) => { if (e.key === 'Escape') close(); };
	document.addEventListener('keydown', onKey);
	overlay.addEventListener('click', close);
	drawer.querySelector('[data-close]').addEventListener('click', close);

	for (const btn of drawer.querySelectorAll('[data-copy]')) {
		btn.addEventListener('click', async () => {
			const target = drawer.querySelector(`#snip-${btn.dataset.copy}`);
			if (target) await copyToClipboard(target.textContent, btn);
		});
	}

	drawer.querySelector('[data-drawer-delete]').addEventListener('click', async () => {
		if (!confirm(`Delete "${w.name || 'this widget'}"? This cannot be undone.`)) return;
		try {
			await api.deleteWidget(w.id);
			toast('Deleted');
			close();
			ctx?.remove?.();
		} catch (err) { toast(err.message || 'Delete failed', true); }
	});

	// Stats — load async, render sparkline.
	try {
		const { stats } = await api.widgetStats(w.id);
		drawer.querySelector('#stats-region').innerHTML = renderStatsPanel(w, stats);
	} catch (err) {
		drawer.querySelector('#stats-region').innerHTML = `<div class="err">${esc(err.message || 'Failed to load stats')}</div>`;
	}
}

function renderStatsPanel(w, stats) {
	const total7d = (stats.recent_views_7d || []).reduce((s, d) => s + (d.count || 0), 0);
	const chatLine = stats.chat_count !== null && stats.chat_count !== undefined
		? `<div class="stat"><div class="n">${formatNum(stats.chat_count)}</div><div class="l">Chats (lifetime)</div></div>`
		: '';
	const lastSeen = stats.last_viewed_at
		? `<div class="muted" style="margin-top:4px; font-size:12px">Last viewed ${timeAgo(stats.last_viewed_at)}</div>`
		: '';
	const referers = (stats.top_referers || []).slice(0, 3);
	const refList = referers.length
		? `<details><summary>Top referrers</summary><ul style="margin:6px 0 0; padding-left:18px; font-size:12px; color:#aaa">${referers.map((r) => `<li>${esc(r.host || '(direct)')} — ${formatNum(r.count)}</li>`).join('')}</ul></details>`
		: '';
	return `
		<div class="stat-grid">
			<div class="stat"><div class="n">${formatNum(stats.view_count)}</div><div class="l">Views (lifetime)</div></div>
			<div class="stat"><div class="n">${formatNum(total7d)}</div><div class="l">Views (7 days)</div></div>
			${chatLine}
		</div>
		${lastSeen}
		<div style="margin-top:14px">
			${sparkline(stats.recent_views_7d || [])}
		</div>
		${refList}
	`;
}

function sparkline(days) {
	if (!days.length) return '<div class="muted" style="font-size:12px">No views yet</div>';
	const W = 480, H = 60, P = 4;
	const max = Math.max(1, ...days.map((d) => d.count || 0));
	const stepX = (W - 2 * P) / Math.max(1, days.length - 1);
	const pts = days.map((d, i) => {
		const x = P + i * stepX;
		const y = H - P - ((d.count || 0) / max) * (H - 2 * P);
		return [x, y];
	});
	const linePath = pts.map((p, i) => (i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `L${p[0].toFixed(1)},${p[1].toFixed(1)}`)).join(' ');
	const areaPath = `${linePath} L${pts[pts.length-1][0].toFixed(1)},${H-P} L${pts[0][0].toFixed(1)},${H-P} Z`;
	const allZero = days.every((d) => !d.count);
	const labels = `${esc(days[0].day)} → ${esc(days[days.length-1].day)}`;
	return `
		<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Views over the last 7 days, ${days.map((d) => `${d.day}: ${d.count}`).join(', ')}">
			<line class="axis" x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}"></line>
			${allZero ? '' : `<path class="area" d="${areaPath}"></path><path class="line" d="${linePath}"></path>`}
		</svg>
		<div class="muted" style="font-size:11px; display:flex; justify-content:space-between; padding:0 4px">
			<span>${labels}</span>
			<span>${allZero ? 'No views yet' : `peak ${max}`}</span>
		</div>
	`;
}

// ── Share modal ─────────────────────────────────────────────────────────────
function openShareModal(w) {
	const SIZES = [
		{ label: 'Small',  width: 320,  height: 320 },
		{ label: 'Medium', width: 600,  height: 600 },
		{ label: 'Banner', width: 1200, height: 400 },
		{ label: 'Custom', width: 0,    height: 0 },
	];
	let active = 1;
	let dim = { ...SIZES[active] };
	const pageUrl = `${location.origin}/w/${encodeURIComponent(w.id)}`;

	const overlay = document.createElement('div');
	overlay.className = 'modal-overlay';
	overlay.innerHTML = `
		<div class="modal" role="dialog" aria-label="Share widget">
			<h2>Share "${esc(w.name || 'widget')}"</h2>
			<p class="sub">Pick a size, copy the iframe, and you're done.</p>
			<div class="size-presets" role="tablist">
				${SIZES.map((s, i) => `<button type="button" data-i="${i}" class="${i===active?'active':''}" role="tab" aria-selected="${i===active}">${esc(s.label)}${s.width?` (${s.width}×${s.height})`:''}</button>`).join('')}
			</div>
			<div class="size-inputs">
				<label class="muted" style="font-size:12px">W <input id="m-w" type="number" min="120" max="2000" value="${dim.width||600}"></label>
				<label class="muted" style="font-size:12px">H <input id="m-h" type="number" min="120" max="2000" value="${dim.height||600}"></label>
			</div>
			<div style="background:#0f0f17; border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:12px">
				<div class="muted" style="font-size:11px; margin-bottom:8px">Live preview (scaled to fit)</div>
				<div id="m-preview" style="display:grid; place-items:center; min-height:200px; max-height:340px; overflow:hidden"></div>
			</div>
			<div>
				<div class="row" style="justify-content:space-between; margin-bottom:4px"><strong style="font-size:12px">Iframe</strong><button class="btn sec" id="m-copy" type="button">Copy</button></div>
				<pre id="m-snip" style="margin:0"></pre>
			</div>
			<div class="row" style="justify-content:space-between; margin-top:14px">
				<a class="muted" style="font-size:12px" href="mailto:abuse@3dagent.vercel.app?subject=Report+widget+${encodeURIComponent(w.id)}">Report this widget</a>
				<button class="btn sec" id="m-close" type="button">Close</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);
	requestAnimationFrame(() => overlay.classList.add('open'));

	const wInput = overlay.querySelector('#m-w');
	const hInput = overlay.querySelector('#m-h');
	const snipEl = overlay.querySelector('#m-snip');
	const previewEl = overlay.querySelector('#m-preview');

	function refresh() {
		const snippet = makeIframeSnippet(w, pageUrl, dim.width, dim.height);
		snipEl.textContent = snippet;
		// Live preview at scaled size — fit within 320×320 while preserving ratio.
		const maxW = 320, maxH = 320;
		const scale = Math.min(maxW / dim.width, maxH / dim.height, 1);
		previewEl.innerHTML = `<iframe src="/#widget=${encodeURIComponent(w.id)}&kiosk=true&preview=1" style="width:${dim.width}px; height:${dim.height}px; border:0; transform:scale(${scale}); transform-origin:center" title="Preview"></iframe>`;
		previewEl.style.width = `${dim.width * scale}px`;
		previewEl.style.height = `${dim.height * scale}px`;
	}
	function setPreset(i) {
		active = i;
		overlay.querySelectorAll('.size-presets button').forEach((b, j) => {
			b.classList.toggle('active', i === j);
			b.setAttribute('aria-selected', i === j ? 'true' : 'false');
		});
		if (SIZES[i].width) {
			dim = { width: SIZES[i].width, height: SIZES[i].height };
			wInput.value = dim.width; hInput.value = dim.height;
		}
		refresh();
	}
	overlay.querySelectorAll('.size-presets button').forEach((b) => {
		b.addEventListener('click', () => setPreset(Number(b.dataset.i)));
	});
	const onDimChange = () => {
		dim = { width: clampInt(wInput.value, 120, 2000, 600), height: clampInt(hInput.value, 120, 2000, 600) };
		// Switch to "Custom" preset when typing.
		setPresetSilent(SIZES.length - 1);
		refresh();
	};
	function setPresetSilent(i) {
		active = i;
		overlay.querySelectorAll('.size-presets button').forEach((b, j) => {
			b.classList.toggle('active', i === j);
			b.setAttribute('aria-selected', i === j ? 'true' : 'false');
		});
	}
	wInput.addEventListener('input', onDimChange);
	hInput.addEventListener('input', onDimChange);

	const close = () => {
		overlay.classList.remove('open');
		setTimeout(() => { overlay.remove(); document.removeEventListener('keydown', onKey); }, 200);
	};
	const onKey = (e) => { if (e.key === 'Escape') close(); };
	document.addEventListener('keydown', onKey);
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
	overlay.querySelector('#m-close').addEventListener('click', close);
	overlay.querySelector('#m-copy').addEventListener('click', (e) => copyToClipboard(snipEl.textContent, e.currentTarget));

	refresh();
}

function clampInt(v, lo, hi, fallback) {
	const n = parseInt(v, 10);
	if (Number.isNaN(n)) return fallback;
	return Math.max(lo, Math.min(hi, n));
}

function makeIframeSnippet(w, pageUrl, width, height) {
	const title = (w.name || 'Widget').replace(/"/g, '&quot;');
	return `<iframe src="${pageUrl}" width="${width}" height="${height}" style="border:0;border-radius:12px;max-width:100%" allow="autoplay; xr-spatial-tracking; clipboard-write" title="${title}" loading="lazy"></iframe>`;
}

// ── shared widget UI helpers ────────────────────────────────────────────────
async function copyToClipboard(text, btn) {
	try {
		await navigator.clipboard.writeText(text);
		toast('Copied to clipboard');
		if (btn) {
			const orig = btn.textContent;
			btn.textContent = 'Copied';
			setTimeout(() => { btn.textContent = orig; }, 1100);
		}
	} catch {
		toast('Copy failed — select and ⌘C manually', true);
	}
}

let _toastTimer;
function toast(message, isError = false) {
	const existing = document.querySelector('.toast');
	if (existing) existing.remove();
	clearTimeout(_toastTimer);
	const el = document.createElement('div');
	el.className = 'toast';
	if (isError) { el.style.color = '#ffb3b3'; el.style.borderColor = 'rgba(255,92,92,.4)'; }
	el.setAttribute('role', isError ? 'alert' : 'status');
	el.textContent = message;
	document.body.appendChild(el);
	_toastTimer = setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, 2200);
}

function timeAgo(ts) {
	if (!ts) return 'never';
	const then = new Date(ts).getTime();
	const now = Date.now();
	const sec = Math.max(1, Math.round((now - then) / 1000));
	if (sec < 60)        return `${sec}s ago`;
	const min = Math.round(sec / 60);
	if (min < 60)        return `${min}m ago`;
	const hr  = Math.round(min / 60);
	if (hr  < 24)        return `${hr}h ago`;
	const day = Math.round(hr / 24);
	if (day < 30)        return `${day}d ago`;
	const mo  = Math.round(day / 30);
	if (mo  < 12)        return `${mo}mo ago`;
	return `${Math.round(mo / 12)}y ago`;
}

function formatNum(n) {
	const v = Number(n || 0);
	if (v < 1000)    return String(v);
	if (v < 10000)   return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
	if (v < 1_000_000) return Math.round(v / 1000) + 'k';
	return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function formatViewCount(n) {
	const v = Number(n || 0);
	if (v === 0) return 'No views';
	if (v === 1) return '1 view';
	return `${formatNum(v)} views`;
}

// ── utils ───────────────────────────────────────────────────────────────────
function fmtSize(b) { if (b < 1024) return b + ' B'; if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB'; return (b/1024/1024).toFixed(1) + ' MB'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function attr(s) { return esc(s); }
