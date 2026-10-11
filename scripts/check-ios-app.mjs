#!/usr/bin/env node
/**
 * Verifies the iOS app's native layer against the web code it talks to.
 *
 *   node scripts/check-ios-app.mjs
 *
 * Why this exists. Nothing on a Linux build machine can compile Swift, and the
 * iOS app is two halves that only meet on a phone: Swift in ios/native/App and
 * JavaScript that ships with the site. Every failure this catches has the same
 * shape, a name that changed on one side and not the other, and every one of
 * them is silent on device: a quick action whose type no longer matches a
 * route opens nothing, a share extension that is not embedded never appears in
 * the share sheet, a plugin method renamed in Swift makes the page's call
 * reject, and a SceneDelegate that roots the stock Capacitor controller quietly
 * drops swipe-back, the CarPlay channel and the app's own plugin.
 *
 * It is a structural check, not a build. Green means the halves agree; it does
 * not mean the Swift compiles. The Agent glance widget has its own check,
 * scripts/check-apple-widget.mjs.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const problems = [];
const fail = (msg) => {
	if (!problems.includes(msg)) problems.push(msg);
};
// A missing file is a finding, not a crash: report it and let every other
// check still run, so one deletion does not hide the rest of the report.
const read = (rel) => {
	if (!existsSync(join(REPO, rel))) {
		fail(`${rel} is missing`);
		return '';
	}
	return readFileSync(join(REPO, rel), 'utf8');
};
let checks = 0;
const pass = (msg) => {
	checks++;
	console.log(`[ios-app] ok   ${msg}`);
};
const section = (fn) => {
	const before = problems.length;
	const label = fn();
	if (problems.length === before) pass(label);
};

const pbx = read('ios/native/App/App.xcodeproj/project.pbxproj');
const appPlist = read('ios/native/App/App/Info.plist');
const sharePlist = read('ios/native/App/ShareExtension/Info.plist');
const pages = JSON.parse(read('data/pages.json'));
const pagePaths = new Set(pages.sections.flatMap((s) => s.pages || []).map((p) => p.path));

/** Build files for `file` in the pbxproj, one per target that compiles it. */
const buildFileCount = (file) => (pbx.match(new RegExp(`/\\* ${file.replace('.', '\\.')} in Sources \\*/ = `, 'g')) || []).length;

// ------------------------------------------------------------- sources ---

section(() => {
	for (const dir of ['ios/native/App/App', 'ios/native/App/ShareExtension']) {
		for (const file of readdirSync(join(REPO, dir)).filter((f) => f.endsWith('.swift'))) {
			if (!buildFileCount(file)) fail(`${dir}/${file} is on disk but no target compiles it`);
		}
	}
	// The inbox is written by the extension and read by the app.
	if (buildFileCount('SharedInbox.swift') !== 2) fail('SharedInbox.swift must be compiled by both the app and the share extension');
	return 'every Swift source under ios/native/App is a member of a target';
});

// ----------------------------------------------------- the share extension ---

section(() => {
	const required = [
		['/* ShareExtension */ = {\n\t\t\tisa = PBXNativeTarget;', 'the ShareExtension target'],
		['ShareExtension.appex in Embed Foundation Extensions', 'the extension embedded in the app'],
		['PRODUCT_BUNDLE_IDENTIFIER = ws.three.app.share;', 'the extension bundle id under the app id'],
		['INFOPLIST_FILE = ShareExtension/Info.plist;', 'the extension Info.plist'],
		['CODE_SIGN_ENTITLEMENTS = ShareExtension/ShareExtension.entitlements;', 'the extension entitlements'],
		['APPLICATION_EXTENSION_API_ONLY = YES;', 'the extension-safe API flag'],
	];
	for (const [needle, what] of required) if (!pbx.includes(needle)) fail(`project.pbxproj is missing ${what}`);
	for (const file of ['ShareViewController.swift', 'SharedInbox.swift', 'Info.plist', 'ShareExtension.entitlements']) {
		if (!existsSync(join(REPO, 'ios/native/App/ShareExtension', file))) fail(`ios/native/App/ShareExtension/${file} is missing`);
	}
	// App Store Connect rejects an upload whose extension version differs from
	// the app's, so every MARKETING_VERSION in the project has to agree.
	const versions = new Set([...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]));
	if (versions.size !== 1) fail(`MARKETING_VERSION differs between targets: ${[...versions].join(', ')}`);
	return 'the share extension target is wired, embedded and versioned with the app';
});

section(() => {
	if (!sharePlist.includes('com.apple.share-services')) fail('the share extension is not a share-services extension');
	if (!sharePlist.includes('$(PRODUCT_MODULE_NAME).ShareViewController')) fail('the share extension principal class is not ShareViewController');
	if (!sharePlist.includes('<key>GlanceAppGroup</key>')) fail('the share extension Info.plist does not carry GlanceAppGroup, which SharedInbox.swift reads');
	for (const file of ['ios/native/App/ShareExtension/ShareExtension.entitlements', 'ios/native/App/App/App.entitlements']) {
		if (!read(file).includes('$(GLANCE_APP_GROUP)')) fail(`${file} does not join the shared App Group`);
	}
	// The activation rule names the .glb type; only the app's import gives a
	// file that type, so the two have to agree on the identifier.
	const glb = 'org.khronos.glb';
	if (!sharePlist.includes(`"${glb}"`)) fail(`the share extension activation rule does not accept ${glb}`);
	if (!/UTImportedTypeDeclarations[\s\S]*org\.khronos\.glb[\s\S]*<string>glb<\/string>/.test(appPlist)) {
		fail(`the app does not import ${glb} for the .glb extension, so a model in Files never matches the activation rule`);
	}
	if (!read('ios/native/App/ShareExtension/ShareViewController.swift').includes(`"${glb}"`)) {
		fail(`ShareViewController.swift does not load ${glb}`);
	}
	return 'the share extension and the app agree on the App Group and the .glb type';
});

section(() => {
	const inbox = read('ios/native/App/ShareExtension/SharedInbox.swift');
	const landings = [...inbox.matchAll(/return "(\/[^"?]*)\?([^"]*)inbox=/g)];
	if (landings.length !== 2) fail(`SharedInbox.swift should land photos and models on two pages, found ${landings.length}`);
	for (const [, path, query] of landings) {
		if (!pagePaths.has(path)) fail(`SharedInbox.swift lands a share on ${path}, which is not in data/pages.json`);
		if (!query.includes('shared=')) fail(`SharedInbox.swift lands on ${path} without the shared= intent the page checks`);
	}
	const shareTarget = read('src/shared/share-target.js');
	if (!shareTarget.includes(".get('inbox')")) fail('src/shared/share-target.js no longer reads the inbox param');
	if (!shareTarget.includes('takeShare')) fail('src/shared/share-target.js no longer calls ThreeWsApp.takeShare');
	return 'a shared file lands on a real page that reads it from the app';
});

// ------------------------------------------------------- app controller ---

section(() => {
	const scene = read('ios/native/App/App/SceneDelegate.swift');
	if (/rootViewController = CAPBridgeViewController\(\)/.test(scene)) {
		fail('SceneDelegate roots the stock CAPBridgeViewController, which drops MainViewController and everything it installs');
	}
	if (!/MainViewController\(\)/.test(scene)) fail('SceneDelegate does not create MainViewController');
	if (!scene.includes('sceneDidBecomeActive') || !scene.includes('SharedInbox.claimPending')) {
		fail('SceneDelegate never collects a pending share');
	}
	const main = read('ios/native/App/App/MainViewController.swift');
	if (!main.includes('registerPluginInstance(ThreeWsAppPlugin())')) fail('MainViewController does not register the ThreeWsApp plugin');
	return 'the scene is rooted in MainViewController, which registers the app plugin';
});

section(() => {
	const swift = read('ios/native/App/App/ThreeWsAppPlugin.swift');
	if (!swift.includes('jsName = "ThreeWsApp"')) fail('ThreeWsAppPlugin is not exposed to the web as ThreeWsApp');
	const methods = [...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((m) => m[1]);
	for (const m of methods) {
		if (!new RegExp(`@objc func ${m}\\(`).test(swift)) fail(`ThreeWsAppPlugin declares ${m} but does not implement it`);
	}
	const callers = {
		takeShare: read('src/shared/share-target.js'),
		setBadge: read('ios/src/native-bridge.js'),
		openInSafari: read('ios/src/native-bridge.js'),
	};
	for (const [m, js] of Object.entries(callers)) {
		if (!methods.includes(m)) fail(`the web calls ThreeWsApp.${m}, which the plugin does not declare`);
		if (!js.includes(`.${m}(`)) fail(`nothing on the web calls ThreeWsApp.${m} any more`);
	}
	return `the ThreeWsApp plugin's ${methods.length} methods match their web callers`;
});

// -------------------------------------------------------------- push ---

section(() => {
	const app = read('ios/native/App/App/AppDelegate.swift');
	for (const [hook, name] of [
		['didRegisterForRemoteNotificationsWithDeviceToken', '.capacitorDidRegisterForRemoteNotifications'],
		['didFailToRegisterForRemoteNotificationsWithError', '.capacitorDidFailToRegisterForRemoteNotifications'],
	]) {
		if (!app.includes(hook) || !app.includes(name)) fail(`AppDelegate does not forward ${hook} to Capacitor, so register() never resolves`);
	}
	if (!read('ios/native/App/App/App.entitlements').includes('aps-environment')) fail('App.entitlements has no aps-environment');
	if (!appPlist.includes('remote-notification')) fail('Info.plist does not declare the remote-notification background mode');
	const client = read('src/push-notifications.js');
	if (!client.includes("'/api/push/device'")) fail('src/push-notifications.js does not register the device with /api/push/device');
	if (!existsSync(join(REPO, 'api/push/device.js'))) fail('api/push/device.js is missing');
	if (!read('api/_lib/notify.js').includes('sendApnsToUser')) fail('api/_lib/notify.js does not fan out to APNs');
	if (!read('ios/src/native-bridge.js').includes('pushNotificationActionPerformed')) fail('the bridge does not route a tapped push');
	return 'push is wired from the app delegate through the device endpoint to the notification fan-out';
});

// ------------------------------------------------- upload readiness ---

// Required reason APIs (ITMS-91053). App Store Connect refuses a build whose
// binary calls one of these without a manifest naming the category. Each row
// maps a call to its category; the plugin rows cover Capacitor plugins that
// Swift Package Manager links straight into the app and that ship no manifest.
const REASON_APIS = [
	{ category: 'NSPrivacyAccessedAPICategoryFileTimestamp', swift: /creationDate|contentModificationDate|modificationDate|attributesOfItem|\bstat\(/ },
	{ category: 'NSPrivacyAccessedAPICategoryUserDefaults', swift: /UserDefaults/ },
	{ category: 'NSPrivacyAccessedAPICategorySystemBootTime', swift: /systemUptime|mach_absolute_time/ },
	{ category: 'NSPrivacyAccessedAPICategoryDiskSpace', swift: /volumeAvailableCapacity|systemFreeSize|systemSize\b/ },
	{ category: 'NSPrivacyAccessedAPICategoryActiveKeyboards', swift: /activeInputModes/ },
];
const PLUGIN_REASONS = {
	'@capacitor/preferences': 'NSPrivacyAccessedAPICategoryUserDefaults',
	'@capacitor/filesystem': 'NSPrivacyAccessedAPICategoryFileTimestamp',
};

section(() => {
	const targets = [
		{ name: 'App', dir: 'ios/native/App/App', group: 'App' },
		{ name: 'ShareExtension', dir: 'ios/native/App/ShareExtension', group: 'ShareExtension' },
	];
	const iosDeps = Object.keys(JSON.parse(read('ios/package.json') || '{}').dependencies || {});
	for (const t of targets) {
		const manifest = read(`${t.dir}/PrivacyInfo.xcprivacy`);
		if (!manifest) continue;
		// Membership in the target's Resources phase is what puts the file in
		// the bundle; a manifest on disk that no phase copies is not uploaded.
		const targetBlock = pbx.match(new RegExp(`/\\* ${t.name} \\*/ = \\{\\n\\t\\t\\tisa = PBXNativeTarget;[\\s\\S]*?\\n\\t\\t\\};`))?.[0] || '';
		const resId = targetBlock.match(/(\w{24}) \/\* Resources \*\//)?.[1];
		const phase = resId && pbx.match(new RegExp(`${resId} /\\* Resources \\*/ = \\{\\n\\t\\t\\tisa = PBXResourcesBuildPhase;[\\s\\S]*?\\n\\t\\t\\};`))?.[0];
		if (!phase?.includes('PrivacyInfo.xcprivacy in Resources')) fail(`${t.dir}/PrivacyInfo.xcprivacy is not in the ${t.name} target's Resources phase`);
		if (!/<key>NSPrivacyTracking<\/key>\s*<(true|false)\/>/.test(manifest)) fail(`${t.dir}/PrivacyInfo.xcprivacy does not declare NSPrivacyTracking`);

		const sources = readdirSync(join(REPO, t.dir)).filter((f) => f.endsWith('.swift'));
		// SharedInbox.swift lives with the extension but is compiled into both binaries.
		if (!sources.includes('SharedInbox.swift')) sources.push('../ShareExtension/SharedInbox.swift');
		const swift = sources.map((f) => read(`${t.dir}/${f}`).replace(/^\s*\/\/.*$/gm, '')).join('\n');
		const needed = new Set(REASON_APIS.filter((r) => r.swift.test(swift)).map((r) => r.category));
		if (t.name === 'App') for (const [dep, category] of Object.entries(PLUGIN_REASONS)) if (iosDeps.includes(dep)) needed.add(category);
		for (const category of needed) {
			const entry = manifest.match(new RegExp(`<string>${category}</string>\\s*<key>NSPrivacyAccessedAPITypeReasons</key>\\s*<array>\\s*<string>[0-9A-F]{4}\\.\\d</string>`));
			if (!entry) fail(`${t.name} calls a ${category.replace('NSPrivacyAccessedAPICategory', '')} API but ${t.dir}/PrivacyInfo.xcprivacy gives no reason for it (ITMS-91053)`);
		}
	}
	return 'the app and the share extension each bundle a privacy manifest covering every required reason API they call';
});

section(() => {
	// CarPlay is granted per app. codesign refuses an archive whose entitlements
	// name a capability its provisioning profile lacks, so the key lives in an
	// opt-in file and the default one must never carry it.
	const key = 'com.apple.developer.carplay-voice-based-conversation';
	const keys = (xml) => [...xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<key>([^<]+)<\/key>\s*(<[\s\S]*?)(?=\s*<key>|\s*<\/dict>\s*<\/plist>)/g)].map((m) => [m[1], m[2].replace(/\s+/g, '')]);
	const base = keys(read('ios/native/App/App/App.entitlements'));
	const carplay = keys(read('ios/native/App/App/App-CarPlay.entitlements'));
	if (base.some(([k]) => k === key)) fail(`App.entitlements carries ${key}; an archive signed before Apple grants it fails codesign`);
	if (!carplay.some(([k]) => k === key)) fail(`App-CarPlay.entitlements does not carry ${key}`);
	const rest = JSON.stringify(carplay.filter(([k]) => k !== key));
	if (rest !== JSON.stringify(base)) fail('App-CarPlay.entitlements has drifted from App.entitlements; apart from the CarPlay key they must be identical');
	const selectors = [...pbx.matchAll(/THREEWS_APP_ENTITLEMENTS = ([^;]+);/g)].map((m) => m[1]);
	if (selectors.length !== 2 || selectors.some((s) => s !== 'App/App.entitlements')) {
		fail('the App target must default THREEWS_APP_ENTITLEMENTS to App/App.entitlements in Debug and Release');
	}
	if ((pbx.match(/CODE_SIGN_ENTITLEMENTS = "\$\(THREEWS_APP_ENTITLEMENTS\)";/g) || []).length !== 2) {
		fail('the App target does not sign with $(THREEWS_APP_ENTITLEMENTS), so the release script cannot opt into CarPlay');
	}
	if (!read('ios/scripts/release.mjs').includes('App/App-CarPlay.entitlements')) fail('ios/scripts/release.mjs has no way to sign with App-CarPlay.entitlements');
	return 'CarPlay is opt-in at signing time, so a build without the grant still archives';
});

section(() => {
	// The app and every extension it embeds must carry the same build number,
	// or App Store Connect rejects the upload (ITMS-90473).
	const builds = new Set([...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1]));
	if (builds.size !== 1) fail(`CURRENT_PROJECT_VERSION differs between targets: ${[...builds].join(', ')}`);
	for (const plist of ['ios/native/App/App/Info.plist', 'ios/native/App/ShareExtension/Info.plist', 'apple/GlanceWidget/Info.plist']) {
		const xml = read(plist);
		if (!/<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/.test(xml)) fail(`${plist} hardcodes CFBundleVersion instead of $(CURRENT_PROJECT_VERSION), so the release script cannot bump it`);
		if (!/<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/.test(xml)) fail(`${plist} hardcodes CFBundleShortVersionString instead of $(MARKETING_VERSION)`);
	}
	if (!/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(appPlist)) fail('Info.plist does not answer ITSAppUsesNonExemptEncryption, so every TestFlight build waits on the export compliance question');
	return 'every target shares one build number and version, set from the build settings the release script overrides';
});

// ------------------------------------------------------- quick actions ---

section(() => {
	const swift = read('ios/native/App/App/QuickActions.swift');
	const routes = Object.fromEntries([...swift.matchAll(/"(ws\.three\.app\.[\w.]+)": "([^"]+)"/g)].map((m) => [m[1], m[2]]));
	const declared = [...appPlist.matchAll(/<key>UIApplicationShortcutItemType<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]);
	if (!declared.length) fail('Info.plist declares no quick actions');
	for (const type of declared) {
		if (!routes[type]) fail(`Info.plist declares quick action ${type}, which QuickActions.swift does not route`);
	}
	for (const [type, target] of Object.entries(routes)) {
		if (!declared.includes(type)) fail(`QuickActions.swift routes ${type}, which Info.plist never declares`);
		const path = target.split('?')[0];
		if (!pagePaths.has(path)) fail(`quick action ${type} opens ${path}, which is not in data/pages.json`);
	}
	return `${declared.length} quick actions are declared, routed and land on live pages`;
});

if (problems.length) {
	console.error('');
	for (const p of problems) console.error(`[ios-app] FAIL ${p}`);
	console.error(`\n[ios-app] ${problems.length} problem(s). See ios/README.md.`);
	process.exit(1);
}
console.log(`\n[ios-app] ${checks} checks passed.`);
