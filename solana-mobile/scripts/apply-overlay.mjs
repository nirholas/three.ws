#!/usr/bin/env node
// Apply solana-mobile/android-overlay/ to the Bubblewrap-generated project.
//
// `bubblewrap update` regenerates the whole Android project from
// twa/twa-manifest.json on every build, so anything native (the glance home
// screen widget, the Android Auto car app, the Android Automotive OS flavor)
// has to be laid on top AFTER update and BEFORE build. This script is that
// step, and build-apk.sh runs it in exactly that slot.
//
//   node scripts/apply-overlay.mjs --project build [--overlay android-overlay]
//
// What it does:
//   1. copies every file under <overlay>/app/ into <project>/app/ (sources,
//      layouts, drawables, values, xml, and the app/src/automotive flavor
//      source set), refusing to clobber a generated file it does not own;
//   2. splices AndroidManifest.permissions.xml after the <manifest> opening
//      tag and AndroidManifest.application.xml before </application>;
//   3. appends build.gradle.fragment to app/build.gradle, which declares the
//      `automotive` flavor only when an automotive build is asked for, so the
//      phone APK is byte for byte the build it was.
//
// It is idempotent (a fenced marker guards each splice, and a second run leaves
// the tree byte for byte as the first did; tests/solana-mobile-apply-overlay.test.js
// proves it against a real generated project) and it fails loudly
// on a missing overlay or a manifest it cannot parse: the listing says the app
// has a widget, so a build that silently dropped it would ship a lie.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const projectDir = path.resolve(root, opt('--project', 'build'));
const overlayDir = path.resolve(root, opt('--overlay', 'android-overlay'));

const log = (msg) => console.log(`[apply-overlay] ${msg}`);
const fail = (msg) => {
	console.error(`[apply-overlay] ERROR: ${msg}`);
	process.exit(1);
};

const REQUIRED = [
	'AndroidManifest.permissions.xml',
	'AndroidManifest.application.xml',
	'build.gradle.fragment',
	'app/src/main/java/ws/three/app/glance/GlanceWidget.java',
	'app/src/main/res/xml/glance_widget_info.xml',
	'app/src/main/java/ws/three/app/drive/DriveCarAppService.java',
	'app/src/main/res/xml/drive_automotive_app_desc.xml',
	'app/src/automotive/AndroidManifest.xml',
	'app/src/automotive/res/xml/drive_aaos_app_desc.xml',
];
for (const rel of REQUIRED) {
	if (!fs.existsSync(path.join(overlayDir, rel))) fail(`overlay is missing ${rel} (${overlayDir})`);
}

const manifestPath = path.join(projectDir, 'app/src/main/AndroidManifest.xml');
const gradlePath = path.join(projectDir, 'app/build.gradle');
if (!fs.existsSync(manifestPath)) fail(`no generated manifest at ${manifestPath}; run bubblewrap update first`);
if (!fs.existsSync(gradlePath)) fail(`no generated build.gradle at ${gradlePath}; run bubblewrap update first`);

// 1. Sources and resources. Every overlay file is namespaced by its feature, so
// a collision with a generated file means the generator changed under us.
// Re-applying the overlay over its own previous output is normal and must not
// trip that check, which is why ownership is by name and not by "does it exist".
// The one exception to naming is the automotive flavor's source set: its
// manifest has to be called AndroidManifest.xml, and Bubblewrap never generates
// a flavor source set, so everything under app/src/automotive/ is ours by path.
const OWNED = ['glance', 'drive'];
const OWNED_SOURCE_SETS = ['src/automotive/'];
// Case-insensitive: Java classes are capitalized (DriveWebService.java,
// GlanceWidget.java) while resources are lowercase (drive.xml), and both are
// ours. A case-sensitive check treated every edited class as a generated file
// and aborted the re-apply.
const isOurs = (rel) =>
	OWNED.some((prefix) => path.basename(rel).toLowerCase().includes(prefix)) ||
	OWNED_SOURCE_SETS.some((dir) => rel.split(path.sep).join('/').startsWith(dir));
let copied = 0;
function copyTree(from, to, rel = '') {
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const src = path.join(from, entry.name);
		const dst = path.join(to, entry.name);
		const relPath = path.join(rel, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(dst, { recursive: true });
			copyTree(src, dst, relPath);
			continue;
		}
		if (fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(src)) === false && !isOurs(relPath)) {
			fail(`refusing to overwrite generated file ${dst}`);
		}
		fs.copyFileSync(src, dst);
		copied++;
	}
}
copyTree(path.join(overlayDir, 'app'), path.join(projectDir, 'app'));
log(`copied ${copied} files into ${path.relative(root, projectDir)}/app`);

// 2. Manifest.
//
// Each splice is fenced by a begin/end comment and REPLACED on re-apply, rather
// than skipped when a marker is present. The difference matters the first time
// someone adds a permission to a fragment: a presence check leaves the old block
// in place and the new declaration never reaches the APK, which is a silent
// half-built feature. Replacing makes editing a fragment work the obvious way.
function fence(key) {
	return {
		begin: `<!-- three.ws overlay: ${key} (begin, generated by scripts/apply-overlay.mjs) -->`,
		end: `<!-- three.ws overlay: ${key} (end) -->`,
	};
}

function spliceFenced(text, key, body, place) {
	const { begin, end } = fence(key);
	const block = `${begin}\n${body.trimEnd()}\n    ${end}`;
	const from = text.indexOf(begin);
	const to = text.indexOf(end);
	if (from >= 0 && to > from) {
		return `${text.slice(0, from)}${block}${text.slice(to + end.length)}`;
	}
	const at = place(text);
	if (at < 0) return null;
	return `${text.slice(0, at)}\n    ${block}\n${text.slice(at)}`;
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
const permsBody = fs.readFileSync(path.join(overlayDir, 'AndroidManifest.permissions.xml'), 'utf8');
const appBody = fs.readFileSync(path.join(overlayDir, 'AndroidManifest.application.xml'), 'utf8');

const withPerms = spliceFenced(manifest, 'permissions', permsBody, (text) => {
	const open = text.match(/<manifest\b[^>]*>/);
	return open ? open.index + open[0].length : -1;
});
if (withPerms === null) fail('cannot find the <manifest> opening tag');
manifest = withPerms;

const withApp = spliceFenced(manifest, 'application', appBody, (text) => text.lastIndexOf('</application>'));
if (withApp === null) fail('cannot find </application>');
manifest = withApp;

fs.writeFileSync(manifestPath, manifest);
for (const needle of [
	'.glance.GlanceWidget',
	'.glance.GlanceLinkActivity',
	'android.permission.INTERNET',
	'.drive.DriveCarAppService',
	'.drive.DriveWebService',
	'androidx.car.app.category.IOT',
	'android.permission.RECORD_AUDIO',
]) {
	if (!manifest.includes(needle)) fail(`manifest merge lost ${needle}`);
}
log('merged the widget receiver, link activity, car app service, drive service, and permissions into AndroidManifest.xml');

// 3. Gradle.
const fragment = fs.readFileSync(path.join(overlayDir, 'build.gradle.fragment'), 'utf8');
let gradle = fs.readFileSync(gradlePath, 'utf8');
const GRADLE_BEGIN = '// three.ws overlay (begin, generated by scripts/apply-overlay.mjs)';
const GRADLE_END = '// three.ws overlay (end)';
const gradleBlock = `${GRADLE_BEGIN}\n${fragment.trimEnd()}\n${GRADLE_END}\n`;
const gFrom = gradle.indexOf(GRADLE_BEGIN);
const gTo = gradle.indexOf(GRADLE_END);
gradle = gFrom >= 0 && gTo > gFrom
	? `${gradle.slice(0, gFrom)}${gradleBlock}${gradle.slice(gTo + GRADLE_END.length + 1)}`
	: `${gradle.trimEnd()}\n\n${gradleBlock}`;
fs.writeFileSync(gradlePath, gradle);
for (const dep of [
	'androidx.work:work-runtime',
	'androidx.car.app:app:',
	'androidx.car.app:app-projected:',
	'androidx.car.app:app-automotive:',
	"productFlavors {",
]) {
	if (!gradle.includes(dep)) fail(`build.gradle merge lost ${dep}`);
}
log('appended the WorkManager and Car App Library dependencies and the automotive flavor to app/build.gradle');

// 4. The automotive flavor's manifest arrived with the copy in step 1; check
// the declarations AAOS will not run without, so a bad edit fails here rather
// than at Play review.
const aaosManifest = fs.readFileSync(path.join(projectDir, 'app/src/automotive/AndroidManifest.xml'), 'utf8');
for (const needle of [
	'androidx.car.app.activity.CarAppActivity',
	'android.hardware.type.automotive',
	'android.software.car.templates_host',
	'com.android.automotive',
	'@xml/drive_aaos_app_desc',
]) {
	if (!aaosManifest.includes(needle)) fail(`automotive flavor manifest lost ${needle}`);
}
log('automotive flavor source set in place (CarAppActivity, AAOS descriptor, feature declarations)');

log('overlay applied');
