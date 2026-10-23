// "Copy as GitHub README 3D": turns a model URL into a ```stl fence that
// GitHub renders as an interactive 3D viewer, via POST /api/readme-3d
// (packages/readme-3d does the decimation). Shared by the forge export menu,
// the avatar page, the model page and the /readme-3d page so every surface
// reports the same sizes and fails the same way.

const ENDPOINT = '/api/readme-3d';

export class Readme3dError extends Error {
	constructor(message, code = 'readme_3d_failed') {
		super(message);
		this.code = code;
	}
}

/** @returns {Promise<{ markdown: string, facets: number, sourceFacets: number, bytes: number, fitsGithub: boolean }>} */
export async function fetchReadme3d(modelUrl, { name, budget, details } = {}) {
	let absolute;
	try {
		absolute = new URL(modelUrl, location.href);
	} catch {
		throw new Readme3dError('this model has no usable URL', 'invalid_url');
	}
	if (absolute.protocol !== 'https:' && absolute.protocol !== 'http:') {
		throw new Readme3dError(
			'only a saved model can be converted: reset your mesh edits and try again',
			'unsaved_model',
		);
	}
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ url: absolute.href, name, budget, details }),
	});
	const data = await res.json().catch(() => ({}));
	if (res.status === 429) {
		throw new Readme3dError('too many conversions, wait a few minutes and retry', 'rate_limited');
	}
	if (!res.ok) {
		throw new Readme3dError(
			data.error_description || data.error || `the converter returned ${res.status}`,
			data.error || 'readme_3d_failed',
		);
	}
	return {
		markdown: data.markdown,
		facets: data.facets,
		sourceFacets: data.source_facets,
		bytes: data.bytes,
		fitsGithub: data.fits_github,
	};
}

function saveMarkdownFile(markdown, filename) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

/**
 * Convert and put the block on the clipboard. When the browser refuses the
 * clipboard (insecure context, or a gesture lost to the network wait), the
 * block is saved as a .md file instead, so the work is never thrown away.
 * @returns {Promise<{ delivery: 'clipboard' | 'file', facets: number, bytes: number, fitsGithub: boolean, markdown: string }>}
 */
export async function copyReadme3d(modelUrl, opts = {}) {
	const result = await fetchReadme3d(modelUrl, opts);
	let delivery = 'clipboard';
	try {
		await navigator.clipboard.writeText(result.markdown);
	} catch {
		delivery = 'file';
		saveMarkdownFile(result.markdown, `${opts.name || 'model'}-readme-3d.md`);
	}
	return { ...result, delivery };
}

export function describeResult(r) {
	const kb = Math.round(r.bytes / 1024);
	const where = r.delivery === 'file' ? 'saved as .md' : 'copied';
	return `${where} ✓ ${r.facets.toLocaleString()} facets, ${kb} KB`;
}
