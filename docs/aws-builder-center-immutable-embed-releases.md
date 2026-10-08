---
title: "A URL is a promise: immutable releases for a 3D web component that runs on pages we do not own | three.ws on AWS"
venue: AWS Builder Center
account: three.ws (official organization account, byline "three.ws")
status: draft, owner approval required before publishing (external-channel gate in CLAUDE.md)
description: "How three.ws releases the <agent-3d> web component: one library build in two formats, a build order that is load-bearing, moving channels beside immutable versioned URLs, a write-once release archive, a ledger of Subresource Integrity hashes the build has to obey, and the incident where rebuilding one version on every deploy broke the integrity pins we had published for it. Plus the second lesson of code that runs on someone else's origin: where its API calls go."
tags: [web-components, cdn, supply-chain-security, release-engineering, open-source]
index: docs/aws-builder-center.md
---

# A URL is a promise: immutable releases for a 3D web component that runs on pages we do not own

Putting a live, animated 3D avatar on a web page takes two lines of HTML: a script tag that loads the `<agent-3d>` custom element from three.ws, and the element itself. That is the product working as intended, and it is also the hardest kind of software we ship, because the moment those two lines are pasted into somebody else's page we lose sight of the code. We do not see the page, we do not run its tests, and we do not get told when it breaks. The page's owner finds out when a visitor does.

So a release of that script is a set of promises to people we will never talk to:

1. **The URL serves bytes.** A versioned path answers today and in five years.
2. **The bytes are exactly those bytes.** A page that pins a hash gets the file the hash describes, or the browser refuses to run it.
3. **The bytes talk to us, not to the host.** Code running on `example.com` has to know where home is.

We broke the second promise, deploy after deploy, for about three and a half months, fixed it on 2026-10-01, and found a bug in the third promise two days later. This is the release pipeline after both fixes, with the incident where it happened. Every claim points at readable source in [the repository](https://github.com/nirholas/three.ws) (Apache-2.0) or at a public URL, and the live hashes can be recomputed with `curl` and `openssl` in the [Try it](#15-try-it) section.

**Status, plainly, because AWS builders check.** three.ws is a verified AWS Partner. The platform's runtime runs on Google Cloud Run, and the release archive described below is a Google Cloud Storage bucket. Nothing in this article runs on AWS, and we would rather say so than let a partner article imply a hosting story that is not ours. The patterns translate directly, though, and section 12 maps each one onto S3 and CloudFront for readers who want to build it there. Treat that section as a mapping, not as a description of something we operate.

**Contents**

1. What we ship, and to whom
2. One build, two formats
3. Why the build order is load-bearing
4. Moving channels and immutable versions
5. What Subresource Integrity promises, and what it does not
6. The incident: one version string, three hashes
7. The fix, part one: a write-once archive
8. The fix, part two: a ledger the build has to obey
9. The fix, part three: documentation is a pin too
10. Cutting a release
11. The second lesson: an embed runs on someone else's origin
12. Mapping this to AWS
13. What we would build differently
14. What to lift from this
15. Try it

---

## 1. What we ship, and to whom

`<agent-3d>` is a custom HTML element that carries the three.ws runtime in a single file: a three.js renderer, the avatar loader, the animation retargeting that lets one idle clip drive skeletons from many different tools, and the optional conversational layer. A bare embed looks like this:

```html
<script type="module" src="https://three.ws/agent-3d/1/agent-3d.js"></script>

<agent-3d body="https://three.ws/avatars/default.glb"
          style="width:480px;height:640px"></agent-3d>
```

The file behind that script tag is 3,308,933 bytes, measured with `curl` against production on 2026-10-08. It is self-contained on purpose: no chunk fetches, nothing for the host page to install. That makes the two-line embed possible and the release problem sharp: one artifact, loaded by everybody, executing with the full privileges of whatever page it lands on.

Its users fall into two camps:

- **The prototype builder** wants fixes to arrive without editing their page. They load a moving channel such as `/agent-3d/1/` and accept that the bytes change underneath them.
- **The production embedder** wants the bytes to never change without their consent. They load an exact version such as `/agent-3d/1.5.2/`, pin its Subresource Integrity hash, and upgrade on their own schedule.

Sections 6 to 9 are what happens when the second camp's promise is kept with the first camp's mechanism.

## 2. One build, two formats

The library is a separate Vite build from the website, selected by an environment variable. From [`package.json`](https://github.com/nirholas/three.ws/blob/main/package.json):

```json
"build:lib": "TARGET=lib vite build",
"build:lib:full": "TARGET=lib LIB_FORMATS=es,umd vite build",
```

`TARGET=lib` switches [`vite.config.js`](https://github.com/nirholas/three.ws/blob/main/vite.config.js) to its library config:

```js
build: {
	outDir: 'dist-lib',
	emptyOutDir: true,
	chunkSizeWarningLimit: 2000,
	lib: {
		entry: resolve(__dirname, 'src/lib.js'),
		name: 'Agent3D',
		formats: process.env.LIB_FORMATS ? process.env.LIB_FORMATS.split(',') : ['es'],
		fileName: (format) => (format === 'es' ? 'agent-3d.js' : 'agent-3d.umd.cjs'),
	},
	rollupOptions: {
		// inlineDynamicImports keeps the output as a single file so CDN
		// consumers get one <script type="module"> with no chunk fetches.
		// The lib IS the third-party embed, so it needs the old-WebView
		// polyfill even more than the app does.
		output: { inlineDynamicImports: true, banner: LEGACY_RUNTIME_POLYFILL },
	},
},
```

Two files come out of `build:lib:full`: `dist-lib/agent-3d.js`, the ES module our docs recommend, and `dist-lib/agent-3d.umd.cjs`, the same code wrapped for environments without ES modules. `inlineDynamicImports` is the line that makes the embed a single request: every dynamic `import()` inside the runtime is folded into the one file, so a host page never has to resolve a chunk path relative to an origin it does not control.

The `banner` prepends a small polyfill (the shipped file's first bytes define `Object.hasOwn` when it is missing), because the embed runs inside other people's WebViews, some of them old.

## 3. Why the build order is load-bearing

The production build is one npm script, `build:gcp`, and its order is not a style choice. Here is the chain from `package.json`, with each `&& npm run` drawn as an arrow:

```
check:conflicts → check:browser-graph → check:tdz-bootstrap → ensure:avatar-studio
→ build:info:snapshot → docs:freshness → build:lib:full → build:avatar-sdk
→ build:chat → build → publish:lib → build:info → check:dist → check:pages
```

Three constraints fix the library's place in it.

**The library has to be built before the avatar SDK.** We also publish the element as an npm package, `@three-ws/avatar`. Its build script, [`avatar-sdk/build.mjs`](https://github.com/nirholas/three.ws/blob/main/avatar-sdk/build.mjs), does not re-bundle anything. It copies the CDN file:

```js
const src = resolve(repoRoot, 'dist-lib', 'agent-3d.js');
```

```js
const outDir = resolve(here, 'dist');
mkdirSync(outDir, { recursive: true });

copyFileSync(src, resolve(outDir, 'index.mjs'));
```

Between those two excerpts sits a guard: when `dist-lib/agent-3d.js` does not exist, the script prints an error telling you to build the library first and calls `process.exit(1)`. One build, two distribution channels, identical bytes. That is the right design, and it creates an ordering dependency that is easy to miss.

**The avatar SDK has to be built before the website.** The website's own SDK page lazily imports `avatar-sdk/src/agent.js`, which in turn does `import('../dist/index.mjs')`. Vite resolves that import at build time. Until 2026-08-17 the deploy chain did not run `build:avatar-sdk` at all, so the frontend build silently resolved whatever stale `avatar-sdk/dist` the build machine happened to hold, and in a fresh checkout it failed outright with `Could not resolve "../dist/index.mjs"`. Commit `83f2cc476` added the step ahead of the frontend build.

**Publishing has to come after the website build.** The frontend `vite build` runs with `emptyOutDir`, so it wipes `dist/`. Anything that writes into `dist/` before it is lost. That is why `publish:lib`, which lays the library out under `dist/agent-3d/`, follows `build` rather than sitting next to `build:lib:full`, and why `check:dist`, which fails a deploy that lacks the library, runs after both.

The general lesson: when one artifact feeds others by copying, the copy creates a build-order edge no bundler knows about. Encode the order in one script, and make each step fail loudly on a missing input instead of using whatever is on disk.

## 4. Moving channels and immutable versions

The same origin serves four paths for the library:

| Path | Response cache header | Meant for |
|---|---|---|
| `/agent-3d/1.5.2/agent-3d.js` | `public, max-age=31536000, immutable` | Production embeds, pinned with SRI |
| `/agent-3d/1.5/agent-3d.js` | `public, max-age=3600, s-maxage=300, stale-while-revalidate=86400` | The newest build on the 1.5 line |
| `/agent-3d/1/agent-3d.js` | same as above | The newest build on the 1.x line |
| `/agent-3d/latest/agent-3d.js` | same as above | Demos only |

Those headers are what production returned on 2026-10-08, and they come from the route table in [`vercel.json`](https://github.com/nirholas/three.ws/blob/main/vercel.json) (the filename is legacy; our own Cloud Run server reads its routes on boot):

```json
{
	"src": "/agent-3d/([0-9]+\\.[0-9]+\\.[0-9]+(?:-[A-Za-z0-9.-]+)?)/(.*)",
	"headers": {
		"cache-control": "public, max-age=31536000, immutable",
		"access-control-allow-origin": "*",
		"access-control-allow-methods": "GET, HEAD, OPTIONS",
		"cross-origin-resource-policy": "cross-origin",
		"timing-allow-origin": "*"
	},
	"dest": "/agent-3d/$1/$2"
}
```

This rule is the whole contract. `immutable` with a one-year `max-age` tells browsers and shared caches that this URL will never change, so a browser holding the file does not even revalidate it. It is a performance gift and an irrevocable statement: if the bytes ever change, caches holding the old copy keep serving it for up to a year, everyone else gets the new one, and visitors split into two groups running different code under one version number.

The other lines matter for embedding. `access-control-allow-origin: *` is required, not optional: a `<script>` tag with an `integrity` attribute must be loaded in CORS mode (`crossorigin="anonymous"`), and a CORS-mode response without that header is blocked. `cross-origin-resource-policy: cross-origin` keeps the file loadable from pages that opt into cross-origin isolation.

The moving channels are the opposite contract: five minutes at the edge, an hour in the browser, and a long `stale-while-revalidate`. Note that `/agent-3d/1.5/` is labeled by a version line but serves the current build, which can be newer than the newest numbered release.

## 5. What Subresource Integrity promises, and what it does not

Subresource Integrity is a hash in the tag:

```html
<script
  type="module"
  src="https://three.ws/agent-3d/1.5.2/agent-3d.js"
  integrity="sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q"
  crossorigin="anonymous"
></script>
```

The browser downloads the file, computes its SHA-384, base64-encodes it, and compares it with the attribute. On a match the script runs. On a mismatch the browser refuses to execute it and logs an error in the host page's console. Here is the exact message Chromium printed when we loaded the URL above with the hash our own tutorial carried before 2026-10-01:

```
Failed to find a valid digest in the 'integrity' attribute for resource
'https://three.ws/agent-3d/1.5.2/agent-3d.js' with computed SHA-384 integrity
'KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q'.
The resource has been blocked.
```

For an embedder this is the right trade: if anything between them and us ever serves different bytes, malicious or mistaken, their page fails closed. The price is that the pinned URL has to be byte-stable forever, and the browser enforces that with no appeal.

Two things SRI does not cover, and we learned both while writing this article.

**SRI covers the body, not the headers around it.** The UMD build at `/agent-3d/1.5.2/agent-3d.umd.cjs` hashes exactly to its recorded value. It is also served with `content-type: application/node`, because our static server derives the type from the `.cjs` extension, and with `x-content-type-options: nosniff`, which our server sets on everything. Browsers refuse to execute a script whose type is not a JavaScript MIME type when `nosniff` is present. We loaded the documented UMD tag in headless Chromium from a non-three.ws origin and got:

```
Refused to execute script from 'https://three.ws/agent-3d/1.5.2/agent-3d.umd.cjs'
because its MIME type ('application/node') is not executable, and strict MIME
type checking is enabled.
```

The bytes are perfect and the file does not run. The archive copy of the same file is uploaded with `content-type: text/javascript; charset=utf-8`, so the fix is a header rule on our route, not a new release. The ES module, which is the format our docs recommend for production, is served as `text/javascript` and loads. We list this in section 13 because it is open at the time of writing.

**SRI does not promise the URL still exists.** A pinned URL that starts answering `404` fails exactly as closed as one with the wrong hash. Section 6 has an example.

## 6. The incident: one version string, three hashes

Here is what the publish step looked like before 2026-10-01, from the parent of commit [`bde1f4975`](https://github.com/nirholas/three.ws/commit/bde1f4975):

```js
const channels = [version, `${major}.${minor}`, major, 'latest'];
const sri = {};

for (const f of files) {
	if (f.skip) continue;
	const bytes = readFileSync(resolve(srcDir, f.name));
	const hash = createHash('sha384').update(bytes).digest('base64');
	sri[f.name] = `sha384-${hash}`;

	for (const channel of channels) {
		const outDir = resolve(destRoot, channel);
		mkdirSync(outDir, { recursive: true });
		writeFileSync(resolve(outDir, f.name), bytes);
	}
}
```

Look at the first line. The exact version directory is in the same list as the moving channels, and all four are written from `dist-lib/`, which is whatever the current build produced. Nothing about this is wrong on the day a version is cut. It goes wrong the day after, because nothing forces the version string to change when the code does.

Version 1.5.2 was cut on 2026-06-17 (commit `57c315696`). `package.json` then stayed at 1.5.2 until the fix on 2026-10-01. Over those three and a half months, every deploy rebuilt the library from current source and wrote the result to `/agent-3d/1.5.2/`, under a header that told the world those bytes would never change. Each rebuild with different library code meant a different hash behind the same URL.

The evidence was sitting in our own documentation. The fix commit replaced three different hashes for the same "immutable" file:

- our tutorial for embedding a Character Library avatar, and the combined docs page, pinned `sha384-qCG5gH4q2+k2...`,
- the embed instructions we ship to AI coding agents pinned `sha384-xkFDjVP866hY...`,
- production was serving `sha384-KdAiFRsdcCbQ...`.

Three snapshots of one version string, each true on the day it was copied, two of them refused by browsers at the time of the fix. A reader who followed the tutorial to the letter got a blank space and a console error in their own page.

There is a second casualty, quieter. The 1.5.2 commit message says "1.5.1 stays immutable." It did not stay at all. The old publish step only ever wrote the *current* version's directory, into a `dist/` that the frontend build empties on every run, so the deploy that shipped the bump dropped `/agent-3d/1.5.1/` entirely. On 2026-10-08 it answered `404`. That is the first promise from the introduction, broken by the same root cause: the serving side treated released versions as build output instead of as records.

The root cause, stated once: **a release was a side effect of a deploy.** Releases have to be records that deploys read from, never things deploys produce.

## 7. The fix, part one: a write-once archive

A released version now has one source of truth: a public-read Google Cloud Storage bucket, `gs://three-ws-lib-releases`, with each file under `agent-3d/<version>/`. On 2026-10-08 it held two objects, the two files of 1.5.2.

Two mechanisms make it write-once, at two different layers.

**The upload refuses to overwrite.** From [`scripts/release-lib.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/release-lib.mjs):

```js
gcloud([
	'storage',
	'cp',
	local,
	dest,
	'--if-generation-match=0',
	`--content-type=${CONTENT_TYPE[file]}`,
	'--cache-control=public, max-age=31536000, immutable',
]);
```

`--if-generation-match=0` is a precondition that only succeeds if no object exists at that path, so a second upload fails instead of replacing the file. The script treats that failure as "already archived" and verifies the archived bytes, so a re-run with *different* bytes cannot alter what is published.

**The bucket refuses to delete.** The bucket carries a retention policy of 315,295,200 seconds, a little under ten years, in effect since 2026-10-01 19:23 UTC. Until an object is older than that, it cannot be deleted or overwritten. The precondition protects against our scripts; the policy protects against a person with credentials and a bad afternoon.

The two overlap on purpose, because a precondition is opt-in per request and a hand-typed upload can forget it. One honest detail: the policy is not locked. A project owner could still shorten or remove it. Locking is irreversible, and section 13 covers why we have not done it yet.

The archive is also a public URL, so anyone can hash it and check that our origin serves what the archive holds.

## 8. The fix, part two: a ledger the build has to obey

The archive holds bytes. The ledger, [`data/agent-3d-releases.json`](https://github.com/nirholas/three.ws/blob/main/data/agent-3d-releases.json), holds the promise about them, committed to git where it can be reviewed and diffed:

```json
"archive": "https://storage.googleapis.com/three-ws-lib-releases/agent-3d",
"releases": {
	"1.5.2": {
		"publishedAt": "2026-10-01T19:22:44.064Z",
		"source": "https://three.ws/agent-3d/1.5.2/",
		"integrity": {
			"agent-3d.js": "sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q",
			"agent-3d.umd.cjs": "sha384-z74vjNbQ8KKXBZHL6JFhl4h45B+InYbzbV8ArjZSgzR+ATWOEthqu0S/eadTA0XC"
		}
	}
}
```

`publish:lib` now reads the ledger instead of the build for every released version. From [`scripts/publish-lib.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/publish-lib.mjs):

```js
// Moving channels: the current build.
const moving = [`${major}.${minor}`, String(major), 'latest'];
for (const channel of moving) {
	const outDir = resolve(destRoot, channel);
	mkdirSync(outDir, { recursive: true });
	for (const name of built) writeFileSync(resolve(outDir, name), build[name]);
}

// Immutable versions: the archived release bytes, verified.
const releases = releasedVersions(ledger);
for (const v of releases) {
	const outDir = resolve(destRoot, v);
	mkdirSync(outDir, { recursive: true });
	for (const name of RELEASE_FILES) {
		writeFileSync(resolve(outDir, name), await fetchReleaseFile(ledger, v, name, { cacheDir }));
	}
```

Compare that with section 6: the exact version is no longer written from the build. Every released version, not just the current one, is laid out from the archive on every deploy, which also keeps a release from disappearing the way 1.5.1 did.

`fetchReleaseFile` is where the ledger becomes binding. From [`scripts/lib/agent-3d-releases.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/lib/agent-3d-releases.mjs):

```js
const url = archiveUrl(ledger, version, file);
const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
if (!res.ok) throw new Error(`${url} answered ${res.status}; the archived release is unreachable`);
const bytes = Buffer.from(await res.arrayBuffer());
const actual = sri(bytes);
if (actual !== expected) {
	throw new Error(`${url} hashes to ${actual} but ${LEDGER_REL} records ${expected}; refusing to publish altered bytes`);
}
```

The archive is trusted only as far as it agrees with the ledger. A local cache keeps rebuilds from refetching, and a cached copy is re-hashed on every read, so a corrupt entry is refetched instead of served.

Two guards close the remaining doors. `publish:lib` refuses to run at all when `package.json` names a version the ledger has never released, so "bump the version and deploy" can no longer mint a release as a side effect; its error message names `npm run release:lib` as the way out. And `check:dist`, which runs after publishing in the same chain, re-hashes what actually landed in `dist/` and compares it with the ledger and with the published manifest. From [`scripts/check-dist.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/check-dist.mjs):

```js
const actual = sri(readFileSync(p));
if (actual !== expected) {
	console.error(`[check-dist] dist/agent-3d/${v}/${name} hashes to ${actual} but release ${v} is ${expected}; an immutable URL would change bytes`);
	releaseProblems++;
}
const advertised = manifest?.channels?.[v]?.integrity?.[name];
if (manifest && advertised !== expected) {
	console.error(`[check-dist] versions.json advertises ${advertised ?? 'nothing'} for ${v} ${name}; the release is ${expected}`);
	releaseProblems++;
}
```

The manifest publishing writes, `/agent-3d/versions.json`, is the public face of the ledger. Released versions are marked `"immutable": true` with their hashes; the moving channels are marked `"build": "current"`, with the current build's hashes under a separate `currentBuild` key, so an embedder can tell which hashes are safe to pin. The same JSON is served at `/api/agent-3d/versions` with a content-derived `ETag`, so polling it costs a body-less `304` when nothing changed.

## 9. The fix, part three: documentation is a pin too

The incident was found in documentation, so the fix treats documentation as release surface. Any `<script>` tag in our docs that loads a versioned agent-3d file with an `integrity` attribute is a promise to the reader that those exact bytes exist. The library finds every such tag:

```js
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const PINNED_SRC = /\bsrc\s*=\s*["']?[^"'\s>]*\/agent-3d\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\/(agent-3d\.(?:js|umd\.cjs))\b/i;
const INTEGRITY = /\bintegrity\s*=\s*["'](sha384-[A-Za-z0-9+/]{64})["']/i;
```

It walks `docs`, `specs`, `blog`, `examples`, the skill instructions for AI coding agents, the README, and `packages`. Two outcomes need different fixes. A pin whose hash disagrees with a released version is mechanically fixable: `npm run check:sri-pins -- --fix` rewrites the hash from the ledger. A pin on a version that was never released cannot be fixed by rewriting a hash, so it stays an error until a person points it at a real release.

The check runs in three places: as `npm run check:sri-pins` on demand, inside `check:dist` on every production build, and under `npm test`, through a test named "pins every documented agent-3d SRI hash to its released bytes" in [`tests/agent-3d-releases.test.js`](https://github.com/nirholas/three.ws/blob/main/tests/agent-3d-releases.test.js). Test fixtures are deliberately excluded from the scan, because they pin wrong hashes on purpose to exercise the stale-pin detection.

This article is in that scan, too. It lives in our `docs/` folder, so the production snippet in section 5 is checked against the ledger on every build. If we had pasted a stale hash into an article about stale hashes, the deploy would have failed.

## 10. Cutting a release

Cutting a release is now an explicit act:

```json
"release:lib": "npm run build:lib:full && node scripts/release-lib.mjs",
```

It builds both files, hashes them, and checks the ledger before touching the archive. An existing version with the same bytes is a no-op. An existing version with different bytes is a hard stop:

```js
const existing = ledger.releases[version];
if (existing) {
	const same = RELEASE_FILES.every((f) => existing.integrity?.[f] === files[f].integrity);
	if (!same) {
		console.error(
			`[release-lib] ${version} is already released with different bytes. A released version never changes;` +
				' bump package.json to a new version and release that.',
		);
		process.exit(1);
	}
```

After the upload, the script reads every file back through the same public URL the build will fetch from, and only then writes the ledger entry. Written last, the ledger only ever records releases the archive can prove. Finally the script runs the documentation pin check with `fix: true`, so the docs move to the new release in the same commit as the ledger. `--dry-run` prints the hashes and writes nothing.

End to end: bump `package.json`, run `npm run release:lib`, commit the ledger and any rewritten docs, deploy.

The script has one more mode, and it is how the incident was closed. `--from <origin>` adopts the bytes a live origin is already serving for the current version instead of the local build. On 2026-10-01 we had to pick which of the three 1.5.2 hashes to make permanent, knowing that any choice would leave holders of the other two broken. We froze 1.5.2 at the bytes production was serving at that moment (the ledger's `source` field records `https://three.ws/agent-3d/1.5.2/`), so that anyone loading the file that day, and any pin taken from the live site, kept working. The public changelog entry told everyone else to update their pin once, from `/agent-3d/1.5.2/integrity.json`.

The timeline is short enough to read in one line: the bucket was created at 19:20 UTC, the two files were archived at 19:22, the retention policy took effect at 19:23, the fix was committed at 19:25, and the build that production is still running was made at 19:31 (`/api/version` reports it). No fix for a broken immutability promise keeps every pin working. There is only choosing the least-bad hash quickly and making sure it never moves again.

## 11. The second lesson: an embed runs on someone else's origin

Two days after the freeze, a different embed bug surfaced: the third promise from the introduction, that the bytes talk to us and not to the host.

Inside our own site, `fetch('/api/agents/' + id)` is the obvious way to call our API. A site-absolute path resolves against the page's origin, which on three.ws is us. Inside an embed on `example.com`, the same line asks `example.com` for an agent. It gets a `404` (or, worse, whatever `example.com` happens to serve at that path), and the element falls back to a default body named "Agent". Before commit [`fb067d0f2`](https://github.com/nirholas/three.ws/commit/fb067d0f2), the agent resolver built its endpoint as `` `${location.origin}/api/agents/...` ``, and memory, skills and several other modules used bare relative paths. On three.ws, where the page origin and the API origin are the same, every one of those works, which is why it shipped.

The fix centralizes one decision in one small module, [`src/shared/embed-api-origin.js`](https://github.com/nirholas/three.ws/blob/main/src/shared/embed-api-origin.js), and threads its answer through the callers:

```js
// Resolution order (first match wins):
//   1. the `api-base` attribute, for self-hosted backends and local development;
//   2. the origin serving the element's script (three.ws for the CDN embed);
//   3. https://three.ws when that script came from a public npm CDN (unpkg,
//      jsDelivr, ...), which serves files but none of the API;
//   4. the page's own origin, which is only right when the page IS three.ws.
```

The second rule is the clever one, and it is cheap: an ES module knows its own URL through `import.meta.url`. The element computes it once at load (`apiOriginFromScriptURL(import.meta.url)`), so an embed loaded from three.ws calls three.ws from any page. The third rule exists because public package CDNs mirror our npm build but serve none of our API.

The same module decides credentials, and that half is a security decision as much as a correctness one:

```js
export function credentialsFor(base, pageOrigin) {
	return isPageOrigin(base, pageOrigin) ? 'include' : 'omit';
}
```

Cookies ride along only when the API base *is* the page's origin, meaning three.ws embedding itself. Anywhere else the session would be a third-party cookie, and a credentialed request is one our public endpoints refuse for arbitrary origins anyway.

The server side had to meet the client halfway. Public reads that an embed makes from unknown origins (fetching a public avatar by id, for example) used to answer only an allowlist of origins, so those reads were blocked with a CORS error in host pages. They now go through a helper in [`api/_lib/http.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/http.js):

```js
export function embedReadCors(req, res, { methods = 'GET,OPTIONS', authedMethods = methods } = {}) {
	const wanted = req.method === 'OPTIONS' ? String(req.headers['access-control-request-method'] || 'GET').toUpperCase() : req.method;
	const anonymous = !req.headers.cookie && !req.headers.authorization;
	const asksForAuth = /\bauthorization\b/i.test(String(req.headers['access-control-request-headers'] || ''));
	if (wanted === 'GET' && anonymous && !asksForAuth) return cors(req, res, { origins: '*', methods });
	return cors(req, res, { methods: authedMethods, credentials: true });
}
```

The rule is the one worth copying: a request with no cookie and no authorization header can only ever see the public answer, so it is safe to open to any origin with a wildcard. Anything that carries identity keeps the strict allowlist and its credentials. The tests in `tests/api/embed-public-reads-cors.test.js` pin all three cases: an anonymous read from a stranger gets the wildcard, a stranger's read that carries a session cookie gets no CORS grant, and a stranger's preflight for a write is refused.

Now the part that ties the two lessons together. That fix is committed to `main`, and on 2026-10-08 production had not deployed it yet (`/api/version` still reports the 2026-10-01 build). When it deploys, it reaches `/agent-3d/1/`, `/agent-3d/1.5/` and `latest` immediately. It will never reach `/agent-3d/1.5.2/`: those bytes are frozen, so a page pinned to 1.5.2 keeps the old origin handling until its owner moves to a newer release, which will exist once we cut 1.5.3. That is the design, not a flaw in it. A pinned embedder chose to receive no changes without consent, including good ones. The obligation on us is to cut releases often enough that "upgrade to get the fix" is a real option, and section 6 shows that is the habit we have to build.

## 12. Mapping this to AWS

We run none of this on AWS. For readers who would, every mechanism has a direct counterpart, and this is how we would map it.

| What we use | Job it does | Direct AWS mapping |
|---|---|---|
| GCS bucket with a retention policy | Released bytes cannot be deleted or overwritten | Amazon S3 with S3 Object Lock (requires versioning). Compliance mode is the counterpart of a locked retention policy; governance mode is closer to our current unlocked one |
| `gcloud storage cp --if-generation-match=0` | Upload fails if the object exists | S3 conditional writes: `PutObject` with `If-None-Match: *` fails with `412 Precondition Failed` when the key exists |
| `--content-type` and `--cache-control` set at upload | Correct headers travel with the object | `Content-Type` and `Cache-Control` object metadata on `PutObject` |
| Route rule with `immutable` and CORS headers | Versioned paths cached forever, loadable cross-origin | A CloudFront cache behavior for the versioned path pattern with a long-TTL cache policy and a response headers policy for CORS and `Cache-Control` |
| Moving-channel route with `s-maxage=300` | Channels follow the current build | A second CloudFront cache behavior with a short TTL |
| Full-path CDN purge after every deploy | Edges drop stale moving-channel copies | A CloudFront invalidation scoped to the moving-channel paths only. Versioned paths should never need one, which is a useful alarm in itself |
| `data/agent-3d-releases.json` in git | The reviewed record of what each release is | The same file in your repository. A ledger is a code-review artifact, not an infrastructure service |
| `check:dist` and `check:sri-pins` in the build | The build refuses to publish bytes that disagree with the ledger | The same scripts as a step in AWS CodeBuild, or whatever runs your build, before the sync to S3 |

Two notes on that mapping. First, Object Lock retention applies per object version; set a bucket default so every released key carries a retain-until date. Second, if you serve versioned files straight from S3 through CloudFront instead of copying them into an application container as we do, the ledger check runs before the upload to the release prefix, and the read-back goes through the CloudFront URL. The principle holds: record the hash only after the public path serves the bytes.

## 13. What we would build differently

Five things, plainly, including two we found while writing this.

**Make releases records from day one.** The incident follows from one early design choice: the publish step wrote released versions out of the current build. The fix is about 190 lines of shared library plus two small scripts. Not writing them on day one cost three and a half months of broken pins, a lost version, and a hash we had to choose under pressure.

**Do not let unknown versions inherit the immutable header.** The versioned route rule stamps its headers before the server knows whether a file exists, and the server's 404 fallback keeps them. A request for a version that does not exist yet, say `/agent-3d/1.5.3/agent-3d.js`, answers `404` with `cache-control: public, max-age=31536000, immutable`, and our edge cache stored it (a second request came back with an `age` header). Our deploy purges the whole CDN and a release always arrives through a deploy, so the edge copy is cleared in time, but a browser that asked early may keep its cached `404` far longer. The fix is to emit the immutable header only on a successful response.

**Serve every released file with the type it was archived with.** Section 5's UMD finding: the archive stores `text/javascript`, our static server re-derives `application/node` from the extension, and `nosniff` turns that into a refusal. A release record should cover the headers that decide whether the bytes execute, and `check:dist` could assert the served type as easily as the hash.

**Lock the retention policy.** An unlocked policy stops accidents, not a determined owner. Locking is irreversible for the life of the bucket, which is why we have not done it in the first week of the new flow, and it is the right end state for a bucket whose only job is to never change.

**Give embedders a way to hear about new releases.** Pinned embedders opted out of automatic changes, so they do not see fixes like the one in section 11. Our manifest makes polling cheap, but polling is something an embedder has to think of. A release feed carrying the change summary and the new pin would make "upgrade" a decision instead of a discovery.

## 14. What to lift from this

None of this depends on 3D, on our platform, or on a particular cloud. If you ship a script other people paste into their pages:

1. **Separate the release from the deploy.** A versioned URL should only ever be written from an archive of released bytes, never from the current build. Moving channels can follow the build. Exact versions cannot.
2. **Make the archive write-once at two layers.** A precondition on every upload, so your own tools cannot overwrite, and a retention policy on the bucket, so people cannot either.
3. **Keep a ledger in version control, and make the build obey it.** Hash on the way out of the archive and refuse to publish on a mismatch. Write the ledger entry only after the public URL serves the bytes.
4. **Treat every documented pin as part of the release.** Scan your docs for integrity attributes, fail the build when one disagrees with the ledger, and give yourself a `--fix` for the mechanical case.
5. **Resolve your API origin from your own script URL.** `import.meta.url` tells an embed where home is. Never build a request from `location.origin` in code that runs on other people's pages, send cookies only when the page is you, and open anonymous public reads to any origin while keeping everything credentialed on an allowlist.

The scripts are short and readable: [`scripts/release-lib.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/release-lib.mjs), [`scripts/publish-lib.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/publish-lib.mjs), [`scripts/check-sri-pins.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/check-sri-pins.mjs), and the shared [`scripts/lib/agent-3d-releases.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/lib/agent-3d-releases.mjs), which uses Node built-ins only so it can run in a build step without `node_modules`. Lift them whole.

## 15. Try it

Everything below is a read against public URLs. No account, no key. Paste and run.

```bash
# 1. Hash the pinned file exactly as a browser does for SRI
echo "sha384-$(curl -s https://three.ws/agent-3d/1.5.2/agent-3d.js \
  | openssl dgst -sha384 -binary | openssl base64 -A)"

# 2. Hash the same release straight from the write-once archive
echo "sha384-$(curl -s https://storage.googleapis.com/three-ws-lib-releases/agent-3d/1.5.2/agent-3d.js \
  | openssl dgst -sha384 -binary | openssl base64 -A)"

# 3. Compare both with the ledger in the repository, and with the sidecar we serve
curl -s https://raw.githubusercontent.com/nirholas/three.ws/main/data/agent-3d-releases.json | grep '"agent-3d.js"'
curl -s https://three.ws/agent-3d/1.5.2/integrity.json | grep '"agent-3d.js"'

# 4. The two cache contracts: immutable versus moving
curl -sI https://three.ws/agent-3d/1.5.2/agent-3d.js  | grep -i '^cache-control'
curl -sI https://three.ws/agent-3d/latest/agent-3d.js | grep -i '^cache-control'

# 5. The release manifest, then a cheap conditional poll that answers 304
curl -s https://three.ws/agent-3d/versions.json
ETAG=$(curl -sI https://three.ws/api/agent-3d/versions | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" https://three.ws/api/agent-3d/versions

# 6. The exact commit and build production is running
curl -s https://three.ws/api/version
```

Steps 1 to 3 should print the same `sha384-KdAiFRsdcCbQ...` four times. If they ever do not, the system described in this article has failed, and we would like to hear about it.

To see the browser enforce it, put the production snippet from section 5 in an empty HTML file, open it, and then change one character of the `integrity` value. The avatar disappears and the console tells you why. The full attribute, method and event reference is at [three.ws/docs/web-component](https://three.ws/docs/web-component), including the [CDN versioning](https://three.ws/docs/web-component#cdn-versioning) section this pipeline backs, and the [end-to-end tutorial](https://three.ws/tutorials/web-component-end-to-end) walks the element through a real page.

Source: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), Apache-2.0.

---

*three.ws is a verified AWS Partner and an open-source platform for 3D AI agents. Previously from us here: [how we metered a SaaS product through AWS Marketplace with the AWS SDK for JavaScript v3](https://builder.aws.com/content/3ESpll50BdSp9eiCEIxcfG9pGUN/how-we-metered-a-saas-product-through-aws-marketplace-with-the-aws-sdk-for-javascript-v3).*
