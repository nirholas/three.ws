/**
 * One way for a live test to get a real Home Assistant.
 *
 * Before this helper each live test in the home lane carried its own paragraph
 * of setup instructions, and the instances they described had drifted apart:
 * one had scenes, one had a lock exposed to Assist, one had neither, so a test
 * could pass for a reason nobody had written down. Every live test in the lane
 * now calls `acquireHomeInstance()` and gets the same seeded house.
 *
 * Two ways in, and neither runs by default, because `npm test` must not need
 * Docker:
 *
 *   HOME_ASSISTANT_URL=... HOME_ASSISTANT_TOKEN=...   point at a house you have
 *   HOME_LIVE=1                                        let the harness make one
 *
 * The harness path shares ONE named container across every test file in the
 * run (vitest gives each file its own fork, and building a Home Assistant per
 * fork would cost minutes and a gigabyte each). Nothing here ever tears that
 * instance down: it is the caller's, and `npm run home:instance:down` removes
 * it when the run is over.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = path.join(ROOT, 'scripts', 'home-test-instance.mjs');

/**
 * The instance this caller's lane reuses, read at call time and not at import.
 *
 * The distinction is load-bearing and cost a run to find. `home-global-setup.js`
 * imports this module and only then sets `HOME_LIVE_NAME`, so a constant
 * evaluated at import saw the default while the setup, the stack file and the
 * accounts file all saw `e2e`. The lane then drove container
 * `three-ws-home-test-lane` while calling itself the `e2e` lane, and
 * `resetHomes` (which clears only the homes on THIS lane's house, by base URL)
 * stopped recognising the homes the previous run had created. On a free plan
 * that is a hard stop: the account still held a home from the last run, so the
 * next connect was refused 402 by the plan ceiling, which reads as a product
 * bug and is a name mismatch.
 */
function instanceName() {
	return process.env.HOME_LIVE_NAME || 'lane';
}

/**
 * Whether the live tier should run at all. Synchronous on purpose: vitest needs
 * the skip decision before any hook has had a chance to start a container.
 */
export function liveHomeAvailable() {
	if (process.env.HOME_ASSISTANT_URL && process.env.HOME_ASSISTANT_TOKEN) return true;
	return isTruthy(process.env.HOME_LIVE);
}

/**
 * A connected-ready house: `{ baseUrl, token, version, seed }`.
 *
 * Call it from `beforeAll` with a generous timeout. A cold Home Assistant boot
 * plus seeding is around two minutes; every subsequent caller in the same run
 * reuses the container and returns in about a second.
 */
export async function acquireHomeInstance({ timeout = 600_000 } = {}) {
	if (process.env.HOME_ASSISTANT_URL && process.env.HOME_ASSISTANT_TOKEN) {
		const baseUrl = process.env.HOME_ASSISTANT_URL.replace(/\/+$/, '');
		allowLocalInstance(baseUrl);
		return {
			baseUrl,
			token: process.env.HOME_ASSISTANT_TOKEN,
			version: null,
			seed: null,
			container: null,
			managed: false,
		};
	}
	if (!isTruthy(process.env.HOME_LIVE)) {
		throw new Error('No live Home Assistant: set HOME_ASSISTANT_URL + HOME_ASSISTANT_TOKEN, or HOME_LIVE=1.');
	}

	const result = await runHarness(['--up', '--onboard', '--seed', '--json', '--name', instanceName()], { timeout });
	if (!result.ok) throw new Error(`home-test-instance failed: ${result.error}`);
	allowLocalInstance(result.baseUrl);
	return {
		baseUrl: result.baseUrl,
		token: result.token,
		version: result.haVersion,
		seed: result.seed || null,
		// The container this house runs in, carried through so a journey can stop
		// and start the real house. Losing a connection is a state the product
		// draws, and the only honest way to reach it is to take the house away.
		// A house supplied through the environment has no container we own, which
		// is why the field is null rather than guessed.
		container: result.container || null,
		managed: true,
	};
}

/**
 * Open the reachability seam for a house that lives on a private address.
 *
 * A test that drives a route which dials the house from OUR side goes through
 * `api/_lib/home-url-guard.js`, and that guard refuses loopback and RFC1918 by
 * design: it is the SSRF control. Every house this harness can produce is on
 * 127.0.0.1, so without the seam those routes fail at the dial and answer 502.
 *
 * That 502 does not read as a missing flag. It reads as the route being broken,
 * and it has cost this lane at least one investigation: an unconfirmed
 * `home:act` call that answers `409 needs_confirmation` with the seam open was
 * reported as a 409-to-502 regression, reproduced across two instances, when
 * both runs were simply dialling a loopback house through the production guard.
 * Remembering an environment variable is not a control, so the harness sets it
 * for the address it just handed out instead of asking every caller to.
 *
 * Narrow on purpose:
 *
 *   * Only for a PRIVATE literal. A public house needs no seam and never gets
 *     one from here.
 *   * Only in this process, and only for tests. The seam is inert on Cloud Run
 *     regardless: the guard also requires `K_SERVICE` to be absent.
 *   * The security suite proves the shipped guard by re-importing it with the
 *     seam forced off and `K_SERVICE` present, so nothing here can make an SSRF
 *     check pass that would fail in production.
 */
function allowLocalInstance(baseUrl) {
	if (process.env.HOME_ALLOW_LOCAL_INSTANCE === '1') return;
	let host;
	try {
		host = new URL(baseUrl).hostname;
	} catch {
		return;
	}
	if (!isPrivateLiteral(host)) return;
	process.env.HOME_ALLOW_LOCAL_INSTANCE = '1';
}

/**
 * Arm the seam at IMPORT time, not just when the house is handed out.
 *
 * `allowLocalInstance` above runs inside `acquireHomeInstance`, which a test
 * calls from `beforeAll`. The guard reads the seam ONCE, at module load, and
 * that is a deliberate security property of it: no request can turn it on. The
 * two facts collide whenever a test file imports a route handler before it asks
 * for a house, which `tests/api-home.test.js` does (handlers in a file-level
 * `beforeAll`, the house in a nested one). The guard is then already frozen with
 * the seam off, every dial of the loopback house is refused, and the whole live
 * block fails with `502 unreachable` from routes that are working perfectly.
 *
 * That failure has now been misread twice, most expensively as a 409-to-502
 * regression in the confirmation protocol, reproduced against two houses, when
 * the confirmation gate was never reached at all. See the "guard's own failure
 * mode" section of docs/home-security.md.
 *
 * So the decision is made here, before this module's importer can import
 * anything else. It is armed only when the caller has ALREADY asked for a live
 * house, and only for an address that is private:
 *
 *   * `HOME_LIVE` truthy: the harness builds houses on 127.0.0.1 and nowhere
 *     else, so the address is known before it exists.
 *   * `HOME_ASSISTANT_URL` set: armed only if that host is a private literal. A
 *     public house needs no seam and never gets one.
 *
 * It cannot make a security check pass that would fail in production: check 7
 * re-imports the guard with the seam forced off and `K_SERVICE` present, which
 * is the shape the live service runs in, and the guard itself refuses to honour
 * the seam on a Cloud Run revision regardless of what is set here.
 */
export function armLocalInstanceSeam() {
	if (process.env.K_SERVICE) return;
	if (process.env.HOME_ASSISTANT_URL) {
		allowLocalInstance(process.env.HOME_ASSISTANT_URL);
		return;
	}
	if (isTruthy(process.env.HOME_LIVE)) process.env.HOME_ALLOW_LOCAL_INSTANCE = '1';
}

// Also run on import, for a caller that reaches this module outside vitest (a
// script, or a fork whose setup file did not run). Idempotent, and it is NOT
// the load-bearing call: importing this helper is only early enough for a test
// file that imports it above whatever pulls in the guard, and
// tests/home-runtime-live.test.js imports api/_lib/home/runtime.js first. The
// call that always wins the race is in tests/setup.home-seam.js, which vitest
// runs before it imports the test module at all.
armLocalInstanceSeam();

/** Loopback, RFC1918, CGNAT and link-local, as literals. No DNS, no guessing. */
function isPrivateLiteral(host) {
	const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
	if (bare === 'localhost' || bare === '::1') return true;
	const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (!v4) return false;
	const [a, b] = v4.slice(1).map(Number);
	if (a === 127 || a === 10 || a === 0) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 169 && b === 254) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	return false;
}

/**
 * A live entity id of the given domain, read from the house itself rather than
 * assumed. A test that hardcodes `light.bed_light` is a test that breaks the
 * day someone points the lane at their own home.
 */
export async function pickEntity(instance, domain, predicate = () => true) {
	const states = await readStates(instance);
	const found = states.find((s) => s.entity_id.startsWith(`${domain}.`) && predicate(s));
	return found ? found.entity_id : null;
}

/** Every state in the house, straight from the REST API. */
export async function readStates(instance) {
	const res = await fetch(`${instance.baseUrl}/api/states`, {
		headers: { authorization: `Bearer ${instance.token}` },
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new Error(`GET /api/states returned ${res.status}`);
	return res.json();
}

/**
 * One entity's state, read back from Home Assistant.
 *
 * The lane's confirmation tests assert on this and never on our own UI text: a
 * card that says "unlocked" proves nothing about a door.
 */
export async function readState(instance, entityId) {
	const res = await fetch(`${instance.baseUrl}/api/states/${encodeURIComponent(entityId)}`, {
		headers: { authorization: `Bearer ${instance.token}` },
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new Error(`GET /api/states/${entityId} returned ${res.status}`);
	const body = await res.json();
	return body.state;
}

/**
 * Wait until an entity reaches one of the given states, polling Home Assistant.
 *
 * This is the only correct way to wait in this lane. A fixed sleep is how a
 * suite that guards a door becomes a suite people ignore.
 */
export async function waitForState(instance, entityId, expected, { timeout = 20_000, interval = 250 } = {}) {
	const wanted = new Set(Array.isArray(expected) ? expected : [expected]);
	const deadline = Date.now() + timeout;
	let last = null;
	while (Date.now() < deadline) {
		last = await readState(instance, entityId).catch(() => null);
		if (last && wanted.has(last)) return last;
		await new Promise((r) => setTimeout(r, interval));
	}
	throw new Error(`${entityId} was "${last}" after ${Math.round(timeout / 1000)}s, expected one of ${[...wanted].join(', ')}`);
}

/**
 * Take the house off the network, keeping everything in it.
 *
 * The state a connected home enters when its house loses power is one the
 * product has to render, and the only honest way to reach it is to stop the
 * real container. `--stop` keeps the config directory, the access token and
 * every seeded entity, so `startHomeInstance` puts the same house back in
 * about fifteen seconds rather than paying for another onboarding.
 */
export async function stopHomeInstance({ name = instanceName(), timeout = 120_000 } = {}) {
	const result = await runHarness(['--stop', '--json', '--name', name], { timeout });
	if (!result.ok) throw new Error(`stopping the home instance failed: ${result.error}`);
	return result;
}

/** Put the stopped house back, and wait until it reports itself running. */
export async function startHomeInstance({ name = instanceName(), timeout = 300_000 } = {}) {
	const result = await runHarness(['--start', '--json', '--name', name], { timeout });
	if (!result.ok) throw new Error(`starting the home instance failed: ${result.error}`);
	return result;
}

/** Put an entity back the way the test found it, for the next test in the file. */
export async function setState(instance, domain, service, entityId) {
	const res = await fetch(`${instance.baseUrl}/api/services/${domain}/${service}`, {
		method: 'POST',
		headers: { authorization: `Bearer ${instance.token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ entity_id: entityId }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new Error(`${domain}.${service} on ${entityId} returned ${res.status}`);
}

function isTruthy(value) {
	return Boolean(value) && value !== '0' && value !== 'false';
}

function runHarness(args, { timeout }) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [HARNESS, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`home-test-instance timed out after ${Math.round(timeout / 1000)}s`));
		}, timeout);
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (err += d));
		child.on('error', reject);
		child.on('close', () => {
			clearTimeout(timer);
			try {
				resolve(JSON.parse(out));
			} catch {
				reject(new Error(`home-test-instance produced no JSON. stderr: ${err.trim().split('\n').slice(-4).join(' ')}`));
			}
		});
	});
}
