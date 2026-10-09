/**
 * Compile built-in extensions (TypeScript → CommonJS JS) and copy manifests,
 * then bundle the three.ws cloud extensions from integrations/modly/.
 * Output: out/builtin-extensions/{id}/processor.js + manifest.json
 */

import { execSync }                                           from 'child_process'
import { readdirSync, existsSync, cpSync, mkdirSync, rmSync, statSync } from 'fs'
import { join, dirname }                                      from 'path'
import { fileURLToPath }                                      from 'url'

const root   = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src', 'areas', 'workflows', 'nodes')
const outDir = join(root, 'out', 'builtin-extensions')
// The three.ws Forge extensions are published for upstream Modly users from
// integrations/modly/ in this repo. The desktop app ships the same source as
// built-ins, so a fix there lands in both places at once.
const cloudSrcDir = join(root, '..', '..', 'integrations', 'modly')
const CLOUD_EXTENSIONS = ['three-ws', 'three-ws-publish']

if (!existsSync(srcDir)) {
  console.log('[build-builtins] No builtin-extensions directory found, skipping.')
  process.exit(0)
}

// 1. Compile TypeScript
console.log('[build-builtins] Compiling TypeScript…')
execSync('npx tsc -p tsconfig.builtins.json', { cwd: root, stdio: 'inherit' })

// 2. Copy manifest.json, and optionally package.json + npm install
for (const id of readdirSync(srcDir)) {
  const extSrcDir = join(srcDir, id)
  if (!statSync(extSrcDir).isDirectory()) continue
  // Only process extension folders (those with a manifest.json)
  if (!existsSync(join(extSrcDir, 'manifest.json'))) continue

  const extOutDir = join(outDir, id)
  mkdirSync(extOutDir, { recursive: true })

  const manifestSrc = join(extSrcDir, 'manifest.json')
  if (existsSync(manifestSrc)) {
    cpSync(manifestSrc, join(extOutDir, 'manifest.json'))
    console.log(`[build-builtins] ${id}: manifest.json copied`)
  } else {
    console.warn(`[build-builtins] ${id}: manifest.json missing, skipping`)
  }

  const pkgSrc = join(extSrcDir, 'package.json')
  if (existsSync(pkgSrc)) {
    cpSync(pkgSrc, join(extOutDir, 'package.json'))
    console.log(`[build-builtins] ${id}: Installing npm dependencies…`)
    execSync('npm install --omit=dev --no-audit --no-fund --ignore-scripts=false', {
      cwd:   extOutDir,
      stdio: 'inherit',
    })
    console.log(`[build-builtins] ${id}: npm install done`)
  }

  // Copy any Python processor files
  for (const file of readdirSync(extSrcDir)) {
    if (file.endsWith('.py')) {
      cpSync(join(extSrcDir, file), join(extOutDir, file))
      console.log(`[build-builtins] ${id}: ${file} copied`)
    }
  }
}

// 3. Bundle the three.ws cloud generator and the Publish to three.ws node.
for (const id of CLOUD_EXTENSIONS) {
  const extSrcDir = join(cloudSrcDir, id)
  if (!existsSync(join(extSrcDir, 'manifest.json'))) {
    console.error(`[build-builtins] ${id}: missing ${extSrcDir}/manifest.json. The cloud extensions are part of the app; restore integrations/modly/${id}.`)
    process.exit(1)
  }
  const extOutDir = join(outDir, id)
  rmSync(extOutDir, { recursive: true, force: true })
  cpSync(extSrcDir, extOutDir, {
    recursive: true,
    filter: (src) => !/(^|[\\/])(__pycache__|test_[^\\/]*\.py)$/.test(src),
  })
  console.log(`[build-builtins] ${id}: bundled from integrations/modly`)
}

console.log('[build-builtins] Done.')
