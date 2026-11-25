// Vertex answers 403 for an unpaid billing account and for a project with no
// paid billing as well as for a revoked token. The translate CLI used to throw
// the same "credentials are not valid" message for all three, which sent the
// operator to `gcloud auth login` on 2026-11-25 when the real cause, named in
// the response body, was "There are issues with your billing account".

import { describe, it, expect } from 'vitest';
import { vertexAuthError, isFatalAuthFailure } from '../scripts/i18n-translate.mjs';

describe('vertexAuthError', () => {
	it("leads with Google's own reason from the response body", () => {
		const body = JSON.stringify([
			{ error: { code: 403, message: 'There are issues with your billing account, please resolve / pay your outstanding balance for project: projects/1', status: 'PERMISSION_DENIED' } },
		]);
		const err = vertexAuthError(403, body);
		expect(err.message).toMatch(/^vertex 403: There are issues with your billing account/);
		expect(isFatalAuthFailure(err)).toBe(true);
	});

	it('falls back to the credentials hint when the body carries no message', () => {
		const err = vertexAuthError(401, '');
		expect(err.message).toMatch(/^vertex 401: credentials are not valid even after re-minting/);
		expect(err.message).toMatch(/gcloud auth login/);
		expect(isFatalAuthFailure(err)).toBe(true);
	});

	it('keeps an unparseable body readable instead of dropping it', () => {
		const err = vertexAuthError(403, '<html>  Forbidden \n</html>');
		expect(err.message).toContain('<html> Forbidden </html>');
	});
});
