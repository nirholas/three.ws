'use strict';

/**
 * Error model for the three.ws capture client. Every failure that reaches the
 * panel is an ApiError with a stable `code` and a `message` a visitor can act on.
 * Operator hints (`hint` in a C4 response) are never read, so they can never be shown.
 */

class ApiError extends Error {
	constructor(code, message, { status = 0, retryable = false, cause } = {}) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
		this.retryable = retryable;
		if (cause) this.cause = cause;
	}
}

/** Visitor wording for every code the C4 endpoints and the panel itself can raise. */
const MESSAGES = Object.freeze({
	sign_in_required: 'Your three.ws API key was not accepted. Paste a key from your dashboard and try again.',
	missing_key: 'Paste your three.ws API key first. You can create one for free from your dashboard.',
	invalid_json: 'three.ws could not read that request. Update the panel and try again.',
	invalid_filename: 'This file name is not supported. Use a name that ends in .insv, .insp, .mp4, .mov, .jpg or .png.',
	invalid_kind: 'three.ws did not recognise this kind of capture. Update the panel and try again.',
	invalid_content_type: 'This file type is not supported. Use a stitched 360 video or photo, or a raw .insv or .insp file.',
	invalid_size: 'Captures can be between 1 byte and 8 GiB.',
	invalid_part_numbers: 'The upload lost track of its parts. Start the upload again.',
	invalid_parts: 'Storage rejected one of the upload parts. Start the upload again.',
	too_many_open_uploads: 'You already have 3 uploads in progress. Wait for one to finish or cancel it, then try again.',
	daily_quota_exceeded: 'You have reached the daily capture upload limit of 32 GiB. Try again tomorrow.',
	create_failed: 'Storage did not start the upload. Try again in a moment.',
	upload_not_found: 'This upload expired. The panel will start it again from the beginning.',
	size_mismatch: 'The uploaded file did not arrive complete, so it was discarded. Upload it again.',
	storage_error: 'Storage could not complete that step. Try again in a moment.',
	unconfigured: 'Capture processing is not available right now. Try again later.',
	rate_limited: 'You are sending captures too quickly. Wait a minute and try again.',
	not_found: 'That capture no longer exists.',
	forbidden: 'That capture belongs to a different account.',
	unsupported_camera: 'This camera model is not supported yet. Export a stitched 360 video from your camera app and send that instead.',
	unsupported_input: 'This file could not be used. Export a stitched 360 video from your camera app and send that instead.',
	corrupt_input: 'This file could not be read. It may be damaged or still copying. Check the file and try again.',
	reconstruction_failed: 'There was not enough camera movement or overlap to build a 3D scene from this clip. Try a slower walk with more overlap.',
	reconstruction_quality: 'The scene did not reach the quality bar. Try a slower walk with more overlap and steady light.',
	too_many_active: 'You already have 2 captures processing. Wait for one to finish or cancel it, then send this one.',
	invalid_trim: 'The in and out points are not a usable range. Set an out point at least one second after the in point.',
	invalid_source_kind: 'three.ws did not recognise this kind of capture. Update the panel and try again.',
	invalid_source_url: 'three.ws could not read the uploaded file. Upload it again.',
	invalid_source_urls: 'three.ws could not read the uploaded files. Upload them again.',
	invalid_image_url: 'three.ws could not read the uploaded photo. Upload it again.',
	invalid_quality: 'That quality setting is not available. Choose Preview, Standard or High.',
	invalid_body: 'three.ws could not read that request. Update the panel and try again.',
	invalid_job: 'That capture id is not valid. Refresh your captures and try again.',
	stitch_failed: 'The two camera lenses could not be stitched. Export a stitched 360 file from your camera app and send that instead.',
	depth_failed: 'Depth could not be estimated for this photo. Try a different 360 photo.',
	worker_failed: 'The capture could not be processed. Try again, or send a different clip.',
	pano_scene_failed: 'The 360 photo could not be turned into a 3D scene. Try a different photo.',
	cancel_failed: 'The capture could not be cancelled. Try again in a moment.',
	cancelled: 'Cancelled.',
	offline: 'You are offline. Check your connection and try again.',
	timeout: 'The server took too long to answer. Try again in a moment.',
	job_failed: 'The capture could not be processed. Try again, or send a different clip.',
	unexpected_response: 'three.ws sent a reply the panel did not understand. Update the panel and try again.',
	no_selection: 'Select a clip in the Project panel, or choose a file.',
	not_360: 'This does not look like a 360 clip. Tick the box to confirm it is a stitched 360 video.',
	no_sequence: 'Open a sequence and place the playhead where the preview should go.',
	download_failed: 'A result file could not be downloaded. Try again in a moment.',
	import_failed: 'Premiere Pro could not import the downloaded files. They are saved in the folder shown below.',
});

const GENERIC = 'Something went wrong. Try again in a moment.';

function messageFor(code, serverMessage) {
	if (Object.hasOwn(MESSAGES, code)) return MESSAGES[code];
	if (typeof serverMessage === 'string' && serverMessage.trim() && serverMessage.length <= 300) {
		return serverMessage.trim();
	}
	return GENERIC;
}

function isRetryableStatus(status) {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Build an ApiError from an HTTP error response body (`{ error, message }`). */
function fromResponse(status, body) {
	let code = body && typeof body.error === 'string' ? body.error : '';
	if (!code) {
		if (status === 401 || status === 403) code = 'sign_in_required';
		else if (status === 404) code = 'not_found';
		else if (status === 429) code = 'rate_limited';
		else code = 'storage_error';
	}
	if (status === 401) code = 'sign_in_required';
	return new ApiError(code, messageFor(code, body && body.message), {
		status,
		retryable: isRetryableStatus(status) && code !== 'daily_quota_exceeded' && code !== 'too_many_open_uploads' && code !== 'too_many_active',
	});
}

/** Normalise anything thrown by fetch or host code into an ApiError. */
function normalise(err) {
	if (err instanceof ApiError) return err;
	const name = err && err.name;
	const text = String((err && err.message) || err || '');
	if (name === 'AbortError') return new ApiError('cancelled', MESSAGES.cancelled);
	if (name === 'TypeError' || /network|failed to fetch|ECONN|ENOTFOUND|timed? ?out/i.test(text)) {
		return new ApiError('offline', MESSAGES.offline, { retryable: true, cause: err });
	}
	return new ApiError('unexpected_error', GENERIC, { cause: err });
}

module.exports = { ApiError, MESSAGES, messageFor, fromResponse, normalise, isRetryableStatus };
