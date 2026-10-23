// Adapted from @swarming/engine (visualize-web3-realtime, Apache-2.0, (c) nirholas).
// Changes: ported to plain JS; arbitrary weighted nodes and edges instead of the
// hub/leaf grouping model; per-node radius drives collision; bounded node budget.

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force-3d';

const DEFAULTS = {
	charge: -60,
	linkDistance: 9,
	damping: 0.4,
	maxNodes: 5000,
	alphaDecay: 0.02,
};

export class ForceSimulation {
	constructor(physics = {}) {
		this.config = { ...DEFAULTS, ...physics };
		this.nodes = [];
		this.edges = [];
		this.nodeMap = new Map();
		const c = this.config;
		this.simulation = forceSimulation([], 3)
			.force('charge', forceManyBody().strength((d) => c.charge * (0.4 + d.radius * 0.3)))
			.force('center', forceCenter(0, 0, 0).strength(0.05))
			.force('collide', forceCollide().radius((d) => d.radius + 0.4).strength(0.8))
			.force(
				'link',
				forceLink([])
					.id((d) => d.id)
					.distance((l) => (l.distance != null ? l.distance : c.linkDistance))
					.strength(0.5),
			)
			.alphaDecay(c.alphaDecay)
			.velocityDecay(c.damping)
			.stop();
	}

	/** Upsert nodes; pass `edges` to replace the link set, omit to keep it. New nodes spawn near their linked neighbour so growth looks organic. */
	update(nodes, edges = null) {
		let changed = false;
		for (const n of nodes) {
			const existing = this.nodeMap.get(n.id);
			if (existing) {
				if (existing.radius !== n.radius || existing.color !== n.color) changed = true;
				Object.assign(existing, n);
				continue;
			}
			if (this.nodes.length >= this.config.maxNodes) break;
			const anchor = n.anchorId ? this.nodeMap.get(n.anchorId) : null;
			const phi = Math.acos(1 - 2 * Math.random());
			const theta = Math.random() * Math.PI * 2;
			const dist = anchor ? 3 + Math.random() * 4 : 14 + Math.random() * 10;
			const node = {
				...n,
				x: (anchor?.x ?? 0) + Math.sin(phi) * Math.cos(theta) * dist,
				y: (anchor?.y ?? 0) + Math.sin(phi) * Math.sin(theta) * dist,
				z: (anchor?.z ?? 0) + Math.cos(phi) * dist,
			};
			this.nodeMap.set(n.id, node);
			this.nodes.push(node);
			changed = true;
		}
		if (edges) {
			const links = [];
			for (const e of edges) {
				if (this.nodeMap.has(e.source) && this.nodeMap.has(e.target)) {
					links.push({ source: e.source, target: e.target, color: e.color, distance: e.distance });
				}
			}
			if (links.length !== this.edges.length) changed = true;
			this.edges = links;
		}
		if (changed) {
			this.simulation.nodes(this.nodes);
			this.simulation.force('link').links(this.edges);
			this.simulation.alpha(Math.max(this.simulation.alpha(), 0.5));
		}
		return changed;
	}

	tick(n = 1) {
		for (let i = 0; i < n; i++) this.simulation.tick();
	}

	/** Run to rest synchronously (reduced-motion path). */
	settle(maxTicks = 400) {
		this.simulation.stop();
		for (let i = 0; i < maxTicks && this.simulation.alpha() > this.simulation.alphaMin(); i++) {
			this.simulation.tick();
		}
	}

	get alpha() {
		return this.simulation.alpha();
	}

	dispose() {
		this.simulation.stop();
	}
}
