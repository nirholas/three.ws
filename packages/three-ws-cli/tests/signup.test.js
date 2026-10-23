// `three-ws signup --agent`: argument handling and the signing step.

import { describe, it, expect } from 'vitest';
import { generateKeyPairSigner, getBase58Encoder, verifySignature, getPublicKeyFromAddress } from '@solana/kit';
import { parse } from '../src/cli.js';
import { signChallenge } from '../src/commands/signup.js';

describe('signup --agent parsing', () => {
	it('treats a bare --agent on signup as a mode switch, not a missing value', () => {
		const { command, flags } = parse(['signup', '--agent']);
		expect(command).toBe('signup');
		expect(flags.agent).toBe('');
	});

	it('accepts --agent in the middle of other flags', () => {
		const { flags } = parse(['signup', '--agent', '--name', 'scout', '--storage', 'file']);
		expect(flags).toMatchObject({ agent: '', name: 'scout', storage: 'file' });
	});

	it('leaves --agent <id> alone on other commands', () => {
		const { flags } = parse(['agent', 'status', '--agent', 'abc']);
		expect(flags.agent).toBe('abc');
	});
});

describe('signChallenge', () => {
	it('returns a base58 ed25519 signature over the exact message bytes', async () => {
		const signer = await generateKeyPairSigner();
		const message = 'three.ws agent signup v2\ndomain: three.ws\nnonce: abc';
		const signature = await signChallenge(signer, message);
		const bytes = getBase58Encoder().encode(signature);
		expect(bytes).toHaveLength(64);
		const key = await getPublicKeyFromAddress(signer.address);
		expect(await verifySignature(key, bytes, new TextEncoder().encode(message))).toBe(true);
		expect(await verifySignature(key, bytes, new TextEncoder().encode(`${message}!`))).toBe(false);
	});
});
