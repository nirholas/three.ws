#!/usr/bin/env node
/**
 * Validates the built .sppkg before it goes to an App Catalog or Partner
 * Center: opens the package (a zip) and checks the app manifest, the feature,
 * every component against its source manifest, the bundled client-side
 * assets, versions, and the store rules the package itself can prove.
 *
 * Usage: node scripts/validate-package.mjs [path/to/package.sppkg]
 * Exit code 0 when every check passes, 1 otherwise.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PACKAGE_ROOT as ROOT, defaultPackagePath, readJsonc, readZip } from './lib/sppkg.mjs';

const RUNTIME_VERSION = '1.5.2';
const RUNTIME_SOURCE = `https://three.ws/agent-3d/${RUNTIME_VERSION}/`;
const RUNTIME_INTEGRITY = 'sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q';
const MICROSOFT_NAMES = /\b(microsoft|sharepoint|teams|viva|office|outlook|onedrive|copilot|azure)\b/i;

function attr(xml, name) {
	const match = xml.match(new RegExp(`\\s${name}="([^"]*)"`));
	return match ? match[1] : '';
}

function decodeXml(value) {
	return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const results = [];
function check(ok, label, detail = '') {
	results.push({ ok: !!ok, label, detail });
}

const pkgJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const solutionConfig = readJsonc(join(ROOT, 'config/package-solution.json'));
const buildConfig = readJsonc(join(ROOT, 'config/config.json'));
const solution = solutionConfig.solution;
const sppkgPath = resolve(process.argv[2] || defaultPackagePath());

if (!existsSync(sppkgPath)) {
	console.error(`No package at ${sppkgPath}. Run npm run package:sharepoint first.`);
	process.exit(1);
}

const sppkg = readFileSync(sppkgPath);
const files = readZip(sppkg);
const text = (name) => (files.get(name) ? files.get(name).toString('utf8') : '');

// App manifest
const app = text('AppManifest.xml');
check(app, 'AppManifest.xml present');
check(attr(app, 'ProductID') === solution.id, 'solution id matches config', attr(app, 'ProductID'));
check(attr(app, 'Version') === solution.version, 'solution version matches config', attr(app, 'Version'));
check(/^\d+\.\d+\.\d+\.\d+$/.test(solution.version), 'solution version is four-part', solution.version);
check(solution.version.startsWith(`${pkgJson.version}.`), 'solution version matches package.json', `${solution.version} vs ${pkgJson.version}`);
check(attr(app, 'IsClientSideSolution') === 'true', 'client-side solution');
check(attr(app, 'SkipFeatureDeployment') === 'true', 'tenant-wide deployment available (skipFeatureDeployment)');
check(!MICROSOFT_NAMES.test(solution.name), 'solution name has no Microsoft product names', solution.name);

const developer = JSON.parse(decodeXml((app.match(/<DeveloperProperties>([^<]*)<\/DeveloperProperties>/) || [])[1] || '{}'));
for (const key of ['name', 'websiteUrl', 'privacyUrl', 'termsOfUseUrl', 'mpnId']) {
	check(developer[key], `developer.${key} set`, developer[key] || '');
}
for (const key of ['websiteUrl', 'privacyUrl', 'termsOfUseUrl']) {
	check(/^https:\/\//.test(developer[key] || ''), `developer.${key} is https`);
}
const longDescription = decodeXml((app.match(/<LongDescription>.*?CultureName="default">([^<]*)</) || [])[1] || '');
check(/web part/i.test(longDescription) && /Adaptive Card Extension/i.test(longDescription), 'long description names the component types (policy 1170)');

// Feature
const featureId = solution.features[0].id;
const feature = text(`feature_${featureId}.xml`);
check(feature, 'feature present', featureId);
check(attr(feature, 'Version') === solution.features[0].version, 'feature version matches config', attr(feature, 'Version'));
check(attr(feature, 'Version') === solution.version, 'feature version matches solution version');

// Components
const assetNames = [...files.keys()].filter((n) => n.startsWith('ClientSideAssets/'));
for (const [bundleName, bundle] of Object.entries(buildConfig.bundles)) {
	for (const component of bundle.components) {
		const manifest = readJsonc(join(ROOT, component.manifest));
		const kind = manifest.componentType === 'AdaptiveCardExtension' ? 'AdaptiveCardExtension' : 'WebPart';
		const xml = text(`${featureId}/${kind}_${manifest.id}.xml`);
		check(xml, `${manifest.alias} in package`, manifest.id);
		if (!xml) continue;
		const packaged = JSON.parse(decodeXml(attr(xml, 'ComponentManifest')));
		check(packaged.id === manifest.id, `${manifest.alias} id matches source manifest`);
		check(packaged.version === pkgJson.version, `${manifest.alias} version matches package.json`, packaged.version);
		check(packaged.requiresCustomScript !== true, `${manifest.alias} does not require custom script`);
		const title = manifest.preconfiguredEntries[0].title.default;
		check(title.startsWith('three.ws'), `${manifest.alias} title is three.ws-branded`, title);
		check(!MICROSOFT_NAMES.test(title), `${manifest.alias} title has no Microsoft product names`, title);
		const bundleFile = assetNames.find((n) => n.startsWith(`ClientSideAssets/${bundleName}_`) && n.endsWith('.js'));
		check(bundleFile, `${bundleName} bundle shipped in ClientSideAssets`, bundleFile || '');
		if (manifest.componentType === 'WebPart') {
			check(manifest.supportsThemeVariants === true, `${manifest.alias} supports theme variants`);
			for (const suffix of ['color', 'outline']) {
				check(files.has(`ClientSideAssets/${manifest.id}_${suffix}.png`), `${manifest.alias} Teams ${suffix} icon packaged`);
			}
		}
	}
}

// Client-side assets
check(solution.includeClientSideAssets === true, 'includeClientSideAssets is true');
check(text('ClientSideAssets.xml'), 'ClientSideAssets.xml present');
const bundles = assetNames.filter((n) => n.endsWith('.js')).map((n) => files.get(n).toString('utf8'));
const allCode = bundles.join('\n');
// The minifier splits the URL template, so check its parts: path, pinned version, SRI hash.
check(
	allCode.includes('https://three.ws/agent-3d/') && allCode.includes(`"${RUNTIME_VERSION}"`) && allCode.includes(RUNTIME_INTEGRITY),
	'bundle loads the pinned, integrity-checked runtime from the documented trusted source',
	RUNTIME_SOURCE,
);
const runtimeTs = readFileSync(join(ROOT, 'src/lib/runtime.ts'), 'utf8');
check(runtimeTs.includes(`'${RUNTIME_VERSION}'`) && runtimeTs.includes(RUNTIME_INTEGRITY), 'validator and src/lib/runtime.ts agree on runtime version and hash');
const scriptHosts = new Set();
for (const match of allCode.matchAll(/https:\/\/([a-z0-9.-]+)\/[a-z0-9_./-]*\.m?js\b/gi)) scriptHosts.add(match[1]);
check([...scriptHosts].every((h) => h === 'three.ws'), 'no script loaded from any host but three.ws', [...scriptHosts].join(', ') || 'none');
check(!/\beval\(|new Function\(/.test(allCode.replace(/\/\*[\s\S]*?\*\//g, '')), 'no eval or new Function in bundles');

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${sppkgPath}\n${sppkg.length.toLocaleString('en-US')} bytes, ${files.size} entries, ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
