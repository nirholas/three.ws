// Bundles the CLI and MCP server to plain JS (Node refuses to strip types inside
// node_modules, so the published package cannot ship .ts) and stages the assets
// the code looks for beside the bundle.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('dist/migrations', { recursive: true, force: true });
for (const f of ['cli.js', 'mcp.js']) rmSync(`dist/${f}`, { force: true });

await build({
  entryPoints: { pulse: 'src/cli.ts', 'pulse-mcp': 'src/mcp/server.ts' },
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  chunkNames: 'chunks/[name]-[hash]',
  logLevel: 'info',
  define: { __PULSE_VERSION__: JSON.stringify(pkg.version) },
});
mkdirSync('dist/migrations', { recursive: true });
cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
