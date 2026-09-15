import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ncc from '@vercel/ncc';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const entry = resolve(root, 'src/index.js');
const built = await ncc(entry, { minify: true, sourceMap: false });

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.js'), built.code);

for (const [name, asset] of Object.entries(built.assets)) {
	const target = resolve(output, name);
	if (!target.startsWith(`${output}/`)) throw new Error(`bundle asset escaped dist: ${name}`);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, asset.source);
}

console.log(`built dist/index.js and ${Object.keys(built.assets).length} runtime asset(s)`);
