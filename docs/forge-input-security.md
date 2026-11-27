# Forge input security

Everything a stranger can send to Forge (an address, an uploaded photo, a model file) is untrusted. This page lists where each kind of input goes, which guard stands in front of it, and what is still open. The proof is `tests/api/forge-input-security.test.js`.

## Addresses

Every endpoint that takes an address runs it through the shared guard in `api/_lib/ssrf-guard.js` before anything fetches it. The guard resolves the name, classifies every answer, and refuses private, loopback, link-local, cloud-metadata, carrier-grade NAT, multicast and reserved ranges. It classifies by value, so decimal (`2130706433`), hex (`0x7f000001`), octal (`0177.0.0.1`), short (`127.1`), trailing-dot, userinfo-prefixed and every IPv6 form (mapped, compatible, NAT64, 6to4, link-local, unique-local, bracketed) are caught however they are spelled.

Two entry points:

- `fetchSafePublicUrl` is for fetches our server makes and checks. It follows redirects by hand and re-validates every hop (at most 5), refuses `http://` unless a caller opts in, and enforces `maxBytes` while the body streams (`MaxBytesExceededError`, status 413) and a timeout.
- `fetchSafePublicUrlPinned` connects to the address it validated, so a host whose DNS answers public on the check and private on the connect cannot reach an internal service (DNS rebinding).

`api/_lib/forge-input-guard.js` exports `findUnsafeUrl(urls)`, the boundary check the job-submit endpoints use for an address a worker will fetch later. A name that resolves nowhere (NXDOMAIN, no records) passes, since nothing internal is behind it. Any other lookup failure, and every private answer, is refused.

### Endpoint inventory

Guarded before any worker or fetch (each runs the full hostile table in the test, over http and https):

- `POST /api/forge` and `POST /api/gpt-forge`: `image_urls`, `image_url`, and the rig `glb_url`.
- `POST /api/forge-rembg`, `forge-remesh`, `forge-segment`, `forge-stylize`, `forge-holopart`, `forge-gameready`, `forge-splat`, `forge-scene-objects` (`image_url` and `mask_urls`).
- `POST /api/forge-nim`: the reference image and the artifact URL a NIM returns go through `fetchSafePublicUrl`; a caller-pointed NIM host goes through the pinned fetch.
- `POST /api/forge-upload` with `source_url`: the link importer in `api/_lib/forge-image-import.js`.
- The vision precheck (`api/_lib/vision.js`): image fetch via `fetchSafePublicUrl`.

## Fetch limits

- Size is capped while streaming, never after buffering. The reference-image fetch in vision stops at 12 MiB, `forge-nim` at 10 MB for an image and 128 MB for a NIM-supplied GLB, the studio GLB save at its own `MAX_GLB_BYTES`. A gzip bomb is capped on the decoded size.
- Every fetch has a timeout, and redirects stop at 5.
- Type is judged by bytes. `forge-nim` and the upload verifier sniff the leading bytes (PNG, JPEG, WebP only) and ignore the `Content-Type` a remote host or a data URI claimed. A NIM-supplied artifact must start with the `glTF` magic.

## Uploads

`POST /api/forge-upload` mints the only storage key a caller writes to: `forge/uploads/<account hash>/<uuid>.<ext>`. A caller cannot choose the name, a prefix or a path; `content_type` is an allowlist of PNG, JPEG and WebP (an own-property check, so `constructor` and `__proto__` fail); `size_bytes` is bounded at presign time.

A presigned PUT cannot pin its own size or type (signing `Content-Length` breaks the browser's CORS preflight), and the hourly sweeper deletes an oversized object only after the fact. So the bytes are verified when a job is submitted. `verifyUploadedReferences` in `api/_lib/forge-input-guard.js` reads the stored object (head plus the first 512 KB) for every reference under `forge/uploads/` and refuses:

- a file that is not PNG, JPEG or WebP by its bytes (415 `invalid_image_type`),
- a file over the 8 MB upload ceiling (413 `image_too_large`),
- a file whose header claims more than 8192 pixels on a side (422 `invalid_image_dimensions`), which stops a small file that expands to gigapixels.

If storage is down or the object is not there yet, the job still goes (the worker re-validates what it downloads); only a definite bad verdict refuses.

## Model files

`inspectGlb` in `api/_lib/glb-inspect.js` reads only the glTF JSON chunk, from a ranged read, and never follows a URI inside it. It refuses a chunk that parses to anything but an object and tolerates null skins, nodes, meshes and accessors, absurd counts, deep nesting and 4 GB length fields without throwing or allocating.

## Open: worker DNS rebinding

Workers fetch the address they are given using `workers/*/worker_security.py` (vendored byte-identical into 36 workers, checked by `npm run check:vendored`). It validates the DNS answer and then lets httpx resolve the name again to connect, so a host whose DNS answers public once and `127.0.0.1` the next time passes the check and is connected to. Workers only ever fetch `https://`, so an attacker needs an internal service that speaks TLS on the address.

Reproduce: `python3 -I scripts/forge-worker-rebind-repro.py`. While the gap is open it prints `RESULT: fetched b'INTERNAL-SECRET'` and exits 1; once the worker pins the validated address it prints `blocked` and exits 0.

The fix is to resolve once, validate, and connect to that IP (an httpx transport with a fixed address, keeping the original `Host` and TLS server name). It changes the vendored file in every worker, including the protected `workers/model-trellis/`, so it needs the owner's approval before it is committed.

## Related

- [Forge](./forge.md), [The Forge pipeline](./forge-pipeline.md).
