// Bundle three-ws-agent into one ES module and turn it into a Node.js single
// executable. Used by scripts/build-windows.mjs; kept separate so the exact
// same bundling (plugins, banner, assets, guards) can be pointed at another
// entry when a code path needs proving inside a real single executable.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { inlinePackageVersion } from './windows-release.mjs';

/**
 * Files carried inside the executable and read with node:sea getAsset().
 * The Draco decoder is what lets `--avatar` open Draco-compressed GLBs.
 */
export function seaAssets(fromDir) {
	const req = createRequire(join(fromDir, 'package.json'));
	const dracoDir = dirname(req.resolve('draco3dgltf/package.json', { paths: [fromDir] }));
	return { 'draco_decoder_gltf.wasm': join(dracoDir, 'draco_decoder_gltf.wasm') };
}

/**
 * Modules allowed to keep a file read relative to import.meta.url, with why.
 * In a single executable import.meta.url is the exe itself, so anything else
 * reading "next to itself" would fail at run time and fails the build instead.
 */
const SAFE_SELF_RELATIVE = {
	// Reads its package.json only when DEV=true, inside a try/catch that falls back to built-in metadata.
	'node_modules/ink/build/reconciler.js': /new URL\("\.\.\/package\.json", import\.meta\.url\)/,
};

/** Every `new URL(..., import.meta.url)` in the bundle, attributed to its source module. */
export function selfRelativeReads(text) {
	const found = [];
	let mod = '';
	for (const line of text.split('\n')) {
		const m = /^\/\/ (\S+\.(?:c|m)?js)$/.exec(line);
		if (m) mod = m[1];
		for (const hit of line.matchAll(/new URL\([^)]*import\.meta\.url\)/g)) {
			const allowed = Object.entries(SAFE_SELF_RELATIVE).some(([path, re]) => mod.endsWith(path) && re.test(hit[0]));
			if (!allowed) found.push(`${mod || '(unknown module)'}: ${hit[0]}`);
		}
	}
	return found;
}

const BANNER = [
	"import { createRequire as __threeWsCreateRequire } from 'node:module';",
	"import { fileURLToPath as __threeWsFileURLToPath } from 'node:url';",
	"import { dirname as __threeWsDirname } from 'node:path';",
	// CommonJS dependencies call require() for builtins and read __dirname; give the ES module bundle both.
	'const require = __threeWsCreateRequire(import.meta.url);',
	'const __filename = __threeWsFileURLToPath(import.meta.url);',
	'const __dirname = __threeWsDirname(__filename);',
].join('\n');

/**
 * @param {object} o
 * @param {string} o.pkgDir    packages/agent-cli
 * @param {string} o.entry     entry module
 * @param {string} o.outfile   bundle to write
 * @param {string} o.version   version string baked into src/http.js
 * @param {string} o.nodeMajor esbuild target, e.g. "26"
 */
export async function bundleCli({ pkgDir, entry, outfile, version, nodeMajor }) {
	const httpJs = resolve(pkgDir, 'src', 'http.js');
	const dracoShim = [
		"import { getAsset, isSea } from 'node:sea';",
		`import draco from ${JSON.stringify(createRequire(join(pkgDir, 'package.json')).resolve('draco3dgltf', { paths: [pkgDir] }))};`,
		'// Inside the executable the decoder wasm is an embedded asset, not a file beside a script.',
		'const wasm = () => (isSea() ? { wasmBinary: new Uint8Array(getAsset("draco_decoder_gltf.wasm")) } : {});',
		'export default { ...draco, createDecoderModule: (opts = {}) => draco.createDecoderModule({ ...wasm(), ...opts }) };',
	].join('\n');

	const result = await build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: `node${nodeMajor}`,
		legalComments: 'eof',
		metafile: true,
		logLevel: 'warning',
		banner: { js: BANNER },
		define: { 'process.env.NODE_ENV': '"production"' },
		plugins: [
			{
				name: 'three-ws-sea',
				setup(b) {
					b.onLoad({ filter: /[\\/]src[\\/]http\.js$/ }, (args) => {
						if (resolve(args.path) !== httpJs) return undefined;
						return { contents: inlinePackageVersion(readFileSync(args.path, 'utf8'), version), loader: 'js' };
					});
					// Ink's React devtools bridge only loads when DEV=true and import.meta.resolve finds the
					// package; a single executable supports neither, so it gets a module that says so.
					b.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'three-ws-sea' }));
					b.onLoad({ filter: /^react-devtools-core$/, namespace: 'three-ws-sea' }, () => ({
						contents: "throw new Error('React DevTools are not available in the standalone three-ws-agent executable');",
						loader: 'js',
					}));
					b.onResolve({ filter: /^draco3dgltf$/ }, (args) =>
						args.namespace === 'three-ws-sea' ? undefined : { path: 'draco3dgltf', namespace: 'three-ws-sea' },
					);
					b.onLoad({ filter: /^draco3dgltf$/, namespace: 'three-ws-sea' }, () => ({ contents: dracoShim, loader: 'js', resolveDir: pkgDir }));
				},
			},
		],
	});

	const text = readFileSync(outfile, 'utf8');
	const leftovers = selfRelativeReads(text);
	if (leftovers.length) throw new Error(`bundle still reads files next to itself:\n  ${leftovers.join('\n  ')}`);
	return { modules: Object.keys(result.metafile.inputs).length, bytes: Buffer.byteLength(text) };
}

/**
 * Run `node --build-sea` with the given Node binary (it must be exactly the
 * version of `executable`, since blob and runtime have to match).
 */
export function buildSea(nodeBin, { main, executable, output, assets }) {
	const config = `${output}.sea-config.json`;
	writeFileSync(
		config,
		JSON.stringify(
			{
				main,
				mainFormat: 'module',
				executable,
				output,
				disableExperimentalSEAWarning: true,
				useSnapshot: false,
				useCodeCache: false,
				// The exe is a CLI, not a Node runtime: NODE_OPTIONS from the user's shell must not change it.
				execArgvExtension: 'none',
				assets,
			},
			null,
			'\t',
		),
	);
	try {
		execFileSync(nodeBin, ['--build-sea', config], { stdio: 'inherit' });
	} finally {
		rmSync(config, { force: true });
	}
}
