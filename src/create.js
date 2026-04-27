import { apiFetch, saveRemoteGlbToAccount } from './account.js';
import { AvatarCreator } from './avatar-creator.js';

// GLB magic bytes: ASCII "glTF"
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46];

async function boot() {
	const creator = new AvatarCreator(document.body, (blob) =>
		saveAndRedirect(blob, { source: 'avaturn' }),
	);

	document.getElementById('back-btn').addEventListener('click', () => {
		if (history.length > 1) history.back();
		else window.location.href = '/';
	});

	wireCard('card-default-editor', async () => {
		if (await isAtAvatarLimit()) return;
		creator.openDefaultEditor();
	});
	wireCard('card-upload-glb', (e) => {
		// Tooltip anchors live inside the card; let them navigate normally.
		if (e && e.target && e.target.closest('a')) return;
		document.getElementById('glb-input').click();
	});

	document.getElementById('glb-input').addEventListener('change', async (e) => {
		const file = e.target.files?.[0];
		if (!file) return;
		e.target.value = '';
		await handleGlbFile(file);
	});
}

// Cards are divs with role="button", so we need to wire both click and
// keyboard activation (Enter / Space) ourselves — native <button> semantics.
function wireCard(id, handler) {
	const el = document.getElementById(id);
	if (!el) return;
	el.addEventListener('click', handler);
	el.addEventListener('keydown', (e) => {
		if (el.getAttribute('aria-disabled') === 'true') return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handler(e);
		}
	});
}

async function handleGlbFile(file) {
	if (!file.name.toLowerCase().endsWith('.glb')) {
		showStatus('Please select a .glb file.', 'error');
		return;
	}

	const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	if (!GLB_MAGIC.every((b, i) => header[i] === b)) {
		showStatus("File doesn't appear to be a valid GLB.", 'error');
		return;
	}

	const name = file.name.replace(/\.glb$/i, '').trim() || 'My Avatar';
	await saveAndRedirect(file, { source: 'upload', name });
}

async function isAtAvatarLimit() {
	try {
		const res = await apiFetch('/api/usage/summary');
		if (!res.ok) return false;
		const { counts, plan } = await res.json();
		if (counts.avatars >= plan.max_avatars) {
			showStatus(
				`You've reached the ${plan.max_avatars}-avatar limit on the free plan. Delete an avatar to create a new one.`,
				'error',
			);
			return true;
		}
	} catch {
		// network error — let the upload attempt proceed and fail naturally
	}
	return false;
}

async function saveAndRedirect(blob, meta = {}) {
	showStatus('Uploading avatar…', 'loading');
	try {
		const avatar = await saveRemoteGlbToAccount(blob, meta);
		const agent = await attachAvatarToAgent(avatar.id, meta.name);
		window.location.href = '/app?agent=' + agent.id;
	} catch (err) {
		if (err.code === 'not_signed_in') {
			sessionStorage.setItem('login_redirect', '/create');
			window.location.replace('/login');
			return;
		}
		if (err.data?.error === 'plan_limit_count') {
			showStatus(
				"You've reached your avatar limit. Delete an avatar to create a new one.",
				'error',
			);
			return;
		}
		if (!err.redirected) showStatus(err.message || 'Upload failed.', 'error');
	}
}

// Associates the uploaded avatar with the caller's default agent. POST /api/agents
// doesn't accept avatar_id, so we get-or-create via /me and then PUT to attach.
async function attachAvatarToAgent(avatarId, name) {
	const meRes = await apiFetch('/api/agents/me');
	const meData = await meRes.json();
	if (!meRes.ok) throw new Error(meData.error_description || 'Failed to load agent.');

	let agent = meData.agent;
	if (!agent) {
		const createRes = await apiFetch('/api/agents', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: name || 'My Agent' }),
		});
		const createData = await createRes.json();
		if (!createRes.ok)
			throw new Error(createData.error_description || 'Failed to create agent.');
		agent = createData.agent;
	}

	const putRes = await apiFetch('/api/agents/' + agent.id, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ avatar_id: avatarId }),
	});
	const putData = await putRes.json();
	if (!putRes.ok) throw new Error(putData.error_description || 'Failed to attach avatar.');
	return putData.agent;
}

function showStatus(msg, type = 'info') {
	const el = document.getElementById('status-toast');
	el.textContent = msg;
	el.className = 'status-toast ' + type;
	el.hidden = false;
	if (type !== 'loading') {
		setTimeout(() => {
			el.hidden = true;
		}, 4500);
	}
}

boot();
