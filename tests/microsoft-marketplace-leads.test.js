// Microsoft Marketplace lead destination (api/microsoft-marketplace/leads.js and
// api/_lib/microsoft-leads.js).
//
// Partner Center posts every lead for an offer to the HTTPS endpoint configured
// as its lead destination. It does not sign the request, so the long random
// token in the URL path is the only credential. These cases pin:
//
//   1. Payload validation for every documented lead source (AzureMarketplace,
//      AzurePortal, AppSource (SPZA)) and every documented action (INS, PLT,
//      DNC, Create), in both shapes Microsoft documents: the HTTPS endpoint
//      sample (bare LeadSource plus ActionCode) and the "Source-Action|Offer"
//      LeadSource format.
//   2. Token rejection: no token, a wrong token, and an unconfigured endpoint.
//   3. Idempotency: the same lead posted twice (a Partner Center retry) is
//      stored and announced once.
//   4. The per-IP rate limit answers 429 before anything is read or stored.
//   5. The owner message carries name, company, source, action and the admin
//      link, and never the email address or phone number.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = { storeLead: vi.fn(), processNewLead: vi.fn() };
vi.mock('../api/_lib/microsoft-leads.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		storeLead: (...a) => store.storeLead(...a),
		processNewLead: (...a) => store.processNewLead(...a),
	};
});

const leadIp = vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }));
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, limits: { ...actual.limits, msMarketplaceLeadIp: (...a) => leadIp(...a) } };
});

const {
	validateLeadPayload, parseLeadSource, parseLead, leadDedupeKey, leadTokenMatches,
	ownerMessage, LEAD_SOURCES, LEAD_ACTIONS,
} = await import('../api/_lib/microsoft-leads.js');
const { default: handler } = await import('../api/microsoft-marketplace/leads.js');

const TOKEN = 'ms-leads-test-token-0123456789abcdefghijklmnopqrstuv';

// The JSON example from Microsoft's "Lead management with an HTTPS endpoint" page.
function documentedSample(over = {}) {
	return {
		UserDetails: {
			FirstName: 'Some',
			LastName: 'One',
			Email: 'someone@contoso.com',
			Phone: '16175555555',
			Country: 'USA',
			Company: 'Contoso',
			Title: 'Esquire',
		},
		LeadSource: 'AzureMarketplace',
		ActionCode: 'INS',
		OfferTitle: 'Test Microsoft',
		Description: 'Test run through Power Automate',
		...over,
	};
}

function makeReq({ token = TOKEN, body = documentedSample(), ip = '203.0.113.7', method = 'POST' } = {}) {
	return {
		method,
		url: `/api/microsoft-marketplace/leads${token ? `?token=${token}` : ''}`,
		query: token ? { token } : {},
		headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
		socket: { remoteAddress: ip },
		body,
	};
}

function makeRes() {
	return {
		statusCode: 0,
		payload: null,
		headers: {},
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
		writeHead(code) { this.statusCode = code; return this; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		end(chunk) {
			if (chunk) { try { this.payload = JSON.parse(String(chunk)); } catch { this.payload = String(chunk); } }
			return this;
		},
	};
}

async function call(opts) {
	const res = makeRes();
	await handler(makeReq(opts), res);
	return res;
}

describe('validateLeadPayload: documented lead sources and actions', () => {
	it('accepts the HTTPS endpoint sample exactly as Microsoft documents it', () => {
		expect(validateLeadPayload(documentedSample())).toEqual({ ok: true, errors: [] });
	});

	for (const source of ['AzureMarketplace', 'AzurePortal', 'AppSource (SPZA)']) {
		for (const action of ['INS', 'PLT', 'DNC', 'Create']) {
			it(`accepts "${source}-${action}|publisher.offer" and parses source, action and offer`, () => {
				const body = documentedSample({ LeadSource: `${source}-${action}|threews.three-ws`, ActionCode: undefined });
				expect(validateLeadPayload(body).ok).toBe(true);
				const lead = parseLead(body);
				expect(lead.source).toBe(source === 'AppSource (SPZA)' ? 'AppSource' : source);
				expect(lead.action).toBe(action);
				expect(lead.publisherId).toBe('threews');
				expect(lead.offerId).toBe('three-ws');
			});
		}
	}

	it('exports the documented sets', () => {
		expect([...LEAD_SOURCES]).toEqual(['AzureMarketplace', 'AzurePortal', 'AppSource']);
		expect([...LEAD_ACTIONS]).toEqual(['INS', 'PLT', 'DNC', 'Create']);
	});

	it('rejects a body that is not an object', () => {
		expect(validateLeadPayload([documentedSample()]).ok).toBe(false);
		expect(validateLeadPayload('lead').ok).toBe(false);
		expect(validateLeadPayload(null).ok).toBe(false);
	});

	it('rejects a lead with no LeadSource', () => {
		const body = documentedSample();
		delete body.LeadSource;
		expect(validateLeadPayload(body).ok).toBe(false);
	});

	it('rejects documented fields with the wrong type', () => {
		expect(validateLeadPayload(documentedSample({ UserDetails: 'Contoso' })).ok).toBe(false);
		expect(validateLeadPayload(documentedSample({ ActionCode: 7 })).ok).toBe(false);
		const badEmail = documentedSample();
		badEmail.UserDetails.Email = 42;
		expect(validateLeadPayload(badEmail).ok).toBe(false);
	});

	it('keeps fields Microsoft adds later instead of rejecting them', () => {
		expect(validateLeadPayload(documentedSample({ CustomerTenantId: 'abc' })).ok).toBe(true);
	});
});

describe('parseLeadSource', () => {
	it('reads a bare source and takes the action from ActionCode', () => {
		expect(parseLeadSource('AzureMarketplace', 'PLT')).toMatchObject({ source: 'AzureMarketplace', action: 'PLT', publisherId: null, offerId: null });
	});

	it('normalizes the AppSource spellings', () => {
		expect(parseLeadSource('SPZA-PLT|a.b').source).toBe('AppSource');
		expect(parseLeadSource('AppSource-INS|a.b').source).toBe('AppSource');
	});

	it('keeps an unrecognized source as "other" so the raw lead is never lost', () => {
		expect(parseLeadSource('SomethingNew-XYZ|pub.offer')).toMatchObject({ source: 'other', action: 'XYZ', offerId: 'offer' });
	});

	it('splits on the first dot only, so offer ids that contain dots stay whole', () => {
		expect(parseLeadSource('AzurePortal-Create|docusign.3701c77e-1cfa.v2')).toMatchObject({ publisherId: 'docusign', offerId: '3701c77e-1cfa.v2' });
	});
});

describe('leadDedupeKey', () => {
	it('is stable regardless of key order and email case', () => {
		const a = documentedSample();
		const b = { Description: a.Description, OfferTitle: a.OfferTitle, ActionCode: 'INS', LeadSource: a.LeadSource, UserDetails: { ...a.UserDetails, Email: 'SomeOne@Contoso.com' } };
		expect(leadDedupeKey(a)).toBe(leadDedupeKey(b));
	});

	it('differs when the customer takes a different action', () => {
		expect(leadDedupeKey(documentedSample({ ActionCode: 'PLT' }))).not.toBe(leadDedupeKey(documentedSample()));
	});
});

describe('leadTokenMatches', () => {
	it('matches only the exact configured token', () => {
		expect(leadTokenMatches(TOKEN, TOKEN)).toBe(true);
		expect(leadTokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
		expect(leadTokenMatches('', TOKEN)).toBe(false);
		expect(leadTokenMatches(TOKEN, '')).toBe(false);
		expect(leadTokenMatches(undefined, undefined)).toBe(false);
	});
});

describe('ownerMessage', () => {
	it('names the lead, company, source and action with the admin link, and leaves out email and phone', () => {
		const lead = parseLead(documentedSample({ LeadSource: 'AzureMarketplace-PLT|threews.three-ws', ActionCode: undefined }));
		const msg = ownerMessage({ id: '7f1c0000-0000-4000-8000-000000000001', ...lead }, 'https://three.ws');
		expect(msg.text).toContain('Some One');
		expect(msg.text).toContain('Contoso');
		expect(msg.text).toContain('AzureMarketplace');
		expect(msg.text).toContain('Contact me');
		expect(msg.link).toBe('/admin/microsoft/leads?id=7f1c0000-0000-4000-8000-000000000001');
		expect(msg.text).toContain('https://three.ws/admin/microsoft/leads?id=7f1c0000-0000-4000-8000-000000000001');
		expect(msg.text).not.toContain('someone@contoso.com');
		expect(msg.text).not.toContain('16175555555');
	});
});

describe('POST /api/microsoft-marketplace/leads', () => {
	const saved = process.env.MS_MARKETPLACE_LEADS_TOKEN;

	beforeEach(() => {
		process.env.MS_MARKETPLACE_LEADS_TOKEN = TOKEN;
		leadIp.mockClear();
		leadIp.mockResolvedValue({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 });
		store.storeLead.mockReset();
		store.processNewLead.mockReset();
		store.storeLead.mockImplementation(async (body) => ({ inserted: true, lead: { id: 'lead-1', ...parseLead(body) } }));
		store.processNewLead.mockResolvedValue({ notified: ['in_app'], draft: 'ready' });
	});

	afterEach(() => {
		if (saved === undefined) delete process.env.MS_MARKETPLACE_LEADS_TOKEN;
		else process.env.MS_MARKETPLACE_LEADS_TOKEN = saved;
	});

	it('stores a documented lead, announces it and answers 200 with the lead id', async () => {
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(res.payload).toMatchObject({ ok: true, id: 'lead-1', duplicate: false });
		expect(store.storeLead).toHaveBeenCalledTimes(1);
		expect(store.processNewLead).toHaveBeenCalledTimes(1);
	});

	it('rejects a request with no token without storing anything', async () => {
		const res = await call({ token: null });
		expect(res.statusCode).toBe(401);
		expect(store.storeLead).not.toHaveBeenCalled();
	});

	it('rejects a wrong token without storing anything', async () => {
		const res = await call({ token: 'not-the-token' });
		expect(res.statusCode).toBe(401);
		expect(store.storeLead).not.toHaveBeenCalled();
	});

	it('answers 503 when the endpoint has no token configured, so it can never run open', async () => {
		delete process.env.MS_MARKETPLACE_LEADS_TOKEN;
		const res = await call();
		expect(res.statusCode).toBe(503);
		expect(store.storeLead).not.toHaveBeenCalled();
	});

	it('answers 400 for a payload that fails validation and stores nothing', async () => {
		const res = await call({ body: { UserDetails: 'nope' } });
		expect(res.statusCode).toBe(400);
		expect(res.payload.error).toBe('invalid_lead');
		expect(store.storeLead).not.toHaveBeenCalled();
	});

	it('acknowledges a repeated lead with 200 and does not announce it again', async () => {
		store.storeLead.mockImplementation(async (body) => ({ inserted: false, lead: { id: 'lead-1', ...parseLead(body) } }));
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(res.payload).toMatchObject({ ok: true, id: 'lead-1', duplicate: true });
		expect(store.processNewLead).not.toHaveBeenCalled();
	});

	it('answers 429 once the per-IP limit is spent, before the token or body is read', async () => {
		leadIp.mockResolvedValue({ success: false, limit: 60, remaining: 0, reset: Date.now() + 30_000 });
		const res = await call();
		expect(res.statusCode).toBe(429);
		expect(leadIp).toHaveBeenCalledWith('203.0.113.7');
		expect(store.storeLead).not.toHaveBeenCalled();
	});

	it('still answers 200 when notification or drafting throws, because the lead is already stored', async () => {
		store.processNewLead.mockRejectedValue(new Error('telegram down'));
		const res = await call();
		expect(res.statusCode).toBe(200);
		expect(res.payload.ok).toBe(true);
	});

	it('refuses GET', async () => {
		const res = await call({ method: 'GET' });
		expect(res.statusCode).toBe(405);
	});
});
