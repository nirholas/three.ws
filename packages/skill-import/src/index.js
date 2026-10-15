// Top-level orchestrator: a URL in, a skill bundle out.
// See README.md and specs/SKILL_SPEC.md.

import { parseOpenApiDocument } from './openapi.js';
import { listOperations } from './operations.js';
import { generateTools } from './generate-tools.js';
import { generateHandlers } from './generate-handlers.js';
import { generateManifest } from './generate-manifest.js';
import { generateSkillMd } from './generate-skillmd.js';
import { generateDeclarativeBundle } from './declarative.js';
import { discoverGithubSource } from './github.js';
import { assertValidBundle } from './validate.js';

export { OpenApiParseError, parseOpenApiDocument, looksLikeOpenApi } from './openapi.js';
export { GithubDiscoveryError, parseGithubRepo, discoverGithubSource } from './github.js';
export { SkillBundleValidationError, validateBundle, assertValidBundle } from './validate.js';
export { listOperations } from './operations.js';
export { generateTools } from './generate-tools.js';
export { generateHandlers } from './generate-handlers.js';
export { generateManifest } from './generate-manifest.js';
export { generateSkillMd } from './generate-skillmd.js';
export { generateDeclarativeBundle } from './declarative.js';

function isGithubRepoUrl(url) {
	try {
		return /(^|\.)github\.com$/i.test(new URL(url).hostname);
	} catch {
		return false;
	}
}

async function buildOpenApiBundle(specText, sourceUrl) {
	const { document } = await parseOpenApiDocument(specText);
	const operations = listOperations(document);
	const tools = generateTools(operations);
	const { source: handlersSrc, secrets } = generateHandlers(operations, document, { sourceUrl });
	const manifest = generateManifest(document, operations, secrets, { sourceUrl });
	const skillMd = generateSkillMd(manifest, document, operations);
	assertValidBundle({ manifest, skillMd, tools, handlersSrc });
	return { manifest, skillMd, tools, handlersSrc, sourceUrl };
}

/**
 * Import a skill bundle from an OpenAPI/Swagger spec URL or a GitHub repo URL.
 *
 * @param {string} url
 * @param {{fetchUrl: typeof fetch, githubToken?: string}} opts
 *   `fetchUrl` must be a caller-supplied, SSRF-guarded fetch (the caller
 *   decides what "safe" means for its environment; this package never
 *   fetches with the bare global `fetch`).
 * @returns {Promise<{
 *   manifest: object, skillMd: string,
 *   tools: object | null, handlersSrc: string | null,
 *   sourceUrl: string,
 * }>}
 */
export async function importFromUrl(url, { fetchUrl, githubToken } = {}) {
	if (typeof fetchUrl !== 'function') throw new Error('importFromUrl requires opts.fetchUrl');

	if (isGithubRepoUrl(url)) {
		const discovered = await discoverGithubSource(url, { fetchUrl, githubToken });
		if (discovered.kind === 'openapi') {
			return buildOpenApiBundle(discovered.text, discovered.sourceUrl);
		}
		const { manifest, skillMd } = generateDeclarativeBundle({
			repoName: discovered.repoName,
			readmeText: discovered.text,
			sourceUrl: discovered.sourceUrl,
		});
		assertValidBundle({ manifest, skillMd });
		return { manifest, skillMd, tools: null, handlersSrc: null, sourceUrl: discovered.sourceUrl };
	}

	const res = await fetchUrl(url);
	if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
	const text = await res.text();
	return buildOpenApiBundle(text, url);
}
