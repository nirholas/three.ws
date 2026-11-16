// Pure logic for /enterprise/admin-consent: the consent URL, the redirect
// Microsoft sends the administrator back with, and plain-language permissions.
// No DOM and no network, so tests/enterprise-admin-consent.test.js runs it as is.

export const LOGIN_BASE = 'https://login.microsoftonline.com';
// ".default" asks Microsoft to grant exactly the permissions configured on the
// app registration, which is how a tenant-wide consent for the app is expressed.
export const CONSENT_SCOPE = 'https://graph.microsoft.com/.default';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** What each scope lets three.ws do, written for an administrator. */
export const PERMISSION_COPY = {
	openid: ['Sign in', 'Lets people sign in to three.ws with their work account. three.ws receives a unique id for the person and your tenant id.'],
	profile: ['View basic profile', 'Their name, so the account and team pages show who they are.'],
	email: ['View email address', 'Their email address, used to find their existing three.ws account. An address that Microsoft does not vouch for is never matched to an account.'],
	offline_access: ['Stay signed in', 'Lets three.ws renew the sign-in without asking again. It does not give access to mail, files or chats.'],
	'User.Read': ['Read their own profile', 'Reads the signed-in person\'s own profile from Microsoft Graph. It cannot read other people or anything in your directory.'],
};

/** The tenant part of the URL: "organizations" (any work or school tenant), a tenant id, or a verified domain. */
export function normalizeTenant(input) {
	const v = String(input ?? '').trim();
	if (!v) return 'organizations';
	if (GUID.test(v)) return v.toLowerCase();
	if (DOMAIN.test(v)) return v.toLowerCase();
	return null;
}

export function buildConsentUrl({ clientId, redirectUri, tenant = 'organizations' }) {
	const url = new URL(`${LOGIN_BASE}/${tenant}/v2.0/adminconsent`);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('scope', CONSENT_SCOPE);
	url.searchParams.set('redirect_uri', redirectUri);
	return url.toString();
}

export function permissionRows(scopes) {
	return scopes.map((scope) => {
		const [title, detail] = PERMISSION_COPY[scope] || [scope, 'A permission requested by the three.ws sign-in app.'];
		return { scope, title, detail };
	});
}

/**
 * Read the query string Microsoft appends to the redirect URI.
 * Success: `tenant` and `admin_consent=True`. Failure: `error` and `error_description`.
 * @returns {{kind:'none'}|{kind:'success',tenantId:string}|{kind:'error',code:'declined'|'admin_required'|'failed',detail:string}}
 */
export function parseConsentRedirect(search) {
	const q = new URLSearchParams(search);
	const err = q.get('error');
	if (err) {
		const desc = String(q.get('error_description') || '');
		const code = err === 'access_denied' ? 'declined' : /AADSTS(65004|90094|90008)|administrator|admin/i.test(desc) ? 'admin_required' : 'failed';
		return { kind: 'error', code, detail: desc.split(/\r?\n/)[0].slice(0, 300) };
	}
	if (q.has('admin_consent') || q.has('tenant')) {
		const tenant = q.get('tenant');
		if (String(q.get('admin_consent')).toLowerCase() === 'true' && tenant && GUID.test(tenant)) {
			return { kind: 'success', tenantId: tenant.toLowerCase() };
		}
		return { kind: 'error', code: 'failed', detail: 'Microsoft did not confirm consent for a tenant.' };
	}
	return { kind: 'none' };
}
