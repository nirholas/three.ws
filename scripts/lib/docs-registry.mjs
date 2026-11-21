// Which docs/*.md articles production serves at /docs/<slug> but data/pages.json
// does not declare. Used by scripts/audit-docs.mjs.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * docs/*.md paths git ignores in `root`. Production builds from a clean git
 * worktree, so an ignored doc (a local note) is never served. Outside a git
 * checkout nothing counts as ignored.
 */
export function gitIgnoredDocs(root) {
	try {
		const out = execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'docs/*.md'], { cwd: root, encoding: 'utf8' });
		return new Set(out.split('\n').filter(Boolean));
	} catch {
		return new Set();
	}
}

/** Slugs of served docs with no /docs/<slug> entry and no recorded reason to stay unpublished. */
export function unregisteredDocs(root, { declaredPages, skip = new Set(), ignored = gitIgnoredDocs(root) }) {
	const slugs = [];
	for (const entry of readdirSync(join(root, 'docs'), { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
		const slug = entry.name.replace(/\.md$/, '');
		if (skip.has(slug) || ignored.has(`docs/${entry.name}`)) continue;
		if (declaredPages.has(`/docs/${slug}`)) continue;
		slugs.push(slug);
	}
	return slugs;
}
