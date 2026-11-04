// solana-mobile/scripts/apply-overlay.mjs lays the native overlay (the glance
// widget, the Android Auto car app, the Android Automotive OS flavor) over the
// project Bubblewrap regenerates on every build. build-apk.sh runs it after each
// `bubblewrap update`, and a developer re-runs it by hand, so applying it twice
// must leave exactly the tree that applying it once did: one copy of every
// splice, one flavor, one dependency.
//
// The fixture under tests/fixtures/bubblewrap-project is the pristine output of
// `bubblewrap update` (@bubblewrap/cli 1.27.0) for solana-mobile/twa, so the
// splices are exercised against the real generated manifest and build.gradle.

import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'solana-mobile/scripts/apply-overlay.mjs');
const OVERLAY = join(ROOT, 'solana-mobile/android-overlay');
const FIXTURE = join(ROOT, 'tests/fixtures/bubblewrap-project');

const dirs = [];
afterEach(() => {
	while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function generatedTree() {
	const dir = mkdtempSync(join(tmpdir(), 'three-ws-overlay-'));
	dirs.push(dir);
	cpSync(FIXTURE, dir, { recursive: true });
	return dir;
}

const apply = (project) =>
	execFileSync(process.execPath, [SCRIPT, '--project', project, '--overlay', OVERLAY], { encoding: 'utf8' });

/** path -> sha256 for every file under dir, so two trees compare byte for byte. */
function snapshot(dir) {
	const out = {};
	const walk = (d) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
		}
	};
	walk(dir);
	return out;
}

const count = (text, needle) => text.split(needle).length - 1;
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

describe('apply-overlay.mjs', () => {
	it('is idempotent: a second run leaves the tree byte for byte as the first did', () => {
		const dir = generatedTree();
		apply(dir);
		const once = snapshot(dir);
		apply(dir);
		expect(snapshot(dir)).toEqual(once);
	});

	it('adds the automotive flavor and its dependency to build.gradle exactly once', () => {
		const dir = generatedTree();
		apply(dir);
		apply(dir);
		const gradle = read(dir, 'app/build.gradle');
		expect(count(gradle, '// three.ws overlay (begin')).toBe(1);
		expect(count(gradle, "automotiveImplementation 'androidx.car.app:app-automotive:")).toBe(1);
		expect(count(gradle, "automotive {")).toBe(1);
		expect(count(gradle, "implementation 'androidx.car.app:app-projected:")).toBe(1);
	});

	it('declares the AAOS entry point in the automotive source set only, exactly once', () => {
		const dir = generatedTree();
		apply(dir);
		apply(dir);
		const aaos = read(dir, 'app/src/automotive/AndroidManifest.xml');
		expect(count(aaos, 'android:name="androidx.car.app.activity.CarAppActivity"')).toBe(1);
		expect(count(aaos, 'android:name="android.hardware.type.automotive"')).toBe(1);
		expect(count(aaos, 'android:name="android.software.car.templates_host"')).toBe(1);
		expect(count(aaos, 'android:name="com.android.automotive"')).toBe(1);
		expect(count(aaos, 'android:name="distractionOptimized"')).toBe(1);
		expect(read(dir, 'app/src/automotive/res/xml/drive_aaos_app_desc.xml')).toContain('<uses name="template"');

		// The phone manifest is the Android Auto one and must not learn about AAOS.
		const phone = read(dir, 'app/src/main/AndroidManifest.xml');
		expect(phone).not.toContain('CarAppActivity');
		expect(phone).not.toContain('android.hardware.type.automotive');
		expect(count(phone, '.drive.DriveCarAppService')).toBe(1);
		expect(count(phone, 'android.permission.RECORD_AUDIO')).toBe(1);
		expect(count(phone, 'three.ws overlay: application (begin')).toBe(1);
	});

	it('refreshes a stale copy of a file it owns, including the automotive source set it alone writes', () => {
		const dir = generatedTree();
		apply(dir);
		const aaos = join(dir, 'app/src/automotive/AndroidManifest.xml');
		writeFileSync(aaos, '<manifest/>\n');
		apply(dir);
		expect(readFileSync(aaos, 'utf8')).toBe(read(OVERLAY, 'app/src/automotive/AndroidManifest.xml'));
	});

	it('refreshes an edited Java source of its own, whose class name is capitalized', () => {
		// Bug 2026-11-04: ownership compared the lowercase feature prefix against
		// the file name case-sensitively, so DriveWebService.java and
		// GlanceWidget.java were "generated files" and any re-apply after editing
		// one aborted with "refusing to overwrite".
		const dir = generatedTree();
		apply(dir);
		for (const rel of [
			'app/src/main/java/ws/three/app/drive/DriveWebService.java',
			'app/src/main/java/ws/three/app/glance/GlanceWidget.java',
		]) {
			writeFileSync(join(dir, rel), '// an older build of this file\n');
		}
		apply(dir);
		expect(read(dir, 'app/src/main/java/ws/three/app/drive/DriveWebService.java')).toBe(
			read(OVERLAY, 'app/src/main/java/ws/three/app/drive/DriveWebService.java'),
		);
		expect(read(dir, 'app/src/main/java/ws/three/app/glance/GlanceWidget.java')).toBe(
			read(OVERLAY, 'app/src/main/java/ws/three/app/glance/GlanceWidget.java'),
		);
	});

	it('still refuses to overwrite a generated file it does not own', () => {
		const dir = generatedTree();
		const overlay = mkdtempSync(join(tmpdir(), 'three-ws-overlay-src-'));
		dirs.push(overlay);
		cpSync(OVERLAY, overlay, { recursive: true });
		// LauncherActivity.java is Bubblewrap's; an overlay that ships a different
		// one would be silently replacing the generator's code.
		const launcher = 'app/src/main/java/ws/three/app/LauncherActivity.java';
		writeFileSync(join(overlay, launcher), '// not the generated launcher\n');
		mkdirSync(dirname(join(dir, launcher)), { recursive: true });
		writeFileSync(join(dir, launcher), '// the generated launcher\n');
		expect(() =>
			execFileSync(process.execPath, [SCRIPT, '--project', dir, '--overlay', overlay], { stdio: 'pipe' }),
		).toThrow(/refusing to overwrite generated file/);
	});
});
