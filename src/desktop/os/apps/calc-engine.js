// Calculator engine. A tokenizer plus a shunting-yard evaluator: no eval, no Function.
// Pure functions only, so the Calculator app and the unit tests share one implementation.

const FUNCS = {
	sin: { n: 1, trig: 'in', f: Math.sin },
	cos: { n: 1, trig: 'in', f: Math.cos },
	tan: { n: 1, trig: 'in', f: Math.tan },
	asin: { n: 1, trig: 'out', f: Math.asin },
	acos: { n: 1, trig: 'out', f: Math.acos },
	atan: { n: 1, trig: 'out', f: Math.atan },
	sinh: { n: 1, f: Math.sinh },
	cosh: { n: 1, f: Math.cosh },
	tanh: { n: 1, f: Math.tanh },
	log: { n: 1, f: Math.log10 },
	ln: { n: 1, f: Math.log },
	log2: { n: 1, f: Math.log2 },
	sqrt: { n: 1, f: Math.sqrt },
	cbrt: { n: 1, f: Math.cbrt },
	abs: { n: 1, f: Math.abs },
	exp: { n: 1, f: Math.exp },
	floor: { n: 1, f: Math.floor },
	ceil: { n: 1, f: Math.ceil },
	round: { n: 1, f: Math.round },
	fact: { n: 1, f: (x) => factorial(x) },
	min: { n: 2, f: Math.min },
	max: { n: 2, f: Math.max },
	root: { n: 2, f: (x, y) => (x < 0 && y % 2 !== 0 ? -Math.pow(-x, 1 / y) : Math.pow(x, 1 / y)) },
	mod: { n: 2, f: (x, y) => x % y },
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2 };
const OPS = {
	'+': { p: 2, r: false, f: (a, b) => a + b },
	'-': { p: 2, r: false, f: (a, b) => a - b },
	'*': { p: 3, r: false, f: (a, b) => a * b },
	'/': { p: 3, r: false, f: (a, b) => a / b },
	'%': { p: 3, r: false, f: (a, b) => a % b },
	'^': { p: 5, r: true, f: (a, b) => Math.pow(a, b) },
};
const UNARY_P = 4;

export function factorial(x) {
	if (!Number.isFinite(x) || x < 0 || !Number.isInteger(x)) throw new CalcError('Factorial needs a whole number of 0 or more');
	if (x > 170) return Infinity;
	let r = 1;
	for (let i = 2; i <= x; i++) r *= i;
	return r;
}

export class CalcError extends Error {}

/** Normalise display glyphs to ASCII operators. */
const GLYPHS = { '\u00d7': '*', '\u00f7': '/', '\u2212': '-', '\u03c0': 'pi', '\u221a': 'sqrt', '\u00b2': '^2', '\u00b3': '^3', '\u00b7': '*' };

export function tokenize(src) {
	const s = String(src).replace(/[\u00d7\u00f7\u2212\u03c0\u221a\u00b2\u00b3\u00b7]/g, (c) => (GLYPHS[c][0] === '^' ? GLYPHS[c] : ` ${GLYPHS[c]} `));
	const out = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (/\s/.test(c)) { i++; continue; }
		if (/[0-9.]/.test(c)) {
			const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
			if (!m) throw new CalcError('Invalid number');
			out.push({ t: 'num', v: parseFloat(m[0]) });
			i += m[0].length;
			continue;
		}
		if (/[a-zA-Z]/.test(c)) {
			const m = /^[a-zA-Z][a-zA-Z0-9]*/.exec(s.slice(i));
			const w = m[0].toLowerCase();
			if (FUNCS[w]) out.push({ t: 'fn', v: w });
			else if (w in CONSTS) out.push({ t: 'num', v: CONSTS[w] });
			else if (w === 'ans') out.push({ t: 'ans' });
			else throw new CalcError(`Unknown name "${m[0]}"`);
			i += m[0].length;
			continue;
		}
		if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
		if (c === '!') { out.push({ t: 'post', v: '!' }); i++; continue; }
		if (c === ',') { out.push({ t: ',' }); i++; continue; }
		if (c === '*' && s[i + 1] === '*') { out.push({ t: 'op', v: '^' }); i += 2; continue; }
		if (OPS[c]) { out.push({ t: 'op', v: c }); i++; continue; }
		throw new CalcError(`Unexpected "${c}"`);
	}
	return out;
}

/**
 * Evaluate an expression string.
 * opts: { angle: 'deg'|'rad', ans: number }. Percent after a number divides by 100 ("50%" = 0.5).
 */
export function evaluate(src, opts = {}) {
	const angle = opts.angle === 'deg' ? 'deg' : 'rad';
	const toks = tokenize(src);
	if (!toks.length) throw new CalcError('Empty expression');
	// Resolve ans, mark unary signs, postfix percent, and insert implicit multiplication.
	const seq = [];
	let prev = null;
	const isValueEnd = (t) => t && (t.t === 'num' || t.t === ')' || t.t === 'post' || t.t === 'pct');
	for (let k = 0; k < toks.length; k++) {
		let t = toks[k];
		if (t.t === 'ans') t = { t: 'num', v: Number(opts.ans ?? 0) };
		if (t.t === 'fn' && toks[k + 1]?.t !== '(') throw new CalcError(`${t.v} needs parentheses, like ${t.v}(2)`);
		if (t.t === 'fn' && toks[k + 1]?.t !== '(') throw new CalcError(`${t.v} needs parentheses, like ${t.v}(2)`);
		if (t.t === 'op' && t.v === '%' && isValueEnd(prev)) {
			const nx = toks[k + 1];
			const nextIsValue = nx && (nx.t === 'num' || nx.t === 'fn' || nx.t === '(' || nx.t === 'ans');
			if (!nextIsValue) t = { t: 'pct' };
		}
		if (t.t === 'op' && (t.v === '-' || t.v === '+') && !isValueEnd(prev)) t = { t: 'un', v: t.v };
		if ((t.t === 'num' || t.t === 'fn' || t.t === '(') && isValueEnd(prev)) seq.push({ t: 'op', v: '*' });
		seq.push(t);
		prev = t;
	}
	const out = [];
	const st = [];
	const flush = (pred) => {
		while (st.length && pred(st[st.length - 1])) out.push(st.pop());
	};
	for (const t of seq) {
		if (t.t === 'num') out.push(t);
		else if (t.t === 'post' || t.t === 'pct') out.push(t);
		else if (t.t === 'fn') st.push(t);
		else if (t.t === 'un') st.push({ t: 'un', v: t.v, p: UNARY_P });
		else if (t.t === ',') {
			flush((x) => x.t !== '(');
			if (!st.length) throw new CalcError('Misplaced comma');
		} else if (t.t === 'op') {
			const o = OPS[t.v];
			flush((x) => {
				if (x.t === 'un') return x.p > o.p || (x.p === o.p && !o.r);
				if (x.t === 'op') {
					const xo = OPS[x.v];
					return xo.p > o.p || (xo.p === o.p && !o.r);
				}
				return false;
			});
			st.push(t);
		} else if (t.t === '(') st.push(t);
		else if (t.t === ')') {
			flush((x) => x.t !== '(');
			if (!st.length) throw new CalcError('Unbalanced parentheses');
			st.pop();
			if (st.length && st[st.length - 1].t === 'fn') out.push(st.pop());
		}
	}
	while (st.length) {
		const x = st.pop();
		if (x.t === '(') throw new CalcError('Unbalanced parentheses');
		out.push(x);
	}
	const stack = [];
	const need = (n) => {
		if (stack.length < n) throw new CalcError('Incomplete expression');
	};
	for (const t of out) {
		if (t.t === 'num') stack.push(t.v);
		else if (t.t === 'post') { need(1); stack.push(factorial(stack.pop())); }
		else if (t.t === 'pct') { need(1); stack.push(stack.pop() / 100); }
		else if (t.t === 'un') { need(1); const v = stack.pop(); stack.push(t.v === '-' ? -v : v); }
		else if (t.t === 'op') {
			need(2);
			const b = stack.pop();
			const a = stack.pop();
			stack.push(OPS[t.v].f(a, b));
		} else if (t.t === 'fn') {
			const fn = FUNCS[t.v];
			need(fn.n);
			const args = stack.splice(stack.length - fn.n, fn.n);
			if (fn.trig === 'in' && angle === 'deg') args[0] = (args[0] * Math.PI) / 180;
			let r = fn.f(...args);
			if (fn.trig === 'out' && angle === 'deg') r = (r * 180) / Math.PI;
			if (fn.trig === 'in' && angle === 'deg') r = cleanTrig(r);
			stack.push(r);
		}
	}
	if (stack.length !== 1) throw new CalcError('Incomplete expression');
	const v = stack[0];
	if (Number.isNaN(v)) throw new CalcError('Not a number');
	if (!Number.isFinite(v)) throw new CalcError(v > 0 ? 'Result too large or division by zero' : 'Result too small or division by zero');
	return v;
}

/** Remove float dust such as sin(180deg) = 1.2e-16. */
function cleanTrig(r) {
	return Math.abs(r) < 1e-14 ? 0 : r;
}

/** Format a result: up to 12 significant digits, exponent form for extremes. */
export function formatNumber(v, { group = true } = {}) {
	if (!Number.isFinite(v)) return String(v);
	if (v === 0) return '0';
	const a = Math.abs(v);
	if (a >= 1e15 || a < 1e-9) return v.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
	let s = String(parseFloat(v.toPrecision(12)));
	if (/e/.test(s)) s = v.toFixed(12).replace(/\.?0+$/, '');
	if (!group) return s;
	const [i, f] = s.split('.');
	const neg = i.startsWith('-');
	const g = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return (neg ? '-' : '') + g + (f ? `.${f}` : '');
}

// ---- Programmer mode (BigInt, fixed bit width, two's complement) ----

export const BASES = { hex: 16, dec: 10, oct: 8, bin: 2 };
export const WIDTHS = [8, 16, 32, 64];

export const mask = (width) => (1n << BigInt(width)) - 1n;
/** Wrap to unsigned width. */
export const wrap = (v, width) => BigInt.asUintN(width, v);
/** Interpret as signed. */
export const signed = (v, width) => BigInt.asIntN(width, v);

export function toBase(v, base, width) {
	const u = wrap(v, width);
	let s = u.toString(BASES[base]).toUpperCase();
	if (base === 'bin') s = s.padStart(width, '0').replace(/(.{4})(?=.)/g, '$1 ');
	return s;
}

export function parseInBase(text, base) {
	const t = String(text).replace(/[\s_]/g, '');
	if (!t) return 0n;
	const re = { hex: /^[0-9a-f]+$/i, dec: /^-?[0-9]+$/, oct: /^[0-7]+$/, bin: /^[01]+$/ }[base];
	if (!re.test(t)) throw new CalcError(`Not a valid ${base} number`);
	if (base === 'dec') return BigInt(t);
	return BigInt((base === 'hex' ? '0x' : base === 'oct' ? '0o' : '0b') + t);
}

const PROG_OPS = {
	'|': { p: 1, f: (a, b) => a | b },
	'^': { p: 2, f: (a, b) => a ^ b },
	'&': { p: 3, f: (a, b) => a & b },
	'<': { p: 4, f: (a, b) => a << (b & 127n) },
	'>': { p: 4, f: (a, b) => a >> (b & 127n) },
	'+': { p: 5, f: (a, b) => a + b },
	'-': { p: 5, f: (a, b) => a - b },
	'*': { p: 6, f: (a, b) => a * b },
	'/': { p: 6, f: (a, b) => { if (b === 0n) throw new CalcError('Division by zero'); return a / b; } },
	'%': { p: 6, f: (a, b) => { if (b === 0n) throw new CalcError('Division by zero'); return a % b; } },
};

/**
 * Evaluate a programmer expression in `base` with `width` bits.
 * Operators: + - * / % & | ^ << >> and unary ~ and -. The result wraps to the width (two's complement).
 * Returns an unsigned BigInt.
 */
export function evalProgrammer(src, base = 'dec', width = 64) {
	const s = String(src).replace(/\u00d7/g, '*').replace(/\u00f7/g, '/').replace(/<<|\bLSH\b/gi, '<').replace(/>>|\bRSH\b/gi, '>').replace(/\bAND\b/gi, '&').replace(/\bOR\b/gi, '|').replace(/\bXOR\b/gi, '^').replace(/\bNOT\b/gi, '~').replace(/\bMOD\b/gi, '%');
	const toks = [];
	let i = 0;
	const numRe = { hex: /^[0-9a-fA-F]+/, dec: /^[0-9]+/, oct: /^[0-7]+/, bin: /^[01]+/ }[base];
	while (i < s.length) {
		const c = s[i];
		if (/\s/.test(c)) { i++; continue; }
		const pre = base === 'dec' ? /^0[xob][0-9a-fA-F]+/i.exec(s.slice(i)) : null;
		if (pre) { toks.push({ t: 'n', v: BigInt(pre[0].toLowerCase()) }); i += pre[0].length; continue; }
		const m = numRe.exec(s.slice(i));
		if (m) { toks.push({ t: 'n', v: parseInBase(m[0], base) }); i += m[0].length; continue; }
		if (c === '(' || c === ')') { toks.push({ t: c }); i++; continue; }
		if (c === '~') { toks.push({ t: 'u', v: '~' }); i++; continue; }
		if (PROG_OPS[c]) { toks.push({ t: 'o', v: c }); i++; continue; }
		throw new CalcError(`Unexpected "${c}" in ${base} mode`);
	}
	if (!toks.length) throw new CalcError('Empty expression');
	const out = [];
	const st = [];
	let prev = null;
	for (let t of toks) {
		const valEnd = prev && (prev.t === 'n' || prev.t === ')');
		if (t.t === 'o' && t.v === '-' && !valEnd) t = { t: 'u', v: '-' };
		if (t.t === 'n') out.push(t);
		else if (t.t === 'u') st.push(t);
		else if (t.t === 'o') {
			const p = PROG_OPS[t.v].p;
			while (st.length) {
				const x = st[st.length - 1];
				if (x.t === 'u' || (x.t === 'o' && PROG_OPS[x.v].p >= p)) out.push(st.pop());
				else break;
			}
			st.push(t);
		} else if (t.t === '(') st.push(t);
		else {
			while (st.length && st[st.length - 1].t !== '(') out.push(st.pop());
			if (!st.length) throw new CalcError('Unbalanced parentheses');
			st.pop();
		}
		prev = t;
	}
	while (st.length) {
		const x = st.pop();
		if (x.t === '(') throw new CalcError('Unbalanced parentheses');
		out.push(x);
	}
	const stack = [];
	for (const t of out) {
		if (t.t === 'n') stack.push(t.v);
		else if (t.t === 'u') {
			if (!stack.length) throw new CalcError('Incomplete expression');
			const v = stack.pop();
			stack.push(t.v === '~' ? ~v : -v);
		} else {
			if (stack.length < 2) throw new CalcError('Incomplete expression');
			const b = stack.pop();
			const a = stack.pop();
			// Arithmetic works on signed values so -1 + 1 behaves; shifts and bitwise use the raw pattern.
			stack.push(PROG_OPS[t.v].f(signed(a, width), signed(b, width)));
		}
	}
	if (stack.length !== 1) throw new CalcError('Incomplete expression');
	return wrap(stack[0], width);
}
