import { describe, it, expect } from 'vitest';
import {
	email,
	password,
	displayName,
	slug,
	avatarVisibility,
	avatarContentType,
	username,
	registerBody,
	loginBody,
	createAvatarBody,
	presignUploadBody,
	parse,
} from '../../api/_lib/validate.js';

describe('email schema', () => {
	it('accepts valid email', () => {
		expect(email.parse('User@Example.COM')).toBe('user@example.com');
	});

	it('trims whitespace and lowercases', () => {
		expect(email.parse('  Test@Email.org  ')).toBe('test@email.org');
	});

	it('rejects invalid email', () => {
		expect(() => email.parse('not-an-email')).toThrow();
	});

	it('rejects email over 254 chars', () => {
		const long = 'a'.repeat(244) + '@example.com';
		expect(() => email.parse(long)).toThrow();
	});
});

describe('password schema', () => {
	it('accepts 10-char password', () => {
		expect(password.parse('1234567890')).toBe('1234567890');
	});

	it('rejects password under 10 chars', () => {
		expect(() => password.parse('short')).toThrow();
	});

	it('rejects password over 200 chars', () => {
		expect(() => password.parse('a'.repeat(201))).toThrow();
	});
});

describe('displayName schema', () => {
	it('accepts valid display name', () => {
		expect(displayName.parse('  Alice  ')).toBe('Alice');
	});

	it('rejects empty string', () => {
		expect(() => displayName.parse('')).toThrow();
	});

	it('rejects name over 80 chars', () => {
		expect(() => displayName.parse('a'.repeat(81))).toThrow();
	});
});

describe('slug schema', () => {
	it('accepts valid slugs', () => {
		expect(slug.parse('my-avatar')).toBe('my-avatar');
		expect(slug.parse('avatar_1')).toBe('avatar_1');
		expect(slug.parse('abc123')).toBe('abc123');
	});

	it('rejects slugs starting with - or _', () => {
		expect(() => slug.parse('-bad')).toThrow();
		expect(() => slug.parse('_bad')).toThrow();
	});

	it('rejects uppercase letters', () => {
		expect(() => slug.parse('MyAvatar')).toThrow();
	});

	it('rejects empty string', () => {
		expect(() => slug.parse('')).toThrow();
	});

	it('rejects slug over 64 chars', () => {
		expect(() => slug.parse('a'.repeat(65))).toThrow();
	});
});

describe('avatarVisibility schema', () => {
	it('accepts valid values', () => {
		expect(avatarVisibility.parse('private')).toBe('private');
		expect(avatarVisibility.parse('unlisted')).toBe('unlisted');
		expect(avatarVisibility.parse('public')).toBe('public');
	});

	it('rejects unknown values', () => {
		expect(() => avatarVisibility.parse('hidden')).toThrow();
	});
});

describe('avatarContentType schema', () => {
	it('accepts GLB content type', () => {
		expect(avatarContentType.parse('model/gltf-binary')).toBe('model/gltf-binary');
	});

	it('accepts GLTF content type', () => {
		expect(avatarContentType.parse('model/gltf+json')).toBe('model/gltf+json');
	});

	it('rejects other content types', () => {
		expect(() => avatarContentType.parse('image/png')).toThrow();
		expect(() => avatarContentType.parse('text/html')).toThrow();
	});
});

describe('username schema', () => {
	it('accepts valid usernames', () => {
		expect(username.parse('alice_123')).toBe('alice_123');
		expect(username.parse('Bob-42')).toBe('Bob-42');
	});

	it('rejects username under 3 chars', () => {
		expect(() => username.parse('ab')).toThrow();
	});

	it('rejects username over 30 chars', () => {
		expect(() => username.parse('a'.repeat(31))).toThrow();
	});

	it('rejects special characters', () => {
		expect(() => username.parse('user@name')).toThrow();
		expect(() => username.parse('user name')).toThrow();
	});
});

describe('registerBody schema', () => {
	it('accepts valid registration body', () => {
		const result = registerBody.parse({
			email: 'user@example.com',
			password: 'securepassword1',
		});
		expect(result.email).toBe('user@example.com');
		expect(result.password).toBe('securepassword1');
	});

	it('accepts optional display_name', () => {
		const result = registerBody.parse({
			email: 'user@example.com',
			password: 'securepassword1',
			display_name: 'Alice',
		});
		expect(result.display_name).toBe('Alice');
	});

	it('rejects missing email', () => {
		expect(() => registerBody.parse({ password: 'securepassword1' })).toThrow();
	});
});

describe('loginBody schema', () => {
	it('accepts email + password', () => {
		const result = loginBody.parse({ email: 'user@example.com', password: 'pass' });
		expect(result.email).toBe('user@example.com');
	});

	it('rejects empty password', () => {
		expect(() => loginBody.parse({ email: 'user@example.com', password: '' })).toThrow();
	});
});

describe('createAvatarBody schema', () => {
	const base = { name: 'My Avatar', size_bytes: 1024 };

	it('accepts minimal valid body with defaults', () => {
		const result = createAvatarBody.parse(base);
		expect(result.name).toBe('My Avatar');
		expect(result.visibility).toBe('private');
		expect(result.tags).toEqual([]);
		expect(result.source).toBe('upload');
		expect(result.content_type).toBe('model/gltf-binary');
	});

	it('rejects size_bytes over 500MB', () => {
		expect(() =>
			createAvatarBody.parse({ ...base, size_bytes: 500 * 1024 * 1024 + 1 }),
		).toThrow();
	});

	it('rejects invalid checksum format', () => {
		expect(() => createAvatarBody.parse({ ...base, checksum_sha256: 'not-a-hash' })).toThrow();
	});

	it('accepts valid 64-char hex checksum', () => {
		const result = createAvatarBody.parse({
			...base,
			checksum_sha256: 'a'.repeat(64),
		});
		expect(result.checksum_sha256).toBe('a'.repeat(64));
	});
});

describe('parse helper', () => {
	it('returns parsed data on success', () => {
		const result = parse(email, 'user@example.com');
		expect(result).toBe('user@example.com');
	});

	it('throws error with status 400 and code validation_error on failure', () => {
		let err;
		try {
			parse(email, 'not-an-email');
		} catch (e) {
			err = e;
		}
		expect(err).toBeDefined();
		expect(err.status).toBe(400);
		expect(err.code).toBe('validation_error');
		expect(err.message).toBeTruthy();
	});

	it('includes field path in error message', () => {
		let err;
		try {
			parse(registerBody, { email: 'bad', password: 'short' });
		} catch (e) {
			err = e;
		}
		expect(err.message).toMatch(/email|password/i);
	});
});
