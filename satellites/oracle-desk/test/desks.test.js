import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Bus } from '../src/bus.js';
import { Ledger } from '../src/ledger.js';
import { Research } from '../src/desks/research.js';
import { Risk } from '../src/desks/risk.js';
import { Audit } from '../src/desks/audit.js';
import { Head } from '../src/desks/head.js';
import { Treasury } from '../src/desks/treasury.js';
import { Execution } from '../src/desks/execution.js';

const CONFIG = JSON.parse(readFileSync(new URL('../desk.config.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-09-30T12:00:00Z');
const MINT = 'THREEsynthetic1111111111111111111111111111';
const coin = (over = {}) => ({
	mint: MINT,
	symbol: 'SYN',
	score: 90,
	tier: 'prime',
	rug_risk: 10,
	give_back_risk: 20,
	pillars: { pedigree: 40, structure: 50, narrative: 10, momentum: 80 },
	smart_wallet_count: 2,
	coin_first_seen_at: new Date(NOW - 60_000).toISOString(),
	...over,
});
const config = () => structuredClone(CONFIG);

function world(walletSol = 5) {
	const bus = new Bus();
	const counters = { launches: 0, graduations: 0, verdicts: 0, cleared: 0, blocked: 0, firewalled: 0, entries: 0, closed: 0 };
	const ledger = new Ledger({ startLamports: walletSol * 1e9, walletLamports: walletSol * 1e9 });
	const cfg = config();
	const research = new Research({ bus, config: cfg, counters, state: {}, now: NOW - 3_600_000 });
	const risk = new Risk({ bus, config: cfg, ledger, state: {} });
	const audit = new Audit({ bus, research, state: {} });
	return { bus, counters, ledger, cfg, research, risk, audit };
}

test('risk refuses at each cap and sizes inside the wallet', () => {
	const { ledger, risk } = world(5);
	assert.equal(risk.refusal(MINT, NOW), null);
	assert.equal(risk.sizeFor({ budget: 1 }), 100_000_000);
	assert.equal(risk.sizeFor({ budget: 2 }), 200_000_000);
	risk.paused = true;
	assert.equal(risk.refusal(MINT, NOW), 'desk paused');
	risk.paused = false;
	risk.frozen = true;
	assert.equal(risk.refusal(MINT, NOW), 'treasury freeze');
	risk.frozen = false;
	ledger.realizedByDay['2026-09-30'] = -1_000_000_000;
	assert.equal(risk.refusal(MINT, NOW), 'daily loss cap');
});

test('risk sizes to zero when the wallet is at its reserve', () => {
	const { risk } = world(0.05);
	assert.equal(risk.sizeFor({ budget: 1 }), 0);
});

test('research lets the seat with the widest margin claim a coin', () => {
	const { research } = world();
	const claim = research.judge(coin(), NOW);
	assert.equal(claim.seat.id, 'SMART-MONEY');
	assert.equal(research.judge(coin({ score: 30 }), NOW), null);
	assert.ok(research.killedBy.min_score > 0);
});

test('audit tightens the binding check after a loss and relaxes it after a clean win', () => {
	const { research, audit } = world();
	const seat = research.seat('PRIME');
	const loss = { id: 't1', mint: MINT, symbol: 'SYN', seat: 'PRIME', coin: coin({ score: 86 }), opened_at: NOW, pnl_lamports: -30, cost_lamports: 100, multiple: 0.7, reason: 'stop_loss' };
	const rev = audit.onClosed(loss, NOW);
	assert.equal(rev.key, 'min_score');
	assert.equal(seat.checks.min_score, 87);

	const win = { ...loss, id: 't2', coin: coin({ score: 87.5 }), pnl_lamports: 90, multiple: 1.9, reason: 'trailing_stop' };
	const relax = audit.onClosed(win, NOW);
	assert.equal(relax.key, 'min_score');
	assert.equal(seat.checks.min_score, 86);

	const smallWin = { ...win, id: 't3', multiple: 1.1, pnl_lamports: 10 };
	assert.equal(audit.onClosed(smallWin, NOW), null);
});

test('audit does not tighten against a loser the current bars already refuse', () => {
	const { audit } = world();
	const trade = { id: 't1', mint: MINT, seat: 'PRIME', coin: coin({ score: 70 }), opened_at: NOW, pnl_lamports: -30, cost_lamports: 100, multiple: 0.7, reason: 'stop_loss' };
	assert.equal(audit.onClosed(trade, NOW), null);
});

test('the head fires a losing seat, rewrites it from its trades, and respects the cooldown', async () => {
	const { bus, ledger, cfg, research, audit } = world();
	const head = new Head({ bus, config: cfg, research, audit, ledger, memo: null, state: { lastReview: NOW - 1 } });
	const seat = research.seat('MOMENTUM');
	const trade = (i, score, pnl) => ({ id: `t${i}`, seat: 'MOMENTUM', coin: coin({ score }), opened_at: NOW - 1000, cost_lamports: 100_000_000, pnl_lamports: pnl, multiple: 1 + pnl / 1e8 });
	ledger.trades.push(trade(1, 71, -60_000_000), trade(2, 72, -50_000_000), trade(3, 74, -40_000_000), trade(4, 90, 30_000_000));

	const out = await head.review(NOW);
	assert.equal(out.fired, 'MOMENTUM');
	assert.equal(seat.fired, 1);
	assert.equal(seat.window_start, NOW);
	assert.equal(seat.checks.min_score, 82);
	assert.ok(audit.revisions.some((r) => r.kind === 'rewrite' && r.seat === 'MOMENTUM'));

	ledger.trades.push(...[5, 6, 7, 8].map((i) => ({ ...trade(i, 91, -50_000_000), opened_at: NOW + 10 })));
	const again = await head.review(NOW + 60_000);
	assert.equal(again.fired, null);
});

test('the head does not judge a seat before it has enough trades', async () => {
	const { bus, ledger, cfg, research, audit } = world();
	const head = new Head({ bus, config: cfg, research, audit, ledger, memo: null, state: {} });
	ledger.trades.push({ id: 't1', seat: 'PRIME', coin: coin(), opened_at: NOW, cost_lamports: 100, pnl_lamports: -90, multiple: 0.1 });
	const out = await head.review(NOW);
	assert.equal(out.fired, null);
	assert.equal(head.decisions.at(-1).kind, 'hold');
});

test('treasury freezes on drawdown, lifts on recovery, and sweeps surplus', async () => {
	const { bus, ledger, cfg, risk } = world(1);
	const broker = { mode: 'paper', sweep: async (l) => ({ sent: false, lamports: l }) };
	const treasury = new Treasury({ bus, config: cfg, ledger, risk, broker, state: { lastSweep: NOW - 7 * 3_600_000 } });
	ledger.walletLamports = 0.5e9;
	assert.equal(treasury.guard(), true);
	ledger.walletLamports = 0.95e9;
	assert.equal(treasury.guard(), false);
	ledger.walletLamports = 2e9;
	await treasury.maybeSweep(NOW);
	assert.equal(ledger.vaultLamports, 0.5e9);
	assert.equal(ledger.walletLamports, 1.5e9);
});

// A scripted broker and firewall: execution's decisions are what is under test.
function scriptedExecution({ quote = {}, marks = [] } = {}) {
	const w = world(5);
	const sells = [];
	let markIndex = 0;
	const broker = {
		mode: 'paper',
		payer: null,
		quoteEntry: async () => ({ venue: 'curve', tokens: 1_000_000n, costLamports: 100_000_000n, priceImpactPct: 0.5, mayhem: false, ...quote }),
		buy: async (_m, lamports) => ({ tokens: 1_000_000n, costLamports: lamports, venue: quote.venue || 'curve', sig: null }),
		mark: async () => marks[Math.min(markIndex++, marks.length - 1)],
		sell: async (_m, tokens) => {
			const value = marks[Math.min(markIndex - 1, marks.length - 1)];
			sells.push(tokens);
			return { soldTokens: tokens, proceedsLamports: Math.round((Number(tokens) / 1_000_000) * value), venue: 'curve', sig: null };
		},
	};
	const firewall = { assess: async () => ({ ok: true, results: [{ check: 'authority', status: 'pass', reason: 'renounced' }] }) };
	const execution = new Execution({ bus: w.bus, config: w.cfg, ledger: w.ledger, risk: w.risk, broker, firewall, venue: null, counters: w.counters });
	const closed = [];
	w.bus.on('closed', (t) => closed.push(t));
	return { ...w, execution, sells, closed };
}

test('execution takes a cleared coin and books the fill', async () => {
	const { execution, ledger, research, counters } = scriptedExecution({ marks: [100_000_000] });
	await execution.onCandidate({ coin: coin(), seat: research.seat('PRIME') });
	assert.equal(counters.entries, 1);
	assert.equal(ledger.open().length, 1);
	assert.equal(ledger.positions[MINT].seat, 'PRIME');
});

test('execution refuses a graduated pool without real SOL behind it', async () => {
	const { execution, ledger, research, counters, risk } = scriptedExecution({ quote: { venue: 'amm', realQuoteLamports: 275_070_272n } });
	await execution.onCandidate({ coin: coin(), seat: research.seat('PRIME') });
	assert.equal(counters.entries, 0);
	assert.equal(ledger.open().length, 0);
	assert.equal(risk.blocks['thin pool'], 1);
});

test('execution refuses an entry the price-impact breaker trips', async () => {
	const { execution, counters, research, risk } = scriptedExecution({ quote: { priceImpactPct: 9 } });
	await execution.onCandidate({ coin: coin(), seat: research.seat('PRIME') });
	assert.equal(counters.entries, 0);
	assert.equal(risk.blocks['price impact'], 1);
});

test('the ladder takes initials at 2x, then rides a bag and grades the trade', async () => {
	const { execution, ledger, research, closed } = scriptedExecution({ marks: [210_000_000, 105_000_000, 70_000_000] });
	await execution.onCandidate({ coin: coin(), seat: research.seat('PRIME') });
	const p = ledger.positions[MINT];

	await execution.sweep(Date.now());
	assert.equal(p.initials_recovered, true);
	assert.equal(p.status, 'open');
	assert.equal(closed.length, 0);

	await execution.sweep(Date.now());
	await execution.sweep(Date.now());
	assert.equal(closed.length, 1);
	assert.equal(p.status, 'bag');
	assert.ok(closed[0].pnl_lamports > 0);
});
