// Runs every examples/*.mjs against the built package. Needs THREE_WS_API_KEY
// and a built dist/ (npm run build). Exits non-zero if any example fails.
import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.THREE_WS_API_KEY) {
	console.error('Set THREE_WS_API_KEY to run the examples (create one at https://three.ws/dashboard/api).');
	process.exit(2);
}
if (!existsSync(path.join(root, 'dist', 'index.js'))) {
	console.error('dist/ is missing. Run `npm run build` first.');
	process.exit(2);
}
const files = readdirSync(path.join(root, 'examples')).filter((f) => f.endsWith('.mjs')).sort();
let failed = 0;
for (const f of files) {
	console.log(`\n== ${f}`);
	const r = spawnSync(process.execPath, [path.join(root, 'examples', f)], { stdio: 'inherit', env: process.env });
	if (r.status !== 0) {
		failed++;
		console.error(`FAILED: ${f}`);
	}
}
console.log(`\n${files.length - failed}/${files.length} examples passed`);
process.exit(failed ? 1 : 0);
