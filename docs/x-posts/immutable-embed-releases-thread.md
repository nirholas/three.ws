# X thread: immutable embed releases

Companion thread for @trythreews to the AWS Builder Center draft
[`aws-builder-center-immutable-embed-releases.md`](../aws-builder-center-immutable-embed-releases.md):
how three.ws releases the `<agent-3d>` web component so a pinned embed never breaks, the
2026-10-01 incident where rebuilding version 1.5.2 on every deploy broke the integrity pins we had
published, and the second lesson about code that runs on someone else's origin.

The thread stands on its own; it does not depend on the article being live. Posting is manual and
owner-gated per [`CLAUDE.md`](../../CLAUDE.md) (posting to external channels needs explicit
approval). Do not post post 9 before checking the deploy note in the "do not claim" list below.

**Thesis:** a versioned URL is a promise to people you will never talk to, so a release has to be a
record that deploys read from, never something a deploy produces. Nothing else. No coin, no
payments, no roadmap.

## Verified claims

Checked on 2026-10-08. Every hash was computed with `curl | openssl dgst -sha384 -binary | openssl base64 -A`.

| Claim | Where it was verified |
| --- | --- |
| `/agent-3d/1.5.2/agent-3d.js` is 3,308,933 bytes and hashes to `sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q` on three.ws, in the archive, and in the ledger | https://three.ws/agent-3d/1.5.2/agent-3d.js, https://storage.googleapis.com/three-ws-lib-releases/agent-3d/1.5.2/agent-3d.js, [`data/agent-3d-releases.json`](../../data/agent-3d-releases.json) |
| The versioned path is served `public, max-age=31536000, immutable`; `latest`, `1` and `1.5` are served `public, max-age=3600, s-maxage=300, stale-while-revalidate=86400` | `curl -sI` against the live URLs; route rules in [`vercel.json`](../../vercel.json) |
| 1.5.2 was cut on 2026-06-17 and `package.json` stayed at 1.5.2 until the fix | commit `57c315696`; `git log -S'"version": "1.5.2"' -- package.json` |
| The old publish step wrote the exact version and all moving channels from the current build | `git show bde1f4975^:scripts/publish-lib.mjs` (`const channels = [version, ...]`) |
| Before the fix, our docs carried two different hashes for 1.5.2 (`qCG5gH4...` in the Character Library tutorial and the combined docs page, `xkFDjVP8...` in the agent skill files) while production served `KdAiFR...` | `git grep` at `bde1f4975^`; diff of commit `bde1f4975` |
| A stale pin is refused by the browser with "Failed to find a valid digest in the 'integrity' attribute ... The resource has been blocked." | Headless Chromium (Playwright) loading the live URL with the old `qCG5gH4...` hash from a non-three.ws origin, 2026-10-08 |
| `/agent-3d/1.5.1/agent-3d.js` answers 404 | `curl` on 2026-10-08; the 1.5.2 release commit `57c315696` said "1.5.1 stays immutable" |
| The archive is `gs://three-ws-lib-releases`, uploads use `--if-generation-match=0`, and the bucket has a retention policy of 315,295,200 seconds (just under ten years) that is not locked | [`scripts/release-lib.mjs`](../../scripts/release-lib.mjs); `gcloud storage buckets describe gs://three-ws-lib-releases` |
| Every deploy lays out each released version from the archive and refuses bytes that do not match the ledger; moving channels follow the current build; publishing refuses a version that was never released | [`scripts/publish-lib.mjs`](../../scripts/publish-lib.mjs), `fetchReleaseFile` in [`scripts/lib/agent-3d-releases.mjs`](../../scripts/lib/agent-3d-releases.mjs) |
| `check:dist` re-hashes released files and checks `versions.json` and documented pins; `npm run check:sri-pins -- --fix` rewrites stale doc pins; the same check runs under `npm test` | [`scripts/check-dist.mjs`](../../scripts/check-dist.mjs), [`scripts/check-sri-pins.mjs`](../../scripts/check-sri-pins.mjs), [`tests/agent-3d-releases.test.js`](../../tests/agent-3d-releases.test.js) |
| A released version is never re-cut with different bytes; `--from https://three.ws` froze 1.5.2 at the bytes production served | [`scripts/release-lib.mjs`](../../scripts/release-lib.mjs); ledger `source` field is `https://three.ws/agent-3d/1.5.2/` |
| The embed now resolves its API origin from its own script URL, sends cookies only when the page is three.ws, and anonymous public reads answer any origin | commit `fb067d0f2`; [`src/shared/embed-api-origin.js`](../../src/shared/embed-api-origin.js); `embedReadCors` in [`api/_lib/http.js`](../../api/_lib/http.js) |
| Production on 2026-10-08 runs commit `76081013b`, built 2026-10-01 19:31 UTC, so `fb067d0f2` is not live yet | https://three.ws/api/version |
| `/agent-3d/1.5.2/integrity.json` and `/agent-3d/versions.json` serve the ledger hashes | https://three.ws/agent-3d/1.5.2/integrity.json, https://three.ws/agent-3d/versions.json |

## Do not claim

1. **Do not claim a number of embeds or pages.** We have no measured count of sites embedding the
   element. "Pages we do not own" is true; "thousands of pages" is not verified.
2. **Do not claim the origin fix is live** until `curl -s https://three.ws/api/version` reports a
   commit at or after `fb067d0f2`. If it has shipped by posting day, change the last sentence of
   post 9 to say it is live and the first clause of post 10 to "that fix reached latest, 1 and 1.5".
3. **Do not claim the UMD build works from a plain script tag.** On 2026-10-08,
   `/agent-3d/1.5.2/agent-3d.umd.cjs` is served as `application/node` with `nosniff`, and Chromium
   refuses to run it. The bytes hash correctly; the header is wrong. Fix the content type before
   anyone points readers at the UMD file.
4. **Do not claim older versions are still available.** Only 1.5.2 is in the ledger; 1.5.1 and
   earlier answer 404.
5. **Do not call the archive permanent or locked.** The retention policy is real and not locked.
6. **Do not say the moving channels cache for "5 minutes" without qualification.** The edge caches
   for 5 minutes; browsers may keep the file for an hour.
7. **Do not imply AWS hosting.** Runtime and archive are on Google Cloud. The AWS article maps the
   patterns to S3 and CloudFront; it does not describe something we run there.

---

## The thread

Eleven posts. Counts are X weighted characters with every URL, and every bare domain X would
auto-link (`three.ws`, `example.com`), counted as 23.

**1/** (509 characters) Attach `same-url-two-pins.png`.

```text
For three and a half months, the URL we told developers would never change, https://three.ws/agent-3d/1.5.2/agent-3d.js, was rewritten on every deploy.

Our own docs carried two different integrity hashes for that one file, and production served a third. Browsers refuse a script whose hash does not match, so a page that followed our tutorial to the letter got a blank space where the 3D avatar should be.

We fixed it on Oct 1. This is how the release pipeline for our embeddable web component works now, and what we got wrong.
```

**2/** (711 characters) Attach `docs-cdn-versioning.png`.

```text
The embed is two lines of HTML: a script tag that loads the <agent-3d> custom element, and the element pointed at a 3D body. That script then runs on pages we never see.

So the same file is served two ways:

Moving channels (latest, 1, 1.5) follow whatever is deployed. Edge cache 5 minutes, browser up to an hour. For prototypes.

Exact versions (1.5.2) are served "max-age=31536000, immutable". That header tells every browser and CDN the bytes will never change, so they never ask again. For production, pinned with a Subresource Integrity hash.

The second contract is a promise you cannot take back. If the bytes move, caches split visitors into two groups running different code under one version number.
```

**3/** (570 characters)

```text
Subresource Integrity is a hash in the script tag: integrity="sha384-...". The browser downloads the file, computes its SHA-384, and compares. On a mismatch it does not run the script, and the host page's console says:

"Failed to find a valid digest in the 'integrity' attribute ... The resource has been blocked."

For an embedder that is the right trade. If anything between them and us serves different bytes, mistaken or malicious, their page fails closed.

The price is on us: a pinned URL has to be byte-stable forever, and the browser enforces it with no appeal.
```

**4/** (673 characters)

```text
The bug was one line in our publish step:

const channels = [version, `${major}.${minor}`, major, 'latest'];

All four directories were written from the current build. That is fine on the day a version is cut. It breaks the day after, because nothing forces the version string to change when the code does.

Version 1.5.2 was cut on June 17. package.json stayed at 1.5.2 until October 1. Every deploy in between rewrote the "immutable" file.

Same root cause, quieter casualty: the old step only wrote the current version, so 1.5.1 vanished the day 1.5.2 shipped. It answers 404 today.

A release was a side effect of a deploy. It has to be a record that deploys read from.
```

**5/** (552 characters)

```text
Fix, part one: a write-once archive.

Releasing a version uploads its two files to a public Google Cloud Storage bucket with --if-generation-match=0, a precondition that fails if anything already exists at that path. Our own tools cannot overwrite a release.

The bucket also carries a retention policy of just under ten years, so an object cannot be deleted or replaced until it is that old. That covers a person with credentials and a bad afternoon.

Two layers on purpose: a precondition is opt-in per request, and a hand-typed upload can forget it.
```

**6/** (630 characters)

```text
Fix, part two: a ledger the build has to obey.

data/agent-3d-releases.json, in git, records the SHA-384 of every file of every release.

On every deploy, each released version is downloaded from the archive, hashed, and written out only if it matches the ledger. A mismatch stops the deploy instead of publishing altered bytes. Moving channels still follow the current build.

Two more guards: publishing refuses to run when package.json names a version that was never released, so bumping a number can no longer mint a release by accident. And check:dist re-hashes what actually landed in the build output before anything ships.
```

**7/** (738 characters)

```text
Fix, part three: documentation is a pin too.

The incident was found in our docs, so the build now treats them as release surface. A scanner finds every script tag that loads a versioned agent-3d file with an integrity attribute, across docs, specs, examples, the README, packages and the skill files we ship to AI coding agents, and fails the build if one disagrees with the ledger. check:sri-pins --fix rewrites a stale hash; a pin on a version that was never released stays an error until a person fixes it. The same check runs under npm test.

Then the hard call: which of the three hashes becomes permanent. We froze 1.5.2 at the bytes production was serving, so live embeds kept working. Anyone holding an older pin updates it once.
```

**8/** (310 characters)

```text
Check it yourself. These three should print the same hash:

curl -s https://three.ws/agent-3d/1.5.2/agent-3d.js | openssl dgst -sha384 -binary | openssl base64 -A

The same file from the archive:
https://storage.googleapis.com/three-ws-lib-releases/agent-3d/1.5.2/agent-3d.js

The recorded value:
https://three.ws/agent-3d/1.5.2/integrity.json

On Oct 8 all three were sha384-KdAiFRsdcCbQ..., 3,308,933 bytes.
```

**9/** (790 characters)

```text
The second lesson came two days later, and it is about where an embed's code thinks home is.

On our own site, fetch('/api/agents/' + id) calls us. Inside an embed on example.com, the same line asks example.com for an agent, gets a 404, and the avatar falls back to a default body.

The fix: an ES module knows its own URL through import.meta.url, so the element now derives the API origin from the script that loaded it, and threads that through the modules that call our API. Cookies are sent only when the page is three.ws itself. On the server, a read with no cookie and no auth header can only see public data, so it answers any origin; anything carrying identity keeps the strict allowlist.

That fix is committed and ships with our next deploy.
```

**10/** (567 characters)

```text
The limit, said plainly: when that fix deploys, it reaches latest, 1 and 1.5 immediately. It will never reach 1.5.2.

Those bytes are frozen. A page pinned to 1.5.2 keeps the old behavior until its owner moves to a newer release, which exists once we cut 1.5.3.

That is the design, not a flaw in it. A pinned embedder chose to receive no changes without consent, including good ones. What it asks of us is to cut releases often enough that "upgrade to get the fix" is a real option, and the last three and a half months show that is the habit we still have to build.
```

**11/** (366 characters)

```text
The pinning guide, the channel table and the current integrity hash for production embeds:
https://three.ws/docs/web-component#cdn-versioning

If your page pins 1.5.2 with a hash from before October 1, replace it once with the value in /agent-3d/1.5.2/integrity.json. It will not change again.

The release scripts are short, Apache-2.0, and written to be lifted whole:
https://github.com/nirholas/three.ws/blob/main/scripts/release-lib.mjs
```

---

## Reply to append once the AWS article is live

Post this as a reply under post 11 only after the AWS Builder Center article has been published.
Whoever publishes it pastes the article's canonical Builder Center URL directly after the colon,
separated by one space, before posting. Without the URL it measures 125 characters; with the space and the URL it is 149.

```text
The long version, with every script excerpted and a mapping onto S3 Object Lock and CloudFront, is on the AWS Builder Center:
```

---

## Media plan

Both images were captured on 2026-10-08 with Playwright (headless Chromium) against the live site
and checked by eye: no sign-in wall, no spinner, no error page, and the avatar is in its idle pose,
not a T-pose. They live in
[`public/x-media/immutable-embed-releases-thread/`](../../public/x-media/immutable-embed-releases-thread/).

**`same-url-two-pins.png`** (3200x1800), for post 1. A plain host page on a non-three.ws origin,
written for this capture, with two isolated frames. Both load `https://three.ws/agent-3d/1.5.2/agent-3d.js`;
only the `integrity` attribute differs. The status line under each frame is written by the script
tag's own `load` or `error` event, not typed in.

> Alt text: Two side-by-side frames on a page headed "Same URL, two integrity pins". Both load the
> same three.ws script URL for version 1.5.2. On the left, pinned to the hash in the release ledger,
> a 3D avatar of a woman in glasses and a purple and grey tracksuit stands in an idle pose, and the
> caption reads "script ran: integrity matched the served bytes". On the right, pinned to the hash
> our tutorial carried before October 1, the frame is empty and the caption reads "browser refused
> the script: integrity mismatch".

**`docs-cdn-versioning.png`** (2800x1800), for post 2. The CDN versioning section of
https://three.ws/docs/web-component in dark mode.

> Alt text: The three.ws documentation page for the agent-3d web component, open at the "CDN
> versioning" section. A table lists four script paths: the exact MAJOR.MINOR.PATCH version marked
> immutable and "Production. Pin exact bytes. Combine with SRI.", then the minor, major and latest
> channels for following newer code. Below it, a section titled "What immutable guarantees"
> explains that each version is cut once by npm run release:lib into a write-once archive and
> recorded in data/agent-3d-releases.json.

Note on the docs capture: the table on that page says "5 min" for the moving channels. That is the
edge cache (`s-maxage=300`); the response also allows browsers to keep the file for an hour
(`max-age=3600`). Post 2 states both, which is why its wording differs from the screenshot.
