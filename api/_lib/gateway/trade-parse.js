// Pure pieces of the chat trade commands: the grammar, the escaping of token
// text, and the typed-confirmation decision. No database, no network, no clock
// beyond the `now` a caller passes, so every rule here is unit-tested directly.
//
// Grammar (a slash command on Telegram and Discord, or the bare words in a chat):
//   buy <mint|symbol> <sol> [tp=<pct>] [sl=<pct>]
//   sell <mint|symbol> <pct>        pct 1-100, "50%", or "all"
//   snipe <mint> <sol>
//   orders
//   cancel [<order id>]             no id cancels the trade waiting for a yes
//
// Confirmation rule: a money-moving command never signs. It stores a quote
// that lives CONFIRM_TTL_SECONDS, and only the exact word `yes` (case and
// surrounding space ignored) typed by the paired owner while that quote is live
// executes it. Anything else cancels it. A late yes executes nothing.

export const CONFIRM_TTL_SECONDS = 60;
export const CONFIRM_WORD = 'yes';
export const TRADE_VERBS = Object.freeze(['buy', 'sell', 'snipe', 'orders', 'cancel']);

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL_RE = /^\$?[A-Za-z0-9]{1,16}$/;
const DECIMAL_RE = /^\d{1,9}(\.\d{1,9})?$/;
const ORDER_ID_RE = /^[0-9a-f]{6,36}(-[0-9a-f-]*)?$/i;
const MAX_TP_PCT = 100000;

const bad = (error) => ({ ok: false, error });

function parseDecimal(raw) {
	const s = String(raw ?? '').trim();
	if (!DECIMAL_RE.test(s)) return null;
	const n = Number(s);
	return Number.isFinite(n) && n > 0 ? n : null;
}

function parsePct(raw) {
	const s = String(raw ?? '').trim().replace(/%$/, '');
	return parseDecimal(s);
}

/** A token reference: a base58 mint, or a symbol the handler resolves against the wallet. */
export function parseTokenRef(raw) {
	const s = String(raw || '').trim();
	if (BASE58_RE.test(s)) return { mint: s, symbol: null };
	if (SYMBOL_RE.test(s)) return { mint: null, symbol: s.replace(/^\$/, '').toUpperCase() };
	return null;
}

/**
 * @param {string} verb  buy | sell | snipe | orders | cancel
 * @param {string} args  everything after the verb
 * @returns {{ ok:true, cmd:object } | { ok:false, error:string }}
 */
export function parseTradeCommand(verb, args = '') {
	const name = String(verb || '').toLowerCase();
	const parts = String(args || '').trim().split(/\s+/).filter(Boolean);

	if (name === 'orders') {
		return parts.length ? bad('orders takes no arguments. Send /orders.') : { ok: true, cmd: { kind: 'orders' } };
	}

	if (name === 'cancel') {
		if (parts.length > 1) return bad('Send /cancel <order id>, or /cancel alone to drop the trade waiting for your yes.');
		if (!parts.length) return { ok: true, cmd: { kind: 'cancel', id: null } };
		if (!ORDER_ID_RE.test(parts[0])) return bad('That is not an order id. Send /orders to see the ids.');
		return { ok: true, cmd: { kind: 'cancel', id: parts[0].toLowerCase() } };
	}

	if (name === 'buy') {
		const usage = 'Usage: /buy <mint or symbol> <sol amount> [tp=<percent>] [sl=<percent>]';
		const [refRaw, amountRaw, ...opts] = parts;
		if (!refRaw || !amountRaw) return bad(usage);
		const ref = parseTokenRef(refRaw);
		if (!ref) return bad(`"${clip(refRaw)}" is not a mint address or a symbol. ${usage}`);
		const sol = parseDecimal(amountRaw);
		if (!sol) return bad(`The amount must be a positive number of SOL, like 0.25. ${usage}`);
		const exits = { tp_pct: null, sl_pct: null };
		for (const opt of opts) {
			const m = /^(tp|sl)=(.+)$/i.exec(opt);
			if (!m) return bad(`Unknown option "${clip(opt)}". ${usage}`);
			const key = `${m[1].toLowerCase()}_pct`;
			if (exits[key] != null) return bad(`${m[1].toLowerCase()} was given twice. ${usage}`);
			const pct = parsePct(m[2]);
			if (!pct) return bad(`${m[1].toLowerCase()} must be a positive percent, like ${m[1].toLowerCase()}=${m[1].toLowerCase() === 'tp' ? '50' : '20'}.`);
			if (key === 'sl_pct' && pct >= 100) return bad('sl must be below 100 percent.');
			if (key === 'tp_pct' && pct > MAX_TP_PCT) return bad(`tp must be at most ${MAX_TP_PCT} percent.`);
			exits[key] = pct;
		}
		return { ok: true, cmd: { kind: 'buy', ref, sol, ...exits } };
	}

	if (name === 'snipe') {
		const usage = 'Usage: /snipe <mint> <sol amount>';
		if (parts.length !== 2) return bad(usage);
		const ref = parseTokenRef(parts[0]);
		if (!ref?.mint) return bad(`A snipe needs the full mint address, not a symbol. ${usage}`);
		const sol = parseDecimal(parts[1]);
		if (!sol) return bad(`The amount must be a positive number of SOL, like 0.1. ${usage}`);
		return { ok: true, cmd: { kind: 'snipe', ref, sol } };
	}

	if (name === 'sell') {
		const usage = 'Usage: /sell <mint or symbol> <percent of holding, 1-100, or all>';
		if (parts.length !== 2) return bad(usage);
		const ref = parseTokenRef(parts[0]);
		if (!ref) return bad(`"${clip(parts[0])}" is not a mint address or a symbol. ${usage}`);
		const word = parts[1].toLowerCase();
		const pct = word === 'all' || word === 'max' ? 100 : parsePct(parts[1]);
		if (!pct || pct > 100) return bad(`The amount is a percent of your holding between 1 and 100, or "all". ${usage}`);
		return { ok: true, cmd: { kind: 'sell', ref, pct } };
	}

	return bad(`Unknown trade command "${clip(name)}".`);
}

/**
 * A bare chat message that is exactly one of the trade commands. Anything that
 * does not parse cleanly returns null and goes to the agent as ordinary talk,
 * where a trade it proposes still needs the Approve button.
 */
export function parseTradeText(text) {
	const m = /^\s*\/?(buy|sell|snipe|orders|cancel)\b(.*)$/is.exec(String(text || ''));
	if (!m || m[2].includes('\n')) return null;
	const parsed = parseTradeCommand(m[1], m[2]);
	return parsed.ok ? parsed.cmd : null;
}

/** True only for the confirmation word typed on its own. */
export function isConfirmWord(text) {
	return String(text ?? '').trim().toLowerCase() === CONFIRM_WORD;
}

/**
 * What a message does to a trade waiting for its yes.
 *   execute  the exact word, quote still live
 *   expired  the quote lapsed (a late yes lands here and sends nothing)
 *   cancel   anything else
 * @param {{ text?:string|null, expiresAt:string|Date, now?:number }} p
 */
export function confirmationVerdict({ text, expiresAt, now = Date.now() }) {
	if (new Date(expiresAt).getTime() <= now) return 'expired';
	return isConfirmWord(text) ? 'execute' : 'cancel';
}

function clip(s, n = 40) {
	const v = String(s ?? '');
	return v.length > n ? `${v.slice(0, n)}...` : v;
}

/**
 * Token names, symbols and descriptions come from the chain and from third
 * parties, so they are data and never text we repeat as written. This keeps
 * letters, digits, spaces and a few quiet marks; drops control and bidi
 * characters, newlines (a name cannot start a fake line), links, mentions,
 * markup and backticks; and caps the length. The result is also wrapped in
 * quotes by the caller so it reads as a label, not as a sentence.
 */
export function escapeUntrusted(raw, max = 24) {
	const cleaned = String(raw ?? '')
		.normalize('NFKC')
		.replace(/https?:\/\/\S*/gi, '')
		.replace(/<[^>]*>/g, '')
		.replace(/\s/gu, ' ')
		.replace(/[^\p{L}\p{N} ._$+\-]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned.length > max ? `${cleaned.slice(0, max - 1)}.` : cleaned;
}
