/**
 * Minimal QR-code generator (zero-dep, ESM).
 *
 * Implements QR Model 2, byte mode, error-correction level L, versions 1–10.
 * That's enough to encode URLs up to ~174 UTF-8 bytes at ECL=L — which covers
 * every explorer URL we'd embed in an ERC-8004 agent QR.
 *
 * Derived from Project Nayuki's public-domain QR code generator
 * (https://www.nayuki.io/page/qr-code-generator-library) reduced to the
 * minimum path this app needs. Pure JS, no external deps.
 */

// ───────────────────────────────────────────────────────────────────────────
// Generator
// ───────────────────────────────────────────────────────────────────────────

const ECL = 0; // L (1 = M, 2 = Q, 3 = H). We only need L.

const EC_CODEWORDS_PER_BLOCK = [
	// ECL_L
	[7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
];
const NUM_EC_BLOCKS = [[1, 1, 1, 1, 1, 2, 2, 2, 2, 4]];

/** Returns the bitmask size (modules per side) for a given version (1..10). */
function sizeForVersion(ver) {
	return ver * 4 + 17;
}

/** Total number of data codewords for a given version + ECL. */
function numDataCodewords(ver) {
	const total = numRawDataModules(ver) >>> 3;
	const ecBlocks = NUM_EC_BLOCKS[ECL][ver - 1];
	const ecPerBlock = EC_CODEWORDS_PER_BLOCK[ECL][ver - 1];
	return total - ecPerBlock * ecBlocks;
}

function numRawDataModules(ver) {
	let result = (16 * ver + 128) * ver + 64;
	if (ver >= 2) {
		const numAlign = Math.floor(ver / 7) + 2;
		result -= (25 * numAlign - 10) * numAlign - 55;
		if (ver >= 7) result -= 36;
	}
	return result;
}

// Reed–Solomon in GF(256)
function rsGenerator(degree) {
	const result = new Uint8Array(degree);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = rsMul(result[j], root);
			if (j + 1 < degree) result[j] ^= result[j + 1];
		}
		root = rsMul(root, 0x02);
	}
	return result;
}
function rsMul(x, y) {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z & 0xff;
}
function rsRemainder(data, gen) {
	const result = new Uint8Array(gen.length);
	for (const b of data) {
		const factor = b ^ result[0];
		result.copyWithin(0, 1);
		result[result.length - 1] = 0;
		for (let i = 0; i < result.length; i++) result[i] ^= rsMul(gen[i], factor);
	}
	return result;
}

// Pick the smallest version (1..10) that fits `dataLen` bytes in byte mode at ECL=L.
function pickVersion(dataLen) {
	for (let v = 1; v <= 10; v++) {
		const bitsAvailable = numDataCodewords(v) * 8;
		// byte mode: 4 (mode) + (v<10 ? 8 : 16) char-count + 8*len
		const charCountBits = v < 10 ? 8 : 16;
		const needed = 4 + charCountBits + dataLen * 8;
		if (needed <= bitsAvailable) return v;
	}
	throw new Error('QR payload too large (>10 versions)');
}

/**
 * Generate a QR code matrix for the given string.
 *
 * @param {string} text
 * @returns {{ size: number, modules: boolean[][] }}
 */
export function generateQR(text) {
	const bytes = new TextEncoder().encode(text);
	const ver = pickVersion(bytes.length);
	const size = sizeForVersion(ver);
	const charCountBits = ver < 10 ? 8 : 16;

	// --- 1. Build bitstream ------------------------------------------------
	const bits = [];
	const pushBits = (val, n) => {
		for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
	};
	pushBits(0b0100, 4); // byte mode
	pushBits(bytes.length, charCountBits);
	for (const b of bytes) pushBits(b, 8);

	const dataCodewords = numDataCodewords(ver);
	const capacityBits = dataCodewords * 8;
	// terminator
	for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
	// byte-align
	while (bits.length % 8 !== 0) bits.push(0);
	// pad
	const pads = [0xec, 0x11];
	let padIdx = 0;
	while (bits.length < capacityBits) {
		pushBits(pads[padIdx % 2], 8);
		padIdx++;
	}
	const data = new Uint8Array(dataCodewords);
	for (let i = 0; i < dataCodewords; i++) {
		let v = 0;
		for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
		data[i] = v;
	}

	// --- 2. Reed–Solomon EC ------------------------------------------------
	const numBlocks = NUM_EC_BLOCKS[ECL][ver - 1];
	const ecLen = EC_CODEWORDS_PER_BLOCK[ECL][ver - 1];
	const rawCodewords = numRawDataModules(ver) >>> 3;
	const shortBlockLen = Math.floor(rawCodewords / numBlocks);
	const numShort = numBlocks - (rawCodewords % numBlocks);

	const blocks = [];
	const gen = rsGenerator(ecLen);
	let offset = 0;
	for (let i = 0; i < numBlocks; i++) {
		const dataLen = shortBlockLen - ecLen + (i < numShort ? 0 : 1);
		const dat = data.slice(offset, offset + dataLen);
		offset += dataLen;
		const ec = rsRemainder(dat, gen);
		blocks.push({ dat, ec });
	}
	// Interleave
	const out = [];
	for (let i = 0; i < shortBlockLen - ecLen + 1; i++) {
		for (const b of blocks) {
			if (i < b.dat.length) out.push(b.dat[i]);
		}
	}
	for (let i = 0; i < ecLen; i++) {
		for (const b of blocks) out.push(b.ec[i]);
	}

	// --- 3. Matrix ---------------------------------------------------------
	const modules = Array.from({ length: size }, () => new Array(size).fill(false));
	const isFn = Array.from({ length: size }, () => new Array(size).fill(false));

	const setFn = (x, y, dark) => {
		modules[y][x] = dark;
		isFn[y][x] = true;
	};

	// Finder + separators
	const drawFinder = (cx, cy) => {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const x = cx + dx;
				const y = cy + dy;
				if (x < 0 || x >= size || y < 0 || y >= size) continue;
				const d = Math.max(Math.abs(dx), Math.abs(dy));
				setFn(x, y, d !== 2 && d !== 4);
			}
		}
	};
	drawFinder(3, 3);
	drawFinder(size - 4, 3);
	drawFinder(3, size - 4);

	// Timing
	for (let i = 0; i < size; i++) {
		if (!isFn[6][i]) setFn(i, 6, i % 2 === 0);
		if (!isFn[i][6]) setFn(6, i, i % 2 === 0);
	}

	// Alignment patterns
	const alignPositions = (ver) => {
		if (ver === 1) return [];
		const num = Math.floor(ver / 7) + 2;
		const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
		const result = [6];
		for (let pos = size - 7; result.length < num; pos -= step) result.splice(1, 0, pos);
		return result;
	};
	const aps = alignPositions(ver);
	for (const x of aps) {
		for (const y of aps) {
			if ((x === 6 && y === 6) || (x === 6 && y === size - 7) || (x === size - 7 && y === 6))
				continue;
			for (let dy = -2; dy <= 2; dy++) {
				for (let dx = -2; dx <= 2; dx++) {
					const d = Math.max(Math.abs(dx), Math.abs(dy));
					setFn(x + dx, y + dy, d !== 1);
				}
			}
		}
	}

	// Reserve format info area
	for (let i = 0; i < 9; i++) setFn(8, i, false);
	for (let i = 0; i < 8; i++) setFn(i, 8, false);
	for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, false);
	for (let i = 0; i < 7; i++) setFn(8, size - 1 - i, false);
	setFn(8, size - 8, true); // dark module

	// Version info (ver >= 7)
	if (ver >= 7) {
		let rem = ver;
		for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
		const bits = ((ver << 12) | rem) >>> 0;
		for (let i = 0; i < 18; i++) {
			const bit = ((bits >>> i) & 1) === 1;
			const a = size - 11 + (i % 3);
			const b = Math.floor(i / 3);
			setFn(a, b, bit);
			setFn(b, a, bit);
		}
	}

	// --- 4. Place data by zig-zag -----------------------------------------
	let bitIdx = 0;
	const bitAt = (i) => ((out[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vert = 0; vert < size; vert++) {
			for (let j = 0; j < 2; j++) {
				const x = right - j;
				const upward = ((right + 1) & 2) === 0;
				const y = upward ? size - 1 - vert : vert;
				if (!isFn[y][x] && bitIdx < out.length * 8) {
					modules[y][x] = bitAt(bitIdx);
					bitIdx++;
				}
			}
		}
	}

	// --- 5. Try all 8 masks; pick lowest penalty --------------------------
	let bestMask = 0;
	let bestPenalty = Infinity;
	let bestModules = null;
	for (let mask = 0; mask < 8; mask++) {
		const m = modules.map((row) => row.slice());
		applyMask(m, isFn, mask);
		applyFormatInfo(m, mask);
		const p = penalty(m);
		if (p < bestPenalty) {
			bestPenalty = p;
			bestMask = mask;
			bestModules = m;
		}
	}
	return { size, modules: bestModules };
}

function maskFn(mask, x, y) {
	switch (mask) {
		case 0:
			return (x + y) % 2 === 0;
		case 1:
			return y % 2 === 0;
		case 2:
			return x % 3 === 0;
		case 3:
			return (x + y) % 3 === 0;
		case 4:
			return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5:
			return ((x * y) % 2) + ((x * y) % 3) === 0;
		case 6:
			return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
		case 7:
			return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
	}
	return false;
}

function applyMask(modules, isFn, mask) {
	const size = modules.length;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!isFn[y][x] && maskFn(mask, x, y)) modules[y][x] = !modules[y][x];
		}
	}
}

function applyFormatInfo(modules, mask) {
	const size = modules.length;
	const data = (ECL_BITS[ECL] << 3) | mask;
	let rem = data;
	for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
	const bits = (((data << 10) | rem) ^ 0x5412) >>> 0;
	const setBit = (x, y, b) => {
		modules[y][x] = b;
	};
	for (let i = 0; i <= 5; i++) setBit(8, i, ((bits >>> i) & 1) === 1);
	setBit(8, 7, ((bits >>> 6) & 1) === 1);
	setBit(8, 8, ((bits >>> 7) & 1) === 1);
	setBit(7, 8, ((bits >>> 8) & 1) === 1);
	for (let i = 9; i < 15; i++) setBit(14 - i, 8, ((bits >>> i) & 1) === 1);
	for (let i = 0; i < 8; i++) setBit(size - 1 - i, 8, ((bits >>> i) & 1) === 1);
	for (let i = 8; i < 15; i++) setBit(8, size - 15 + i, ((bits >>> i) & 1) === 1);
	setBit(8, size - 8, true);
}

const ECL_BITS = [1, 0, 3, 2]; // index by ECL 0..3 → {L,M,Q,H}

function penalty(modules) {
	const size = modules.length;
	let p = 0;
	// N1: runs of 5+
	for (let y = 0; y < size; y++) {
		let run = 1;
		for (let x = 1; x < size; x++) {
			if (modules[y][x] === modules[y][x - 1]) {
				run++;
				if (run === 5) p += 3;
				else if (run > 5) p++;
			} else run = 1;
		}
	}
	for (let x = 0; x < size; x++) {
		let run = 1;
		for (let y = 1; y < size; y++) {
			if (modules[y][x] === modules[y - 1][x]) {
				run++;
				if (run === 5) p += 3;
				else if (run > 5) p++;
			} else run = 1;
		}
	}
	// N2: 2×2 blocks
	for (let y = 0; y < size - 1; y++) {
		for (let x = 0; x < size - 1; x++) {
			const c = modules[y][x];
			if (modules[y][x + 1] === c && modules[y + 1][x] === c && modules[y + 1][x + 1] === c)
				p += 3;
		}
	}
	// N3: finder-like patterns — skipped for brevity; penalty approximation is fine for URLs.
	// N4: light/dark imbalance
	let dark = 0;
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
	const total = size * size;
	const k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
	p += k * 10;
	return p;
}

// ───────────────────────────────────────────────────────────────────────────
// Renderers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Render a QR code into a canvas. Returns the canvas.
 * @param {string} text
 * @param {{ scale?: number, margin?: number }} [opts]
 */
export function renderQRToCanvas(text, opts = {}) {
	const scale = opts.scale ?? 8;
	const margin = opts.margin ?? 2;
	const { size, modules } = generateQR(text);
	const pixels = (size + margin * 2) * scale;
	const canvas = document.createElement('canvas');
	canvas.width = pixels;
	canvas.height = pixels;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, pixels, pixels);
	ctx.fillStyle = '#000';
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (modules[y][x]) {
				ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
			}
		}
	}
	return canvas;
}
