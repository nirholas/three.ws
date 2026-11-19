// scripts/deploy-sniper.mjs rolls code onto an existing service with
// `gcloud run services update --image`, which keeps the running env. On
// 2026-11-19 it passed the image the service ALREADY ran (a pinned digest from
// a broken 2026-11-10 build) instead of the one Cloud Build had just pushed, so
// a successful build of the fixed worker shipped the old broken image and
// revision agent-sniper-00039 died with ERR_MODULE_NOT_FOUND. The rollout must
// pin the digest of the freshly pushed :latest, never the running image.
import { describe, it, expect } from 'vitest';
import { resolveRolloutImage, parseImageDigest } from '../scripts/lib/sniper-rollout-image.mjs';

const REPO = 'us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/workers/agent-sniper';
const OLD = 'sha256:' + '0a'.repeat(32);
const NEW = 'sha256:' + 'ba'.repeat(32);

describe('sniper rollout image', () => {
	it('rolls the digest the build just pushed, not the image the service already runs', () => {
		expect(resolveRolloutImage({ imageRepo: REPO, existingImage: `${REPO}@${OLD}`, latestDigest: NEW }))
			.toBe(`${REPO}@${NEW}`);
	});

	it('refuses to roll when the pushed digest is unknown or malformed', () => {
		expect(() => resolveRolloutImage({ imageRepo: REPO, existingImage: `${REPO}@${OLD}`, latestDigest: '' }))
			.toThrow(/digest/);
		expect(() => resolveRolloutImage({ imageRepo: REPO, existingImage: `${REPO}@${OLD}`, latestDigest: 'latest' }))
			.toThrow(/digest/);
	});

	it('parses the digest gcloud prints for an Artifact Registry image', () => {
		expect(parseImageDigest(`${NEW}\n`)).toBe(NEW);
		expect(parseImageDigest(`${REPO}@${NEW}`)).toBe(NEW);
		expect(parseImageDigest('')).toBe(null);
		expect(parseImageDigest('not a digest')).toBe(null);
	});
});
