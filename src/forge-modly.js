// /forge "Your GPU" lane: the opt-in Modly connect panel, plus the two
// persistence steps a model generated on the user's own machine needs before
// the rest of Forge (rig, optimize, AR, embed, the avatar library) can use it.
//
// Modly (https://modly3d.app/) is a free desktop app that runs open image-to-3D
// models on the user's graphics card and serves an HTTP API on localhost. The
// transport lives in src/modly-local.js; this module owns the panel's states.
//
// Nothing here touches localhost until the person presses Connect. Probing a
// loopback address raises Chrome's Local Network Access prompt, and a prompt
// nobody asked for on page load is exactly what a visitor should never see.

import {
	MODLY_INSTALL_URL,
	MODLY_ORIGINS,
	probeModly,
	getModlyOriginOverride,
	setModlyOriginOverride,
} from './modly-local.js';

const PROBE_TIMEOUT_MS = 2500;

function esc(value) {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

function plural(n, one, many) {
	return n === 1 ? one : many;
}

/** Models that can serve an image-to-3D run right now. */
export function readyModlyModels(models) {
	return (Array.isArray(models) ? models : []).filter(
		(m) => m && m.downloaded && m.input === 'image' && m.output === 'mesh',
	);
}

/**
 * Wire the connect panel. `root` is #modly-panel; `onChange(state)` fires after
 * every state transition so the engine picker can add or drop Modly engines.
 *
 * state: { status: 'idle'|'probing'|'connected'|'not-running'|'blocked',
 *          origin, models, reason, error }
 */
export function createModlyPanel({ root, onChange = () => {} }) {
	if (!root) return null;
	const $ = (id) => root.querySelector(`#${id}`);
	const connectBtn = $('modly-connect');
	const connectLabel = $('modly-connect-label');
	const disconnectBtn = $('modly-disconnect');
	const statusEl = $('modly-status');
	const originInput = $('modly-origin');
	const originSave = $('modly-origin-save');
	const originMsg = $('modly-origin-msg');

	let state = { status: 'idle', origin: null, models: [], reason: '', error: null };
	// One-off outcome line ("Cancelled…") shown above the status until the
	// next connect or disconnect.
	let note = '';
	let probe = null;

	if (originInput) originInput.value = getModlyOriginOverride();

	function setState(next) {
		state = { ...state, ...next };
		render();
		onChange(state);
	}

	function render() {
		root.dataset.state = state.status;
		const probing = state.status === 'probing';
		connectBtn.disabled = probing;
		connectBtn.setAttribute('aria-busy', String(probing));
		connectLabel.textContent = probing
			? 'Connecting…'
			: state.status === 'connected'
				? 'Refresh'
				: state.status === 'idle'
					? 'Connect'
					: 'Retry';
		disconnectBtn.hidden = state.status !== 'connected';
		const lead = note ? `<strong class="modly-note">${esc(note)}</strong> ` : '';
		statusEl.innerHTML = lead + statusHTML();
	}

	function statusHTML() {
		const install = `<a href="${MODLY_INSTALL_URL}" target="_blank" rel="noopener">modly3d.app</a>`;
		switch (state.status) {
			case 'idle':
				return 'Run open image-to-3D models on your own graphics card with Modly, a free desktop app. Nothing on this computer is contacted until you press Connect.';
			case 'probing':
				return '<span class="modly-spinner" aria-hidden="true"></span>Looking for Modly on this computer…';
			case 'not-running': {
				const tried = MODLY_ORIGINS.map((o) => `<code>${esc(o)}</code>`).join(', ');
				return `<strong>Modly isn't running.</strong> Install it from ${install}, start it, then press Retry. Checked ${tried}.`;
			}
			case 'blocked':
				if (state.reason === 'mixed-content') {
					return '<strong>Safari blocks this.</strong> A secure page cannot reach an app on <code>http://localhost</code> in Safari. Open three.ws/forge in Chrome, Edge or Firefox to use Modly.';
				}
				return '<strong>Your browser blocked the connection.</strong> Open site settings (the icon left of the address bar), set <em>Local network access</em> to Allow, then press Retry.';
			case 'connected':
				return connectedHTML();
			default:
				return '';
		}
	}

	function connectedHTML() {
		const where = `Connected to Modly at <code>${esc(state.origin)}</code>.`;
		if (state.error) {
			return `${where} It could not list its models: ${esc(state.error.message)}. Press Refresh to try again.`;
		}
		const ready = readyModlyModels(state.models);
		if (ready.length) {
			return `${where} <strong>${ready.length} ${plural(ready.length, 'model', 'models')} ready.</strong> Pick one under Engine, marked <span class="modly-pill">Your GPU, free</span>.`;
		}
		const pending = state.models.filter((m) => !m.downloaded).map((m) => esc(m.name));
		const pendingNote = pending.length ? ` Installed but not downloaded yet: ${pending.join(', ')}.` : '';
		return `${where} <strong>No models downloaded yet.</strong> Open Modly, go to its Models page, download a model, then press Refresh.${pendingNote}`;
	}

	async function connect() {
		probe?.abort();
		const controller = new AbortController();
		probe = controller;
		note = '';
		setState({ status: 'probing', error: null });
		const result = await probeModly({ signal: controller.signal, timeoutMs: PROBE_TIMEOUT_MS });
		if (probe !== controller) return state;
		probe = null;
		setState({
			status: result.status,
			origin: result.origin,
			models: result.models || [],
			reason: result.reason || '',
			error: result.status === 'connected' ? result.error || null : null,
		});
		return state;
	}

	function disconnect() {
		probe?.abort();
		probe = null;
		note = '';
		setState({ status: 'idle', origin: null, models: [], reason: '', error: null });
		connectBtn.focus();
	}

	function saveOrigin() {
		originInput.removeAttribute('aria-invalid');
		let saved;
		try {
			saved = setModlyOriginOverride(originInput.value.trim());
		} catch (err) {
			originInput.setAttribute('aria-invalid', 'true');
			originMsg.textContent = err.message;
			originMsg.dataset.tone = 'error';
			originInput.focus();
			return;
		}
		originInput.value = saved;
		originMsg.textContent = saved
			? `Saved. Forge tries ${saved} first, then the default port.`
			: 'Cleared. Forge uses the default port 8765.';
		originMsg.dataset.tone = 'ok';
		connect();
	}

	connectBtn.addEventListener('click', () => connect());
	disconnectBtn.addEventListener('click', disconnect);
	originSave?.addEventListener('click', saveOrigin);
	// The panel sits inside the composer <form>: Enter here saves the address
	// instead of submitting a generation.
	originInput?.addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		saveOrigin();
	});
	originInput?.addEventListener('input', () => {
		originInput.removeAttribute('aria-invalid');
		originMsg.textContent = '';
	});

	render();
	return {
		connect,
		disconnect,
		get state() {
			return state;
		},
		/** Show a one-off outcome line in the panel's live region. */
		notify(text) {
			note = String(text || '');
			render();
		},
		readyModels: () => (state.status === 'connected' ? readyModlyModels(state.models) : []),
		modelById: (id) => state.models.find((m) => m.id === id) || null,
	};
}

async function readError(res, fallback) {
	const body = await res.json().catch(() => null);
	return body?.message || body?.error_description || fallback;
}

/**
 * Copy a locally generated GLB into three.ws object storage and return its
 * public https URL. Rig, optimize, game-ready, AR and the avatar library all
 * take a public URL, so this is what lets a local result use the same tools
 * as a cloud one. Uses the presigned GLB upload route (/api/scene-glb-upload)
 * and PUTs the bytes straight to storage.
 */
export async function promoteModlyGlb(blob, { signal } = {}) {
	const presign = await fetch('/api/scene-glb-upload', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ content_type: 'model/gltf-binary', size_bytes: blob.size }),
		signal,
	});
	if (!presign.ok) {
		throw new Error(await readError(presign, `Storage refused the upload (HTTP ${presign.status}).`));
	}
	const slot = await presign.json();
	if (!slot?.upload_url || !slot?.public_url) throw new Error('Storage did not return an upload address.');
	const put = await fetch(slot.upload_url, {
		method: slot.method || 'PUT',
		headers: slot.headers || { 'content-type': 'model/gltf-binary' },
		body: blob,
		signal,
	});
	if (!put.ok) throw new Error(`Storage rejected the file (HTTP ${put.status}).`);
	return slot.public_url;
}

/**
 * Save a promoted GLB into the signed-in user's avatar library through
 * /api/avatars/from-forge. Resolves { ok, status, viewUrl, message }.
 */
export async function saveModlyResultToLibrary({ glbUrl, name, sourcePrompt, modelName }) {
	const tags = ['forge', 'modly'];
	let res;
	try {
		res = await fetch('/api/avatars/from-forge', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				glb_url: glbUrl,
				name: String(name || 'Modly model').slice(0, 80),
				source_prompt: [sourcePrompt, modelName ? `Generated locally with ${modelName} in Modly` : '']
					.filter(Boolean)
					.join(' · ')
					.slice(0, 1000),
				tags,
			}),
		});
	} catch {
		return { ok: false, status: 0, message: 'Could not reach three.ws. Check your connection and try again.' };
	}
	if (res.status === 201) {
		const body = await res.json().catch(() => ({}));
		return { ok: true, status: 201, viewUrl: body?.view_url || '', avatar: body?.avatar || null };
	}
	return { ok: false, status: res.status, message: await readError(res, `Save failed (HTTP ${res.status}).`) };
}
