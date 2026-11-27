/**
 * PostHog reverse-proxy routes in the production route table (vercel.json).
 *
 * The browser loads PostHog through same-origin `/ingest/*` so ad-blockers and
 * third-party cookie rules leave it alone. PostHog splits that traffic across
 * two hosts: the loader bundle (`/static/*`) and the per-project remote config
 * (`/array/<token>/config`, `/array/<token>/config.js`) live on the CDN-backed
 * assets host, while events, flags and replays go to the ingest host.
 *
 * Production only routed `/static/*` to the assets host, so the remote config
 * fell through to the ingest host. That host does not reliably serve it: a
 * visitor's console showed "ingest/array/phc_.../config: 404", and the Vite
 * dev proxy (which already routed `/ingest/array/*` to the assets host, hiding
 * the gap locally) records it returning a non-script response for config.js.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { loadRouteTable, resolveRequest } from '../scripts/lib/page-routing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const table = loadRouteTable(ROOT);
const TOKEN = 'phc_kvi8nrXqrNkLNy2NhaiwkbGyj77XpSJo54P5k2ZHYo9n';
const resolve = (p) => resolveRequest(p, table, path.join(ROOT, 'dist'));

describe('PostHog /ingest proxy routes', () => {
	it('sends the remote config JSON to the assets host', () => {
		expect(resolve(`/ingest/array/${TOKEN}/config`)).toEqual({
			outcome: 'external',
			target: `https://us-assets.i.posthog.com/array/${TOKEN}/config`,
		});
	});

	it('sends the remote config script to the assets host', () => {
		expect(resolve(`/ingest/array/${TOKEN}/config.js`)).toEqual({
			outcome: 'external',
			target: `https://us-assets.i.posthog.com/array/${TOKEN}/config.js`,
		});
	});

	it('sends the loader bundle to the assets host', () => {
		expect(resolve('/ingest/static/array.js')).toEqual({
			outcome: 'external',
			target: 'https://us-assets.i.posthog.com/static/array.js',
		});
	});

	it('sends events and flags to the ingest host', () => {
		expect(resolve('/ingest/i/v0/e/')).toEqual({
			outcome: 'external',
			target: 'https://us.i.posthog.com/i/v0/e/',
		});
		expect(resolve('/ingest/flags/')).toEqual({
			outcome: 'external',
			target: 'https://us.i.posthog.com/flags/',
		});
	});
});
