#!/usr/bin/env node
/**
 * Archives the iOS app and uploads it to App Store Connect for TestFlight.
 *
 *   node ios/scripts/release.mjs [--dry-run] [--carplay] [--export-only]
 *                                [--build-number N] [--marketing-version X.Y.Z]
 *                                [--skip-sync]
 *
 * One command from a clean checkout to a build processing in TestFlight. Every
 * upload is otherwise a dozen clicks in Xcode, and the two mistakes that cost a
 * day each, a build number App Store Connect has already seen and an archive
 * made before `cap sync` wrote capacitor.config.json, are both mechanical, so
 * the script owns them.
 *
 * Steps, in order:
 *   1. scripts/check-ios-app.mjs, the structural check. A red one here is a
 *      build Apple would reject or a feature that is silently dead on device.
 *   2. npm ci + cap sync in ios/, which writes the gitignored
 *      capacitor.config.json, config.xml and shell bundle the archive copies.
 *   3. xcodebuild archive, Release, signed by $APPLE_TEAM_ID with automatic
 *      signing. The build number is a UTC timestamp (YYMMDD.HMM), so it rises
 *      on every run without anyone tracking the last one.
 *   4. xcodebuild -exportArchive with destination=upload, which sends the
 *      build straight to App Store Connect. --export-only writes the .ipa to
 *      ios/native/App/build/export instead.
 *
 * Environment (read from the shell, then .env.local and .env at the repo root):
 *   APPLE_TEAM_ID   required. The 10-character team id from the Developer portal.
 *   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH
 *                   an App Store Connect API key (Users and Access, Integrations,
 *                   role App Manager). With all three, signing and upload run
 *                   with no Xcode account signed in, which is what a CI Mac needs.
 *                   Without them xcodebuild uses the account in Xcode > Settings.
 *
 * --carplay signs with App/App-CarPlay.entitlements. Use it only once Apple has
 * granted the CarPlay entitlement to ws.three.app: codesign refuses an archive
 * whose entitlements name a capability the provisioning profile lacks.
 *
 * --dry-run runs everywhere, Linux included: it validates the inputs, writes
 * ExportOptions.plist, and prints every command it would run.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const IOS = resolve(HERE, '..');
const REPO = resolve(IOS, '..');
const PROJECT_DIR = join(IOS, 'native/App');
const BUILD_DIR = join(PROJECT_DIR, 'build');

export const BASE_ENTITLEMENTS = 'App/App.entitlements';
export const CARPLAY_ENTITLEMENTS = 'App/App-CarPlay.entitlements';

/**
 * A CFBundleVersion that rises monotonically with wall-clock time: YYMMDD.HMM
 * in UTC. App Store Connect compares each dot-separated part as an integer, so
 * the minutes part is written without leading zeros (00:05 is "5", 12:00 is
 * "1200") and still orders correctly within a day.
 */
export function buildNumberFor(date = new Date()) {
	const pad = (n) => String(n).padStart(2, '0');
	const day = `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
	return `${Number(day)}.${date.getUTCHours() * 100 + date.getUTCMinutes()}`;
}

/** CFBundleVersion and CFBundleShortVersionString: one to three integers. */
export const isBundleVersion = (v) => /^\d+(\.\d+){0,2}$/.test(String(v));

export function parseArgs(argv) {
	const opts = { dryRun: false, carplay: false, exportOnly: false, skipSync: false, buildNumber: null, marketingVersion: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const value = () => {
			const v = argv[++i];
			if (v === undefined || v.startsWith('--')) throw new Error(`${arg} needs a value`);
			return v;
		};
		if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--carplay') opts.carplay = true;
		else if (arg === '--export-only') opts.exportOnly = true;
		else if (arg === '--skip-sync') opts.skipSync = true;
		else if (arg === '--build-number') opts.buildNumber = value();
		else if (arg === '--marketing-version') opts.marketingVersion = value();
		else throw new Error(`unknown option ${arg}`);
	}
	if (opts.buildNumber !== null && !isBundleVersion(opts.buildNumber)) throw new Error(`--build-number ${opts.buildNumber} is not one to three dot-separated integers`);
	if (opts.marketingVersion !== null && !isBundleVersion(opts.marketingVersion)) throw new Error(`--marketing-version ${opts.marketingVersion} is not one to three dot-separated integers`);
	return opts;
}

const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The ExportOptions.plist xcodebuild -exportArchive reads. */
export function exportOptionsPlist({ teamId, upload }) {
	const entries = [
		['method', 'string', 'app-store-connect'],
		['destination', 'string', upload ? 'upload' : 'export'],
		['teamID', 'string', teamId],
		['signingStyle', 'string', 'automatic'],
		['uploadSymbols', 'bool', true],
		// The script sets the build number itself; letting Xcode rewrite it
		// would make the archive and the uploaded build disagree.
		['manageAppVersionAndBuildNumber', 'bool', false],
	];
	const body = entries
		.map(([key, type, v]) => `\t<key>${key}</key>\n\t${type === 'bool' ? `<${v}/>` : `<string>${escapeXml(v)}</string>`}`)
		.join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

/** xcodebuild flags for an App Store Connect API key, or none without one. */
export function authArgs(env) {
	const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = env;
	const set = [ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH].filter(Boolean).length;
	if (set === 0) return [];
	if (set !== 3) throw new Error('ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH go together; set all three or none');
	return ['-authenticationKeyPath', resolve(ASC_KEY_PATH), '-authenticationKeyID', ASC_KEY_ID, '-authenticationKeyIssuerID', ASC_ISSUER_ID];
}

/** Every command the release runs, in order, as [cmd, args, cwd]. */
export function releasePlan(opts, env) {
	const teamId = env.APPLE_TEAM_ID;
	const buildNumber = opts.buildNumber ?? buildNumberFor(opts.now);
	const archivePath = join(BUILD_DIR, `App-${buildNumber}.xcarchive`);
	const exportPath = join(BUILD_DIR, 'export');
	const exportOptions = join(BUILD_DIR, 'ExportOptions.plist');
	const auth = authArgs(env);
	const settings = [
		`DEVELOPMENT_TEAM=${teamId}`,
		`CURRENT_PROJECT_VERSION=${buildNumber}`,
		...(opts.marketingVersion ? [`MARKETING_VERSION=${opts.marketingVersion}`] : []),
		`THREEWS_APP_ENTITLEMENTS=${opts.carplay ? CARPLAY_ENTITLEMENTS : BASE_ENTITLEMENTS}`,
	];
	const steps = [['node', ['scripts/check-ios-app.mjs'], REPO]];
	if (!opts.skipSync) steps.push(['npm', ['ci', '--no-audit', '--no-fund'], IOS], ['npx', ['cap', 'sync', 'ios'], IOS]);
	steps.push(
		[
			'xcodebuild',
			['archive', '-project', 'App.xcodeproj', '-scheme', 'App', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archivePath, '-allowProvisioningUpdates', ...auth, ...settings],
			PROJECT_DIR,
		],
		['xcodebuild', ['-exportArchive', '-archivePath', archivePath, '-exportOptionsPlist', exportOptions, '-exportPath', exportPath, '-allowProvisioningUpdates', ...auth], PROJECT_DIR],
	);
	return { buildNumber, archivePath, exportPath, exportOptions, steps, plist: exportOptionsPlist({ teamId, upload: !opts.exportOnly }) };
}

function loadRepoEnv() {
	for (const file of ['.env.local', '.env']) {
		const path = join(REPO, file);
		// loadEnvFile never overrides a variable the shell already set.
		if (existsSync(path)) process.loadEnvFile(path);
	}
}

function preflight(opts, env) {
	const problems = [];
	if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID || '')) {
		problems.push('APPLE_TEAM_ID is not set to a 10-character team id (Developer portal, Membership details)');
	}
	authArgs(env);
	if (env.ASC_KEY_PATH && !existsSync(resolve(env.ASC_KEY_PATH))) problems.push(`ASC_KEY_PATH ${env.ASC_KEY_PATH} does not exist`);
	if (opts.carplay && !existsSync(join(PROJECT_DIR, CARPLAY_ENTITLEMENTS))) problems.push(`${CARPLAY_ENTITLEMENTS} is missing`);
	if (!opts.dryRun) {
		if (process.platform !== 'darwin') problems.push('archiving needs macOS with Xcode; use --dry-run to check the plan here');
		else if (spawnSync('xcodebuild', ['-version']).status !== 0) problems.push('xcodebuild is not available; install Xcode and run xcode-select -s');
	}
	return problems;
}

function run([cmd, args, cwd]) {
	console.log(`\n[ios-release] $ (cd ${cwd.replace(REPO, '.') || '.'} && ${cmd} ${args.join(' ')})`);
	const res = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
	if (res.status !== 0) throw new Error(`${cmd} ${args[0]} exited with ${res.status ?? res.signal}`);
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	loadRepoEnv();
	const env = { ...process.env };
	const problems = preflight(opts, env);
	if (problems.length && !(opts.dryRun && problems.every((p) => p.startsWith('APPLE_TEAM_ID')))) {
		for (const p of problems) console.error(`[ios-release] ${p}`);
		process.exit(1);
	}
	if (opts.dryRun && !env.APPLE_TEAM_ID) {
		console.warn('[ios-release] APPLE_TEAM_ID is not set; the plan below uses TEAMID0000 in its place');
		env.APPLE_TEAM_ID = 'TEAMID0000';
	}
	const plan = releasePlan(opts, env);
	mkdirSync(BUILD_DIR, { recursive: true });
	writeFileSync(plan.exportOptions, plan.plist);
	console.log(`[ios-release] build ${plan.buildNumber}${opts.marketingVersion ? `, version ${opts.marketingVersion}` : ''}, ${opts.carplay ? 'with' : 'without'} CarPlay, ${opts.exportOnly ? 'export only' : 'upload to App Store Connect'}`);
	console.log(`[ios-release] wrote ${plan.exportOptions.replace(REPO + '/', '')}`);
	if (opts.dryRun) {
		for (const [cmd, args, cwd] of plan.steps) console.log(`  (cd ${cwd.replace(REPO, '.') || '.'} && ${cmd} ${args.join(' ')})`);
		return;
	}
	for (const step of plan.steps) {
		// capacitor.config.json is gitignored and written by cap sync. An
		// archive without it boots to a blank WebView with no server URL.
		if (step[1][0] === 'archive' && !existsSync(join(PROJECT_DIR, 'App/capacitor.config.json'))) {
			throw new Error('App/capacitor.config.json is missing; run without --skip-sync so cap sync writes it');
		}
		run(step);
	}
	console.log(
		opts.exportOnly
			? `\n[ios-release] exported to ${plan.exportPath}`
			: `\n[ios-release] build ${plan.buildNumber} uploaded. App Store Connect emails when processing finishes (usually 5 to 30 minutes); it then appears under TestFlight.`,
	);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (err) {
		console.error(`[ios-release] ${err.message}`);
		process.exit(1);
	}
}
