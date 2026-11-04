import { describe, it, expect, vi } from 'vitest';
import { cleanLabel, fmtTradeSize, describeTape, createActivityHub } from '../src/game/activity-feeds.js';

const T = (over) => ({ tx: 'tx1', ts: 1000, isBuy: true, usd: 42, sol: 0.3, trader: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', ...over });

function fakeNet(sessionId = 'me') {
	const h = {};
	return {
		sessionId,
		on: (e, fn) => { (h[e] ||= new Set()).add(fn); return () => h[e].delete(fn); },
		emit: (e, ...a) => (h[e] || []).forEach((fn) => fn(...a)),
		count: () => Object.values(h).reduce((n, s) => n + s.size, 0),
	};
}

describe('cleanLabel', () => {
	it('strips control, zero-width and bidi characters and clamps', () => {
		expect(cleanLabel('a‮b​c\u0007d')).toBe('abcd');
		expect(cleanLabel('  many   spaces\n here ')).toBe('many spaces here');
		expect(cleanLabel('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
		expect(cleanLabel(null)).toBe('');
	});
	it('leaves markup as inert text for textContent', () => {
		expect(cleanLabel('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
	});
});

describe('fmtTradeSize', () => {
	it('formats usd compactly and falls back to SOL', () => {
		expect(fmtTradeSize({ usd: 42.1 })).toBe('$42');
		expect(fmtTradeSize({ usd: 5.5 })).toBe('$5.50');
		expect(fmtTradeSize({ usd: 1234 })).toBe('$1.2K');
		expect(fmtTradeSize({ usd: 25000 })).toBe('$25K');
		expect(fmtTradeSize({ usd: null, sol: 0.5 })).toBe('0.50 SOL');
		expect(fmtTradeSize({})).toBe('');
	});
});

describe('describeTape', () => {
	it('is silent on the backlog and on a stale tape', () => {
		expect(describeTape([T()], { live: false, now: 1000 })).toEqual([]);
		expect(describeTape([T()], { status: 'stale', now: 1000 })).toEqual([]);
	});
	it('truncates the wallet and never emits a full address', () => {
		const [row] = describeTape([T()], { now: 1000 });
		expect(row.text).toBe('Buy $42 · 7xKX…AsU');
		expect(row.text).not.toContain('7xKXtg2CW87d97');
		expect(row.tone).toBe('up');
	});
	it('drops trades from an outage replay', () => {
		expect(describeTape([T({ ts: 0 })], { now: 500_000 })).toEqual([]);
	});
	it('shows the largest three and summarises the rest', () => {
		const batch = [10, 90, 20, 80, 30, 70].map((usd, i) => T({ tx: `t${i}`, usd, isBuy: i % 2 === 0 }));
		const rows = describeTape(batch, { now: 1000 });
		expect(rows).toHaveLength(4);
		expect(rows[0].text).toContain('$90');
		expect(rows[3].text).toMatch(/^3 more trades \(\d buys?, \d sells?\)$/);
	});
	it('skips the hype winner so it is not announced twice', () => {
		expect(describeTape([T({ tx: 'w' })], { now: 1000, skipTx: 'w' })).toEqual([]);
	});
});

describe('activity hub', () => {
	function setup() {
		const ticker = { push: vi.fn(), chime: vi.fn() };
		const flash = vi.fn();
		const hub = createActivityHub({ ticker, coin: { symbol: 'T<b>HREE' }, flash });
		const net = fakeNet();
		hub.bindNet(net);
		return { ticker, flash, hub, net };
	}
	const texts = (ticker) => ticker.push.mock.calls.map(([r]) => r.text);

	it('does not announce the existing roster, then announces real joins and leaves', () => {
		const { ticker, net } = setup();
		net.emit('add', { name: 'Old Timer' }, 'a');
		net.emit('add', { name: 'Me' }, 'me');
		net.emit('synced');
		expect(ticker.push).not.toHaveBeenCalled();
		net.emit('add', { name: 'Mira' }, 'b');
		net.emit('remove', 'b');
		net.emit('remove', 'a');
		expect(texts(ticker)).toEqual(['Mira joined', 'Mira left', 'Old Timer left']);
	});

	it('goes quiet while reconnecting', () => {
		const { ticker, net } = setup();
		net.emit('synced');
		net.emit('status', { status: 'connecting' });
		net.emit('add', { name: 'Zed' }, 'z');
		expect(ticker.push).not.toHaveBeenCalled();
	});

	it('renders wheel wins and boutique unlocks, calling the local player You', () => {
		const { ticker, net } = setup();
		net.emit('add', { name: 'Me' }, 'me');
		net.emit('add', { name: 'Kai' }, 'k');
		net.emit('synced');
		net.emit('activity', { kind: 'wheel', id: 'k', label: 'JACKPOT: 100 Cash' });
		net.emit('activity', { kind: 'cosmetic', id: 'me', label: 'Neon Halo' });
		net.emit('activity', { kind: 'wheel', id: 'k', label: '3 Wood' });
		const calls = ticker.push.mock.calls.map(([r]) => r);
		expect(calls[0]).toMatchObject({ text: 'Kai won JACKPOT: 100 Cash on the wheel', highlight: true });
		expect(calls[1].text).toBe('You unlocked Neon Halo');
		expect(calls[2].highlight).toBe(false);
	});

	it('treats a hostile name as inert text', () => {
		const { ticker, net } = setup();
		net.emit('synced');
		net.emit('add', { name: '‮<script>x</script>' }, 'h');
		expect(ticker.push.mock.calls[0][0].text).toBe('<script>x</script> joined');
	});

	it('learns from the backlog, then celebrates exactly one large live buy', () => {
		const { ticker, flash, hub } = setup();
		const backlog = Array.from({ length: 40 }, (_, i) => T({ tx: `b${i}`, usd: 10 }));
		hub.onTape(backlog, { live: false, status: 'live' });
		expect(ticker.push).not.toHaveBeenCalled();
		const big = T({ tx: 'big', usd: 900, ts: Date.now() });
		hub.onTape([big, T({ tx: 'small', usd: 11, ts: Date.now() })], { live: true, status: 'live' });
		expect(hub.isWhale(big)).toBe(true);
		expect(hub.isWhale(T({ tx: 'small' }))).toBe(false);
		hub.celebrate(big);
		const hype = ticker.push.mock.calls.map(([r]) => r).find((r) => r.kind === 'hype');
		expect(hype.text).toContain('$900');
		expect(hype.text).toContain('$T<b>HREE');
		expect(ticker.chime).toHaveBeenCalledTimes(1);
		expect(flash).toHaveBeenCalledWith(expect.stringContaining('BIG BUY $900'));
		// the winner is not also posted as an ordinary trade row
		expect(ticker.push.mock.calls.map(([r]) => r.text).some((t) => t.startsWith('Buy $900'))).toBe(false);
	});

	it('unsubscribes from the net on dispose', () => {
		const { hub, net } = setup();
		expect(net.count()).toBeGreaterThan(0);
		hub.dispose();
		expect(net.count()).toBe(0);
	});
});

describe('noteWarResult', () => {
	const MINT = 'AAAAmintOurCoin1111111111111111111111111111';
	const OTHER = 'BBBBmintTheirCoin111111111111111111111111';
	const battle = (over = {}) => ({
		matchKey: 'm1',
		winner: MINT,
		a: { mint: MINT, symbol: 'OURS', name: 'Ours', score: 5 },
		b: { mint: OTHER, symbol: 'THEM', name: 'Them', score: 2 },
		...over,
	});
	const make = () => {
		const rows = [];
		const ticker = { push: (r) => (rows.push(r), true), chime: vi.fn() };
		const flash = vi.fn();
		const hub = createActivityHub({ ticker, coin: { symbol: 'OURS' }, flash });
		return { rows, flash, hub, ticker };
	};

	it('a win for this coin posts one highlighted war row and one jumbotron flash', () => {
		const { rows, flash, hub } = make();
		hub.noteWarResult(battle(), { mint: MINT });
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'war', highlight: true, tone: 'up' });
		expect(rows[0].text).toContain('$OURS');
		expect(rows[0].text).toContain('5:2');
		expect(flash).toHaveBeenCalledTimes(1);
		expect(flash.mock.calls[0][0].length).toBeLessThanOrEqual(60);
	});
	it('the same matchKey reported twice (poll, return link, feed) shows once', () => {
		const { rows, flash, hub } = make();
		hub.noteWarResult(battle(), { mint: MINT });
		hub.noteWarResult(battle(), { mint: MINT });
		expect(rows).toHaveLength(1);
		expect(flash).toHaveBeenCalledTimes(1);
	});
	it('a loss is a quiet row with no flash and no highlight', () => {
		const { rows, flash, hub } = make();
		hub.noteWarResult(battle({ winner: OTHER, a: { mint: MINT, symbol: 'OURS', score: 1 }, b: { mint: OTHER, symbol: 'THEM', score: 4 } }), { mint: MINT });
		expect(rows).toHaveLength(1);
		expect(rows[0].highlight).toBeFalsy();
		expect(rows[0].tone).toBe('down');
		expect(rows[0].text).toMatch(/\$THEM took the war/);
		expect(flash).not.toHaveBeenCalled();
	});
	it('a draw reads as a draw', () => {
		const { rows, flash, hub } = make();
		hub.noteWarResult(battle({ winner: 'draw', a: { mint: MINT, symbol: 'OURS', score: 3 }, b: { mint: OTHER, symbol: 'THEM', score: 3 } }), { mint: MINT });
		expect(rows[0].text).toMatch(/drew/i);
		expect(rows[0].text).toContain('3:3');
		expect(flash).not.toHaveBeenCalled();
	});
	it('reads sides correctly when this coin is side b', () => {
		const { rows, hub } = make();
		hub.noteWarResult(
			battle({ winner: MINT, a: { mint: OTHER, symbol: 'THEM', score: 2 }, b: { mint: MINT, symbol: 'OURS', score: 6 } }),
			{ mint: MINT },
		);
		expect(rows[0].text).toContain('6:2');
		expect(rows[0].highlight).toBe(true);
	});
	it('cleans untrusted coin names and caps the flash at 60 characters', () => {
		const { rows, flash, hub } = make();
		const evil = 'X‮Y​' + 'Z'.repeat(80);
		hub.noteWarResult(battle({ matchKey: 'm2', b: { mint: OTHER, symbol: '', name: evil, score: 1 } }), { mint: MINT });
		expect(rows[0].text).not.toMatch(/[‮​]/);
		expect(flash.mock.calls[0][0].length).toBeLessThanOrEqual(60);
		expect(flash.mock.calls[0][0]).not.toMatch(/[‮​]/);
	});
	it('ignores malformed input and battles without a matchKey', () => {
		const { rows, hub } = make();
		hub.noteWarResult(null, { mint: MINT });
		hub.noteWarResult({ winner: MINT }, { mint: MINT });
		hub.noteWarResult(battle(), {});
		expect(rows).toHaveLength(0);
	});
	it('bounds the dedupe memory', () => {
		const { rows, hub } = make();
		for (let i = 0; i < 300; i++) hub.noteWarResult(battle({ matchKey: 'k' + i }), { mint: MINT });
		expect(rows).toHaveLength(300);
		hub.noteWarResult(battle({ matchKey: 'k0' }), { mint: MINT });
		expect(rows.length).toBeLessThanOrEqual(301);
	});
});
