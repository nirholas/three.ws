// Forge error copy: one entry for every error code a Forge endpoint can return.
//
// The server emits well over a hundred codes across api/forge.js and the
// api/forge-* tool endpoints. The page used to recognize a handful and show the
// server's own `message` (or "The generator returned 502.") for the rest, which
// left a user unable to tell whether to wait, retry, change their prompt, sign
// in, or give up, and on one path relayed a provider's raw error text verbatim.
//
// This module is the single answer. Every entry says, in plain words:
//   what   what happened
//   todo   what to do about it
//   retry  'now'   retrying straight away can work
//          'wait'  retry after the server's retry_after (or `wait` seconds)
//          'never' the same request cannot succeed; the user changes something
//   action the one control that recovers: retry, sign_in, edit_input,
//          switch_engine, add_key, pay, reload, contact
// The user's prompt, photos and settings are always kept on every error
// (`keepsInput` is true for every descriptor); nothing here clears the composer.
//
// Copy comes from this map, never from the server's `message`, because a
// handler can put a provider's raw text in it. Two codes whose server message is
// our own validation text (`serverDetail: true`) may append it, and only after
// isSafeServerText() clears it of URLs, hostnames, stack frames and secrets.
//
// tests/forge-error-copy.test.js extracts every code the server can emit (with
// scripts/forge-error-codes.mjs) and fails when one has no entry here.

const SUPPORT_URL = '/support';

// ── Shared entries ──────────────────────────────────────────────────────────
// Families of codes that need the same answer. Each is still a full sentence
// pair: grouping is about not saying the same thing five different ways.

const SIGN_IN = {
	title: 'Sign in to continue',
	what: 'This needs a free three.ws account.',
	todo: 'Sign in and you come straight back here, with your prompt and settings kept.',
	retry: 'never',
	action: 'sign_in',
};

const PAGE_OUT_OF_DATE = {
	title: 'Forge could not send that request',
	what: 'The server did not accept the request this page sent, which usually means the page is out of date.',
	todo: 'Reload the page and try again. Your prompt and settings are kept.',
	retry: 'never',
	action: 'reload',
};

const MODEL_LINK_UNREADABLE = {
	title: 'This tool could not read the model',
	what: 'The model file this tool was given is not one it can open.',
	todo: 'Open the model again from your gallery, then run the tool again.',
	retry: 'never',
	action: 'reload',
};

const LOST_JOB = {
	title: 'This job is no longer available',
	what: 'Forge no longer has a record of this job, so it cannot be checked or resumed.',
	todo: 'Start it again. Finished models are saved to your gallery automatically.',
	retry: 'now',
	action: 'retry',
};

const UNCONFIGURED = {
	title: 'Not available on this site right now',
	what: 'This engine or tool is switched off on this deployment.',
	todo: 'Use a different engine or tool. This one will come back when the team turns it on.',
	retry: 'never',
	action: 'switch_engine',
};

const SERVER_FAULT = {
	title: 'Something broke on our side',
	what: 'Forge hit an unexpected error. Nothing you did caused it.',
	todo: 'Try again in a minute. If it keeps happening, contact support and quote the reference below.',
	retry: 'wait',
	wait: 60,
	action: 'retry',
	reference: true,
};

const PAYMENT_RETRY = {
	title: 'That payment could not be used',
	what: 'The $THREE payment sent with this request could not be verified.',
	todo: 'Pay again to continue. Nothing was charged for this attempt.',
	retry: 'never',
	action: 'pay',
};

const NOT_FOUND = {
	title: 'That model is not available',
	what: 'This model does not exist any more, or it was never public.',
	todo: 'Check the link, or open a model from your gallery instead.',
	retry: 'never',
	action: 'reload',
};

// A tool that edits a finished model (optimize, stylize, split, ...) failed.
function toolFailed(tool) {
	return {
		title: `${tool} did not finish`,
		what: `The ${tool.toLowerCase()} engine could not finish this model. Your original model is unchanged.`,
		todo: 'Try again. If it fails twice, try a simpler model or a different tool.',
		retry: 'now',
		action: 'retry',
		reference: true,
	};
}

// The job started, but checking on it failed.
function toolLost(tool) {
	return {
		title: `Lost track of ${tool.toLowerCase()}`,
		what: `Forge could not get the status of this ${tool.toLowerCase()} job. Your original model is unchanged.`,
		todo: 'Wait a moment and run the tool again.',
		retry: 'wait',
		wait: 15,
		action: 'retry',
		reference: true,
	};
}

function badInput(title, what, todo) {
	return { title, what, todo, retry: 'never', action: 'edit_input' };
}

// ── The map ─────────────────────────────────────────────────────────────────

export const FORGE_ERROR_COPY = Object.freeze({
	// Account, access and payment
	sign_in_required: SIGN_IN,
	missing_credentials: SIGN_IN,
	unauthorized: SIGN_IN,
	invalid_api_key: {
		title: 'That API key was not accepted',
		what: 'The three.ws API key sent with this request is not valid.',
		todo: 'Create a new key on your account page, or sign in and use Forge in the browser.',
		retry: 'never',
		action: 'sign_in',
	},
	insufficient_scope: {
		title: 'This key cannot do that',
		what: 'The API key used here does not have permission for this action.',
		todo: 'Create a key with the needed permission on your account page, or sign in instead.',
		retry: 'never',
		action: 'sign_in',
	},
	three_hold_required: {
		title: 'High quality is a $THREE holder perk',
		what: 'High-quality generation is open to $THREE holders or as a pay-per-use.',
		todo: 'Hold $THREE, pay for this one generation, or switch to Draft or Standard.',
		retry: 'never',
		action: 'pay',
	},
	insufficient_credits: {
		title: 'Not enough credits',
		what: 'The account paying for this generation does not have enough credit left.',
		todo: 'Top up your credits, or switch to a free engine or a lower quality.',
		retry: 'never',
		action: 'pay',
	},
	payment_invalid: PAYMENT_RETRY,
	payment_expired: {
		...PAYMENT_RETRY,
		what: 'The $THREE payment sent with this request has expired.',
	},
	payment_already_used: {
		...PAYMENT_RETRY,
		what: 'That $THREE payment was already used for another generation.',
	},
	needs_key: {
		title: 'This engine needs your API key',
		what: 'The engine you picked runs on your own account with its provider.',
		todo: 'Add your key for that provider, or switch to a free engine.',
		retry: 'never',
		action: 'add_key',
	},
	invalid_key: {
		title: 'Your API key was rejected',
		what: 'The provider did not accept the API key you added.',
		todo: 'Check the key, paste it again, or switch to a free engine.',
		retry: 'never',
		action: 'add_key',
	},
	billing: {
		title: 'Generation is paused',
		what: 'A provider Forge relies on is not taking new work from us right now.',
		todo: 'Try again in a few minutes, or switch to another engine.',
		retry: 'wait',
		wait: 120,
		action: 'switch_engine',
	},

	// Limits and capacity
	rate_limited: {
		title: 'Slow down for a moment',
		what: 'You have sent more requests than Forge can take right now.',
		todo: 'Wait {wait} and try again. Your prompt and settings are kept.',
		retry: 'wait',
		wait: 10,
		action: 'retry',
	},
	rate_limited_queued: {
		title: 'You are in line',
		what: 'Your generation is waiting behind a few others for the image step.',
		todo: 'Forge picks it up in {wait}. Keep this page open.',
		retry: 'wait',
		wait: 45,
		action: 'retry',
	},
	rate_limiter_unavailable: {
		title: 'Generation is briefly unavailable',
		what: 'The service that keeps generation fair is down, so Forge is not starting new paid jobs.',
		todo: 'Try again in {wait}. You can keep refining the model on screen meanwhile.',
		retry: 'wait',
		wait: 30,
		action: 'retry',
	},
	daily_limit_reached: {
		title: 'Daily limit reached',
		what: 'You have used all of today’s generations on this account.',
		todo: 'The limit resets {reset}. Finished models stay in your gallery meanwhile.',
		retry: 'wait',
		action: 'retry',
	},
	provider_busy: {
		title: 'The free engines are busy',
		what: 'The free 3D engines are at capacity right now. This is demand, not your quota.',
		todo: 'Forge retries in {wait}, or you can switch to another engine now.',
		retry: 'wait',
		wait: 30,
		action: 'switch_engine',
	},
	free_lane_unavailable: {
		title: 'The free engines are busy',
		what: 'Every free 3D engine is briefly unavailable.',
		todo: 'Forge retries in {wait}, or you can switch to another engine now.',
		retry: 'wait',
		wait: 15,
		action: 'switch_engine',
	},
	busy: {
		title: 'The engine is busy',
		what: 'The engine for this edit is working on other jobs.',
		todo: 'Try again in {wait}.',
		retry: 'wait',
		wait: 20,
		action: 'retry',
	},
	lane_unavailable: {
		title: 'This engine is unavailable',
		what: 'The engine you picked cannot take new jobs right now.',
		todo: 'Switch to another engine, or try again in {wait}.',
		retry: 'wait',
		wait: 30,
		action: 'switch_engine',
	},
	generation_unavailable: {
		title: 'Generation is briefly unavailable',
		what: 'No engine can take this generation right now.',
		todo: 'Try again in {wait}. Your prompt and settings are kept.',
		retry: 'wait',
		wait: 30,
		action: 'retry',
	},
	provider_unreachable: {
		title: 'Could not reach the image engine',
		what: 'The service that paints the reference image did not answer.',
		todo: 'Try again in {wait}, or upload a photo to skip the image step.',
		retry: 'wait',
		wait: 30,
		action: 'retry',
	},
	idempotency_in_progress: {
		title: 'Already working on it',
		what: 'This exact request is already running.',
		todo: 'Wait {wait} for it to finish rather than sending it again.',
		retry: 'wait',
		wait: 5,
		action: 'retry',
	},
	timeout: {
		title: 'That took too long',
		what: 'The engine did not answer in time. Your original model is unchanged.',
		todo: 'Try again. Shorter instructions finish faster.',
		retry: 'now',
		action: 'retry',
	},

	// Infrastructure failures: ours, not the user's.
	storage_unavailable: {
		title: 'Generation is paused',
		what: 'Our model storage is recovering, so Forge cannot save new models or photos right now.',
		todo: 'Try again in {wait}. Models already made still open from the gallery.',
		retry: 'wait',
		wait: 60,
		action: 'retry',
	},
	store_unavailable: {
		title: 'Could not save that right now',
		what: 'Our storage did not accept the request.',
		todo: 'Try again in a minute. Nothing was changed.',
		retry: 'wait',
		wait: 60,
		action: 'retry',
	},
	service_unavailable: {
		title: 'Forge is briefly unavailable',
		what: 'A service Forge depends on is recovering.',
		todo: 'Try again in {wait}. Nothing you did caused this.',
		retry: 'wait',
		wait: 30,
		action: 'retry',
		reference: true,
	},
	db_unavailable: {
		title: 'Forge is briefly unavailable',
		what: 'The model library is recovering.',
		todo: 'Try again in {wait}.',
		retry: 'wait',
		wait: 30,
		action: 'retry',
	},
	presign_failed: {
		title: 'Upload could not start',
		what: 'Forge could not prepare a place to store your photo.',
		todo: 'Press Retry on the photo in a moment. The photo is kept, so there is no need to add it again.',
		retry: 'wait',
		wait: 15,
		action: 'retry',
		reference: true,
	},
	unconfigured: UNCONFIGURED,
	not_configured: UNCONFIGURED,
	backend_unconfigured: UNCONFIGURED,
	rig_unconfigured: { ...UNCONFIGURED, what: 'Auto-rigging is switched off on this deployment.', todo: 'Download the model and rig it in another tool for now.', action: 'contact' },
	nim_unconfigured: UNCONFIGURED,
	internal_error: SERVER_FAULT,
	forged_feed_error: { ...SERVER_FAULT, title: 'The model feed did not load', todo: 'Reload in a minute.' },
	llm_unavailable: {
		title: 'Prompt help is unavailable',
		what: 'The writing assistant that improves prompts is down right now.',
		todo: 'Generate with your prompt as written. It works without the assistant.',
		retry: 'never',
		action: 'edit_input',
	},
	llm_failed: {
		title: 'Prompt help did not finish',
		what: 'The writing assistant could not improve this prompt.',
		todo: 'Try again, or generate with your prompt as written.',
		retry: 'now',
		action: 'retry',
	},
	update_failed: {
		title: 'Could not save that change',
		what: 'The change did not save. Nothing was changed.',
		todo: 'Try again in a moment.',
		retry: 'wait',
		wait: 15,
		action: 'retry',
	},
	delete_failed: {
		title: 'Could not delete the model',
		what: 'The delete did not go through. The model is unchanged.',
		todo: 'Try again in a moment.',
		retry: 'wait',
		wait: 15,
		action: 'retry',
	},

	// Generation and engine failures
	generation_failed: {
		title: 'Generation did not finish',
		what: 'The 3D engine could not finish this model.',
		todo: 'Try again, or try a simpler single-subject prompt or a clearer photo.',
		retry: 'now',
		action: 'retry',
		reference: true,
	},
	provider_error: {
		title: 'The edit did not finish',
		what: 'The engine could not apply this edit. Your original model is unchanged.',
		todo: 'Try again, or reword the instruction more simply.',
		retry: 'now',
		action: 'retry',
		reference: true,
	},
	image_fetch_failed: {
		title: 'Could not open the image',
		what: 'Forge could not download the image it was given.',
		todo: 'Add the photo again, or try a different one.',
		retry: 'never',
		action: 'edit_input',
	},
	image_too_large: badInput('That image is too large', 'The image is bigger than the engine accepts.', 'Use a smaller photo (under 10 MB) and try again.'),
	nim_auth: { ...SERVER_FAULT, title: 'The engine refused the job', what: 'The NVIDIA engine did not accept our request.', todo: 'Switch to another engine, or try again later.', action: 'switch_engine' },
	nim_error: toolFailed('Generation'),
	nim_empty: toolFailed('Generation'),
	nim_bad_response: toolFailed('Generation'),
	nim_bad_artifact: toolFailed('Generation'),
	nim_no_artifact: toolFailed('Generation'),
	region_restricted: {
		title: 'Not available in your region',
		what: 'This engine’s model licence does not cover your region.',
		todo: 'Use the default engine, which works everywhere. Your prompt is kept.',
		retry: 'never',
		action: 'switch_engine',
	},
	unavailable_in_region: {
		title: 'Not available in your region',
		what: 'This tool’s model licence does not cover your region.',
		todo: 'Use another tool. Your model is unchanged.',
		retry: 'never',
		action: 'switch_engine',
	},
	image_not_usable: {
		title: 'That photo may not work well',
		what: 'The photo check thinks this image will not make a good 3D model.',
		todo: 'Try one clear photo of a single object on a plain background, or press Generate anyway.',
		retry: 'never',
		action: 'edit_input',
	},
	backend_text_only: badInput('This engine works from text', 'The engine you picked makes models from a text prompt, not from a photo.', 'Remove the photo, or switch to a photo engine.'),
	backend_image_only: badInput('This engine needs a photo', 'The engine you picked builds models from a reference image.', 'Add a photo, or switch to a text engine.'),
	missing_sketch: badInput('Add your sketch', 'Sketch to 3D needs a drawing to work from.', 'Upload a drawing, then generate again.'),
	invalid_prompt: {
		...badInput('Check your prompt', 'The prompt is empty or too long for this engine.', 'Describe one subject in up to 1000 characters.'),
		serverDetail: true,
	},
	no_prompt: badInput('Add a prompt', 'There is no prompt to work from.', 'Describe what you want to make, then try again.'),
	prompt_too_short: badInput('Add a few more words', 'The prompt is too short to improve.', 'Write at least a few words about the subject.'),
	missing_instruction: badInput('Say what to change', 'There is no instruction for this edit.', 'Describe the change you want, then try again.'),
	instruction_too_long: badInput('Shorten the instruction', 'The edit instruction is longer than the engine accepts.', 'Keep it under 500 characters.'),
	invalid_options: {
		...badInput('Check your settings', 'One of the advanced settings has a value this engine does not accept.', 'Reset the advanced settings, or pick another value.'),
		serverDetail: true,
	},
	invalid_seed: badInput('Check the seed', 'The seed must be a whole number of zero or more.', 'Enter a different seed or clear the field.'),
	invalid_image: badInput('Check the image', 'That image could not be used.', 'Use a PNG, JPEG or WebP photo and try again.'),
	bad_image: badInput('Check the image', 'That image could not be used.', 'Use a PNG, JPEG or WebP photo and try again.'),
	no_image: badInput('Add a photo', 'This engine needs a photo to work from.', 'Add a photo, then try again.'),
	invalid_content_type: badInput('That file type is not supported', 'Forge accepts PNG, JPEG and WebP images.', 'Save the image in one of those formats and add it again.'),
	invalid_size: badInput('That file is too large', 'The photo is bigger than Forge accepts.', 'Use a photo under 8 MB and add it again.'),
	payload_too_large: badInput('That file is too large', 'The upload is bigger than Forge accepts.', 'Use a smaller file and try again.'),
	// A photo pasted as a link (POST /api/forge-upload { source_url }).
	url_blocked: badInput('That link cannot be opened', 'Forge only fetches public http or https addresses.', 'Save the image to your device and add it from there.'),
	url_unreachable: {
		title: 'Could not fetch that link',
		what: 'The site did not send an image back.',
		todo: 'Check the link opens in your browser, or save the image and add it from there.',
		retry: 'now',
		action: 'retry',
	},
	url_not_image: badInput('That link is not an image', 'Forge found no photo at that address.', 'Copy the image address itself (right-click the picture), or save the picture and add it.'),
	url_too_large: badInput('That image is too large to fetch', 'Forge fetches images up to 25 MB from a link.', 'Save it to your device and add it from there; large photos are shrunk for you.'),
	model_too_large: badInput('That model is too large to export', 'The model is bigger than this export accepts.', 'Optimize the model first to reduce its size, then export again.'),
	unsupported_mesh_format: MODEL_LINK_UNREADABLE,
	invalid_mesh_url: MODEL_LINK_UNREADABLE,
	invalid_glb_url: MODEL_LINK_UNREADABLE,
	model_unavailable: { ...MODEL_LINK_UNREADABLE, title: 'Could not open the model', what: 'Forge could not download this model to export it.', retry: 'now', action: 'retry' },
	invalid_image_url: {
		title: 'Could not use that photo',
		what: 'The photo link this request used is not one Forge can open.',
		todo: 'Add the photo again, then retry.',
		retry: 'never',
		action: 'edit_input',
	},
	invalid_image_urls: {
		title: 'Could not use those photos',
		what: 'One or more photo links in this request are not ones Forge can open.',
		todo: 'Remove the photos and add them again, then retry.',
		retry: 'never',
		action: 'edit_input',
	},
	bad_image_url: {
		title: 'Could not use that photo',
		what: 'The photo link is not one Forge can open.',
		todo: 'Add the photo again, then retry.',
		retry: 'never',
		action: 'edit_input',
	},
	invalid_view_labels: badInput('Check the photo angles', 'The angle labels do not match the photos added.', 'Set one angle per photo, or clear the labels.'),
	invalid_fill_other_sides: badInput('Use one photo for this option', 'Filling in the other sides works from a single photo.', 'Keep one photo, or turn that option off.'),
	blocked_by_safety_review: {
		title: 'This model cannot be shared',
		what: 'This model did not pass our content review, so it cannot be public or shared by link.',
		todo: 'Keep it private. If you think this is a mistake, contact support with the model link.',
		retry: 'never',
		action: 'contact',
	},
	rejected: badInput('Comment not posted', 'That comment did not pass our content checks.', 'Edit the comment and post it again.'),

	// Editing tools on a finished model
	remesh_failed: toolFailed('Optimize'),
	remesh_status_failed: toolLost('Optimize'),
	stylize_failed: toolFailed('Stylize'),
	stylize_status_failed: toolLost('Stylize'),
	segment_failed: toolFailed('Split into parts'),
	segment_status_failed: toolLost('Split into parts'),
	holopart_failed: toolFailed('Part completion'),
	holopart_status_failed: toolLost('Part completion'),
	rembg_failed: toolFailed('Background removal'),
	rembg_status_failed: toolLost('Background removal'),
	triposplat_failed: toolFailed('Splat'),
	triposplat_status_failed: toolLost('Splat'),
	sam3d_failed: toolFailed('Scene objects'),
	sam3d_status_failed: toolLost('Scene objects'),
	detect_failed: toolFailed('Object detection'),
	motion_failed: toolFailed('Motion'),
	rig_failed: toolFailed('Auto-rig'),
	gameready_failed: toolFailed('Game-ready'),
	no_objects_found: badInput('No objects found', 'The scene tool did not find separate objects in this image.', 'Try an image with clearly separated objects, or draw boxes around them.'),
	ambiguous_objects: badInput('Pick the objects', 'The tool found more objects than it can tell apart.', 'Draw a box around each object you want, then run it again.'),
	too_many_objects: badInput('Too many objects', 'This request asks for more objects than the tool handles at once.', 'Pick fewer objects and run it again.'),
	invalid_boxes: badInput('Check the boxes', 'One of the boxes drawn on the image is not valid.', 'Redraw the boxes, then run it again.'),
	invalid_max_objects: badInput('Check the object count', 'The number of objects to find is out of range.', 'Pick a number between 1 and 12.'),
	invalid_num_gaussians: badInput('Check the detail level', 'The splat detail setting is out of range.', 'Pick one of the listed detail levels.'),
	invalid_formats: badInput('Pick export formats', 'One of the chosen export formats is not supported.', 'Choose from the formats listed, then export again.'),

	// Jobs, batches and handles
	invalid_job: LOST_JOB,
	missing_job: LOST_JOB,
	batch_not_found: { ...LOST_JOB, title: 'This batch is no longer available', what: 'Forge no longer has a record of this batch.' },
	missing_batch: PAGE_OUT_OF_DATE,
	missing_items: badInput('Add prompts to the batch', 'The batch has nothing in it.', 'Add at least one prompt, then start the batch.'),
	too_many_items: badInput('Too many prompts', 'The batch has more prompts than one run accepts.', 'Split it into smaller batches of up to 8.'),
	invalid_item: badInput('Check the batch', 'One of the prompts in this batch is empty or too long.', 'Fix or remove that prompt, then start the batch again.'),
	invalid_progress_id: PAGE_OUT_OF_DATE,
	idempotency_key_reused: PAGE_OUT_OF_DATE,
	invalid_idempotency_key: PAGE_OUT_OF_DATE,

	// Models, gallery and sharing
	not_found: NOT_FOUND,
	creation_not_found: NOT_FOUND,
	model_not_found: NOT_FOUND,
	not_votable: { ...NOT_FOUND, title: 'Voting is closed for this model', what: 'This model is not part of a vote right now.', todo: 'Browse the current entries instead.' },
	no_event: { ...NOT_FOUND, title: 'No event right now', what: 'There is no Forge event running at the moment.', todo: 'Check back later, or keep making models in the meantime.' },
	unknown_event: { ...NOT_FOUND, title: 'That event does not exist', what: 'Forge has no event with this name.', todo: 'Open the events list and pick one from there.' },
	unknown_feature: PAGE_OUT_OF_DATE,
	no_client_id: PAGE_OUT_OF_DATE,
	invalid_creation: PAGE_OUT_OF_DATE,
	invalid_visibility: PAGE_OUT_OF_DATE,
	invalid_tags: badInput('Check the tags', 'One of the tags is too long or uses characters Forge does not allow.', 'Use short tags of letters, numbers and dashes.'),
	invalid_category: PAGE_OUT_OF_DATE,
	invalid_day: PAGE_OUT_OF_DATE,
	invalid_event: PAGE_OUT_OF_DATE,
	invalid_slug: PAGE_OUT_OF_DATE,
	invalid_world: PAGE_OUT_OF_DATE,
	invalid_backend: { ...PAGE_OUT_OF_DATE, what: 'The engine this page asked for does not exist any more.' },
	invalid_tier: PAGE_OUT_OF_DATE,
	invalid_path: PAGE_OUT_OF_DATE,
	invalid_body: PAGE_OUT_OF_DATE,
	invalid_json: PAGE_OUT_OF_DATE,
	invalid_url: PAGE_OUT_OF_DATE,
	bad_request: PAGE_OUT_OF_DATE,
	validation_error: PAGE_OUT_OF_DATE,
	method_not_allowed: PAGE_OUT_OF_DATE,
	bad_action: PAGE_OUT_OF_DATE,
	bad_base_url: PAGE_OUT_OF_DATE,

	// Client-side conditions the page itself detects (no server code).
	network: {
		title: 'No connection',
		what: 'Your browser could not reach Forge.',
		todo: 'Check your connection, then try again. Your prompt and settings are kept.',
		retry: 'now',
		action: 'retry',
	},
	upload_rejected: {
		title: 'Upload did not finish',
		what: 'The photo did not reach our storage. The connection may have dropped, or storage turned it away.',
		todo: 'Press Retry on the photo. The photo is kept, so there is no need to add it again.',
		retry: 'wait',
		wait: 15,
		action: 'retry',
		reference: true,
	},
	upload_timeout: {
		title: 'Upload timed out',
		what: 'The photo was still uploading after two minutes, so Forge stopped waiting.',
		todo: 'Press Retry on the photo, ideally on a faster connection. The photo is kept.',
		retry: 'now',
		action: 'retry',
	},
	download_failed: {
		title: 'Download did not start',
		what: 'Forge could not prepare the file for download.',
		todo: 'Try again. If it keeps failing, open the model and use your browser to save it.',
		retry: 'now',
		action: 'retry',
	},
});

// The answer for a code this map has never seen: honest that we do not know
// what it means, still actionable, and carrying a reference support can trace.
export const UNKNOWN_ERROR = Object.freeze({
	title: 'Something went wrong',
	what: 'Forge hit an error it does not have a description for yet.',
	todo: 'Try again. If it keeps happening, contact support and quote the reference below.',
	retry: 'now',
	action: 'retry',
	reference: true,
});

// ── Safety screen for any server-provided text ──────────────────────────────

const UNSAFE_TEXT = [
	/https?:\/\//i, // any URL
	/\bwww\./i,
	/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|app|dev|run|cloud|internal|local|co|xyz|ws)\b/i, // hostnames
	/\b(?:\d{1,3}\.){3}\d{1,3}\b/, // IPv4
	/\bat\s+[\w.$<>]+\s*\(.*:\d+:\d+\)/, // JS stack frame
	/\bat\s+\S+:\d+:\d+/, // bare stack frame
	/Traceback \(most recent call last\)/i,
	/\b(?:Error|Exception):\s/, // "TypeError: ...", "RuntimeError: ..."
	/\bE[A-Z]{3,}\b/, // ECONNREFUSED, ENOTFOUND, ETIMEDOUT
	/\b(?:sk|pk|rk|hf|nvapi|r8|xai|AIza)[-_][A-Za-z0-9_-]{8,}/, // provider key prefixes
	/\b(?:api[_-]?key|token|secret|password|bearer|authorization)\b\s*[:=]/i,
	/[A-Za-z0-9+/_-]{32,}/, // long opaque ids and secrets
	/[{}<>[\]`]/, // JSON, HTML, code
	/\b(?:replicate|meshy|tripo|rodin|hyper3d|fal|nvidia|nim|nvcf|hugging\s?face|hf space|gradio|openrouter|openai|vertex|gemini|pollinations|cuda|torch|python|node_modules|stack)\b/i, // vendor and runtime names
];

/**
 * Whether a piece of server-provided text is safe to show a person. False for
 * anything carrying a URL, hostname, IP, stack frame, exception name, key-like
 * token, markup, or a vendor or runtime name.
 */
export function isSafeServerText(text) {
	if (typeof text !== 'string') return false;
	const t = text.trim();
	if (!t || t.length > 240) return false;
	return !UNSAFE_TEXT.some((re) => re.test(t));
}

// The poll's `status: 'failed'` carries a sentence the server already masked
// (api/_lib/provider-job-error.js). Show it only if it still passes the screen,
// so a future path that forgets to mask cannot leak provider text.
export function safeJobErrorText(text) {
	return isSafeServerText(text) ? text.trim() : null;
}

// ── Building the user-facing answer ─────────────────────────────────────────

function humanWait(seconds) {
	const s = Math.max(1, Math.round(seconds));
	if (s < 60) return `about ${s} second${s === 1 ? '' : 's'}`;
	const m = Math.round(s / 60);
	if (m < 60) return `about ${m} minute${m === 1 ? '' : 's'}`;
	const h = Math.round(m / 60);
	return `about ${h} hour${h === 1 ? '' : 's'}`;
}

function humanReset(resetAt, seconds) {
	const at = resetAt ? new Date(resetAt) : null;
	if (at && !Number.isNaN(at.getTime())) {
		const hh = String(at.getUTCHours()).padStart(2, '0');
		const mm = String(at.getUTCMinutes()).padStart(2, '0');
		const rel = seconds > 0 ? ` (in ${humanWait(seconds)})` : '';
		return `at ${hh}:${mm} UTC${rel}`;
	}
	return seconds > 0 ? `in ${humanWait(seconds)}` : 'at midnight UTC';
}

function utcStamp(now) {
	const d = new Date(now);
	return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

// The status codes that mean a fault on our side when no code came with them.
function fallbackCodeForStatus(status) {
	if (status === 401) return 'sign_in_required';
	if (status === 429) return 'rate_limited';
	if (status === 503) return 'service_unavailable';
	if (status >= 500) return 'internal_error';
	return null;
}

function cleanCode(code) {
	return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : null;
}

/**
 * Turn a failed Forge response into what the user is told.
 * @param {{ status?: number, body?: object, retryAfter?: number, now?: number }} input
 *   status      HTTP status (0 for a network failure)
 *   body        parsed JSON body ({} when it was not JSON)
 *   retryAfter  seconds, when the caller read it from a header
 * @returns {{ code: string|null, known: boolean, title: string, what: string,
 *   todo: string, message: string, retry: 'now'|'wait'|'never',
 *   retryAfter: number|null, action: string, reference: string,
 *   showReference: boolean, keepsInput: true }}
 */
export function describeForgeError({ status = 0, body = {}, retryAfter, now = Date.now() } = {}) {
	const data = body && typeof body === 'object' ? body : {};
	let code = cleanCode(data.error);
	// A 429 carries two refinements the server flags rather than coding.
	if (code === 'rate_limited' && data.reason === 'rate_limiter_unavailable') code = 'rate_limiter_unavailable';
	else if (code === 'rate_limited' && data.queued) code = 'rate_limited_queued';
	if (!code && status === 0) code = 'network';
	const lookup = code && Object.hasOwn(FORGE_ERROR_COPY, code) ? code : !code ? fallbackCodeForStatus(status) : null;
	const entry = lookup ? FORGE_ERROR_COPY[lookup] : UNKNOWN_ERROR;
	const known = Boolean(lookup) && (code === lookup || !code);

	const serverWait = Number(data.retry_after);
	const wait =
		serverWait > 0 ? Math.ceil(serverWait) : Number(retryAfter) > 0 ? Math.ceil(Number(retryAfter)) : entry.wait || null;

	const fill = (s) =>
		s.replace('{wait}', humanWait(wait || 30)).replace('{reset}', humanReset(data.reset_at, wait || 0));
	const what = fill(entry.what);
	let todo = fill(entry.todo);
	if (entry.serverDetail && isSafeServerText(data.message)) todo = `${data.message.trim()} ${todo}`;

	const ref = typeof data.ref === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(data.ref) ? data.ref : null;
	const reference = ref || `${code || 'unknown'}/${status || 'offline'} at ${utcStamp(now)}`;
	const showReference = Boolean(entry.reference || ref || !known);
	const message = showReference ? `${what} ${todo} Reference: ${reference}.` : `${what} ${todo}`;

	return {
		code,
		known,
		title: entry.title,
		what,
		todo,
		message,
		retry: entry.retry,
		retryAfter: entry.retry === 'wait' ? wait || 30 : null,
		action: entry.action,
		reference,
		showReference,
		keepsInput: true,
		supportUrl: SUPPORT_URL,
	};
}

/**
 * An Error for a failed Forge response, carrying the descriptor. `message` is
 * the user-facing sentence pair, so any existing `showError(err.message)` path
 * shows map copy rather than the server's text.
 */
export function forgeErrorFromResponse(status, body, opts = {}) {
	const d = describeForgeError({ status, body, ...opts });
	const e = new Error(d.message);
	e.code = d.code;
	e.title = d.title;
	e.retryAfter = d.retryAfter;
	e.forge = d;
	return e;
}

/**
 * An Error for a job whose poll came back `status: 'failed'`. The sentence the
 * server sent is shown only when it passes the screen (the generation poll
 * masks it already; tool polls relay worker text and usually do not pass).
 * Otherwise the map copy for `code` is shown.
 */
export function forgeJobFailedError(text, code = 'generation_failed') {
	const d = describeForgeError({ status: 200, body: { error: code } });
	const safe = safeJobErrorText(text);
	const e = new Error(safe || d.message);
	e.code = code;
	e.title = d.title;
	e.retryAfter = null;
	e.forge = safe ? { ...d, what: safe, todo: '', message: safe } : d;
	return e;
}

// A photo slot is a small tile: it shows a short line, and the full sentence
// pair goes to screen readers (and to `detail` for any caller with room).
// Some generation titles read wrong on a photo, so uploads get their own.
const UPLOAD_SHORT = {
	storage_unavailable: 'Uploads paused. Try again soon.',
	unconfigured: 'Uploads are off on this site.',
	presign_failed: 'Upload did not start. Press Retry.',
	upload_rejected: 'Upload did not finish. Press Retry.',
	upload_timeout: 'Upload timed out. Press Retry.',
	payload_too_large: 'Too large to upload. Use a smaller photo.',
	network: 'No connection. Press Retry when back online.',
	rate_limited: 'Too many uploads. Wait a moment.',
};

/** What a failed photo upload says. Status 0 means the request never left. */
export function forgeUploadFailure(status, body = {}) {
	const d = describeForgeError({ status, body });
	const key = d.code && Object.hasOwn(UPLOAD_SHORT, d.code) ? d.code : status === 503 ? 'storage_unavailable' : null;
	announceForgeError(d.title, d.message);
	return { ok: false, message: key ? UPLOAD_SHORT[key] : d.title, detail: d.message, error: d };
}

/** An Error whose message is our own copy (a timeout, a client-side check). */
export function forgeCopyError(title, message) {
	const e = new Error(message);
	e.title = title;
	e.userFacing = true;
	return e;
}

function isNetworkFailure(err) {
	return err?.name === 'TypeError' && /fetch|network|load failed/i.test(String(err.message));
}

/**
 * What a catch block shows. Errors built here (from a response, a failed job,
 * or forgeCopyError) carry copy and are shown as they are. A fetch that never
 * reached the server gets the connection copy. Anything else is a fault in the
 * page, and the person gets the map copy for `code`, never the runtime text.
 */
export function forgeErrorMessage(err, code = 'internal_error') {
	return forgeErrorDescriptor(err, code).message;
}

export function forgeErrorDescriptor(err, code = 'internal_error') {
	if (err?.forge) return err.forge;
	if (err?.userFacing) return { title: err.title, message: err.message, retry: 'now', action: 'retry' };
	if (isNetworkFailure(err)) return describeForgeError({ status: 0 });
	return describeForgeError({ status: 200, body: { error: code } });
}

// ── Screen-reader announcement ──────────────────────────────────────────────
// The error panel is revealed by toggling a class, which assistive tech does
// not reliably announce. One shared, visually hidden alert region does.

let liveRegion = null;

export function announceForgeError(title, message) {
	if (typeof document === 'undefined') return;
	if (!liveRegion || !liveRegion.isConnected) {
		liveRegion = document.createElement('div');
		liveRegion.setAttribute('role', 'alert');
		liveRegion.setAttribute('aria-live', 'assertive');
		liveRegion.setAttribute('aria-atomic', 'true');
		liveRegion.className = 'forge-sr-alert';
		liveRegion.style.cssText =
			'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;';
		document.body.appendChild(liveRegion);
	}
	// Clear first so the same message twice in a row is announced twice.
	liveRegion.textContent = '';
	const text = [title, message].filter(Boolean).join('. ');
	requestAnimationFrame(() => {
		liveRegion.textContent = text;
	});
}
