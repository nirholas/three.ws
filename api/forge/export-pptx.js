// GET /api/forge/export-pptx?id=<creation id>
//
// A finished three.ws creation as a one-slide PowerPoint deck: the creation's
// prompt as the title and the model itself as an interactive 3D object you can
// rotate in PowerPoint (Microsoft 365, Windows, Mac and the web), with a poster
// picture for readers that do not render 3D. This is the file behind the
// "PowerPoint" item in the Forge export menu and on the model page, and the
// deck the PowerPoint add-in inserts (integrations/microsoft/office-addin).
//
// The GLB goes through the Office-safe pass first (api/_lib/office-glb.js):
// three.ws GLBs carry WebP textures and, on the delivery copy, meshopt
// compression, neither of which Office reads. The poster is rendered from the
// Office-safe model in its authored pose, falling back to the creation's
// thumbnail, then to a titled card, so a render outage never costs the user the deck.
//
// Same visibility contract as /api/forge-creation and the slicer handoff:
// public and unlisted creations are served, private ones are a 404. The deck
// for a creation is immutable, so it carries a long CDN lifetime and a strong
// ETag, and a small in-process cache absorbs repeat clicks.

import { createHash } from 'node:crypto';

import { cors, error, method, rateLimited, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { getPublicCreation } from '../_lib/forge-store.js';
import { fetchModel, FetchModelError } from '../_lib/fetch-model.js';
import { makeOfficeSafeGlb, OfficeGlbError } from '../_lib/office-glb.js';
import { buildPptx, PPTX_MIME } from '../_lib/pptx-writer.js';

const CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_ENTRIES = 6;
const CACHE_BYTES = 192 * 1024 * 1024;
const MAX_GLB_BYTES = 100 * 1024 * 1024;
const MAX_THUMB_BYTES = 8 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 45_000;
export const POSTER_WIDTH = 1280;
export const POSTER_HEIGHT = 960;
const SITE = 'https://three.ws';

const OFFICE_ERROR_STATUS = { invalid_model: 422, no_geometry: 422, texture_unreadable: 422 };

export function slug(text) {
	return (
		String(text || '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'three-ws-model'
	);
}

// Pipelines that store a machine label in the prompt column instead of
// words a person typed. A slide titled "auto-rig" helps nobody.
const PIPELINE_TITLES = {
	'auto-rig': 'Rigged 3D character',
	'image-to-3d': '3D model from an image',
};

/** A slide title from a prompt: one line, capitalized, cut at a word boundary. */
export function slideTitle(prompt) {
	const text = String(prompt || '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!text) return '3D model';
	if (PIPELINE_TITLES[text.toLowerCase()]) return PIPELINE_TITLES[text.toLowerCase()];
	const cut = text.length > 80 ? text.slice(0, 80).replace(/\s+\S*$/, '') + '...' : text;
	return cut.charAt(0).toUpperCase() + cut.slice(1);
}

async function loadSharp() {
	return (await import('sharp')).default;
}

function withTimeout(promise, ms, label) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

/** Fit any image onto a transparent POSTER_WIDTH x POSTER_HEIGHT PNG. */
async function letterbox(input) {
	const sharp = await loadSharp();
	const png = await sharp(input)
		.resize({
			width: POSTER_WIDTH,
			height: POSTER_HEIGHT,
			fit: 'contain',
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();
	return new Uint8Array(png);
}

function titleCardSvg(title) {
	const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const words = title.split(' ');
	const lines = [];
	for (const word of words) {
		const last = lines[lines.length - 1];
		if (last && (last + ' ' + word).length <= 28) lines[lines.length - 1] = last + ' ' + word;
		else lines.push(word);
	}
	const shown = lines.slice(0, 4);
	const top = POSTER_HEIGHT / 2 - (shown.length - 1) * 36;
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}">` +
		'<defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#2a2f45"/><stop offset="1" stop-color="#111318"/></radialGradient></defs>' +
		`<rect width="100%" height="100%" rx="32" fill="url(#g)"/>` +
		shown
			.map(
				(line, i) =>
					`<text x="50%" y="${top + i * 72}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="56" fill="#ffffff">${esc(line)}</text>`,
			)
			.join('') +
		`<text x="50%" y="${POSTER_HEIGHT - 64}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#9aa3c7">Interactive 3D model. Open in PowerPoint to rotate it.</text>` +
		'</svg>'
	);
}

/**
 * Render the Office-safe GLB itself, in-process on the CPU rasterizer, from
 * the camera PowerPoint opens with: straight down -Z, model as authored, no
 * ground. The slide is someone else's background, so the cut-out carries no
 * contact shadow. Rendering these bytes (not the stored URL) means no second
 * download, textures already capped for Office, and a poster that shows
 * exactly the model the slide holds.
 */
export async function renderPoster(glb) {
	const { AvatarModel, renderFrame, encodePng } = await import('@three-ws/render');
	const { FRAME_MARGIN } = await import('../_lib/render-cpu.js');
	const model = await AvatarModel.load(
		glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
	);
	const png = encodePng(
		renderFrame(model, {
			width: POSTER_WIDTH,
			height: POSTER_HEIGHT,
			supersample: 2,
			yaw: 0,
			pitch: 0,
			margin: FRAME_MARGIN,
			background: 'transparent',
			shadow: 0,
		}),
	);
	return new Uint8Array(png);
}

/**
 * The deck's poster: a render of the Office-safe model, else the creation's
 * stored thumbnail, else a titled card. Never throws.
 */
export async function makePoster(creation, title, glb) {
	try {
		const png = await withTimeout(renderPoster(glb), RENDER_TIMEOUT_MS, 'poster render');
		if (png?.length) return { png, source: 'render' };
	} catch (err) {
		console.warn(
			'[export-pptx] poster render failed, using the thumbnail:',
			err?.message || err,
		);
	}
	if (creation.preview_image_url) {
		try {
			const { bytes } = await fetchModel(creation.preview_image_url, {
				maxBytes: MAX_THUMB_BYTES,
				timeoutMs: 15_000,
			});
			return { png: await letterbox(bytes), source: 'thumbnail' };
		} catch (err) {
			console.warn(
				'[export-pptx] thumbnail unavailable, using a title card:',
				err?.message || err,
			);
		}
	}
	const sharp = await loadSharp();
	const png = await sharp(Buffer.from(titleCardSvg(title)))
		.png()
		.toBuffer();
	return { png: new Uint8Array(png), source: 'card' };
}

/** The production source: a finished public creation and its GLB bytes. */
export async function loadCreationForPptx(id) {
	const creation = await getPublicCreation({ id });
	if (!creation?.glb_url) return null;
	const { bytes } = await fetchModel(creation.glb_url, {
		maxBytes: MAX_GLB_BYTES,
		timeoutMs: 60_000,
	});
	return { creation, glb: bytes };
}

function readId(req) {
	const url = new URL(req.url, 'http://localhost');
	return String(req.query?.id ?? url.searchParams.get('id') ?? '')
		.trim()
		.toLowerCase();
}

/**
 * Build the handler. `loadSource(id)` resolves to `{ creation, glb }`
 * or null when no public creation has that id. Production uses
 * loadCreationForPptx; the test suite hands in a GLB it builds itself, because
 * the production fetcher refuses loopback hosts.
 */
export function createExportPptxHandler({ loadSource = loadCreationForPptx } = {}) {
	const cache = new Map();
	let cachedBytes = 0;

	function remember(key, entry) {
		cache.set(key, entry);
		cachedBytes += entry.body.length;
		while (cache.size > CACHE_ENTRIES || cachedBytes > CACHE_BYTES) {
			const [oldest, value] = cache.entries().next().value;
			cache.delete(oldest);
			cachedBytes -= value.body.length;
		}
	}

	async function build(id) {
		const source = await loadSource(id);
		if (!source) return null;
		const { creation, glb: input } = source;
		const title = slideTitle(creation.prompt);
		const { glb, bounds, report } = await makeOfficeSafeGlb(input);
		const poster = await makePoster(creation, title, glb);
		const by = creation.creator_username ? ` by @${creation.creator_username}` : '';
		const body = buildPptx({
			title,
			author: creation.creator_username || 'three.ws',
			slides: [
				{
					title,
					caption: `Made with three.ws${by}. Drag the model to rotate it. ${SITE}/m/${id}`,
					model: {
						glb,
						bounds,
						poster: { png: poster.png, width: POSTER_WIDTH, height: POSTER_HEIGHT },
						name: '3D Model',
						descr: String(creation.prompt || title).slice(0, 500),
					},
				},
			],
		});
		const digest = createHash('sha256').update(body).digest('hex').slice(0, 32);
		return {
			body: Buffer.from(body.buffer, body.byteOffset, body.byteLength),
			etag: `"pptx-${digest}"`,
			filename: `${slug(title)}.pptx`,
			poster: poster.source,
			warnings: report.warnings,
		};
	}

	return wrap(async (req, res) => {
		if (cors(req, res, { origins: '*', methods: 'GET,HEAD,OPTIONS', payments: false })) return;
		if (!method(req, res, ['GET'])) return; // HEAD is folded into GET and its body stripped

		const id = readId(req);
		if (!isUuid(id))
			return error(res, 400, 'validation_error', 'id must be a creation id (a UUID).');

		let entry = cache.get(id);
		if (!entry) {
			const rate = await limits.pptxExportIp(clientIp(req));
			if (!rate.success) return rateLimited(res, rate, 'too many PowerPoint exports');
			try {
				entry = await build(id);
			} catch (err) {
				if (err instanceof OfficeGlbError) {
					return error(res, OFFICE_ERROR_STATUS[err.code] ?? 422, err.code, err.message);
				}
				if (err instanceof FetchModelError) {
					if (err.code === 'file_too_large') {
						return error(
							res,
							413,
							'model_too_large',
							`This model is over ${MAX_GLB_BYTES / 1048576} MB, more than a slide can carry. Download the GLB and insert it in PowerPoint with Insert > 3D Models.`,
						);
					}
					return error(
						res,
						502,
						'model_unavailable',
						'The model file could not be downloaded right now. Try again in a minute.',
					);
				}
				throw err;
			}
			if (!entry)
				return error(
					res,
					404,
					'creation_not_found',
					'No finished public creation with that id.',
				);
			remember(id, entry);
		}

		res.setHeader('cache-control', CACHE_CONTROL);
		res.setHeader('etag', entry.etag);
		res.setHeader('x-pptx-poster', entry.poster);
		if (entry.warnings.length) res.setHeader('x-pptx-warnings', String(entry.warnings.length));
		res.setHeader(
			'access-control-expose-headers',
			'etag, content-disposition, x-pptx-poster, x-pptx-warnings',
		);
		const inm = req.headers['if-none-match'];
		if (inm && inm.split(',').some((tag) => tag.trim() === entry.etag)) {
			res.statusCode = 304;
			res.end();
			return;
		}
		res.statusCode = 200;
		res.setHeader('content-type', PPTX_MIME);
		res.setHeader('content-length', String(entry.body.length));
		res.setHeader('content-disposition', `attachment; filename="${entry.filename}"`);
		res.setHeader('x-content-type-options', 'nosniff');
		res.end(entry.body);
	});
}

export default createExportPptxHandler();
