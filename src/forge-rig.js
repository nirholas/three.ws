// Forge: Auto-rig action (browser client).
//
// Adds a "Rig for animation" button to the result action bar. Click it and the
// current GLB goes through the same auto-rig lane the MCP `rig_mesh` tool and
// avatar pipeline use (POST /api/forge?action=rig → the self-hosted GCP model-rig worker,
// falling back to the configured Replicate rerig model), polling through the
// same GET /api/forge?job=<id> contract every other forge job uses. Nothing
// here is a separate mesh-generation lane: it is a skeleton + skin-weight
// pass over the mesh already on screen.
//
// The server checks the model first (api/_lib/rig-preflight.js) and refuses an
// object with no limbs, an oversized or multi-piece model, or one that is
// already rigged, each with a sentence that says why; those refusals are shown
// as they are, with no Retry, because the same model gets the same answer.
//
// A finished rig is checked here before it is shown (src/forge-rig-check.js):
// a skeleton, valid skin weights, and a test animation that plays without the
// mesh exploding. The checked model then replaces the static one in the viewer
// playing that animation, with the camera kept where the user left it, and the
// page's Download hands out the rigged file.
//
// Self-contained on purpose, same pattern as forge-stylize.js: builds its own
// DOM off `forge:model-ready`, owns its own styles, degrades to nothing on a
// page that doesn't have the result actions bar.

import { forgeErrorFromResponse, forgeJobFailedError } from './forge-errors.js';
import {
	RIG_POLL_BUDGET_MS,
	RIG_POLL_INTERVAL_MS,
	formatElapsed,
	isRigRefusal,
	rigWaitMessage,
} from './forge-rig-status.js';

const actions = document.querySelector('#state-result .result-bar .actions');
const resultBar = document.getElementById('state-result');
const viewer = document.getElementById('viewer');

const isTabLocal = (url) => typeof url === 'string' && url.startsWith('blob:');

const LABELS = { idle: 'Rig for animation', working: 'Rigging…', done: 'Rigged', failed: 'Rig for animation' };

if (actions && resultBar && viewer) {
	injectStyles();

	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'btn btn--ghost';
	btn.id = 'forge-rig-btn';
	btn.dataset.state = 'idle';
	btn.title = 'Add a skeleton so this model can be posed and animated';
	btn.innerHTML = `
		<svg class="rig-btn-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="5" r="2" />
			<path d="M12 7v6" />
			<path d="M12 13l-4 7" />
			<path d="M12 13l4 7" />
			<path d="M7 10h10" />
		</svg>
		<span id="forge-rig-label">${LABELS.idle}</span>`;
	const btnLabel = btn.querySelector('#forge-rig-label');

	// Insert right after the AR button (or IRL button if present) so the
	// "make it move" actions cluster together before Refine/Compose/Download.
	const anchorAfter = document.getElementById('forge-irl-btn') || document.getElementById('forge-ar-btn');
	if (anchorAfter && anchorAfter.parentNode === actions) {
		anchorAfter.after(btn);
	} else {
		actions.appendChild(btn);
	}

	const panel = document.createElement('div');
	panel.className = 'rig-panel is-hidden';
	panel.id = 'rig-panel';
	panel.setAttribute('role', 'status');
	panel.setAttribute('aria-live', 'polite');
	resultBar.after(panel);

	const download = document.getElementById('download');

	let originalGlbUrl = '';
	let originalLabel = '';
	let originalCreationId = null;
	let runToken = 0;
	let elapsedTimer = null;
	let unconfigured = false;
	// The rigged result on screen: its server URL (what Download hands out) and
	// the tab-local animated copy the viewer plays.
	let rigged = null;
	// What the viewer and the page's Download looked like before the rigged
	// model replaced them, so "Show original" puts both back exactly.
	let before = null;

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	function setButton(state) {
		btn.dataset.state = state;
		btnLabel.textContent = LABELS[state];
		btn.disabled = state === 'working' || state === 'done' || unconfigured;
		btn.setAttribute('aria-busy', state === 'working' ? 'true' : 'false');
	}

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text != null) node.textContent = text;
		return node;
	}

	function showPanel(kind, ...children) {
		stopElapsed();
		panel.dataset.kind = kind;
		panel.replaceChildren(...children);
		panel.classList.remove('is-hidden');
	}

	function hidePanel() {
		stopElapsed();
		panel.classList.add('is-hidden');
		panel.replaceChildren();
	}

	function stopElapsed() {
		if (elapsedTimer) {
			clearInterval(elapsedTimer);
			elapsedTimer = null;
		}
	}

	// The working state: a spinner, the sentence for the current phase, and an
	// honest elapsed clock. `wait` is updated in place by the poll loop.
	const wait = { phase: 'checking', subject: null, t0: 0 };
	function renderWorking() {
		const text = el('span', 'rig-text');
		const clock = el('span', 'rig-clock');
		clock.setAttribute('aria-hidden', 'true');
		showPanel('working', el('span', 'rig-spinner'), text, clock);
		const tick = () => {
			const elapsedMs = performance.now() - wait.t0;
			text.textContent = rigWaitMessage({ phase: wait.phase, subject: wait.subject, elapsedMs });
			clock.textContent = formatElapsed(elapsedMs);
		};
		tick();
		elapsedTimer = setInterval(tick, 1000);
		return tick;
	}

	// Server and copy-map text is set with textContent, never innerHTML.
	function renderFailure(err, { retry = false, refusal = false } = {}) {
		const glyph = el('span', refusal ? 'rig-info' : 'rig-warn', refusal ? 'i' : '!');
		glyph.setAttribute('aria-hidden', 'true');
		const text = el('span', 'rig-text');
		if (err.title) text.append(el('strong', '', `${String(err.title).replace(/\.$/, '')}. `));
		text.append(err.message || 'Auto-rig did not finish. Try again.');
		const children = [glyph, text];
		if (retry) {
			const button = el('button', 'btn btn--ghost btn--sm rig-retry', 'Try again');
			button.type = 'button';
			button.id = 'rig-retry';
			button.addEventListener('click', runRig);
			children.push(button);
		}
		showPanel(refusal ? 'refused' : 'failed', ...children);
	}

	async function startJob(glbUrl) {
		let res;
		try {
			res = await fetch('/api/forge?action=rig', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					glb_url: glbUrl,
					...(originalCreationId ? { creation_id: originalCreationId } : {}),
					...(originalLabel ? { prompt: originalLabel } : {}),
				}),
			});
		} catch {
			throw Object.assign(forgeErrorFromResponse(0, {}), { retry: true });
		}
		const data = await res.json().catch(() => ({}));
		if (res.status === 501 || data.error === 'rig_unconfigured') {
			const e = forgeErrorFromResponse(res.status, { ...data, error: 'rig_unconfigured' });
			e.kind = 'unconfigured';
			throw e;
		}
		// The model already has a skeleton: nothing to send, show it as it is.
		if (res.status === 409 && data.error === 'already_rigged') {
			return { alreadyRigged: true, glbUrl: data.glb_url || glbUrl, jointCount: data.joint_count };
		}
		// The preflight's refusals are authored for this moment (they say why
		// and what to do instead), so they are shown word for word.
		if (isRigRefusal(res.status, data)) {
			const e = new Error(data.message || 'This model cannot be rigged.');
			e.title = data.title || 'This model cannot be rigged';
			e.refusal = true;
			throw e;
		}
		if (!res.ok) throw Object.assign(forgeErrorFromResponse(res.status, data), { retry: true });
		if (!data.job_id) throw Object.assign(forgeErrorFromResponse(res.status, { error: 'rig_failed' }), { retry: true });
		return data;
	}

	async function pollUntilDone(jobId, token, tick) {
		const deadline = performance.now() + RIG_POLL_BUDGET_MS;
		while (token === runToken && performance.now() < deadline) {
			await sleep(RIG_POLL_INTERVAL_MS);
			if (token !== runToken) return null;
			let res;
			try {
				res = await fetch(`/api/forge?job=${encodeURIComponent(jobId)}`);
			} catch {
				// A dropped connection mid-poll is not a failed job: keep polling.
				continue;
			}
			const data = await res.json().catch(() => ({}));
			if (data.status === 'done' && data.glb_url) return data;
			if (data.status === 'failed') {
				const e = forgeJobFailedError(data.error, 'rig_failed');
				e.message = `${e.message} This attempt does not count against your rig allowance.`;
				e.retry = true;
				throw e;
			}
			if (res.status === 404 || data.error === 'invalid_job' || data.error === 'missing_job') {
				throw Object.assign(forgeErrorFromResponse(res.status, data), { retry: true });
			}
			const phase = data.status === 'queued' ? 'queued' : 'running';
			if (phase !== wait.phase) {
				wait.phase = phase;
				tick();
			}
		}
		if (token !== runToken) return null;
		const e = new Error(
			'The rigger has not finished after 20 minutes. Try again: a job that fails on the server does not count against your rig allowance.',
		);
		e.title = 'Auto-rig is taking too long';
		e.retry = true;
		throw e;
	}

	// ── Check, then show ──────────────────────────────────────────────────────

	let toolsPromise = null;
	function loadTools() {
		toolsPromise ??= Promise.all([
			import('three/addons/loaders/GLTFLoader.js'),
			import('three/addons/exporters/GLTFExporter.js'),
			import('./viewer/internal.js'),
			import('./forge-rig-check.js'),
		]).then(async ([{ GLTFLoader }, { GLTFExporter }, { getDecoders }, check]) => {
			const loader = new GLTFLoader();
			const { dracoLoader, ktx2Loader, meshoptDecoder } = await getDecoders();
			loader.setDRACOLoader(dracoLoader).setMeshoptDecoder(meshoptDecoder);
			if (ktx2Loader) loader.setKTX2Loader(ktx2Loader);
			return { loader, exporter: new GLTFExporter(), check };
		});
		toolsPromise.catch(() => {
			toolsPromise = null;
		});
		return toolsPromise;
	}

	let clipJsonPromise = null;
	function loadTestClip(path) {
		clipJsonPromise ??= fetch(path).then((r) => (r.ok ? r.json() : null)).catch(() => null);
		return clipJsonPromise;
	}

	/**
	 * Load the rigged GLB, run the check, and bake the test clip into a
	 * tab-local copy the viewer can play. Throws a user-facing error when the
	 * rig does not pass.
	 */
	async function checkRigged(url) {
		const { loader, exporter, check } = await loadTools();
		const [gltf, clipJson] = await Promise.all([loader.loadAsync(url), loadTestClip(check.HUMANOID_TEST_CLIP)]);
		const verdict = check.verifyRiggedModel(gltf.scene, { clipJson });
		if (!verdict.ok) {
			const e = new Error(`${verdict.problem.message} Try again: the rigger can land a different skeleton on a second pass.`);
			e.title = 'The rigged model did not pass its check';
			e.retry = true;
			throw e;
		}
		const glb = await exporter.parseAsync(gltf.scene, { binary: true, animations: [verdict.clip] });
		const previewUrl = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
		return { previewUrl, verdict };
	}

	// ── Swap the viewer without losing the user's place ───────────────────────

	const CAMERA_ATTRS = ['camera-orbit', 'camera-target', 'field-of-view', 'autoplay', 'animation-name'];

	function cameraSnapshot() {
		try {
			const orbit = viewer.getCameraOrbit?.();
			const target = viewer.getCameraTarget?.();
			const dims = viewer.getDimensions?.();
			const center = viewer.getBoundingBoxCenter?.();
			const fov = viewer.getFieldOfView?.();
			if (!orbit || !target || !dims || !center) return null;
			return { orbit, target, dims, center, fov };
		} catch {
			return null;
		}
	}

	// The rigged copy can come back at a different size or offset than the
	// static model, so the camera is mapped through the two bounding boxes:
	// same angle, same distance relative to the model, same aim point on it.
	function restoreCamera(snap) {
		if (!snap) return;
		const dims = viewer.getDimensions?.();
		const center = viewer.getBoundingBoxCenter?.();
		if (!dims || !center) return;
		const diag = (v) => Math.hypot(v.x, v.y, v.z);
		const k = diag(snap.dims) > 0 ? diag(dims) / diag(snap.dims) : 1;
		if (!Number.isFinite(k) || k <= 0) return;
		const t = ['x', 'y', 'z'].map((a) => `${center[a] + (snap.target[a] - snap.center[a]) * k}m`);
		viewer.setAttribute('camera-orbit', `${snap.orbit.theta}rad ${snap.orbit.phi}rad ${snap.orbit.radius * k}m`);
		viewer.setAttribute('camera-target', t.join(' '));
		if (Number.isFinite(snap.fov)) viewer.setAttribute('field-of-view', `${snap.fov}deg`);
		viewer.jumpCameraToGoal?.();
	}

	function swapViewer(src, snap, animationName) {
		viewer.addEventListener('load', () => restoreCamera(snap), { once: true });
		if (animationName) {
			viewer.setAttribute('animation-name', animationName);
			viewer.setAttribute('autoplay', '');
		} else {
			viewer.removeAttribute('animation-name');
		}
		viewer.setAttribute('src', src);
	}

	function pointDownload(href, name) {
		if (!download) return;
		if (href == null) download.removeAttribute('href');
		else download.setAttribute('href', href);
		if (name == null) download.removeAttribute('download');
		else download.setAttribute('download', name);
	}

	function riggedFileName() {
		const base = (originalLabel || 'forge').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '') || 'forge';
		return `${base}-rigged.glb`;
	}

	function showRigged() {
		if (!rigged) return;
		if (!before) {
			before = {
				src: viewer.getAttribute('src'),
				attrs: Object.fromEntries(CAMERA_ATTRS.map((a) => [a, viewer.getAttribute(a)])),
				download: download
					? { href: download.getAttribute('href'), name: download.getAttribute('download') }
					: null,
			};
		}
		swapViewer(rigged.previewUrl, cameraSnapshot(), rigged.clipName);
		pointDownload(rigged.url, riggedFileName());
		rigged.showing = true;
	}

	function showOriginal() {
		if (!before) return;
		const snap = cameraSnapshot();
		for (const [attr, value] of Object.entries(before.attrs)) {
			if (attr === 'camera-orbit' || attr === 'camera-target' || attr === 'field-of-view') continue;
			if (value == null) viewer.removeAttribute(attr);
			else viewer.setAttribute(attr, value);
		}
		viewer.addEventListener('load', () => restoreCamera(snap), { once: true });
		viewer.setAttribute('src', before.src);
		if (before.download) pointDownload(before.download.href, before.download.name);
		if (rigged) rigged.showing = false;
	}

	// Put the viewer's camera attributes back as the page had them, so the
	// next model frames itself. Called when a new model replaces this one.
	function forgetRigged() {
		if (before) {
			for (const [attr, value] of Object.entries(before.attrs)) {
				if (value == null) viewer.removeAttribute(attr);
				else viewer.setAttribute(attr, value);
			}
		}
		if (rigged?.previewUrl) URL.revokeObjectURL(rigged.previewUrl);
		rigged = null;
		before = null;
	}

	function renderDone({ note }) {
		const summary = rigged.kind === 'humanoid'
			? `Rigged with ${rigged.bones} bones and playing the idle animation.`
			: `Rigged with ${rigged.bones} bones and playing a test sway.`;
		const check = el('span', 'rig-check', '✓');
		check.setAttribute('aria-hidden', 'true');
		const text = el('span', 'rig-text', note ? `${note} ${summary}` : summary);

		const links = el('div', 'rig-actions');
		const dl = el('a', 'btn btn--ghost btn--sm', 'Download rigged GLB');
		dl.href = rigged.url;
		dl.setAttribute('download', riggedFileName());
		const pose = el('a', 'btn btn--ghost btn--sm', 'Animate in Pose Studio');
		pose.href = `/pose?src=${encodeURIComponent(rigged.url)}`;
		const irl = el('a', 'btn btn--ghost btn--sm', 'Place IRL');
		irl.href = `/irl?avatar=${encodeURIComponent(rigged.url)}`;
		const toggle = el('button', 'btn btn--ghost btn--sm rig-toggle', 'Show original');
		toggle.type = 'button';
		toggle.setAttribute('aria-pressed', 'false');
		toggle.addEventListener('click', () => {
			if (rigged.showing) {
				showOriginal();
				toggle.textContent = 'Show rigged';
				toggle.setAttribute('aria-pressed', 'true');
			} else {
				showRigged();
				toggle.textContent = 'Show original';
				toggle.setAttribute('aria-pressed', 'false');
			}
		});
		links.append(dl, pose, irl, toggle);
		showPanel('done', check, text, links);
	}

	async function finish(url, token, { note = '' } = {}) {
		wait.phase = 'verifying';
		renderWorking();
		const { previewUrl, verdict } = await checkRigged(url);
		if (token !== runToken) {
			URL.revokeObjectURL(previewUrl);
			return;
		}
		forgetRigged();
		rigged = {
			url,
			previewUrl,
			kind: verdict.kind,
			bones: verdict.stats.bones,
			clipName: verdict.clip.name,
			showing: false,
		};
		showRigged();
		setButton('done');
		renderDone({ note });
	}

	async function runRig() {
		if (!originalGlbUrl || unconfigured) return;
		const token = ++runToken;
		setButton('working');
		wait.phase = 'checking';
		wait.subject = null;
		wait.t0 = performance.now();
		const tick = renderWorking();
		try {
			const job = await startJob(originalGlbUrl);
			if (token !== runToken) return;
			if (job.alreadyRigged) {
				const joints = job.jointCount ? ` (${job.jointCount} joints)` : '';
				await finish(job.glbUrl, token, {
					note: `This model already had a skeleton${joints}, so it was not sent to the rigger and nothing was used.`,
				});
				return;
			}
			wait.phase = 'queued';
			wait.subject = job.subject || null;
			tick();
			const done = await pollUntilDone(job.job_id, token, tick);
			if (token !== runToken || !done) return;
			await finish(done.glb_url, token);
		} catch (err) {
			if (token !== runToken) return;
			if (err.kind === 'unconfigured') {
				unconfigured = true;
				btn.title = 'Auto-rigging is not configured on this deployment yet.';
				setButton('failed');
				renderFailure(err);
				return;
			}
			setButton('failed');
			renderFailure(err, { retry: !err.refusal, refusal: Boolean(err.refusal) });
		}
	}

	btn.addEventListener('click', runRig);

	function onNewSource(glbUrl, label, creationId = null) {
		if (!glbUrl || glbUrl === originalGlbUrl || isTabLocal(glbUrl)) return;
		if (rigged && glbUrl === rigged.url) return;
		originalGlbUrl = glbUrl;
		originalLabel = label || '';
		originalCreationId = creationId || null;
		runToken++;
		forgetRigged();
		if (!unconfigured) {
			hidePanel();
			setButton('idle');
		}
	}

	document.addEventListener('forge:model-ready', (e) => {
		onNewSource(e.detail?.glbUrl, e.detail?.label, e.detail?.creationId);
	});

	// Resilient fallback: follow the viewer's src. Tab-local edits (our own
	// animated preview, a Materials look, the Optimize mesh tools) are skipped:
	// the rigger fetches by URL and could not read them.
	const srcObserver = new MutationObserver(() => {
		const url = viewer.getAttribute('src');
		if (!url || url === originalGlbUrl || (before && url === before.src)) return;
		onNewSource(url, document.getElementById('result-label')?.textContent?.trim() || '');
	});
	srcObserver.observe(viewer, { attributes: true, attributeFilter: ['src'] });

	if (viewer.getAttribute('src')) {
		onNewSource(viewer.getAttribute('src'), document.getElementById('result-label')?.textContent?.trim() || '');
	}
}

function injectStyles() {
	if (document.getElementById('forge-rig-styles')) return;
	const style = document.createElement('style');
	style.id = 'forge-rig-styles';
	style.textContent = `
		#forge-rig-btn { position: relative; transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease; }
		#forge-rig-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
		#forge-rig-btn:active:not(:disabled) { transform: translateY(1px); }
		#forge-rig-btn[data-state='working'] { cursor: progress; }
		#forge-rig-btn[data-state='done'] {
			color: var(--success); border-color: color-mix(in srgb, var(--success) 45%, transparent);
			cursor: default; opacity: 1;
		}
		#forge-rig-btn[data-state='failed'] { border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
		.rig-panel {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.6rem;
			margin: 0 var(--space-md, 1rem) var(--space-sm, 0.75rem);
			padding: 0.6rem 0.85rem;
			border: 1px solid var(--stroke);
			border-radius: var(--radius-sm, 8px);
			background: color-mix(in srgb, var(--accent) 6%, transparent);
			font-size: var(--text-sm, 0.85rem);
			color: var(--ink-dim);
			animation: rig-in 0.18s ease-out;
		}
		.rig-panel.is-hidden { display: none; }
		.rig-panel[data-kind='done'] { background: color-mix(in srgb, var(--success) 7%, transparent); border-color: color-mix(in srgb, var(--success) 35%, var(--stroke)); }
		.rig-panel[data-kind='failed'] { background: color-mix(in srgb, var(--danger) 6%, transparent); border-color: color-mix(in srgb, var(--danger) 35%, var(--stroke)); }
		.rig-text { flex: 1 1 16rem; min-width: 0; line-height: 1.45; }
		.rig-text strong { color: var(--ink); }
		.rig-clock { font-variant-numeric: tabular-nums; color: var(--ink-dim); opacity: 0.8; }
		.rig-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-left: auto; }
		.rig-spinner {
			width: 12px; height: 12px; border-radius: 50%; flex: none;
			border: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
			border-top-color: var(--accent);
			animation: rig-spin 0.8s linear infinite;
		}
		.rig-check, .rig-warn, .rig-info {
			flex: none; display: inline-grid; place-items: center;
			width: 1.25rem; height: 1.25rem; border-radius: 50%;
			font-weight: 700; font-size: 0.75rem;
		}
		.rig-check { color: var(--success); background: color-mix(in srgb, var(--success) 15%, transparent); }
		.rig-warn { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }
		.rig-info { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); font-style: italic; font-family: Georgia, serif; }
		@media (max-width: 560px) {
			.rig-actions { margin-left: 0; width: 100%; }
			.rig-actions .btn { flex: 1 1 auto; justify-content: center; }
		}
		@keyframes rig-spin { to { transform: rotate(360deg); } }
		@keyframes rig-in { from { opacity: 0; transform: translateY(-3px); } }
		@media (prefers-reduced-motion: reduce) {
			.rig-spinner { animation: none; }
			.rig-panel { animation: none; }
		}
	`;
	document.head.appendChild(style);
}
