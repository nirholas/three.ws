// Disconnecting a home must not be rationed out of the budget that connecting
// one spends (api/home/[id].js + api/_lib/rate-limit.js).
//
// The lane's governing rule is asymmetric on purpose: a move toward safety
// always goes through, a move that opens the house stops and asks. Revoking a
// connection is the safety direction at its strongest, because it is how a
// person cuts our access to their building entirely.
//
// It used to spend `homeConnect`, ten in ten minutes, shared with POST /api/home
// and the relay pairing call. That bucket exists because the connect body
// carries a Home Assistant token and is therefore the credential-stuffing
// surface. Revoking carries no token and can stuff nothing. Sharing meant the
// budget was spent exactly when someone had been fumbling a token or connecting
// several houses, and the answer to "disconnect this house" became "too many
// connection changes, wait a moment" for up to ten minutes.
//
// Found by tests/e2e/home-scene.spec.js, whose disconnect journey returned a
// real 429 from a real server after the suite's earlier connects.
import { test, expect } from 'vitest';

const { limits } = await import('../api/_lib/rate-limit.js');
const revokeSource = (await import('node:fs')).readFileSync('api/home/[id].js', 'utf8');

test('revoking has a bucket of its own, not a share of the connect budget', () => {
	expect(typeof limits.homeRevoke, 'a dedicated revoke limiter must exist').toBe('function');
	expect(limits.homeRevoke).not.toBe(limits.homeConnect);
});

test('the revoke handler spends the revoke bucket and never the connect one', () => {
	const revoke = revokeSource.slice(revokeSource.indexOf('async function handleRevoke'));
	expect(revoke).toContain('limits.homeRevoke(');
	// The connect bucket must not be reachable from the revoke path at all: a
	// second call to it here would re-create the coupling with extra steps.
	expect(revoke).not.toContain('limits.homeConnect(');
});

test('connecting still spends the credential-stuffing bucket', async () => {
	// The fix must not have loosened the surface it was protecting. Both writers
	// that carry a Home Assistant token still meter on homeConnect.
	const fs = await import('node:fs');
	for (const file of ['api/home/index.js', 'api/home/pair.js']) {
		expect(fs.readFileSync(file, 'utf8'), `${file} must still meter on homeConnect`).toContain('limits.homeConnect(');
	}
});

test('the refusal names disconnecting, so the message matches what was refused', () => {
	const revoke = revokeSource.slice(revokeSource.indexOf('async function handleRevoke'));
	expect(revoke).toContain('too many disconnects');
	expect(revoke).not.toContain('too many connection changes');
});

test('a revoke is still bounded, and more generous than a connect', async () => {
	// Not unlimited: a revoke writes to the database and drops sockets. The
	// numbers are read from the module rather than restated, so this pins the
	// relationship (revoke is roomier) and not a literal that would rot.
	const src = (await import('node:fs')).readFileSync('api/_lib/rate-limit.js', 'utf8');
	const read = (bucket) => {
		const m = src.match(new RegExp(`getLimiter\\('${bucket}', \\{ limit: (\\d+), window: '([^']+)'`));
		expect(m, `${bucket} must be a real configured bucket`).toBeTruthy();
		return { limit: Number(m[1]), window: m[2] };
	};
	const revoke = read('home:revoke');
	const connect = read('home:connect');
	expect(revoke.limit).toBeGreaterThan(connect.limit);
	expect(revoke.limit).toBeLessThan(1000);
	// Not `local`: a per-instance counter multiplied by the instance count is the
	// bypass that makes a ceiling a decoration, which is why neither of these is.
	expect(src).toMatch(/getLimiter\('home:revoke', \{ limit: \d+, window: '[^']+' \}\)/);
});
