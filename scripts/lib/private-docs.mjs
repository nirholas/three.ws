// The one rule for which parts of docs/ stay off the public website.
//
// docs/ lives in the public repo, but the build also republishes it three ways:
// vite's copy-static-docs plugin copies the tree into dist/docs (served at
// /docs/<path>), scripts/combine-docs.mjs concatenates it into /docs/ALL.md, and
// scripts/build-docs-search-index.mjs indexes headings, snippets and terms into
// /docs-search-index.json. All three must agree, so they all ask isPrivateDoc().
// Before this module each kept its own copy of the list and the search index
// kept none, so the security reviews and ops runbooks the copy step withheld
// were still searchable on the live site.
//
// Private means written for the operator, not the reader: runbooks naming the
// GCP project, service accounts and private Cloud Run URLs; security reviews
// describing attacks on live code; partner, prospect and fundraising material;
// unsent post and outreach drafts; agent work orders; internal research and
// benchmarks. These stay in the repo and off the website.

/** Whole subtrees of docs/ (first path segment, or a nested prefix). */
export const PRIVATE_DOC_DIRS = Object.freeze([
	'internal',
	'ops',
	'security',
	'partners',
	'fundraising',
	'event-readiness',
	'agent-tasks',
	'prompts',
	'agora/tasks',
	'x-posts',
	'x-archive',
	'marketing',
	'research',
	'github-benchmark',
	'x402-loop-breakdown',
	'forge-photo-prep',
	// Local, gitignored copy of a third party's copyrighted docs.
	'vendor',
]);

/** Individual files, relative to docs/. */
export const PRIVATE_DOC_FILES = Object.freeze([
	'money-map.md',
	'incident-response.md',
	'issue-resolution-2026-09-15.md',
	'grok-roadmap.md',
	'microsoft-marketplace-offer-plan.md',
	'oracle-trading-mcp-plan.md',
	'open-source-friday-plan.md',
	'openusd-export/bench-results.json',
]);

const FILES = new Set(PRIVATE_DOC_FILES);

/**
 * True when a path relative to docs/ (either separator) must not be published.
 * The empty path (docs/ itself) is public so tree copies can descend into it.
 * @param {string} rel
 */
export function isPrivateDoc(rel) {
	const p = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
	if (!p) return false;
	if (FILES.has(p)) return true;
	return PRIVATE_DOC_DIRS.some((dir) => p === dir || p.startsWith(`${dir}/`));
}
