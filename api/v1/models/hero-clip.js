// /api/v1/models/hero-clip: a Grok Imagine Video hero clip of a 3D model,
// made from real renders of that model (docs/hero-clips.md).
//
//   GET                  what the feature offers right now: presets, durations,
//                        the daily cap, and whether clips are available at all.
//   POST {model_id|glb_url, preset, duration, tier?}
//                        signed-in only. Renders the model (one wide front frame,
//                        plus six reference angles on the full tier), starts the
//                        xAI job, and answers 202 with a signed job handle.
//   GET  ?job=<handle>   the job's status; once xAI finishes, the clip is copied
//                        into our storage and the answer carries its URL and the
//                        public clip page.
//   GET  ?fallback=1&model_id=|glb_url=
//                        the turntable and angle render URLs for a model, with
//                        no render or xAI call: what a page shows instead of a
//                        clip when the service has no key.
//
// Success answers use the v1 envelope ({ data }); failures carry
// { error, error_description, message, retry } plus, where useful, a fallback.
//
// Without a GROK_API_KEY the POST answers 503 clips_unavailable with the
// honest fallback: the repo's own turntable encoder and the per-angle render
// URLs for the same model. Nothing pretends to be a clip.
//
// The job is the forge pattern (submit, signed handle, poll) without a table:
// xAI holds the job until it is done and our object store holds the clip after,
// so the handle only has to carry who owns it and what was asked.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { json, rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { isUuid } from '../../_lib/validate.js';
import { assertSafePublicUrl } from '../../_lib/ssrf-guard.js';
import { headObject, cdnUrl } from '../../_lib/r2.js';
import { SIGN_IN_REQUIRED, SIGN_IN_URL, API_KEYS_URL } from '../../_lib/creator-account.js';
import {
	getPublicCreation,
	isCreationOwner,
	hashClient,
	ownerClientKey,
} from '../../_lib/forge-store.js';
import { getAvatar, resolveAvatarUrl } from '../../_lib/avatars.js';
import { renderableGlb } from '../../_lib/creation-jsonld.js';
import {
	renderFirstFrame,
	renderTurntableRefs,
	pngDataUri,
	refRenderUrl,
	planAngles,
	FIRST_FRAME_WIDTH,
	FIRST_FRAME_HEIGHT,
	FIRST_FRAME_ANGLE,
	REF_BACKGROUND,
} from '../../_lib/glb-turntable-refs.js';
import {
	XaiVideoError,
	xaiVideoConfigured,
	videoModel,
	buildVideoRequest,
	createVideoJob,
	getVideoJob,
	storeVideo,
	clipKey,
} from '../../_lib/xai-video.js';
import {
	publicPresets,
	heroClipPreset,
	presetPrompt,
	HERO_CLIP_DURATIONS,
	DEFAULT_DURATION,
	DEFAULT_PRESET,
	heroClipDailyCap,
	encodeHeroClipJob,
	decodeHeroClipJob,
	heroClipFailure,
	clipPagePath,
	clipShareText,
	JOB_TIMEOUT_MS,
} from '../../_lib/hero-clip.js';

const ENDPOINT_PATH = '/api/v1/models/hero-clip';
const TITLE_MAX = 120;
const SOURCE_PAGE_RE = /^\/(?:m|avatars)\/[A-Za-z0-9_-]{1,80}$/;

function origin() {
	return env.APP_ORIGIN || 'https://three.ws';
}

function absolute(path) {
	return path.startsWith('http') ? path : `${origin()}${path}`;
}

function header(req, name) {
	const raw = req.headers[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return typeof value === 'string' && value ? value : null;
}

function signInRequired(res) {
	const text = 'Sign in to make a hero clip. A three.ws account is free.';
	res.setHeader('www-authenticate', 'Bearer realm="three.ws", error="invalid_token"');
	return json(res, 401, {
		error: SIGN_IN_REQUIRED,
		error_description: text,
		message: text,
		sign_in_url: SIGN_IN_URL,
		api_keys_url: API_KEYS_URL,
	});
}

function failWith(res, code, extra = {}) {
	const f = heroClipFailure(code);
	return json(res, f.status, {
		error: f.error,
		error_description: f.message,
		message: f.message,
		retry: f.retry,
		...extra,
	});
}

function cleanTitle(raw, fallback) {
	const t = String(raw ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, TITLE_MAX)
		.trim();
	return t || fallback;
}

function titleFromUrl(url) {
	try {
		const last = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
		return (
			last
				.replace(/\.(glb|gltf)$/i, '')
				.replace(/[-_]+/g, ' ')
				.trim() || 'Untitled model'
		);
	} catch {
		return 'Untitled model';
	}
}

// ── source resolution ──────────────────────────────────────────────────────

// A forge creation or avatar the caller owns (private included), or one that
// is already public. Anything else is "not found", never "forbidden", so the
// endpoint cannot be used to probe which private ids exist.
async function resolveModelId(req, id, userId) {
	const clientHeader = header(req, 'x-forge-client');
	const clientKey = clientHeader ? ownerClientKey(hashClient(clientHeader)) : null;
	const owner = await isCreationOwner({ id, clientKey, userId });
	const creation = await getPublicCreation({ id, includePrivate: owner });
	if (creation) {
		const glbUrl = renderableGlb([
			{ url: creation.web_glb_url, sizeBytes: creation.web_size_bytes },
			{ url: creation.glb_url, sizeBytes: creation.size_bytes },
		]);
		if (glbUrl) {
			return {
				kind: 'creation',
				id,
				title: cleanTitle(creation.prompt, 'Untitled model'),
				glbUrl,
				page: creation.visibility === 'private' ? null : `/m/${id}`,
			};
		}
	}
	const avatar = await getAvatar({ id, requesterId: userId });
	if (avatar) {
		// The renderer fetches the GLB server-side and the fallback strip loads
		// render URLs in the owner's browser, so a private avatar gets a signed
		// URL that outlives a slow session.
		const { url } = await resolveAvatarUrl(avatar, { expiresIn: 3600 });
		return {
			kind: 'avatar',
			id,
			title: cleanTitle(avatar.name, 'Untitled avatar'),
			glbUrl: url,
			page: avatar.visibility === 'private' ? null : `/avatars/${id}`,
		};
	}
	return null;
}

async function resolveSource(req, body, userId) {
	const modelId = typeof body?.model_id === 'string' ? body.model_id.trim() : '';
	const glbUrl = typeof body?.glb_url === 'string' ? body.glb_url.trim() : '';
	if (modelId && glbUrl) fail(400, 'validation_error', 'Send "model_id" or "glb_url", not both.');
	if (modelId) {
		if (!isUuid(modelId))
			fail(400, 'validation_error', '"model_id" must be a model id (a UUID).');
		const source = await resolveModelId(req, modelId, userId);
		if (!source) {
			fail(
				404,
				'not_found',
				'No model with that id is yours or public. Send a public "glb_url" instead.',
			);
		}
		return source;
	}
	if (glbUrl) {
		if (!/^https:\/\//i.test(glbUrl))
			fail(400, 'validation_error', '"glb_url" must be a public https URL.');
		try {
			await assertSafePublicUrl(glbUrl);
		} catch (err) {
			fail(400, 'invalid_src', err?.message || '"glb_url" is not a public address.');
		}
		const page =
			typeof body?.source_page === 'string' && SOURCE_PAGE_RE.test(body.source_page)
				? body.source_page
				: null;
		return {
			kind: 'url',
			id: null,
			title: cleanTitle(body?.title, titleFromUrl(glbUrl)),
			glbUrl,
			page,
		};
	}
	fail(
		400,
		'validation_error',
		'Send "model_id" (a model you own or a public one) or "glb_url" (a public .glb).',
	);
}

function parseOptions(body) {
	const preset =
		body?.preset == null || body.preset === '' ? DEFAULT_PRESET : String(body.preset);
	if (!heroClipPreset(preset)) {
		fail(
			400,
			'validation_error',
			`"preset" must be one of: ${publicPresets()
				.map((p) => p.id)
				.join(', ')}.`,
		);
	}
	const duration =
		body?.duration == null || body.duration === '' ? DEFAULT_DURATION : Number(body.duration);
	if (!HERO_CLIP_DURATIONS.includes(duration)) {
		fail(
			400,
			'validation_error',
			`"duration" must be one of ${HERO_CLIP_DURATIONS.join(', ')} seconds.`,
		);
	}
	const tier = body?.tier == null || body.tier === '' ? 'lite' : String(body.tier);
	if (tier !== 'lite' && tier !== 'full')
		fail(400, 'validation_error', '"tier" must be "lite" or "full".');
	return { preset, duration, tier };
}

// ── fallback ───────────────────────────────────────────────────────────────

// Real renders of the caller's model through the repo's own encoders: the
// APNG turntable (/api/render/animate) and one still per reference angle.
export function fallbackFor(source) {
	const q = new URLSearchParams({
		src: source.glbUrl,
		spin: '360',
		frames: '36',
		fps: '12',
		size: '480',
		bg: REF_BACKGROUND,
	});
	return {
		turntable_url: `/api/render/animate?${q}`,
		refs: planAngles().map(({ azimuth, elevation }) => ({
			azimuth,
			elevation,
			url: refRenderUrl({ glbUrl: source.glbUrl, azimuth, elevation, size: 384 }),
		})),
	};
}

function publicSource(source) {
	return { kind: source.kind, id: source.id, title: source.title, page: source.page };
}

// ── handlers ───────────────────────────────────────────────────────────────

function describe(principal) {
	return {
		available: xaiVideoConfigured(),
		signed_in: Boolean(principal?.userId),
		presets: publicPresets(),
		default_preset: DEFAULT_PRESET,
		durations: HERO_CLIP_DURATIONS,
		default_duration: DEFAULT_DURATION,
		tiers: ['lite', 'full'],
		default_tier: 'lite',
		daily_cap: heroClipDailyCap(),
	};
}

// The turntable and angle renders on their own, for a page that already knows
// clips are off: the same model resolution as a create (private models only
// for their owner), and no render or xAI call happens here.
async function fallback({ req, query, principal }) {
	const pick = (name) => (typeof query?.[name] === 'string' ? query[name] : undefined);
	const source = await resolveSource(
		req,
		{
			model_id: pick('model_id'),
			glb_url: pick('glb_url'),
			title: pick('title'),
			source_page: pick('source_page'),
		},
		principal?.userId || null,
	);
	return {
		available: xaiVideoConfigured(),
		source: publicSource(source),
		fallback: fallbackFor(source),
	};
}

async function create({ req, res, body, principal }) {
	if (!principal?.userId) return signInRequired(res);
	const userId = principal.userId;
	const options = parseOptions(body);
	const source = await resolveSource(req, body, userId);

	if (!xaiVideoConfigured()) {
		return failWith(res, 'not_configured', {
			available: false,
			source: publicSource(source),
			fallback: fallbackFor(source),
		});
	}

	// Rendering is our CPU, so the burst limit runs before it; the daily cap
	// is consumed only once the renders exist and the paid call is next.
	const burst = await limits.heroClipBurst(`user:${userId}`);
	if (!burst.success)
		return rateLimited(
			res,
			burst,
			'Too many hero clips started at once. Wait a moment and try again.',
		);

	let frame;
	let refs = [];
	let msPerAngle;
	try {
		frame = await renderFirstFrame({ glbUrl: source.glbUrl });
		msPerAngle = frame.ms;
		if (options.tier === 'full') {
			const out = await renderTurntableRefs({ glbUrl: source.glbUrl });
			refs = out.refs;
			msPerAngle = Math.round((frame.ms + out.totalMs) / (refs.length + 1));
		}
	} catch (err) {
		console.warn('[hero-clip] render failed:', err?.message);
		return json(res, 422, {
			error: 'render_failed',
			error_description:
				'We could not render this model, so there is nothing to make a clip from. Check that the GLB opens in the viewer, then try again.',
			message:
				'We could not render this model, so there is nothing to make a clip from. Check that the GLB opens in the viewer, then try again.',
			retry: true,
		});
	}

	const cap = heroClipDailyCap();
	const daily = await limits.heroClipDaily(`user:${userId}`, cap);
	if (!daily.success) {
		return rateLimited(
			res,
			daily,
			`You have made ${cap} hero clips today, the daily limit. It resets within 24 hours.`,
			{
				daily_cap: cap,
			},
		);
	}

	const requestBody = buildVideoRequest({
		tier: options.tier,
		prompt: presetPrompt(options.preset, { title: source.title }),
		duration: options.duration,
		firstFrame: pngDataUri(frame.png),
		references: refs.map((r) => pngDataUri(r.png)),
		loop: heroClipPreset(options.preset).loop,
	});

	let requestId;
	try {
		({ requestId } = await createVideoJob(requestBody, { apiKey: env.GROK_API_KEY }));
	} catch (err) {
		if (!(err instanceof XaiVideoError)) throw err;
		console.warn(
			'[hero-clip] create failed:',
			err.code,
			err.providerCode || '',
			err.detail || err.message,
		);
		if (err.code === 'rate_limited' && err.retryAfter)
			res.setHeader('retry-after', String(err.retryAfter));
		return failWith(res, err.code);
	}

	const poster = absolute(
		refRenderUrl({
			glbUrl: source.glbUrl,
			...FIRST_FRAME_ANGLE,
			width: FIRST_FRAME_WIDTH,
			height: FIRST_FRAME_HEIGHT,
		}),
	);
	const job = encodeHeroClipJob({
		requestId,
		userId,
		tier: options.tier,
		preset: options.preset,
		seconds: options.duration,
		source: publicSource(source),
		poster,
	});
	return json(res, 202, {
		data: {
			status: 'generating',
			job,
			poll_url: `${ENDPOINT_PATH}?job=${encodeURIComponent(job)}`,
			request_id: requestId,
			preset: options.preset,
			tier: options.tier,
			model: videoModel(options.tier).id,
			seconds: options.duration,
			renders: { count: 1 + refs.length, ms_per_angle: msPerAngle },
			poster,
			source: publicSource(source),
			daily: { limit: cap, remaining: Math.max(0, Number(daily.remaining ?? 0)) },
		},
	});
}

function doneBody(job, clipUrl, duration) {
	const page = clipPagePath(job.requestId);
	return {
		status: 'done',
		request_id: job.requestId,
		clip_url: clipUrl,
		page_url: page,
		share_url: absolute(page),
		share_text: clipShareText(job.source?.title),
		duration: duration ?? job.seconds,
		model: videoModel(job.tier).id,
		preset: job.preset,
		poster: job.poster,
		source: job.source,
	};
}

async function status({ res, query, principal }) {
	if (!principal?.userId) return signInRequired(res);
	const job = decodeHeroClipJob(String(query.job || ''));
	// Someone else's handle reads exactly like a bad one.
	if (!job || job.userId !== principal.userId) {
		fail(404, 'not_found', 'No hero clip job matches that handle on your account.');
	}

	const key = clipKey(job.requestId);
	if (await headObject(key)) return doneBody(job, cdnUrl(key), null);

	if (!xaiVideoConfigured()) return failWith(res, 'not_configured', { status: 'failed' });

	let state;
	try {
		state = await getVideoJob(job.requestId, { apiKey: env.GROK_API_KEY });
	} catch (err) {
		if (!(err instanceof XaiVideoError)) throw err;
		console.warn('[hero-clip] status failed:', err.code, err.detail || err.message);
		return failWith(res, err.code, { status: 'unknown' });
	}

	if (state.status === 'failed') {
		console.warn(
			'[hero-clip] job failed:',
			job.requestId,
			state.error.code,
			state.error.providerCode || '',
		);
		return failWith(res, state.error.code, { status: 'failed', request_id: job.requestId });
	}

	if (state.status === 'pending') {
		const elapsedMs = Date.now() - job.createdAt;
		if (elapsedMs > JOB_TIMEOUT_MS)
			return failWith(res, 'timeout', { status: 'failed', request_id: job.requestId });
		return {
			status: 'generating',
			request_id: job.requestId,
			elapsed_s: Math.max(0, Math.round(elapsedMs / 1000)),
			preset: job.preset,
			poster: job.poster,
		};
	}

	try {
		const stored = await storeVideo({
			requestId: job.requestId,
			videoUrl: state.videoUrl,
			tier: job.tier,
			seconds: state.duration ?? job.seconds,
			metadata: {
				// Object metadata is ASCII-only; the clip page decodes these.
				title: encodeURIComponent(job.source?.title || ''),
				source_page: job.source?.page || '',
				preset: job.preset,
				poster: job.poster || '',
				duration: String(state.duration ?? job.seconds),
			},
			usage: {
				userId: job.userId,
				meta: { preset: job.preset, source_kind: job.source?.kind },
			},
		});
		return doneBody(job, stored.clipUrl, state.duration);
	} catch (err) {
		if (!(err instanceof XaiVideoError)) throw err;
		console.warn('[hero-clip] store failed:', err.code, err.message);
		return failWith(res, err.code, { status: 'unknown' });
	}
}

export default defineEndpoint({
	name: 'v1.models.hero_clip',
	method: ['GET', 'POST'],
	auth: 'optional',
	handler: async (ctx) => {
		if (ctx.req.method === 'POST') return create(ctx);
		if (ctx.query?.job) return status(ctx);
		if (ctx.query?.fallback) return fallback(ctx);
		return describe(ctx.principal);
	},
});
