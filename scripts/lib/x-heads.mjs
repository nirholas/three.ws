// Builds the head an item declares (api/_lib/x-content/formats.js) from its
// proof reel: a black card around a frame of the reel, a looping GIF cut from
// the reel's busiest stretch, or AI key art grounded on a frame of the reel.
//
// Every head records the sha256 of the reel it was cut from (`derived.reel`),
// and the queue refuses a head whose reel has since been re-filmed, so a post
// can never lead with a picture of a product state that no longer passes.
//
// Authoring only: ffmpeg, a browser, and an image model. Production ships the
// files this writes and never renders anything.

import { execFile, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

import { FORMATS, ffmpegPath, loadProof } from '../../api/_lib/x-content/reel.js';
import { GIF_LIMITS, MEDIA_TYPES, gifInfo, parseFfmpegProbe } from '../../api/_lib/x-content/media.js';
import { GIF_MIN_WIDTH } from '../../api/_lib/x-content/editorial.js';
import { HEAD_LIMITS, reelPostIndex } from '../../api/_lib/x-content/formats.js';
import { encodeCard, renderCard } from './x-card.mjs';

const execFileAsync = promisify(execFile);
const MB = 1024 * 1024;

export const headDir = (id) => `public/x-media/${id}`;

// ── Reel geometry ───────────────────────────────────────────────────────────

function probeReel(root, path) {
	const probe = parseFfmpegProbe(spawnSync(ffmpegPath(root), ['-hide_banner', '-i', resolve(root, path)], { encoding: 'utf8' }).stderr || '');
	if (!probe) throw new Error(`could not read the reel ${path}`);
	return probe;
}

// Height in output pixels of the caption bar under the page, so a still can
// show the product alone.
function barPixels(item, probe) {
	const format = FORMATS[item.scenario?.format || 'landscape'] || FORMATS.landscape;
	return Math.round((format.bar / format.height) * probe.height);
}

// Where the reel was filmed, as a reader would type it.
export function pageLabel(item) {
	try {
		const url = new URL(item.scenario.steps[0].goto);
		return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
	} catch {
		return 'three.ws';
	}
}

// One frame of the reel at `atSec`, as PNG bytes. `cropBottom` pixels of
// caption bar are dropped.
export function reelFrame({ root, path, atSec, cropBottom = 0 }) {
	const dir = mkdtempSync(join(tmpdir(), 'x-head-frame-'));
	try {
		const out = join(dir, 'frame.png');
		const filters = cropBottom > 0 ? ['-vf', `crop=iw:ih-${cropBottom}:0:0`] : [];
		const cut = spawnSync(ffmpegPath(root), ['-y', '-hide_banner', '-loglevel', 'error', '-ss', atSec.toFixed(2), '-i', resolve(root, path), '-frames:v', '1', ...filters, out], { encoding: 'utf8' });
		if (cut.status !== 0) throw new Error(`ffmpeg could not cut a frame at ${atSec} s: ${String(cut.stderr).trim().split('\n').pop()}`);
		return readFileSync(out);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Per-sample motion across the reel: the mean absolute change between
// consecutive 96px grey thumbnails, sampled `rate` times a second.
export function motionProfile({ root, path, rate = 6 }) {
	const size = 96;
	const run = spawnSync(
		ffmpegPath(root),
		['-hide_banner', '-loglevel', 'error', '-i', resolve(root, path), '-vf', `fps=${rate},scale=${size}:${size},format=gray`, '-f', 'rawvideo', '-'],
		{ maxBuffer: 256 * MB },
	);
	if (run.status !== 0) throw new Error(`ffmpeg could not sample the reel: ${String(run.stderr).trim().split('\n').pop()}`);
	const frame = size * size;
	const frames = Math.floor(run.stdout.length / frame);
	const motion = [0];
	for (let index = 1; index < frames; index++) {
		let total = 0;
		const a = (index - 1) * frame;
		const b = index * frame;
		for (let pixel = 0; pixel < frame; pixel++) total += Math.abs(run.stdout[a + pixel] - run.stdout[b + pixel]);
		motion.push(total / frame);
	}
	return { rate, motion };
}

// The busiest `seconds`-long stretch of the reel, skipping the page load.
export function busiestWindow({ motion, rate }, { seconds, durationSec, skipSec = 1 }) {
	const span = Math.max(1, Math.round(seconds * rate));
	const first = Math.min(Math.round(skipSec * rate), Math.max(0, motion.length - span));
	let best = { start: first, total: -1 };
	let total = 0;
	for (let index = first; index < motion.length; index++) {
		total += motion[index];
		if (index - first >= span) total -= motion[index - span];
		if (index - first >= span - 1 && total > best.total) best = { start: index - span + 1, total };
	}
	const from = Math.max(0, Math.min(best.start / rate, durationSec - seconds));
	return { from: round1(from), to: round1(Math.min(durationSec, from + seconds)) };
}

// The calmest `seconds`-long stretch in the back half of the reel: where a run
// holds on its result, after the confetti, toasts and camera moves of getting
// there have settled. Ties go to the later stretch, closer to the payoff.
export function settledWindow({ motion, rate }, { seconds = 1, durationSec, fromShare = 0.45, tailSec = 0.4 }) {
	const span = Math.max(1, Math.round(seconds * rate));
	const first = Math.round(durationSec * fromShare * rate);
	const last = Math.min(motion.length, Math.floor((durationSec - tailSec) * rate)) - span;
	if (last < first) return null;
	let best = null;
	for (let start = first; start <= last; start++) {
		let total = 0;
		for (let index = start; index < start + span; index++) total += motion[index];
		if (!best || total <= best.total) best = { start, total };
	}
	return { from: round1(best.start / rate), to: round1((best.start + span) / rate) };
}

// The still a card shows: the middle of the reel's settled result, unless that
// frame is far plainer than the rest of the run (a result that faded out), in
// which case the most detailed of the later frames.
async function bestStill({ root, path, probe, cropBottom }) {
	const window = settledWindow(motionProfile({ root, path }), { durationSec: probe.durationSec });
	const settledAt = window ? round1((window.from + window.to) / 2) : null;
	const candidates = [0.5, 0.62, 0.74, 0.86].map((share) => round1(probe.durationSec * share));
	let detailed = null;
	let settled = null;
	for (const atSec of [settledAt, ...candidates].filter((at) => at !== null)) {
		const buffer = reelFrame({ root, path, atSec, cropBottom });
		const { entropy } = await sharp(buffer).stats();
		const frame = { atSec, buffer, entropy };
		if (atSec === settledAt && !settled) settled = frame;
		if (!detailed || entropy > detailed.entropy) detailed = frame;
	}
	return settled && settled.entropy >= detailed.entropy * 0.85 ? settled : detailed;
}

const round1 = (value) => Math.round(value * 10) / 10;

// Captions on screen between `from` and `to`, in the order a viewer reads them.
// A caption stays up until a later step replaces it (`""` clears it), and one
// that is on screen for less than half a second of the window is not counted.
export function captionsBetween(item, proof, { from, to, fps, minSeconds = 0.5 }) {
	const seen = new Map();
	let current = '';
	let frame = 0;
	(proof.steps || []).forEach((step, index) => {
		const caption = item.scenario?.steps?.[index]?.caption;
		if (caption !== undefined) current = caption;
		const start = frame / fps;
		frame += Number(step.frames) || 0;
		const overlap = Math.min(frame / fps, to) - Math.max(start, from);
		if (current && overlap > 0) seen.set(current, (seen.get(current) || 0) + overlap);
	});
	return [...seen].filter(([, seconds]) => seconds >= minSeconds).map(([caption]) => caption);
}

function derived(head, proof, extra = {}) {
	return { as: head.as, reel: proof.video.sha256, ...extra };
}

// ── Card ────────────────────────────────────────────────────────────────────

async function buildCard(item, { root, proof, probe }) {
	const head = item.head;
	const cropBottom = barPixels(item, probe);
	const still = head.at !== undefined
		? { atSec: Number(head.at), buffer: reelFrame({ root, path: proof.video.path, atSec: Number(head.at), cropBottom }) }
		: await bestStill({ root, path: proof.video.path, probe, cropBottom });
	const meta = await sharp(still.buffer).metadata();
	const label = pageLabel(item);
	const frame = meta.width / meta.height > 1.25 ? 'browser' : 'panel';
	const png = await renderCard({ headline: head.headline, body: head.body, frame, label, foot: head.foot }, { root, shot: still.buffer });
	const { buffer, ext } = await encodeCard(png);
	const path = `${headDir(item.id)}/card${ext}`;
	writeHead(root, path, buffer);
	const alt = head.alt || `three.ws card on a black background with the headline "${oneLine(head.headline)}"${/[.!?]$/.test(oneLine(head.headline)) ? '' : '.'}${head.body ? ` ${sentence(head.body)}` : ''} Beside it, a frame of ${label} from the reel filmed live on the product.`;
	return { path, alt, derived: derived(head, proof, { at: still.atSec }) };
}

// ── GIF ─────────────────────────────────────────────────────────────────────

// Tried in order until the GIF fits under the size ceiling. Every rung stays at
// or above the width a clip reads at on X (editorial.js GIF_MIN_WIDTH).
const GIF_LADDER = [
	{ width: 800, fps: 15 },
	{ width: 720, fps: 15 },
	{ width: 720, fps: 12 },
	{ width: 640, fps: 12 },
	{ width: GIF_MIN_WIDTH, fps: 10 },
];
// Under X's 15 MB with room for a slow phone connection to start it promptly.
export const GIF_TARGET_BYTES = 12 * MB;

function encodeGif({ root, path, from, to, width, fps, out }) {
	const filters = `fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
	const run = spawnSync(
		ffmpegPath(root),
		['-y', '-hide_banner', '-loglevel', 'error', '-ss', from.toFixed(2), '-t', (to - from).toFixed(2), '-i', resolve(root, path), '-filter_complex', filters, '-loop', '0', out],
		{ encoding: 'utf8' },
	);
	if (run.status !== 0) throw new Error(`ffmpeg could not encode the GIF: ${String(run.stderr).trim().split('\n').pop()}`);
	return statSync(out).size;
}

async function buildGif(item, { root, proof, probe }) {
	const head = item.head;
	const [, maxSeconds] = HEAD_LIMITS.gifSeconds;
	const window = head.from !== undefined
		? { from: Number(head.from), to: Number(head.to) }
		: busiestWindow(motionProfile({ root, path: proof.video.path }), { seconds: Math.min(6, maxSeconds, probe.durationSec), durationSec: probe.durationSec });
	const path = `${headDir(item.id)}/loop.gif`;
	const out = resolve(root, path);
	mkdirSync(dirname(out), { recursive: true });
	const ladder = head.width ? [{ width: head.width, fps: 15 }, ...GIF_LADDER.filter((rung) => rung.width < head.width)] : GIF_LADDER;
	let fitted = null;
	for (const rung of ladder) {
		const width = Math.min(rung.width, probe.width, GIF_LIMITS.maxWidth);
		const bytes = encodeGif({ root, path: proof.video.path, from: window.from, to: window.to, width, fps: rung.fps, out });
		const info = gifInfo(readFileSync(out));
		const withinX = info && info.height <= GIF_LIMITS.maxHeight && info.frames <= GIF_LIMITS.maxFrames && info.width * info.height * info.frames <= GIF_LIMITS.maxPixels;
		if (bytes <= GIF_TARGET_BYTES && withinX) {
			fitted = { ...rung, width, bytes, frames: info.frames };
			break;
		}
	}
	if (!fitted) throw new Error(`${path}: no rung of the GIF ladder fit under ${GIF_TARGET_BYTES / MB} MB; set head.from and head.to to a shorter stretch`);
	const captions = captionsBetween(item, proof, { ...window, fps: proof.video.fps || 30 });
	const alt = head.alt || `Looping clip filmed live on ${pageLabel(item)}${captions.length ? `. On screen: ${captions.map(oneLine).join(' / ')}` : ''}.`;
	return { path, alt, derived: derived(head, proof, { from: window.from, to: window.to, width: fitted.width, fps: fitted.fps }) };
}

// ── AI key art ──────────────────────────────────────────────────────────────

// The art is the image model's; the type, the lockup, and the product frame are
// ours. The model is asked never to draw text, so nothing it invents can read as
// a claim, and the real frame stays visible beside or inside it.
const ART_STYLE = 'Cinematic key art for a technology launch. Deep pure black background, soft blue and violet rim light, faint volumetric haze, glossy reflective black floor, high detail, shallow depth of field. Leave the left third dark and empty for a headline. No text, no letters, no logos, no watermark, no user interface.';

const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'aerial-vehicle-466722-p5';
// Best first. Gemini 3 Pro Image is served only from the global endpoint.
export const ART_MODELS = [
	{ lane: 'vertex', model: 'gemini-3-pro-image-preview', location: 'global' },
	{ lane: 'vertex', model: 'gemini-2.5-flash-image', location: 'us-central1' },
	{ lane: 'nim', model: 'black-forest-labs/flux.1-dev' },
];

async function gcloudToken() {
	const { stdout } = await execFileAsync('gcloud', ['auth', 'print-access-token']);
	return stdout.trim();
}

async function vertexArt({ model, location }, prompt, source) {
	const host = location === 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`;
	const endpoint = `${host}/v1/projects/${VERTEX_PROJECT}/locations/${location}/publishers/google/models/${model}:generateContent`;
	const body = {
		contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: source.toString('base64') } }] }],
		generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } },
	};
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: { authorization: `Bearer ${await gcloudToken()}`, 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(180_000),
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) throw new Error(`vertex ${model} ${response.status}: ${String(data?.error?.message || '').slice(0, 160)}`);
	const part = (data?.candidates?.[0]?.content?.parts || []).find((row) => row?.inlineData?.data);
	if (!part) throw new Error(`vertex ${model} returned no image (${data?.candidates?.[0]?.finishReason || 'no candidate'})`);
	return Buffer.from(part.inlineData.data, 'base64');
}

// FLUX.1-dev on NVIDIA NIM, the platform's free image lane. It cannot take an
// image, so its art is a backdrop and the real frame is inset on the card. Its
// content filter answers some harmless prompts with a black frame, so a few
// seeds are tried before the lane gives up.
async function nimArt(prompt) {
	const key = process.env.NVIDIA_API_KEY;
	if (!key) throw new Error('nim flux: NVIDIA_API_KEY is not set');
	let last = 'no attempt';
	for (const seed of [3, 11, 29, 47]) {
		const response = await fetch('https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-dev', {
			method: 'POST',
			headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'content-type': 'application/json' },
			body: JSON.stringify({ prompt, mode: 'base', width: 1344, height: 768, seed, steps: 40, cfg_scale: 3.5 }),
			signal: AbortSignal.timeout(120_000),
		});
		const data = await response.json().catch(() => ({}));
		const artifact = data?.artifacts?.[0];
		if (response.ok && artifact?.finishReason === 'SUCCESS' && artifact.base64) return Buffer.from(artifact.base64, 'base64');
		last = response.ok ? `withheld (${artifact?.finishReason || 'empty'})` : `${response.status}`;
	}
	throw new Error(`nim flux: ${last} on every seed`);
}

// Draws the key art. Returns { buffer, model, grounded, failures }.
export async function drawArt(prompt, source, { models = ART_MODELS, log = () => {} } = {}) {
	const failures = [];
	for (const choice of models) {
		try {
			if (choice.lane === 'vertex') {
				const buffer = await vertexArt(choice, `Turn this real product screenshot into ${ART_STYLE} Keep the subject of the screenshot recognisable and central. ${prompt}`, source);
				return { buffer, model: `vertex-ai/${choice.model}`, grounded: true, failures };
			}
			const buffer = await nimArt(`${prompt}. ${ART_STYLE}`);
			return { buffer, model: `nvidia-nim/${choice.model}`, grounded: false, failures };
		} catch (err) {
			failures.push(`${choice.model}: ${err.message}`);
			log(`  art lane ${choice.model} failed: ${err.message}`);
		}
	}
	throw new Error(`no image model drew the key art: ${failures.join('; ')}`);
}

async function buildArt(item, { root, proof, probe, log }) {
	const head = item.head;
	const cropBottom = barPixels(item, probe);
	const still = head.at !== undefined
		? { atSec: Number(head.at), buffer: reelFrame({ root, path: proof.video.path, atSec: Number(head.at), cropBottom }) }
		: await bestStill({ root, path: proof.video.path, probe, cropBottom });
	const art = await drawArt(head.prompt, still.buffer, { log });
	const label = pageLabel(item);
	const png = await renderCard(
		{
			headline: head.headline,
			body: head.body,
			frame: 'art',
			credit: 'AI-generated key art',
			// Art the model drew without seeing the product carries the real frame.
			insetUri: art.grounded ? null : `data:image/jpeg;base64,${(await sharp(still.buffer).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()).toString('base64')}`,
			insetLabel: `Filmed live on ${label}`,
		},
		{ root, shot: art.buffer },
	);
	const { buffer, ext } = await encodeCard(png);
	const path = `${headDir(item.id)}/art${ext}`;
	writeHead(root, path, buffer);
	const alt = head.alt
		? ensureGeneratedLabel(head.alt)
		: `AI-generated key art ${art.grounded ? `made from a frame of ${label}` : `with a frame of ${label} filmed live in the corner`}, under the headline "${oneLine(head.headline)}".`;
	return {
		path,
		alt,
		derived: derived(head, proof, { at: still.atSec }),
		generated: { model: art.model, prompt: head.prompt, source: art.grounded ? `${proof.video.path}@${still.atSec}s` : null },
	};
}

// Card body as one sentence of alt text, ending in exactly one stop.
const sentence = (text) => {
	const line = oneLine(text);
	return /[.!?]$/.test(line) ? line : `${line}.`;
};

const ensureGeneratedLabel = (alt) => (/\bAI[- ]generated\b/i.test(alt) ? alt : `AI-generated: ${alt}`);
const oneLine = (text) => String(text || '').replace(/\s*\n\s*/g, ' ').trim();

function writeHead(root, path, buffer) {
	const out = resolve(root, path);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, buffer);
	const limit = MEDIA_TYPES[path.slice(path.lastIndexOf('.'))].maxBytes;
	if (buffer.length > limit) throw new Error(`${path} is ${(buffer.length / MB).toFixed(1)} MB, over X's ${limit / MB} MB limit`);
}

// ── Placement ───────────────────────────────────────────────────────────────

const BUILDERS = { card: buildCard, gif: buildGif, art: buildArt };

// Puts the reel where the head says it goes and builds the head in front of
// it. `reel` is the media entry proveItem returned. Mutates the item.
export async function placeHead(item, reel, { root, log = () => {} } = {}) {
	const head = item.head;
	const reelIndex = reelPostIndex(item);
	if (!head || head.as === 'reel' || reelIndex === 0) {
		item.posts[0].media = [reel];
		return { head: null };
	}
	if (!item.posts[reelIndex]) throw new Error(`head.as ${head.as} moves the reel to post ${reelIndex + 1}, which the item does not have; add a reply to carry it`);
	// The reply carries the reel alone: X allows a video no company on its post.
	item.posts[reelIndex].media = [reel];
	const proof = loadProof(root, item.id);
	if (!proof?.video?.sha256) throw new Error('no filmed proof on record to build the head from');
	const probe = probeReel(root, proof.video.path);
	const media = await BUILDERS[head.as](item, { root, proof, probe, log });
	item.posts[0].media = [media];
	return { head: media };
}

// Rebuilds the head of an item that is already filmed, without filming again.
export async function rebuildHead(item, { root, log = () => {} } = {}) {
	const proof = loadProof(root, item.id);
	if (!proof?.video?.path) throw new Error(`${item.id} has no filmed proof; run \`npm run x:content -- prove ${item.id}\` first`);
	const reel = (item.posts || []).flatMap((post) => post.media || []).find((media) => media.path === proof.video.path);
	if (!reel) throw new Error(`no post of ${item.id} carries its reel ${proof.video.path}; film it again`);
	// Every other post that carried the reel gives it up first.
	for (const post of item.posts) post.media = (post.media || []).filter((media) => media.path !== proof.video.path);
	for (const post of item.posts) if (!post.media.length) delete post.media;
	return placeHead(item, reel, { root, log });
}
