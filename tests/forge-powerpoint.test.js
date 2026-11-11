// The client side of the PowerPoint export: the filename it saves under and
// the sentence it shows the user for each failure the endpoint can return.

import { describe, expect, it } from 'vitest';

import { filenameFromDisposition, pptxErrorMessage } from '../src/forge-powerpoint.js';

describe('filenameFromDisposition', () => {
	it('reads the quoted filename the endpoint sends', () => {
		expect(filenameFromDisposition('attachment; filename="a-brass-lantern.pptx"')).toBe(
			'a-brass-lantern.pptx',
		);
	});

	it('prefers the RFC 5987 form and decodes it', () => {
		expect(
			filenameFromDisposition(
				`attachment; filename="lantern.pptx"; filename*=UTF-8''caf%C3%A9-lantern.pptx`,
			),
		).toBe('café-lantern.pptx');
	});

	it('falls back to the plain form when the encoded form is malformed', () => {
		expect(
			filenameFromDisposition(`attachment; filename*=UTF-8''bad%E0%A4; filename="ok.pptx"`),
		).toBe('ok.pptx');
	});

	it('returns null without a header', () => {
		expect(filenameFromDisposition(null)).toBeNull();
		expect(filenameFromDisposition('attachment')).toBeNull();
	});
});

describe('pptxErrorMessage', () => {
	it('tells the owner of a private model how to export it', () => {
		expect(pptxErrorMessage(404, { error: 'creation_not_found' })).toMatch(/make it unlisted/);
	});

	it('passes the server sentence through when a just-generated model left storage', () => {
		expect(pptxErrorMessage(404, { error: 'model_not_found', error_description: 'That model is no longer in storage. Generate it again.' })).toBe(
			'That model is no longer in storage. Generate it again.',
		);
	});

	it('asks the user to wait when rate limited', () => {
		expect(pptxErrorMessage(429)).toMatch(/Wait a moment/);
	});

	it('passes the server sentence through for model problems', () => {
		const error_description = 'This model is over 100 MB. Use Insert > 3D Models in PowerPoint.';
		expect(pptxErrorMessage(413, { error_description })).toBe(error_description);
		expect(pptxErrorMessage(422, { message: 'Unreadable model.' })).toBe('Unreadable model.');
		expect(pptxErrorMessage(502, {})).toBe('This model could not be put on a slide.');
	});

	it('gives a retry hint for other server errors and keeps unknown statuses readable', () => {
		expect(pptxErrorMessage(500, { error_description: 'stack trace' })).toMatch(/Try again in a minute/);
		expect(pptxErrorMessage(418)).toBe('The export failed (418). Try again.');
	});
});
