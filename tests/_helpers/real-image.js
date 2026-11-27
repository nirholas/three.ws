// Real encoded images for tests of code that decodes what an image model
// returns (api/_lib/image-validate.js rejects anything that is not a decodable,
// sanely sized, non-blank image, so placeholder bytes like 'aGVsbG8=' no longer
// stand in for a model's output).
import sharp from 'sharp';

/**
 * Encode a test image and return it as base64.
 *   width/height  pixel size (default 512x512, the smallest realistic reference)
 *   flat          a single solid colour (what the validator calls blank)
 *   format        'png' | 'jpeg' | 'webp'
 */
export async function encodeTestImage({ width = 512, height = 512, flat = false, format = 'png' } = {}) {
	const raw = Buffer.alloc(width * height * 3);
	for (let i = 0; i < width * height; i++) {
		raw[i * 3] = flat ? 128 : Math.round(((i % width) * 255) / width);
		raw[i * 3 + 1] = flat ? 128 : Math.round((Math.floor(i / width) * 255) / height);
		raw[i * 3 + 2] = flat ? 128 : 90;
	}
	const img = sharp(raw, { raw: { width, height, channels: 3 } });
	const encoded = format === 'jpeg' ? img.jpeg() : format === 'webp' ? img.webp() : img.png();
	return (await encoded.toBuffer()).toString('base64');
}

// A usable 512px gradient PNG, the default "model answered with an image".
export const REAL_PNG_B64 = await encodeTestImage();
