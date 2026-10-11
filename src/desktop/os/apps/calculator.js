// Calculator: Standard, Scientific, Programmer and Converter. All arithmetic goes through the
// safe parsers in calc-engine.js (no eval). History, memory and mode persist via ctx.store.
import './calculator.css';
import { evaluate, formatNumber, evalProgrammer, toBase, signed, wrap, WIDTHS, BASES } from './calc-engine.js';
import { CATEGORIES, convert } from './unit-convert.js';

const K = { prefs: 'tws:calc:prefs', history: 'tws:calc:history', mem: 'tws:calc:mem' };
const U = { times: '×', div: '÷', minus: '−', back: '⌫', pi: 'π', sqrt: '√', pm: '±', sq: 'x²', inv: '1/x', swap: '⇅' };
const MODES = [['standard', 'Standard'], ['scientific', 'Scientific'], ['programmer', 'Programmer'], ['converter', 'Converter']];

const readJson = (store, k, d) => {
	try {
		const v = JSON.parse(store.get(k));
		return v ?? d;
	} catch {
		return d;
	}
};

export function mount(host, ctx) {
	const { h, esc, store } = ctx;
	const prefs = { mode: 'standard', angle: 'deg', base: 'dec', width: 64, cat: 'length', ...readJson(store, K.prefs, {}) };
	if (!MODES.some(([id]) => id === prefs.mode)) prefs.mode = 'standard';
	let history = readJson(store, K.history, []);
	if (!Array.isArray(history)) history = [];
	let memory = Number(store.get(K.mem));
	if (!Number.isFinite(memory)) memory = null;

	// calculator state
	let expr = '';
	let ans = 0;
	let justEvaled = false;
	let doneExpr = '';
	// programmer state
	let pexpr = '';
	// converter state
	let cv = { text: '1', from: null, to: null };

	const savePrefs = () => store.set(K.prefs, JSON.stringify(prefs));
	const saveHistory = () => store.set(K.history, JSON.stringify(history.slice(0, 60)));

	host.classList.add('napp-calculator');
	host.innerHTML = '';
	const root = h('div', 'calc');
	root.tabIndex = 0;
	root.setAttribute('aria-label', 'Calculator');
	const bar = h('div', 'calc-bar');
	const modeSel = h('select', 'calc-mode');
	modeSel.setAttribute('aria-label', 'Calculator mode');
	modeSel.innerHTML = MODES.map(([id, l]) => `<option value="${id}">${l}</option>`).join('');
	modeSel.value = prefs.mode;
	const copyBtn = h('button', 'calc-ibtn', ctx.icon('files', 16));
	copyBtn.title = 'Copy result (Ctrl+C)';
	copyBtn.setAttribute('aria-label', 'Copy result');
	const histBtn = h('button', 'calc-ibtn', ctx.icon('clock', 16));
	histBtn.title = 'History';
	histBtn.setAttribute('aria-label', 'History');
	histBtn.setAttribute('aria-expanded', 'false');
	bar.append(modeSel, h('span', 'calc-grow'), copyBtn, histBtn);
	const body = h('div', 'calc-body');
	const hist = h('aside', 'calc-hist');
	hist.hidden = true;
	hist.setAttribute('aria-label', 'History');
	root.append(bar, body, hist);
	host.append(root);

	const live = h('div', 'calc-sr');
	live.setAttribute('aria-live', 'polite');
	root.append(live);

	let els = {};
	const setBodyFocus = () => root.focus({ preventScroll: true });

	// ---------- shared helpers ----------
	const withClose = (s) => {
		let o = 0;
		for (const c of s) {
			if (c === '(') o++;
			else if (c === ')') o--;
		}
		return o > 0 ? s + ')'.repeat(o) : s;
	};
	const rawNum = (v) => formatNumber(v, { group: false });
	const pretty = (s) => s.replace(/\*/g, ` ${U.times} `).replace(/\//g, ` ${U.div} `).replace(/(?<=[\d)!%a-z])-/gi, ` ${U.minus} `).replace(/\+/g, ' + ').replace(/\^/g, '^').replace(/\s{2,}/g, ' ').trim();
	const tryEval = (s) => {
		try {
			return { v: evaluate(withClose(s), { angle: prefs.angle, ans }) };
		} catch (err) {
			return { err: err.message };
		}
	};
	const copyText = async (text) => {
		try {
			await navigator.clipboard.writeText(text);
			ctx.toast('Copied to clipboard');
		} catch {
			ctx.toast('Copy was blocked by the browser');
		}
	};

	// ---------- standard / scientific ----------
	function press(tok) {
		const isOp = /^[+\-*/^%]$/.test(tok) || tok === '!' || tok === '^2';
		if (justEvaled) {
			if (!isOp) expr = '';
			justEvaled = false;
			doneExpr = '';
		}
		if (/^[*/^%]$/.test(tok) && (!expr || /[*/^(+\-]$/.test(expr))) {
			if (!expr) expr = rawNum(ans);
			else if (/[*/^+\-]$/.test(expr)) expr = expr.slice(0, -1);
			else if (/\($/.test(expr)) return;
		} else if (/^[+-]$/.test(tok) && /[+\-*/]$/.test(expr) && !/\($/.test(expr)) {
			expr = expr.slice(0, -1);
		}
		if (tok === '.' && /(\d*\.\d*)$/.test(expr.match(/[\d.]*$/)?.[0] || '') && /\./.test(expr.match(/[\d.]*$/)?.[0] || '')) return;
		expr += tok;
		renderStd();
	}
	function neg() {
		if (justEvaled) justEvaled = false;
		const m = /\(-([\d.]+(?:e[+-]?\d+)?)\)$/i.exec(expr);
		if (m) expr = expr.slice(0, m.index) + m[1];
		else {
			const n = /([\d.]+(?:e[+-]?\d+)?)$/i.exec(expr);
			if (n) expr = `${expr.slice(0, n.index)}(-${n[1]})`;
			else expr += '(-';
		}
		renderStd();
	}
	function equals() {
		if (!expr) return;
		const r = tryEval(expr);
		if (r.err) {
			els.res.textContent = r.err;
			els.res.classList.add('err');
			live.textContent = r.err;
			return;
		}
		const shown = pretty(withClose(expr));
		history.unshift({ expr: withClose(expr), shown, res: r.v, angle: prefs.angle });
		history = history.slice(0, 60);
		saveHistory();
		ans = r.v;
		doneExpr = `${shown} =`;
		expr = rawNum(r.v);
		justEvaled = true;
		renderStd();
		renderHist();
		live.textContent = `Result ${formatNumber(r.v)}`;
	}
	function clearAll() {
		expr = '';
		justEvaled = false;
		doneExpr = '';
		renderStd();
	}
	function backspace() {
		if (justEvaled) return clearAll();
		expr = expr.replace(/(?:[a-z0-9]+\($|.)$/i, '');
		renderStd();
	}
	function memOp(op) {
		const cur = tryEval(expr || '0');
		const val = cur.v ?? ans;
		if (op === 'MC') memory = null;
		else if (op === 'MR') {
			if (memory == null) return;
			press(rawNum(memory));
			return;
		} else if (op === 'MS') memory = val;
		else if (op === 'M+') memory = (memory ?? 0) + val;
		else if (op === 'M-') memory = (memory ?? 0) - val;
		if (memory == null) store.del(K.mem);
		else store.set(K.mem, String(memory));
		renderStd();
	}

	const T = (label, tok, cls = '', aria) => ({ label, act: () => press(tok), cls, aria });
	const A = (label, act, cls = '', aria) => ({ label, act, cls, aria });
	const STD_PAD = () => [
		A('C', clearAll, 'fn', 'Clear'), A(U.back, backspace, 'fn', 'Backspace'), T('%', '%', 'fn', 'Percent'), T(U.div, '/', 'op', 'Divide'),
		T('7', '7', 'num'), T('8', '8', 'num'), T('9', '9', 'num'), T(U.times, '*', 'op', 'Multiply'),
		T('4', '4', 'num'), T('5', '5', 'num'), T('6', '6', 'num'), T(U.minus, '-', 'op', 'Subtract'),
		T('1', '1', 'num'), T('2', '2', 'num'), T('3', '3', 'num'), T('+', '+', 'op', 'Add'),
		A(U.pm, neg, 'num', 'Toggle sign'), T('0', '0', 'num'), T('.', '.', 'num', 'Decimal point'), A('=', equals, 'eq', 'Equals'),
	];
	const SCI_PAD = () => [
		A(prefs.angle === 'deg' ? 'DEG' : 'RAD', () => {
			prefs.angle = prefs.angle === 'deg' ? 'rad' : 'deg';
			savePrefs();
			renderStd();
		}, 'fn', 'Toggle degrees or radians'), T(U.pi, 'pi', 'fn', 'Pi'), T('e', 'e', 'fn', 'Euler number'), T('(', '(', 'fn'), T(')', ')', 'fn'),
		T('sin', 'sin(', 'fn'), T('cos', 'cos(', 'fn'), T('tan', 'tan(', 'fn'), T('asin', 'asin(', 'fn'), T('acos', 'acos(', 'fn'),
		T('atan', 'atan(', 'fn'), T('log', 'log(', 'fn', 'Log base 10'), T('ln', 'ln(', 'fn', 'Natural log'), T(U.sqrt, 'sqrt(', 'fn', 'Square root'), T('³√', 'cbrt(', 'fn', 'Cube root'),
		T(U.sq, '^2', 'fn', 'Square'), T('xʸ', '^', 'fn', 'Power'), T('n!', '!', 'fn', 'Factorial'), T('|x|', 'abs(', 'fn', 'Absolute value'),
		A(U.inv, () => {
			expr = `1/(${expr || rawNum(ans)})`;
			justEvaled = false;
			renderStd();
		}, 'fn', 'Reciprocal'),
	];

	function padHtml(items, cols, wrapCls = '') {
		const grid = h('div', `calc-pad c${cols} ${wrapCls}`);
		for (const it of items) {
			const b = h('button', `calc-key ${it.cls}`, it.label);
			b.type = 'button';
			if (it.aria) b.setAttribute('aria-label', it.aria);
			if (it.off) b.disabled = true;
			b.addEventListener('click', () => {
				it.act();
				setBodyFocus();
			});
			grid.append(b);
		}
		return grid;
	}

	function renderStd() {
		const sci = prefs.mode === 'scientific';
		if (!els.std) {
			body.replaceChildren();
			const disp = h('div', 'calc-disp');
			els.expr = h('div', 'calc-expr');
			els.res = h('div', 'calc-res');
			els.res.setAttribute('role', 'status');
			disp.append(els.expr, els.res);
			els.mem = h('div', 'calc-memrow');
			els.pads = h('div', 'calc-pads');
			body.append(disp, els.mem, els.pads);
			els.std = true;
			els.padKey = '';
		}
		const prev = expr ? tryEval(expr) : null;
		els.expr.textContent = justEvaled ? doneExpr : pretty(expr);
		els.expr.title = els.expr.textContent;
		els.res.classList.remove('err');
		if (justEvaled) els.res.textContent = formatNumber(ans);
		else if (!expr) els.res.textContent = '0';
		else if (prev && prev.v !== undefined) els.res.textContent = /^[\d.]+$/.test(expr) ? groupLiteral(expr) : formatNumber(prev.v);
		else els.res.textContent = expr;
		const len = els.res.textContent.length;
		els.res.style.fontSize = len > 22 ? '1.4rem' : len > 15 ? '1.9rem' : len > 10 ? '2.4rem' : '';
		const memOn = memory != null;
		els.mem.replaceChildren(
			...['MC', 'MR', 'M+', 'M-', 'MS'].map((m) => {
				const b = h('button', 'calc-mem', m);
				b.type = 'button';
				b.setAttribute('aria-label', { MC: 'Memory clear', MR: 'Memory recall', 'M+': 'Memory add', 'M-': 'Memory subtract', MS: 'Memory store' }[m]);
				if ((m === 'MC' || m === 'MR') && !memOn) b.disabled = true;
				b.addEventListener('click', () => {
					memOp(m);
					setBodyFocus();
				});
				return b;
			}),
			Object.assign(h('span', 'calc-memval'), { textContent: memOn ? `M = ${formatNumber(memory)}` : '', title: 'Memory value' }),
		);
		const key = sci + prefs.angle;
		if (els.padKey !== key) {
			els.padKey = key;
			els.pads.replaceChildren(...(sci ? [padHtml(SCI_PAD(), 5, 'sci')] : []), padHtml(STD_PAD(), 4));
		}
		bodyScroll();
	}
	const groupLiteral = (t) => {
		const [i, f] = t.split('.');
		return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f !== undefined ? `.${f}` : '');
	};
	const bodyScroll = () => {
		if (els.expr) els.expr.scrollLeft = els.expr.scrollWidth;
	};

	// ---------- programmer ----------
	const compact = (v, base) => {
		if (base === 'dec') return signed(v, prefs.width).toString();
		return toBase(v, base, prefs.width).replace(/\s/g, '').replace(/^0+(?=.)/, '');
	};
	function pval() {
		try {
			return { v: evalProgrammer(pexpr || '0', prefs.base, prefs.width) };
		} catch (err) {
			return { err: err.message };
		}
	}
	function pPress(tok) {
		pexpr += tok;
		renderProg();
	}
	function pEquals() {
		const r = pval();
		if (r.err) {
			els.perr.textContent = r.err;
			return;
		}
		pexpr = compact(r.v, prefs.base);
		renderProg();
	}
	function renderProg() {
		body.replaceChildren();
		els.std = false;
		const r = pval();
		const v = r.v ?? 0n;
		const disp = h('div', 'calc-disp');
		const ex = h('div', 'calc-expr', '');
		ex.textContent = pexpr.replace(/\*/g, ` ${U.times} `).replace(/\//g, ` ${U.div} `).trim();
		els.perr = h('div', 'calc-res');
		els.perr.setAttribute('role', 'status');
		els.perr.textContent = r.err ? r.err : '';
		els.perr.classList.toggle('err', !!r.err);
		if (!r.err) {
			els.perr.textContent = pexpr ? compact(v, prefs.base).toUpperCase() : '0';
		}
		disp.append(ex, els.perr);
		const bases = h('div', 'calc-bases');
		for (const b of Object.keys(BASES)) {
			const row = h('button', `calc-base${prefs.base === b ? ' on' : ''}`);
			row.type = 'button';
			row.setAttribute('aria-pressed', String(prefs.base === b));
			const txt = b === 'dec' ? signed(v, prefs.width).toString() : toBase(v, b, prefs.width);
			row.innerHTML = `<b>${b.toUpperCase()}</b><span>${esc(txt)}</span>`;
			row.addEventListener('click', () => {
				if (prefs.base === b) return;
				const cur = pval().v ?? 0n;
				prefs.base = b;
				savePrefs();
				pexpr = pexpr ? compact(cur, b) : '';
				renderProg();
				setBodyFocus();
			});
			bases.append(row);
		}
		const wrow = h('div', 'calc-widths');
		wrow.setAttribute('role', 'group');
		wrow.setAttribute('aria-label', 'Word size');
		for (const w of WIDTHS) {
			const b = h('button', `calc-chip${prefs.width === w ? ' on' : ''}`, `${w}-bit`);
			b.type = 'button';
			b.setAttribute('aria-pressed', String(prefs.width === w));
			b.addEventListener('click', () => {
				const cur = pval().v ?? 0n;
				prefs.width = w;
				savePrefs();
				pexpr = pexpr ? compact(wrap(cur, w), prefs.base) : '';
				renderProg();
			});
			wrow.append(b);
		}
		const bits = h('div', 'calc-bits');
		bits.setAttribute('role', 'group');
		bits.setAttribute('aria-label', 'Bits');
		const u = wrap(v, prefs.width);
		for (let i = prefs.width - 1; i >= 0; i--) {
			const on = (u >> BigInt(i)) & 1n;
			const b = h('button', `calc-bit${on ? ' on' : ''}${i % 4 === 0 && i ? ' gap' : ''}`, on ? '1' : '0');
			b.type = 'button';
			b.setAttribute('aria-label', `Bit ${i}`);
			b.setAttribute('aria-pressed', String(!!on));
			b.addEventListener('click', () => {
				pexpr = compact(u ^ (1n << BigInt(i)), prefs.base);
				renderProg();
			});
			bits.append(b);
		}
		const baseIdx = Object.keys(BASES).indexOf(prefs.base);
		const maxDigit = BASES[prefs.base];
		const P = (label, tok, cls, aria) => ({ label, act: () => pPress(tok), cls, aria });
		const dg = (d, hexOnly = false) => ({ ...P(d, d, 'num'), off: hexOnly ? baseIdx !== 0 : parseInt(d, 16) >= maxDigit });
		const items = [
			A('AC', () => { pexpr = ''; renderProg(); }, 'fn', 'Clear'), A(U.back, () => { pexpr = pexpr.replace(/\s*(?:<<|>>|.)$/, ''); renderProg(); }, 'fn', 'Backspace'), P('(', '(', 'fn'), P(')', ')', 'fn'),
			P('<<', '<<', 'fn', 'Shift left'), P('>>', '>>', 'fn', 'Shift right'), P('AND', ' AND ', 'fn'), P('OR', ' OR ', 'fn'),
			P('XOR', ' XOR ', 'fn'), P('NOT', '~', 'fn'), P('MOD', ' MOD ', 'fn'), P(U.div, '/', 'op', 'Divide'),
			dg('D', true), dg('E', true), dg('F', true), P(U.times, '*', 'op', 'Multiply'),
			dg('A', true), dg('B', true), dg('C', true), P(U.minus, '-', 'op', 'Subtract'),
			dg('7'), dg('8'), dg('9'), P('+', '+', 'op', 'Add'),
			dg('4'), dg('5'), dg('6'), A(U.pm, () => { pexpr = pexpr ? `-(${pexpr})` : '-'; renderProg(); }, 'num', 'Negate'),
			dg('1'), dg('2'), dg('3'), { ...P('00', '00', 'num'), off: maxDigit < 2 },
			{ ...dg('0'), cls: 'num w2' }, A('=', pEquals, 'eq w2', 'Equals'),
		];
		// Programmer pad is 4 columns; "=" spans two rows through CSS.
		const pad = padHtml(items, 4, 'prog');
		body.append(disp, bases, wrow, bits, pad);
	}

	// ---------- converter ----------
	function renderConv() {
		body.replaceChildren();
		els.std = false;
		const cat = CATEGORIES[prefs.cat] ? prefs.cat : 'length';
		const def = CATEGORIES[cat];
		const keys = Object.keys(def.units);
		if (!keys.includes(cv.from)) cv.from = keys[0];
		if (!keys.includes(cv.to)) cv.to = keys[1] || keys[0];
		const catSel = h('select', 'calc-sel');
		catSel.setAttribute('aria-label', 'Unit category');
		catSel.innerHTML = Object.entries(CATEGORIES).map(([id, c]) => `<option value="${id}"${id === cat ? ' selected' : ''}>${c.label}</option>`).join('');
		catSel.addEventListener('change', () => {
			prefs.cat = catSel.value;
			cv.from = cv.to = null;
			savePrefs();
			renderConv();
		});
		const unitSel = (cur, onChange, label) => {
			const s = h('select', 'calc-sel');
			s.setAttribute('aria-label', label);
			s.innerHTML = keys.map((k) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(def.units[k][0])}</option>`).join('');
			s.addEventListener('change', () => onChange(s.value));
			return s;
		};
		const input = h('input', 'calc-cvin');
		input.type = 'text';
		input.inputMode = 'decimal';
		input.value = cv.text;
		input.setAttribute('aria-label', 'Value to convert');
		const out = h('output', 'calc-cvout');
		out.setAttribute('aria-live', 'polite');
		const all = h('div', 'calc-cvall');
		const update = () => {
			cv.text = input.value;
			const n = Number(String(input.value).replace(/,/g, ''));
			all.replaceChildren();
			if (input.value.trim() === '' || !Number.isFinite(n)) {
				out.textContent = input.value.trim() === '' ? '0' : 'Enter a number';
				out.classList.toggle('err', input.value.trim() !== '');
				return;
			}
			try {
				const r = convert(cat, cv.from, cv.to, n);
				out.classList.remove('err');
				out.textContent = formatNumber(r);
				out.dataset.raw = rawNum(r);
				for (const k of keys) {
					if (k === cv.from) continue;
					const b = h('button', 'calc-cvrow');
					b.type = 'button';
					let txt;
					try {
						txt = formatNumber(convert(cat, cv.from, k, n));
					} catch {
						continue;
					}
					b.innerHTML = `<span>${esc(def.units[k][0])}</span><b>${esc(txt)}</b>`;
					b.title = 'Click to copy';
					b.addEventListener('click', () => copyText(txt.replace(/,/g, '')));
					all.append(b);
				}
			} catch (err) {
				out.textContent = err.message;
				out.classList.add('err');
			}
		};
		input.addEventListener('input', update);
		const swap = h('button', 'calc-ibtn swap', U.swap);
		swap.type = 'button';
		swap.title = 'Swap units';
		swap.setAttribute('aria-label', 'Swap units');
		swap.addEventListener('click', () => {
			[cv.from, cv.to] = [cv.to, cv.from];
			const o = out.dataset.raw;
			if (o && !out.classList.contains('err')) cv.text = o;
			renderConv();
		});
		const a = h('div', 'calc-cvbox');
		a.append(unitSel(cv.from, (v) => { cv.from = v; update(); }, 'From unit'), input);
		const b = h('div', 'calc-cvbox');
		b.append(unitSel(cv.to, (v) => { cv.to = v; update(); }, 'To unit'), out);
		body.append(catSel, a, swap, b, h('div', 'calc-cvhead', 'All units'), all);
		update();
		input.focus({ preventScroll: true });
	}

	// ---------- history ----------
	function renderHist() {
		hist.replaceChildren();
		const head = h('div', 'calc-hhead');
		head.innerHTML = '<b>History</b>';
		const clr = h('button', 'calc-link', 'Clear');
		clr.type = 'button';
		clr.disabled = !history.length;
		clr.addEventListener('click', () => {
			history = [];
			saveHistory();
			renderHist();
		});
		head.append(clr);
		hist.append(head);
		if (!history.length) {
			hist.append(h('p', 'calc-hempty', 'Calculations you finish with = appear here. Select one to reuse it.'));
			return;
		}
		const list = h('ul', 'calc-hlist');
		for (const e of history) {
			const li = h('li');
			const b = h('button', 'calc-hitem');
			b.type = 'button';
			b.innerHTML = `<span>${esc(e.shown)} =</span><b>${esc(formatNumber(e.res))}</b>`;
			b.title = 'Click to reuse the result. Shift+click to reuse the expression.';
			b.addEventListener('click', (ev) => {
				if (prefs.mode === 'programmer' || prefs.mode === 'converter') setMode('standard');
				justEvaled = false;
				expr = ev.shiftKey ? e.expr : rawNum(e.res);
				renderStd();
				toggleHist(false);
				setBodyFocus();
			});
			li.append(b);
			list.append(li);
		}
		hist.append(list);
	}
	function toggleHist(force) {
		const open = force ?? hist.hidden;
		hist.hidden = !open;
		histBtn.setAttribute('aria-expanded', String(open));
		histBtn.classList.toggle('on', open);
		if (open) renderHist();
	}
	histBtn.addEventListener('click', () => toggleHist());

	// ---------- mode + keyboard ----------
	function setMode(m) {
		prefs.mode = m;
		modeSel.value = m;
		savePrefs();
		root.dataset.mode = m;
		els.std = false;
		histBtn.hidden = m === 'programmer' || m === 'converter';
		if (histBtn.hidden) toggleHist(false);
		if (m === 'programmer') renderProg();
		else if (m === 'converter') renderConv();
		else renderStd();
		ctx.setTitle(`Calculator - ${MODES.find(([id]) => id === m)[1]}`);
	}
	modeSel.addEventListener('change', () => setMode(modeSel.value));

	copyBtn.addEventListener('click', () => {
		if (prefs.mode === 'converter') return copyText(els.cvout?.dataset.raw || root.querySelector('.calc-cvout')?.dataset.raw || '');
		if (prefs.mode === 'programmer') return copyText(root.querySelector('.calc-res')?.textContent || '');
		const r = justEvaled ? ans : tryEval(expr || '0').v;
		if (r === undefined) return ctx.toast('Nothing to copy yet');
		copyText(rawNum(r));
	});

	root.addEventListener('keydown', (e) => {
		if (e.target.closest('input, select')) return;
		if (e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
		const mode = prefs.mode;
		if (mode === 'converter') return;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
			if (!window.getSelection()?.toString()) {
				e.preventDefault();
				copyBtn.click();
			}
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const k = e.key;
		if (mode === 'programmer') {
			if (/^[0-9a-fA-F]$/.test(k)) {
				if (parseInt(k, 16) < BASES[prefs.base]) pPress(k.toUpperCase());
			} else if ('+-*/()%&|^~'.includes(k) && k.length === 1) pPress(k);
			else if (k === '<' || k === '>') pPress(k + k);
			else if (k === 'Enter' || k === '=') pEquals();
			else if (k === 'Backspace') { pexpr = pexpr.replace(/\s*(?:<<|>>|.)$/, ''); renderProg(); }
			else if (k === 'Escape' || k === 'Delete') { pexpr = ''; renderProg(); }
			else return;
			e.preventDefault();
			return;
		}
		if (/^[0-9.]$/.test(k)) press(k);
		else if ('+-*/^%!()'.includes(k) && k.length === 1) press(k);
		else if (k === 'x' || k === 'X') press('*');
		else if (k === 'Enter' || k === '=') equals();
		else if (k === 'Backspace') backspace();
		else if (k === 'Escape' || k === 'Delete') clearAll();
		else if (k === 'p' || k === 'P') press('pi');
		else if (k === 'r' && mode === 'scientific') press('sqrt(');
		else if (k === 'l' && mode === 'scientific') press('log(');
		else if (k === 's' && mode === 'scientific') press('sin(');
		else if (k === 'c' && mode === 'scientific') press('cos(');
		else if (k === 't' && mode === 'scientific') press('tan(');
		else if (k === 'F9') neg();
		else return;
		e.preventDefault();
	});
	root.addEventListener('paste', (e) => {
		if (e.target.closest('input')) return;
		const t = (e.clipboardData?.getData('text') || '').trim();
		if (!t) return;
		e.preventDefault();
		if (prefs.mode === 'programmer') {
			pexpr += t.replace(/[,\s]/g, '');
			return renderProg();
		}
		const clean = t.replace(/,/g, '').replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
		if (justEvaled) {
			justEvaled = false;
			expr = '';
		}
		const r = tryEval(clean);
		if (r.err) return ctx.toast(`Cannot paste: ${r.err}`);
		expr += clean;
		renderStd();
	});

	setMode(prefs.mode);
	setBodyFocus();
	return () => {
		savePrefs();
	};
}
