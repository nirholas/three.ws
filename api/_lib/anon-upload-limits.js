// Per-prefix maximum object size for the anonymous presigned PUT handlers.
//
// presignUpload() cannot sign ContentLength (it would add content-length to the
// signed headers and break the browser CORS preflight), so the size a caller
// declares is only checked at presign time. api/cron/anon-upload-sweep.js
// enforces these ceilings after the fact. The handlers import their ceiling from
// here so the presign check and the sweeper can never disagree.
//
// print/uploads/ mirrors MAX_INPUT_BYTES in api/_lib/print/mesh-io.js (a test
// pins the two together; mesh-io is too heavy to import into a sweeper).

export const ANON_UPLOAD_LIMITS = Object.freeze({
	'capture/uploads/': 512 * 1024 * 1024,
	'scene/shares/': 200 * 1024 * 1024,
	'motion-swap/uploads/': 256 * 1024 * 1024,
	'forge/uploads/': 8 * 1024 * 1024,
	'print/uploads/': 100 * 1024 * 1024,
});
