import { describe, it, expect } from 'vitest';
import {
	newClaimsSince,
	rememberSignatures,
	formatSol,
	shortAddress,
	formatTelegramMessage,
	githubClaimKey,
	rememberGithubClaims,
} from '../api/_lib/pump-claims-push.js';

// Fixed clock so the cutoff arithmetic is deterministic.
const NOW_MS = 1_700_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);

// Synthetic mint/creator placeholders only: no real third-party mainnet
// addresses belong in committed fixtures.
function claim(signature, ts, overrides = {}) {
	return {
		creator: 'THREEsynthCreator1111111111111111111111111',
		mint: 'THREEsynthMint11111111111111111111111111111',
		signature,
		lamports: 1e9,
		ts,
		...overrides,
	};
}

function githubClaim(signature, ts, overrides = {}) {
	return claim(signature, ts, {
		githubUserId: '111',
		githubLogin: 'octocat',
		...overrides,
	});
}

describe('newClaimsSince selection', () => {
	it('returns unseen claims oldest-first', () => {
		const claims = [claim('c', NOW_S - 60), claim('a', NOW_S - 300), claim('b', NOW_S - 120)];
		const out = newClaimsSince(claims, { seen: [] }, NOW_MS);
		expect(out.map((c) => c.signature)).toEqual(['a', 'b', 'c']);
	});

	it('drops claims already posted, matched by signature', () => {
		const claims = [claim('a', NOW_S - 300), claim('b', NOW_S - 120)];
		const out = newClaimsSince(claims, { seen: ['a'] }, NOW_MS);
		expect(out.map((c) => c.signature)).toEqual(['b']);
	});

	it('keeps a claim sharing its second with the last posted one', () => {
		// The exact case a timestamp-only cursor loses: same ts, different tx.
		const ts = NOW_S - 100;
		const claims = [claim('a', ts), claim('b', ts)];
		const out = newClaimsSince(claims, { seen: ['a'], lastTs: ts }, NOW_MS);
		expect(out.map((c) => c.signature)).toEqual(['b']);
	});

	it('drops claims older than the cutoff so a catch-up never replays history', () => {
		const claims = [claim('old', NOW_S - 4 * 3600), claim('fresh', NOW_S - 60)];
		const out = newClaimsSince(claims, { seen: [] }, NOW_MS);
		expect(out.map((c) => c.signature)).toEqual(['fresh']);
	});

	it('ignores entries with no signature or an unusable timestamp', () => {
		const claims = [claim('', NOW_S - 60), claim('nan', Number.NaN), claim('ok', NOW_S - 60)];
		const out = newClaimsSince(claims, { seen: [] }, NOW_MS);
		expect(out.map((c) => c.signature)).toEqual(['ok']);
	});

	it('treats missing state as nothing seen', () => {
		const out = newClaimsSince([claim('a', NOW_S - 60)], {}, NOW_MS);
		expect(out).toHaveLength(1);
	});

	it('drops a GitHub claim already seen for the same GitHub user and mint, by a different signature', () => {
		const prior = githubClaim('sig1', NOW_S - 300);
		const repeat = githubClaim('sig2', NOW_S - 60);
		const out = newClaimsSince([repeat], { seen: [], githubSeen: [githubClaimKey(prior)] }, NOW_MS);
		expect(out).toHaveLength(0);
	});

	it('keeps a GitHub claim from the same user against a different mint', () => {
		const other = githubClaim('sig1', NOW_S - 60, { mint: 'THREEsynthMintOther111111111111111111111111' });
		const out = newClaimsSince(
			[other],
			{ seen: [], githubSeen: [githubClaimKey(githubClaim('seed', 0))] },
			NOW_MS,
		);
		expect(out.map((c) => c.signature)).toEqual(['sig1']);
	});

	it('does not apply the GitHub dedupe to an ordinary wallet claim', () => {
		const out = newClaimsSince([claim('a', NOW_S - 60)], { seen: [], githubSeen: ['111:anything'] }, NOW_MS);
		expect(out).toHaveLength(1);
	});
});

describe('githubClaimKey', () => {
	it('keys on GitHub user id and mint', () => {
		expect(githubClaimKey({ githubUserId: '111', mint: 'MintA' })).toBe('111:MintA');
	});

	it('falls back to an empty mint when none is present', () => {
		expect(githubClaimKey({ githubUserId: '111' })).toBe('111:');
	});
});

describe('rememberGithubClaims bounded ring', () => {
	it('records only claims carrying a GitHub user id', () => {
		const out = rememberGithubClaims([], [githubClaim('a', 1), claim('b', 2)]);
		expect(out).toEqual([githubClaimKey(githubClaim('a', 1))]);
	});

	it('appends to an existing ring', () => {
		const out = rememberGithubClaims(['999:MintZ'], [githubClaim('a', 1)]);
		expect(out).toEqual(['999:MintZ', githubClaimKey(githubClaim('a', 1))]);
	});

	it('caps the ring and keeps the newest entries', () => {
		const seen = Array.from({ length: 400 }, (_, i) => `u${i}:m`);
		const out = rememberGithubClaims(seen, [githubClaim('a', 1, { githubUserId: 'new' })]);
		expect(out).toHaveLength(400);
		expect(out.at(-1)).toBe(githubClaimKey(githubClaim('a', 1, { githubUserId: 'new' })));
		expect(out).not.toContain('u0:m');
	});

	it('defaults both arguments', () => {
		expect(rememberGithubClaims()).toEqual([]);
	});
});

describe('rememberSignatures bounded ring', () => {
	it('appends new signatures', () => {
		expect(rememberSignatures(['a'], ['b'])).toEqual(['a', 'b']);
	});

	it('caps the ring and keeps the newest entries', () => {
		const seen = Array.from({ length: 400 }, (_, i) => `s${i}`);
		const out = rememberSignatures(seen, ['new']);
		expect(out).toHaveLength(400);
		expect(out.at(-1)).toBe('new');
		expect(out).not.toContain('s0');
	});

	it('defaults both arguments', () => {
		expect(rememberSignatures()).toEqual([]);
	});
});

describe('formatSol', () => {
	it('renders whole SOL with two decimals', () => {
		expect(formatSol(2.5 * 1e9)).toBe('2.50 SOL');
	});

	it('renders sub-1 SOL with three decimals', () => {
		expect(formatSol(0.25 * 1e9)).toBe('0.250 SOL');
	});

	it('floors dust rather than showing 0.000 SOL', () => {
		expect(formatSol(1000)).toBe('<0.001 SOL');
	});

	it('groups large amounts', () => {
		expect(formatSol(12345 * 1e9)).toBe('12,345 SOL');
	});

	it('handles zero and garbage', () => {
		expect(formatSol(0)).toBe('0 SOL');
		expect(formatSol(Number.NaN)).toBe('0 SOL');
	});
});

describe('shortAddress', () => {
	it('middle-truncates a base58 address', () => {
		expect(shortAddress('ABCDEFGHIJKLMNOP')).toBe('ABCD…MNOP');
	});

	it('leaves a short string alone', () => {
		expect(shortAddress('ABCD')).toBe('ABCD');
	});

	it('handles null', () => {
		expect(shortAddress(null)).toBe('');
	});
});

describe('formatTelegramMessage', () => {
	it('includes the creator, amount, and both reference links', () => {
		const msg = formatTelegramMessage(claim('sig123', NOW_S));
		expect(msg).toContain('First creator fee claim');
		expect(msg).toContain('THREEsynthCreator1111111111111111111111111');
		expect(msg).toContain('1.00 SOL');
		expect(msg).toContain('https://solscan.io/tx/sig123');
		expect(msg).toContain('https://pump.fun/coin/THREEsynthMint11111111111111111111111111111');
	});

	it('omits the coin line and pump.fun link when the mint is unknown', () => {
		const msg = formatTelegramMessage(claim('sig123', NOW_S, { mint: '' }));
		expect(msg).not.toContain('Coin ');
		expect(msg).not.toContain('pump.fun');
		expect(msg).toContain('https://solscan.io/tx/sig123');
	});

	it('escapes HTML so a malformed scan result cannot inject markup', () => {
		const msg = formatTelegramMessage(
			claim('sig123', NOW_S, { creator: '<a href="https://evil.example">x</a>' }),
		);
		expect(msg).toContain('&lt;a href=');
		expect(msg).not.toContain('<a href="https://evil.example"');
	});

	it('renders a held-for-review message for a GitHub claim flagged by the impersonation gate, without the celebratory framing', () => {
		const msg = formatTelegramMessage(
			githubClaim('sig123', NOW_S, { held: true, heldReasons: ['GitHub account 5d old'] }),
		);
		expect(msg).toContain('GitHub fee withdrawal held for review');
		expect(msg).toContain('github.com/octocat');
		expect(msg).toContain('Held: GitHub account 5d old');
		expect(msg).not.toContain('First creator fee claim');
	});

	it('renders the attribution headline and explanation for an attributed, non-held GitHub claim', () => {
		const msg = formatTelegramMessage(
			githubClaim('sig123', NOW_S, {
				held: false,
				attribution: {
					label: 'transaction_attributed',
					headline: 'TRANSACTION-ATTRIBUTED GITHUB FEE CLAIM',
					explanation: 'This transaction distributed fees from this exact coin to the claimed GitHub fee account.',
				},
			}),
		);
		expect(msg).toContain('TRANSACTION-ATTRIBUTED GITHUB FEE CLAIM');
		expect(msg).toContain('This transaction distributed fees from this exact coin');
		expect(msg).not.toContain('held for review');
	});

	it('identifies an attributed GitHub claim by GitHub id when no login resolved', () => {
		const msg = formatTelegramMessage(
			githubClaim('sig123', NOW_S, {
				githubLogin: null,
				attribution: { label: 'unverified', headline: 'UNVERIFIED GITHUB FEE WITHDRAWAL', explanation: 'x' },
			}),
		);
		expect(msg).toContain('GitHub id 111');
	});
});
