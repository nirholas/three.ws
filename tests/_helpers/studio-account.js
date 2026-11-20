// Test helper: the studio's creator tools (forge_free, rig_mesh, ...) need a
// signed-in three.ws account (api/_mcp-studio/dispatch.js CREATOR_TOOL_NAMES).
// Suites that exercise what happens past that gate dispatch as this account;
// tests/mcp-studio-creator-gate.test.js covers the anonymous refusal itself.

export const STUDIO_TEST_ACCOUNT = Object.freeze({
	userId: '9a8b7c6d-0000-4000-8000-00000000c0de',
	source: 'apikey',
	scope: 'avatars:read avatars:write',
});

/**
 * Wrap the studio dispatcher so every call carries the signed-in test account
 * unless the call passes its own `account` (null included).
 * @param {Function} dispatch api/_mcp-studio/dispatch.js dispatch
 */
export function signedInDispatch(dispatch) {
	return (msg, auth, req, opts = {}) =>
		dispatch(msg, auth, req, { ...opts, account: Object.hasOwn(opts, 'account') ? opts.account : STUDIO_TEST_ACCOUNT });
}
