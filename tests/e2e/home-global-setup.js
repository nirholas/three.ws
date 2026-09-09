/**
 * Everything the home lane's e2e journeys need, before the first browser opens.
 *
 * The journeys drive the REAL product against a REAL Home Assistant, so the
 * stack is three processes and no stubs anywhere in it:
 *
 *   Home Assistant   a container from scripts/home-test-instance.mjs, seeded
 *   the API          node server/index.mjs, the same handlers Cloud Run runs
 *   the frontend     vite, with DEV_API_PROXY pointed at that API
 *
 * The house lives on 127.0.0.1, which both the browser and the server treat as
 * reachable: `normalizeBaseUrl` exempts loopback from the private-host refusal
 * precisely so a developer running Home Assistant on this machine still works.
 * That exemption is what makes an honest end-to-end run possible here, and
 * journey 10 proves the refusal still fires for every other private host.
 *
 * Two accounts are provisioned, an owner and a guest, because journey 7 is
 * about one member being refused something the other is allowed. They are
 * created through the real signup page ONCE and then reused for every later
 * run: account creation is rate limited to five per hour per IP, so a setup
 * that registered on every run would work twice and then start reporting the
 * rate limiter as a product failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireHomeInstance } from '../_helpers/home-instance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Where the stack's details land. Gitignored: it holds a real access token.
 *
 * Keyed by HOME_LIVE_NAME, the same name that already gives each lane its own
 * Home Assistant container. This worktree is shared by concurrent agents and
 * more than one home run is often in flight at once; a single shared path meant
 * the last setup to finish silently repointed every other run at ITS house, and
 * the specs then drove the wrong Home Assistant while reporting product bugs.
 * One file per lane costs nothing and removes the whole class.
 */
export const LANE = process.env.HOME_LIVE_NAME || 'e2e';
export const STACK_FILE = path.join(ROOT, `.ha-config-e2e-stack${LANE === 'e2e' ? '' : `.${LANE}`}.json`);
/**
 * The reusable QA accounts, one file per lane.
 *
 * Sharing one account across concurrent lanes cannot work: a plan carries a
 * fixed number of homes (one, on the account tier these are created at), so the
 * second lane to connect is refused with "this account is at its home limit"
 * and the only way to make room is to evict the house a peer run is mid-journey
 * inside. Each lane gets its own account, reused for every later run of that
 * lane, so the registration cost is paid once and never again.
 */
const ACCOUNTS_FILE = path.join(ROOT, `.ha-config-e2e-accounts${LANE === 'e2e' ? '' : `.${LANE}`}.json`);

/**
 * Which accounts to provision. Registration is capped at five per hour per IP,
 * so a run that only signs in as the owner should not spend one of five on a
 * guest it will never use.
 */
const ROLES = (process.env.HOME_E2E_ROLES || 'owner,guest')
	.split(',')
	.map((role) => role.trim())
	.filter(Boolean);

export default async function globalSetup(config) {
	process.env.HOME_LIVE = process.env.HOME_LIVE || '1';
	process.env.HOME_LIVE_NAME = process.env.HOME_LIVE_NAME || LANE;

	const origin = config?.projects?.[0]?.use?.baseURL || 'http://localhost:3020';

	const home = await acquireHomeInstance({ timeout: 900_000 });
	console.log(`[home-e2e] Home Assistant ${home.version || 'unknown'} at ${home.baseUrl}`);

	const accounts = await ensureAccounts(origin);
	await raiseHomeCeiling(accounts);
	fs.writeFileSync(
		STACK_FILE,
		`${JSON.stringify({ home, accounts, origin, lane: LANE, startedAt: new Date().toISOString() }, null, '\t')}\n`,
	);
	console.log(`[home-e2e] accounts ready: ${ROLES.map((role) => accounts[role]?.username).filter(Boolean).join(', ')}`);
}

/**
 * Give the QA accounts room for more than one house.
 *
 * The free plan covers one home, which is correct product behaviour and is the
 * exact thing order 19's plan-ceiling state exists to render. It is also a hard
 * stop for this harness: every lane on this machine shares these two accounts,
 * so the first lane to connect its house takes the only slot and every other
 * lane is refused 402 by the ceiling. That reads as a broken connect flow and
 * is a fixture collision, and it cost three runs to see.
 *
 * The fix uses the platform's own mechanism rather than inventing a test-only
 * bypass: `home_plan_overrides` is exactly "this account has these numbers, and
 * here is the sentence saying why". Nothing about the gate is relaxed, no code
 * path is skipped, and the ceiling itself is still asserted (against a stub, in
 * home-connect.spec.js) where it can be reached deterministically. Removing the
 * row returns the accounts to the free plan.
 */
async function raiseHomeCeiling(accounts) {
	const [{ sql }, { setAccountOverride }] = await Promise.all([
		import('../../api/_lib/db.js'),
		import('../../api/_lib/home/entitlements.js'),
	]);
	for (const role of ['owner', 'guest']) {
		const rows = await sql`select id from users where email = ${accounts[role].email}`;
		if (!rows.length) continue;
		await setAccountOverride({
			userId: rows[0].id,
			limits: { homes: 25, streams: 25, members: 25 },
			note: 'Automated QA account for the home e2e lane (tests/e2e/home-global-setup.js). Concurrent lanes on one machine share these accounts, and the free one-home ceiling would let only one lane connect at a time.',
		});
	}
	console.log('[home-e2e] QA accounts have room for concurrent lanes');
}

/**
 * Real three.ws accounts, created through the real signup page and kept.
 *
 * A stored account is verified by actually logging in with it rather than
 * assumed to still exist, so a database that was reset since the last run
 * re-provisions instead of failing every journey with a confusing 401.
 */
async function ensureAccounts(origin) {
	const stored = readJson(ACCOUNTS_FILE) || {};
	const accounts = { ...stored };

	for (const role of ROLES) {
		if (accounts[role] && (await loginWorks(origin, accounts[role]))) continue;
		accounts[role] = await register(origin, role);
		// Write after EVERY account, not once at the end. Registration is limited
		// to five per hour per IP, and a run that created the owner and then died
		// on the guest used to throw the owner away and burn one of the five for
		// nothing.
		fs.writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(accounts, null, '\t')}\n`, { mode: 0o600 });
	}
	return accounts;
}

/**
 * Whether a stored account still logs in.
 *
 * The distinction between "this account is gone" and "the server would not
 * answer me just now" is worth money here. Registration is capped at five per
 * hour per IP, and concurrent agents on this box all log in as the same QA
 * account, so a login can come back 429 or 5xx while the account is perfectly
 * fine. Treating that as gone re-registers, burns the hour's budget, and the
 * NEXT run then fails at setup reporting the rate limiter as a product bug.
 * Only an outright rejection counts as gone.
 */
async function loginWorks(origin, account) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const res = await fetch(`${origin}/api/auth/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin },
			body: JSON.stringify({ email: account.email, password: account.password }),
			signal: AbortSignal.timeout(30_000),
		}).catch(() => null);

		if (res?.ok) return true;
		// 401/403: the credentials really are no good, so re-provision.
		if (res && res.status !== 429 && res.status < 500) return false;
		// Anything else is the server being busy or unreachable. Back off and ask
		// again rather than spending one of five registrations on a guess.
		await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
	}
	// Still no clear answer after three tries. Keeping the account is the safe
	// side of this bet: if it really is dead, the journeys fail with a plain 401
	// that says so, which is cheaper than an hour of rate-limited setups.
	return true;
}

/**
 * Create one account against the real registration endpoint.
 *
 * This is the same request the register page makes, with the same terms
 * acceptance, and it is made directly rather than by driving the page: a
 * headless Chromium loading the full signup bundle is the heaviest thing in
 * this setup, and on a busy machine it crashes the page before the form is
 * filled. What is under test in this lane is the home surface; the signup page
 * has its own specs.
 */
async function register(origin, role) {
	const suffix = `${role}-${Date.now().toString(36)}`;
	const account = {
		username: `home-e2e-${suffix}`,
		email: `home-e2e-${suffix}@qa.three.ws`,
		password: `Home-e2e-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`,
	};

	const res = await fetch(`${origin}/api/auth/register`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body: JSON.stringify({ email: account.email, password: account.password, tosAccepted: true }),
		signal: AbortSignal.timeout(90_000),
	}).catch((cause) => {
		throw new Error(`could not reach ${origin}/api/auth/register. The API server died during this run; check the [WebServer] output for a SIGTERM.`, { cause });
	});

	if (!res.ok) {
		const body = await res.text().catch(() => '');
		if (res.status === 429) {
			throw new Error(
				`registration is rate limited (five per hour per IP). The accounts in ${path.basename(ACCOUNTS_FILE)} are reused whenever they still log in; delete that file only when you have budget to spare.`,
			);
		}
		throw new Error(`registering the ${role} account returned ${res.status}: ${body.slice(0, 200)}`);
	}
	return account;
}

function readJson(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}
