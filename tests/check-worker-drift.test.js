// scripts/check-worker-drift.mjs: does a serving worker image contain its source?
//
// Fixtures are captured, not invented: tests/fixtures/worker-drift/*.json are the
// Run Admin API v2 and Artifact Registry responses for remesh-service and
// model-trellis, fetched 2026-11-03 from project aerial-vehicle-466722-p5 (env
// values replaced with "(redacted)", nothing else changed). The cloudbuild
// parser runs against the real workers/*/cloudbuild*.yaml files, so a config
// rewritten into a shape the parser cannot read fails here, not silently in ops.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	expandSubstitutions,
	parseCloudbuildTargets,
	sourceCommitFromTags,
	hexTokens,
	buildTimeFromManualTag,
	pickBuiltAt,
	unbuiltCommits,
	classify,
	servingRevisions,
	parseImageRef,
	formatTable,
} from '../scripts/lib/worker-drift.mjs';

const root = join(import.meta.dirname, '..');
const config = (p) => readFileSync(join(root, 'workers', p), 'utf8');
const fixture = (name) => JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'worker-drift', name), 'utf8'));
const targetsOf = (p) => parseCloudbuildTargets(config(p)).targets.map((t) => `${t.service}@${t.region}:${t.via}`);

describe('parseCloudbuildTargets (real worker configs)', () => {
	it('reads the args-form deploy step and its substituted service and region', () => {
		expect(targetsOf('remesh/cloudbuild.yaml')).toEqual(['remesh-service@us-central1:step']);
	});

	it('reads both serving regions of a primary/standby config', () => {
		expect(targetsOf('model-text2motion/cloudbuild.yaml')).toEqual([
			'model-text2motion@us-east4:step',
			'model-text2motion@us-central1:step',
		]);
	});

	it('reads a bash literal-block deploy and ignores the scale-down `services update` before it', () => {
		expect(targetsOf('model-hunyuan3d/cloudbuild.hunyuan21rtx.yaml')).toEqual(['model-hunyuan3d-21-rtx@us-central1:step']);
	});

	it('reads a bash folded-block deploy', () => {
		expect(targetsOf('agent-gateway/cloudbuild.yaml')).toEqual(['agent-gateway@us-central1:step']);
	});

	it('honours a non-default region', () => {
		expect(targetsOf('granite-guardian/cloudbuild.yaml')).toEqual(['granite-guardian@europe-west4:step']);
	});

	it('falls back to the documented roll command in a build-only config header', () => {
		expect(targetsOf('agent-sniper/cloudbuild.yaml')).toEqual(['agent-sniper@us-central1:comment']);
	});

	it('returns nothing for a config that only builds a candidate image', () => {
		expect(targetsOf('model-trellis/cloudbuild.ngc.yaml')).toEqual([]);
	});

	it('expands ${_X}, $_X and $PROJECT_ID, and leaves unknowns visible', () => {
		const subs = { _SERVICE: 'remesh-service', PROJECT_ID: 'p' };
		expect(expandSubstitutions('${_SERVICE}/$PROJECT_ID/$_MISSING', subs)).toBe('remesh-service/p/$_MISSING');
	});
});

describe('serving image provenance (captured remesh-service responses)', () => {
	const service = fixture('remesh-service.service.json');
	const revision = fixture('remesh-service.revision.json');
	const image = fixture('remesh-service.image.json');

	it('finds the revision taking traffic', () => {
		expect(servingRevisions(service)).toEqual([{ revision: 'remesh-service-00005-8rr', percent: 100 }]);
	});

	it('parses the digest-pinned image a revision runs', () => {
		expect(parseImageRef(revision.containers[0].image)).toEqual({
			location: 'us-central1',
			project: 'aerial-vehicle-466722-p5',
			repository: 'remesh-service',
			image: 'server',
			digest: 'sha256:10512294de6878d0bb47ce3fff7b6b53cef63cc756eb1b2c5c8e9449c13781e7',
			tag: null,
		});
		expect(parseImageRef(service.template.containers[0].image).tag).toBe('1756bc51');
	});

	it('dates the image by its registry build, not by the newer config-only revision', () => {
		// The revision is 2026-07-16; the image inside it was built 2026-06-13.
		expect(revision.createTime.startsWith('2026-07-16')).toBe(true);
		const built = pickBuiltAt({ image, tags: image.tags, revisionCreateTime: revision.createTime });
		expect(built).toEqual({ at: '2026-06-13T04:38:32.685367620Z', source: 'registry build' });
	});

	it('names the build commit from the image tag', () => {
		const resolve = (c) => (c === '1756bc51' ? '1756bc516ca22133b6071e35f7034010a11aa4db' : null);
		expect(sourceCommitFromTags(image.tags, resolve)).toEqual({ commit: '1756bc516ca22133b6071e35f7034010a11aa4db', tag: '1756bc51' });
	});
});

describe('tag forms', () => {
	it('reads a manual<epoch> tag as a build time (captured model-trellis tag)', () => {
		const tag = parseImageRef(fixture('model-trellis.service.json').template.containers[0].image).tag;
		expect(tag).toBe('manual1790753126');
		expect(buildTimeFromManualTag([tag])).toBe('2026-09-30T07:25:26.000Z');
		expect(pickBuiltAt({ image: null, tags: [tag], revisionCreateTime: '2026-10-01T00:00:00Z' }).source).toBe('manual tag');
	});

	it('extracts the sha from decorated lane tags and never from a build id', () => {
		expect(hexTokens('21-959635b78-b3')).toEqual(['959635b78']);
		expect(hexTokens('stage-a1d1ec3')).toEqual(['a1d1ec3']);
		expect(hexTokens('rtx-latest')).toEqual([]);
		const resolveAll = (c) => `${c}full`;
		expect(sourceCommitFromTags(['9d21b018-969c-49c6-b3d0-ca13afa66961', 'manual1790753126', 'latest'], resolveAll)).toBeNull();
	});

	it('falls back to the revision when the registry and tags say nothing', () => {
		expect(pickBuiltAt({ image: null, tags: ['latest'], revisionCreateTime: '2026-07-16T21:19:18Z' })).toEqual({ at: '2026-07-16T21:19:18Z', source: 'revision' });
	});
});

describe('drift classification', () => {
	const now = Date.parse('2026-11-03T12:00:00Z');
	const history = [
		{ sha: 'c3', committedAt: '2026-11-01T00:00:00Z' },
		{ sha: 'c2', committedAt: '2026-10-01T00:00:00Z' },
		{ sha: 'c1', committedAt: '2026-06-01T00:00:00Z' },
	];

	it('counts commits after the build time', () => {
		expect(unbuiltCommits(history, { builtAt: '2026-09-30T00:00:00Z', unbuiltShas: null }).map((c) => c.sha)).toEqual(['c3', 'c2']);
	});

	it('prefers the exact commit set when the image names an ancestor commit', () => {
		expect(unbuiltCommits(history, { builtAt: '2026-09-30T00:00:00Z', unbuiltShas: new Set(['c3']) }).map((c) => c.sha)).toEqual(['c3']);
	});

	it('is current when nothing is unbuilt', () => {
		expect(classify({ deployed: true, unbuilt: [], now })).toMatchObject({ status: 'current', behind: 0, failing: false });
	});

	it('reports a fix merged inside the grace window without failing', () => {
		const v = classify({ deployed: true, unbuilt: [history[0]], builtAt: '2026-09-30T00:00:00Z', now, graceDays: 7 });
		expect(v).toEqual({ status: 'drifting', behind: 1, waitingDays: 2, failing: false });
	});

	it('fails once unbuilt source has waited past the grace window', () => {
		const v = classify({ deployed: true, unbuilt: history.slice(0, 2), builtAt: '2026-09-30T00:00:00Z', now, graceDays: 7 });
		expect(v).toEqual({ status: 'DRIFTED', behind: 2, waitingDays: 33, failing: true });
	});

	it('never dates the wait from before the image was built', () => {
		const v = classify({ deployed: true, unbuilt: [history[2]], builtAt: '2026-10-27T12:00:00Z', now, graceDays: 7 });
		expect(v.waitingDays).toBe(7);
		expect(v.failing).toBe(false);
	});

	it('reports a stale extra-region copy but does not fail on it', () => {
		const v = classify({ deployed: true, unbuilt: history.slice(0, 2), builtAt: '2026-09-30T00:00:00Z', declared: false, now });
		expect(v).toMatchObject({ status: 'DRIFTED', failing: false });
	});

	it('marks a configured service with no Cloud Run service as NOT-DEPLOYED, not failing', () => {
		expect(classify({ deployed: false, unbuilt: [] })).toMatchObject({ status: 'NOT-DEPLOYED', failing: false });
	});

	it('prints one aligned row per service', () => {
		const out = formatTable([
			{ worker: 'remesh', service: 'remesh-service', region: 'us-central1', declared: true, revision: 'remesh-service-00005-8rr', builtAt: '2026-06-13T04:38:32Z', builtAtSource: 'registry build', sourceCommit: '1756bc516ca2', lastSourceChange: '2026-11-03T02:23:09Z', behind: 24, waitingDays: 109, status: 'DRIFTED' },
		]).split('\n');
		expect(out).toHaveLength(3);
		expect(out[2]).toMatch(/^remesh\s+remesh-service@us-central1\s+remesh-service-00005-8rr\s+2026-06-13 \(registry build\)\s+1756bc516\s+2026-11-03\s+24\s+109d\s+DRIFTED$/);
	});
});
