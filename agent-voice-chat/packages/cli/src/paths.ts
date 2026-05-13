// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

import * as path from 'path';
import * as fs from 'fs';

/**
 * Find the monorepo root by walking up from this file's directory
 * until we find a package.json that is NOT the CLI's own package.json.
 * We anchor on the root package.json (or the directory containing
 * the top-level node_modules / .git).
 */
function findRepoRoot(): string {
  // Start from the CLI package directory (src/ or dist/ → package root → repo root)
  let dir = __dirname;

  // Walk up until we find a package.json with a workspaces field or .git directory
  // (indicating monorepo root), but not the CLI's own package.json.
  const maxDepth = 10;
  for (let i = 0; i < maxDepth; i++) {
    const pkgPath = path.join(dir, 'package.json');
    const gitDir = path.join(dir, '.git');

    if (fs.existsSync(gitDir)) {
      return dir;
    }

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces || pkg.name === 'xspace-agent') {
          return dir;
        }
      } catch {
        // Continue searching
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break; // Reached filesystem root
    dir = parent;
  }

  throw new Error(
    'Could not find repository root. Make sure you are running from within the xspace-agent project.'
  );
}

let _repoRoot: string | undefined;

/**
 * Get the monorepo root directory. Result is cached after first call.
 */
export function getRepoRoot(): string {
  if (!_repoRoot) {
    _repoRoot = findRepoRoot();
  }
  return _repoRoot;
}

/**
 * Resolve a path relative to the monorepo root.
 * Works in both dev (src/) and compiled (dist/) contexts.
 */
export function resolveFromRoot(...segments: string[]): string {
  return path.join(getRepoRoot(), ...segments);
}

/**
 * Get the CLI package's own root directory (where its package.json lives).
 */
export function getCliPackageRoot(): string {
  // In dev: __dirname is packages/cli/src or packages/cli/src/commands
  // In compiled: __dirname is packages/cli/dist or packages/cli/dist/commands
  let dir = __dirname;
  const maxDepth = 5;
  for (let i = 0; i < maxDepth; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === '@xspace/cli') {
          return dir;
        }
      } catch {
        // Continue searching
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error('Could not find CLI package root.');
}

/** Reset cached root (for testing). */
export function _resetCache(): void {
  _repoRoot = undefined;
}


