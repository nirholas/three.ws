// Which image `scripts/deploy-sniper.mjs` rolls onto an existing agent-sniper
// service. The rollout uses `gcloud run services update --image` so the running
// env survives, and the image it passes must be the one Cloud Build just pushed.
// Re-rolling the service's own current image (the pre-2026-11-19 behavior)
// ships a stale digest after every successful build: the fixed worker built
// green and the broken 2026-11-10 image went out again.

const DIGEST_RE = /sha256:[0-9a-f]{64}/;

// gcloud prints either a bare digest or a full `<repo>@sha256:...` reference.
export function parseImageDigest(stdout) {
	const m = String(stdout || '').match(DIGEST_RE);
	return m ? m[0] : null;
}

// Pin the freshly pushed digest rather than the moving :latest tag, so the log
// and the revision both name the exact bytes that shipped.
export function resolveRolloutImage({ imageRepo, latestDigest }) {
	const digest = parseImageDigest(latestDigest);
	if (!digest || digest !== latestDigest) {
		throw new Error(`cannot roll agent-sniper: no valid sha256 digest for ${imageRepo}:latest (got "${latestDigest}")`);
	}
	return `${imageRepo}@${digest}`;
}
