// Activity feeds: turns the world's real event sources into ticker rows and
// hype moments. The DOM lives in activity-ticker.js; this module is the glue
// plus the pure helpers (cleaning, formatting, trade batching) that are
// unit-tested without a browser (tests/activity-feeds.test.js).
//
// Sources, all real:
//   trade tape      chart-screen.js onTape  (/api/pump/coin-trades, hood worlds too)
//   joins/leaves    community-net.js add/remove, only after the room's first sync
//   wheel wins and  community-net.js 'activity' (WalkRoom._announce, room-wide)
//   boutique buys
//   quests          community-net.js questComplete (your own completions)
//   x402 cosmetics  noteLocalPurchase() from the shop's onPurchased
//
// Privacy: wallet addresses are truncated, names are the nameplate name, no row
// links anywhere, and everything is plain text.

import { shortAddress } from '../shared/address.js';
import { createHypeDirector, sizeOf } from './hype-threshold.js';

// Controls, zero-width and bidi-override characters can reorder or hide text in
// a feed (a name that renders as another name). Strip them, collapse whitespace.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** Make untrusted display text safe for a one-line feed row. */
export function cleanLabel(value, max = 40) {
	if (value == null) return '';
	const s = String(value).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
	return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** "$1.2K" / "$940" / "0.50 SOL" for a trade, or '' when it has no size. */
export function fmtTradeSize(trade) {
	const s = sizeOf(trade);
	if (!s) return '';
	if (s.unit === 'sol') return `${s.size >= 10 ? s.size.toFixed(1) : s.size.toFixed(2)} SOL`;
	const v = s.size;
	if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
	if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
	if (v >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
	if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
	return '$' + (v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 0 : 2));
}

const MAX_TRADE_ROWS = 3;     // individual rows per batch before the rest are summarised
const MAX_ROW_AGE_MS = 90_000; // an outage replay is history, never "live activity"

/**
 * Rows for one batch of freshly-landed trades. Individual rows for the largest
 * few, one summary row for the rest, nothing at all unless the tape is live.
 * @returns {{kind:string,text:string,tone:string,key:string}[]}
 */
export function describeTape(batch, { live = true, status = 'live', now = Date.now(), skipTx = null } = {}) {
	if (!live || status === 'stale' || !Array.isArray(batch)) return [];
	const fresh = batch.filter((t) => t && t.tx !== skipTx && (!Number.isFinite(t.ts) || now - t.ts <= MAX_ROW_AGE_MS));
	if (!fresh.length) return [];
	const bySize = fresh.slice().sort((a, b) => (sizeOf(b)?.size || 0) - (sizeOf(a)?.size || 0));
	const shown = bySize.slice(0, MAX_TRADE_ROWS);
	const rows = shown.map((t) => {
		const who = shortAddress(t.trader, 4, 3, { empty: '' });
		const size = fmtTradeSize(t);
		return {
			kind: 'trade',
			tone: t.isBuy ? 'up' : 'down',
			key: `tx:${t.tx}`,
			text: `${t.isBuy ? 'Buy' : 'Sell'}${size ? ' ' + size : ''}${who ? ' · ' + who : ''}`,
		};
	});
	const rest = fresh.length - shown.length;
	if (rest > 0) {
		const rb = fresh.filter((t) => !shown.includes(t));
		const buys = rb.filter((t) => t.isBuy).length;
		rows.push({
			kind: 'trade', tone: '', key: `tx:${rb[0].tx}:more`,
			text: `${rest} more trade${rest === 1 ? '' : 's'} (${buys} buy${buys === 1 ? '' : 's'}, ${rest - buys} sell${rest - buys === 1 ? '' : 's'})`,
		});
	}
	return rows;
}

/**
 * @param {object} o
 * @param {import('./activity-ticker.js').ActivityTicker} o.ticker
 * @param {{symbol?:string,name?:string}} o.coin   untrusted metadata: text only
 * @param {(label:string)=>void} [o.flash]         jumbotron flash for a hype moment
 * @param {(opts?:object)=>object} [o.director]    injectable for tests
 */
export function createActivityHub({ ticker, coin, flash = null, director = createHypeDirector() }) {
	const names = new Map(); // session id -> nameplate name
	const offs = [];
	let live = false;        // joins/leaves only count after the room's first sync
	let selfId = null;

	const nameOf = (id) => (id != null && id === selfId ? 'You' : cleanLabel(names.get(id), 24) || 'A player');
	const symbol = cleanLabel(coin?.symbol, 12);

	function bindNet(net) {
		const on = (event, fn) => offs.push(net.on(event, fn));
		on('add', (p, id) => {
			if (id === net.sessionId) { selfId = id; return; }
			const known = names.has(id);
			names.set(id, p?.name || 'guest');
			if (live && !known) ticker.push({ kind: 'join', text: `${nameOf(id)} joined`, key: `join:${id}` });
		});
		on('remove', (id) => {
			const had = names.has(id);
			const who = nameOf(id);
			names.delete(id);
			if (live && had) ticker.push({ kind: 'leave', text: `${who} left`, key: `leave:${id}` });
		});
		on('synced', () => { selfId = net.sessionId; live = true; });
		on('status', ({ status }) => { if (status !== 'online') live = false; });
		on('activity', (m) => {
			if (!m || !m.label) return;
			const label = cleanLabel(m.label, 40);
			if (m.kind === 'wheel') {
				const jackpot = /jackpot/i.test(label);
				ticker.push({ kind: 'wheel', text: `${nameOf(m.id)} won ${label} on the wheel`, highlight: jackpot });
			} else if (m.kind === 'cosmetic') {
				ticker.push({ kind: 'cosmetic', text: `${nameOf(m.id)} unlocked ${label}` });
			}
		});
		on('questComplete', (c) => {
			if (c?.title) ticker.push({ kind: 'quest', text: `You completed ${cleanLabel(c.title, 40)}` });
		});
	}

	return {
		director,
		bindNet,

		/** chart-screen onTape: feed the tuner, pick a winner, post trade rows. */
		onTape(batch, ctx = {}) {
			const winner = director.evaluate(batch, { live: ctx.live, status: ctx.status });
			for (const row of describeTape(batch, { ...ctx, skipTx: winner?.tx })) ticker.push(row);
		},

		/** market-reactor isWhale: true only for the director's single winner. */
		isWhale: (tr) => director.isWinner(tr.tx),

		/** market-reactor onWhale: the row, the jumbotron band and the chime. */
		celebrate(tr) {
			const size = fmtTradeSize(tr);
			const who = shortAddress(tr.trader, 4, 3, { empty: '' });
			ticker.push({
				kind: 'hype', tone: 'hype', highlight: true,
				text: `Big buy${size ? ' ' + size : ''}${symbol ? ' of $' + symbol : ''}${who ? ' · ' + who : ''}`,
			});
			ticker.chime();
			flash?.(`BIG BUY${size ? ' ' + size : ''}${symbol ? '  $' + symbol : ''}`);
		},

		/** A cosmetic bought over x402 in this client (the room cannot see that rail). */
		noteLocalPurchase(itemName) {
			const label = cleanLabel(itemName, 40);
			if (label) ticker.push({ kind: 'cosmetic', text: `You unlocked ${label}` });
		},

		dispose() {
			for (const off of offs.splice(0)) { try { off(); } catch { /* net already torn down */ } }
			names.clear();
		},
	};
}
