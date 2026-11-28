// Meta Muse connector domain verification.
//
// The Muse Connector Platform (platform.muse.ai) verifies that a submitter
// controls the MCP server's domain by fetching a challenge file it issues from
// /.well-known/muse-challenge/ on that domain. Meta only shows the token inside
// the logged-in submission form, so it lives on the Cloud Run service instead
// of in the repo, and going live is a config-only change:
//
//   gcloud run services update three-ws-api --region us-central1 \
//     --update-env-vars MUSE_CHALLENGE_TOKEN=<token>,MUSE_CHALLENGE_FILE=<file name>
//
// MUSE_CHALLENGE_FILE is optional: when Meta names a file, only that path
// answers; when it does not, every path under /.well-known/muse-challenge/
// answers with the token. Served by api/wk.js (name=muse-challenge).

const FILE_NAME = /^[A-Za-z0-9._-]{0,200}$/;

function clean(v) {
	return String(v ?? '').trim();
}

/**
 * @param {{ token?: string, file?: string, requested?: string }} input
 * @returns {{ status: 200|404, body: string }}
 */
export function museChallenge({ token, file, requested }) {
	const t = clean(token);
	const want = clean(file).replace(/^\/+/, '');
	const got = clean(requested);
	if (!t) return { status: 404, body: 'No Muse challenge is configured on this domain.' };
	if (!FILE_NAME.test(got) || got.includes('..')) return { status: 404, body: 'Not found.' };
	if (want && got !== want) return { status: 404, body: 'Not found.' };
	return { status: 200, body: t };
}
