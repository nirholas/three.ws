// Framebuffer to terminal escape sequences.
//
// The trick that makes this look like graphics instead of ASCII art: the upper
// half block, U+2580. One character cell carries a foreground colour and a
// background colour, so writing it with fg = the top pixel and bg = the bottom
// pixel gives two independently coloured pixels per cell. That doubles vertical
// resolution and, more importantly, makes pixels square: terminal cells are
// roughly 1:2, so a half-block grid has a 1:1 pixel aspect and a sphere comes
// out round instead of squashed.

const UPPER_HALF = '▀';
const ESC = '\x1b';
const RESET = `${ESC}[0m`;

// Dense to sparse. Only used when the terminal cannot do colour at all, where
// luminance has to carry the whole image on its own.
const RAMP = '@%#*+=-:. ';
// Bright ink is a solid block. The ASCII ramp above is inverted on purpose
// (dense characters for dark pixels); density mode is the positive image.
const BLOCKS = ' ░▒▓█';

export const GLYPH_STYLES = ['half', 'density', 'braille', 'ascii', 'points', 'matrix'];

export const ColorMode = {
	TRUECOLOR: 'truecolor',
	ANSI256: 'ansi256',
	MONO: 'mono',
};

/**
 * What the current terminal can actually render.
 *
 * Deliberately conservative: guessing truecolor wrong sprays literal escape
 * garbage across the user's screen, while guessing 256 wrong just looks
 * slightly flatter. NO_COLOR is honoured because it is a standard and ignoring
 * it in a rendering tool would be obnoxious.
 */
export function detectColorMode(env = process.env, stream = process.stdout) {
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return ColorMode.MONO;
	if (env.THREE_TTY_COLOR && Object.values(ColorMode).includes(env.THREE_TTY_COLOR)) return env.THREE_TTY_COLOR;
	if (env.TERM === 'dumb') return ColorMode.MONO;
	const colorterm = (env.COLORTERM || '').toLowerCase();
	if (colorterm === 'truecolor' || colorterm === '24bit') return ColorMode.TRUECOLOR;
	if (/-truecolor|-direct/.test(env.TERM || '')) return ColorMode.TRUECOLOR;
	// A modern terminal reporting 256 colours is very likely truecolor too, but
	// "likely" is not good enough when being wrong is visible garbage.
	if (/256(color)?/.test(env.TERM || '')) return ColorMode.ANSI256;
	if (stream && stream.isTTY) return ColorMode.ANSI256;
	return ColorMode.MONO;
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));

/** Nearest xterm-256 index: the 6x6x6 colour cube, or the 24-step grey ramp. */
export function toAnsi256(r, g, b) {
	const R = clamp255(r), G = clamp255(g), B = clamp255(b);
	if (Math.abs(R - G) < 8 && Math.abs(G - B) < 8) {
		if (R < 8) return 16;
		if (R > 248) return 231;
		return 232 + Math.round(((R - 8) / 247) * 23);
	}
	const q = (v) => Math.round(v / 51);
	return 16 + 36 * q(R) + 6 * q(G) + q(B);
}

function luminance(r, g, b) {
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Render a framebuffer to a string of terminal rows.
 *
 * @param {object} fb                  framebuffer; height should be even for half blocks
 * @param {object} [opts]
 * @param {string} [opts.mode]         a ColorMode value
 * @param {string} [opts.style]        half (default), density, braille, or ascii
 * @param {number[]} [opts.background] rgb 0..1 painted where nothing was drawn
 * @param {boolean} [opts.transparent] leave uncovered cells as plain spaces
 */
export function framebufferToText(fb, opts = {}) {
	const style = opts.style ?? 'half';
	if (style === 'braille') return brailleText(fb, opts);
	if (style === 'density' || style === 'ascii') return glyphText(fb, opts, style);
	const mode = opts.mode ?? ColorMode.TRUECOLOR;
	const bg = opts.background ?? [0.031, 0.031, 0.078];
	const transparent = opts.transparent ?? false;
	const rows = [];

	for (let y = 0; y < fb.height; y += 2) {
		let line = '';
		// Escape sequences are only emitted when the colour actually changes.
		// A 120-wide frame is 240 colour writes if you are naive about it, and
		// the redundant ones are pure bandwidth: over SSH or a curl stream that
		// is the difference between smooth and stuttering.
		let lastFg = null;
		let lastBg = null;
		// Whether this row ever set a colour. A fully transparent row must come
		// out as plain spaces with no trailing reset, so that piping a
		// --transparent render into a file produces text a human can read and
		// diff rather than escape-sequence confetti.
		let painted = false;

		for (let x = 0; x < fb.width; x += 1) {
			const topIdx = y * fb.width + x;
			const botIdx = Math.min(fb.height - 1, y + 1) * fb.width + x;
			const topOn = fb.coverage[topIdx] === 1;
			const botOn = fb.coverage[botIdx] === 1;

			if (transparent && !topOn && !botOn) {
				if (lastFg !== null || lastBg !== null) { line += RESET; lastFg = null; lastBg = null; painted = true; }
				line += ' ';
				continue;
			}

			const tr = topOn ? fb.color[topIdx * 3] : bg[0];
			const tg = topOn ? fb.color[topIdx * 3 + 1] : bg[1];
			const tb = topOn ? fb.color[topIdx * 3 + 2] : bg[2];
			const br = botOn ? fb.color[botIdx * 3] : bg[0];
			const bgn = botOn ? fb.color[botIdx * 3 + 1] : bg[1];
			const bb = botOn ? fb.color[botIdx * 3 + 2] : bg[2];

			if (mode === ColorMode.MONO) {
				const l = (luminance(tr, tg, tb) + luminance(br, bgn, bb)) / 2;
				line += (topOn || botOn) ? RAMP[Math.min(RAMP.length - 1, Math.floor((1 - l) * RAMP.length))] : ' ';
				continue;
			}

			let fgSeq;
			let bgSeq;
			if (mode === ColorMode.ANSI256) {
				const f = toAnsi256(tr, tg, tb);
				const b = toAnsi256(br, bgn, bb);
				fgSeq = f === lastFg ? '' : `${ESC}[38;5;${f}m`;
				bgSeq = b === lastBg ? '' : `${ESC}[48;5;${b}m`;
				lastFg = f; lastBg = b;
			} else {
				const f = `${clamp255(tr)};${clamp255(tg)};${clamp255(tb)}`;
				const b = `${clamp255(br)};${clamp255(bgn)};${clamp255(bb)}`;
				fgSeq = f === lastFg ? '' : `${ESC}[38;2;${f}m`;
				bgSeq = b === lastBg ? '' : `${ESC}[48;2;${b}m`;
				lastFg = f; lastBg = b;
			}
			line += fgSeq + bgSeq + UPPER_HALF;
			painted = true;
		}

		rows.push(mode === ColorMode.MONO || !painted ? line : line + RESET);
	}
	return rows.join('\n');
}

function sample(fb, x, y, bg) {
	if (x < 0 || y < 0 || x >= fb.width || y >= fb.height) return { on: false, r: bg[0], g: bg[1], b: bg[2] };
	const idx = y * fb.width + x;
	const on = fb.coverage[idx] === 1;
	const o = idx * 3;
	return {
		on,
		r: on ? fb.color[o] : bg[0],
		g: on ? fb.color[o + 1] : bg[1],
		b: on ? fb.color[o + 2] : bg[2],
	};
}

/**
 * One character per cell. Density uses block glyphs and keeps colour. ASCII
 * uses the luminance ramp and drops colour, matching a mono terminal.
 */
function glyphText(fb, opts, style) {
	const mode = style === 'ascii' ? ColorMode.MONO : (opts.mode ?? ColorMode.TRUECOLOR);
	const bg = opts.background ?? [0.031, 0.031, 0.078];
	const transparent = opts.transparent ?? false;
	const ramp = style === 'ascii' ? RAMP : BLOCKS;
	const rows = [];
	for (let y = 0; y < fb.height; y += 2) {
		let line = '';
		let lastFg = null;
		let painted = false;
		for (let x = 0; x < fb.width; x += 1) {
			const top = sample(fb, x, y, bg);
			const bot = sample(fb, x, Math.min(fb.height - 1, y + 1), bg);
			const on = top.on || bot.on;
			if (transparent && !on) {
				if (lastFg !== null) { line += RESET; lastFg = null; painted = true; }
				line += ' ';
				continue;
			}
			const r = (top.r + bot.r) / 2;
			const g = (top.g + bot.g) / 2;
			const b = (top.b + bot.b) / 2;
			const lit = luminance(r, g, b);
			// ASCII keeps the historical ramp (bright pixels go sparse). Density
			// is a positive image: a lit pixel is a solid block.
			const glyph = style === 'ascii'
				? (on ? ramp[Math.min(ramp.length - 1, Math.floor((1 - lit) * ramp.length))] : ' ')
				: (on ? ramp[Math.min(ramp.length - 1, Math.floor(lit * (ramp.length - 1)))] : ' ');
			if (mode === ColorMode.MONO || style === 'ascii') {
				line += glyph;
				continue;
			}
			const f = mode === ColorMode.ANSI256
				? String(toAnsi256(r, g, b))
				: `${clamp255(r)};${clamp255(g)};${clamp255(b)}`;
			const fgSeq = f === lastFg ? '' : (mode === ColorMode.ANSI256 ? `${ESC}[38;5;${f}m` : `${ESC}[38;2;${f}m`);
			lastFg = f;
			line += fgSeq + glyph;
			painted = true;
		}
		rows.push(mode === ColorMode.MONO || style === 'ascii' || !painted ? line : line + RESET);
	}
	return rows.join('\n');
}

// Braille dot bits, left column then right, top to bottom.
const BRAILLE_BIT = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];

/** 2x4 pixels per cell. The framebuffer is cols*2 by rows*4. */
function brailleText(fb, opts) {
	const mode = opts.mode ?? ColorMode.TRUECOLOR;
	const bg = opts.background ?? [0.031, 0.031, 0.078];
	const transparent = opts.transparent ?? false;
	const cols = Math.floor(fb.width / 2);
	const rowCount = Math.floor(fb.height / 4);
	const rows = [];
	for (let row = 0; row < rowCount; row += 1) {
		let line = '';
		let lastFg = null;
		let painted = false;
		for (let col = 0; col < cols; col += 1) {
			let mask = 0;
			let r = 0;
			let g = 0;
			let b = 0;
			let n = 0;
			for (let dy = 0; dy < 4; dy += 1) {
				for (let dx = 0; dx < 2; dx += 1) {
					const px = sample(fb, col * 2 + dx, row * 4 + dy, bg);
					if (!px.on) continue;
					mask |= BRAILLE_BIT[dx * 4 + dy];
					r += px.r; g += px.g; b += px.b;
					n += 1;
				}
			}
			if (!mask) {
				if (transparent && lastFg !== null) { line += RESET; lastFg = null; painted = true; }
				line += ' ';
				continue;
			}
			const ch = String.fromCodePoint(0x2800 + mask);
			if (mode === ColorMode.MONO) {
				line += ch;
				continue;
			}
			const cr = r / n;
			const cg = g / n;
			const cb = b / n;
			const f = mode === ColorMode.ANSI256
				? String(toAnsi256(cr, cg, cb))
				: `${clamp255(cr)};${clamp255(cg)};${clamp255(cb)}`;
			const fgSeq = f === lastFg ? '' : (mode === ColorMode.ANSI256 ? `${ESC}[38;5;${f}m` : `${ESC}[38;2;${f}m`);
			lastFg = f;
			line += fgSeq + ch;
			painted = true;
		}
		rows.push(mode === ColorMode.MONO || !painted ? line : line + RESET);
	}
	return rows.join('\n');
}

export const ansi = {
	hideCursor: `${ESC}[?25l`,
	showCursor: `${ESC}[?25h`,
	clearScreen: `${ESC}[2J${ESC}[H`,
	home: `${ESC}[H`,
	// Move the cursor up n lines to overdraw the previous frame in place. This
	// is what keeps an animation from scrolling the scrollback into oblivion,
	// and unlike a full clear it does not flicker.
	up: (n) => (n > 0 ? `${ESC}[${n}A` : ''),
};
