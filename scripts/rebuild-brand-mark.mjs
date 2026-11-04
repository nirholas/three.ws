// Re-encode the two raster layers inside public/brand/three-full.svg at exactly
// half resolution (lanczos3, 256-colour palette at quality 90) and write the result to
// public/three.svg. Safe to rerun: the full-resolution original is the input,
// so output never compounds loss. public/favicon.svg stays the full original
// (it is the 192 px and larger mark).
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const src = readFileSync(new URL('../public/brand/three-full.svg', import.meta.url), 'utf8');
const re = /data:image\/png;base64,([A-Za-z0-9+/=]+)/g;
const parts = [...src.matchAll(re)];
let out = src;
for (const m of parts) {
	const input = Buffer.from(m[1], 'base64');
	const meta = await sharp(input).metadata();
	const resized = () =>
		sharp(input).resize(Math.round(meta.width / 2), Math.round(meta.height / 2), { kernel: 'lanczos3' });
	// PNG only: librsvg, social scrapers and older Safari cannot decode a WebP
	// inside an SVG. The source layers are already low-entropy; a 256-colour palette at quality 90 measures a max channel delta of 5 at 22 px and 24 at 64 px (one anti-aliased edge pixel) at the sizes this file renders (<= 64 px).
	const half = await resized().png({ compressionLevel: 9, adaptiveFiltering: true, palette: true, colours: 256, quality: 90, effort: 10, dither: 0 }).toBuffer();
	const mime = 'image/png';
	out = out.replace(m[0], `data:${mime};base64,${half.toString('base64')}`);
}
writeFileSync(new URL('../public/three.svg', import.meta.url), out);
console.log(`three.svg ${src.length} -> ${out.length} bytes (${parts.length} layers)`);
