// Codegen-free replacement for the two `ndarray-ops` functions the app reaches
// (via ndarray-pixels, used by glTF-Transform texture resizing and PNG/JPEG
// encode): `assign` and `assigns`.
//
// The real package builds its loops with `cwise`, which compiles source text
// through `Function(...)`. That needs 'unsafe-eval' in the page CSP. These
// loops do the same element-wise work over any ndarray (the `data`, `shape`,
// `stride`, `offset` contract) with plain typed-array indexing, so the site
// CSP can drop 'unsafe-eval'. vite.config.js aliases `ndarray-ops` here.

function walk(shape, visit) {
	const rank = shape.length;
	if (rank === 0) {
		visit([]);
		return;
	}
	const idx = new Array(rank).fill(0);
	for (let d = 0; d < rank; d++) if (shape[d] === 0) return;
	for (;;) {
		visit(idx);
		let d = rank - 1;
		while (d >= 0) {
			idx[d]++;
			if (idx[d] < shape[d]) break;
			idx[d] = 0;
			d--;
		}
		if (d < 0) return;
	}
}

function position(arr, idx) {
	let p = arr.offset;
	for (let d = 0; d < idx.length; d++) p += idx[d] * arr.stride[d];
	return p;
}

/** dst[i] = src[i] for every index of dst. Shapes must match. */
export function assign(dst, src) {
	if (dst.shape.length !== src.shape.length || dst.shape.some((n, d) => n !== src.shape[d])) {
		throw new Error('ndarray assign: shape mismatch');
	}
	walk(dst.shape, (idx) => {
		dst.data[position(dst, idx)] = src.data[position(src, idx)];
	});
	return dst;
}

/** dst[i] = value for every index of dst. */
export function assigns(dst, value) {
	walk(dst.shape, (idx) => {
		dst.data[position(dst, idx)] = value;
	});
	return dst;
}

export default { assign, assigns };
