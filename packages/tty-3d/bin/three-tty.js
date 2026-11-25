#!/usr/bin/env node
// three-tty: render a 3D model in your terminal.
//
//   npx @three-ws/tty-3d ./avatar.glb
//   npx @three-ws/tty-3d https://three.ws/avatars/default.glb --spin 1.4
//   npx @three-ws/tty-3d model.glb --once --width 80 > frame.txt
//
// Reads a GLB, plays its animation, and draws it with half-block characters.
// No GPU, no browser, no display server.

import process from 'node:process';
import { readFile, stat } from 'node:fs/promises';
import { loadModel, createRenderer, createScene, describeModel, isScene, normalizeStyle } from '../src/index.js';
import { ansi, detectColorMode, ColorMode } from '../src/term.js';
import { DEFAULT_ORIGIN, KEYS_URL, apiKeyFromEnv, forgeModel, uploadImage } from '../src/make.js';
import { contentTypeFor, findNewestMedia, mediaKind } from '../src/find-media.js';
import { grabVideoFrame } from '../src/video-frame.js';

const ESC = '\x1b';

const USAGE = `three-tty: a 3D model in your terminal

Usage
  three-tty <model.glb | https://...> [options]
  three-tty --scene <walk|birds|donut|shader|splats|...> [options]
  three-tty --prompt "a ceramic teapot"
  three-tty photo.jpg
  three-tty clip.mp4
  three-tty --find [directory]

Options
  --prompt <text>    make a model from a description, then draw it
  --image <file>     make a model from a photo, then draw it
  --video <file>     reconstruct one frame of a video, then draw it
  --find             newest photo here, or newest video when combined with --video.
                     A directory argument picks the folder instead of the current one
  --scene <name>     a built-in picture: walk, orbit, parade, meet, birds,
                     donut, shader, draw, splats, say
  --width <n>        columns (default: terminal width, capped at 400)
  --height <n>       rows (default: terminal height minus 2)
  --fps <n>          frames per second (default 24)
  --spin <n>         turntable speed in radians per second (default 0.9, 0 to stop)
  --yaw <r>          camera azimuth in radians (default 0, or the scene's own)
  --clip <name|n>    animation to play (default: the first one)
  --no-anim          hold the rest pose
  --once             draw a single frame and exit (pipe-friendly)
  --frames <n>       draw n frames and exit
  --time <s>         timestamp for --once (default 0)
  --pitch <r>        camera elevation in radians (default 0.08)
  --zoom <n>         1 fits the model, higher moves closer
  --style <name>     half, density, braille, ascii, points, or matrix
  --text <words>     words for --scene say
  --color <mode>     truecolor | ansi256 | mono (default: detected)
  --transparent      leave the background unpainted
  --info             print what was loaded, then exit
  --help

Controls (interactive)
  left/right or a/d   orbit      up/down or w/s   tilt
  +/-                 zoom       space            pause
  q or Ctrl-C         quit
`;

function parseArgs(argv) {
	const opts = { _: [] };
	const takesValue = new Set(['width', 'height', 'fps', 'spin', 'yaw', 'clip', 'frames', 'time', 'pitch', 'zoom', 'color', 'scene', 'style', 'text', 'prompt', 'image', 'video']);
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith('--')) { opts._.push(arg); continue; }
		const key = arg.slice(2);
		if (takesValue.has(key)) {
			const next = argv[i + 1];
			// A following flag is the next option, not this option's value.
			// `--find --video` means the newest video, not a file named "--video".
			if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i += 1; }
			else opts[key] = true;
		} else opts[key] = true;
	}
	return opts;
}

const num = (v, fallback) => {
	if (typeof v === 'boolean' || v == null || v === '') return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
};

function fail(message) {
	process.stderr.write(`three-tty: ${message}\n`);
	process.exit(1);
}

// A prompt, a photo, a video frame, or the newest file in a folder. Returns a
// GLB URL, or null when the caller passed an ordinary model.
async function madeSource(opts) {
	if (opts.scene) {
		if (opts.prompt !== undefined || opts.image !== undefined || opts.video !== undefined || opts.find) {
			fail('pass a scene or something to make, not both');
		}
		return null;
	}
	const positional = opts._[0];
	let dir = null;
	let image = typeof opts.image === 'string' ? opts.image : null;
	let video = typeof opts.video === 'string' ? opts.video : null;
	const askedPrompt = opts.prompt !== undefined;
	const prompt = typeof opts.prompt === 'string' ? opts.prompt : '';

	if (positional && !image && !video) {
		const st = await stat(positional).catch(() => null);
		if (st?.isDirectory()) dir = positional;
		else {
			const kind = mediaKind(positional);
			if (kind === 'image') image = positional;
			else if (kind === 'video') video = positional;
			else if (askedPrompt || opts.find || opts.image || opts.video) fail('that file is not a photo or a video');
			else return null;
		}
	}

	// `--video ~/Clips` and `--find --video ~/Clips` name a folder to search,
	// not a single file. A real file keeps its path.
	for (const candidate of [image, video]) {
		if (!candidate) continue;
		const st = await stat(candidate).catch(() => null);
		if (!st?.isDirectory()) continue;
		dir = candidate;
		if (candidate === image) image = null;
		if (candidate === video) video = null;
	}

	const making = Boolean(prompt.trim() || askedPrompt || image || video || opts.find || dir);
	if (!making) return null;

	if (!image && !video && (opts.find || dir)) {
		const where = dir || process.cwd();
		const want = opts.video !== undefined && opts.image === undefined ? 'video' : 'image';
		const found = findNewestMedia(where, want) || (want === 'image' ? findNewestMedia(where, 'any') : null);
		if (!found) fail(want === 'video' ? `no video in ${where}` : `no photo or video in ${where}`);
		process.stderr.write(`three-tty: using ${found}\n`);
		if (mediaKind(found) === 'video') video = found;
		else image = found;
	}

	const key = apiKeyFromEnv();
	if (!key) fail(`making a model needs a free account. Create a key at ${KEYS_URL} and export THREE_WS_API_KEY.`);
	const origin = String(process.env.THREE_WS_BASE || DEFAULT_ORIGIN).replace(/\/$/, '');
	let imageUrls = [];
	if (video) {
		process.stderr.write(`three-tty: reading one frame of ${video}\n`);
		const frame = await grabVideoFrame(video);
		const url = await uploadImage({ bytes: frame, contentType: 'image/jpeg', origin, apiKey: key });
		imageUrls = [url];
	} else if (image) {
		const bytes = new Uint8Array(await readFile(image));
		const url = await uploadImage({ bytes, contentType: contentTypeFor(image), origin, apiKey: key });
		imageUrls = [url];
	}

	let last = '';
	const made = await forgeModel({
		prompt,
		imageUrls,
		origin,
		apiKey: key,
		onStatus(ev) {
			const line = ev.message ? `${ev.phase}: ${ev.message}` : ev.phase;
			if (line === last) return;
			last = line;
			process.stderr.write(`three-tty: ${line}\n`);
		},
	});
	process.stderr.write(`three-tty: ${made.glbUrl}\n`);
	return made.glbUrl;
}

const opts = parseArgs(process.argv.slice(2));
const wantsMake = opts.prompt !== undefined || opts.image !== undefined || opts.video !== undefined || Boolean(opts.find);
if (opts.help || (!opts._.length && !opts.scene && !wantsMake)) {
	process.stdout.write(USAGE);
	process.exit(opts.help ? 0 : 1);
}

let source = opts._[0];
const isTTY = Boolean(process.stdout.isTTY);
// Piping to a file or another program must produce ONE frame, not an infinite
// animation. Getting this wrong fills a disk, so the non-interactive default is
// a single frame and animation has to be asked for explicitly with --frames.
const once = Boolean(opts.once) || (!isTTY && opts.frames === undefined);

const cols = Math.max(20, Math.min(num(opts.width, process.stdout.columns || 80), 400));
const rows = Math.max(10, Math.min(num(opts.height, (process.stdout.rows || 26) - 2), 200));

const colorMode = opts.color ?? detectColorMode();
if (!Object.values(ColorMode).includes(colorMode)) fail(`unknown color mode: ${colorMode}`);
if (opts.scene && !isScene(opts.scene)) fail(`unknown scene: ${opts.scene}`);
const style = opts.style ? normalizeStyle(opts.style) : 'half';
if (opts.style && style === 'half' && String(opts.style).toLowerCase() !== 'half') fail(`unknown style: ${opts.style}`);

const camera = {};
if (opts.yaw !== undefined) camera.yaw = num(opts.yaw, 0);
if (opts.pitch !== undefined) camera.pitch = num(opts.pitch, 0.08);
if (opts.zoom !== undefined) camera.zoom = num(opts.zoom, 1);
if (opts.spin !== undefined) camera.spin = num(opts.spin, 0);

try {
	const made = await madeSource(opts);
	if (made) source = made;
} catch (err) {
	fail(err.message);
}
if (!opts.scene && !source) fail('pass a model, a scene, or something to make');

let renderer;
if (opts.scene) {
	try {
		renderer = await createScene(opts.scene, {
			width: cols,
			height: rows,
			mode: colorMode,
			style,
			transparent: Boolean(opts.transparent),
			text: opts.text,
			...camera,
		});
	} catch (err) {
		fail(`could not start ${opts.scene}: ${err.message}`);
	}
	if (opts.info) {
		process.stdout.write(JSON.stringify({ scene: renderer.name, label: renderer.label, detail: renderer.detail }, null, 2) + '\n');
		process.exit(0);
	}
} else {
	let model;
	try {
		model = await loadModel(source);
	} catch (err) {
		fail(`could not load ${source}: ${err.message}`);
	}
	if (opts.info) {
		process.stdout.write(JSON.stringify(describeModel(model), null, 2) + '\n');
		process.exit(0);
	}
	renderer = createRenderer(model, {
		width: cols,
		height: rows,
		animation: opts['no-anim'] ? false : (opts.clip ?? undefined),
		mode: colorMode,
		style,
		transparent: Boolean(opts.transparent),
		spin: num(opts.spin, 0.9),
		pitch: num(opts.pitch, 0.08),
		zoom: num(opts.zoom, 1),
		yaw: num(opts.yaw, 0),
	});
}

if (once) {
	process.stdout.write(renderer.frame(num(opts.time, 0)) + '\n');
	process.exit(0);
}

const fps = Math.max(1, Math.min(num(opts.fps, 24), 60));
const totalFrames = opts.frames !== undefined ? Math.max(1, num(opts.frames, 1)) : Infinity;

let paused = false;
let time = num(opts.time, 0);
let drawn = 0;
let timer = null;

function restore() {
	if (timer) clearInterval(timer);
	if (isTTY) process.stdout.write(ansi.showCursor + '\n');
	if (process.stdin.isTTY) process.stdin.setRawMode(false);
	process.stdin.pause();
}

function quit(code = 0) {
	restore();
	process.exit(code);
}

if (isTTY) {
	process.stdout.write(ansi.hideCursor);
	// Reserve the rows up front, then only ever move the cursor back up. A
	// full-screen clear each frame flickers on most terminals; overdrawing in
	// place does not, and it leaves the scrollback intact when the program ends.
	process.stdout.write('\n'.repeat(renderer.height));
}

if (process.stdin.isTTY) {
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (key) => {
		const o = renderer.orbit;
		if (key === 'q' || key === '') quit(0);
		else if (key === ' ') paused = !paused;
		else if (key === `${ESC}[C` || key === 'd') renderer.setOrbit({ yaw: o.yaw + 0.2 });
		else if (key === `${ESC}[D` || key === 'a') renderer.setOrbit({ yaw: o.yaw - 0.2 });
		else if (key === `${ESC}[A` || key === 'w') renderer.setOrbit({ pitch: o.pitch + 0.1 });
		else if (key === `${ESC}[B` || key === 's') renderer.setOrbit({ pitch: o.pitch - 0.1 });
		else if (key === '+' || key === '=') renderer.setOrbit({ zoom: o.zoom * 1.12 });
		else if (key === '-' || key === '_') renderer.setOrbit({ zoom: o.zoom / 1.12 });
	});
}

process.on('SIGINT', () => quit(0));
process.on('SIGTERM', () => quit(0));

timer = setInterval(() => {
	const text = renderer.frame(time);
	process.stdout.write((isTTY ? ansi.up(renderer.height) : '') + text + '\n');
	if (!paused) time += 1 / fps;
	drawn += 1;
	if (drawn >= totalFrames) quit(0);
}, Math.round(1000 / fps));
