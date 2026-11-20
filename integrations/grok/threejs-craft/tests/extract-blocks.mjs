// Pulls every fenced code block out of the plugin's SKILL.md files so the
// verifier can run them. Zero dependencies on purpose: the plugin's own
// `node --test` suite and the three.ws browser harness both import it.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// A JS block whose first non-empty line starts with this marker is an
// excerpt that continues a block above it or needs the reader's own scene,
// and is not run on its own. The text after the colon says why.
export const PARTIAL_MARKER = '// partial:';

// Shell blocks the verifier executes: every command line runs the pinned
// glTF Transform CLI, so the commands a skill teaches produce the files its
// JS blocks then load.
export const GLTF_TRANSFORM_PREFIX = 'npx @gltf-transform/cli@';

const JS_LANGS = new Set(['js', 'javascript', 'mjs']);
const SHELL_LANGS = new Set(['bash', 'sh', 'shell']);

export function extractBlocks(markdown) {
	const lines = markdown.split('\n');
	const blocks = [];
	let open = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const fence = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
		if (!open) {
			if (fence) open = { fence: fence[2], lang: fence[3].trim().split(/\s+/)[0].toLowerCase(), start: i + 1, body: [] };
			continue;
		}
		if (fence && fence[2].startsWith(open.fence[0]) && fence[2].length >= open.fence.length && fence[3].trim() === '') {
			blocks.push(classify({ lang: open.lang, code: open.body.join('\n'), line: open.start }));
			open = null;
			continue;
		}
		open.body.push(line);
	}
	if (open) throw new Error(`unclosed code fence opened at line ${open.start}`);
	return blocks.map((b, index) => ({ ...b, index }));
}

function classify(block) {
	const firstLine = block.code.split('\n').find((l) => l.trim() !== '') ?? '';
	if (JS_LANGS.has(block.lang)) {
		const partial = firstLine.trim().startsWith(PARTIAL_MARKER);
		return {
			...block,
			kind: 'js',
			partial,
			partialReason: partial ? firstLine.trim().slice(PARTIAL_MARKER.length).trim() : null,
		};
	}
	if (SHELL_LANGS.has(block.lang)) {
		const commands = block.code
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l && !l.startsWith('#'));
		const runnable = commands.length > 0 && commands.every((c) => c.startsWith(GLTF_TRANSFORM_PREFIX));
		return { ...block, kind: runnable ? 'gltf-transform' : 'shell', commands };
	}
	return { ...block, kind: 'other' };
}

export function listSkills(pluginRoot) {
	const dir = join(pluginRoot, 'skills');
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'SKILL.md')))
		.map((d) => d.name)
		.sort();
}

export function readSkill(pluginRoot, name) {
	const path = join(pluginRoot, 'skills', name, 'SKILL.md');
	const text = readFileSync(path, 'utf8');
	return { name, path, text, blocks: extractBlocks(text) };
}

export function allBlocks(pluginRoot) {
	return listSkills(pluginRoot).flatMap((name) => {
		const skill = readSkill(pluginRoot, name);
		return skill.blocks.map((b) => ({ ...b, skill: name, id: `${name}--${b.index}` }));
	});
}

// Specifiers a runnable block may import. Anything else would need a bundler
// or a package the reader does not have, so the verifier rejects it.
export function importSpecifiers(code) {
	const specs = new Set();
	const re = /(?:^|\n)\s*import\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
	let m;
	while ((m = re.exec(code))) specs.add(m[1]);
	const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
	while ((m = dyn.exec(code))) specs.add(m[1]);
	return [...specs];
}

export function usesWebGPU(code) {
	return importSpecifiers(code).some((s) => s === 'three/webgpu' || s === 'three/tsl');
}
