// Was the frontend actually built into dist/?
//
// `existsSync('dist')` is not that question. The deploy chain writes several
// sub-artifacts into dist/ (agent-3d, avatar-sdk, avatar-studio, docs) BEFORE
// the frontend `vite build` runs, and `npm run build:vercel` writes those and
// stops. Either leaves a dist/ directory holding no pages at all, which a
// bare directory check reads as "built" and every dist-dependent assertion
// then fails against: a missing stylesheet, an empty 404 body, a server that
// serves nothing. That reads like a product regression and is not one.
//
// dist/index.html is the marker, because it is written by the frontend
// `vite build` step itself. Present means the pages are there and the
// assertions are meaningful; absent means the tree was never frontend-built
// and the suite should skip rather than invent a failure. A tree that IS built
// and is missing a page still fails, which is the regression these suites
// exist to catch.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The dist/ directory, built or not. */
export const DIST_DIR = path.join(REPO_ROOT, 'dist');

/** True when the frontend build has written its pages into dist/. */
export const HAS_FRONTEND_BUILD = existsSync(path.join(DIST_DIR, 'index.html'));

/** One line naming the command that makes a skipped suite run. */
export const BUILD_HINT =
	'dist/ has no frontend build (no dist/index.html). Run `npm run build:gcp` to build it.';
