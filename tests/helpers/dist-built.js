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
// dist/home.html is the marker: it is the "/" page, written by the frontend
// `vite build` step itself. It is NOT dist/index.html. The route table in
// vercel.json rewrites "/" to /home.html, so a complete build has no
// dist/index.html at all, and keying on that file skipped these suites on every
// tree, built or not. This mirrors the tripwire scripts/check-dist.mjs uses for
// "was `npm run build` skipped entirely" (its resolvesToFile maps "/" to
// home.html), so the two can never disagree about what built means.
//
// The marker is deliberately NOT one of the files the suites assert on
// (style.css, 404.html). Gating on those would make each suite skip exactly
// when the regression it exists to catch occurs. Present means the pages are
// there and the assertions are meaningful; absent means the tree was never
// frontend-built and the suite should skip rather than invent a failure.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The dist/ directory, built or not. */
export const DIST_DIR = path.join(REPO_ROOT, 'dist');

/** True when the frontend build has written its pages into dist/. */
export const HAS_FRONTEND_BUILD = existsSync(path.join(DIST_DIR, 'home.html'));

/** One line naming the command that makes a skipped suite run. */
export const BUILD_HINT =
	'dist/ has no frontend build (no dist/home.html). Run `npm run build:gcp` to build it.';
