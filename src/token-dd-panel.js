// Holder due-diligence panel for the token page: the seven due-diligence fields
// (each linked to its definition) and a 3D funding graph of the largest holders,
// read live from GET /api/crypto/due-diligence. Loading is a real skeleton, an
// unreadable field says "not readable" (never a zero), and a failed load offers
// a retry. The graph engine under src/vendor/swarming is lazy-loaded.

import { errorStateHTML, emptyStateHTML } from './shared/state-kit.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const short = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}...${a.slice(-4)}` : a || '');

export const DD_PANEL_CSS = `
.tkdd-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 14px}
.tkdd-f{background:var(--tk-inset);border:1px solid var(--tk-inset-border);border-radius:10px;padding:10px 12px;min-width:0}
.tkdd-f a{color:var(--tk-muted);font-size:12px;text-decoration:none;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tkdd-f a:hover,.tkdd-f a:focus-visible{color:var(--tk-link);text-decoration:underline;outline:none}
.tkdd-v{font-size:22px;font-weight:650;color:var(--tk-strong);margin-top:2px;font-variant-numeric:tabular-nums}
.tkdd-v.na{font-size:14px;font-weight:500;color:var(--tk-dim);line-height:30px}
.tkdd-v.hot{color:var(--tk-warn)}
.tkdd-graph{position:relative;height:340px;border:1px solid var(--tk-inset-border);border-radius:10px;background:var(--tk-inset);overflow:hidden}
.tkdd-graph .fg3d-tip{position:absolute;pointer-events:none;background:var(--tk-surface);border:1px solid var(--tk-border-2);color:var(--tk-text);font-size:12px;padding:4px 8px;border-radius:6px;white-space:nowrap}
.tkdd-legend{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0 0;font-size:12px;color:var(--tk-muted)}
.tkdd-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:baseline}
.tkdd-notes{margin:10px 0 0;padding:0 0 0 18px;font-size:12px;color:var(--tk-muted);line-height:1.5}
.tkdd-meta{font-size:12px;color:var(--tk-dim);margin:8px 0 0}
.tkdd-skel{height:68px;border-radius:10px}
`;

const FIELD_ORDER = ['insider_pct', 'sniper_pct', 'bundler_pct', 'fresh_wallet_pct', 'fresh_wallet_ratio', 'smart_money_holders', 'smart_money_pct'];

function fmtValue(key, v) {
	if (v == null) return null;
	if (key === 'smart_money_holders') return String(v);
	if (key === 'fresh_wallet_ratio') return `${(v * 100).toFixed(0)}%`;
	return `${Number(v).toFixed(v >= 10 ? 1 : 2)}%`;
}

export function renderFields(report) {
	return `<div class="tkdd-fields">${FIELD_ORDER.map((key) => {
		const def = report.definitions?.[key];
		const v = fmtValue(key, report.fields?.[key]);
		const hot = v != null && key !== 'smart_money_holders' && key !== 'smart_money_pct' && Number(report.fields[key]) >= 20;
		return `<div class="tkdd-f"><a href="${esc(def?.doc || '#')}" target="_blank" rel="noopener" title="${esc(def?.definition || '')}">${esc(def?.label || key)}</a>${
			v == null ? '<div class="tkdd-v na">not readable</div>' : `<div class="tkdd-v${hot ? ' hot' : ''}">${esc(v)}</div>`
		}</div>`;
	}).join('')}</div>`;
}

const KIND_COLOR = { holder: '#7CC4FF', program: '#5b6478', funder: '#fb923c', source: '#a78bfa', creator: '#fbbf24' };

export function buildRenderGraph(graph, creator) {
	const nodes = graph.nodes.map((n) => {
		const isCreator = n.id === creator;
		const kind = isCreator ? 'creator' : n.kind;
		return {
			id: n.id,
			kind: 'wallet',
			ddKind: kind,
			radius: n.hop === 0 ? 1.1 + Math.sqrt(Math.max(0, n.pct || 0)) * 0.55 : n.hop === 1 ? 1.1 : 0.8,
			color: KIND_COLOR[kind] || KIND_COLOR.holder,
			net_sol: 0,
			labels: [],
			pct: n.pct || 0,
			service: !!n.service,
			cluster: null,
		};
	});
	const edges = graph.edges.map((e) => ({ source: e.source, target: e.target, color: '#3a3a42' }));
	return { nodes, edges };
}

async function mountGraph(container, report, reducedMotion) {
	const [{ ForceSimulation }, { ThreeRenderer }] = await Promise.all([
		import('./vendor/swarming/ForceSimulation.js'),
		import('./vendor/swarming/ThreeRenderer.js'),
	]);
	const { nodes, edges } = buildRenderGraph(report.graph, report.creator);
	const tip = document.createElement('div');
	tip.className = 'fg3d-tip';
	tip.hidden = true;
	container.appendChild(tip);
	const onHover = (node, x, y) => {
		if (!node) { tip.hidden = true; return; }
		const bits = [short(node.id), node.ddKind, node.pct ? `${node.pct}% of supply` : null, node.service ? 'service (history too long to trace)' : null].filter(Boolean);
		tip.textContent = bits.join(' | ');
		tip.hidden = false;
		tip.style.left = `${Math.max(8, Math.min(container.clientWidth - tip.offsetWidth - 8, x + 12))}px`;
		tip.style.top = `${Math.max(8, y - 34)}px`;
	};
	const renderer = new ThreeRenderer(container, { autoRotate: !reducedMotion, onHover });
	renderer.renderer.domElement.setAttribute('aria-label', `3D funding graph: ${nodes.length} wallets over two funding hops. Drag to rotate, scroll to zoom. The holder fields above summarise the same data.`);
	const sim = new ForceSimulation();
	sim.update(nodes, edges);
	renderer.setData(sim.nodes, sim.edges);
	if (reducedMotion) {
		sim.settle();
		renderer.fit();
	} else {
		let fitted = false;
		renderer.start(() => {
			if (sim.alpha > 0.001) sim.tick();
			else if (!fitted) { fitted = true; renderer.fit(); }
		});
	}
	return () => { sim.dispose(); renderer.dispose(); tip.remove(); };
}

/**
 * @param {HTMLElement} root
 * @param {{ mint: string, fetchImpl?: typeof fetch }} opts
 */
export function mountDueDiligence(root, { mint, fetchImpl = fetch } = {}) {
	let destroyGraph = null;
	let runId = 0;

	const skeleton = () => {
		root.innerHTML = `<div class="tkdd-fields" aria-busy="true">${Array.from({ length: 7 }, () => '<div class="tk-skel tkdd-skel"></div>').join('')}</div><div class="tk-skel" style="height:340px;border-radius:10px"></div>`;
	};

	const failed = (title, body) => {
		root.innerHTML = errorStateHTML({ title, body, actions: [{ label: 'Retry', id: 'dd-retry', primary: true }] });
		root.querySelector('[data-sk-action="dd-retry"]')?.addEventListener('click', load);
	};

	async function load() {
		const run = ++runId;
		destroyGraph?.();
		destroyGraph = null;
		skeleton();
		let report;
		try {
			const resp = await fetchImpl(`/api/crypto/due-diligence?address=${encodeURIComponent(mint)}`);
			if (run !== runId) return;
			if (!resp.ok) return failed('Holder analysis is unavailable', 'The chain data sources did not answer. The token itself is unaffected. Try again in a few seconds.');
			report = await resp.json();
		} catch {
			if (run !== runId) return;
			return failed('Holder analysis is unavailable', 'The request did not complete. Check your connection and try again.');
		}
		if (run !== runId) return;

		const notes = (report.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
		const cov = report.coverage || {};
		const hasGraph = report.graph?.nodes?.length > 0;
		root.innerHTML = `${renderFields(report)}
			${hasGraph ? '<div class="tkdd-graph" data-dd-graph role="img" aria-label="Funding graph"></div>' : emptyStateHTML({ title: 'No holder links to draw', body: 'No funding relationships were readable for the largest holders.' })}
			<div class="tkdd-legend"><span><i style="background:${KIND_COLOR.holder}"></i>Holder</span><span><i style="background:${KIND_COLOR.creator}"></i>Creator</span><span><i style="background:${KIND_COLOR.funder}"></i>Funder (hop 1)</span><span><i style="background:${KIND_COLOR.source}"></i>Funder of funder (hop 2)</span><span><i style="background:${KIND_COLOR.program}"></i>Pool or program</span></div>
			<p class="tkdd-meta">Analysed the ${esc(cov.holders_analyzed ?? 0)} largest accounts (${esc(cov.analyzed_pct ?? 0)}% of supply). Cached ${esc(report.ttl_seconds)}s. Computed ${esc(new Date(report.computed_at).toLocaleTimeString())}.</p>
			${notes ? `<ul class="tkdd-notes">${notes}</ul>` : ''}`;

		if (hasGraph) {
			const host = root.querySelector('[data-dd-graph]');
			const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
			try {
				const teardown = await mountGraph(host, report, reduced);
				if (run !== runId) teardown(); else destroyGraph = teardown;
			} catch {
				host.innerHTML = '<p class="tkdd-meta" style="padding:16px">The 3D graph needs WebGL, which is unavailable here. The fields above carry the same analysis.</p>';
			}
		}
	}

	load();
	return { reload: load, destroy() { runId++; destroyGraph?.(); } };
}
