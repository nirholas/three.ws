// Procedural sound on the same timeline as the picture. Every event time comes from
// timeline.js, so a retimed shot moves its sound with it. Seeded noise keeps the
// output byte-identical between runs. Writes out/audio.wav (44.1 kHz, 16-bit, stereo).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DURATION, BEATS, typedTimes } from './timeline.js';

const SR = 44100;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = Math.ceil(DURATION * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

let seed = 0x3d5eed;
const rnd = () => {
	seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	return seed / 0x100000000 * 2 - 1;
};

function add(t, dur, fn, gain = 1, pan = 0) {
	const i0 = Math.max(0, Math.floor(t * SR));
	const n = Math.min(N - i0, Math.floor(dur * SR));
	const gl = gain * Math.cos((pan + 1) * Math.PI / 4);
	const gr = gain * Math.sin((pan + 1) * Math.PI / 4);
	for (let i = 0; i < n; i++) {
		const v = fn(i / SR, i / n);
		L[i0 + i] += v * gl;
		R[i0 + i] += v * gr;
	}
}

const env = (x, a, d) => (x < a ? x / a : Math.exp(-(x - a) * d));
const tri = (ph) => 2 * Math.abs(2 * (ph - Math.floor(ph + 0.5))) - 1;

function tick(t, pitch = 1, gain = 0.22) {
	let lp = 0;
	add(t, 0.05, (x) => {
		lp += (rnd() - lp) * 0.55;
		return (lp * 0.8 + Math.sin(2 * Math.PI * 1800 * pitch * x) * 0.3) * env(x, 0.0008, 140);
	}, gain, rnd() * 0.15);
}

function hit(t, gain = 0.8, f0 = 62) {
	add(t, 0.9, (x) => {
		const f = f0 + 90 * Math.exp(-x * 28);
		return Math.sin(2 * Math.PI * f * x) * env(x, 0.002, 5) + rnd() * 0.18 * env(x, 0.001, 38);
	}, gain);
}

function whoosh(t, dur = 0.55, gain = 0.3, up = true) {
	let lp = 0;
	add(t, dur, (x, u) => {
		const sweep = up ? u : 1 - u;
		lp += (rnd() - lp) * (0.04 + 0.5 * sweep * sweep);
		return lp * Math.sin(Math.PI * u) ** 1.5;
	}, gain * 2.2, up ? -0.3 : 0.3);
}

function click(t, gain = 0.3) {
	add(t, 0.04, (x) => Math.sin(2 * Math.PI * 2600 * x) * env(x, 0.0005, 190), gain, 0.1);
}

function note(t, dur, freq, gain, pan = 0) {
	add(t, dur, (x, u) => {
		const ph = freq * x;
		const v = tri(ph) * 0.6 + Math.sin(2 * Math.PI * ph * 2) * 0.12;
		return v * env(x, 0.012, 2.4) * (1 - u * u);
	}, gain, pan);
}

for (const t of typedTimes()) tick(t, 0.9 + (Math.floor(t * 997) % 5) * 0.05);

hit(BEATS.noBody, 0.55, 54);
hit(BEATS.reveal, 0.85, 62);
whoosh(BEATS.reveal - 0.25, 0.4, 0.25, true);

whoosh(BEATS.forgeIn - 0.2, 0.55, 0.3, true);
click(BEATS.forgeSettle);
whoosh(BEATS.forgeOut - 0.15, 0.5, 0.26, false);

const BPM = 116;
const beat = 60 / BPM;
for (let t = BEATS.aliveIn, k = 0; t < BEATS.aliveOut + 0.2; t += beat, k++) {
	hit(t, 0.32, 50);
	if (k % 2 === 1) tick(t, 0.6, 0.3);
	tick(t + beat / 2, 1.3, 0.12);
}
for (const t of BEATS.chips) click(t, 0.38);

whoosh(BEATS.marketIn - 0.2, 0.5, 0.28, true);
click(BEATS.marketSettle);
whoosh(BEATS.marketOut - 0.15, 0.45, 0.24, false);

const chord = [220, 277.18, 329.63, 440];
chord.forEach((f, i) => note(BEATS.close, 2.4, f, 0.12, (i - 1.5) * 0.25));
hit(BEATS.close, 0.7, 58);
hit(BEATS.finalHit, 0.6, 70);
click(BEATS.finalHit + 0.02, 0.4);

// Fade the tail, soft-limit, interleave.
const buf = Buffer.alloc(N * 4);
const fadeFrom = DURATION - 0.6;
for (let i = 0; i < N; i++) {
	const t = i / SR;
	const f = t > fadeFrom ? Math.max(0, 1 - (t - fadeFrom) / 0.6) : 1;
	const l = Math.tanh(L[i] * 0.9) * f;
	const r = Math.tanh(R[i] * 0.9) * f;
	buf.writeInt16LE(Math.round(l * 32000), i * 4);
	buf.writeInt16LE(Math.round(r * 32000), i * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + buf.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(buf.length, 40);

mkdirSync(path.join(root, 'out'), { recursive: true });
const out = path.join(root, 'out', 'audio.wav');
writeFileSync(out, Buffer.concat([header, buf]));
console.log(`audio ${out} ${DURATION}s`);
