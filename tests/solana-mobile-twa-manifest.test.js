// solana-mobile/twa/twa-manifest.json is what `bubblewrap update` regenerates the
// Android project from on every build, and build-apk.sh installs the newest
// @bubblewrap/cli. Bubblewrap 1.27's template depends on
// com.google.androidbrowserhelper:androidbrowserhelper 2.7.4, whose manifest
// declares minSdkVersion 24, so a project generated with minSdkVersion 23 fails
// the manifest merge before a single class compiles (found 2026-11-04 while
// building the Android Automotive flavor).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', 'solana-mobile/twa/twa-manifest.json'), 'utf8'),
);

// The floor androidbrowserhelper 2.7.4 declares in its own AndroidManifest.xml.
const ANDROID_BROWSER_HELPER_MIN_SDK = 24;

describe('twa-manifest.json', () => {
	it('generates a project whose minSdkVersion the TWA support library accepts', () => {
		expect(manifest.minSdkVersion).toBeGreaterThanOrEqual(ANDROID_BROWSER_HELPER_MIN_SDK);
	});
});
