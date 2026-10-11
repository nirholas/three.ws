import { describe, it, expect } from 'vitest';
import { loadTickerItems } from '../src/desktop/world/ticker.js';

const ok = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const down = () => Promise.resolve({ ok: false, json: () => Promise.reject(new Error('no body')) });

describe('exchange ticker feed', () => {
	it('reads the real market feed shape ({ coins }) and leads with $THREE', async () => {
		const fetchFn = (url) => {
			if (url.startsWith('/api/three-token/stats')) return ok({ token: { price_usd: 0.000504, price_change_24h: -0.1 } });
			if (url.startsWith('/api/coin/markets')) return ok({ coins: [{ symbol: 'AAA', price: 83009, change_24h: 0.47 }, { symbol: 'BBB', price: 1800, change_24h: -1.2 }] });
			return down();
		};
		const { items, notes } = await loadTickerItems(fetchFn);
		expect(notes).toEqual([]);
		expect(items[0]).toMatchObject({ symbol: '$THREE', price: 0.000504, lead: true });
		expect(items.slice(1).map((i) => i.symbol)).toEqual(['AAA', 'BBB']);
		expect(items[1].change).toBe(0.47);
	});
	it('still accepts a bare array or a rows field', async () => {
		const bare = await loadTickerItems((url) => (url.startsWith('/api/coin/markets') ? ok([{ symbol: 'CCC', price: 150, change_24h: 2 }]) : down()));
		expect(bare.items.map((i) => i.symbol)).toEqual(['CCC']);
		const rows = await loadTickerItems((url) => (url.startsWith('/api/coin/markets') ? ok({ rows: [{ symbol: 'CCC', price: 150, change_24h: 2 }] }) : down()));
		expect(rows.items.map((i) => i.symbol)).toEqual(['CCC']);
	});
	it('reports each feed that is down instead of inventing prices', async () => {
		const { items, notes, three } = await loadTickerItems(() => down());
		expect(items).toEqual([]);
		expect(three).toBeNull();
		expect(notes).toEqual(['$THREE feed offline', 'market feed offline']);
		const thrown = await loadTickerItems(() => Promise.reject(new Error('network')));
		expect(thrown.notes).toHaveLength(2);
	});
});
