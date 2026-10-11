// Forge Workflows: what a node shows after it runs.
//
// One persistent host element per node and surface (the canvas card or the
// phone layout). A host is only rebuilt when what it shows actually changed, so
// a 3D preview keeps its camera while other steps report progress.

import { h, icon, ICONS } from './ui.js';

const blobUrls = new Map();

/** A stable object URL for a local model (made on the user's GPU). */
export function blobUrl(blob) {
	let url = blobUrls.get(blob);
	if (!url) {
		url = URL.createObjectURL(blob);
		blobUrls.set(blob, url);
	}
	return url;
}

const exportUrls = new Set();

/** Free every object URL the page made. Called when cached results are dropped. */
export function releaseObjectUrls() {
	for (const url of blobUrls.values()) URL.revokeObjectURL(url);
	blobUrls.clear();
	for (const url of exportUrls) URL.revokeObjectURL(url);
	exportUrls.clear();
}

export function meshSrc(mesh) {
	if (!mesh) return null;
	if (mesh.url) return mesh.url;
	if (mesh.blob) return blobUrl(mesh.blob);
	return null;
}

/**
 * @param {object} opts
 * @param {(nodeId:string) => object|undefined} opts.getNode
 * @param {(nodeId:string) => Array} opts.stepsFor
 * @param {(nodeId:string, iter:number|null) => void} opts.onRetry
 */
export function createResults({ getNode, stepsFor, onRetry, types }) {
	const hosts = { canvas: new Map(), linear: new Map() };
	const page = new Map();
	const shown = new Map();

	function hostFor(nodeId, surface = 'canvas') {
		let el = hosts[surface].get(nodeId);
		if (!el) {
			el = h('div', { class: 'fw-result', dataset: { node: nodeId } });
			hosts[surface].set(nodeId, el);
		}
		return el;
	}

	function viewKey(nodeId, steps, idx) {
		const s = steps[idx];
		if (!s) return 'none';
		const r = s.result || {};
		return [steps.length, idx, s.status, meshSrc(r.mesh) || '', r.download?.href || '', s.error?.message || '', (r.links || []).map((l) => l.href).join(','), r.stats || '', r.note || '', s.reused ? 1 : 0].join('|');
	}

	function pickIndex(nodeId, steps) {
		if (!steps.length) return 0;
		const want = page.get(nodeId);
		if (want != null && want < steps.length) return want;
		// Default to the item that needs attention, else the latest finished one.
		const failed = steps.findIndex((s) => s.status === 'failed');
		if (failed >= 0) return failed;
		for (let i = steps.length - 1; i >= 0; i--) if (steps[i].status === 'done') return i;
		return 0;
	}

	function paint(nodeId, surface = 'canvas') {
		const host = hostFor(nodeId, surface);
		const node = getNode(nodeId);
		if (!node) return;
		const steps = stepsFor(nodeId);
		const idx = pickIndex(nodeId, steps);
		const key = `${surface}:${viewKey(nodeId, steps, idx)}`;
		if (shown.get(host) === key) return;
		shown.set(host, key);
		host.textContent = '';
		const step = steps[idx];
		if (!step || !['done', 'failed'].includes(step.status)) {
			host.hidden = true;
			return;
		}
		host.hidden = false;
		if (steps.length > 1) host.append(pager(nodeId, steps, idx, surface));
		if (step.status === 'failed') host.append(errorBlock(nodeId, step));
		else host.append(...doneBlock(node, step));
	}

	function pager(nodeId, steps, idx, surface) {
		const go = (d) => {
			page.set(nodeId, (idx + d + steps.length) % steps.length);
			paint(nodeId, surface);
		};
		const dot = (s) => (s.status === 'done' ? 'is-done' : s.status === 'failed' ? 'is-failed' : '');
		return h(
			'div',
			{ class: 'fw-pager' },
			h('button', { type: 'button', class: 'fw-icon-btn is-sm', 'aria-label': 'Previous item', on: { click: () => go(-1) } }, '‹'),
			h('span', { class: 'fw-pager-label' }, `Item ${idx + 1} of ${steps.length}`),
			h('span', { class: 'fw-pager-dots', 'aria-hidden': 'true' }, steps.slice(0, 12).map((s, i) => h('span', { class: `fw-pager-dot ${dot(s)} ${i === idx ? 'is-current' : ''}` }))),
			h('button', { type: 'button', class: 'fw-icon-btn is-sm', 'aria-label': 'Next item', on: { click: () => go(1) } }, '›'),
		);
	}

	function errorBlock(nodeId, step) {
		const err = step.error || {};
		return h(
			'div',
			{ class: 'fw-error', role: 'alert' },
			h('div', { class: 'fw-error-msg' }, icon(ICONS.alert, 14), h('span', {}, err.message || 'This step failed.')),
			h(
				'div',
				{ class: 'fw-error-actions' },
				(err.actions || []).map((a) => h('a', { class: 'fw-btn is-sm is-ghost', href: a.href, target: /^https?:/.test(a.href) ? '_blank' : null, rel: /^https?:/.test(a.href) ? 'noopener' : null }, a.label)),
				h('button', { type: 'button', class: 'fw-btn is-sm', on: { click: () => onRetry(nodeId, step.iter) } }, icon(ICONS.retry, 13), err.retryAfter ? `Retry (wait ~${err.retryAfter}s)` : 'Retry'),
			),
		);
	}

	function doneBlock(node, step) {
		const r = step.result || {};
		const out = [];
		const def = types[node.type];
		if (node.type === 'preview' && r.mesh) {
			const viewer = h('model-viewer', {
				class: 'fw-viewer',
				src: meshSrc(r.mesh),
				poster: r.mesh.previewImageUrl || null,
				'camera-controls': true,
				'auto-rotate': true,
				'shadow-intensity': '1',
				exposure: '1',
				'interaction-prompt': 'none',
				'touch-action': 'pan-y',
				alt: `3D preview from ${def?.label || 'the workflow'}`,
			});
			out.push(viewer);
		} else if (node.type === 'image' && r.image?.url) {
			out.push(h('img', { class: 'fw-thumb', src: r.image.url, alt: r.image.name || 'Uploaded photo', loading: 'lazy' }));
		} else if (r.mesh?.previewImageUrl && node.type === 'generate') {
			out.push(h('img', { class: 'fw-thumb', src: r.mesh.previewImageUrl, alt: 'Reference image the model was built from', loading: 'lazy' }));
		}
		const meta = [];
		if (step.reused) meta.push('Reused from the last run');
		else if (r.cached) meta.push('Served from cache');
		if (r.stats) meta.push(r.stats);
		if (r.saved) meta.push('Saved');
		if (meta.length) out.push(h('div', { class: 'fw-result-meta' }, icon(ICONS.check, 12), meta.join(' · ')));
		if (r.note) out.push(h('div', { class: 'fw-result-note' }, r.note));
		const links = [...(r.links || [])];
		if (r.download) {
			if (r.download.objectUrl) exportUrls.add(r.download.objectUrl);
			links.unshift({ label: `Download ${r.download.filename}`, href: r.download.href, download: r.download.filename });
		}
		if (links.length) {
			out.push(
				h(
					'div',
					{ class: 'fw-result-links' },
					links.map((l) =>
						h(
							'a',
							{
								class: 'fw-btn is-sm is-ghost',
								href: l.href,
								download: l.download === true ? '' : l.download || null,
								target: !l.download && /^https?:/.test(l.href) ? '_blank' : null,
								rel: /^https?:/.test(l.href) ? 'noopener' : null,
							},
							l.download ? icon(ICONS.download, 13) : icon(ICONS.link, 13),
							l.label,
						),
					),
				),
			);
		}
		return out;
	}

	function paintAll(nodeIds, surface) {
		for (const id of nodeIds) paint(id, surface);
	}

	/** Forget hosts for nodes that no longer exist. */
	function prune(liveIds) {
		for (const map of Object.values(hosts)) {
			for (const [id, el] of map) {
				if (liveIds.has(id)) continue;
				el.remove();
				map.delete(id);
				page.delete(id);
			}
		}
	}

	function resetPages() {
		page.clear();
	}

	return { hostFor, paint, paintAll, prune, resetPages };
}
