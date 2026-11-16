// "OpenUSD (simulation-ready)": export a stored Forge creation as a validated
// OpenUSD package for NVIDIA Omniverse and Isaac Sim (POST/GET
// /api/forge/export-usd, run by workers/usd-export). The package carries
// CoACD collision hulls, a rigid body with mass from volume times a category
// density, semantic labels and, for rigged avatars, UsdSkel skeletons and
// animations. Every file passes OpenUSD's usdchecker and the NVIDIA asset
// validator before it is offered.
//
// The export is a real server job (10 to 60 s of convex decomposition), so the
// row shows each stage as the worker reports it, then opens a small result
// panel with the files and what was measured. Like the PowerPoint row it works
// from the stored creation, so an unsaved in-browser edit is refused with a
// message instead of quietly exporting the unedited model.

export const USD_ENDPOINT = '/api/forge/export-usd';
const POLL_MS = 2_000;
const TIMEOUT_MS = 6 * 60_000;

export class UsdExportError extends Error {
	constructor(message, code) {
		super(message);
		this.name = 'UsdExportError';
		this.code = code;
	}
}

/** What to tell the user for a failed request, by status and server body. */
export function usdErrorMessage(status, body = {}) {
	const server = body.error_description || body.error_message;
	if (status === 404 && body.error === 'job_not_found') return 'The export expired. Start it again.';
	if (status === 404)
		return 'This model is private or no longer available. Only public and unlisted models export to OpenUSD: make it unlisted, then try again.';
	if (status === 429) return 'Too many OpenUSD exports this hour. Try again later.';
	if (status === 503) return 'OpenUSD export is not available on this server right now.';
	if (status === 400 && server) return server;
	if (status >= 500) return 'The OpenUSD exporter is not answering right now. Try again in a minute.';
	return server || `The export failed (${status}). Try again.`;
}

async function request(url, init) {
	let res;
	try {
		res = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.headers || {}) } });
	} catch {
		throw new UsdExportError('Could not reach three.ws. Check your connection and try again.', 'network');
	}
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new UsdExportError(usdErrorMessage(res.status, body), body.error || `http_${res.status}`);
	return body;
}

/**
 * Export a creation and resolve with the finished job
 * ({ files, summary, ... }). `onProgress(job)` sees every poll.
 * `isCancelled()` stops polling quietly when the model on screen changes.
 */
export async function exportUsd(creationId, { onProgress = () => {}, isCancelled = () => false } = {}) {
	if (!creationId) throw new UsdExportError('Save the model first, then export it.', 'no_creation');
	let job = await request(USD_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ id: creationId }),
	});
	const deadline = Date.now() + TIMEOUT_MS;
	while (job.status !== 'done' && job.status !== 'error') {
		onProgress(job);
		if (isCancelled()) return null;
		if (Date.now() > deadline)
			throw new UsdExportError('The export is taking longer than expected. Try again in a few minutes.', 'timeout');
		await new Promise((r) => setTimeout(r, POLL_MS));
		if (isCancelled()) return null;
		job = await request(`${USD_ENDPOINT}?job=${encodeURIComponent(job.job)}`);
	}
	if (job.status === 'error') throw new UsdExportError(job.error || 'The export failed. Try again.', 'export_failed');
	onProgress(job);
	return job;
}

function fmtMass(kg) {
	if (kg == null) return null;
	if (kg >= 1000) return `${(kg / 1000).toFixed(kg >= 10000 ? 0 : 1)} t`;
	if (kg >= 1) return `${kg.toFixed(kg >= 100 ? 0 : 1)} kg`;
	return `${Math.round(kg * 1000)} g`;
}

function fmtSize(size) {
	if (!Array.isArray(size)) return null;
	return size.map((v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3))).join(' x ') + ' m';
}

function countFindings(validation, key) {
	let n = 0;
	for (const kind of ['usd', 'usdz']) {
		for (const tool of Object.values(validation?.[kind] || {})) n += tool?.[key] || 0;
	}
	return n;
}

// The status column is narrow; the full stage label goes to the progress bar's
// aria-valuetext and tooltip instead.
const STAGE_WORDS = {
	queued: 'queued',
	fetching: 'downloading',
	converting: 'converting',
	physics: 'collision',
	packaging: 'packaging',
	validating: 'validating',
	uploading: 'publishing',
};

const STYLE = `
	.usd-row { display: block; }
	.usd-row .export-item .fmt { flex-shrink: 0; }
	.usd-row .usd-bar {
		display: block; height: 3px; margin: 0.35rem 0.7rem 0; border-radius: 2px;
		background: var(--surface-3, rgba(255,255,255,0.08)); overflow: hidden;
	}
	.usd-row .usd-bar > i {
		display: block; height: 100%; width: 0; border-radius: 2px;
		background: var(--accent, #7c6cff); transition: width 0.4s ease;
	}
	.usd-result {
		margin: 0.25rem 0.45rem 0.4rem; padding: 0.55rem 0.65rem;
		border: 1px solid var(--border, rgba(255,255,255,0.12)); border-radius: 9px;
		font-size: 0.76rem; line-height: 1.4;
	}
	.usd-result .usd-facts { opacity: 0.82; margin: 0 0 0.45rem; }
	.usd-result .usd-files { display: flex; flex-wrap: wrap; gap: 0.35rem; }
	.usd-result a.usd-file {
		display: inline-flex; align-items: center; padding: 0.28rem 0.55rem;
		border: 1px solid var(--border, rgba(255,255,255,0.16)); border-radius: 7px;
		color: inherit; text-decoration: none; font-weight: 600; font-size: 0.74rem;
		transition: background 0.12s ease, border-color 0.12s ease;
	}
	.usd-result a.usd-file:hover { background: var(--surface-3, rgba(255,255,255,0.08)); }
	.usd-result a.usd-file:active { transform: translateY(1px); }
	.usd-result a.usd-file:focus-visible, .usd-result .usd-more a:focus-visible {
		outline: 2px solid var(--accent, #7c6cff); outline-offset: 1px;
	}
	.usd-result .usd-more { margin-top: 0.45rem; opacity: 0.72; }
	.usd-result .usd-more a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
	.usd-result .usd-more a:hover { opacity: 1; }
	@media (prefers-reduced-motion: reduce) { .usd-row .usd-bar > i { transition: none; } }
`;

/**
 * The OpenUSD row in the Forge export menu. Hidden until a stored model is on
 * screen, like the slicer, Minecraft and PowerPoint rows.
 */
export function mountOpenUsdMenuItem(menu, { isLocalEdit = () => false } = {}) {
	if (!document.getElementById('forge-openusd-style')) {
		const style = document.createElement('style');
		style.id = 'forge-openusd-style';
		style.textContent = STYLE;
		document.head.appendChild(style);
	}

	let creationId = null;
	let epoch = 0;
	let busy = false;

	const row = document.createElement('div');
	row.className = 'usd-row';
	row.hidden = true;

	const item = document.createElement('button');
	item.type = 'button';
	item.className = 'export-item';
	item.setAttribute('role', 'menuitem');
	item.dataset.format = 'openusd';
	item.innerHTML = `
		<span class="fmt">OpenUSD</span>
		<span class="blurb">Simulation-ready for Omniverse and Isaac Sim: collision, mass, labels and skeletons. Validated.</span>
		<span class="status" aria-live="polite"></span>`;
	const status = item.querySelector('.status');

	const bar = document.createElement('span');
	bar.className = 'usd-bar';
	bar.hidden = true;
	bar.setAttribute('role', 'progressbar');
	bar.setAttribute('aria-label', 'OpenUSD export progress');
	bar.setAttribute('aria-valuemin', '0');
	bar.setAttribute('aria-valuemax', '100');
	bar.innerHTML = '<i></i>';
	const fill = bar.firstElementChild;

	const result = document.createElement('div');
	result.className = 'usd-result';
	result.hidden = true;

	row.append(item, bar, result);
	menu.appendChild(row);

	function reset() {
		status.textContent = '';
		status.classList.remove('is-error');
		bar.hidden = true;
		fill.style.width = '0';
		result.hidden = true;
		result.replaceChildren();
	}

	function showProgress(job) {
		const pct = Math.max(4, Math.round((job.progress || 0) * 100));
		bar.hidden = false;
		fill.style.width = `${pct}%`;
		bar.setAttribute('aria-valuenow', String(pct));
		bar.setAttribute('aria-valuetext', job.stage_label || job.stage || 'working');
		bar.title = job.stage_label || '';
		const ids = (job.stages || []).map((st) => st.id);
		const step = ids.indexOf(job.stage);
		status.innerHTML = '<span class="export-spinner" aria-hidden="true"></span> ';
		status.append(
			document.createTextNode(
				`${STAGE_WORDS[job.stage] || 'working'}${step >= 0 ? ` ${step + 1}/${ids.length}` : ''}`,
			),
		);
	}

	function showResult(job) {
		const s = job.summary || {};
		const facts = [
			s.label,
			fmtSize(s.size_m),
			fmtMass(s.mass_kg),
			s.rigged ? `${s.joints} joints, kinematic` : s.hulls ? `${s.hulls} collision hulls` : null,
			`${countFindings(s.validation, 'errors')} validator errors, ${countFindings(s.validation, 'warnings')} warnings`,
		].filter(Boolean);
		const p = document.createElement('p');
		p.className = 'usd-facts';
		p.textContent = facts.join(' · ');

		const files = document.createElement('div');
		files.className = 'usd-files';
		for (const [key, label, title] of [
			['usdz', '.usdz', 'Single file with textures. Drag into Omniverse or Isaac Sim.'],
			['zip', '.usd + textures', 'Binary USD and its textures folder, zipped'],
			['usda', '.usda', 'Text USD, readable and diff-able'],
		]) {
			if (!job.files?.[key]) continue;
			const a = document.createElement('a');
			a.className = 'usd-file';
			a.href = job.files[key];
			a.textContent = label;
			a.title = title;
			a.setAttribute('download', '');
			a.rel = 'noopener';
			files.appendChild(a);
		}
		const more = document.createElement('p');
		more.className = 'usd-more';
		more.innerHTML = 'Mass method, every validator finding and the class used: ';
		const report = document.createElement('a');
		report.href = job.files?.report || '#';
		report.target = '_blank';
		report.rel = 'noopener';
		report.textContent = 'report.json';
		const docs = document.createElement('a');
		docs.href = '/docs/openusd-export';
		docs.textContent = 'how it works';
		more.append(report, document.createTextNode(' · '), docs);
		result.replaceChildren(p, files, more);
		result.hidden = false;
		// The menu scrolls when it is taller than the screen; bring the files
		// into its view without moving the page underneath.
		const box = menu.getBoundingClientRect();
		const end = result.getBoundingClientRect().bottom;
		if (end > box.bottom) menu.scrollTop += end - box.bottom + 6;
	}

	item.addEventListener('click', async () => {
		if (busy || !creationId) return;
		reset();
		if (isLocalEdit()) {
			status.textContent = 'exports the saved model only: reset your mesh edits first';
			status.classList.add('is-error');
			return;
		}
		busy = true;
		const mine = ++epoch;
		item.setAttribute('aria-disabled', 'true');
		item.setAttribute('aria-busy', 'true');
		status.innerHTML = '<span class="export-spinner" aria-hidden="true"></span> starting';
		try {
			const job = await exportUsd(creationId, {
				onProgress: (j) => mine === epoch && showProgress(j),
				isCancelled: () => mine !== epoch,
			});
			if (!job || mine !== epoch) return;
			bar.hidden = true;
			status.textContent = 'ready ✓';
			showResult(job);
		} catch (err) {
			if (mine !== epoch) return;
			bar.hidden = true;
			status.textContent = err?.message || 'The export failed. Try again.';
			status.classList.add('is-error');
		} finally {
			if (mine === epoch) {
				busy = false;
				item.removeAttribute('aria-disabled');
				item.removeAttribute('aria-busy');
			}
		}
	});

	return {
		setCreation(id) {
			epoch += 1;
			busy = false;
			item.removeAttribute('aria-disabled');
			item.removeAttribute('aria-busy');
			creationId = id || null;
			row.hidden = !creationId;
			item.hidden = !creationId;
			reset();
		},
	};
}
