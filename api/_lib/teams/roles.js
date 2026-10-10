// Specialist roles, their permission ceilings, and the checks every team action
// runs through. Pure: no DB, no network, so the guarantees here ("a Researcher
// can never sign") are asserted directly in tests/teams-runtime.test.js.
//
// A member row stores the permissions it was granted, but the runtime never
// trusts that list on its own: effectivePermissions() intersects it with the
// role's ceiling, so a hand-edited row or a bad PATCH can never widen a role.
// Only the Trader's ceiling contains a signing permission.

export const ROLES = Object.freeze(['researcher', 'entry', 'trader', 'launcher', 'custom']);
export const FIXED_ROLES = Object.freeze(['researcher', 'entry', 'trader', 'launcher']);

export const PERMISSIONS = Object.freeze({
	'findings.read': 'Read the team findings board',
	'findings.write': 'Post findings to the board',
	'research.run': 'Run token research and post the verdict',
	'signals.scan': 'Scan recent launches against the entry strategy',
	'trade.quote': 'Quote and simulate trades without signing',
	'trade.execute': 'Sign and send trades from the team wallet, inside the spend policy',
	'launch.prepare': 'Prepare a launch plan for the owner to sign',
});

// Permissions that move funds or sign. Kept separate so a test and a reviewer
// can see at a glance which roles may ever hold one.
export const SIGNING_PERMISSIONS = Object.freeze(new Set(['trade.execute']));

const CEILINGS = Object.freeze({
	researcher: ['findings.read', 'findings.write', 'research.run'],
	entry: ['findings.read', 'findings.write', 'signals.scan'],
	trader: ['findings.read', 'findings.write', 'research.run', 'trade.quote', 'trade.execute'],
	launcher: ['findings.read', 'findings.write', 'launch.prepare'],
	custom: ['findings.read', 'findings.write', 'research.run', 'signals.scan', 'trade.quote', 'launch.prepare'],
});

export const ROLE_INFO = Object.freeze({
	researcher: {
		title: 'Researcher',
		blurb: 'Vets a token: mint authority, venue, holder structure, bundles, smart money. Posts a scored verdict the rest of the team cites.',
	},
	entry: {
		title: 'Entry',
		blurb: 'Watches finished launches against its entry strategy and posts setups worth acting on. It never trades.',
	},
	trader: {
		title: 'Trader',
		blurb: 'Executes only inside the spend policy, and only on a mint with a live research verdict it can cite.',
	},
	launcher: {
		title: 'Launcher',
		blurb: 'Prepares a launch plan and hands it to you to sign. It can never launch on its own.',
	},
	custom: {
		title: 'Specialist',
		blurb: 'An agent you added with a hand-picked, read-mostly permission set.',
	},
});

export class TeamError extends Error {
	constructor(status, code, message, detail = null) {
		super(message);
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}

export function isRole(role) {
	return ROLES.includes(role);
}

export function roleCeiling(role) {
	return CEILINGS[role] ? [...CEILINGS[role]] : [];
}

/** Default grant for a new member: the full ceiling of its role. */
export function defaultPermissions(role) {
	return roleCeiling(role);
}

/**
 * The permissions a member actually holds: what was granted, capped by the
 * role's ceiling. A null/absent grant means the role default.
 */
export function effectivePermissions(role, granted) {
	const ceiling = new Set(roleCeiling(role));
	const list = Array.isArray(granted) ? granted : roleCeiling(role);
	return [...new Set(list.filter((p) => ceiling.has(p)))];
}

/**
 * Validate a requested grant for a role. Unknown permissions and anything above
 * the ceiling are refused outright (rather than silently dropped) so the owner
 * learns why the grant did not stick.
 */
export function normalizeGrant(role, requested) {
	if (!isRole(role)) throw new TeamError(400, 'bad_role', `role must be one of ${ROLES.join(', ')}`);
	if (requested == null) return defaultPermissions(role);
	if (!Array.isArray(requested)) throw new TeamError(400, 'bad_permissions', 'permissions must be an array');
	const ceiling = new Set(roleCeiling(role));
	const out = [];
	for (const p of requested) {
		if (!Object.hasOwn(PERMISSIONS, p)) throw new TeamError(400, 'bad_permissions', `unknown permission: ${String(p).slice(0, 40)}`);
		if (!ceiling.has(p)) {
			throw new TeamError(403, 'permission_above_role', `a ${role} cannot hold ${p}`);
		}
		if (!out.includes(p)) out.push(p);
	}
	return out;
}

export function can(member, permission) {
	if (!member || member.status === 'removed') return false;
	return effectivePermissions(member.role, member.permissions).includes(permission);
}

/** Throw a 403 TeamError unless the member holds the permission. */
export function assertCan(member, permission) {
	if (!can(member, permission)) {
		const who = member?.role ? ROLE_INFO[member.role]?.title || member.role : 'This member';
		throw new TeamError(403, 'permission_denied', `${who} does not hold ${permission}`, { permission, role: member?.role || null });
	}
}

export function canSign(member) {
	return [...SIGNING_PERMISSIONS].some((p) => can(member, p));
}
