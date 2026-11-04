// /herald.js documents `import { createHerald, pollSource } from 'https://three.ws/herald.js'`,
// but Vite's app build stripped every export from the entry, so only
// window.threeHerald worked. The plugin must keep the exports of the entries it
// is given and must not touch any other entry.
import { describe, it, expect } from 'vitest';
import { build } from 'vite';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepEntryExports } from '../scripts/vite/keep-entry-exports.mjs';

async function bundle(withPlugin) {
	const dir = mkdtempSync(join(tmpdir(), 'keep-exports-'));
	try {
		const lib = join(dir, 'lib.js');
		const pub = join(dir, 'pub.js');
		const other = join(dir, 'other.js');
		writeFileSync(lib, 'export const createThing = () => 1;\nexport const pollThing = () => 2;\n');
		writeFileSync(pub, "import { createThing } from './lib.js';\nexport { createThing, pollThing } from './lib.js';\nwindow.thing = createThing;\n");
		writeFileSync(other, "import { createThing } from './lib.js';\nexport const hidden = 1;\nwindow.other = createThing;\n");
		const out = join(dir, 'out');
		await build({
			root: dir,
			logLevel: 'silent',
			configFile: false,
			plugins: withPlugin ? [keepEntryExports({ pub })] : [],
			build: {
				outDir: out,
				emptyOutDir: true,
				minify: false,
				rollupOptions: {
					input: withPlugin ? { other } : { pub, other },
					output: { entryFileNames: '[name].js' },
				},
			},
		});
		return { pub: readFileSync(join(out, 'pub.js'), 'utf8'), other: readFileSync(join(out, 'other.js'), 'utf8') };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('keepEntryExports', () => {
	it('app builds strip entry exports by default (the bug)', async () => {
		const { pub } = await bundle(false);
		expect(pub).not.toMatch(/\bexport\b/);
	});

	it('keeps the named exports of the entries it is given and leaves others alone', async () => {
		const { pub, other } = await bundle(true);
		expect(pub).toMatch(/export\s*\{[^}]*\bcreateThing\b/);
		expect(pub).toMatch(/\bpollThing\b/);
		expect(other).not.toMatch(/\bexport\b/);
	});
});
