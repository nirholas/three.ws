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
// Self-contained on purpose, same pattern as forge-stylize.js: builds its own
// DOM off `forge:model-ready`, owns its own styles, degrades to nothing on a
// page that doesn't have the result actions bar.

import { forgeErrorFromResponse, forgeJobFailedError } from './forge-errors.js';

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_MS = 4 * 60 * 1000;

const actions = document.querySelector('#state-result .result-bar .actions');
const resultBar = document.getElementById('state-result');
const viewer = document.getElementById('viewer');

if (actions && resultBar && viewer) {
	injectStyles();

	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'btn btn--ghost';
	btn.id = 'forge-rig-btn';
	btn.title = 'Add a humanoid skeleton so this model can be posed and animated';
	btn.innerHTML = `
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="12" cy="5" r="2" />
			<path d="M12 7v6" />
			<path d="M12 13l-4 7" />
			<path d="M12 13l4 7" />
			<path d="M7 10h10" />
		</svg>
		<span id="forge-rig-label">Rig for animation</span>`;

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

	let originalGlbUrl = '';
	let originalLabel = '';
	let runToken = 0;
	let elapsedTimer = null;
	let unconfigured = false;

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	function setPanel(html) {
		panel.innerHTML = html;
		panel.classList.remove('is-hidden');
	}

	// Error text is set with textContent, never innerHTML: nothing a server
	// returns is ever parsed as markup here.
	function renderError(glyph, err, retryLabel) {
		panel.replaceChildren();
		const icon = document.createElement('span');
		icon.className = 'rig-warn';
		icon.setAttribute('aria-hidden', 'true');
		icon.textContent = glyph;
		const text = document.createElement('span');
		if (err.title) {
			const strong = document.createElement('strong');
			strong.textContent = `${err.title}. `;
			text.append(strong);
		}
		text.append(err.message || 'Auto-rig did not finish. Try again.');
		panel.append(icon, text);
		let button = null;
		if (retryLabel) {
			button = document.createElement('button');
			button.type = 'button';
			button.className = 'btn btn--ghost btn--sm';
			button.id = 'rig-retry';
			button.textContent = retryLabel;
			panel.append(button);
		}
		panel.classList.remove('is-hidden');
		return button;
	}

	function hidePanel() {
		panel.classList.add('is-hidden');
		panel.innerHTML = '';
	}

	function stopElapsed() {
		if (elapsedTimer) {
			clearInterval(elapsedTimer);
			elapsedTimer = null;
		}
	}

	function setBusy(busy) {
		btn.disabled = busy;
		btn.classList.toggle('is-working', busy);
	}

	function renderBusy(label) {
		setPanel(
			`<span class="rig-spinner" aria-hidden="true"></span><span id="rig-status-text">${label}</span>`,
		);
	}

	function startElapsed(seed = 'Rigging') {
		stopElapsed();
		const t0 = performance.now();
		const tick = () => {
			const s = Math.floor((performance.now() - t0) / 1000);
			const node = document.getElementById('rig-status-text');
			if (node) node.textContent = `${seed}: ${s}s`;
		};
		tick();
		elapsedTimer = setInterval(tick, 1000);
	}

	async function startJob(glbUrl) {
		let res;
		try {
			res = await fetch('/api/forge?action=rig', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ glb_url: glbUrl }),
			});
		} catch {
			throw forgeErrorFromResponse(0, {});
		}
		const data = await res.json().catch(() => ({}));
		// Every message comes from the copy map (src/forge-errors.js): the
		// server's `message` can carry the rigger's raw output.
		if (res.status === 501 || data.error === 'rig_unconfigured') {
			const e = forgeErrorFromResponse(res.status, { ...data, error: 'rig_unconfigured' });
			e.kind = 'unconfigured';
			throw e;
		}
		if (!res.ok) throw forgeErrorFromResponse(res.status, data);
		if (!data.job_id) throw forgeErrorFromResponse(res.status, { error: 'rig_failed' });
		return data;
	}

	async function pollUntilDone(jobId, token) {
		const deadline = performance.now() + MAX_POLL_MS;
		while (token === runToken && performance.now() < deadline) {
			await sleep(POLL_INTERVAL_MS);
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
			if (data.status === 'failed') throw forgeJobFailedError(data.error, 'rig_failed');
			if (res.status === 404 || data.error === 'invalid_job' || data.error === 'missing_job') {
				throw forgeErrorFromResponse(res.status, data);
			}
		}
		if (token !== runToken) return null;
		const e = new Error('Rigging is taking longer than it should. Try again: a GPU that was asleep can take a minute to start.');
		e.title = 'Auto-rig is taking too long';
		throw e;
	}

	function renderDone(riggedUrl) {
		stopElapsed();
		const safeLabel = (originalLabel || 'forge').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '') || 'forge';
		setPanel(`
			<span class="rig-check" aria-hidden="true">✓</span>
			<span>Rigged and ready to pose and animate.</span>
			<div class="rig-actions">
				<a class="btn btn--ghost" href="${riggedUrl}" download="${safeLabel}-rigged.glb">Download rigged GLB</a>
				<a class="btn btn--ghost" href="/pose?src=${encodeURIComponent(riggedUrl)}">Animate in Pose Studio</a>
				<a class="btn btn--ghost" href="/irl?avatar=${encodeURIComponent(riggedUrl)}">Place IRL</a>
			</div>
		`);
	}

	async function runRig() {
		if (!originalGlbUrl || unconfigured) return;
		const token = ++runToken;
		setBusy(true);
		renderBusy('Adding a skeleton');
		startElapsed('Rigging');
		try {
			const job = await startJob(originalGlbUrl);
			const done = await pollUntilDone(job.job_id, token);
			if (token !== runToken || !done) return;
			renderDone(done.glb_url);
		} catch (err) {
			if (token !== runToken) return;
			stopElapsed();
			if (err.kind === 'unconfigured') {
				unconfigured = true;
				btn.disabled = true;
				btn.title = 'Auto-rigging is not configured on this deployment yet.';
				renderError('◌', err);
				setTimeout(hidePanel, 6000);
				return;
			}
			const retry = renderError('⚠', err, 'Retry');
			retry.addEventListener('click', runRig);
		} finally {
			if (token === runToken) setBusy(false);
		}
	}

	btn.addEventListener('click', runRig);

	function onNewSource(glbUrl, label) {
		if (!glbUrl || glbUrl === originalGlbUrl) return;
		originalGlbUrl = glbUrl;
		originalLabel = label || '';
		runToken++;
		stopElapsed();
		if (!unconfigured) {
			hidePanel();
			setBusy(false);
		}
	}

	document.addEventListener('forge:model-ready', (e) => {
		onNewSource(e.detail?.glbUrl, e.detail?.label);
	});

	const srcObserver = new MutationObserver(() => {
		const url = viewer.getAttribute('src');
		if (!url || url === originalGlbUrl) return;
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
		#forge-rig-btn.is-working { cursor: progress; opacity: 0.75; }
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
		}
		.rig-panel.is-hidden { display: none; }
		.rig-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-left: auto; }
		.rig-spinner {
			width: 12px; height: 12px; border-radius: 50%; flex: none;
			border: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
			border-top-color: var(--accent);
			animation: rig-spin 0.8s linear infinite;
		}
		.rig-check { color: var(--success); font-weight: 700; }
		.rig-warn { color: var(--danger); }
		@keyframes rig-spin { to { transform: rotate(360deg); } }
		@media (prefers-reduced-motion: reduce) { .rig-spinner { animation: none; } }
	`;
	document.head.appendChild(style);
}
