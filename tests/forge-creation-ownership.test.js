/**
 * Who may manage a forge creation, and what "delete" has to erase (issue #639).
 *
 * A model forged anonymously through the Forge API landed in the public
 * gallery, and its maker could not take it down: the delete endpoint only
 * trusted the x-forge-client header the model was made under, and that id was
 * lost. These tests pin the contracts that close that gap:
 *
 *   1. deleteCreation erases every object stored under the creation's prefix
 *      (.glb, .png, .web.glb, .lod.glb, -poster.*), not only the columns it
 *      happened to remember, then the row.
 *   2. The shared 'anon' bucket (every headerless caller hashes to it) is never
 *      an ownership credential: no delete, no edit, no royalty-wallet write.
 *   3. The signed-in account a model was forged under, a signed per-creation
 *      manage token, and a platform moderator can each delete it.
 *   4. A model conditioned on the maker's own uploaded photo is unlisted by
 *      default (reachable by link, kept out of public feeds); an explicit
 *      request visibility wins; text-to-3D keeps its public default.
 *   5. The owner can change visibility after the fact.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

beforeAll(() => {
	Object.assign(process.env, {
		DATABASE_URL: 'postgres://test:test@localhost:5432/test',
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
		JWT_SECRET: 'test-jwt-secret-for-manage-tokens-0123456789',
	});
});

let selectRows = [];
let updateRows = [];
const sqlMock = vi.fn(async (strings) => {
	const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
	if (/^\s*select/i.test(text.trim()) || text.trim().startsWith('select')) return selectRows;
	if (text.includes('update forge_creations')) return updateRows;
	return [];
});

vi.mock('../api/_lib/db.js', () => ({
	sql: (...args) => sqlMock(...args),
	isDbUnavailableError: () => false,
}));

const deleteObjectMock = vi.fn(async () => {});
let listedObjects = [];
const listObjectsPageMock = vi.fn(async ({ prefix }) => ({
	objects: listedObjects.filter((key) => key.startsWith(prefix)).map((key) => ({ key, size: 1 })),
	nextToken: null,
}));
vi.mock('../api/_lib/r2.js', () => ({
	putObject: vi.fn(async () => {}),
	objectStorageConfigured: () => true,
	publicUrl: (key) => `https://cdn.example.com/${key}`,
	cdnUrl: (key) => `https://cdn.example.com/${key}`,
	deleteObject: (...args) => deleteObjectMock(...args),
	listObjectsPage: (...args) => listObjectsPageMock(...args),
	normalizeStoredUrl: (u) => u,
	isStorageInfrastructureError: (err) => [401, 403].includes(err?.$metadata?.httpStatusCode),
	keyFromPublicUrl: (url) =>
		typeof url === 'string' && url.startsWith('https://cdn.example.com/')
			? url.slice('https://cdn.example.com/'.length).split(/[?#]/)[0]
			: null,
}));

vi.mock('../api/_lib/forge-events.js', () => ({
	recordGenerationEvent: vi.fn(async () => {}),
}));
vi.mock('../api/_lib/indexnow-queue.js', () => ({ announceIndexNow: vi.fn() }));

const store = await import('../api/_lib/forge-store.js');
const { deleteCreation, createCreation, isCreationOwner, setCreationVisibility, runWithCreationContext, ANON_CLIENT_KEY } = store;
const { mintManageToken, verifyManageToken, withManageToken } = await import('../api/_lib/forge-manage-token.js');

const ID = '301676f1-cddf-49f5-ab6e-351203c47d44';
const OTHER_ID = '0b7f2a52-6a3e-4f1c-9d55-1f4f8a2b9c10';

afterEach(() => {
	sqlMock.mockClear();
	deleteObjectMock.mockReset();
	deleteObjectMock.mockImplementation(async () => {});
	listObjectsPageMock.mockClear();
	selectRows = [];
	updateRows = [];
	listedObjects = [];
});

function statements(fragment) {
	return sqlMock.mock.calls
		.map(([strings]) => (Array.isArray(strings) ? strings.join(' ') : String(strings)))
		.filter((t) => t.includes(fragment));
}

function row(extra = {}) {
	return {
		id: ID,
		client_key: '678ab2f7d7cd0123456789abcdef',
		glb_key: `forge/678ab2f7d7cd/${ID}.glb`,
		glb_url: `https://cdn.example.com/forge/678ab2f7d7cd/${ID}.glb`,
		preview_key: `forge/678ab2f7d7cd/${ID}.png`,
		preview_image_url: `https://cdn.example.com/forge/678ab2f7d7cd/${ID}.png`,
		web_glb_key: `forge/678ab2f7d7cd/${ID}.web.glb`,
		lod_glb_key: null,
		source_image_keys: ['forge/uploads/678ab2f7d7cd/89224ed8.png'],
		status: 'done',
		visibility: null,
		outcome: 'generated',
		...extra,
	};
}

describe('deleteCreation erases every stored variant', () => {
	it('removes the .web.glb and .lod.glb variants and anything else under the creation prefix', async () => {
		selectRows = [row({ lod_glb_key: `forge/678ab2f7d7cd/${ID}.lod.glb` })];
		// A poster written by attachPoster lives under the same prefix but has no
		// column of its own; the prefix sweep is what finds it.
		// The /cdn/_v/ resized copies of its images live outside the prefix and
		// must go too.
		listedObjects = [
			`forge/678ab2f7d7cd/${ID}.glb`,
			`forge/678ab2f7d7cd/${ID}-poster.webp`,
			`variants/256/forge/678ab2f7d7cd/${ID}.png.abc123.webp`,
			`variants/512/forge/uploads/678ab2f7d7cd/89224ed8.png.def456.webp`,
			`variants/256/forge/678ab2f7d7cd/${OTHER_ID}.png.abc123.webp`,
		];
		const out = await deleteCreation({ id: ID, clientKey: '678ab2f7d7cd0123456789abcdef' });
		expect(out).toBe('deleted');
		expect(listObjectsPageMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: `forge/678ab2f7d7cd/${ID}` }));
		const deleted = deleteObjectMock.mock.calls.map(([k]) => k).sort();
		expect(deleted).toEqual(
			[
				`forge/678ab2f7d7cd/${ID}-poster.webp`,
				`forge/678ab2f7d7cd/${ID}.glb`,
				`forge/678ab2f7d7cd/${ID}.lod.glb`,
				`forge/678ab2f7d7cd/${ID}.png`,
				`forge/678ab2f7d7cd/${ID}.web.glb`,
				'forge/uploads/678ab2f7d7cd/89224ed8.png',
				`variants/256/forge/678ab2f7d7cd/${ID}.png.abc123.webp`,
				`variants/512/forge/uploads/678ab2f7d7cd/89224ed8.png.def456.webp`,
			].sort(),
		);
		expect(statements('delete from forge_creations')).toHaveLength(1);
	});
});

describe('deleteCreation during an object-storage outage', () => {
	// From 2026-11-15 R2 rejected the production credential (401 Unauthorized) on
	// every signed call. Deleting the bucket objects first meant every owner
	// delete and every takedown failed with the row left public. A rejected
	// credential says nothing about the request: the row must still come down,
	// with each key it could not delete queued for a retry once storage answers.
	const unauthorized = () => Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', $metadata: { httpStatusCode: 401 } });

	it('takes the row down and queues every key, plus the prefix sweep, for a later purge', async () => {
		selectRows = [row()];
		deleteObjectMock.mockRejectedValue(unauthorized());
		listObjectsPageMock.mockRejectedValueOnce(unauthorized());
		const out = await deleteCreation({ id: ID, moderator: true });
		expect(out).toBe('deleted');
		expect(statements('delete from forge_creations')).toHaveLength(1);
		const queued = sqlMock.mock.calls.find(([s]) => Array.isArray(s) && s.join(' ').includes('insert into forge_storage_purges'));
		expect(queued).toBeTruthy();
		const flat = queued.slice(1).flat();
		expect(flat).toEqual(expect.arrayContaining([`forge/678ab2f7d7cd/${ID}.glb`, 'forge/uploads/678ab2f7d7cd/89224ed8.png', `forge/678ab2f7d7cd/${ID}`]));
	});

	it('still aborts, row intact, on a fault that is not the storage infrastructure', async () => {
		selectRows = [row()];
		deleteObjectMock.mockRejectedValueOnce(new TypeError('bad key'));
		const out = await deleteCreation({ id: ID, moderator: true });
		expect(out).toBe('error');
		expect(statements('delete from forge_creations')).toHaveLength(0);
		expect(statements('insert into forge_storage_purges')).toHaveLength(0);
	});
});

describe("the shared 'anon' bucket is never an ownership credential", () => {
	it('exports the bucket key it guards', () => {
		expect(ANON_CLIENT_KEY).toBe('anon');
		expect(store.hashClient('')).toBe(ANON_CLIENT_KEY);
	});

	it('refuses to delete with the anon key, touching nothing', async () => {
		selectRows = [row({ client_key: 'anon' })];
		const out = await deleteCreation({ id: ID, clientKey: 'anon' });
		expect(out).toBe('not_found');
		expect(sqlMock).not.toHaveBeenCalled();
		expect(deleteObjectMock).not.toHaveBeenCalled();
	});

	it('refuses ownership for the anon key', async () => {
		selectRows = [{ '?column?': 1 }];
		expect(await isCreationOwner({ id: ID, clientKey: 'anon' })).toBe(false);
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('refuses category, feedback, poster and remix writes with the anon key', async () => {
		updateRows = [{ id: ID }];
		expect(await store.setForgeCategory({ id: ID, clientKey: 'anon', modelCategory: 'avatar' })).toBe(false);
		expect(await store.recordFeedback({ id: ID, clientKey: 'anon', outcome: 'accepted' })).toBe(false);
		expect(
			await store.setRemixable({ creationId: ID, clientKey: 'anon', remixable: true, royaltyBps: 1000, creatorWallet: 'THREEsynthetic11111111111111111111111111111', license: 'remix-royalty' }),
		).toBe(null);
		expect(await store.attachPoster({ id: ID, clientKey: 'anon', body: Buffer.from('x'), contentType: 'image/webp', ext: 'webp' })).toBe(null);
		expect(statements('update forge_creations')).toHaveLength(0);
	});

	it('never lists the anon bucket as one caller\'s gallery', async () => {
		selectRows = [row({ client_key: 'anon' })];
		expect(await store.listCreations({ clientKey: 'anon' })).toEqual([]);
		expect(sqlMock).not.toHaveBeenCalled();
	});
});

describe('other ownership credentials', () => {
	it('lets the signed-in account the model was forged under delete it', async () => {
		selectRows = [row({ user_id: 'user-1' })];
		const out = await deleteCreation({ id: ID, userId: '11111111-1111-4111-8111-111111111111' });
		expect(out).toBe('deleted');
		const select = sqlMock.mock.calls.find(([s]) => s.join(' ').includes('select'));
		expect(select.slice(1)).toContain('11111111-1111-4111-8111-111111111111');
	});

	it('lets a valid manage token for this creation delete it', async () => {
		selectRows = [row({ client_key: 'anon' })];
		const out = await deleteCreation({ id: ID, manageToken: mintManageToken(ID) });
		expect(out).toBe('deleted');
	});

	it("refuses a manage token minted for a different creation", async () => {
		selectRows = [row()];
		const out = await deleteCreation({ id: ID, manageToken: mintManageToken(OTHER_ID) });
		expect(out).toBe('not_found');
		expect(deleteObjectMock).not.toHaveBeenCalled();
	});

	it('lets a moderator delete any creation, including anon-bucket rows', async () => {
		selectRows = [row({ client_key: 'anon' })];
		listedObjects = [];
		const out = await deleteCreation({ id: ID, moderator: true });
		expect(out).toBe('deleted');
		expect(listObjectsPageMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: `forge/anon/${ID}` }));
	});

	it('answers not_found with no credential at all', async () => {
		expect(await deleteCreation({ id: ID })).toBe('not_found');
		expect(sqlMock).not.toHaveBeenCalled();
	});
});

describe('manage tokens', () => {
	it('round-trips to the creation id and rejects tampering', () => {
		const token = mintManageToken(ID);
		expect(token.startsWith('fm1.')).toBe(true);
		expect(verifyManageToken(token)).toBe(ID);
		expect(verifyManageToken(token.slice(0, -2) + 'xx')).toBe(null);
		expect(verifyManageToken(`fm1.${Buffer.from(OTHER_ID).toString('base64url')}.${token.split('.')[2]}`)).toBe(null);
		expect(verifyManageToken('garbage')).toBe(null);
		expect(verifyManageToken(null)).toBe(null);
	});
});

describe('withManageToken', () => {
	it('adds a token that grants exactly the creation the body names', () => {
		const out = withManageToken({ job_id: 'j', creation_id: ID, status: 'queued' });
		expect(verifyManageToken(out.manage_token)).toBe(ID);
		expect(out.job_id).toBe('j');
	});

	it('passes bodies without a creation id through untouched', () => {
		const body = { job_id: 'j', creation_id: null };
		expect(withManageToken(body)).toBe(body);
		expect(withManageToken(null)).toBe(null);
	});

	it('answers without a token instead of failing when the signing secret is missing', () => {
		const saved = process.env.JWT_SECRET;
		delete process.env.JWT_SECRET;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const body = { creation_id: ID };
			expect(withManageToken(body)).toEqual({ creation_id: ID });
		} finally {
			process.env.JWT_SECRET = saved;
			warn.mockRestore();
		}
	});
});

describe('visibility at birth', () => {
	function insertedVisibility() {
		const call = sqlMock.mock.calls.find(([s]) => s.join(' ').includes('insert into forge_creations'));
		const text = call[0].join(' ');
		expect(text).toMatch(/visibility/);
		const values = call.slice(1);
		return values.find((v) => v === 'public' || v === 'unlisted' || v === 'private') ?? null;
	}

	it("defaults a model made from the maker's own uploaded photo to unlisted", async () => {
		await createCreation({
			clientKey: 'client-key',
			prompt: 'image-to-3d',
			previewImageUrl: 'https://cdn.example.com/forge/uploads/678ab2f7d7cd/89224ed8.png',
			backend: 'trellis_selfhost',
			path: 'image',
		});
		expect(insertedVisibility()).toBe('unlisted');
	});

	it('keeps a text-to-3D model out of the public feeds until its maker publishes it', async () => {
		await createCreation({
			clientKey: 'client-key',
			prompt: 'a fox',
			previewImageUrl: 'https://replicate.delivery/pbxt/flux.png',
			backend: 'trellis',
			path: 'text',
		});
		expect(insertedVisibility()).toBe('unlisted');
	});

	it('leaves platform seed models on the public default so the showcase stays populated', async () => {
		await createCreation({
			clientKey: 'seed',
			prompt: 'a fox',
			previewImageUrl: 'https://replicate.delivery/pbxt/flux.png',
			backend: 'trellis',
			path: 'text',
			internal: true,
		});
		expect(insertedVisibility()).toBe(null);
	});

	it('honours an explicit request visibility from the creation context', async () => {
		await runWithCreationContext({ visibility: 'public' }, () =>
			createCreation({
				clientKey: 'client-key',
				prompt: 'image-to-3d',
				previewImageUrl: 'https://cdn.example.com/forge/uploads/678ab2f7d7cd/opt-in.png',
				path: 'image',
			}),
		);
		expect(insertedVisibility()).toBe('public');
		sqlMock.mockClear();
		await runWithCreationContext({ visibility: 'private' }, () =>
			createCreation({ clientKey: 'client-key', prompt: 'a fox', path: 'text' }),
		);
		expect(insertedVisibility()).toBe('private');
	});

	it('ignores an invalid request visibility and falls back to unlisted', async () => {
		await runWithCreationContext({ visibility: 'everyone' }, () =>
			createCreation({ clientKey: 'client-key', prompt: 'a fox', path: 'text' }),
		);
		expect(insertedVisibility()).toBe('unlisted');
	});
});

describe('setCreationVisibility', () => {
	it('updates visibility for the owner and reports the new value', async () => {
		updateRows = [{ id: ID, visibility: 'unlisted', status: 'done', glb_url: 'x', outcome: 'generated' }];
		const out = await setCreationVisibility({ id: ID, clientKey: 'client-key', visibility: 'unlisted' });
		expect(out).toEqual({ outcome: 'updated', visibility: 'unlisted' });
	});

	it('refuses an anon key and an invalid value without writing', async () => {
		expect(await setCreationVisibility({ id: ID, clientKey: 'anon', visibility: 'private' })).toEqual({ outcome: 'not_found' });
		expect(await setCreationVisibility({ id: ID, clientKey: 'client-key', visibility: 'secret' })).toEqual({ outcome: 'invalid' });
		expect(statements('update forge_creations')).toHaveLength(0);
	});

	it('answers not_found when the caller does not own the row', async () => {
		updateRows = [];
		expect(await setCreationVisibility({ id: ID, clientKey: 'client-key', visibility: 'public' })).toEqual({ outcome: 'not_found' });
	});
});
