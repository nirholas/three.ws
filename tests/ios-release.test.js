// ios/scripts/release.mjs: the archive-and-upload pipeline for TestFlight.
//
// It only runs on a Mac, so the parts a Linux CI box can check are the ones
// that decide what Xcode is told: the build number App Store Connect will
// accept, the export options, the API key flags and the CarPlay switch. A
// wrong value in any of them fails as an upload rejection minutes into a
// build on someone's laptop, which is the slowest possible place to find it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	BASE_ENTITLEMENTS,
	CARPLAY_ENTITLEMENTS,
	IOS,
	authArgs,
	buildNumberFor,
	exportOptionsPlist,
	isBundleVersion,
	parseArgs,
	releasePlan,
} from '../ios/scripts/release.mjs';

const TEAM = { APPLE_TEAM_ID: 'ABCDE12345' };

describe('buildNumberFor', () => {
	it('is the UTC date and minute as a CFBundleVersion', () => {
		expect(buildNumberFor(new Date('2026-10-09T19:00:00Z'))).toBe('261009.1900');
		expect(buildNumberFor(new Date('2026-01-02T00:07:00Z'))).toBe('260102.7');
		expect(isBundleVersion(buildNumberFor(new Date()))).toBe(true);
	});

	it('only ever rises, which App Store Connect requires of every upload', () => {
		const minutes = [
			'2026-10-09T23:59:00Z',
			'2026-10-10T00:00:00Z',
			'2026-12-31T23:59:00Z',
			'2027-01-01T00:00:00Z',
		].map((t) => buildNumberFor(new Date(t)));
		const asTuple = (v) => v.split('.').map(Number);
		for (let i = 1; i < minutes.length; i++) {
			const [a, b] = [asTuple(minutes[i - 1]), asTuple(minutes[i])];
			expect(b[0] > a[0] || (b[0] === a[0] && b[1] > a[1])).toBe(true);
		}
	});
});

describe('parseArgs', () => {
	it('reads every flag', () => {
		expect(parseArgs(['--dry-run', '--carplay', '--export-only', '--skip-sync', '--build-number', '42', '--marketing-version', '1.2.0'])).toEqual({
			dryRun: true,
			carplay: true,
			exportOnly: true,
			skipSync: true,
			buildNumber: '42',
			marketingVersion: '1.2.0',
		});
	});

	it.each([
		[['--build-number'], /needs a value/],
		[['--build-number', '1.2.3.4'], /not one to three/],
		[['--marketing-version', 'v1'], /not one to three/],
		[['--upload'], /unknown option/],
	])('refuses %j', (argv, message) => {
		expect(() => parseArgs(argv)).toThrow(message);
	});
});

describe('authArgs', () => {
	it('is empty without an App Store Connect key, so Xcode uses the signed-in account', () => {
		expect(authArgs({})).toEqual([]);
	});

	it('passes all three key settings to xcodebuild', () => {
		const args = authArgs({ ASC_KEY_ID: 'KEY123', ASC_ISSUER_ID: 'issuer-uuid', ASC_KEY_PATH: '/keys/AuthKey_KEY123.p8' });
		expect(args).toEqual([
			'-authenticationKeyPath',
			'/keys/AuthKey_KEY123.p8',
			'-authenticationKeyID',
			'KEY123',
			'-authenticationKeyIssuerID',
			'issuer-uuid',
		]);
	});

	it('refuses a partial key', () => {
		expect(() => authArgs({ ASC_KEY_ID: 'KEY123' })).toThrow(/go together/);
	});
});

describe('exportOptionsPlist', () => {
	it('uploads to App Store Connect with automatic signing for the team', () => {
		const plist = exportOptionsPlist({ teamId: 'ABCDE12345', upload: true });
		expect(plist).toContain('<key>method</key>\n\t<string>app-store-connect</string>');
		expect(plist).toContain('<key>destination</key>\n\t<string>upload</string>');
		expect(plist).toContain('<key>teamID</key>\n\t<string>ABCDE12345</string>');
		expect(plist).toContain('<key>manageAppVersionAndBuildNumber</key>\n\t<false/>');
	});

	it('exports locally instead when asked', () => {
		expect(exportOptionsPlist({ teamId: 'ABCDE12345', upload: false })).toContain('<string>export</string>');
	});
});

describe('releasePlan', () => {
	const now = new Date('2026-10-09T19:00:00Z');

	it('checks, syncs, archives, then exports, in that order', () => {
		const plan = releasePlan({ ...parseArgs([]), now }, TEAM);
		expect(plan.steps.map(([cmd, args]) => `${cmd} ${args[0]}`)).toEqual([
			'node scripts/check-ios-app.mjs',
			'npm ci',
			'npx cap',
			'xcodebuild archive',
			'xcodebuild -exportArchive',
		]);
		const archive = plan.steps[3][1];
		expect(archive).toContain('DEVELOPMENT_TEAM=ABCDE12345');
		expect(archive).toContain('CURRENT_PROJECT_VERSION=261009.1900');
		expect(archive).toContain(`THREEWS_APP_ENTITLEMENTS=${BASE_ENTITLEMENTS}`);
		expect(archive.some((a) => a.startsWith('MARKETING_VERSION='))).toBe(false);
		expect(plan.archivePath.endsWith('App-261009.1900.xcarchive')).toBe(true);
	});

	it('signs with the CarPlay entitlements only when asked', () => {
		const plan = releasePlan({ ...parseArgs(['--carplay', '--skip-sync', '--marketing-version', '1.1']), now }, TEAM);
		const archive = plan.steps.find(([, args]) => args[0] === 'archive')[1];
		expect(archive).toContain(`THREEWS_APP_ENTITLEMENTS=${CARPLAY_ENTITLEMENTS}`);
		expect(archive).toContain('MARKETING_VERSION=1.1');
		expect(plan.steps.some(([cmd]) => cmd === 'npm')).toBe(false);
	});

	it('names entitlement files that exist in the Xcode project', () => {
		for (const file of [BASE_ENTITLEMENTS, CARPLAY_ENTITLEMENTS]) {
			expect(existsSync(join(IOS, 'native/App', file))).toBe(true);
		}
		const pbx = readFileSync(join(IOS, 'native/App/App.xcodeproj/project.pbxproj'), 'utf8');
		expect(pbx).toContain(`THREEWS_APP_ENTITLEMENTS = ${BASE_ENTITLEMENTS};`);
	});
});
