// three.ws 3D Studio (free): the 360 capture tools.
//
// pano_capture_start turns a 360 video, a set of 360 photos or raw camera files
// (.insv / .insp) into a Gaussian splat scene (PLY and SPZ files plus a flythrough
// preview) and pano_capture_status collects it. pano_scene_create turns one 360
// photo into a depth shell you can stand inside (GLB and PLY) and
// pano_scene_status collects that. pano_capture_list returns the caller's own
// captures.
//
// Every tool is a thin client of the public REST lane (/api/pano-capture and
// /api/pano-scene), called over HTTP on the same origin with the caller's
// verified account forwarded the way the forge tools forward it
// (api/_mcp/creator-gate.js creatorForgeAuth). The REST handlers own the
// validation, the SSRF checks, the rate limits and the persistence, so an agent
// and a browser get the same answers from the same code. When a lane's worker is
// not deployed the REST lane answers 503 `unconfigured` and the tool relays that
// sentence to the user instead of inventing a result.
//
// An MCP client cannot stream a multi-gigabyte file through a tool call, so
// pano_capture_start takes a public https URL. Local files go through the
// `three-ws capture 360` command, which uploads them in parts first.

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { toolError } from './tools.js';
import { originFromReq } from './gpt-forge-client.js';

const JOB_ID_PROP = {
	type: 'string',
	minLength: 8,
	maxLength: 2048,
	description: 'The job_id the start tool returned.',
};

const HTTPS_URL = { type: 'string', format: 'uri', pattern: '^https://', maxLength: 4096 };

const CAPTURE_KINDS = ['equirect_video', 'equirect_images', 'insv', 'insp'];
const SCENE_KINDS = ['equirect_image', 'insp'];
const QUALITIES = ['preview', 'standard', 'high'];

const CALL_TIMEOUT_MS = 25_000;

const START_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

/**
 * One call to the REST lane. Returns `{ ok, status, body }`; a transport failure
 * is reported as status 0 with a visitor-readable message.
 */
async function callLane(req, ctx, { method, path, query, body }) {
	const url = new URL(`${originFromReq(req)}${path}`);
	for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
	const headers = { accept: 'application/json', ...(ctx?.creatorAuth || {}) };
	if (body !== undefined) headers['content-type'] = 'application/json';
	let res;
	try {
		res = await fetch(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
		});
	} catch (err) {
		const reason = err?.name === 'TimeoutError' ? 'timed out' : 'was unreachable';
		return { ok: false, status: 0, body: { error: 'lane_unreachable', message: `The 360 capture service ${reason}. Try again in a minute.` } };
	}
	const text = await res.text();
	let parsed = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = null;
	}
	return { ok: res.ok, status: res.status, body: parsed };
}

function laneError(out) {
	const body = out.body || {};
	const code = typeof body.error === 'string' ? body.error : out.status === 0 ? 'lane_unreachable' : 'request_failed';
	const message =
		typeof body.message === 'string' && body.message
			? body.message
			: `The 360 capture service answered HTTP ${out.status}. Try again shortly.`;
	return toolError(message, { reason: code, http_status: out.status });
}

// The REST lanes return viewer links as site paths; an agent needs links it can
// open, so a path is resolved against the origin the call was made on.
function absolute(origin, value) {
	return typeof value === 'string' && value.startsWith('/') ? `${origin}${value}` : value;
}

function absolutize(origin, files) {
	if (!files || typeof files !== 'object') return null;
	return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, absolute(origin, v)]));
}

const FILE_LABELS = {
	ply_url: 'PLY (standard Gaussian splat, opens in Blender add-ons and other viewers)',
	spz_url: 'SPZ (compressed splat, opens in the three.ws viewer)',
	preview_url: 'Flythrough preview video',
	poster_url: 'Poster image',
	glb_url: 'GLB (depth shell, metres, camera at the origin)',
	viewer_url: 'Open in the three.ws viewer',
};

function resultLines(result) {
	return Object.entries(FILE_LABELS)
		.filter(([key]) => result?.[key])
		.map(([key, label]) => `${label}: ${result[key]}`);
}

function statusResult({ origin, body, noun, jobTool }) {
	const status = body?.status || 'unknown';
	const result = absolutize(origin, body?.result);
	const structured = {
		job_id: body?.job_id,
		status,
		...(body?.stage ? { stage: body.stage } : {}),
		...(typeof body?.progress === 'number' ? { progress: body.progress } : {}),
		...(result ? { result } : {}),
		...(result?.viewer_url ? { viewer_url: result.viewer_url } : {}),
		...(body?.error ? { error: body.error } : {}),
	};
	if (status === 'failed' || status === 'cancelled' || body?.error) {
		const message = body?.error?.message || `The ${noun} ${status === 'cancelled' ? 'was cancelled' : 'failed'}.`;
		return {
			content: [{ type: 'text', text: message }],
			structuredContent: { ...structured, message },
			isError: true,
		};
	}
	if (result && Object.keys(result).length) {
		const lines = [`The ${noun} is ready. The files are yours to keep.`, ...resultLines(result)];
		return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: structured };
	}
	const pct = typeof body?.progress === 'number' ? ` ${Math.round(body.progress * 100)}% done` : '';
	const stage = body?.stage ? ` (stage: ${body.stage})` : '';
	const text = `The ${noun} is ${status}${stage}${pct}. Call ${jobTool} again in about a minute.`;
	return { content: [{ type: 'text', text }], structuredContent: structured };
}

async function handleCaptureStart(args, _auth, req, ctx = {}) {
	const body = { source_kind: args.source_kind };
	if (args.source_url) body.source_url = args.source_url;
	if (args.source_urls) body.source_urls = args.source_urls;
	if (args.trim) body.trim = args.trim;
	if (args.quality) body.quality = args.quality;
	if (!body.source_url && !body.source_urls) return toolError('Pass source_url (one file) or source_urls (a split pair of .insv files, or a set of equirect photos).', { reason: 'missing_source' });
	const out = await callLane(req, ctx, { method: 'POST', path: '/api/pano-capture', body });
	if (!out.ok) return laneError(out);
	const { job_id, status, eta_seconds } = out.body || {};
	const eta = Number.isFinite(eta_seconds) ? ` Expect about ${Math.max(1, Math.round(eta_seconds / 60))} minutes.` : '';
	const text = `360 capture started. job_id: ${job_id}. Call pano_capture_status with it about every minute.${eta}`;
	return { content: [{ type: 'text', text }], structuredContent: { job_id, status, ...(Number.isFinite(eta_seconds) ? { eta_seconds } : {}) } };
}

async function handleCaptureStatus(args, _auth, req, ctx = {}) {
	const out = await callLane(req, ctx, { method: 'GET', path: '/api/pano-capture', query: { job: args.job_id } });
	if (!out.ok) return laneError(out);
	return statusResult({ origin: originFromReq(req), body: out.body, noun: '360 capture', jobTool: 'pano_capture_status' });
}

async function handleCaptureList(args, _auth, req, ctx = {}) {
	const out = await callLane(req, ctx, { method: 'GET', path: '/api/pano-capture', query: { mine: '1' } });
	if (!out.ok) return laneError(out);
	const origin = originFromReq(req);
	const all = Array.isArray(out.body?.captures) ? out.body.captures : [];
	const captures = all.slice(0, args.limit || 20).map((c) => ({
		...c,
		poster_url: absolute(origin, c.poster_url),
		viewer_url: absolute(origin, c.viewer_url),
	}));
	const text = captures.length
		? [`${captures.length} capture${captures.length === 1 ? '' : 's'}, newest first:`, ...captures.map((c) => `${c.job_id}  ${c.status}  ${c.source_kind}  ${c.viewer_url || ''}`.trimEnd())].join('\n')
		: 'No 360 captures yet. Start one with pano_capture_start.';
	return { content: [{ type: 'text', text }], structuredContent: { captures, total: all.length } };
}

async function handleSceneCreate(args, _auth, req, ctx = {}) {
	const out = await callLane(req, ctx, { method: 'POST', path: '/api/pano-scene', body: { image_url: args.image_url, source_kind: args.source_kind } });
	if (!out.ok) return laneError(out);
	const { job_id } = out.body || {};
	const text = `Depth shell started. job_id: ${job_id}. Call pano_scene_status with it about every 20 seconds.`;
	return { content: [{ type: 'text', text }], structuredContent: { job_id, status: out.body?.status || 'queued' } };
}

async function handleSceneStatus(args, _auth, req, ctx = {}) {
	const out = await callLane(req, ctx, { method: 'GET', path: '/api/pano-scene', query: { job: args.job_id } });
	if (!out.ok) return laneError(out);
	return statusResult({ origin: originFromReq(req), body: { ...out.body, job_id: out.body?.job_id || args.job_id }, noun: 'depth shell', jobTool: 'pano_scene_status' });
}

const DEFS = [
	{
		name: 'pano_capture_start',
		title: 'Turn 360 footage into a Gaussian splat',
		description:
			'Start a job that turns 360 footage into a Gaussian splat scene you can walk through. Input is one public https URL ' +
			'(source_url) or several (source_urls) and the kind: equirect_video (a stitched 2:1 equirectangular video from any 360 ' +
			'camera), equirect_images (a set of stitched 360 photos), insv (raw Insta360 video; pass both files of a split pair in ' +
			'source_urls) or insp (a raw 360 photo). MCP clients cannot stream multi-gigabyte files, so the file must already be at a ' +
			'public https URL; for a file on disk use the CLI, which uploads it in parts: `npx three-ws capture 360 <file>`. Optional ' +
			'trim ({start_s, end_s}) limits a long video and quality is preview, standard (default) or high. Returns a job_id at once; ' +
			'the job runs on a GPU and takes minutes to over an hour (conservatively 10 to 25 minutes for preview, 25 to 60 for ' +
			'standard, 60 to 120 for high, plus a few minutes of GPU start-up when idle). Collect it with pano_capture_status. The ' +
			'result is owned files: a PLY and an SPZ splat, a flythrough preview video, a poster image and a viewer link. Use this when ' +
			'the user has 360 camera footage and wants a 3D scene from it. Needs a free three.ws account.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['source_kind'],
			anyOf: [{ required: ['source_url'] }, { required: ['source_urls'] }],
			properties: {
				source_url: { ...HTTPS_URL, description: 'Public https URL of one file: a stitched 360 video, one raw .insv or .insp, or one 360 photo.' },
				source_urls: {
					type: 'array',
					minItems: 1,
					maxItems: 600,
					items: HTTPS_URL,
					description: 'Public https URLs of a split pair of .insv files (both lenses), or of a set of equirect photos.',
				},
				source_kind: { type: 'string', enum: CAPTURE_KINDS, description: 'What the URL points at: equirect_video, equirect_images, insv or insp.' },
				trim: {
					type: 'object',
					additionalProperties: false,
					properties: {
						start_s: { type: 'number', minimum: 0, description: 'Seconds to skip at the start.' },
						end_s: { type: 'number', minimum: 0, description: 'Second at which to stop.' },
					},
					description: 'Use only part of a video.',
				},
				quality: { type: 'string', enum: QUALITIES, description: 'preview is fastest, standard is the default, high uses more frames and training and takes longest.' },
			},
		},
		annotations: START_ANNOTATIONS,
		handler: handleCaptureStart,
	},
	{
		name: 'pano_capture_status',
		title: 'Get a 360 capture job',
		description:
			'Status of a 360 capture started with pano_capture_start. Returns status (queued, running, succeeded, failed or cancelled), ' +
			'stage (download, stitch, frames, sfm, train, export or upload) and progress from 0 to 1 while it runs. When it has succeeded ' +
			'it returns result URLs you own: ply_url (standard Gaussian splat PLY), spz_url (compressed splat), preview_url (flythrough ' +
			'video), poster_url and viewer_url (opens the scene in the three.ws viewer). When it failed it returns a readable reason. It ' +
			'never starts or repeats work, so call it as often as needed, about once a minute. Use this when a capture job_id needs its ' +
			'current state or finished files.',
		inputSchema: { type: 'object', additionalProperties: false, required: ['job_id'], properties: { job_id: JOB_ID_PROP } },
		annotations: READ_ANNOTATIONS,
		handler: handleCaptureStatus,
	},
	{
		name: 'pano_capture_list',
		title: 'List my 360 captures',
		description:
			'List the 360 captures that belong to the signed-in account, newest first: job_id, status, created_at, source_kind, poster_url ' +
			'and viewer_url for each. Only the caller\'s own captures are returned. Use this to find an earlier job_id or to show what ' +
			'the user has already captured.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'How many captures to return (default 20).' } },
		},
		annotations: READ_ANNOTATIONS,
		handler: handleCaptureList,
	},
	{
		name: 'pano_scene_create',
		title: 'Turn a 360 photo into a depth shell',
		description:
			'Start a job that turns one 360 photo into a metric depth shell you can stand inside: a textured GLB mesh in metres with the ' +
			'camera at the origin, plus a PLY point cloud. Input is a public https image_url and source_kind: equirect_image (a stitched ' +
			'2:1 equirectangular jpg, png or exr) or insp (a raw 360 photo, which is stitched first). Returns a job_id at once; a photo ' +
			'typically takes one to five minutes (longer for a raw .insp or a cold GPU). Collect it with pano_scene_status. The result is ' +
			'owned files (GLB and PLY) and a viewer link. Use this when the user has a single 360 photo and wants a 3D place from it. ' +
			'Needs a free three.ws account.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['image_url', 'source_kind'],
			properties: {
				image_url: { ...HTTPS_URL, description: 'Public https URL of the 360 photo.' },
				source_kind: { type: 'string', enum: SCENE_KINDS, description: 'equirect_image for a stitched 2:1 photo, insp for a raw .insp file.' },
			},
		},
		annotations: START_ANNOTATIONS,
		handler: handleSceneCreate,
	},
	{
		name: 'pano_scene_status',
		title: 'Get a depth shell job',
		description:
			'Status of a depth shell started with pano_scene_create. Returns status and progress while it runs; when done, glb_url (the ' +
			'depth shell mesh), ply_url (point cloud) and viewer_url. When it failed, a readable reason. It never starts or repeats work, ' +
			'so poll about every 20 seconds. Use this when a pano_scene_create job_id needs its current state or finished files.',
		inputSchema: { type: 'object', additionalProperties: false, required: ['job_id'], properties: { job_id: JOB_ID_PROP } },
		annotations: READ_ANNOTATIONS,
		handler: handleSceneStatus,
	},
];

export const PANO_TOOL_NAMES = DEFS.map((d) => d.name);

export const PANO_TOOL_CATALOG = DEFS.map(({ handler: _h, ...schema }) => schema);

const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: true, strict: false });
addFormats(ajv);

export const PANO_TOOLS = Object.fromEntries(DEFS.map(({ name, handler, inputSchema }) => [name, { handler, validate: ajv.compile(inputSchema) }]));
