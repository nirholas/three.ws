// "My cards" on the /play gacha machine: reading the Collector Crypt cards a
// wallet holds (api/_lib/gacha-wallet.js, served by GET /api/gacha/cards).
//
// What must hold: only cards in Collector Crypt's collections are listed (a
// look-alike NFT, an unverified collection claim, or an asset owned by someone
// else never appears), and the server only ever fetches card metadata from
// Collector Crypt's published hosts, redirects included. Account bytes here are
// built from freshly generated keys in the real on-chain layouts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
	CC_LEGACY_CARD_COLLECTION,
	parseCoreAsset,
	parseTokenMetadata,
	metadataPda,
	allowedMetadataUri,
	walletCardFromJson,
	findWalletCards,
	fetchCardJson,
	mapPool,
	walletRpc,
	_resetArweaveGatewayHealth,
	WALLET_PAGE_SIZE,
	walletCardIndex,
	walletCardPage,
	WalletIndexCache,
} from '../api/_lib/gacha-wallet.js';
import { CC_CARD_COLLECTION } from '../api/_lib/collectorcrypt-gacha.js';

const key = () => Keypair.generate().publicKey;
const pk = (b58) => bs58.decode(b58);

function borshString(s) {
	const body = Buffer.from(s, 'utf8');
	const len = Buffer.alloc(4);
	len.writeUInt32LE(body.length);
	return Buffer.concat([len, body]);
}

function coreAsset({ owner, collection = CC_CARD_COLLECTION, uaKind = 2, name = 'Pikachu PSA 10', uri = 'https://arweave.net/abc' }) {
	return Buffer.concat([
		Buffer.from([1]),
		Buffer.from(pk(owner)),
		Buffer.from([uaKind]),
		Buffer.from(pk(collection)),
		borshString(name),
		borshString(uri),
		Buffer.from([0]), // seq: None
	]);
}

function tokenMetadata({ mint, collection = CC_LEGACY_CARD_COLLECTION, verified = true, name = 'Charizard PSA 9', uri = 'https://arweave.net/xyz', creators = 1 }) {
	const parts = [Buffer.from([4]), Buffer.from(key().toBytes()), Buffer.from(pk(mint))];
	parts.push(borshString(name.padEnd(32, '\0')), borshString('CC'.padEnd(10, '\0')), borshString(uri.padEnd(200, '\0')));
	parts.push(Buffer.from([0xf4, 0x01])); // seller fee 500
	if (creators) {
		const n = Buffer.alloc(4);
		n.writeUInt32LE(creators);
		parts.push(Buffer.from([1]), n);
		for (let i = 0; i < creators; i++) parts.push(Buffer.from(key().toBytes()), Buffer.from([1, 100]));
	} else parts.push(Buffer.from([0]));
	parts.push(Buffer.from([1, 1])); // primary sale, mutable
	parts.push(Buffer.from([1, 254])); // edition nonce
	parts.push(Buffer.from([1, 4])); // token standard: ProgrammableNonFungible
	if (collection) parts.push(Buffer.from([1, verified ? 1 : 0]), Buffer.from(pk(collection)));
	else parts.push(Buffer.from([0]));
	parts.push(Buffer.alloc(40)); // uses, collection details, programmable config
	return Buffer.concat(parts);
}

describe('parseCoreAsset', () => {
	it('reads owner, collection, name and uri from an AssetV1 account', () => {
		const owner = key().toBase58();
		const out = parseCoreAsset(coreAsset({ owner }));
		expect(out).toEqual({ owner, collection: CC_CARD_COLLECTION, name: 'Pikachu PSA 10', uri: 'https://arweave.net/abc' });
	});

	it('refuses an asset whose update authority is an address, not a collection', () => {
		expect(parseCoreAsset(coreAsset({ owner: key().toBase58(), uaKind: 1 }))).toBe(null);
	});

	it('refuses truncated bytes and other account kinds', () => {
		const good = coreAsset({ owner: key().toBase58() });
		expect(parseCoreAsset(good.subarray(0, 70))).toBe(null);
		const collectionAccount = Buffer.from(good);
		collectionAccount[0] = 5;
		expect(parseCoreAsset(collectionAccount)).toBe(null);
	});
});

describe('parseTokenMetadata', () => {
	it('reads the verified collection past a creators array', () => {
		const mint = key().toBase58();
		const out = parseTokenMetadata(tokenMetadata({ mint, creators: 3 }));
		expect(out.mint).toBe(mint);
		expect(out.name).toBe('Charizard PSA 9');
		expect(out.uri).toBe('https://arweave.net/xyz');
		expect(out.tokenStandard).toBe(4);
		expect(out.collection).toEqual({ verified: true, key: CC_LEGACY_CARD_COLLECTION });
	});

	it('reports an unverified collection claim as unverified', () => {
		const out = parseTokenMetadata(tokenMetadata({ mint: key().toBase58(), verified: false, creators: 0 }));
		expect(out.collection.verified).toBe(false);
	});

	it('derives the metadata PDA the program uses', () => {
		const mint = key().toBase58();
		expect(metadataPda(mint)).toBe(metadataPda(mint));
		expect(metadataPda(mint)).not.toBe(metadataPda(key().toBase58()));
	});
});

describe('findWalletCards', () => {
	const owner = key().toBase58();
	const mine = key().toBase58();
	const legacyMint = key().toBase58();
	const fakeMint = key().toBase58();
	const unverifiedMint = key().toBase58();

	function rpcFor(state) {
		return async (method, params) => {
			state.calls.push(method);
			if (method === 'getProgramAccounts') {
				state.filters = params[1].filters;
				return [
					{ pubkey: mine, account: { data: [coreAsset({ owner }).toString('base64'), 'base64'] } },
					// An RPC that ignored a filter must still not leak these through.
					{ pubkey: key().toBase58(), account: { data: [coreAsset({ owner: key().toBase58() }).toString('base64'), 'base64'] } },
					{ pubkey: key().toBase58(), account: { data: [coreAsset({ owner, collection: key().toBase58() }).toString('base64'), 'base64'] } },
				];
			}
			if (method === 'getTokenAccountsByOwner') {
				const row = (mint, amount = '1', decimals = 0) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });
				return { value: [row(legacyMint), row(fakeMint), row(unverifiedMint), row(key().toBase58(), '1000', 6)] };
			}
			if (method === 'getMultipleAccounts') {
				const byPda = {
					[metadataPda(legacyMint)]: tokenMetadata({ mint: legacyMint }),
					[metadataPda(fakeMint)]: tokenMetadata({ mint: fakeMint, collection: key().toBase58() }),
					[metadataPda(unverifiedMint)]: tokenMetadata({ mint: unverifiedMint, verified: false }),
				};
				return {
					value: params[0].map((pda) =>
						byPda[pda] ? { owner: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', data: [byPda[pda].toString('base64'), 'base64'] } : null,
					),
				};
			}
			throw new Error(`unexpected ${method}`);
		};
	}

	it('lists the Core card and the verified legacy card, nothing else', async () => {
		const state = { calls: [] };
		const out = await findWalletCards(rpcFor(state), owner);
		expect(out.partial).toBe(false);
		expect(out.cards.map((c) => [c.address, c.standard])).toEqual([
			[mine, 'core'],
			[legacyMint, 'pnft'],
		]);
		// The Core query is narrowed on-chain to this owner and the card collection.
		expect(state.filters).toContainEqual({ memcmp: { offset: 1, bytes: owner } });
		expect(state.filters).toContainEqual({ memcmp: { offset: 34, bytes: CC_CARD_COLLECTION } });
	});

	it('still returns the Core cards when the token-account read fails', async () => {
		const state = { calls: [] };
		const base = rpcFor(state);
		const rpc = (m, p) => (m === 'getTokenAccountsByOwner' ? Promise.reject(new Error('429')) : base(m, p));
		const out = await findWalletCards(rpc, owner);
		expect(out.partial).toBe(true);
		expect(out.cards.map((c) => c.address)).toEqual([mine]);
	});

	it('throws when neither read works, so the route can say Solana is down', async () => {
		await expect(findWalletCards(() => Promise.reject(new Error('down')), owner)).rejects.toThrow('down');
	});
});

describe('card metadata fetching', () => {
	it('allows only Collector Crypt metadata hosts over https', () => {
		expect(allowedMetadataUri('https://arweave.net/abc')).toBe('https://arweave.net/abc');
		expect(allowedMetadataUri('https://abcd.arweave.net/abc')).toBe('https://abcd.arweave.net/abc');
		expect(allowedMetadataUri('https://nft.collectorcrypt.com/front/1')).toBeTruthy();
		expect(allowedMetadataUri('http://arweave.net/abc')).toBe(null);
		expect(allowedMetadataUri('https://169.254.169.254/latest/meta-data')).toBe(null);
		expect(allowedMetadataUri('https://arweave.net.evil.example/x')).toBe(null);
		expect(allowedMetadataUri('not a url')).toBe(null);
	});

	const response = (status, body, headers = {}) => ({
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (h) => headers[h.toLowerCase()] ?? null },
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	});

	it('follows the arweave subdomain redirect by hand', async () => {
		const seen = [];
		const fetchImpl = async (url) => {
			seen.push(url);
			if (url === 'https://arweave.net/abc') return response(302, '', { location: '//sub.arweave.net/abc' });
			return response(200, { name: 'Card', attributes: [] });
		};
		expect(await fetchCardJson('https://arweave.net/abc', { fetchImpl })).toEqual({ name: 'Card', attributes: [] });
		expect(seen).toEqual(['https://arweave.net/abc', 'https://sub.arweave.net/abc']);
	});

	it('never requests a redirect target outside the allowlist', async () => {
		const seen = [];
		const fetchImpl = async (url) => {
			seen.push(url);
			return response(302, '', { location: 'http://10.0.0.5/secret' });
		};
		expect(await fetchCardJson('https://arweave.net/abc', { fetchImpl })).toBe(null);
		expect(seen.every((u) => u.startsWith('https://arweave.net/'))).toBe(true);
	});

	it('refuses an oversized or non-JSON body', async () => {
		const big = async () => response(200, 'x'.repeat(200_000));
		expect(await fetchCardJson('https://arweave.net/abc', { fetchImpl: big })).toBe(null);
		const html = async () => response(200, '<html>');
		expect(await fetchCardJson('https://arweave.net/abc', { fetchImpl: html })).toBe(null);
	});
});

describe('walletCardFromJson', () => {
	it('renders the front, the back of the slab and the grade facts', () => {
		const address = key().toBase58();
		const card = walletCardFromJson(
			{ address, name: '2009 #148 Articuno', standard: 'core' },
			{
				name: '2009 #148 Articuno-Holo PSA 7',
				image: 'https://nft.collectorcrypt.com/front/1',
				properties: { files: [{ uri: 'https://nft.collectorcrypt.com/front/1', type: 'image/jpeg' }, { uri: 'https://nft.collectorcrypt.com/back/1', type: 'image/jpeg' }] },
				attributes: [
					{ trait_type: 'Card Name', value: 'Articuno-Holo' },
					{ trait_type: 'Grading Company', value: 'PSA' },
					{ trait_type: 'The Grade', value: 'NM 7' },
					{ trait_type: 'Insured Value', value: '700' },
				],
			},
		);
		expect(card).toMatchObject({
			address,
			name: 'Articuno-Holo',
			grader: 'PSA',
			grade: 'NM 7',
			image: 'https://nft.collectorcrypt.com/front/1',
			back: 'https://nft.collectorcrypt.com/back/1',
			insuredValue: 700,
			standard: 'core',
		});
	});

	it('still lists a card whose metadata could not be fetched, with no invented value', () => {
		const address = key().toBase58();
		const card = walletCardFromJson({ address, name: 'Mew PSA 10', standard: 'pnft' }, null);
		expect(card).toMatchObject({ address, name: 'Mew PSA 10', image: null, back: null, insuredValue: null });
	});
});

describe('mapPool', () => {
	it('keeps order and caps concurrency', async () => {
		let inFlight = 0;
		let peak = 0;
		const out = await mapPool([5, 1, 4, 2, 3], 2, async (n) => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await new Promise((r) => setImmediate(r));
			inFlight--;
			return n * 10;
		});
		expect(out).toEqual([50, 10, 40, 20, 30]);
		expect(peak).toBe(2);
	});
});

// Production regressions seen on Cloud Run (2026-11-03): arweave.net answers
// Google Cloud egress with 429 on its per-transaction subdomain, so every card
// in a wallet rendered blank, and the public cluster refuses getProgramAccounts
// under load, so the scan itself 503'd while Helius sat configured and unused.
describe('arweave gateway fallback', () => {
	const TX = 'r8y9bQB43_bFLXEElxc5MJesGmG4Cy-aEkCFnZtkAIc';
	const response = (status, body, headers = {}) => ({
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (h) => headers[h.toLowerCase()] ?? null },
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
	});
	// arweave.net throttles; every other gateway serves the same bytes.
	const throttledArweave = (seen) => async (url) => {
		seen.push(url);
		const { hostname, pathname } = new URL(url);
		if (hostname === 'arweave.net') return response(302, '', { location: `https://sandbox.arweave.net${pathname}` });
		if (hostname.endsWith('.arweave.net')) return response(429, '<html>429 Too Many Requests</html>');
		if (!hostname.startsWith('sandbox.')) return response(302, '', { location: `https://sandbox.${hostname}${pathname}` });
		return response(200, { name: `Card via ${hostname.slice('sandbox.'.length)}` });
	};

	beforeEach(() => _resetArweaveGatewayHealth());
	afterEach(() => _resetArweaveGatewayHealth());

	it('reads the card from another gateway when arweave.net throttles', async () => {
		const seen = [];
		const body = await fetchCardJson(`https://arweave.net/${TX}`, { fetchImpl: throttledArweave(seen) });
		expect(body?.name).toMatch(/^Card via /);
		expect(seen[0]).toBe(`https://arweave.net/${TX}`);
		// Every hop, sandbox subdomains included, stays on an allowlisted gateway.
		expect(seen.every((u) => allowedMetadataUri(u) === u)).toBe(true);
	});

	it('tries a throttled gateway last on the next card', async () => {
		await fetchCardJson(`https://arweave.net/${TX}`, { fetchImpl: throttledArweave([]) });
		const seen = [];
		await fetchCardJson(`https://arweave.net/${TX}`, { fetchImpl: throttledArweave(seen) });
		expect(new URL(seen[0]).hostname).not.toMatch(/arweave\.net$/);
	});

	it('reads a card hosted on any listed gateway through the same ladder', async () => {
		const seen = [];
		const body = await fetchCardJson(`https://ar-io.dev/${TX}`, { fetchImpl: throttledArweave(seen) });
		expect(body?.name).toBe('Card via ar-io.dev');
	});

	it('does not re-point a URI that is not an arweave transaction', async () => {
		const seen = [];
		const fetchImpl = async (url) => {
			seen.push(url);
			return response(503, '');
		};
		expect(await fetchCardJson('https://nft.collectorcrypt.com/meta/1', { fetchImpl })).toBe(null);
		expect(new Set(seen)).toEqual(new Set(['https://nft.collectorcrypt.com/meta/1']));
	});

	it('still refuses a redirect off the allowlist from a fallback gateway', async () => {
		const seen = [];
		const fetchImpl = async (url) => {
			seen.push(url);
			return response(302, '', { location: 'https://169.254.169.254/latest/meta-data' });
		};
		expect(await fetchCardJson(`https://arweave.net/${TX}`, { fetchImpl })).toBe(null);
		expect(seen.some((u) => u.includes('169.254'))).toBe(false);
	});
});

describe('walletRpc', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('scans through the configured providers when the public cluster refuses getProgramAccounts', async () => {
		vi.stubEnv('SOLANA_RPC_URL', '');
		vi.stubEnv('HELIUS_API_KEY', 'test-helius-key');
		const hosts = [];
		vi.stubGlobal('fetch', async (url) => {
			const { hostname } = new URL(String(url));
			hosts.push(hostname);
			if (hostname === 'mainnet.helius-rpc.com') {
				return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Connection rate limits exceeded' } }), {
				status: 429,
				headers: { 'content-type': 'application/json' },
			});
		});
		const rpc = walletRpc('mainnet');
		await expect(rpc('getProgramAccounts', ['CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d', { encoding: 'base64' }])).resolves.toEqual([]);
		expect(hosts).toContain('mainnet.helius-rpc.com');
	});
});

// A collector's wallet can hold far more cards than one response renders (a
// real mainnet wallet held 20,928 on 2026-11-03). Every card must be reachable:
// the on-chain list is ordered once, paged without gaps or repeats, and
// searchable by name across the whole wallet, not just the loaded page.
describe('wallet card paging', () => {
	const onchain = (n) =>
		Array.from({ length: n }, (_, i) => ({ address: `addr${String(n - i).padStart(5, '0')}`, name: `Card ${n - i}`, uri: `https://nft.collectorcrypt.com/${i}.json`, standard: 'core' }));

	it('reaches every card of a wallet larger than one page, with no gaps or repeats', () => {
		const index = walletCardIndex(onchain(WALLET_PAGE_SIZE * 2 + 7));
		const seen = [];
		let offset = 0;
		let pages = 0;
		while (offset != null) {
			const page = walletCardPage(index, { offset });
			expect(page.cards.length).toBeLessThanOrEqual(WALLET_PAGE_SIZE);
			seen.push(...page.cards.map((c) => c.address));
			offset = page.nextOffset;
			pages++;
		}
		expect(pages).toBe(3);
		expect(new Set(seen).size).toBe(WALLET_PAGE_SIZE * 2 + 7);
	});

	it('orders cards by name with numbers in natural order, independent of RPC order', () => {
		const a = walletCardIndex(onchain(12));
		const b = walletCardIndex(onchain(12).reverse());
		expect(a.map((c) => c.address)).toEqual(b.map((c) => c.address));
		expect(a.slice(0, 3).map((c) => c.name)).toEqual(['Card 1', 'Card 2', 'Card 3']);
	});

	it('searches every card in the wallet by name, all words, any case', () => {
		const cards = [
			...onchain(200),
			{ address: 'zz1', name: '1999 Pokemon Base Set Charizard PSA 10', uri: '', standard: 'core' },
			{ address: 'zz2', name: '2023 Pokemon Charizard ex CGC 9.5', uri: '', standard: 'core' },
		];
		const page = walletCardPage(walletCardIndex(cards), { q: '  charizard   PSA ' });
		expect(page.cards.map((c) => c.address)).toEqual(['zz1']);
		expect(page.total).toBe(1);
		expect(page.nextOffset).toBeNull();
		expect(walletCardPage(walletCardIndex(cards), { q: 'CHARIZARD' }).total).toBe(2);
	});

	it('clamps a bad offset instead of failing', () => {
		const index = walletCardIndex(onchain(5));
		expect(walletCardPage(index, { offset: -3 }).offset).toBe(0);
		expect(walletCardPage(index, { offset: 'x' }).cards.length).toBe(5);
		expect(walletCardPage(index, { offset: 500 }).cards).toEqual([]);
	});
});

describe('WalletIndexCache', () => {
	it('serves a scan until it expires, and a partial scan for less time', () => {
		const cache = new WalletIndexCache({ ttlMs: 60_000, partialTtlMs: 10_000, max: 2 });
		cache.set('a', { cards: [], partial: false }, 0);
		cache.set('b', { cards: [], partial: true }, 0);
		expect(cache.get('a', 59_000)).toBeTruthy();
		expect(cache.get('b', 9_000)).toBeTruthy();
		expect(cache.get('b', 11_000)).toBeNull();
		expect(cache.get('a', 61_000)).toBeNull();
	});

	it('evicts the oldest wallet past its size cap', () => {
		const cache = new WalletIndexCache({ ttlMs: 60_000, partialTtlMs: 10_000, max: 2 });
		cache.set('a', { cards: [], partial: false }, 0);
		cache.set('b', { cards: [], partial: false }, 1);
		cache.set('c', { cards: [], partial: false }, 2);
		expect(cache.get('a', 3)).toBeNull();
		expect(cache.get('c', 3)).toBeTruthy();
	});
});
