// 3D funder graph for the coin intel drawer. Wallets are GPU-instanced spheres
// sized by net SOL; wallets that share a SOL funder link to a funder node.
// The engine under src/vendor/swarming is lazy-loaded by the caller.

import { ForceSimulation } from './vendor/swarming/ForceSimulation.js';
import { ThreeRenderer } from './vendor/swarming/ThreeRenderer.js';

const CLUSTER_PALETTE = ['#f87171', '#fb923c', '#22d3ee', '#a78bfa', '#f472b6', '#a3e635', '#38bdf8', '#fb7185'];
const INDEPENDENT = '#5b6478';
const CREATOR = '#fbbf24';
const MAX_LIVE_NODES = 600;

export const clusterColor = (i) => CLUSTER_PALETTE[Math.abs(Number(i) || 0) % CLUSTER_PALETTE.length];

const shortAddr = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '');
const fmtSol = (n) => `${(Number(n) || 0).toFixed(Math.abs(n) >= 100 ? 0 : 2)} SOL`;

export function buildGraph(wallets, clusters = []) {
	const holders = wallets.filter((w) => (w.net_sol || 0) > 0);
	const maxNet = Math.max(1e-9, ...holders.map((w) => w.net_sol));
	const radiusOf = (net) => 0.9 + Math.sqrt(Math.max(0, net) / maxNet) * 3.4;
	const nodes = [];
	const edges = [];
	const seenClusters = new Set();
	for (const w of holders) {
		const hasCluster = w.cluster != null;
		const color = w.is_creator ? CREATOR : hasCluster ? clusterColor(w.cluster) : INDEPENDENT;
		const funderId = hasCluster ? `funder:${w.cluster}` : null;
		nodes.push({
			id: w.wallet,
			kind: 'wallet',
			radius: radiusOf(w.net_sol),
			color,
			net_sol: w.net_sol,
			is_creator: !!w.is_creator,
			labels: w.labels || [],
			cluster: hasCluster ? w.cluster : null,
			anchorId: funderId,
		});
		if (hasCluster) seenClusters.add(w.cluster);
	}
	const info = new Map(clusters.map((c) => [c.cluster, c]));
	const funders = [...seenClusters].map((id) => ({
		id: `funder:${id}`,
		kind: 'funder',
		radius: 1.1,
		color: clusterColor(id),
		cluster: id,
		wallets: info.get(id)?.wallets ?? holders.filter((w) => w.cluster === id).length,
		net_sol: info.get(id)?.net_sol ?? 0,
	}));
	for (const w of nodes) {
		if (w.cluster != null) edges.push({ source: `funder:${w.cluster}`, target: w.id, color: clusterColor(w.cluster) });
	}
	return { nodes: [...funders, ...nodes], edges, radiusOf, maxNet };
}

export function mountFunderGraph(container, { wallets, clusters, mint, reducedMotion = false, onError } = {}) {
	const graph = buildGraph(wallets || [], clusters || []);
	container.classList.add('fg3d');
	const tip = document.createElement('div');
	tip.className = 'fg3d-tip';
	tip.hidden = true;
	tip.setAttribute('role', 'status');
	container.appendChild(tip);

	const onHover = (node, x, y) => {
		if (!node) { tip.hidden = true; return; }
		tip.textContent = node.kind === 'funder'
			? `Shared funder · ${node.wallets} wallets${node.net_sol ? ` · ${fmtSol(node.net_sol)}` : ''}`
			: `${shortAddr(node.id)}${node.is_creator ? ' (creator)' : ''} · net ${fmtSol(node.net_sol)}${node.labels?.length ? ` · ${node.labels.join(', ')}` : ''}`;
		tip.hidden = false;
		const pad = 8;
		const w = tip.offsetWidth;
		tip.style.left = `${Math.max(pad, Math.min(container.clientWidth - w - pad, x + 12))}px`;
		tip.style.top = `${Math.max(pad, y - 34)}px`;
	};

	let renderer;
	try {
		renderer = new ThreeRenderer(container, { autoRotate: !reducedMotion, onHover, onContextLost: () => onError?.(new Error('webgl_context_lost')) });
	} catch (err) {
		tip.remove();
		throw err;
	}
	renderer.renderer.domElement.setAttribute(
		'aria-label',
		`3D wallet network: ${graph.nodes.filter((n) => n.kind === 'wallet').length} wallets, ${graph.nodes.filter((n) => n.kind === 'funder').length} shared-funder clusters. Drag to rotate, scroll or plus and minus to zoom. The order book below lists the same wallets.`,
	);

	const sim = new ForceSimulation();
	sim.update(graph.nodes, graph.edges);
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

	// ── live mode: trades-stream applies buys/sells to wallet nodes ─────────
	let es = null;
	let liveStatus = 'off';
	let statusCb = () => {};
	const setStatus = (s) => { liveStatus = s; statusCb(s); };
	const radiusFor = (net) => 0.9 + Math.sqrt(net / Math.max(graph.maxNet, net)) * 3.4;
	const applyTrade = (side, d) => {
		const trader = d && (d.trader || d.traderPublicKey);
		const amt = Number(d && (d.solAmount ?? d.sol_amount));
		if (!trader || !Number.isFinite(amt)) return;
		const existing = sim.nodeMap.get(trader);
		const delta = side === 'sell' ? -amt : amt;
		if (existing) {
			if (existing.kind !== 'wallet') return;
			const net = Math.max(0, (existing.net_sol || 0) + delta);
			sim.update([{ id: trader, net_sol: net, radius: radiusFor(net), color: existing.color }]);
		} else if (delta > 0 && sim.nodes.length < MAX_LIVE_NODES) {
			sim.update([{ id: trader, kind: 'wallet', radius: radiusFor(delta), color: INDEPENDENT, net_sol: delta, labels: ['live'], cluster: null }]);
			renderer.setData(sim.nodes, sim.edges);
		}
		if (reducedMotion) { sim.settle(60); renderer.requestRender(); }
	};
	const connect = () => {
		if (!mint) return;
		es = new EventSource(`/api/pump/trades-stream?mint=${encodeURIComponent(mint)}`);
		es.addEventListener('open', () => setStatus('live'));
		const handler = (side) => (e) => { try { applyTrade(side, JSON.parse(e.data)); setStatus('live'); } catch { /* malformed frame */ } };
		es.addEventListener('buy', handler('buy'));
		es.addEventListener('sell', handler('sell'));
		es.addEventListener('notice', () => setStatus('degraded'));
		es.addEventListener('close', () => { es?.close(); if (liveStatus !== 'off') setTimeout(connect, 600); });
		es.onerror = () => { setStatus('connecting'); es?.close(); if (liveStatus !== 'off') setTimeout(connect, 2500); };
	};

	return {
		get nodeCount() { return sim.nodes.length; },
		renderer,
		sim,
		setLive(on, cb) {
			statusCb = cb || statusCb;
			if (on) { setStatus('connecting'); connect(); }
			else { setStatus('off'); es?.close(); es = null; }
		},
		destroy() {
			liveStatus = 'off';
			es?.close();
			sim.dispose();
			renderer.dispose();
			tip.remove();
			container.classList.remove('fg3d');
		},
	};
}
