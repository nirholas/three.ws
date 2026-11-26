// Forge — Stylize panel (browser client).
//
// One-click geometric stylization layered onto the forge result viewer. When a
// model becomes available (forge.js dispatches `forge:model-ready`), this panel
// reveals a gallery of filters; clicking one runs a real geometry pass on
// workers/stylize via /api/forge-stylize, polls to completion, and swaps the
// live <model-viewer> to the stylized GLB. A density slider re-applies the
// active filter; "Revert" restores the original. Nothing fakes progress — the
// only timer is an honest elapsed counter.

import { STYLIZE_FILTERS, STYLIZE_FILTER_BY_KEY } from './shared/stylize-filters.js';
import { forgeCopyError, forgeErrorFromResponse, forgeErrorMessage, forgeJobFailedError } from './forge-errors.js';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 3 * 60 * 1000;

const panel = document.getElementById('stylize-panel');
const viewer = document.getElementById('viewer');
if (panel && viewer) {
	const gallery = document.getElementById('stylize-gallery');
	const controls = document.getElementById('stylize-controls');
	const slider = document.getElementById('stylize-res');
	const resLabel = document.getElementById('stylize-res-label');
	const resVal = document.getElementById('stylize-res-val');
	const applyBtn = document.getElementById('stylize-apply');
	const downloadBtn = document.getElementById('stylize-download');
	const revertBtn = document.getElementById('stylize-revert');
	const status = document.getElementById('stylize-status');

	let originalGlbUrl = '';
	let lastStylizedUrl = ''; // the GLB we swapped in; lets the src observer skip our own change
	let baseLabel = '';
	let activeKey = '';
	let runToken = 0; // bumped on each apply/revert to abort stale polls
	let elapsedTimer = null;
	let unconfigured = false;

	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	function setStatus(text, kind = '') {
		status.textContent = text || '';
		status.dataset.kind = kind;
	}

	function stopElapsed() {
		if (elapsedTimer) {
			clearInterval(elapsedTimer);
			elapsedTimer = null;
		}
	}

	function startElapsed(label) {
		stopElapsed();
		const t0 = performance.now();
		const tick = () => {
			const s = Math.floor((performance.now() - t0) / 1000);
			setStatus(`${label} — ${s}s`, 'busy');
		};
		tick();
		elapsedTimer = setInterval(tick, 1000);
	}

	function setBusy(busy) {
		for (const card of gallery.querySelectorAll('.stylize-card')) card.disabled = busy;
		applyBtn.disabled = busy;
		slider.disabled = busy;
		revertBtn.disabled = busy;
		panel.dataset.busy = busy ? 'true' : 'false';
	}

	// Build the filter gallery once. Cards are real buttons — keyboard reachable,
	// with hover/active/focus states defined in the page stylesheet.
	function buildGallery() {
		gallery.innerHTML = '';
		for (const f of STYLIZE_FILTERS) {
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'stylize-card';
			card.dataset.style = f.key;
			card.setAttribute('aria-pressed', 'false');
			card.title = f.blurb;
			card.innerHTML =
				`<span class="stylize-thumb" aria-hidden="true">${f.icon}</span>` +
				`<span class="stylize-name">${f.name}</span>` +
				`<span class="stylize-blurb">${f.blurb}</span>`;
			card.addEventListener('click', () => selectFilter(f.key, { apply: true }));
			gallery.appendChild(card);
		}
	}

	function markActive(key) {
		activeKey = key;
		for (const card of gallery.querySelectorAll('.stylize-card')) {
			card.setAttribute('aria-pressed', String(card.dataset.style === key));
		}
	}

	function syncSlider(key) {
		const spec = STYLIZE_FILTER_BY_KEY[key].resolution;
		slider.min = String(spec.min);
		slider.max = String(spec.max);
		slider.step = '1';
		slider.value = String(spec.def);
		resLabel.textContent = spec.label;
		resVal.textContent = String(spec.def);
		controls.classList.remove('is-hidden');
	}

	function selectFilter(key, { apply }) {
		if (unconfigured || !STYLIZE_FILTER_BY_KEY[key]) return;
		markActive(key);
		syncSlider(key);
		if (apply) runStylize(key, Number(slider.value));
	}

	async function startJob(meshUrl, style, resolution) {
		const res = await fetch('/api/forge-stylize', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mesh_url: meshUrl, style, resolution }),
		});
		const data = await res.json().catch(() => ({}));
		if (res.status === 503 || data.error === 'unconfigured') {
			const e = forgeErrorFromResponse(res.status, { ...data, error: 'unconfigured' });
			e.kind = 'unconfigured';
			throw e;
		}
		if (res.status === 429 || data.error === 'rate_limited') {
			throw forgeErrorFromResponse(429, data);
		}
		if (!res.ok || !data.job_id) {
			throw forgeErrorFromResponse(res.status, res.ok ? { error: 'stylize_failed' } : data);
		}
		return data;
	}

	async function pollUntilDone(jobId, token) {
		const deadline = performance.now() + MAX_POLL_MS;
		while (token === runToken && performance.now() < deadline) {
			await sleep(POLL_INTERVAL_MS);
			if (token !== runToken) return null;
			const res = await fetch(`/api/forge-stylize?job=${encodeURIComponent(jobId)}`);
			const data = await res.json().catch(() => ({}));
			if (data.error === 'unconfigured') {
				const e = forgeErrorFromResponse(503, { ...data, error: 'unconfigured' });
				e.kind = 'unconfigured';
				throw e;
			}
			if (data.status === 'done' && data.result_url) return data;
			if (data.status === 'failed') throw forgeJobFailedError(data.error, 'stylize_failed');
		}
		if (token !== runToken) return null;
		throw forgeCopyError('Stylize is taking too long', 'Stylizing took too long and was stopped. Try again at a lower resolution.');
	}

	async function runStylize(style, resolution) {
		if (!originalGlbUrl) return;
		const token = ++runToken;
		const filter = STYLIZE_FILTER_BY_KEY[style];
		setBusy(true);
		startElapsed(`Stylizing — ${filter.name}`);
		try {
			const job = await startJob(originalGlbUrl, style, resolution);
			const done = await pollUntilDone(job.job_id, token);
			if (token !== runToken || !done) return; // superseded or reverted
			stopElapsed();
			lastStylizedUrl = done.result_url; // so the src observer ignores our own swap
			viewer.setAttribute('src', done.result_url);
			viewer.setAttribute('alt', `${baseLabel} — ${filter.name} stylization`);
			downloadBtn.href = done.result_url;
			downloadBtn.setAttribute(
				'download',
				`${(baseLabel || 'forge').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '') || 'forge'}-${style}.glb`,
			);
			downloadBtn.hidden = false;
			revertBtn.hidden = false;
			const faces = Number(done.face_count) > 0 ? ` · ${Number(done.face_count).toLocaleString()} faces` : '';
			setStatus(`${filter.name} applied${faces}. Adjust ${filter.resolution.label.toLowerCase()} and re-apply, or revert.`, 'done');
		} catch (err) {
			if (token !== runToken) return;
			stopElapsed();
			if (err.kind === 'unconfigured') {
				unconfigured = true;
				panel.dataset.state = 'unconfigured';
				setStatus(
					'Stylization needs the stylize worker configured on this deployment (GCP_STYLIZE_URL). The filters above light up once it’s set.',
					'error',
				);
				// Permanently disable the gallery (nothing to apply) without leaving
				// the thumbs in the busy spin state.
				for (const card of gallery.querySelectorAll('.stylize-card')) card.disabled = true;
				applyBtn.disabled = true;
				slider.disabled = true;
				panel.dataset.busy = 'false';
				return;
			}
			setStatus(forgeErrorMessage(err, 'stylize_failed'), 'error');
		} finally {
			if (token === runToken && !unconfigured) setBusy(false);
		}
	}

	function revert() {
		runToken++; // abort any in-flight poll
		stopElapsed();
		setBusy(false);
		viewer.setAttribute('src', originalGlbUrl);
		viewer.setAttribute('alt', baseLabel || '3D model');
		downloadBtn.hidden = true;
		revertBtn.hidden = true;
		markActive('');
		setStatus('Showing the original model.', '');
	}

	// A new source model became available (freshly forged or opened from the
	// gallery): reset the panel to its idle gallery state for that mesh. Idempotent
	// — re-firing with the current source is a no-op, so the event and the src
	// observer below can both call it without double-resetting.
	function onNewSource(glbUrl, label) {
		if (!glbUrl || glbUrl === originalGlbUrl) return;
		originalGlbUrl = glbUrl;
		baseLabel = label || '';
		runToken++; // abort polls tied to the previous model
		stopElapsed();
		controls.classList.add('is-hidden');
		downloadBtn.hidden = true;
		revertBtn.hidden = true;
		markActive('');
		setStatus(unconfigured ? '' : 'Pick a filter to restyle this model.', '');
		if (!unconfigured) setBusy(false);
		panel.hidden = false;
	}

	// Wiring -------------------------------------------------------------------
	slider.addEventListener('input', () => {
		resVal.textContent = slider.value;
	});
	applyBtn.addEventListener('click', () => {
		if (activeKey) runStylize(activeKey, Number(slider.value));
	});
	revertBtn.addEventListener('click', revert);

	// Primary signal: forge.js announces the model explicitly.
	document.addEventListener('forge:model-ready', (e) => {
		onNewSource(e.detail?.glbUrl, e.detail?.label);
	});

	// Resilient fallback: watch the live viewer's `src` directly so the panel
	// reveals whenever a model loads, even if the explicit event isn't emitted.
	// Our own stylize swaps (lastStylizedUrl) and reverts (== originalGlbUrl) are
	// ignored so they don't get mistaken for a new source mesh.
	const srcObserver = new MutationObserver(() => {
		const url = viewer.getAttribute('src');
		if (!url || url === originalGlbUrl || url === lastStylizedUrl) return;
		onNewSource(url, document.getElementById('result-label')?.textContent?.trim() || '');
	});
	srcObserver.observe(viewer, { attributes: true, attributeFilter: ['src'] });

	// Pick up a model that was already shown before this module finished loading.
	if (viewer.getAttribute('src')) {
		onNewSource(viewer.getAttribute('src'), document.getElementById('result-label')?.textContent?.trim() || '');
	}

	buildGallery();
}
