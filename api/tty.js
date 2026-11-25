// GET /api/tty: stream a 3D agent into the caller's terminal.
//
//   curl three.ws/tty
//   curl three.ws/tty/<avatar-id>
//   curl 'three.ws/tty?src=https://example.com/model.glb&frames=120'
//
// The whole point is that it needs nothing installed. No GPU on this side, no
// WebGL on the caller's side, no client at all beyond curl: the server runs the
// software rasterizer from @three-ws/tty (packages/tty-3d) and writes ANSI
// frames down a chunked response, pacing them so the response IS the animation.
//
// Why a stream rather than a rendered file: a GIF would need an encoder, a
// content type the terminal cannot show, and a download step. Frames of text
// arrive progressively and start animating before the model has even finished
// sending, which is the difference between a demo and a trick.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createRenderer, createScene, isScene, loadModel, normalizeStyle } from '../packages/tty-3d/src/index.js';
import { ansi, ColorMode } from '../packages/tty-3d/src/term.js';
import { getAvatar } from './_lib/avatars.js';
import { error, rateLimited, redirect, wantsHtmlNavigation, wrap } from './_lib/http.js';
import { fetchModel } from './_lib/fetch-model.js';
import { clientIp, limits } from './_lib/rate-limit.js';
import { assertSafePublicUrl, SsrfBlockedError } from './_lib/ssrf-guard.js';

export const maxDuration = 60;

// The signature model, used when the caller names nothing. It is the one GLB
// every deploy is guaranteed to ship, so `curl three.ws/tty` can never 404.
//
// Read off disk, NOT fetched from our own origin. Self-fetching looked simpler
// and was wrong twice over: it has to guess its own scheme from headers (which
// fails outright behind a proxy that does not set x-forwarded-proto, and failed
// immediately in local testing against https://localhost), and it spends a
// network round trip to read a file that is already in the image.
const DEFAULT_MODEL_CANDIDATES = ['dist/avatars/default.glb', 'public/avatars/default.glb'];

export function defaultModelPath(cwd = process.cwd()) {
	for (const rel of DEFAULT_MODEL_CANDIDATES) {
		const full = join(cwd, rel);
		if (existsSync(full)) return full;
	}
	return null;
}

const MAX_MODEL_BYTES = 64 * 1024 * 1024;
const MAX_FRAMES = 600;
const MAX_SECONDS = 45;
const MIN_COLS = 20;
const MAX_COLS = 220;
const MIN_ROWS = 8;
const MAX_ROWS = 90;

const clampInt = (raw, min, max, fallback) => {
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, n));
};

const clampFloat = (raw, min, max, fallback) => {
	const n = Number.parseFloat(raw);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, n));
};

/**
 * Terminals do not announce themselves, so colour depth is inferred from what
 * curl passes through. A caller who knows better can always say `?color=`.
 */
export function colorModeFor(query, headers = {}) {
	const asked = String(query.color ?? '').toLowerCase();
	if (Object.values(ColorMode).includes(asked)) return asked;
	// curl forwards neither COLORTERM nor TERM, so the safe default over the
	// wire is 256 colour: universally supported by anything that renders escape
	// sequences at all, and visibly better than the ASCII ramp.
	if (String(headers['x-color'] ?? '').toLowerCase() === 'truecolor') return ColorMode.TRUECOLOR;
	return ColorMode.ANSI256;
}

/**
 * A path like /tty/walk arrives as avatar=walk. Those names are scenes, not
 * avatar ids (ids are UUIDs). An explicit src= still wins: the caller named a
 * model.
 */
export function sceneFromQuery(query) {
	if (query.src) return null;
	const name = String(query.scene || query.avatar || '').toLowerCase();
	return isScene(name) ? name : null;
}

/** Resolve what to draw: an explicit GLB URL, an avatar id, or the default. */
export async function resolveSource(query) {
	if (query.src) {
		// Caller-supplied URLs are fetched by this server, so they are an SSRF
		// vector like any other. Same guard the render endpoints use.
		const safe = await assertSafePublicUrl(String(query.src));
		return { url: safe.toString ? safe.toString() : String(query.src), label: 'model' };
	}
	const avatarId = query.avatar ? String(query.avatar) : '';
	if (avatarId) {
		const avatar = await getAvatar({ id: avatarId });
		if (!avatar) return null;
		// model_url is null for a private avatar, which is exactly the case that
		// must not render: this endpoint is unauthenticated.
		if (!avatar.model_url) return null;
		return { url: avatar.model_url, label: avatar.name || 'avatar' };
	}
	const local = defaultModelPath();
	if (!local) return null;
	return { url: local, label: 'default agent' };
}

// Remote models are fetched by the pinned, per-hop validated fetcher (redirects
// handled manually, every hop resolved and connection-pinned), never by loadModel's
// own redirect-following fetch. Applies to src and to a stored avatar model_url.
async function loadSource(url) {
	if (/^https?:\/\//i.test(url)) {
		const { bytes } = await fetchModel(url, { maxBytes: MAX_MODEL_BYTES });
		return loadModel(bytes);
	}
	return loadModel(url);
}

function bannerLine(label, right, cols) {
	const left = `three.ws  ${label}`;
	const gap = Math.max(1, cols - left.length - right.length);
	return `${left}${' '.repeat(gap)}${right}`;
}

function modelDetail(model) {
	const tris = Math.round(model.triangleCount).toLocaleString('en-US');
	return `${tris} tris${model.skinned ? '  rigged' : ''}`;
}

function readBodyText(req, limit = 256) {
	if (req.method !== 'POST' && req.method !== 'PUT') return Promise.resolve('');
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve(Buffer.concat(chunks).toString('utf8'));
		};
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size <= limit) chunks.push(Buffer.from(chunk));
			else finish();
		});
		req.on('end', finish);
		req.on('error', finish);
	});
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default wrap(async function handler(req, res) {
	const url = new URL(req.url, 'http://localhost');
	const query = Object.fromEntries(url.searchParams);

	const sceneName = sceneFromQuery(query);

	// An explicit scene= that is not one of the named pictures must not fall
	// through to the default agent. The caller asked for a scene and missed.
	// A browser still lands on the page, which ignores a name it does not know.
	if (!query.src && query.scene != null && String(query.scene) !== '' && !sceneName) {
		if (wantsHtmlNavigation(req) && !query.raw) return redirect(res, '/tty', 302);
		return error(res, 400, 'unknown_scene', 'unknown scene');
	}

	// A browser that lands here would see escape codes as literal mojibake, so
	// send it somewhere that explains the trick instead. A scene keeps its name
	// so the page can open the same picture.
	if (wantsHtmlNavigation(req) && !query.raw) {
		if (sceneName) {
			const target = new URLSearchParams({ scene: sceneName });
			if (query.text) target.set('text', String(query.text).slice(0, 42));
			if (query.style) target.set('style', normalizeStyle(query.style));
			return redirect(res, `/tty?${target}`, 302);
		}
		const to = query.avatar ? `/tty?avatar=${encodeURIComponent(String(query.avatar))}` : '/tty';
		return redirect(res, to, 302);
	}

	const rate = await limits.ttyIp(clientIp(req) || 'anon');
	if (!rate.success) {
		return rateLimited(res, rate, `Too many terminal renders. Limit: ${rate.limit} per 10m.`);
	}

	const cols = clampInt(query.w ?? query.cols, MIN_COLS, MAX_COLS, 76);
	const rows = clampInt(query.h ?? query.rows, MIN_ROWS, MAX_ROWS, 30);
	const fpsDefault = sceneName === 'shader' ? 8 : sceneName === 'splats' ? 12 : 18;
	const fps = clampInt(query.fps, 4, 30, fpsDefault);
	const frames = clampInt(query.frames, 1, Math.min(MAX_FRAMES, fps * MAX_SECONDS), fps * 8);
	const style = normalizeStyle(query.style);
	const camera = {
		yaw: query.yaw === undefined ? undefined : clampFloat(query.yaw, -6.3, 6.3, undefined),
		pitch: query.pitch === undefined ? undefined : clampFloat(query.pitch, -1.4, 1.4, undefined),
		zoom: query.zoom === undefined ? undefined : clampFloat(query.zoom, 0.3, 6, undefined),
		spin: query.spin === undefined ? undefined : clampFloat(query.spin, -4, 4, undefined),
	};

	if (sceneName) {
		let text = query.text ? String(query.text) : '';
		if (!text) text = await readBodyText(req);
		let scene;
		try {
			scene = await createScene(sceneName, {
				width: cols,
				height: rows,
				mode: colorModeFor(query, req.headers),
				style,
				text,
				...camera,
			});
		} catch (err) {
			if (/missing avatar/.test(err?.message || '')) return error(res, 404, 'not_found', 'no model to render');
			throw err;
		}
		return writeStream(req, res, {
			cols,
			rows,
			fps,
			frames,
			startTime: clampFloat(query.t ?? query.time, 0, 600, 0),
			label: scene.label,
			detail: scene.detail,
			render: (time) => scene.frame(time),
		});
	}

	let source;
	try {
		source = await resolveSource(query);
	} catch (err) {
		if (err instanceof SsrfBlockedError) return error(res, 400, 'blocked_url', 'that model URL is not reachable');
		throw err;
	}
	if (!source) return error(res, 404, 'not_found', 'no model to render');

	const spin = camera.spin ?? 0.9;

	let model;
	try {
		model = await loadSource(source.url);
	} catch (err) {
		// Upstream detail (status, resolver verdicts) stays out of the response:
		// it would turn this endpoint into an internal-network probe.
		return error(res, 502, 'model_unavailable', 'could not read that model');
	}

	const renderer = createRenderer(model, {
		width: cols,
		height: rows,
		mode: colorModeFor(query, req.headers),
		animation: query.clip ?? undefined,
		style,
		spin,
		yaw: camera.yaw ?? 0,
		pitch: camera.pitch ?? 0.08,
		zoom: camera.zoom ?? 1,
	});

	return writeStream(req, res, {
		cols,
		rows,
		fps,
		frames,
		startTime: clampFloat(query.t ?? query.time, 0, 600, 0),
		label: source.label,
		detail: modelDetail(model),
		render: (time) => renderer.frame(time),
	});
});

function writeStream(req, res, { cols, rows, fps, frames, startTime, label, detail, render }) {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/plain; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	// Nothing may buffer this: a proxy that waits for the body to finish turns a
	// live animation into a wall of text delivered at the end.
	res.setHeader('x-accel-buffering', 'no');
	res.setHeader('x-content-type-options', 'nosniff');
	if (typeof res.flushHeaders === 'function') res.flushHeaders();

	const single = frames === 1;
	// A client that hangs up mid-animation (Ctrl-C on curl) must stop the render
	// loop, not keep rasterizing frames into a dead socket for another 40s.
	let aborted = false;
	const stop = () => { aborted = true; };
	req.on('aborted', stop);
	res.on('close', stop);

	if (!single) res.write(ansi.hideCursor + '\n'.repeat(rows + 1));

	const pump = async () => {
		try {
			for (let i = 0; i < frames && !aborted; i += 1) {
				const time = startTime + i / fps;
				const frame = render(time);
				const head = single ? '' : ansi.up(rows + 1);
				res.write(`${head}${frame}\n${bannerLine(label, detail, cols)}\n`);
				if (single) break;
				await sleep(Math.round(1000 / fps));
			}
		} finally {
			if (!aborted) {
				if (!single) res.write(ansi.showCursor);
				res.end();
			}
		}
	};
	return pump();
}
