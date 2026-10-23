import { describe, it, expect } from 'vitest';
import { buildGraph, clusterColor } from '../src/funder-graph.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

describe('buildGraph', () => {
	const wallets = [
		{ wallet: `${THREE_MINT}a`, net_sol: 10, cluster: 1, is_creator: true },
		{ wallet: `${THREE_MINT}b`, net_sol: 2.5, cluster: 1 },
		{ wallet: `${THREE_MINT}c`, net_sol: 1, cluster: null },
		{ wallet: `${THREE_MINT}d`, net_sol: 0, cluster: 2 },
		{ wallet: `${THREE_MINT}e`, net_sol: -4, cluster: 2 },
	];
	const g = buildGraph(wallets, [{ cluster: 1, wallets: 2, net_sol: 12.5 }]);

	it('keeps only wallets with a positive net position, plus one funder node per cluster', () => {
		expect(g.nodes.filter((n) => n.kind === 'wallet')).toHaveLength(3);
		expect(g.nodes.filter((n) => n.kind === 'funder').map((n) => n.id)).toEqual(['funder:1']);
	});

	it('links clustered wallets to their funder and leaves independents unlinked', () => {
		expect(g.edges).toHaveLength(2);
		expect(g.edges.every((e) => e.source === 'funder:1')).toBe(true);
	});

	it('sizes nodes by holdings and colors the creator and independents distinctly', () => {
		const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
		expect(byId[`${THREE_MINT}a`].radius).toBeGreaterThan(byId[`${THREE_MINT}b`].radius);
		expect(byId[`${THREE_MINT}b`].radius).toBeGreaterThan(byId[`${THREE_MINT}c`].radius);
		expect(byId[`${THREE_MINT}a`].color).toBe('#fbbf24');
		expect(byId[`${THREE_MINT}c`].color).toBe('#5b6478');
		expect(byId[`${THREE_MINT}b`].color).toBe(clusterColor(1));
	});

	it('returns an empty graph for no holders', () => {
		expect(buildGraph([], []).nodes).toEqual([]);
	});
});
