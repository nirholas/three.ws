// Terminal output. Colour and glyphs follow NO_COLOR / FORCE_COLOR / --no-color
// and degrade to plain ASCII off a TTY. With --json every command prints one
// JSON document on stdout and nothing else, so it pipes into jq or a CI step.

import os from 'node:os';

const argv = process.argv;
const noColor = argv.includes('--no-color') || (process.env.NO_COLOR != null && process.env.NO_COLOR !== '');
const forceColor = ['1', '2', '3', 'true'].includes(process.env.FORCE_COLOR ?? '');
export const isTTY = Boolean(process.stdout.isTTY);
const color = !noColor && (forceColor || isTTY);

const paint = (code) => (t) => (color ? `\x1b[${code}m${t}\x1b[0m` : String(t));
export const c = {
	bold: paint(1),
	dim: paint(2),
	red: paint(31),
	green: paint(32),
	yellow: paint(33),
	cyan: paint(36),
	gray: paint(90),
};

const unicode = isTTY || forceColor;
export const sym = {
	ok: unicode ? '✔' : 'ok',
	fail: unicode ? '✖' : 'x',
	warn: unicode ? '▲' : '!',
	dot: unicode ? '•' : '-',
	arrow: unicode ? '→' : '->',
};

export function tildify(p) {
	const home = os.homedir();
	return p && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

export function printJson(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function line(text = '') {
	process.stdout.write(`${text}\n`);
}

export function errorLine(text) {
	process.stderr.write(`${c.red(sym.fail)} ${text}\n`);
}

/** Two-column rows with the label column padded to the widest label. */
export function rows(pairs, indent = '') {
	const width = Math.max(...pairs.map(([k]) => k.length));
	for (const [k, v] of pairs) line(`${indent}${c.dim(k.padEnd(width))}  ${v}`);
}

export function relativeExpiry(ms, now = Date.now()) {
	const delta = Math.round((ms - now) / 1000);
	if (delta <= 0) return 'expired';
	if (delta < 90) return `in ${delta}s`;
	const mins = Math.round(delta / 60);
	if (mins < 90) return `in ${mins}m`;
	return `in ${Math.round(mins / 60)}h`;
}

export function shortAddress(a) {
	return a && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || '';
}
