// OneDrive and SharePoint plumbing behind Forge's "From OneDrive or SharePoint"
// photo picker and "Save to OneDrive" export (src/microsoft-graph/onedrive-core.js):
// the File Picker v8 message protocol, the Graph upload-session chunker, and
// the mapping from Graph and MSAL failures to messages a person can act on.

import { describe, expect, it, vi } from 'vitest';

import {
	CHUNK_UNIT,
	CONSUMER_PICKER_BASE,
	DEFAULT_CHUNK_SIZE,
	GRAPH_BASE,
	MSA_TENANT_ID,
	SIMPLE_UPLOAD_MAX,
	OneDriveError,
	buildPickerOptions,
	businessPickerBase,
	contentRange,
	createPickerChannel,
	downloadPickedImage,
	graphRequest,
	graphResponseError,
	isConsumerAccount,
	isPickerInitialize,
	msalError,
	needsInteraction,
	nextExpectedStart,
	normalizeImageType,
	pickedItemRef,
	pickerActionUrl,
	pickerTokenScopes,
	planChunks,
	retryAfterMs,
	safeDriveFileName,
	uploadToFolder,
} from '../src/microsoft-graph/onedrive-core.js';

const noSleep = () => Promise.resolve();

function jsonResponse(status, body, headers = {}) {
	return new Response(body == null ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

describe('accounts and picker configuration', () => {
	it('tells a personal account from a work account by tenant', () => {
		expect(isConsumerAccount({ tenantId: MSA_TENANT_ID })).toBe(true);
		expect(isConsumerAccount({ idTokenClaims: { tid: MSA_TENANT_ID.toUpperCase() } })).toBe(true);
		expect(isConsumerAccount({ tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47' })).toBe(false);
		expect(isConsumerAccount(null)).toBe(false);
	});

	it('derives the work picker host from the OneDrive web URL', () => {
		expect(businessPickerBase('https://contoso-my.sharepoint.com/personal/ada_contoso_com/Documents')).toBe(
			'https://contoso-my.sharepoint.com',
		);
		expect(() => businessPickerBase('https://evil.example.com/personal/x')).toThrow(OneDriveError);
		expect(() => businessPickerBase('not a url')).toThrow(/OneDrive/);
	});

	it('asks for the scopes Microsoft documents per account type and resource', () => {
		expect(pickerTokenScopes({ resource: 'https://x' }, { consumer: true })).toEqual(['OneDrive.ReadWrite']);
		expect(pickerTokenScopes({ type: 'SharePoint', resource: 'https://contoso-my.sharepoint.com/personal/a' }, { consumer: false })).toEqual([
			'https://contoso-my.sharepoint.com/.default',
		]);
		expect(pickerTokenScopes({ type: 'Graph', resource: 'https://graph.microsoft.com' }, { consumer: false })).toEqual([
			'https://graph.microsoft.com/.default',
		]);
		expect(() => pickerTokenScopes({ type: 'SharePoint', resource: '' }, { consumer: false })).toThrow(OneDriveError);
	});

	it('configures a multi-select image picker for photos', () => {
		const o = buildPickerOptions({ channelId: 'c1', origin: 'https://three.ws', mode: 'files', consumer: false, maximumCount: 6 });
		expect(o.sdk).toBe('8.0');
		expect(o.authentication).toEqual({});
		expect(o.messaging).toEqual({ origin: 'https://three.ws', channelId: 'c1' });
		expect(o.typesAndSources.mode).toBe('files');
		expect(o.typesAndSources.filters).toEqual(['.png', '.jpg', '.jpeg', '.webp']);
		expect(o.typesAndSources.pivots.sharedLibraries).toBe(true);
		expect(o.selection).toEqual({ mode: 'multiple', maximumCount: 6 });
		expect(o.commands.browseThisDevice.enabled).toBe(false);
	});

	it('configures a single folder picker for saving, with write access only', () => {
		const o = buildPickerOptions({ channelId: 'c2', origin: 'https://three.ws', mode: 'folders', consumer: true });
		expect(o.typesAndSources.mode).toBe('folders');
		expect(o.typesAndSources.filters).toBeUndefined();
		expect(o.typesAndSources.access).toEqual({ mode: 'read-write' });
		expect(o.typesAndSources.pivots.myOrganization).toBeUndefined();
		expect(o.selection).toEqual({ mode: 'single' });
		expect(o.commands.pick.label).toBe('Save here');
	});

	it('builds the FilePicker.aspx action URL with the options in the query', () => {
		const opts = { sdk: '8.0' };
		const url = new URL(pickerActionUrl(`${CONSUMER_PICKER_BASE}/`, opts, 'en-us'));
		expect(url.origin + url.pathname).toBe('https://onedrive.live.com/picker/_layouts/15/FilePicker.aspx');
		expect(JSON.parse(url.searchParams.get('filePicker'))).toEqual(opts);
		expect(url.searchParams.get('locale')).toBe('en-us');
	});
});

describe('picker message protocol', () => {
	it('accepts initialize only from the picker window on our channel with a port', () => {
		const win = {};
		const port = {};
		const ok = { source: win, data: { type: 'initialize', channelId: 'c' }, ports: [port] };
		expect(isPickerInitialize(ok, { channelId: 'c', expectedSource: win })).toBe(true);
		expect(isPickerInitialize({ ...ok, source: {} }, { channelId: 'c', expectedSource: win })).toBe(false);
		expect(isPickerInitialize({ ...ok, data: { type: 'initialize', channelId: 'other' } }, { channelId: 'c', expectedSource: win })).toBe(false);
		expect(isPickerInitialize({ ...ok, ports: [] }, { channelId: 'c', expectedSource: win })).toBe(false);
	});

	it('acknowledges then answers authenticate with a token', async () => {
		const sent = [];
		const getToken = vi.fn().mockResolvedValue('tok');
		const handle = createPickerChannel({ post: (m) => sent.push(m), getToken, onPick: vi.fn(), onClose: vi.fn() });
		await handle({ type: 'command', id: '7', data: { command: 'authenticate', resource: 'https://contoso-my.sharepoint.com', type: 'SharePoint' } });
		expect(getToken).toHaveBeenCalledWith(expect.objectContaining({ command: 'authenticate' }));
		expect(sent).toEqual([
			{ type: 'acknowledge', id: '7' },
			{ type: 'result', id: '7', data: { result: 'token', token: 'tok' } },
		]);
	});

	it('reports unableToObtainToken when the token lookup fails', async () => {
		const sent = [];
		const handle = createPickerChannel({
			post: (m) => sent.push(m),
			getToken: () => Promise.reject(new Error('consent needed')),
			onPick: vi.fn(),
			onClose: vi.fn(),
		});
		await handle({ type: 'command', id: '1', data: { command: 'authenticate' } });
		expect(sent[1]).toEqual({ type: 'result', id: '1', data: { result: 'error', error: { code: 'unableToObtainToken', message: 'consent needed' } } });
	});

	it('hands picked items over and answers success, or unusableItem when they fail', async () => {
		const sent = [];
		const onPick = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('not a photo'));
		const handle = createPickerChannel({ post: (m) => sent.push(m), getToken: vi.fn(), onPick, onClose: vi.fn() });
		const items = [{ id: 'i1', parentReference: { driveId: 'd1' } }];
		await handle({ type: 'command', id: 'a', data: { command: 'pick', items } });
		await handle({ type: 'command', id: 'b', data: { command: 'pick', items } });
		expect(onPick).toHaveBeenCalledWith(items);
		expect(sent[1]).toEqual({ type: 'result', id: 'a', data: { result: 'success' } });
		expect(sent[3].data.error).toEqual({ code: 'unusableItem', message: 'not a photo' });
	});

	it('closes on close, answers unknown commands as unsupported, and flags page-loaded', async () => {
		const sent = [];
		const onClose = vi.fn();
		const onReady = vi.fn();
		const handle = createPickerChannel({ post: (m) => sent.push(m), getToken: vi.fn(), onPick: vi.fn(), onClose, onReady });
		await handle({ type: 'notification', data: { notification: 'page-loaded' } });
		await handle({ type: 'command', id: 'x', data: { command: 'close' } });
		await handle({ type: 'command', id: 'y', data: { command: 'switch-account' } });
		expect(onReady).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
		expect(sent.at(-1)).toEqual({ type: 'result', id: 'y', data: { result: 'error', error: { code: 'unsupportedCommand', message: 'switch-account' } } });
	});

	it('requires the guaranteed item fields', () => {
		expect(pickedItemRef({ id: 'i', parentReference: { driveId: 'd' } })).toEqual({ id: 'i', driveId: 'd' });
		expect(() => pickedItemRef({ id: 'i' })).toThrow(OneDriveError);
	});
});

describe('upload session chunker', () => {
	it('keeps every chunk but the last a multiple of 320 KiB', () => {
		const size = 23 * 1024 * 1024 + 17; // a 23 MB GLB, odd tail
		const chunks = planChunks(size);
		expect(chunks[0]).toEqual({ start: 0, end: DEFAULT_CHUNK_SIZE - 1 });
		for (const c of chunks.slice(0, -1)) expect((c.end - c.start + 1) % CHUNK_UNIT).toBe(0);
		expect(chunks.at(-1).end).toBe(size - 1);
		const covered = chunks.reduce((n, c) => n + (c.end - c.start + 1), 0);
		expect(covered).toBe(size);
	});

	it('rounds an unaligned chunk size down to 320 KiB, never below one unit', () => {
		expect(planChunks(1_000_000, 700 * 1024)[0].end + 1).toBe(2 * CHUNK_UNIT);
		expect(planChunks(1_000_000, 5)[0].end + 1).toBe(CHUNK_UNIT);
		expect(planChunks(0)).toEqual([]);
	});

	it('parses nextExpectedRanges and formats Content-Range', () => {
		expect(nextExpectedStart(['10485760-'])).toBe(10485760);
		expect(nextExpectedStart(['0-99', '200-'])).toBe(0);
		expect(nextExpectedStart([])).toBeNull();
		expect(contentRange(0, 9, 100)).toBe('bytes 0-9/100');
	});

	it('uploads a file over 4 MB through an upload session with real progress', async () => {
		const size = 9 * 1024 * 1024 + 123; // over SIMPLE_UPLOAD_MAX, three 4 MiB-ish chunks
		const blob = new Blob([new Uint8Array(size)], { type: 'model/gltf-binary' });
		const chunk = 13 * CHUNK_UNIT; // 4,259,840 bytes
		const puts = [];
		const fetch = vi.fn(async (url, init = {}) => {
			if (url.endsWith(':/createUploadSession')) {
				expect(init.headers.authorization).toBe('Bearer tok');
				expect(JSON.parse(init.body).item['@microsoft.graph.conflictBehavior']).toBe('rename');
				return jsonResponse(200, { uploadUrl: 'https://up.example/session' });
			}
			if (url === 'https://up.example/session' && init.method === 'PUT') {
				expect(init.headers.authorization).toBeUndefined();
				const [, s, e, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(init.headers['content-range']).map(Number);
				expect(total).toBe(size);
				expect(init.body.size).toBe(e - s + 1);
				puts.push([s, e]);
				if (e === size - 1) return jsonResponse(201, { id: 'new', name: 'Lantern.glb', webUrl: 'https://onedrive.live.com/?id=new' });
				return jsonResponse(202, { nextExpectedRanges: [`${e + 1}-`] });
			}
			throw new Error(`unexpected ${init.method} ${url}`);
		});
		const progress = [];
		const item = await uploadToFolder({
			fetch,
			getToken: async () => 'tok',
			driveId: 'drive!1',
			folderId: 'folder 1',
			name: 'Lantern.glb',
			blob,
			chunkSize: chunk,
			onProgress: (f) => progress.push(f),
			sleep: noSleep,
		});
		expect(size).toBeGreaterThan(SIMPLE_UPLOAD_MAX);
		expect(item.webUrl).toContain('onedrive');
		expect(puts).toEqual([
			[0, chunk - 1],
			[chunk, 2 * chunk - 1],
			[2 * chunk, size - 1],
		]);
		expect(progress[0]).toBe(0);
		expect(progress).toContain(chunk / size);
		expect(progress.at(-1)).toBe(1);
		const sessionUrl = fetch.mock.calls[0][0];
		expect(sessionUrl).toBe(`${GRAPH_BASE}/drives/drive!1/items/folder%201:/Lantern.glb:/createUploadSession`);
	});

	it('honors Retry-After on a throttled chunk and resumes from the server range', async () => {
		const step = 13 * CHUNK_UNIT;
		const size = step * 2 + 100;
		const blob = new Blob([new Uint8Array(size)]);
		let throttled = false;
		const waits = [];
		const starts = [];
		const fetch = vi.fn(async (url, init = {}) => {
			if (url.endsWith('createUploadSession')) return jsonResponse(200, { uploadUrl: 'https://up/s' });
			if (init.method === 'PUT') {
				const start = Number(/bytes (\d+)-/.exec(init.headers['content-range'])[1]);
				starts.push(start);
				if (start === step && !throttled) {
					throttled = true;
					return jsonResponse(429, { error: { code: 'activityLimitReached' } }, { 'retry-after': '7' });
				}
				const end = start + init.body.size - 1;
				return end === size - 1 ? jsonResponse(201, { id: 'ok' }) : jsonResponse(202, { nextExpectedRanges: [`${end + 1}-`] });
			}
			// GET on the session: the server says which bytes it still needs.
			return jsonResponse(200, { nextExpectedRanges: [`${step}-`] });
		});
		const item = await uploadToFolder({
			fetch,
			getToken: async () => 't',
			driveId: 'd',
			folderId: 'f',
			name: 'big.glb',
			blob,
			chunkSize: step,
			sleep: (ms) => {
				waits.push(ms);
				return Promise.resolve();
			},
		});
		expect(item.id).toBe('ok');
		expect(waits).toEqual([7000]);
		expect(starts).toEqual([0, step, step, 2 * step]);
	});

	it('uses one PUT for a file at or under 4 MB, with conflict rename', async () => {
		const blob = new Blob([new Uint8Array(1024)], { type: 'image/png' });
		const fetch = vi.fn(async (url, init) => {
			expect(init.method).toBe('PUT');
			expect(url).toBe(`${GRAPH_BASE}/drives/d/items/f:/poster.png:/content?@microsoft.graph.conflictBehavior=rename`);
			return jsonResponse(201, { id: 'p', webUrl: 'https://x/p' });
		});
		const progress = [];
		const item = await uploadToFolder({ fetch, getToken: async () => 't', driveId: 'd', folderId: 'f', name: 'poster.png', blob, onProgress: (p) => progress.push(p), sleep: noSleep });
		expect(item.id).toBe('p');
		expect(progress).toEqual([0, 1]);
	});

	it('cancels the session when an upload fails for good', async () => {
		const blob = new Blob([new Uint8Array(SIMPLE_UPLOAD_MAX + 1)]);
		const calls = [];
		const fetch = vi.fn(async (url, init = {}) => {
			calls.push(`${init.method || 'GET'} ${url}`);
			if (url.endsWith('createUploadSession')) return jsonResponse(200, { uploadUrl: 'https://up/s' });
			if (init.method === 'PUT') return jsonResponse(507, { error: { code: 'quotaLimitReached', message: 'full' } });
			return jsonResponse(204, null);
		});
		await expect(uploadToFolder({ fetch, getToken: async () => 't', driveId: 'd', folderId: 'f', name: 'a.glb', blob, sleep: noSleep })).rejects.toMatchObject({
			code: 'quota_full',
		});
		expect(calls).toContain('DELETE https://up/s');
	});

	it('sanitizes names OneDrive and SharePoint refuse', () => {
		expect(safeDriveFileName('a brass "lantern": v2?.glb')).toBe('a brass lantern v2 .glb');
		expect(safeDriveFileName('  ..  ')).toBe('three-ws-model');
		expect(safeDriveFileName('x'.repeat(300)).length).toBe(120);
	});
});

describe('Graph requests and error mapping', () => {
	it('refreshes the token once on 401, then succeeds', async () => {
		const tokens = [];
		const fetch = vi.fn(async (_u, init) => (init.headers.authorization === 'Bearer fresh' ? jsonResponse(200, { ok: 1 }) : jsonResponse(401, {})));
		const getToken = vi.fn(async (force) => {
			tokens.push(force);
			return force ? 'fresh' : 'stale';
		});
		const res = await graphRequest('https://graph.microsoft.com/v1.0/me', { fetch, getToken, sleep: noSleep });
		expect(await res.json()).toEqual({ ok: 1 });
		expect(tokens).toEqual([false, true]);
	});

	it('retries 503 after Retry-After and gives up with a throttle message', async () => {
		const waits = [];
		const fetch = vi.fn(async () => jsonResponse(503, {}, { 'retry-after': '3' }));
		await expect(
			graphRequest('https://g/x', { fetch, getToken: async () => 't', sleep: (ms) => (waits.push(ms), Promise.resolve()) }),
		).rejects.toMatchObject({ code: 'throttled' });
		expect(waits).toEqual([3000, 3000, 3000, 3000]);
	});

	it('reads Retry-After as seconds or a date, capped at a minute', () => {
		expect(retryAfterMs('2')).toBe(2000);
		expect(retryAfterMs('9999')).toBe(60000);
		const now = Date.parse('2026-11-16T12:00:00Z');
		expect(retryAfterMs('Mon, 16 Nov 2026 12:00:05 GMT', now)).toBe(5000);
		expect(retryAfterMs(null, now, 1500)).toBe(1500);
	});

	it('maps Graph failures to actionable codes', () => {
		expect(graphResponseError(507, {}).code).toBe('quota_full');
		expect(graphResponseError(400, { error: { code: 'quotaLimitReached' } }).code).toBe('quota_full');
		expect(graphResponseError(403, {}).code).toBe('access_denied');
		expect(graphResponseError(404, {}).code).toBe('not_found');
		expect(graphResponseError(423, {}).code).toBe('locked');
		expect(graphResponseError(429, {}).retryable).toBe(true);
		expect(graphResponseError(400, { error: { message: 'Invalid name' } }).message).toContain('Invalid name');
	});

	it('maps MSAL failures, keeping cancel distinct from errors', () => {
		expect(msalError({ errorCode: 'user_cancelled' }).code).toBe('cancelled');
		expect(msalError({ errorCode: 'access_denied', errorMessage: 'AADSTS65004: User declined to consent' }).code).toBe('consent_declined');
		expect(msalError({ errorCode: 'invalid_grant', errorMessage: 'AADSTS90094: admin approval required' }).code).toBe('admin_required');
		expect(msalError({ errorCode: 'popup_window_error' }).code).toBe('popup_blocked');
		expect(msalError({ errorCode: 'no_network_connectivity' }).code).toBe('offline');
		expect(msalError({ errorCode: 'invalid_request', errorMessage: 'AADSTS50011: redirect URI mismatch' }).code).toBe('not_configured');
		expect(msalError({ errorCode: 'something_new' }).message).toContain('something_new');
	});

	it('knows when a silent token failure needs a Microsoft screen', () => {
		expect(needsInteraction({ name: 'InteractionRequiredAuthError' })).toBe(true);
		expect(needsInteraction({ errorCode: 'consent_required' })).toBe(true);
		expect(needsInteraction({ errorCode: 'no_network_connectivity' })).toBe(false);
	});
});

describe('downloading a picked photo', () => {
	it('reads the item, then fetches the pre-authenticated URL without a bearer token', async () => {
		const fetch = vi.fn(async (url, init = {}) => {
			if (url.startsWith(GRAPH_BASE)) {
				expect(url).toContain('/drives/b!drive/items/item1?$select=');
				return jsonResponse(200, { id: 'item1', name: 'mug.JPG', size: 2048, file: { mimeType: 'image/jpeg' }, '@microsoft.graph.downloadUrl': 'https://dl.example/mug' });
			}
			expect(url).toBe('https://dl.example/mug');
			expect(init.headers).toBeUndefined();
			return new Response(new Uint8Array(2048), { status: 200 });
		});
		const file = await downloadPickedImage({ id: 'item1', parentReference: { driveId: 'b!drive' } }, { fetch, getToken: async () => 't', sleep: noSleep });
		expect(file.name).toBe('mug.JPG');
		expect(file.type).toBe('image/jpeg');
		expect(file.size).toBe(2048);
	});

	it('refuses a HEIC photo before downloading it', async () => {
		const fetch = vi.fn(async () => jsonResponse(200, { id: 'h', name: 'IMG_1.HEIC', size: 10, file: { mimeType: 'image/heic' }, '@microsoft.graph.downloadUrl': 'https://dl/x' }));
		await expect(downloadPickedImage({ id: 'h', parentReference: { driveId: 'd' } }, { fetch, getToken: async () => 't', sleep: noSleep })).rejects.toMatchObject({ code: 'bad_type' });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('normalizes image types from mime or extension', () => {
		expect(normalizeImageType('image/jpg')).toBe('image/jpeg');
		expect(normalizeImageType('', 'a.webp')).toBe('image/webp');
		expect(normalizeImageType('application/octet-stream', 'scan.png')).toBe('image/png');
		expect(normalizeImageType('image/gif', 'a.gif')).toBeNull();
	});
});
