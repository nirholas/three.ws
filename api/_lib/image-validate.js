// Validate a generated image before it becomes a 3D reconstruction input.
//
// A provider answering 200 is not proof of a usable image. A gateway can hand
// back an HTML error page as "image data", a model can return a thumbnail or a
// flat single-colour frame, and every one of those would be reconstructed into a
// broken mesh on the GPU, the most expensive step in the pipeline. This decodes
// the bytes and checks the three things a reference must have: it decodes as an
// image, its dimensions are sane, and it is not blank.
//
// Throws an error with code 'bad_image' (and a `reason`) so the caller falls
// through to its next lane exactly as it would for a provider failure.

// Gemini image models answer 1024px today; anything under this cannot carry the
// detail a reconstructor needs, anything over the upper bound is not a reference.
const MIN_SIDE = 256;
const MAX_SIDE = 8192;
// Per-channel standard deviation below this on every channel is a flat frame
// (solid colour, all black, all white). A real studio photo on a plain sweep
// still has a subject, so its spread is far higher.
const BLANK_STDEV = 2;

function badImage(reason, detail) {
	return Object.assign(new Error(`generated image rejected: ${detail}`), { code: 'bad_image', reason });
}

/**
 * Decode and sanity-check base64 image bytes. Resolves { width, height, format }
 * for a usable image, throws a 'bad_image' error otherwise.
 */
export async function validateGeneratedImage(b64) {
	const bytes = Buffer.from(String(b64 || ''), 'base64');
	if (bytes.length < 64) throw badImage('empty', `only ${bytes.length} bytes`);
	const { default: sharp } = await import('sharp');
	let meta;
	let stats;
	try {
		const img = sharp(bytes, { failOn: 'error' });
		meta = await img.metadata();
		stats = await img.stats();
	} catch (err) {
		throw badImage('undecodable', `does not decode as an image (${err?.message || err})`);
	}
	const { width = 0, height = 0, format } = meta;
	if (Math.min(width, height) < MIN_SIDE || Math.max(width, height) > MAX_SIDE) {
		throw badImage('dimensions', `${width}x${height} is outside ${MIN_SIDE}-${MAX_SIDE}px`);
	}
	const colour = stats.channels.slice(0, Math.min(3, stats.channels.length));
	if (colour.every((c) => c.stdev < BLANK_STDEV)) {
		throw badImage('blank', `${width}x${height} frame is a single flat colour`);
	}
	return { width, height, format };
}
