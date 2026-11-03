// Pick one extracted archive member by its path inside the archive.
//
// `paths` are absolute paths under `extractDir` (e.g. from `find`). A member
// matches when its archive-relative path equals `memberPath` or ends with
// `/<memberPath>`, so a pack can name `Unreal-Godot/UAL2_Standard.glb` without
// knowing the archive's top-level folder. Matching is anchored to the
// archive-relative path on purpose: the extract dir itself is often named
// after the target file, so a substring test on the absolute path matches
// every member.
export function findZipMember(paths, extractDir, memberPath) {
	const prefix = extractDir.replace(/\/+$/, '') + '/';
	const want = memberPath.replace(/^\/+/, '');
	for (const p of paths) {
		if (!p.startsWith(prefix)) continue;
		const rel = p.slice(prefix.length);
		if (rel === want || rel.endsWith('/' + want)) return p;
	}
	return null;
}
