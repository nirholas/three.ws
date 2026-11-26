// Which docs/*.md articles production serves at /docs/<slug> but data/pages.json
// does not declare, and which declared /docs pages the build withholds. Used by
// scripts/audit-docs.mjs. Both ask isPrivateDoc(), the same rule the copy step
// uses, so the audit can never demand or accept a page production refuses to serve.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isPrivateDoc } from './private-docs.mjs';

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
		if (skip.has(slug) || ignored.has(`docs/${entry.name}`) || isPrivateDoc(entry.name)) continue;
		if (declaredPages.has(`/docs/${slug}`)) continue;
		slugs.push(slug);
	}
	return slugs;
}

/** Declared /docs/<slug> pages whose article is operator-only, so production answers 404. */
export function declaredPrivateDocs(declaredPages) {
	return [...declaredPages].filter((path) => {
		if (!path.startsWith('/docs/')) return false;
		const slug = path.slice('/docs/'.length).replace(/\/+$/, '');
		return Boolean(slug) && isPrivateDoc(`${slug}.md`);
	});
}
