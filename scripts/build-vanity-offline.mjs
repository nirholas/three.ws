#!/usr/bin/env node
// Builds a single self-contained HTML file with everything inlined:
// - keccak256 + secp256k1 (bundled from @noble/*)
// - wallet + CREATE2 worker code (as a Blob URL)
// - all CSS, all JS, no network requests.
//
// Output: dist/eth-vanity-offline.html
// Usage : node scripts/build-vanity-offline.mjs
//         then open the file in any browser. Works offline / airgapped.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'dist');
mkdirSync(outDir, { recursive: true });

// 1) Bundle the worker code (one bundle for both EOA and CREATE2 modes)
// Strip CDN imports — esbuild will resolve them from node_modules instead
const workerSrc = readFileSync(resolve(root, 'src/eth/vanity/wallet-worker.js'), 'utf8')
  .replace(/from\s*['"]https:\/\/esm\.sh\/@noble\/curves[^'"]+['"]/g, "from '@noble/curves/secp256k1.js'")
  .replace(/from\s*['"]https:\/\/esm\.sh\/@noble\/hashes[^'"]+['"]/g, "from '@noble/hashes/sha3'");

writeFileSync(resolve(outDir, '_worker-src.tmp.js'), workerSrc);

const workerBundle = await build({
  entryPoints: [resolve(outDir, '_worker-src.tmp.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
});
const workerCode = workerBundle.outputFiles[0].text;

// 2) Bundle the existing CREATE2 grinder worker too
const create2WorkerBundle = await build({
  entryPoints: [resolve(root, 'src/eth/vanity/grinder-worker.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
});
const create2WorkerCode = create2WorkerBundle.outputFiles[0].text;

// 3) Bundle keccak_256 for the inline page script (used by the ThreeWSPayments preset)
writeFileSync(resolve(outDir, '_main-src.tmp.js'), `
import { keccak_256 } from '@noble/hashes/sha3';
window.__keccak_256 = keccak_256;
`);
const mainBundle = await build({
  entryPoints: [resolve(outDir, '_main-src.tmp.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
});
const mainBootstrap = mainBundle.outputFiles[0].text;

// 4) Read the existing eth-vanity.html and rewrite imports to use inlined code
let html = readFileSync(resolve(root, 'public/eth-vanity.html'), 'utf8');

// Strip the nav (which loads /nav.css /nav.js — those don't exist offline)
html = html
  .replace(/<link rel="stylesheet" href="\/nav\.css">/g, '')
  .replace(/<script src="\/nav\.js"><\/script>/g, '')
  .replace(/<header>[\s\S]*?<\/header>/, '<header><h1 style="margin:1rem 1.5rem;font-size:1rem;color:#888">three.ws · offline vanity grinder</h1></header>')
  .replace(/<link rel="preconnect"[^>]*>/g, '')
  .replace(/<link[^>]*fonts\.googleapis[^>]*>/g, '')
  .replace(/<link[^>]*fonts\.gstatic[^>]*>/g, '');

// Replace the inline keccak_256 import (CDN) with our bootstrap
html = html.replace(
  /import\s*\{\s*keccak_256\s*\}\s*from\s*['"]https:\/\/esm\.sh[^'"]+['"]\s*;?/,
  `const keccak_256 = window.__keccak_256;`
);

// Replace the /src/eth/vanity/* imports with stubs that call the inlined workers via blob URL
html = html.replace(
  /import\s*\{\s*grindCreate2Vanity\s*\}\s*from\s*['"]\/src\/eth\/vanity\/grinder\.js['"]\s*;?/,
  `const grindCreate2Vanity = window.__grindCreate2Vanity;`
);
html = html.replace(
  /import\s*\{[\s\S]*?\}\s*from\s*['"]\/src\/eth\/vanity\/validation\.js['"]\s*;?/,
  `const { validatePattern, validateAddress, validateInitCodeHash, estimateAttempts, formatTimeEstimate, letterCount, eip55Checksum, MAX_PATTERN_LENGTH } = window.__validation;`
);
html = html.replace(
  /import\s*\{[\s\S]*?\}\s*from\s*['"]\/src\/eth\/vanity\/wordlist\.js['"]\s*;?/,
  `const { PRESET_CHIPS } = window.__wordlist;`
);

// Replace the wallet worker URL with our blob URL (defined in the bootstrap)
html = html.replace(
  /new URL\('\/src\/eth\/vanity\/wallet-worker\.js'[^)]*\)/g,
  'window.__walletWorkerUrl'
);

// 5) Bundle validation + wordlist + grinder main module too
writeFileSync(resolve(outDir, '_helpers-src.tmp.js'), `
import * as v from '${resolve(root, 'src/eth/vanity/validation.js')}';
import * as w from '${resolve(root, 'src/eth/vanity/wordlist.js')}';
import { grindCreate2Vanity } from '${resolve(root, 'src/eth/vanity/grinder.js')}';
window.__validation = v;
window.__wordlist = w;
// We'll rebuild grindCreate2Vanity to use our blob worker URL instead of the file path.
// Provide a shim that the inline page calls.
window.__grindCreate2Vanity = function(opts) {
  // Override the worker URL by patching the URL constructor lookup
  // Easier: spawn the worker manually and run the same protocol grindCreate2Vanity uses.
  return new Promise((resolve, reject) => {
    const n = Math.max(1, opts.maxWorkers || navigator.hardwareConcurrency || 4);
    const workers = [];
    let totalAttempts = 0;
    const started = performance.now();
    let done = false;
    const stop = () => { done = true; workers.forEach(w => { try { w.terminate(); } catch {} }); };
    opts.signal?.addEventListener('abort', () => { stop(); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); });
    for (let i = 0; i < n; i++) {
      const wkr = new Worker(window.__create2WorkerUrl);
      workers.push(wkr);
      wkr.postMessage({ type: 'start', deployer: opts.deployer, initCodeHash: opts.initCodeHash, prefix: opts.prefix, suffix: opts.suffix, caseSensitive: !!opts.caseSensitive });
      wkr.onmessage = (e) => {
        if (done) return;
        const { type, attempts } = e.data;
        if (type === 'progress') {
          totalAttempts += attempts;
          opts.onProgress?.({ attempts: totalAttempts, rate: e.data.rate * n, eta: '—', sample: e.data.sample });
        } else if (type === 'match') {
          stop();
          resolve({
            address: e.data.address, addressChecksum: e.data.addressChecksum,
            salt: e.data.salt, deployer: opts.deployer, initCodeHash: opts.initCodeHash,
            attempts: totalAttempts + (e.data.attempts || 0),
            durationMs: performance.now() - started, workers: n,
            caseSensitive: !!opts.caseSensitive,
          });
        }
      };
      wkr.onerror = (err) => { if (!done) { stop(); reject(err); } };
    }
  });
};
`);
const helpersBundle = await build({
  entryPoints: [resolve(outDir, '_helpers-src.tmp.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
});
const helpersCode = helpersBundle.outputFiles[0].text;

// 6) Build the offline-only assign block — disabled (no API in offline mode)
const offlineAssignStub = `
window.__renderAssignBlock = () => {
  const host = document.getElementById('assign-host');
  if (host) host.innerHTML = '<div class="card" style="margin-top:1rem"><h2>Offline mode</h2><p class="desc" style="margin:0">Assign-to-agent is disabled in the offline build. Save the salt + address; deploy from your tooling.</p></div>';
};
`;

// 7) Inject all bootstrap code into the head
const bootstrap = `
<script>
${mainBootstrap}
${helpersCode}
${offlineAssignStub}
// Build worker blob URLs from inlined sources
(function(){
  const walletSrc = ${JSON.stringify(workerCode)};
  const create2Src = ${JSON.stringify(create2WorkerCode)};
  window.__walletWorkerUrl = URL.createObjectURL(new Blob([walletSrc], { type: 'application/javascript' }));
  window.__create2WorkerUrl = URL.createObjectURL(new Blob([create2Src], { type: 'application/javascript' }));
})();
</script>
`;

html = html.replace('<head>', '<head>\n' + bootstrap);

// 8) Patch the wallet grinder in the inline script to also pass type:'classic' since we now use IIFE
html = html.replace(
  /new Worker\(\s*window\.__walletWorkerUrl\s*,\s*\{\s*type:\s*'module'\s*\}\s*\)/g,
  "new Worker(window.__walletWorkerUrl)"
);

// 9) Strip the assign-block call (it tries to fetch /api/agents)
html = html.replace(
  /renderAssignBlock\(result, p, s\);/g,
  'window.__renderAssignBlock();'
);

// 10) Add an offline banner at the top of <body>
html = html.replace(
  '<body>',
  `<body>
<div style="background:#0e0e0e;border-bottom:1px solid #2e7d32;padding:.6rem 1rem;font-size:.85rem;color:#a5d6a7;font-family:ui-monospace,monospace">
  ✓ offline build — no network calls, all keys stay local
</div>`
);

writeFileSync(resolve(outDir, 'eth-vanity-offline.html'), html);

// Cleanup tmp files
import { unlinkSync } from 'node:fs';
for (const f of ['_worker-src.tmp.js', '_main-src.tmp.js', '_helpers-src.tmp.js']) {
  try { unlinkSync(resolve(outDir, f)); } catch {}
}

const sizeKB = (html.length / 1024).toFixed(1);
console.log(`✓ built dist/eth-vanity-offline.html (${sizeKB} KB)`);
console.log(`  open it in any browser — works fully offline`);
