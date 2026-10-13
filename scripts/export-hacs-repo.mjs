#!/usr/bin/env node
// Builds the exact standalone-repository tree that nirholas/three-ws-home-assistant
// needs: the integration itself, README, LICENSE, hacs.json and the two GitHub
// Actions workflows HACS and hassfest run in that repository's own CI.
//
//   node scripts/export-hacs-repo.mjs                build the tree under dist/hacs-export
//   node scripts/export-hacs-repo.mjs --out <dir>     build it somewhere else
//
// This monorepo runs no GitHub Actions of its own (see CLAUDE.md), so the two
// workflow files are written only into the exported tree, never under this
// repository's own .github/workflows/. Creating nirholas/three-ws-home-assistant
// from this tree, and turning the workflows on, is the owner's call.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(REPO, 'home-assistant-integration');
const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const OUT = resolve(outIndex === -1 ? join(REPO, 'dist', 'hacs-export') : argv[outIndex + 1]);

const manifest = JSON.parse(readFileSync(join(SOURCE, 'custom_components', 'three_ws', 'manifest.json'), 'utf8'));
const hacsManifest = JSON.parse(readFileSync(join(SOURCE, 'hacs.json'), 'utf8'));

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The integration, as-is: custom_components/three_ws/** including brand/.
cpSync(join(SOURCE, 'custom_components'), join(OUT, 'custom_components'), { recursive: true });

// Repository-root files the standalone repo needs that already live next to
// the integration in this monorepo.
for (const file of ['hacs.json', 'README.md', 'info.md', 'LICENSE', '.gitignore']) {
	cpSync(join(SOURCE, file), join(OUT, file));
}

mkdirSync(join(OUT, '.github', 'workflows'), { recursive: true });

writeFileSync(
	join(OUT, '.github', 'workflows', 'hassfest.yml'),
	`name: Hassfest

on:
  workflow_dispatch:
  schedule:
    - cron: "0 0 * * *"
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions: {}

jobs:
  validate:
    name: Hassfest validation
    runs-on: ubuntu-latest
    steps:
      - name: Checkout the repository
        uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: Run hassfest validation
        uses: home-assistant/actions/hassfest@master
`,
);

writeFileSync(
	join(OUT, '.github', 'workflows', 'hacs.yml'),
	`name: HACS

on:
  workflow_dispatch:
  schedule:
    - cron: "0 0 * * *"
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

permissions: {}

jobs:
  validate:
    name: HACS validation
    runs-on: ubuntu-latest
    steps:
      - name: Run HACS validation
        uses: hacs/action@main
        with:
          category: integration
`,
);

const report = {
	domain: manifest.domain,
	version: manifest.version,
	homeassistantMinimum: hacsManifest.homeassistant,
	files: ['custom_components/three_ws/**', 'hacs.json', 'README.md', 'info.md', 'LICENSE', '.gitignore', '.github/workflows/hassfest.yml', '.github/workflows/hacs.yml'],
};
console.log(`Exported ${manifest.name} v${manifest.version} to ${OUT}`);
console.log(JSON.stringify(report, null, 2));

if (!existsSync(join(OUT, 'custom_components', manifest.domain, 'brand', 'icon.png'))) {
	throw new Error('export is missing the local brand icon HACS checks for');
}
