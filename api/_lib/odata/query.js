// A strict parser and SQL compiler for the OData v4 query subset the usage feed
// serves ($select, $filter, $orderby, $top, $skip, $count, $skiptoken).
//
// Why in-house: the npm OData parsers are unmaintained (odata-v4-parser last
// published 2022, @odata/parser 2023) and pull far more grammar than this feed
// exposes. This file implements exactly the documented subset, refuses
// everything else with a clear OData error, and binds every literal as a query
// parameter. Identifiers never reach SQL unless they match a declared property.
//
// Supported $filter grammar:
//   expr       := or
//   or         := and ('or' and)*
//   and        := unary ('and' unary)*
//   unary      := 'not' unary | compare
//   compare    := operand (('eq'|'ne'|'gt'|'ge'|'lt'|'le') operand)?
//   operand    := '(' expr ')' | call | literal | property
//   call       := contains|startswith|endswith|tolower|toupper|trim|length|
//                 year|month|day|hour|minute|date '(' args ')'
//   literal    := 'string' (quote doubled to escape) | integer | decimal |
//                 YYYY-MM-DD | YYYY-MM-DDThh:mm[:ss[.fff]](Z|+hh:mm|-hh:mm) |
//                 true | false | null

export class ODataError extends Error {
	/**
	 * @param {number} status HTTP status
	 * @param {string} code OData error code
	 * @param {string} message human-readable explanation
	 */
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const bad = (message) => new ODataError(400, 'BadRequest', message);
const unsupported = (message) => new ODataError(501, 'NotImplemented', message);

export const MAX_PAGE_SIZE = 1000;
const MAX_FILTER_LENGTH = 4000;
const MAX_FILTER_NODES = 200;
const MAX_ORDERBY_ITEMS = 8;

const NUMERIC = new Set(['Edm.Int32', 'Edm.Int64', 'Edm.Decimal', 'Edm.Double']);
const COMPARE_OPS = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' };
const SYSTEM_OPTIONS = new Set(['$select', '$filter', '$orderby', '$top', '$skip', '$count', '$skiptoken', '$format', '$expand', '$search', '$apply', '$compute', '$levels', '$index', '$schemaversion']);

// ── tokenizer ───────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const DTO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})/i;
const NUM_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[mMdDfFlL]?/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

function validDate(y, m, d) {
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Split a $filter string into tokens.
 * @param {string} src
 * @returns {Array<{ kind: string, value: any, edm?: string, pos: number }>}
 */
export function tokenize(src) {
	const out = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
		if (ch === '(' || ch === ')' || ch === ',') { out.push({ kind: ch, value: ch, pos: i }); i++; continue; }
		if (ch === "'") {
			let j = i + 1;
			let s = '';
			for (;;) {
				if (j >= src.length) throw bad(`unterminated string literal at position ${i}`);
				if (src[j] === "'") {
					if (src[j + 1] === "'") { s += "'"; j += 2; continue; }
					break;
				}
				s += src[j++];
			}
			out.push({ kind: 'lit', edm: 'Edm.String', value: s, pos: i });
			i = j + 1;
			continue;
		}
		const rest = src.slice(i);
		let m = rest.match(DTO_RE);
		if (m) {
			const t = Date.parse(m[0].toUpperCase());
			if (Number.isNaN(t)) throw bad(`invalid DateTimeOffset literal ${m[0]}`);
			out.push({ kind: 'lit', edm: 'Edm.DateTimeOffset', value: new Date(t).toISOString(), pos: i });
			i += m[0].length;
			continue;
		}
		m = rest.match(DATE_RE);
		if (m && !/^[\d.]/.test(rest.slice(10, 11) || ' ')) {
			const [y, mo, d] = m[0].split('-').map(Number);
			if (!validDate(y, mo, d)) throw bad(`invalid Date literal ${m[0]}`);
			out.push({ kind: 'lit', edm: 'Edm.Date', value: m[0], pos: i });
			i += 10;
			continue;
		}
		m = rest.match(NUM_RE);
		if (m && (ch === '-' || /\d/.test(ch))) {
			const raw = m[0].replace(/[mMdDfFlL]$/, '');
			const isInt = /^-?\d+$/.test(raw);
			const value = Number(raw);
			if (!Number.isFinite(value)) throw bad(`invalid number literal ${m[0]}`);
			if (isInt && !Number.isSafeInteger(value)) throw bad(`integer literal ${m[0]} is out of range`);
			out.push({ kind: 'lit', edm: isInt ? 'Edm.Int64' : 'Edm.Decimal', value: isInt ? value : raw, pos: i });
			i += m[0].length;
			continue;
		}
		m = rest.match(IDENT_RE);
		if (m) {
			const word = m[0];
			if (word === 'true' || word === 'false') out.push({ kind: 'lit', edm: 'Edm.Boolean', value: word === 'true', pos: i });
			else if (word === 'null') out.push({ kind: 'lit', edm: null, value: null, pos: i });
			else out.push({ kind: 'ident', value: word, pos: i });
			i += word.length;
			continue;
		}
		throw bad(`unexpected character '${ch}' at position ${i} in $filter`);
	}
	return out;
}

// ── parser ──────────────────────────────────────────────────────────────────

const LOGICAL = new Set(['and', 'or', 'not']);
const FUNCTIONS = {
	contains: { args: ['Edm.String', 'Edm.String'], returns: 'Edm.Boolean' },
	startswith: { args: ['Edm.String', 'Edm.String'], returns: 'Edm.Boolean' },
	endswith: { args: ['Edm.String', 'Edm.String'], returns: 'Edm.Boolean' },
	tolower: { args: ['Edm.String'], returns: 'Edm.String' },
	toupper: { args: ['Edm.String'], returns: 'Edm.String' },
	trim: { args: ['Edm.String'], returns: 'Edm.String' },
	length: { args: ['Edm.String'], returns: 'Edm.Int32' },
	year: { args: ['temporal'], returns: 'Edm.Int32' },
	month: { args: ['temporal'], returns: 'Edm.Int32' },
	day: { args: ['temporal'], returns: 'Edm.Int32' },
	hour: { args: ['Edm.DateTimeOffset'], returns: 'Edm.Int32' },
	minute: { args: ['Edm.DateTimeOffset'], returns: 'Edm.Int32' },
	date: { args: ['Edm.DateTimeOffset'], returns: 'Edm.Date' },
};

/**
 * Parse a $filter expression into an AST, resolving property names and types
 * against the entity's declared properties.
 * @param {string} src
 * @param {Record<string, { type: string }>} props
 */
export function parseFilter(src, props) {
	if (typeof src !== 'string' || !src.trim()) throw bad('$filter is empty');
	if (src.length > MAX_FILTER_LENGTH) throw bad(`$filter is longer than ${MAX_FILTER_LENGTH} characters`);
	const tokens = tokenize(src);
	let pos = 0;
	let nodes = 0;
	const peek = () => tokens[pos];
	const next = () => tokens[pos++];
	const isWord = (t, w) => t && t.kind === 'ident' && t.value === w;
	const node = (n) => {
		if (++nodes > MAX_FILTER_NODES) throw bad(`$filter has more than ${MAX_FILTER_NODES} terms`);
		return n;
	};

	function parseOr() {
		let left = parseAnd();
		while (isWord(peek(), 'or')) { next(); left = node({ type: 'or', left, right: parseAnd(), edm: 'Edm.Boolean' }); }
		return left;
	}
	function parseAnd() {
		let left = parseUnary();
		while (isWord(peek(), 'and')) { next(); left = node({ type: 'and', left, right: parseUnary(), edm: 'Edm.Boolean' }); }
		return left;
	}
	function parseUnary() {
		if (isWord(peek(), 'not')) { next(); return node({ type: 'not', expr: requireBool(parseUnary()), edm: 'Edm.Boolean' }); }
		return parseCompare();
	}
	function parseCompare() {
		const left = parseOperand();
		const t = peek();
		if (t && t.kind === 'ident' && Object.hasOwn(COMPARE_OPS, t.value)) {
			next();
			const right = parseOperand();
			return node(checkCompare(t.value, left, right));
		}
		if (t && t.kind === 'ident' && ['has', 'in', 'add', 'sub', 'mul', 'div', 'divby', 'mod'].includes(t.value)) {
			throw unsupported(`the '${t.value}' operator is not supported by this feed`);
		}
		return left;
	}
	function parseOperand() {
		const t = next();
		if (!t) throw bad('$filter ended unexpectedly');
		if (t.kind === '(') {
			const inner = parseOr();
			const close = next();
			if (!close || close.kind !== ')') throw bad(`expected ')' in $filter at position ${close ? close.pos : src.length}`);
			return inner;
		}
		if (t.kind === 'lit') return node({ type: 'lit', edm: t.edm, value: t.value });
		if (t.kind === 'ident') {
			if (LOGICAL.has(t.value) || Object.hasOwn(COMPARE_OPS, t.value)) throw bad(`unexpected '${t.value}' at position ${t.pos} in $filter`);
			if (peek() && peek().kind === '(') return parseCall(t);
			if (!Object.hasOwn(props, t.value)) throw bad(`unknown property '${t.value}' in $filter`);
			return node({ type: 'prop', name: t.value, edm: props[t.value].type });
		}
		throw bad(`unexpected '${t.value}' at position ${t.pos} in $filter`);
	}
	function parseCall(nameTok) {
		const name = nameTok.value;
		const fn = FUNCTIONS[name];
		if (!fn) throw unsupported(`the function '${name}' is not supported by this feed`);
		next();
		const args = [];
		if (peek() && peek().kind !== ')') {
			for (;;) {
				args.push(parseOr());
				if (peek() && peek().kind === ',') { next(); continue; }
				break;
			}
		}
		const close = next();
		if (!close || close.kind !== ')') throw bad(`expected ')' after the arguments of ${name}`);
		if (args.length !== fn.args.length) throw bad(`${name} takes ${fn.args.length} argument${fn.args.length === 1 ? '' : 's'}`);
		fn.args.forEach((want, i) => {
			const got = args[i].edm;
			const ok = want === 'temporal' ? got === 'Edm.Date' || got === 'Edm.DateTimeOffset' : got === want;
			if (!ok) throw bad(`argument ${i + 1} of ${name} must be ${want === 'temporal' ? 'a Date or DateTimeOffset' : want}`);
		});
		return node({ type: 'call', name, args, edm: fn.returns });
	}
	function requireBool(n) {
		if (n.edm !== 'Edm.Boolean') throw bad('$filter must be a boolean expression');
		return n;
	}

	const ast = requireBool(parseOr());
	if (pos < tokens.length) throw bad(`unexpected '${tokens[pos].value}' at position ${tokens[pos].pos} in $filter`);
	return ast;
}

function family(edm) {
	if (edm === null) return 'null';
	if (NUMERIC.has(edm)) return 'number';
	return edm;
}

function checkCompare(op, left, right) {
	const lf = family(left.edm);
	const rf = family(right.edm);
	if (lf === 'null' && rf === 'null') throw bad('cannot compare null with null');
	if (lf === 'null' || rf === 'null') {
		if (op !== 'eq' && op !== 'ne') throw bad(`null can only be compared with eq or ne, not ${op}`);
		return { type: 'cmp', op, left, right, edm: 'Edm.Boolean' };
	}
	const temporal = (f) => f === 'Edm.Date' || f === 'Edm.DateTimeOffset';
	// A Date literal against a DateTimeOffset property means midnight UTC on
	// that day, which is what Power Query and Excel users mean by it.
	const compatible = lf === rf || (temporal(lf) && temporal(rf) && (left.type === 'lit' || right.type === 'lit'));
	if (!compatible) throw bad(`cannot compare ${left.edm} with ${right.edm} in $filter`);
	if (lf === 'Edm.Boolean' && op !== 'eq' && op !== 'ne') throw bad('booleans can only be compared with eq or ne');
	return { type: 'cmp', op, left, right, edm: 'Edm.Boolean' };
}

// ── SQL compilation ─────────────────────────────────────────────────────────

/** Collects positional parameters for a raw query. */
export class Params {
	constructor() { this.values = []; }
	/** @param {any} v @param {string} [cast] */
	add(v, cast) {
		this.values.push(v);
		return cast ? `$${this.values.length}::${cast}` : `$${this.values.length}`;
	}
}

const LIT_CAST = {
	'Edm.String': 'text',
	'Edm.Int64': 'bigint',
	'Edm.Int32': 'int',
	'Edm.Decimal': 'numeric',
	'Edm.Double': 'double precision',
	'Edm.Date': 'date',
	'Edm.DateTimeOffset': 'timestamptz',
	'Edm.Boolean': 'boolean',
};

/** Quote a declared property name as a SQL identifier on the row alias. */
export const col = (name) => `e."${name.replace(/"/g, '')}"`;

/**
 * Compile a parsed $filter AST to a SQL boolean expression over alias `e`.
 * @param {object} n AST node from parseFilter
 * @param {Params} params
 * @returns {string}
 */
export function compileFilter(n, params) {
	switch (n.type) {
		case 'and': return `(${compileFilter(n.left, params)} and ${compileFilter(n.right, params)})`;
		case 'or': return `(${compileFilter(n.left, params)} or ${compileFilter(n.right, params)})`;
		case 'not': return `(not coalesce(${compileFilter(n.expr, params)}, false))`;
		case 'prop': return col(n.name);
		case 'lit': return n.edm === null ? 'null' : params.add(n.value, LIT_CAST[n.edm]);
		case 'cmp': {
			if (n.left.edm === null || n.right.edm === null) {
				const other = n.left.edm === null ? n.right : n.left;
				return `(${compileFilter(other, params)} ${n.op === 'eq' ? 'is null' : 'is not null'})`;
			}
			const side = (x, other) => {
				const sqlText = compileFilter(x, params);
				// Date against DateTimeOffset: midnight UTC, whatever the session time zone.
				return x.edm === 'Edm.Date' && other.edm === 'Edm.DateTimeOffset' ? `(${sqlText}::timestamp at time zone 'UTC')` : sqlText;
			};
			return `(${side(n.left, n.right)} ${COMPARE_OPS[n.op]} ${side(n.right, n.left)})`;
		}
		case 'call': {
			const a = n.args.map((x) => compileFilter(x, params));
			switch (n.name) {
				case 'contains': return `(strpos(${a[0]}, ${a[1]}) > 0)`;
				case 'startswith': return `starts_with(${a[0]}, ${a[1]})`;
				case 'endswith': return `(right(${a[0]}, char_length(${a[1]})) = ${a[1]})`;
				case 'tolower': return `lower(${a[0]})`;
				case 'toupper': return `upper(${a[0]})`;
				case 'trim': return `btrim(${a[0]})`;
				case 'length': return `char_length(${a[0]})`;
				case 'year': case 'month': case 'day': case 'hour': case 'minute': {
					const src = n.args[0].edm === 'Edm.DateTimeOffset' ? `(${a[0]} at time zone 'UTC')` : a[0];
					return `extract(${n.name} from ${src})::int`;
				}
				case 'date': return `(${a[0]} at time zone 'UTC')::date`;
				default: throw unsupported(`the function '${n.name}' is not supported by this feed`);
			}
		}
		default: throw bad('invalid $filter');
	}
}

// ── system query options ────────────────────────────────────────────────────

function parseNonNegInt(name, raw) {
	if (!/^\d{1,9}$/.test(raw)) throw bad(`${name} must be a non-negative integer`);
	return Number(raw);
}

/** Parse $select into property names (null = every property). */
export function parseSelect(raw, props) {
	if (raw == null) return null;
	const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
	if (!items.length) throw bad('$select is empty');
	if (items.includes('*')) return null;
	const out = [];
	for (const item of items) {
		if (item.includes('/') || item.includes('(')) throw unsupported('$select supports plain property names only');
		if (!Object.hasOwn(props, item)) throw bad(`unknown property '${item}' in $select`);
		if (!out.includes(item)) out.push(item);
	}
	return out;
}

/** Parse $orderby into [{ name, dir }]. */
export function parseOrderBy(raw, props) {
	if (raw == null) return [];
	const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
	if (!items.length) throw bad('$orderby is empty');
	if (items.length > MAX_ORDERBY_ITEMS) throw bad(`$orderby takes at most ${MAX_ORDERBY_ITEMS} properties`);
	return items.map((item) => {
		const m = item.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+(asc|desc))?$/);
		if (!m) throw unsupported(`$orderby supports property names with asc or desc only ('${item}')`);
		if (!Object.hasOwn(props, m[1])) throw bad(`unknown property '${m[1]}' in $orderby`);
		return { name: m[1], dir: m[2] === 'desc' ? 'desc' : 'asc' };
	});
}

/**
 * Validate and parse every system query option of a request.
 * @param {URLSearchParams} search
 * @param {Record<string, { type: string }>} props
 */
export function parseQueryOptions(search, props) {
	const seen = new Set();
	for (const key of search.keys()) {
		if (!key.startsWith('$')) continue;
		const lower = key.toLowerCase();
		if (!SYSTEM_OPTIONS.has(lower)) throw bad(`unknown system query option ${key}`);
		if (seen.has(lower)) throw bad(`${key} is given more than once`);
		seen.add(lower);
	}
	const get = (name) => {
		for (const [k, v] of search) if (k.toLowerCase() === name) return v;
		return null;
	};
	for (const name of ['$expand', '$search', '$apply', '$compute', '$levels', '$index', '$schemaversion']) {
		if (get(name) != null) throw unsupported(`${name} is not supported by this feed`);
	}
	const format = get('$format');
	if (format != null && !/^(json|application\/json)(;.*)?$/i.test(format)) throw unsupported('this feed serves JSON only ($format=json)');

	const count = get('$count');
	if (count != null && count !== 'true' && count !== 'false') throw bad('$count must be true or false');
	const top = get('$top');
	const skip = get('$skip');
	const token = get('$skiptoken');
	const filterRaw = get('$filter');

	return {
		select: parseSelect(get('$select'), props),
		filter: filterRaw == null ? null : parseFilter(filterRaw, props),
		orderBy: parseOrderBy(get('$orderby'), props),
		top: top == null ? null : parseNonNegInt('$top', top),
		skip: skip == null ? 0 : parseNonNegInt('$skip', skip),
		skipToken: token == null ? 0 : parseNonNegInt('$skiptoken', token),
		count: count === 'true',
	};
}

/**
 * The page a request reads: the SQL offset and limit, given the client's
 * $top/$skip, the server page size and the $skiptoken of the page it is on.
 * @returns {{ offset: number, limit: number }}
 */
export function pageWindow({ top, skip, skipToken }, pageSize) {
	const size = Math.max(1, Math.min(pageSize || MAX_PAGE_SIZE, MAX_PAGE_SIZE));
	const remaining = top == null ? Infinity : Math.max(top - skipToken, 0);
	return { offset: skip + skipToken, limit: Math.min(size, remaining) };
}

/** Read odata.maxpagesize from a Prefer header. */
export function preferredPageSize(preferHeader) {
	const m = String(preferHeader || '').match(/(?:^|[,;\s])(?:odata\.)?maxpagesize\s*=\s*(\d{1,9})/i);
	if (!m) return null;
	const n = Number(m[1]);
	return n > 0 ? Math.min(n, MAX_PAGE_SIZE) : null;
}
