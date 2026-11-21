// OpenAPI paths for the 360 capture lanes (contract C4 in
// prompts/finish/_context/insta360-00-CONTEXT.md):
//
//   /api/capture-upload/{create,sign,parts,complete,abort}  resumable multipart
//                                                          upload of 360 files
//   /api/pano-capture                                      360 footage to a
//                                                          Gaussian splat (job)
//   /api/pano-scene                                        one 360 photo to a
//                                                          walkable mesh (job)
//
// Spread into api/openapi-json.js (tags, components.schemas, paths). Every
// example below is a body these handlers really returned, captured against the
// real server on 2026-11-21. Opaque upload ids and signed storage URLs are
// abridged; nothing else is edited. Prose reference: docs/capture.md,
// docs/api-reference.md "Capture upload API", and `three-ws capture` in
// docs/cli.md.

const TAG_UPLOAD = '360 capture: uploads';
const TAG_CAPTURE = '360 capture: scenes';

export const PANO_TAGS = [
	{
		name: TAG_UPLOAD,
		description:
			'Resumable multipart upload for 360 footage and photos up to 8 GiB, straight from the client to object ' +
			'storage. create, then sign batches of parts, PUT each part to its signed URL, then complete. parts lists ' +
			'what storage already holds so an interrupted upload resumes. The source_url that complete returns is the ' +
			'input to /api/pano-capture and /api/pano-scene. Needs a three.ws account (an API key works).',
	},
	{
		name: TAG_CAPTURE,
		description:
			'Turn 360 footage or photos from any 360 camera (works with Insta360 .insv and .insp files) into a 3D ' +
			'scene. /api/pano-capture trains a Gaussian splat from a walk-through video or a photo set; ' +
			'/api/pano-scene lifts one 360 photo into a walkable mesh. Both are jobs: start with POST, poll with GET.',
	},
];

const SECURITY = [{ bearerAuth: [] }, { apiKeyAuth: [] }];
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

// Abridged forms of real values, so the examples stay readable.
const EX_UPLOAD_ID = 'AFt6Ul407NMHKaQgRD_GdZ_OPqWBzK2s9adhs9BrGbcu9OH0amcAe8eqzEaE7h1t-GAKLML1IMoUmFKk';
const EX_KEY = 'captures/raw/1bb8c43c-86fe-4517-b1b9-f608ac817868/671e84aa-4d56-4081-bbd9-e37a44f601a5/walk.mp4';
const EX_SIGNED = (key, part) =>
	`https://storage.example/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=...` +
	(part ? `&partNumber=${part}&uploadId=...&x-id=UploadPart` : '&x-id=GetObject');
const EX_PHOTO_KEY = 'captures/raw/1bb8c43c-86fe-4517-b1b9-f608ac817868/e816cc07-c4d1-4440-8879-19e583247251/room.jpg';

// ── schemas ──────────────────────────────────────────────────────────────────

const JOB_STATUS = { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] };
const JOB_ERROR = {
	type: 'object',
	required: ['code', 'message'],
	properties: { code: { type: 'string' }, message: { type: 'string' } },
};
const NULLABLE_URL = { type: ['string', 'null'], format: 'uri' };

export const PANO_SCHEMAS = {
	CaptureError: {
		type: 'object',
		description:
			'Every error from these routes. Handlers answer { error, message }; the shared request parser and the rate ' +
			'limiter answer { error, error_description }. `message` is safe to show a person; `hint` is for the operator ' +
			'of the deployment and is never meant for display.',
		required: ['error'],
		properties: {
			error: str('Stable machine code, for example unconfigured, sign_in_required, invalid_source_kind.'),
			message: str('What went wrong and how to recover, in plain language.'),
			error_description: str('Same as message, on responses from the shared request parser and the rate limiter.'),
			hint: str('Operator hint on 503 unconfigured: which environment variables switch the lane on.'),
			sign_in_url: str('On 401: where a person signs in.'),
			api_keys_url: str('On 401: where to create an API key.'),
			retry_after: { type: 'integer', description: 'On 429 rate_limited: seconds until the next attempt is allowed.' },
			reason: str('On 429 rate_limited: the limiter reason, when it has one.'),
			expected_bytes: { type: 'integer', description: 'On 422 size_mismatch: the size declared at create.' },
			actual_bytes: { type: 'integer', description: 'On 422 size_mismatch: the size storage assembled.' },
			job_id: str('On a worker refusal from POST /api/pano-capture: the id of the job that was recorded as failed.'),
		},
	},
	CaptureUploadCreateRequest: {
		type: 'object',
		required: ['filename', 'content_type', 'size_bytes', 'kind'],
		properties: {
			filename: str('File name with its extension (up to 255 characters).', { maxLength: 255 }),
			content_type: {
				type: 'string',
				enum: ['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png', 'image/x-exr', 'application/octet-stream'],
				description: 'application/octet-stream only for raw camera files ending in .insv, .insp or .lrv.',
			},
			size_bytes: { type: 'integer', minimum: 1, maximum: 8589934592, description: 'Exact file size, up to 8 GiB.' },
			kind: { type: 'string', enum: ['pano'] },
		},
	},
	CaptureUploadCreateResponse: {
		type: 'object',
		required: ['upload_id', 'key', 'part_size', 'part_count'],
		properties: {
			upload_id: str('Opaque multipart upload id. Send it back with key on every later call.'),
			key: str('Storage key of the upload, scoped to the caller.'),
			part_size: { type: 'integer', minimum: 8388608, description: 'Bytes per part (at least 8 MiB); the last part may be smaller.' },
			part_count: { type: 'integer', minimum: 1, maximum: 10000 },
		},
	},
	CaptureUploadRef: {
		type: 'object',
		required: ['upload_id', 'key'],
		properties: { upload_id: { type: 'string' }, key: { type: 'string' } },
	},
	CaptureUploadSignRequest: {
		type: 'object',
		required: ['upload_id', 'key', 'part_numbers'],
		properties: {
			upload_id: { type: 'string' },
			key: { type: 'string' },
			part_numbers: {
				type: 'array',
				minItems: 1,
				maxItems: 100,
				items: { type: 'integer', minimum: 1, maximum: 10000 },
				description: 'Up to 100 part numbers per call.',
			},
		},
	},
	CaptureUploadSignResponse: {
		type: 'object',
		required: ['urls'],
		properties: {
			urls: {
				type: 'object',
				description: 'Part number to a signed PUT URL, valid for 3600 seconds. PUT the raw part bytes; keep the ETag response header.',
				additionalProperties: { type: 'string', format: 'uri' },
			},
		},
	},
	CaptureUploadPartsResponse: {
		type: 'object',
		required: ['parts'],
		properties: {
			parts: {
				type: 'array',
				items: {
					type: 'object',
					required: ['part_number', 'etag', 'size'],
					properties: { part_number: { type: 'integer' }, etag: { type: 'string' }, size: { type: 'integer' } },
				},
			},
		},
	},
	CaptureUploadCompleteRequest: {
		type: 'object',
		required: ['upload_id', 'key', 'parts'],
		properties: {
			upload_id: { type: 'string' },
			key: { type: 'string' },
			parts: {
				type: 'array',
				minItems: 1,
				items: {
					type: 'object',
					required: ['part_number', 'etag'],
					properties: { part_number: { type: 'integer', minimum: 1 }, etag: str('ETag header from the part PUT, quotes included.') },
				},
			},
		},
	},
	CaptureUploadCompleteResponse: {
		type: 'object',
		required: ['source_url', 'size_bytes'],
		properties: {
			source_url: str('Signed read URL for the assembled file, valid for 7 days. Pass it to /api/pano-capture or /api/pano-scene.', { format: 'uri' }),
			size_bytes: { type: 'integer' },
		},
	},
	CaptureUploadAbortResponse: {
		type: 'object',
		required: ['ok'],
		properties: { ok: { type: 'boolean', const: true } },
	},
	PanoCaptureRequest: {
		type: 'object',
		required: ['source_kind'],
		properties: {
			source_url: str('Public https URL of the footage (a complete upload source_url works). Required unless source_urls is given.', { format: 'uri' }),
			source_urls: {
				type: 'array',
				items: { type: 'string', format: 'uri' },
				description: 'equirect_images: 3 to 600 photos. insv: the two halves of a split-pair recording. Other kinds take one file.',
			},
			source_kind: { type: 'string', enum: ['equirect_video', 'equirect_images', 'insv', 'insp'] },
			trim: {
				type: 'object',
				description: 'Video kinds only (equirect_video, insv).',
				properties: {
					start_s: { type: 'number', minimum: 0 },
					end_s: { type: 'number', description: 'Greater than start_s when given.' },
				},
			},
			quality: { type: 'string', enum: ['preview', 'standard', 'high'], default: 'standard' },
		},
	},
	PanoCaptureStarted: {
		type: 'object',
		required: ['job_id', 'status', 'eta_seconds'],
		properties: {
			job_id: { type: 'string', format: 'uuid' },
			status: JOB_STATUS,
			eta_seconds: { type: 'integer', description: 'preview 900, standard 1800, high 2700.' },
		},
	},
	PanoCaptureJob: {
		type: 'object',
		required: ['job_id', 'status', 'stage', 'progress', 'source_kind', 'quality', 'created_at', 'updated_at', 'finished_at'],
		properties: {
			job_id: { type: 'string', format: 'uuid' },
			status: JOB_STATUS,
			stage: { type: ['string', 'null'], description: 'Current pipeline stage, for example queued, frames, colmap, splat_train, save, done.' },
			progress: { type: 'number', minimum: 0, maximum: 1 },
			source_kind: { type: 'string', enum: ['equirect_video', 'equirect_images', 'insv', 'insp'] },
			quality: { type: 'string', enum: ['preview', 'standard', 'high'] },
			created_at: { type: ['string', 'null'], format: 'date-time' },
			updated_at: { type: ['string', 'null'], format: 'date-time' },
			finished_at: { type: ['string', 'null'], format: 'date-time' },
			result: {
				type: 'object',
				description: 'Present once status is succeeded. Files live in three.ws storage and do not expire with the worker.',
				properties: {
					ply_url: NULLABLE_URL,
					spz_url: NULLABLE_URL,
					preview_url: NULLABLE_URL,
					poster_url: NULLABLE_URL,
					viewer_url: NULLABLE_URL,
				},
			},
			stats: { type: 'object', description: 'Worker statistics, for example frame and splat counts.' },
			error: JOB_ERROR,
		},
	},
	PanoCaptureList: {
		type: 'object',
		required: ['captures'],
		properties: {
			captures: {
				type: 'array',
				description: "The caller's captures, newest first.",
				items: {
					type: 'object',
					required: ['job_id', 'status', 'stage', 'progress', 'created_at', 'poster_url', 'viewer_url', 'source_kind', 'error'],
					properties: {
						job_id: { type: 'string', format: 'uuid' },
						status: JOB_STATUS,
						stage: { type: ['string', 'null'] },
						progress: { type: 'number', minimum: 0, maximum: 1 },
						created_at: { type: ['string', 'null'], format: 'date-time' },
						poster_url: NULLABLE_URL,
						viewer_url: NULLABLE_URL,
						source_kind: { type: 'string' },
						error: { anyOf: [JOB_ERROR, { type: 'null' }] },
					},
				},
			},
		},
	},
	PanoCaptureDeleted: {
		type: 'object',
		required: ['job_id'],
		description: 'An active job is cancelled ({ status: "cancelled" }); a finished one is deleted with its files ({ deleted: true }).',
		properties: {
			job_id: { type: 'string', format: 'uuid' },
			status: { type: 'string', const: 'cancelled' },
			deleted: { type: 'boolean', const: true },
		},
	},
	PanoSceneRequest: {
		type: 'object',
		required: ['image_url'],
		properties: {
			image_url: str('Public https URL of a stitched 360 photo (JPEG or PNG) or a raw .insp.', { format: 'uri' }),
			source_kind: { type: 'string', enum: ['equirect_image', 'insp'], description: 'Inferred from a .insp path when omitted.' },
		},
	},
	PanoSceneJob: {
		type: 'object',
		required: ['job_id', 'status', 'stage', 'progress'],
		properties: {
			job_id: str('Signed job token. Only the account that started the job can poll it.'),
			status: JOB_STATUS,
			stage: str('stitch (raw .insp only), depth, mesh or save.'),
			progress: { type: 'number', minimum: 0, maximum: 1 },
			result: {
				type: 'object',
				properties: {
					glb_url: NULLABLE_URL,
					ply_url: NULLABLE_URL,
					viewer_url: NULLABLE_URL,
					stats: { type: 'object' },
				},
			},
			error: JOB_ERROR,
		},
	},
	PanoSceneLanes: {
		type: 'object',
		required: ['lanes'],
		properties: {
			lanes: {
				type: 'object',
				description: 'Which inputs this deployment can turn into a scene right now, so a page can say so before an upload.',
				required: ['equirect_image', 'insp'],
				properties: { equirect_image: { type: 'boolean' }, insp: { type: 'boolean' } },
			},
		},
	},
};

// ── captured examples ────────────────────────────────────────────────────────

const ERR = {
	uploadUnconfigured: {
		error: 'unconfigured',
		message: 'Large capture uploads are not available right now. Try again later.',
		hint: 'Object storage env (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) is unset on this deployment.',
	},
	uploadSignIn: {
		error: 'sign_in_required',
		message: 'Sign in to start a capture upload. A three.ws account is free.',
		sign_in_url: '/login',
		api_keys_url: '/dashboard/api-keys',
	},
	badJson: {
		error: 'bad_request',
		error_description: "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
		message: "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
	},
	uploadNotFound: { error: 'upload_not_found', message: 'This upload expired or was already finished. Start the upload again.' },
	captureUnconfigured: {
		error: 'unconfigured',
		message: '360 capture is offline on this deployment, so footage cannot be turned into a 3D scene right now.',
		hint:
			'Set GCP_PANO2SPLAT_URL and GCP_RECONSTRUCTION_KEY to the URL and bearer secret of the deployed ' +
			'workers/model-pano2splat Cloud Run service, and configure S3_* object storage for the saved results.',
	},
	captureNotFound: { error: 'not_found', message: 'No capture with that id belongs to this account.' },
	sceneUnconfigured: {
		error: 'unconfigured',
		message: 'Photo-to-3D is not switched on yet on this server.',
		hint: 'Set GCP_PANODEPTH_URL and GCP_RECONSTRUCTION_KEY to the deployed workers/model-panodepth service and the shared reconstruction bearer secret.',
	},
	sceneInspUnconfigured: {
		error: 'unconfigured',
		message: 'Photo-to-3D is not switched on yet on this server.',
		hint:
			'Set GCP_PANODEPTH_URL, GCP_PANO2SPLAT_URL and GCP_RECONSTRUCTION_KEY to the deployed workers/model-panodepth ' +
			'and workers/model-pano2splat services and the shared reconstruction bearer secret.',
	},
};

const examples = (map) =>
	Object.fromEntries(Object.entries(map).map(([name, [summary, value]]) => [name, { summary, value }]));

const errorResponse = (description, map) => ({
	description,
	content: { 'application/json': { schema: ref('CaptureError'), ...(map ? { examples: examples(map) } : {}) } },
});

const okResponse = (description, schema, map) => ({
	description,
	content: { 'application/json': { schema: ref(schema), ...(map ? { examples: examples(map) } : {}) } },
});

const jsonBody = (schema, map) => ({
	required: true,
	content: { 'application/json': { schema: ref(schema), ...(map ? { examples: examples(map) } : {}) } },
});

// Responses every capture-upload step shares.
const uploadCommon = (action) => ({
	400: errorResponse('The body is not JSON, or a field is missing or malformed.', {
		malformed_json: ['Body is not JSON', ERR.badJson],
	}),
	401: errorResponse(`No account. Sign in or send an API key to ${action}.`, {
		signed_out: ['No credentials', ERR.uploadSignIn],
	}),
	403: errorResponse('The upload key belongs to another account (forbidden).'),
	502: errorResponse('Object storage failed (storage_error); retry the same call.'),
	503: errorResponse('Object storage is not configured on this deployment.', {
		unconfigured: ['Storage switched off', ERR.uploadUnconfigured],
	}),
});

const uploadStep = ({ operationId, summary, description, request, requestExample, ok, okExample, extra = {} }) => ({
	post: {
		operationId,
		summary,
		description,
		tags: [TAG_UPLOAD],
		security: SECURITY,
		requestBody: jsonBody(request, requestExample),
		responses: { 200: okResponse('OK', ok, okExample), ...uploadCommon('upload a capture'), ...extra },
	},
});

// ── paths ────────────────────────────────────────────────────────────────────

export function panoPaths() {
	return {
		'/api/capture-upload/create': uploadStep({
			operationId: 'capture_upload_create',
			summary: 'Start a resumable 360 upload',
			description:
				'Opens a multipart upload for one file up to 8 GiB. At most 3 uploads may be open per account and 32 GiB ' +
				'may be started per day.',
			request: 'CaptureUploadCreateRequest',
			requestExample: {
				video: ['A 360 video', { filename: 'walk.mp4', content_type: 'video/mp4', size_bytes: 26740278, kind: 'pano' }],
			},
			ok: 'CaptureUploadCreateResponse',
			okExample: {
				video: ['Four 8 MiB parts (upload_id abridged)', { upload_id: EX_UPLOAD_ID, key: EX_KEY, part_size: 8388608, part_count: 4 }],
			},
			extra: {
				400: errorResponse('A field is invalid: invalid_filename, invalid_kind, invalid_content_type or invalid_size.', {
					invalid_kind: ['Wrong kind', { error: 'invalid_kind', message: 'kind must be "pano".' }],
					invalid_content_type: [
						'Unsupported type',
						{
							error: 'invalid_content_type',
							message:
								'content_type must be video/mp4, video/quicktime, image/jpeg, image/png, image/x-exr, or application/octet-stream for .insv, .insp and .lrv files.',
						},
					],
					invalid_size: ['Over 8 GiB', { error: 'invalid_size', message: 'size_bytes must be a whole number between 1 byte and 8 GiB.' }],
					malformed_json: ['Body is not JSON', ERR.badJson],
				}),
				429: errorResponse('too_many_open_uploads (3 already open) or daily_quota_exceeded (32 GiB started today).'),
			},
		}),

		'/api/capture-upload/sign': uploadStep({
			operationId: 'capture_upload_sign',
			summary: 'Sign PUT URLs for upload parts',
			description: 'Returns a signed PUT URL per part, valid for 3600 seconds. Ask again for a part whose URL expired.',
			request: 'CaptureUploadSignRequest',
			requestExample: { two_parts: ['Parts 1 and 2', { upload_id: EX_UPLOAD_ID, key: EX_KEY, part_numbers: [1, 2] }] },
			ok: 'CaptureUploadSignResponse',
			okExample: {
				two_parts: ['Signed URLs (host and signature abridged)', { urls: { 1: EX_SIGNED(EX_KEY, 1), 2: EX_SIGNED(EX_KEY, 2) } }],
			},
			extra: {
				400: errorResponse('invalid_upload_id or invalid_part_numbers (1 to 100 numbers between 1 and 10000).', {
					malformed_json: ['Body is not JSON', ERR.badJson],
				}),
			},
		}),

		'/api/capture-upload/parts': uploadStep({
			operationId: 'capture_upload_parts',
			summary: 'List the parts storage already holds',
			description: 'Call before resuming: upload only the parts missing from this list, then complete.',
			request: 'CaptureUploadRef',
			requestExample: { resume: ['Resume check', { upload_id: EX_UPLOAD_ID, key: EX_KEY }] },
			ok: 'CaptureUploadPartsResponse',
			okExample: {
				fresh: ['Nothing uploaded yet', { parts: [] }],
				one_part: ['One part stored', { parts: [{ part_number: 1, etag: '"e0a0177050afcaa5fdb01b0d10844e32"', size: 81134 }] }],
			},
			extra: {
				404: errorResponse('The upload expired, was aborted or was already completed. Start a new upload.', {
					upload_not_found: ['Aborted upload', ERR.uploadNotFound],
				}),
			},
		}),

		'/api/capture-upload/complete': uploadStep({
			operationId: 'capture_upload_complete',
			summary: 'Assemble the parts into one file',
			description:
				'Joins every part and checks the total against the size declared at create. Returns the source_url to ' +
				'pass to /api/pano-capture or /api/pano-scene.',
			request: 'CaptureUploadCompleteRequest',
			requestExample: {
				one_part: [
					'A single-part photo',
					{ upload_id: EX_UPLOAD_ID, key: EX_PHOTO_KEY, parts: [{ part_number: 1, etag: '"e0a0177050afcaa5fdb01b0d10844e32"' }] },
				],
			},
			ok: 'CaptureUploadCompleteResponse',
			okExample: { photo: ['Assembled (host and signature abridged)', { source_url: EX_SIGNED(EX_PHOTO_KEY), size_bytes: 81134 }] },
			extra: {
				400: errorResponse('invalid_parts: the list is empty or malformed, or storage rejected it.', {
					empty: ['Empty part list', { error: 'invalid_parts', message: 'parts must list every uploaded part as { part_number, etag }.' }],
					rejected: [
						'Part list does not match storage',
						{ error: 'invalid_parts', message: 'Storage rejected the part list. Re-upload the missing parts and try again.' },
					],
				}),
				404: errorResponse('The upload expired or was already completed (upload_not_found).'),
				422: errorResponse('size_mismatch: the assembled file is not the size declared at create. The upload is discarded.'),
			},
		}),

		'/api/capture-upload/abort': uploadStep({
			operationId: 'capture_upload_abort',
			summary: 'Abandon an upload',
			description: 'Frees the stored parts and the open-upload slot. Aborting an upload that is already gone also answers ok.',
			request: 'CaptureUploadRef',
			requestExample: { abort: ['Abort', { upload_id: EX_UPLOAD_ID, key: EX_KEY }] },
			ok: 'CaptureUploadAbortResponse',
			okExample: { ok: ['Aborted', { ok: true }] },
		}),

		'/api/pano-capture': {
			post: {
				operationId: 'pano_capture_start',
				summary: 'Turn 360 footage into a Gaussian splat scene',
				description:
					'Starts a persistent job owned by the caller. At most 2 captures may run at once per account. Poll ' +
					'GET ?job= every 5 seconds or more until status is succeeded, failed or cancelled.',
				tags: [TAG_CAPTURE],
				security: SECURITY,
				requestBody: jsonBody('PanoCaptureRequest', {
					video: [
						'A trimmed walk-through video',
						{
							source_url: 'https://example.org/walk.mp4',
							source_kind: 'equirect_video',
							trim: { start_s: 3, end_s: 41.5 },
							quality: 'standard',
						},
					],
				}),
				responses: {
					202: okResponse('Job accepted.', 'PanoCaptureStarted'),
					400: errorResponse(
						'invalid_body, invalid_source_kind, invalid_source_urls, missing_source_url, too_few_images, ' +
							'too_many_images, too_many_files, invalid_source_url (not public https), invalid_trim or invalid_quality.',
						{
							invalid_source_kind: [
								'Unknown kind',
								{ error: 'invalid_source_kind', message: 'source_kind must be one of equirect_video, equirect_images, insv, insp.' },
							],
							too_few_images: [
								'One photo in a photo set',
								{ error: 'too_few_images', message: 'A scene needs at least 3 360 photos taken from different spots. Pass them as source_urls.' },
							],
							invalid_trim: [
								'Trim on a photo',
								{ error: 'invalid_trim', message: 'trim applies to video footage only (equirect_video or insv).' },
							],
							invalid_source_url: [
								'Not https',
								{ error: 'invalid_source_url', message: 'Source URL rejected: scheme not allowed: http:.' },
							],
						},
					),
					401: errorResponse('No account.', {
						signed_out: [
							'No credentials',
							{
								error: 'sign_in_required',
								message: 'Sign in to turn 360 footage into a 3D scene. A three.ws account is free.',
								sign_in_url: '/login',
								api_keys_url: '/dashboard/api-keys',
							},
						],
					}),
					422: errorResponse('The worker refused the footage; error and message are the worker code and reason, job_id the failed job.'),
					429: errorResponse('too_many_active (2 captures already running) or rate_limited.'),
					502: errorResponse('The capture worker is unavailable; job_id is the failed job.'),
					503: errorResponse('The capture worker is not configured on this deployment.', {
						unconfigured: ['Lane switched off', ERR.captureUnconfigured],
					}),
				},
			},
			get: {
				operationId: 'pano_capture_get',
				summary: 'Poll one capture, or list your captures',
				description: 'Pass ?job=<id> for one capture, or ?mine=1 for the caller\'s captures, newest first.',
				tags: [TAG_CAPTURE],
				security: SECURITY,
				parameters: [
					{ name: 'job', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Capture id from POST.' },
					{ name: 'mine', in: 'query', schema: { type: 'string', enum: ['1'] }, description: 'List the caller\'s captures instead.' },
					{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, description: 'With mine=1.' },
				],
				responses: {
					200: {
						description: 'One capture (job) or the list (mine).',
						content: {
							'application/json': {
								schema: { oneOf: [ref('PanoCaptureJob'), ref('PanoCaptureList')] },
								examples: examples({ mine_empty: ['No captures yet', { captures: [] }] }),
							},
						},
					},
					400: errorResponse('missing_job or invalid_job.', {
						missing_job: ['No query', { error: 'missing_job', message: 'Pass ?job=<id> for one capture, or ?mine=1 for your captures.' }],
						invalid_job: ['Not a uuid', { error: 'invalid_job', message: 'Malformed capture id.' }],
					}),
					401: errorResponse('No account.', {
						signed_out: [
							'No credentials',
							{
								error: 'sign_in_required',
								message: 'Sign in to see your 360 captures. A three.ws account is free.',
								sign_in_url: '/login',
								api_keys_url: '/dashboard/api-keys',
							},
						],
					}),
					404: errorResponse('No capture with that id belongs to the caller.', { not_found: ['Unknown id', ERR.captureNotFound] }),
					429: errorResponse('rate_limited: poll less often.'),
				},
			},
			delete: {
				operationId: 'pano_capture_delete',
				summary: 'Cancel a running capture or delete a finished one',
				tags: [TAG_CAPTURE],
				security: SECURITY,
				parameters: [{ name: 'job', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
				responses: {
					200: okResponse('Cancelled or deleted.', 'PanoCaptureDeleted'),
					400: errorResponse('missing_job or invalid_job.'),
					401: errorResponse('No account.'),
					404: errorResponse('No capture with that id belongs to the caller.', { not_found: ['Unknown id', ERR.captureNotFound] }),
					502: errorResponse('cancel_failed, or the worker code when it refused the cancel. Try again shortly.'),
				},
			},
		},

		'/api/pano-scene': {
			post: {
				operationId: 'pano_scene_start',
				summary: 'Turn one 360 photo into a walkable 3D scene',
				description:
					'Lifts a stitched 360 photo (or a raw .insp, stitched first) into a mesh and point cloud. Poll GET ?job= ' +
					'until status is succeeded or failed.',
				tags: [TAG_CAPTURE],
				security: SECURITY,
				requestBody: jsonBody('PanoSceneRequest', {
					photo: ['A stitched 360 photo', { image_url: 'https://example.org/room.jpg', source_kind: 'equirect_image' }],
				}),
				responses: {
					202: okResponse('Job accepted: { job_id, status: "queued", stage, progress: 0 }.', 'PanoSceneJob'),
					400: errorResponse('missing_image_url, invalid_source_kind or invalid_image_url.', {
						missing_image_url: [
							'No image_url',
							{ error: 'missing_image_url', message: 'Pass a public https URL to a 360 photo (JPEG, PNG or .insp) as image_url.' },
						],
						invalid_source_kind: ['Unknown kind', { error: 'invalid_source_kind', message: 'source_kind must be "equirect_image" or "insp".' }],
						invalid_image_url: ['Not https', { error: 'invalid_image_url', message: 'image_url rejected: scheme not allowed: http:' }],
					}),
					401: errorResponse('No account.', {
						signed_out: [
							'No credentials',
							{
								error: 'sign_in_required',
								message: 'Sign in to turn a 360 photo into a 3D scene. A three.ws account is free.',
								sign_in_url: '/login',
								api_keys_url: '/dashboard/api-keys',
							},
						],
					}),
					422: errorResponse('The worker refused the photo.'),
					429: errorResponse('rate_limited.'),
					502: errorResponse('pano_scene_failed: the 3D server could not start the job. Try again in a minute.'),
					503: errorResponse('The photo lane or object storage is not configured on this deployment.', {
						unconfigured: ['Lane switched off', ERR.sceneUnconfigured],
						unconfigured_insp: ['Raw .insp lane switched off', ERR.sceneInspUnconfigured],
					}),
				},
			},
			get: {
				operationId: 'pano_scene_get',
				summary: 'Poll a scene job, or ask which lanes are on',
				description: 'With ?job= the caller must own the job. Without it, answers which inputs this deployment accepts (no account needed).',
				tags: [TAG_CAPTURE],
				security: [...SECURITY, {}],
				parameters: [{ name: 'job', in: 'query', schema: { type: 'string' }, description: 'Signed job token from POST.' }],
				responses: {
					200: {
						description: 'The job (with ?job=) or the lane switches (without).',
						content: {
							'application/json': {
								schema: { oneOf: [ref('PanoSceneJob'), ref('PanoSceneLanes')] },
								examples: examples({ lanes_off: ['Both lanes off on this deployment', { lanes: { equirect_image: false, insp: false } }] }),
							},
						},
					},
					400: errorResponse('invalid_job: the token is not valid.', {
						invalid_job: ['Bad token', { error: 'invalid_job', message: 'That job id is not valid. Start a new scene.' }],
					}),
					401: errorResponse('No account (with ?job=).'),
					404: errorResponse('job_not_found: no scene with that id belongs to the caller.'),
					429: errorResponse('rate_limited.'),
					503: errorResponse('The photo lane or object storage is not configured.'),
				},
			},
		},
	};
}
